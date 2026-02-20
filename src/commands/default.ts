import {
  batchProcessAcoustIDTagging,
  processAcoustIDTagging,
} from "../lib/acoustid.ts";
import { discoverMusic } from "../utils/fast_discovery.ts";
import type { CommandOptions } from "../types/command.ts";
import {
  OperationStats,
  PROCESSING_SUMMARY,
} from "../utils/operation_stats.ts";
import {
  logProcessingInfo,
  validateAudioFiles,
} from "../utils/console_output.ts";
import { formatError } from "../utils/error_utils.ts";
import { showTagsWithFolderAPI } from "./show_tags_folder.ts";
import { HIGH_CONCURRENCY } from "../constants.ts";

export async function defaultCommand(
  options: CommandOptions & { debug?: boolean },
  ...files: string[]
): Promise<void> {
  // Hide cursor
  if (!options.quiet) {
    Deno.stdout.writeSync(new TextEncoder().encode("\x1b[?25l"));
  }

  if (!options.quiet) {
    console.log("→ Discovering audio files...");
  }

  const discovery = await discoverMusic(files, {
    debug: options.debug,
    onProgress: (phase, current) => {
      if (!options.quiet) {
        // Move cursor to beginning of line and clear it
        Deno.stdout.writeSync(
          new TextEncoder().encode(
            `\x1b[2K\r→ ${phase}: ${current} files`,
          ),
        );
      }
    },
  });

  // Get all files from albums and singles
  const filesToProcess = [
    ...discovery.singles,
    ...Array.from(discovery.albums.values()).flat(),
  ].sort();

  if (!options.quiet) {
    // Update with final count and checkmark
    Deno.stdout.writeSync(
      new TextEncoder().encode(
        `\x1b[2K\r✅ Discovered ${filesToProcess.length} audio files\n`,
      ),
    );
    // Show cursor
    Deno.stdout.writeSync(new TextEncoder().encode("\x1b[?25h"));
  }

  if (options.showTags) {
    // Use the new batch API for maximum performance
    await showTagsWithFolderAPI(filesToProcess, options.quiet);
    return;
  }

  validateAudioFiles(filesToProcess);
  logProcessingInfo(options, filesToProcess.length);

  const stats = new OperationStats();

  // Use batch processing for multiple files
  if (filesToProcess.length > 1 && options.apiKey) {
    if (!options.quiet) {
      console.log(`\nBatch processing ${filesToProcess.length} files...`);
    }

    const results = await batchProcessAcoustIDTagging(
      filesToProcess,
      options.apiKey,
      {
        force: options.force || false,
        quiet: options.quiet || false,
        dryRun: options.dryRun || false,
        concurrency: HIGH_CONCURRENCY,
        onProgress: (processed, total, _currentFile) => {
          if (!options.quiet) {
            // Move cursor to beginning of line and clear it
            Deno.stdout.writeSync(new TextEncoder().encode(
              `\x1b[2K\r→ Processing: ${processed}/${total} files (${
                Math.round(processed / total * 100)
              }%)`,
            ));
          }
        },
      },
    );

    if (!options.quiet) {
      Deno.stdout.writeSync(new TextEncoder().encode("\n"));
    }

    // Update stats from results
    for (const [_file, status] of results) {
      stats.increment(status);
    }
  } else {
    // Fall back to individual processing for single files or no API key
    for (const file of filesToProcess) {
      try {
        if (!options.quiet && filesToProcess.length > 1) console.log("");
        const status = await processAcoustIDTagging(
          file,
          options.apiKey || "",
          options.force || false,
          options.quiet,
          options.dryRun || false,
        );
        stats.increment(status);
      } catch (error) {
        console.error(
          `Unexpected error processing ${file}: ${formatError(error)}`,
        );
        stats.incrementFailed();
      }
    }
  }

  stats.printSummary("Processing Complete", PROCESSING_SUMMARY, options.dryRun);
}
