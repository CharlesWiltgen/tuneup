import { ProcessingStats } from "../utils/processing_stats.ts";
import {
  batchProcessTracks,
  processAlbum,
  TrackProcessorPool,
} from "../lib/track_processor.ts";
import { discoverMusic } from "../utils/fast_discovery.ts";
import { getAlbumDisplayName } from "../lib/folder_processor.ts";
import type { CommandOptions } from "../types/command.ts";

export interface ProcessCommandOptions extends CommandOptions {
  // Encoding options
  encode?: boolean;
  forceLossyTranscodes?: boolean;
  outputDir?: string;
  flattenOutput?: boolean;

  // Processing options
  replayGain?: boolean;
  acoustID?: boolean;

  // Folder processing
  singles?: string[]; // Folders to treat as singles
}

/**
 * Unified processing command that can handle encoding, ReplayGain, and AcoustID
 * in a single pass per track
 */
export async function processCommand(
  options: ProcessCommandOptions,
  ...paths: string[]
): Promise<void> {
  // Hide cursor for progress display
  if (!options.quiet) {
    Deno.stdout.writeSync(new TextEncoder().encode("\x1b[?25l"));
  }

  try {
    const stats = new ProcessingStats();

    // Discover music files
    if (!options.quiet) {
      console.log("🎵 Discovering music files...\n");
    }

    const discovery = await discoverMusic(paths, {
      singlePatterns: options.singles || [],
      forEncoding: options.encode, // Validate MPEG-4 codecs if encoding
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
      // Clear progress line
      Deno.stdout.writeSync(
        new TextEncoder().encode(`\x1b[2K\r`),
      );
      console.log(
        `📊 Found ${discovery.albums.size} albums and ${discovery.singles.length} singles\n`,
      );

      // Report skipped files if encoding
      if (
        options.encode && discovery.skippedFiles &&
        discovery.skippedFiles.length > 0
      ) {
        console.log(
          `⏭️  Skipping ${discovery.skippedFiles.length} files already in AAC format\n`,
        );
      }
    }

    // Determine what operations to perform
    const operations: string[] = [];
    if (options.encode) operations.push("encoding");
    if (options.replayGain) operations.push("ReplayGain");
    if (options.acoustID) operations.push("AcoustID");

    if (operations.length === 0) {
      console.error(
        "Error: No operations specified. Use --encode, --replay-gain, or --acoust-id",
      );
      return;
    }

    if (!options.quiet) {
      console.log(`Operations: ${operations.join(", ")}\n`);
    }

    // If encoding, we need to filter files
    let albumsToProcess = discovery.albums;
    let singlesToProcess = discovery.singles;

    if (options.encode && discovery.filesToEncode) {
      // Rebuild albums and singles with only encodable files
      const encodableSet = new Set(discovery.filesToEncode);
      albumsToProcess = new Map();

      for (const [dir, files] of discovery.albums) {
        const encodableFiles = files.filter((f) => encodableSet.has(f));
        if (encodableFiles.length > 0) {
          albumsToProcess.set(dir, encodableFiles);
        }
      }

      singlesToProcess = discovery.singles.filter((f) => encodableSet.has(f));
    }

    // Process albums
    if (albumsToProcess.size > 0) {
      if (!options.quiet) {
        console.log("🎼 Processing albums...\n");
      }

      for (const [albumDir, albumFiles] of albumsToProcess) {
        if (!options.quiet) {
          const albumName = getAlbumDisplayName(albumDir);
          console.log(`\n💿 Processing album: ${albumName}`);
          console.log(`   Path: ${albumDir}`);
          console.log(`   Tracks: ${albumFiles.length}`);
        }

        const results = await processAlbum(albumDir, albumFiles, {
          encode: options.encode,
          forceLossyTranscodes: options.forceLossyTranscodes,
          outputDirectory: options.outputDir,
          preserveStructure: !options.flattenOutput,
          basePath: paths[0], // Use first path as base for structure preservation
          calculateGain: options.replayGain,
          processAcoustID: options.acoustID,
          acoustIDApiKey: options.apiKey,
          forceAcoustID: options.force,
          quiet: options.quiet,
          dryRun: options.dryRun,
          concurrency: 4,
          onProgress: (processed, total) => {
            if (!options.quiet) {
              Deno.stdout.writeSync(
                new TextEncoder().encode(
                  `\x1b[2K\r   Progress: ${processed}/${total} tracks`,
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
    }

    // Process singles
    if (singlesToProcess.length > 0) {
      if (!options.quiet) {
        console.log("\n🎵 Processing singles...\n");
      }

      const pool = new TrackProcessorPool(4);

      const results = await batchProcessTracks(singlesToProcess, {
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

    stats.printSummary("Processing Complete", options.dryRun);
  } finally {
    // Show cursor
    if (!options.quiet) {
      Deno.stdout.writeSync(new TextEncoder().encode("\x1b[?25h"));
    }
  }
}
