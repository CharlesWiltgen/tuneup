import { extname } from "jsr:@std/path";
import { readMetadataBatch } from "jsr:@charlesw/taglib-wasm@0.5.4/simple";
import {
  buildScanResult,
  classifyDirectories,
  type DiscoveryOptions,
  type MusicDiscovery,
  type SkippedFile,
} from "./fast_discovery.ts";
import { listAudioFilesRecursive } from "../lib/fastest_audio_scan_recursive.ts";
import { detectCompilationsRefactored } from "./detect_compilations_refactored.ts";

// Re-export SkippedFile for external use
export type { SkippedFile } from "./fast_discovery.ts";

/**
 * Brand type for file paths to ensure type safety
 */
export type FilePath = string & { __brand: "FilePath" };
export type DirectoryPath = string & { __brand: "DirectoryPath" };

/**
 * Type guard to ensure string is a FilePath
 */
export function asFilePath(path: string): FilePath {
  return path as FilePath;
}

/**
 * Type guard to ensure string is a DirectoryPath
 */
export function asDirectoryPath(path: string): DirectoryPath {
  return path as DirectoryPath;
}

/**
 * Configuration for file map building
 */
interface FileMapConfig {
  files: FilePath[];
  debug?: boolean;
}

/**
 * Result of building file maps
 */
interface FileMaps {
  byBaseName: Map<string, FilePath[]>;
  mpeg4Files: FilePath[];
}

/**
 * Configuration for duplicate detection
 */
interface DuplicateDetectionConfig {
  files: FilePath[];
  fileMaps: FileMaps;
  aacFiles: Set<FilePath>;
  forceEncode?: boolean;
  debug?: boolean;
}

/**
 * Result of duplicate detection
 */
interface DuplicateDetectionResult {
  filesToEncode: FilePath[];
  skippedFiles: SkippedFile[];
}

/**
 * Build file maps for efficient lookup
 * Extracts the file map building logic from discoverMusic
 */
export function buildFileMaps(config: FileMapConfig): FileMaps {
  const { files, debug } = config;
  const byBaseName = new Map<string, FilePath[]>();
  const mpeg4Files: FilePath[] = [];

  for (const file of files) {
    // Extract MPEG-4 files
    const lower = file.toLowerCase();
    if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) {
      mpeg4Files.push(file);
    }

    // Build base name map
    const dir = file.substring(0, file.lastIndexOf("/"));
    const filename = file.substring(file.lastIndexOf("/") + 1);
    const extIndex = filename.lastIndexOf(".");

    if (extIndex > 0) {
      const baseName = dir + "/" + filename.substring(0, extIndex);
      if (!byBaseName.has(baseName)) {
        byBaseName.set(baseName, []);
      }
      byBaseName.get(baseName)!.push(file);
    }
  }

  if (debug) {
    console.log(
      `[DEBUG] Built file maps: ${byBaseName.size} unique base names, ${mpeg4Files.length} MPEG-4 files`,
    );
  }

  return { byBaseName, mpeg4Files };
}

/**
 * Detect files that have already been encoded
 * Extracts the duplicate detection logic from discoverMusic
 */
export function detectAlreadyEncodedFiles(
  config: DuplicateDetectionConfig,
): DuplicateDetectionResult {
  const { files, fileMaps, aacFiles, forceEncode, debug } = config;
  const filesToEncode: FilePath[] = [];
  const skippedFiles: SkippedFile[] = [];

  const losslessFormats = new Set(["flac", "wav", "aiff", "ape", "wv"]);
  const lossyFormats = new Set(["mp3", "ogg", "opus", "wma"]);

  for (const file of files) {
    const ext = extname(file).slice(1).toLowerCase();

    // Check if already marked as AAC
    if (aacFiles.has(file)) {
      continue; // Already in skippedFiles from AAC check
    }

    if (losslessFormats.has(ext)) {
      // Check for existing lossy version
      const dir = file.substring(0, file.lastIndexOf("/"));
      const filename = file.substring(file.lastIndexOf("/") + 1);
      const extIndex = filename.lastIndexOf(".");
      const baseName = dir + "/" + filename.substring(0, extIndex);

      const relatedFiles = fileMaps.byBaseName.get(baseName) || [];
      let hasLossyVersion = false;
      let encodedPath = "";

      for (const related of relatedFiles) {
        if (related === file) continue;

        const relatedExt = extname(related).slice(1).toLowerCase();

        // Check if it's a lossy format
        if (lossyFormats.has(relatedExt)) {
          hasLossyVersion = true;
          encodedPath = related;
          break;
        }

        // Check if it's an AAC M4A file
        if (
          (relatedExt === "m4a" || relatedExt === "mp4") &&
          aacFiles.has(related)
        ) {
          hasLossyVersion = true;
          encodedPath = related;
          break;
        }
      }

      if (hasLossyVersion && !forceEncode) {
        skippedFiles.push({
          path: file,
          reason: "already-encoded",
          encodedPath,
        });
        if (debug) {
          console.log(
            `[DEBUG] Skipping ${file}: already encoded as ${encodedPath}`,
          );
        }
      } else {
        filesToEncode.push(file);
      }
    } else if (ext === "m4a" || ext === "mp4") {
      // ALAC files should be in the filesToEncode list
      if (!aacFiles.has(file)) {
        filesToEncode.push(file);
      }
    } else if (!lossyFormats.has(ext)) {
      // Other formats that might be encodable
      filesToEncode.push(file);
    }
    // Skip lossy formats (mp3, ogg, etc) - they won't be encoded
  }

  return { filesToEncode, skippedFiles };
}

