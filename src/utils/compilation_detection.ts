import { normalizeForMatching } from "./normalize.ts";

/**
 * Album metadata for compilation detection
 */
export interface AlbumMetadata {
  albumArtist?: string;
  compilationFlag?: string | number | boolean;
  uniqueArtists: Set<string>;
}

/**
 * Determines if an album is a compilation based on metadata
 *
 * Detection logic:
 * 1. Album artist is "Various Artists" (normalized)
 * 2. Compilation flag is set to "1", 1, or true
 * 3. Fallback: 3 or more different artists
 */
export function isCompilationAlbum(metadata: AlbumMetadata): boolean {
  // Check for "Various Artists" album artist
  if (metadata.albumArtist) {
    const normalizedAlbumArtist = normalizeForMatching(metadata.albumArtist);
    if (normalizedAlbumArtist === "various artists") {
      return true;
    }
  }

  // Check for compilation flag
  const { compilationFlag } = metadata;
  if (
    compilationFlag === "1" ||
    compilationFlag === 1 ||
    compilationFlag === true
  ) {
    return true;
  }

  // Fallback: 3 or more different artists
  return metadata.uniqueArtists.size >= 3;
}

/**
 * Extract metadata from a single file for compilation detection
 */
export interface FileMetadata {
  artist?: string;
  albumArtist?: string;
  compilationFlag?: string | number | boolean;
}

/**
 * Aggregate metadata from multiple files to determine album metadata
 */
export function aggregateAlbumMetadata(
  fileMetadataList: FileMetadata[],
): AlbumMetadata {
  const uniqueArtists = new Set<string>();
  let albumArtist: string | undefined;
  let compilationFlag: string | number | boolean | undefined;

  for (const fileMeta of fileMetadataList) {
    // Collect unique artists
    if (fileMeta.artist) {
      uniqueArtists.add(normalizeForMatching(fileMeta.artist));
    }

    // Take the first non-empty album artist
    if (!albumArtist && fileMeta.albumArtist) {
      albumArtist = fileMeta.albumArtist;
    }

    // Take the first compilation flag that indicates true
    if (!compilationFlag && fileMeta.compilationFlag) {
      compilationFlag = fileMeta.compilationFlag;
    }
  }

  return {
    albumArtist,
    compilationFlag,
    uniqueArtists,
  };
}
