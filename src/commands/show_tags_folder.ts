import { readMetadataBatch } from "@charlesw/taglib-wasm/simple";
import { formatChannels, formatDuration } from "../utils/format.ts";
import { formatError } from "../utils/error_utils.ts";

/**
 * Format container format for display, adding descriptive names where appropriate
 */
export function formatContainerFormat(format: string): string {
  switch (format) {
    case "MP4":
      return "MP4 (ISOBMFF)";
    case "OGG":
      return "OGG";
    case "MP3":
      return "MP3";
    case "FLAC":
      return "FLAC";
    case "WAV":
      return "WAV (RIFF)";
    case "AIFF":
      return "AIFF";
    default:
      return format;
  }
}

/**
 * Format codec for display, adding descriptive names where appropriate
 */
export function formatCodec(codec: string): string {
  switch (codec) {
    case "AAC":
      return "AAC-LC";
    case "ALAC":
      return "Apple Lossless";
    case "MP3":
      return "MP3";
    case "FLAC":
      return "FLAC";
    case "Vorbis":
      return "Vorbis";
    case "Opus":
      return "Opus";
    case "PCM":
      return "PCM";
    case "IEEE Float":
      return "IEEE Float";
    default:
      return codec;
  }
}

interface FileMetadata {
  path: string;
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  track?: number;
  genre?: string;
  comment?: string;

  // Audio properties
  duration?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  format?: string;

  // Extended metadata
  replayGainTrackGain?: string;
  replayGainTrackPeak?: string;
  replayGainAlbumGain?: string;
  replayGainAlbumPeak?: string;
  acoustIdFingerprint?: string;
  acoustIdId?: string;
  hasCoverArt?: boolean;
  coverArtCount?: number;
}

// Extend the taglib-wasm tags type to include AcoustID fields
// In beta.12, string tag fields are string[] in batch/folder results
interface ExtendedTags {
  title?: string[];
  artist?: string[];
  album?: string[];
  year?: number;
  track?: number;
  genre?: string[];
  comment?: string[];
  acoustidFingerprint?: string[];
  acoustidId?: string[];
}

/**
 * Display tags using the new batch API for maximum performance
 */
