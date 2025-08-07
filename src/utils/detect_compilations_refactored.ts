import { ensureTagLib } from "../lib/taglib_init.ts";
import {
  aggregateAlbumMetadata,
  type FileMetadata,
  isCompilationAlbum,
} from "./compilation_detection.ts";

/**
 * Read metadata from audio files for compilation detection
 */
async function readFileMetadataForCompilation(
  files: string[],
  debug?: boolean,
): Promise<FileMetadata[]> {
  const taglib = await ensureTagLib();
  const metadata: FileMetadata[] = [];

  for (const file of files) {
    try {
      const fileData = await Deno.readFile(file);
      const tags = await taglib.open(fileData);

      try {
        const artist = tags.getProperty("ARTIST");
        const albumArtist = tags.getProperty("ALBUMARTIST");
        const compilationFlag = tags.getProperty("COMPILATION");

        metadata.push({
          artist,
          albumArtist,
          compilationFlag,
        });
      } finally {
        tags.dispose();
      }
    } catch (error) {
      if (debug) {
        console.log(`[DEBUG] Error reading ${file}: ${error}`);
      }
      // Continue with other files
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
