import type { OperationStats } from "../utils/operation_stats.ts";
import { batchProcessTracks, processAlbum } from "../lib/track_processor.ts";
import { getAlbumDisplayName } from "../lib/folder_processor.ts";
import type { ProcessCommandOptions } from "./process.ts";
import { ProgressReporter } from "../utils/progress_reporter.ts";

export type CollectionType = "album" | "compilation" | "singles";

interface ProcessCollectionOptions {
  collection: Map<string, string[]> | string[];
  type: CollectionType;
  options: ProcessCommandOptions;
  stats: OperationStats;
  paths: string[];
  reporter?: ProgressReporter;
}

/**
 * Process a collection of music files (albums, compilations, or singles)
 */
export async function processCollection({
  collection,
  type,
  options,
  stats,
  paths,
  reporter: externalReporter,
}: ProcessCollectionOptions): Promise<void> {
  const isMap = collection instanceof Map;
  const isEmpty = isMap ? collection.size === 0 : collection.length === 0;

  if (isEmpty) {
    return;
  }

  const ownsReporter = !externalReporter;
  const reporter = externalReporter ??
    new ProgressReporter({ quiet: options.quiet ?? false });

  try {
    // Display collection header
    if (!options.quiet) {
      const emoji = type === "album"
        ? "🎼"
        : type === "compilation"
        ? "🎭"
        : "🎵";
      const label = type === "album"
        ? "albums"
        : type === "compilation"
        ? "compilations"
        : "singles";
      console.log(`\n${emoji} Processing ${label}...\n`);
    }

    if (isMap) {
      // Process albums or compilations
      for (const [dir, files] of collection) {
        if (!options.quiet) {
          const displayName = getAlbumDisplayName(dir);
          const prefix = type === "compilation"
            ? "💿 Processing compilation:"
            : "💿 Processing album:";
          console.log(`\n${prefix} ${displayName}`);
          console.log(`   Path: ${dir}`);
          console.log(`   Tracks: ${files.length}`);
        }

        const results = await processAlbum(dir, files, {
          calculateGain: options.replayGain,
          forceReplayGain: options.force,
          encode: options.encode,
          forceLossyTranscodes: options.forceLossyTranscodes,
          outputDirectory: options.outputDir,
          basePath: paths[0],
          processAcoustID: options.acoustID,
          acoustIDApiKey: options.apiKey,
          forceAcoustID: options.force,
          processSoundCheck: options.soundCheck,
          forceSoundCheck: options.force,
          quiet: options.quiet,
          dryRun: options.dryRun,
          concurrency: 4,
          onProgress: (processed, total, currentFile) => {
            const fileName = currentFile.substring(
              currentFile.lastIndexOf("/") + 1,
            );
            reporter.update(processed, total, `Processing track - ${fileName}`);
          },
        });

        if (!options.quiet) {
          console.log(""); // New line after progress
        }

        // Update stats
        for (const result of results) {
          if (result.encodingError) stats.incrementFailed();
          else if (result.acoustIDStatus) {
            stats.increment(result.acoustIDStatus);
          } else stats.increment("processed");
        }
      }
    } else {
      // Process singles
      const results = await batchProcessTracks(collection, {
        encode: options.encode,
        forceLossyTranscodes: options.forceLossyTranscodes,
        outputDirectory: options.outputDir,
        basePath: paths[0],
        calculateGain: false, // No album-level ReplayGain for singles
        processAcoustID: options.acoustID,
        acoustIDApiKey: options.apiKey,
        forceAcoustID: options.force,
        processSoundCheck: options.soundCheck,
        forceSoundCheck: options.force,
        quiet: options.quiet,
        dryRun: options.dryRun,
        concurrency: 4,
        onProgress: (processed, total, currentFile) => {
          const fileName = currentFile.substring(
            currentFile.lastIndexOf("/") + 1,
          );
          reporter.update(processed, total, `Processing single - ${fileName}`);
        },
      });

      if (!options.quiet) {
        console.log(""); // New line after progress
      }

      // Update stats
      for (const result of results) {
        if (result.encodingError) stats.incrementFailed();
        else if (result.acoustIDStatus) {
          stats.increment(result.acoustIDStatus);
        } else stats.increment("processed");
      }
    }
  } finally {
    if (ownsReporter) {
      reporter.dispose();
    }
  }
}
