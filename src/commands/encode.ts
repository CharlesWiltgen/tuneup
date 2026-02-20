import { basename, extname } from "@std/path";
import { generateOutputPath, isLosslessFormat } from "../lib/encoding.ts";
import { discoverMusic } from "../utils/fast_discovery.ts";
import type { CommandOptions } from "../types/command.ts";
import { ENCODING_SUMMARY, OperationStats } from "../utils/operation_stats.ts";
import { exitWithError, validateFiles } from "../utils/console_output.ts";
import { exitWithFormattedError, formatError } from "../utils/error_utils.ts";
import { EncodingSpinner } from "../utils/spinner.ts";

interface EncodeOptions extends CommandOptions {
  forceLossyTranscodes?: boolean;
  outputDir?: string;
  flattenOutput?: boolean;
  concurrency?: number;
  columns?: number;
}

// deno-lint-ignore no-control-regex
const ANSI_ESCAPE_RE = /\x1b\[[0-9;]*m/g;
const WRAP_PREFIX = "   🎧 ";
const CONTINUATION_INDENT = "      "; // 6 spaces to align under text after "   🎧 "

export function displayWidth(str: string): number {
  const stripped = str.replace(ANSI_ESCAPE_RE, "");
  let width = 0;
  for (const char of stripped) {
    const code = char.codePointAt(0)!;
    width += code > 0xFFFF ? 2 : 1;
  }
  return width;
}

export function wrapEncodingLine(line: string, maxWidth: number): string {
  if (maxWidth === Infinity) return line;
  if (!line.includes(WRAP_PREFIX)) return line;
  if (displayWidth(line) <= maxWidth) return line;

  const textStart = line.indexOf(WRAP_PREFIX) + WRAP_PREFIX.length;
  const prefix = line.slice(0, textStart);
  const text = line.slice(textStart);

  const wrappedLines: string[] = [];
  let currentPrefix = prefix;
  let remaining = text;

  while (remaining.length > 0) {
    const availableWidth = maxWidth - displayWidth(currentPrefix);
    if (displayWidth(remaining) <= availableWidth) {
      wrappedLines.push(currentPrefix + remaining);
      remaining = "";
      break;
    }

    // Find best break point within available width
    let breakIndex = -1;
    let widthSoFar = 0;
    let lastSlash = -1;
    let lastSpace = -1;

    for (let i = 0; i < remaining.length; i++) {
      const code = remaining.codePointAt(i)!;
      const charWidth = code > 0xFFFF ? 2 : 1;
      if (widthSoFar + charWidth > availableWidth) break;
      widthSoFar += charWidth;

      if (remaining[i] === "/") lastSlash = i;
      else if (remaining[i] === " ") lastSpace = i;

      // Skip surrogate pair trailing code unit
      if (code > 0xFFFF) i++;
    }

    // Prefer / over space as break point
    if (lastSlash > 0) {
      breakIndex = lastSlash + 1; // break after /
    } else if (lastSpace > 0) {
      breakIndex = lastSpace; // break at space (space goes to next line? no — drop it)
    }

    if (breakIndex > 0) {
      const chunk = remaining.slice(0, breakIndex);
      wrappedLines.push(currentPrefix + chunk);
      remaining = remaining[breakIndex] === " "
        ? remaining.slice(breakIndex + 1)
        : remaining.slice(breakIndex);
    } else {
      // Hard break: no good break point, break at available width
      let hardBreak = 0;
      widthSoFar = 0;
      for (let i = 0; i < remaining.length; i++) {
        const code = remaining.codePointAt(i)!;
        const charWidth = code > 0xFFFF ? 2 : 1;
        if (widthSoFar + charWidth > availableWidth) break;
        widthSoFar += charWidth;
        hardBreak = i + 1;
        if (code > 0xFFFF) i++;
      }
      wrappedLines.push(currentPrefix + remaining.slice(0, hardBreak));
      remaining = remaining.slice(hardBreak);
    }

    currentPrefix = CONTINUATION_INDENT;
  }

  return wrappedLines.join("\n");
}

function getTerminalColumns(options: EncodeOptions): number {
  if (options.columns !== undefined) return options.columns;
  try {
    return Deno.consoleSize().columns;
  } catch {
    return Infinity;
  }
}

interface EncodingTask {
  file: string;
  outputPath: string;
  trackDisplayName: string;
}

export function extractFolderNameFromPath(fileOrDir: string): string {
  if (fileOrDir.endsWith("/")) {
    // It's a directory path
    const trimmed = fileOrDir.slice(0, -1);
    return trimmed.substring(trimmed.lastIndexOf("/") + 1) || trimmed;
  }

  const lastSlash = fileOrDir.lastIndexOf("/");
  if (lastSlash === -1) {
    try {
      if (Deno.statSync(fileOrDir).isDirectory) return fileOrDir;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
    return ".";
  }

  // Has slashes - extract the directory part
  const dirPath = fileOrDir.substring(0, lastSlash);
  if (dirPath === ".") {
    return ".";
  }

  return dirPath.substring(dirPath.lastIndexOf("/") + 1) || dirPath;
}

function extractFolderNames(files: string[]): string[] {
  const folders = new Set<string>();

  for (const fileOrDir of files) {
    folders.add(extractFolderNameFromPath(fileOrDir));
  }

  return Array.from(folders).sort();
}

function showEncodingFeedback(folderArray: string[]): void {
  if (folderArray.length === 1) {
    console.log(
      `\n🗜️ amusic has started to encode 📁 \x1b[1m\x1b[94m${
        folderArray[0]
      }\x1b[0m`,
    );
  } else {
    console.log(`\n🗜️ amusic has started to encode:`);
    for (const folder of folderArray) {
      console.log(`  📁 \x1b[1m\x1b[94m${folder}\x1b[0m`);
    }
  }
}

type TaskResult =
  | { type: "task"; task: EncodingTask }
  | { type: "skip"; reason: "already_m4a" | "lossy_format" | "output_exists" };

async function checkIfShouldSkipFile(
  file: string,
  options: EncodeOptions,
): Promise<TaskResult | null> {
  // Skip M4A files
  if (extname(file).toLowerCase() === ".m4a") {
    if (!options.quiet) {
      console.log(`Skipping ${file} (already M4A format)`);
    }
    return { type: "skip", reason: "already_m4a" };
  }

  // Check if file is lossless
  const isLossless = await isLosslessFormat(file);
  if (!isLossless && !options.forceLossyTranscodes) {
    console.error(
      `Skipping ${file} (lossy format - use --force-lossy-transcodes to override)`,
    );
    return { type: "skip", reason: "lossy_format" };
  }

  return null;
}

async function checkIfOutputExists(
  outputPath: string,
  file: string,
  quiet?: boolean,
): Promise<boolean> {
  try {
    await Deno.stat(outputPath);
    if (!quiet) {
      console.log(
        `Skipping ${file} (output file already exists: ${outputPath})`,
      );
    }
    return true;
  } catch {
    return false;
  }
}

async function createOutputDirectoryIfNeeded(
  outputPath: string,
  options: EncodeOptions,
): Promise<void> {
  if (options.outputDir && !options.dryRun) {
    const outputFileDir = outputPath.substring(0, outputPath.lastIndexOf("/"));
    try {
      await Deno.mkdir(outputFileDir, { recursive: true });
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists)) {
        throw e;
      }
    }
  }
}

