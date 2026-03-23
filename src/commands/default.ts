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
import { ProgressReporter } from "../utils/progress_reporter.ts";

export async function defaultCommand(
  options: CommandOptions & { debug?: boolean },
  ...files: string[]
): Promise<void> {
  const reporter = new ProgressReporter({ quiet: options.quiet ?? false });

  try {
    if (!options.quiet) {
      console.log("→ Discovering audio files...");
    }

    const discovery = await discoverMusic(files, {
      debug: options.debug,
      onProgress: reporter.discoveryCallback(),
    });

    // Get all files from albums and singles
    const filesToProcess = [
      ...discovery.singles,
      ...Array.from(discovery.albums.values()).flat(),
    ].sort();

    reporter.complete(`Discovered ${filesToProcess.length} audio files`);

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

      try {
        const results = await batchProcessAcoustIDTagging(
          filesToProcess,
          options.apiKey,
          {
            force: options.force || false,
            quiet: options.quiet || false,
            dryRun: options.dryRun || false,
            concurrency: HIGH_CONCURRENCY,
            onProgress: (processed, total, _currentFile) => {
              reporter.update(processed, total, "Processing");
            },
          },
        );

        if (!options.quiet) {
          console.log();
        }

        // Update stats from results
        for (const [_file, status] of results) {
          stats.increment(status);
        }
      } catch (error) {
        console.error(
          `Batch processing failed: ${formatError(error)}`,
        );
        for (const _file of filesToProcess) {
          stats.incrementFailed();
        }
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

    stats.printSummary(
      "Processing Complete",
      PROCESSING_SUMMARY,
      options.dryRun,
    );
  } finally {
    reporter.dispose();
  }
}
