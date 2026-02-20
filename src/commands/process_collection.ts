import type { OperationStats } from "../utils/operation_stats.ts";
import {
  batchProcessTracks,
  processAlbum,
  TrackProcessorPool,
} from "../lib/track_processor.ts";
import { getAlbumDisplayName } from "../lib/folder_processor.ts";
import type { ProcessCommandOptions } from "./process.ts";

export type CollectionType = "album" | "compilation" | "singles";

interface ProcessCollectionOptions {
  collection: Map<string, string[]> | string[];
  type: CollectionType;
  options: ProcessCommandOptions;
  stats: OperationStats;
  paths: string[];
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
}: ProcessCollectionOptions): Promise<void> {
  const isMap = collection instanceof Map;
  const isEmpty = isMap ? collection.size === 0 : collection.length === 0;

  if (isEmpty) {
    return;
  }

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
        encode: options.encode,
        forceLossyTranscodes: options.forceLossyTranscodes,
        outputDirectory: options.outputDir,
        preserveStructure: !options.flattenOutput,
        basePath: paths[0], // Use first path as base for structure preservation
        processAcoustID: options.acoustID,
        acoustIDApiKey: options.apiKey,
        forceAcoustID: options.force,
        quiet: options.quiet,
        dryRun: options.dryRun,
        concurrency: 4,
        onProgress: (processed, total, currentFile) => {
          if (!options.quiet) {
            const fileName = currentFile.substring(
              currentFile.lastIndexOf("/") + 1,
            );
            Deno.stdout.writeSync(
              new TextEncoder().encode(
                `\x1b[2K\r→ Processing track: ${processed}/${total} - ${fileName}`,
              ),
            );
          }
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
    const pool = new TrackProcessorPool(4);

    const results = await batchProcessTracks(collection, {
      encode: options.encode,
      forceLossyTranscodes: options.forceLossyTranscodes,
      outputDirectory: options.outputDir,
      preserveStructure: !options.flattenOutput,
      basePath: paths[0], // Use first path as base for structure preservation
      calculateGain: false, // No album-level ReplayGain for singles
      processAcoustID: options.acoustID,
      acoustIDApiKey: options.apiKey,
      forceAcoustID: options.force,
      quiet: options.quiet,
      dryRun: options.dryRun,
      concurrency: 4,
      onProgress: (processed, total, currentFile) => {
        if (!options.quiet) {
          const fileName = currentFile.substring(
            currentFile.lastIndexOf("/") + 1,
          );
          Deno.stdout.writeSync(
            new TextEncoder().encode(
              `\x1b[2K\r→ Processing single: ${processed}/${total} - ${fileName}`,
            ),
          );
        }
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

    await pool.shutdown();
  }
}
