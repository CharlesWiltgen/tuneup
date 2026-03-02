import { PROPERTIES } from "@charlesw/taglib-wasm";
import { ensureTagLib } from "../lib/taglib_init.ts";
import {
  aggregateAlbumMetadata,
  type FileMetadata,
  isCompilationAlbum,
} from "./compilation_detection.ts";

async function readFileMetadataForCompilation(
  files: string[],
  debug?: boolean,
): Promise<FileMetadata[]> {
  const metadata: FileMetadata[] = [];

  if (files.length === 0) {
    return metadata;
  }

  const taglib = await ensureTagLib();

  for (const file of files) {
    try {
      using audioFile = await taglib.open(file);
      const tag = audioFile.tag();

      metadata.push({
        artist: tag.artist || undefined,
        albumArtist: audioFile.getProperty(PROPERTIES.albumArtist.key) ||
          undefined,
        compilationFlag: audioFile.getProperty(PROPERTIES.compilation.key) ||
          undefined,
      });
    } catch (error) {
      if (debug) {
        console.log(`[DEBUG] Error reading ${file}: ${error}`);
      }
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