async function prepareEncodingTask(
  file: string,
  options: EncodeOptions,
  fileBaseMap: Map<string, string>,
): Promise<TaskResult> {
  // Check if we should skip this file
  const skipResult = await checkIfShouldSkipFile(file, options);
  if (skipResult) {
    return skipResult;
  }

  // Generate output path
  const outputPath = generateOutputPath(
    file,
    options.outputDir,
    !options.flattenOutput,
    fileBaseMap.get(file),
  );

  // Check if output already exists
  const outputExists = await checkIfOutputExists(
    outputPath,
    file,
    options.quiet,
  );
  if (outputExists) {
    return { type: "skip", reason: "output_exists" };
  }

  // Create output directory if needed
  await createOutputDirectoryIfNeeded(outputPath, options);

  // Performance trade-off: Use filename as display name instead of reading metadata
  // Reading metadata here would take ~10s per file with taglib-wasm, blocking preparation
  // The worker will show the filename initially, then can read actual metadata during encoding
  // This allows parallel processing to start immediately rather than waiting for sequential reads
  const trackDisplayName = basename(file);

  return { type: "task", task: { file, outputPath, trackDisplayName } };
}

async function collectAllFiles(
  files: string[],
  forceEncode?: boolean,
): Promise<{ filesToProcess: string[]; fileBaseMap: Map<string, string> }> {
  const discovery = await discoverMusic(files, {
    forEncoding: true, // This will validate MPEG-4 codecs
    forceEncode, // Pass through force encode option
    parallelism: 16, // Increase parallelism for faster metadata reading
    skipCompilationDetection: true, // Skip slow metadata reading for compilations
    onProgress: (phase, current, total) => {
      const message = total !== undefined
        ? `→ ${phase}: ${current}/${total}`
        : `→ ${phase}: ${current} files`;
      Deno.stdout.writeSync(
        new TextEncoder().encode(
          `\x1b[2K\r${message}`,
        ),
      );
    },
  });

  // Clear progress line
  Deno.stdout.writeSync(new TextEncoder().encode("\x1b[2K\r"));

  const filesToProcess = discovery.filesToEncode || [];
  const fileBaseMap = new Map<string, string>();

  // Map each file to its original argument
  for (const file of filesToProcess) {
    // Find which original argument this file came from
    for (const fileOrDir of files) {
      if (file.startsWith(fileOrDir) || file === fileOrDir) {
        fileBaseMap.set(file, fileOrDir);
        break;
      }
    }
  }

  // Report skipped files
  if (discovery.skippedFiles && discovery.skippedFiles.length > 0) {
    const alreadyEncoded = discovery.skippedFiles.filter((f) =>
      f.reason === "already-encoded"
    );

    if (alreadyEncoded.length > 0) {
      console.log(
        `\n🔄 Skipping ${alreadyEncoded.length} already-encoded files (use --force to re-encode/overwrite)`,
      );
    }
  }

  return { filesToProcess, fileBaseMap };
}