/**
 * Validate MPEG-4 files and detect AAC/ALAC codecs
 * Extracts the MPEG-4 validation logic from discoverMusic
 */
export async function validateMpeg4Files(
  mpeg4Files: FilePath[],
  parallelism: number = 8,
  debug?: boolean,
): Promise<{ aacSkipped: SkippedFile[]; aacFiles: Set<FilePath> }> {
  const aacSkipped: SkippedFile[] = [];
  const aacFiles = new Set<FilePath>();

  if (mpeg4Files.length === 0) {
    return { aacSkipped, aacFiles };
  }

  if (debug) {
    console.log(`[DEBUG] Validating ${mpeg4Files.length} MPEG-4 files`);
  }

  try {
    const results = await readMetadataBatch(mpeg4Files, {
      concurrency: parallelism,
      continueOnError: true,
    });

    for (let i = 0; i < results.results.length; i++) {
      const result = results.results[i];
      const file = mpeg4Files[i];

      if ("error" in result && result.error) {
        aacSkipped.push({ path: file, reason: "error" });
        if (debug) {
          console.log(`[DEBUG] Error reading ${file}: ${result.error}`);
        }
        continue;
      }

      const properties = result.data?.properties;
      const codec = (properties?.codec || "").toLowerCase();

      if (debug) {
        console.log(`[DEBUG] ${file} codec: ${codec || "unknown"}`);
      }

      if (codec.includes("aac")) {
        aacSkipped.push({ path: file, reason: "aac", codec });
        aacFiles.add(file);
      }
      // ALAC and other codecs are not added to skipped
    }
  } catch (error) {
    if (debug) {
      console.error(`[DEBUG] Batch metadata read failed: ${error}`);
    }
    // On failure, treat all as encodable to be safe
  }

  return { aacSkipped, aacFiles };
}

/**
 * Main discovery function refactored to use smaller functions
 */
export async function discoverMusicRefactored(
  paths: string[],
  options?: DiscoveryOptions,
): Promise<MusicDiscovery> {
  const debug = options?.debug;

  if (debug) {
    console.log(`[DEBUG] Starting discovery for: ${paths.join(", ")}`);
    console.log(
      `[DEBUG] Options: forEncoding=${options.forEncoding}, parallelism=${options.parallelism}`,
    );
  }

  // Phase 1: Fast FS scan
  // Note: listAudioFilesRecursive only handles directories, so we must separate files first
  const directories = paths.filter((path) => {
    try {
      return Deno.statSync(path).isDirectory;
    } catch {
      return false;
    }
  });

  if (directories.length === 0) {
    // No directories to scan
    return {
      albums: new Map(),
      compilations: new Map(),
      singles: [],
      totalFiles: 0,
      scan: { filesByDir: new Map(), dirInfo: new Map(), allFiles: [] },
    };
  }

  const allFiles = listAudioFilesRecursive(directories);
  const scan = buildScanResult(allFiles, options);

  if (debug) {
    console.log(
      `[DEBUG] Scan complete: ${scan.allFiles.length} files in ${scan.filesByDir.size} directories`,
    );
  }

  // Phase 2: Classify directories
  options?.onProgress?.("classify", 0);
  const { albums, singles } = classifyDirectories(
    scan,
    options?.singlePatterns,
    debug,
  );
  options?.onProgress?.("classify", 1, 1);

  if (debug) {
    console.log(
      `[DEBUG] Classification: ${albums.size} albums, ${singles.length} singles`,
    );
  }

  const result: MusicDiscovery = {
    albums,
    compilations: new Map<string, string[]>(),
    singles,
    totalFiles: scan.allFiles.length,
    scan,
  };

  // Phase 3: For encoding, detect compilations and validate files
  if (options?.forEncoding) {
    options?.onProgress?.("validate", 0);

    // Detect compilations
    if (albums.size > 0) {
      const { albums: regularAlbums, compilations } =
        await detectCompilationsRefactored(
          albums,
          debug,
        );
      result.albums = regularAlbums;
      result.compilations = compilations;

      if (debug && compilations.size > 0) {
        console.log(`[DEBUG] Detected ${compilations.size} compilations`);
      }
    }

    // Build file maps once (performance optimization)
    const filePaths = scan.allFiles.map(asFilePath);
    const fileMaps = buildFileMaps({ files: filePaths, debug });

    // Validate MPEG-4 files
    const { aacSkipped, aacFiles } = await validateMpeg4Files(
      fileMaps.mpeg4Files,
      options?.parallelism,
      debug,
    );

    // Detect already encoded files
    const { filesToEncode, skippedFiles: alreadyEncoded } =
      detectAlreadyEncodedFiles({
        files: filePaths,
        fileMaps,
        aacFiles,
        forceEncode: options?.forceEncode,
        debug,
      });

    // Combine results
    result.filesToEncode = filesToEncode;
    result.skippedFiles = [...aacSkipped, ...alreadyEncoded];

    if (debug) {
      console.log(
        `[DEBUG] Validation complete: ${result.skippedFiles.length} files skipped`,
      );
    }

    options?.onProgress?.("validate", 1, 1);
  }

  return result;
}
