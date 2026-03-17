import { getVendorBinaryPath } from "../lib/vendor_tools.ts";
import type { CommandOptions } from "../types/command.ts";
import { ensureCommandExists } from "../utils/command.ts";
import { EASY_MODE_SUMMARY, OperationStats } from "../utils/operation_stats.ts";
import { exitWithError } from "../utils/console_output.ts";
import { createInteractivePrompt } from "../utils/album_grouping.ts";
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

  // Use metadata-based grouping for accurate album detection
  const discovery = await discoverMusic([library], {
    useMetadataGrouping: true,
    onAmbiguous: createInteractivePrompt(options.quiet || false),
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
  // Process both albums and compilations — both get album-level ReplayGain
  const allAlbums = new Map([
    ...discovery.albums,
    ...discovery.compilations,
  ]);

  for (const [albumDir, files] of allAlbums) {
    if (!options.quiet) {
      console.log(`\n📁 Processing album: ${albumDir}`);
      console.log(`  Files: ${files.length}`);
    }

    const results = await processAlbum(albumDir, files, {
      calculateGain: true,
      forceReplayGain: options.force,
      processAcoustID: true,
      acoustIDApiKey: options.apiKey,
      forceAcoustID: options.force,
      processSoundCheck: true,
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
