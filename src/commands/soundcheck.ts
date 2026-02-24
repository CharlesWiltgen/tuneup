import { discoverMusic } from "../utils/fast_discovery.ts";
import type { CommandOptions } from "../types/command.ts";
import {
  OperationStats,
  PROCESSING_SUMMARY,
} from "../utils/operation_stats.ts";
import { processSoundCheck } from "../lib/soundcheck.ts";
import { formatError } from "../utils/error_utils.ts";

export async function soundcheckCommand(
  options: CommandOptions,
  ...files: string[]
): Promise<void> {
  if (!options.quiet) {
    Deno.stdout.writeSync(new TextEncoder().encode("\x1b[?25l"));
  }

  try {
    if (!options.quiet) {
      console.log("-> Discovering audio files...");
    }

    const discovery = await discoverMusic(files, {
      onProgress: (phase, current) => {
        if (!options.quiet) {
          Deno.stdout.writeSync(
            new TextEncoder().encode(
              `\x1b[2K\r-> ${phase}: ${current} files`,
            ),
          );
        }
      },
    });

    const filesToProcess = [
      ...discovery.singles,
      ...Array.from(discovery.albums.values()).flat(),
      ...Array.from(discovery.compilations.values()).flat(),
    ].sort();

    if (!options.quiet) {
      Deno.stdout.writeSync(
        new TextEncoder().encode(
          `\x1b[2K\r-> Discovered ${filesToProcess.length} audio files\n`,
        ),
      );
    }

    const stats = new OperationStats();

    for (const file of filesToProcess) {
      try {
        if (!options.quiet) {
          const fileName = file.substring(file.lastIndexOf("/") + 1);
          console.log(`\n-> ${fileName}`);
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
    if (!options.quiet) {
      Deno.stdout.writeSync(new TextEncoder().encode("\x1b[?25h"));
    }
  }
}