export async function showTagsWithFolderAPI(
  filesToProcess: string[],
  quiet: boolean,
): Promise<void> {
  // Hide cursor
  if (!quiet) {
    Deno.stdout.writeSync(new TextEncoder().encode("\x1b[?25l"));
    Deno.stdout.writeSync(
      new TextEncoder().encode("→ Reading metadata: 0 files processed"),
    );
  }

  let lastCount = 0;

  try {
    // Use the enhanced batch API directly
    const batchResult = await readMetadataBatch(filesToProcess, {
      concurrency: 8,
      continueOnError: true,
      onProgress: (processed, total, _currentFile) => {
        if (!quiet && processed !== lastCount) {
          // Move cursor to beginning of line and clear it
          Deno.stdout.writeSync(
            new TextEncoder().encode(
              `\x1b[2K\r→ Reading metadata: ${processed}/${total} files processed`,
            ),
          );
          lastCount = processed;
        }
      },
    });

    if (!quiet) {
      // Update with final count and checkmark
      Deno.stdout.writeSync(
        new TextEncoder().encode(
          `\x1b[2K\r✅ Reading metadata: ${batchResult.items.length} files processed\n\n`,
        ),
      );
      // Show cursor
      Deno.stdout.writeSync(new TextEncoder().encode("\x1b[?25h"));
    }

    // Process and display results immediately
    let lastAlbum = "";
    let albumTrackCount = 0;

    for (let i = 0; i < batchResult.items.length; i++) {
      const result = batchResult.items[i];

      if (result.status === "error") {
        console.error(`Error reading ${result.path}: ${result.error}`);
        continue;
      }

      const { data } = result;
      const tags = data.tags as unknown as ExtendedTags | undefined;
      const metadata: FileMetadata = {
        path: result.path,
        title: tags?.title?.[0],
        artist: tags?.artist?.[0],
        album: tags?.album?.[0],
        year: tags?.year,
        track: tags?.track,
        genre: tags?.genre?.[0],
        comment: tags?.comment?.[0],
        duration: data.properties?.duration,
        bitrate: data.properties?.bitrate,
        sampleRate: data.properties?.sampleRate,
        channels: data.properties?.channels,
        format: result.path.substring(result.path.lastIndexOf(".") + 1)
          .toUpperCase(),
        // Extended tags from dynamics
        replayGainTrackGain: data.dynamics?.replayGainTrackGain,
        replayGainTrackPeak: data.dynamics?.replayGainTrackPeak,
        replayGainAlbumGain: data.dynamics?.replayGainAlbumGain,
        replayGainAlbumPeak: data.dynamics?.replayGainAlbumPeak,
        // AcoustID fields
        acoustIdFingerprint: tags?.acoustidFingerprint?.[0],
        acoustIdId: tags?.acoustidId?.[0],
        // Cover art is now available in batch API!
        hasCoverArt: data.hasCoverArt || false,
        coverArtCount: data.hasCoverArt ? 1 : 0, // API doesn't provide count
      };

      const currentAlbum = metadata.album || "Unknown Album";

      // Display album header if this is a new album
      if (currentAlbum !== lastAlbum) {
        if (lastAlbum !== "") {
          console.log(); // Add spacing between albums
        }

        // Count tracks in this album
        albumTrackCount = 1;
        for (let j = i + 1; j < batchResult.items.length; j++) {
          const nextResult = batchResult.items[j];
          if (
            nextResult.status === "ok" &&
            (nextResult.data.tags as unknown as ExtendedTags | undefined)
                ?.album?.[0] === currentAlbum
          ) {
            albumTrackCount++;
          } else {
            break;
          }
        }

        console.log(
          `💿 ${currentAlbum} - ${metadata.artist || "Unknown Artist"}${
            metadata.year ? ` (${metadata.year})` : ""
          } - ${albumTrackCount} track${albumTrackCount > 1 ? "s" : ""}`,
        );
        console.log("▔".repeat(80));
        lastAlbum = currentAlbum;
      }

      // Display track info
      console.log(`${metadata.title || "Unknown Title"}`);
      console.log(
        `🎵 Title                 ${metadata.title || "Unknown Title"}`,
      );
      console.log(
        `🎤 Artist                ${metadata.artist || "Unknown Artist"}`,
      );
      console.log(
        `📅 Year/Track/Genre      ${metadata.year || "?"} | ${
          metadata.track || "?"
        } | ${metadata.genre || "Unknown"}`,
      );
      // Display format, codec, and bitrate
      const containerFormat = data.properties?.containerFormat ||
        metadata.format || "?";
      const formattedContainer = formatContainerFormat(containerFormat);
      const codec = data.properties?.codec || "?";
      const formattedCodec = formatCodec(codec);
      const bitrate = metadata.bitrate || "?";

      console.log(
        `🎧 Format/Codec/Bitrate  ${formattedContainer} | ${formattedCodec} | ${bitrate} kbps`,
      );
      console.log(
        `⏱️ Duration              ${
          metadata.duration ? formatDuration(metadata.duration) : "Unknown"
        }`,
      );
      console.log(
        `📊 Sample Rate/Channels  ${metadata.sampleRate || "?"} Hz | ${
          formatChannels(metadata.channels)
        }`,
      );

      // Track dynamics
      if (
        metadata.replayGainTrackGain !== undefined ||
        metadata.replayGainTrackPeak !== undefined
      ) {
        console.log(
          `📈 Track Dynamics        Gain: ${
            metadata.replayGainTrackGain !== undefined
              ? metadata.replayGainTrackGain
              : "n/a"
          } | Peak: ${
            metadata.replayGainTrackPeak !== undefined
              ? metadata.replayGainTrackPeak
              : "n/a"
          }`,
        );
      } else {
        console.log(`📈 Track Dynamics        n/a`);
      }

      // Album dynamics
      if (
        metadata.replayGainAlbumGain !== undefined ||
        metadata.replayGainAlbumPeak !== undefined
      ) {
        console.log(
          `📈 Album Dynamics        Gain: ${
            metadata.replayGainAlbumGain !== undefined
              ? metadata.replayGainAlbumGain
              : "n/a"
          } | Peak: ${
            metadata.replayGainAlbumPeak !== undefined
              ? metadata.replayGainAlbumPeak
              : "n/a"
          }`,
        );
      } else {
        console.log(`📈 Album Dynamics        n/a`);
      }

      // Cover art
      console.log(
        `🖼️ Cover Art             ${metadata.hasCoverArt ? "Yes" : "No"}`,
      );

      // Add spacing between tracks
      console.log();
    }
  } catch (error) {
    if (!quiet) {
      // Show cursor on error
      Deno.stdout.writeSync(new TextEncoder().encode("\x1b[?25h"));
    }
    console.error(`Error: ${formatError(error)}`);
    throw error;
  }
}
