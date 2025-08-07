import { readMetadataBatch } from "jsr:@charlesw/taglib-wasm@0.5.4/simple";
import {
  aggregateAlbumMetadata,
  type FileMetadata,
  isCompilationAlbum,
} from "./compilation_detection.ts";

/**
 * Read metadata from audio files for compilation detection using batch API
 */
async function readFileMetadataForCompilation(
  files: string[],
  debug?: boolean,
): Promise<FileMetadata[]> {
  const metadata: FileMetadata[] = [];

  if (files.length === 0) {
    return metadata;
  }

  try {
    const results = await readMetadataBatch(files, {
      concurrency: 16,
      continueOnError: true,
    });

    for (let i = 0; i < results.results.length; i++) {
      const result = results.results[i];
      const file = files[i];

      if ("error" in result && result.error) {
        if (debug) {
          console.log(`[DEBUG] Error reading ${file}: ${result.error}`);
        }
        continue;
      }

      const tags = result.data?.tags;
      if (tags) {
        metadata.push({
          artist: tags.artist || undefined,
          // Note: albumArtist and compilation are not available in the simple API
          // These would require using the full TagLib API
          albumArtist: undefined,
          compilationFlag: undefined,
        });
      }
    }
  } catch (error) {
    if (debug) {
      console.error(`[DEBUG] Batch metadata read failed: ${error}`);
    }
  }

  return metadata;
}

/**
 * Detect compilation albums based on metadata
 * Refactored version using pure functions for business logic
 */
export async function detectCompilationsRefactored(
  albums: Map<string, string[]>,
  debug?: boolean,
): Promise<{
  albums: Map<string, string[]>;
  compilations: Map<string, string[]>;
}> {
  const regularAlbums = new Map<string, string[]>();
  const compilations = new Map<string, string[]>();

  for (const [dir, files] of albums) {
    // Read metadata for up to 3 files to determine if it's a compilation
    const samplesToCheck = Math.min(3, files.length);
    const sampleFiles = files.slice(0, samplesToCheck);

    // Separate I/O from logic
    const fileMetadataList = await readFileMetadataForCompilation(
      sampleFiles,
      debug,
    );

    // Use pure functions for compilation detection
    const albumMetadata = aggregateAlbumMetadata(fileMetadataList);
    const isCompilation = isCompilationAlbum(albumMetadata);

    if (debug && isCompilation) {
      const reason =
        albumMetadata.albumArtist?.toLowerCase().includes("various")
          ? `album artist: "${albumMetadata.albumArtist}"`
          : albumMetadata.compilationFlag
          ? `compilation flag: ${albumMetadata.compilationFlag}`
          : `${albumMetadata.uniqueArtists.size} different artists found`;

      console.log(`[DEBUG] ${dir} is a compilation (${reason})`);
    }

    if (isCompilation) {
      compilations.set(dir, files);
    } else {
      regularAlbums.set(dir, files);
    }
  }

  return { albums: regularAlbums, compilations };
}