async function createOutputDirectory(
  outputDir: string | undefined,
  dryRun: boolean | undefined,
): Promise<void> {
  if (outputDir && !dryRun) {
    try {
      await Deno.mkdir(outputDir, { recursive: true });
    } catch (e) {
      exitWithFormattedError(e, "Error creating output directory");
    }
  }
}

interface WorkerContext {
  workers: Worker[];
  availableWorkers: number[];
  taskQueue: EncodingTask[];
  activeJobs: Map<number, EncodingTask>;
  workerLogs: Map<number, string[]>;
  spinner: EncodingSpinner | null;
  stats: OperationStats;
  options: EncodeOptions;
}

function createWorkerPool(
  concurrency: number,
  encodingTasks: EncodingTask[],
  ctx: WorkerContext,
): void {
  for (let i = 0; i < Math.min(concurrency, encodingTasks.length); i++) {
    const worker = new Worker(
      new URL("../workers/encode_worker.ts", import.meta.url).href,
      { type: "module" },
    );

    ctx.workers.push(worker);
    ctx.availableWorkers.push(i);

    setupWorkerMessageHandler(worker, i, ctx);
  }
}

function setupWorkerMessageHandler(
  worker: Worker,
  _workerId: number,
  ctx: WorkerContext,
): void {
  worker.onmessage = (e) => {
    const { id, type, message, error } = e.data;

    if (type === "log" && message) {
      bufferLogMessage(id, message, ctx.workerLogs);
    } else if (type === "error" && error) {
      bufferErrorMessage(id, error, ctx);
    } else if (type === "done") {
      handleWorkerDone(id, error, ctx);
    }
  };
}

function bufferLogMessage(
  id: number,
  message: string,
  workerLogs: Map<number, string[]>,
): void {
  const logs = workerLogs.get(id) ?? [];
  logs.push(message);
  workerLogs.set(id, logs);
}

function bufferErrorMessage(
  id: number,
  error: string,
  ctx: WorkerContext,
): void {
  const logs = ctx.workerLogs.get(id) ?? [];
  logs.push(error);
  ctx.workerLogs.set(id, logs);
  ctx.stats.incrementFailed();
}

function handleWorkerDone(
  id: number,
  error: string | undefined,
  ctx: WorkerContext,
): void {
  // Stop spinner and print logs
  if (ctx.spinner) {
    ctx.spinner.stop();
  }

  const logs = ctx.workerLogs.get(id) ?? [];
  if (!ctx.options.quiet && logs.length > 0) {
    const columns = getTerminalColumns(ctx.options);
    logs.forEach((log) => console.log(wrapEncodingLine(log, columns)));
  }

  // Clean up
  ctx.workerLogs.delete(id);
  ctx.activeJobs.delete(id);

  if (!error) {
    ctx.stats.incrementSuccess();
  }

  if (ctx.spinner) {
    ctx.spinner.incrementCompleted();
    if (ctx.taskQueue.length > 0 || ctx.activeJobs.size > 0) {
      ctx.spinner.start();
    }
  }

  // Make this worker available again
  ctx.availableWorkers.push(id);

  // Process next task if available
  processNextTask(ctx);
}

