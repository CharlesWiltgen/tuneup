import { discoverMusic } from "../utils/fast_discovery.ts";
import type { CommandOptions } from "../types/command.ts";
import {
  OperationStats,
  PROCESSING_SUMMARY,
} from "../utils/operation_stats.ts";
import { processSoundCheck } from "../lib/soundcheck.ts";
import { formatError } from "../utils/error_utils.ts";
import { ProgressReporter } from "../utils/progress_reporter.ts";

export async function soundcheckCommand(
  options: CommandOptions,
  ...files: string[]
): Promise<void> {
  const reporter = new ProgressReporter({ quiet: options.quiet ?? false });

  try {
    if (!options.quiet) {
      console.log("→ Discovering audio files...");
    }

    const discovery = await discoverMusic(files, {
      onProgress: reporter.discoveryCallback(),
    });

    const filesToProcess = [
      ...discovery.singles,
      ...Array.from(discovery.albums.values()).flat(),
      ...Array.from(discovery.compilations.values()).flat(),
    ].sort();

    if (!options.quiet) {
      reporter.complete(
        `Discovered ${filesToProcess.length} audio files`,
      );
    }

    const stats = new OperationStats();

    for (const file of filesToProcess) {
      try {
        if (!options.quiet) {
          const fileName = file.substring(file.lastIndexOf("/") + 1);
          console.log(`\n→ ${fileName}`);
        }

        const status = await processSoundCheck(file, {
          force: options.force || false,
          quiet: options.quiet,
          dryRun: options.dryRun || false,
        });
        stats.increment(status);
      } catch (error) {
        console.error(
          `Unexpected error processing ${file}: ${formatError(error)}`,
        );
        stats.incrementFailed();
      }
    }

    stats.printSummary(
      "SoundCheck Complete",
      PROCESSING_SUMMARY,
      options.dryRun,
    );
  } finally {
    reporter.dispose();
  }
}
