import {
  OperationStats,
  PROCESSING_SUMMARY,
} from "../utils/operation_stats.ts";
import { createInteractivePrompt } from "../utils/album_grouping.ts";
import { discoverMusic } from "../utils/fast_discovery.ts";
import type { CommandOptions } from "../types/command.ts";
import { processCollection } from "./process_collection.ts";
import { ProgressReporter } from "../utils/progress_reporter.ts";

export interface ProcessCommandOptions extends CommandOptions {
  // Encoding options
  encode?: boolean;
  forceLossyTranscodes?: boolean;
  outputDir?: string;
  // Processing options
  replayGain?: boolean;
  acoustID?: boolean;
  soundCheck?: boolean;

  // Folder processing
  singles?: string[][]; // Folders to treat as singles (collect mode)
}

/**
 * Unified processing command that can handle encoding, ReplayGain, and AcoustID
 * in a single pass per track
 */
export async function processCommand(
  options: ProcessCommandOptions,
  ...paths: string[]
): Promise<void> {
  const reporter = new ProgressReporter({ quiet: options.quiet ?? false });

  try {
    const stats = new OperationStats();

    if (!options.quiet) {
      console.log("🎵 Discovering music files...\n");
    }

    const discovery = await discoverMusic(paths, {
      useMetadataGrouping: true,
      singlePatterns: options.singles?.flat() || [],
      forEncoding: options.encode,
      onAmbiguous: createInteractivePrompt(options.quiet || false),
      onProgress: reporter.discoveryCallback(),
    });

    if (!options.quiet) {
      reporter.stopSpinner();
      console.log(
        `📊 Found ${discovery.albums.size} albums and ${discovery.singles.length} singles\n`,
      );

      if (
        options.encode && discovery.skippedFiles &&
        discovery.skippedFiles.length > 0
      ) {
        const alreadyEncoded = discovery.skippedFiles.filter((f) =>
          f.reason === "already-encoded"
        );
        if (alreadyEncoded.length > 0) {
          console.log(
            `🔄 Skipping ${alreadyEncoded.length} already-encoded files (use --force to re-encode/overwrite)\n`,
          );
        }
      }
    }

    // Determine what operations to perform
    const operations: string[] = [];
    if (options.encode) operations.push("encoding");
    if (options.replayGain) operations.push("ReplayGain");
    if (options.acoustID) operations.push("AcoustID");
    if (options.soundCheck) operations.push("SoundCheck");

    if (operations.length === 0) {
      console.error(
        "Error: No operations specified. Use --encode, --replay-gain, --acoust-id, or --soundcheck",
      );
      return;
    }

    if (!options.quiet) {
      console.log(`Operations: ${operations.join(", ")}\n`);
    }

    // If encoding, we need to filter files
    let albumsToProcess = discovery.albums;
    let compilationsToProcess = discovery.compilations;
    let singlesToProcess = discovery.singles;

    if (options.encode && discovery.filesToEncode) {
      // Rebuild albums, compilations and singles with only encodable files
      const encodableSet = new Set(discovery.filesToEncode);
      albumsToProcess = new Map();
      compilationsToProcess = new Map();

      for (const [dir, files] of discovery.albums) {
        const encodableFiles = files.filter((f) => encodableSet.has(f));
        if (encodableFiles.length > 0) {
          albumsToProcess.set(dir, encodableFiles);
        }
      }

      for (const [dir, files] of discovery.compilations) {
        const encodableFiles = files.filter((f) => encodableSet.has(f));
        if (encodableFiles.length > 0) {
          compilationsToProcess.set(dir, encodableFiles);
        }
      }

      singlesToProcess = discovery.singles.filter((f) => encodableSet.has(f));
    }

    // Process albums
    await processCollection({
      collection: albumsToProcess,
      type: "album",
      options,
      stats,
      paths,
      reporter,
    });

    // Process compilations
    await processCollection({
      collection: compilationsToProcess,
      type: "compilation",
      options,
      stats,
      paths,
      reporter,
    });

    // Process singles
    await processCollection({
      collection: singlesToProcess,
      type: "singles",
      options,
      stats,
      paths,
      reporter,
    });

    stats.printSummary(
      "Processing Complete",
      PROCESSING_SUMMARY,
      options.dryRun,
    );
  } finally {
    reporter.dispose();
  }
}