function processNextTask(ctx: WorkerContext): void {
  if (ctx.taskQueue.length === 0 || ctx.availableWorkers.length === 0) {
    // Check if all work is done
    if (ctx.taskQueue.length === 0 && ctx.activeJobs.size === 0) {
      // All done - clean up workers
      ctx.workers.forEach((w) => w.terminate());
      if (ctx.spinner) {
        ctx.spinner.stop();
      }
    }
    return;
  }

  const workerId = ctx.availableWorkers.shift();
  const task = ctx.taskQueue.shift();

  // These should never be undefined due to the checks above
  if (workerId === undefined || task === undefined) {
    return;
  }

  const worker = ctx.workers[workerId];
  ctx.activeJobs.set(workerId, task);

  // Send task to worker
  worker.postMessage({
    id: workerId,
    inputPath: task.file,
    outputPath: task.outputPath,
    trackDisplayName: task.trackDisplayName,
    options: {
      forceLossyTranscodes: ctx.options.forceLossyTranscodes,
      dryRun: ctx.options.dryRun,
      outputDirectory: ctx.options.outputDir,
    },
  });
}

export async function encodeCommand(
  options: EncodeOptions,
  ...files: string[]
): Promise<void> {
  validateFiles(files);

  // Show immediate feedback FIRST - before any file processing
  if (!options.quiet && files.length > 0) {
    const folderArray = extractFolderNames(files);
    showEncodingFeedback(folderArray);
  }

  // Collect all files
  const { filesToProcess, fileBaseMap } = await collectAllFiles(
    files,
    options.forceLossyTranscodes,
  );

  if (filesToProcess.length === 0) {
    exitWithError("No valid audio files found to encode.");
  }

  // Create output directory if needed
  await createOutputDirectory(options.outputDir, options.dryRun);

  // Prepare encoding tasks
  const stats = new OperationStats();
  const encodingTasks = await prepareAllEncodingTasks(
    filesToProcess,
    options,
    fileBaseMap,
    stats,
  );

  // Show worker info
  const concurrency = options.concurrency ?? 8;
  if (!options.quiet && encodingTasks.length > 0) {
    console.log(
      `\n🚀 Encoding ${encodingTasks.length} files with ${concurrency} parallel workers\n`,
    );
  }

  // Process with workers
  await processWithWorkers(encodingTasks, concurrency, options, stats);

  stats.printSummary("Encoding Complete", ENCODING_SUMMARY, options.dryRun);
}

async function prepareAllEncodingTasks(
  filesToProcess: string[],
  options: EncodeOptions,
  fileBaseMap: Map<string, string>,
  stats: OperationStats,
): Promise<EncodingTask[]> {
  const encodingTasks: EncodingTask[] = [];

  for (const file of filesToProcess) {
    try {
      const result = await prepareEncodingTask(file, options, fileBaseMap);
      if (result.type === "task") {
        encodingTasks.push(result.task);
      } else {
        stats.incrementSkipped(result.reason);
      }
    } catch (error) {
      console.error(`Error preparing ${file}: ${formatError(error)}`);
      stats.incrementFailed();
    }
  }

  return encodingTasks;
}

async function processWithWorkers(
  encodingTasks: EncodingTask[],
  concurrency: number,
  options: EncodeOptions,
  stats: OperationStats,
): Promise<void> {
  if (encodingTasks.length === 0) {
    return;
  }

  // Create context
  const ctx: WorkerContext = {
    workers: [],
    availableWorkers: [],
    taskQueue: [...encodingTasks],
    activeJobs: new Map<number, EncodingTask>(),
    workerLogs: new Map<number, string[]>(),
    spinner: options.quiet ? null : new EncodingSpinner(encodingTasks.length),
    stats,
    options,
  };

  if (ctx.spinner) {
    ctx.spinner.start();
  }

  // Create worker pool
  createWorkerPool(concurrency, encodingTasks, ctx);

  // Start processing tasks
  for (let i = 0; i < Math.min(concurrency, encodingTasks.length); i++) {
    processNextTask(ctx);
  }

  // Wait for all tasks to complete
  await waitForCompletion(ctx);
}

async function waitForCompletion(ctx: WorkerContext): Promise<void> {
  await new Promise<void>((resolve) => {
    const checkCompletion = setInterval(() => {
      if (ctx.taskQueue.length === 0 && ctx.activeJobs.size === 0) {
        clearInterval(checkCompletion);
        resolve();
      }
    }, 100);
  });
}
