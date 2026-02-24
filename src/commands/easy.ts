import { getVendorBinaryPath } from "../lib/vendor_tools.ts";
import type { CommandOptions } from "../types/command.ts";
import { ensureCommandExists } from "../utils/command.ts";
import { EASY_MODE_SUMMARY, OperationStats } from "../utils/operation_stats.ts";
import { exitWithError } from "../utils/console_output.ts";
import { discoverMusic } from "../utils/fast_discovery.ts";
import { processAlbum } from "../lib/track_processor.ts";

/**
 * Enhanced easy mode using the Folder API for better performance
 */
export async function easyCommand(
  options: CommandOptions,
  library: string,
): Promise<void> {
  if (!options.apiKey) {
    exitWithError(
      "Error: --api-key is required for AcoustID lookups in easy mode.",
    );
  }

  const fpcalcPath = getVendorBinaryPath("fpcalc");
  const rsgainPath = getVendorBinaryPath("rsgain");

  await ensureCommandExists(fpcalcPath);
  await ensureCommandExists(rsgainPath);

  const stats = new OperationStats();

  if (!options.quiet) {
    console.log("🎵 Analyzing music library structure...\n");
  }

  // Use fast discovery with folder-based grouping
  const discovery = await discoverMusic([library], {
    onProgress: (phase, current) => {
      if (!options.quiet) {
        Deno.stdout.writeSync(
          new TextEncoder().encode(
            `\x1b[2K\r→ ${phase}: ${current} files`,
          ),
        );
      }
    },
  });

  if (!options.quiet) {
    // Clear progress line and show results
    Deno.stdout.writeSync(
      new TextEncoder().encode(`\x1b[2K\r`),
    );
    console.log(
      `✅ Found ${discovery.albums.size} albums to process\n`,
    );
  }

  if (discovery.singles.length > 0 && !options.quiet) {
    console.warn(
      `⚠️  Found ${discovery.singles.length} single files not in album folders. ` +
        `These will be skipped in easy mode.\n`,
    );
  }

  // Process each album using unified track processor
  for (const [albumDir, files] of discovery.albums) {
    if (!options.quiet) {
      console.log(`\n📁 Processing album: ${albumDir}`);
      console.log(`  Files: ${files.length}`);
    }

    // Use unified track processor for album
    const results = await processAlbum(albumDir, files, {
      calculateGain: true, // Always calculate ReplayGain in easy mode
      processAcoustID: true, // Always process AcoustID in easy mode
      acoustIDApiKey: options.apiKey,
      forceAcoustID: options.force,
      processSoundCheck: true, // Always generate SoundCheck in easy mode
      forceSoundCheck: options.force,
      quiet: options.quiet,
      dryRun: options.dryRun,
      concurrency: 4,
      onProgress: (processed, total) => {
        if (!options.quiet) {
          Deno.stdout.writeSync(
            new TextEncoder().encode(
              `\x1b[2K\r  Progress: ${processed}/${total} tracks`,
            ),
          );
        }
      },
    });

    if (!options.quiet) {
      console.log(""); // New line after progress
    }

    // Update stats from results
    for (const result of results) {
      if (result.acoustIDStatus) {
        stats.increment(result.acoustIDStatus);
      } else if (result.acoustIDError || result.replayGainError) {
        stats.incrementFailed();
      } else {
        stats.increment("processed");
      }
    }
  }

  stats.printSummary("Easy Mode Complete", EASY_MODE_SUMMARY, options.dryRun);

  // Optional: Show library statistics
  if (!options.quiet) {
    console.log("\n📊 Library Statistics:");
    console.log(`  Total albums: ${discovery.albums.size}`);
    console.log(`  Total tracks: ${discovery.totalFiles}`);

    if (discovery.singles.length > 0) {
      console.log(`  Skipped singles: ${discovery.singles.length}`);
    }
  }
}
