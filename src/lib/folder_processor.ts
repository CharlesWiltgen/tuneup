import { listAudioFilesRecursive } from "./fastest_audio_scan_recursive.ts";

export interface FolderProcessingResult {
  albums: Map<string, string[]>; // album path -> audio files
  singles: string[]; // individual audio files to process as singles
}

export interface FolderProcessingOptions {
  singlesPatterns?: string[]; // Folder patterns to treat as singles
  quiet?: boolean;
}

/**
 * Analyzes a folder structure and determines which folders are albums
 * and which files should be processed as singles
 */
export function analyzeFolderStructure(
  paths: string[],
  options: FolderProcessingOptions = {},
): FolderProcessingResult {
  const result: FolderProcessingResult = {
    albums: new Map(),
    singles: [],
  };

  const { singlesPatterns = [], quiet } = options;

  // Get all audio files at once using the fast scanner
  const allFiles = listAudioFilesRecursive(paths);

  // Group files by directory
  const filesByDir = new Map<string, string[]>();
  for (const file of allFiles) {
    const dir = file.substring(0, file.lastIndexOf("/")) || ".";
    if (!filesByDir.has(dir)) {
      filesByDir.set(dir, []);
    }
    filesByDir.get(dir)!.push(file);
  }

  // Build directory hierarchy info
  const dirHierarchy = new Map<string, Set<string>>();
  for (const dir of filesByDir.keys()) {
    const parent = dir.substring(0, dir.lastIndexOf("/")) || null;
    if (parent && parent !== dir) {
      if (!dirHierarchy.has(parent)) {
        dirHierarchy.set(parent, new Set());
      }
      dirHierarchy.get(parent)!.add(dir);
    }
  }

  // Process each directory
  for (const [dir, files] of filesByDir) {
    // Check if this directory should be treated as singles
    if (shouldTreatAsSingles(dir, singlesPatterns)) {
      result.singles.push(...files);
      if (!quiet) {
        console.log(
          `📂 Processing "${dir}" as singles (${files.length} files)`,
        );
      }
      continue;
    }

    // Check if this directory has subdirectories with files
    const hasSubdirsWithFiles = dirHierarchy.has(dir) &&
      Array.from(dirHierarchy.get(dir)!).some((subdir) =>
        filesByDir.has(subdir)
      );

    if (hasSubdirsWithFiles) {
      // This directory has subdirs with files - warn about files here
      if (files.length > 0 && !quiet) {
        console.warn(
          `⚠️  Found ${files.length} audio files in "${dir}" which also contains subfolders. ` +
            `These files will be ignored. Move them to a subfolder or use --singles to process them.`,
        );
      }
    } else {
      // This is a leaf directory with audio files - treat as album
      if (files.length > 0) {
        result.albums.set(dir, files);
        if (!quiet) {
          console.log(
            `💿 Found album: "${dir}" (${files.length} tracks)`,
          );
        }
      }
    }
  }

  return result;
}

/**
 * Check if a folder should be treated as singles based on patterns
 */
function shouldTreatAsSingles(
  folderPath: string,
  singlesPatterns: string[],
): boolean {
  if (singlesPatterns.length === 0) {
    return false;
  }

  // Normalize the folder path for comparison
  const normalizedPath = folderPath.replace(/\\/g, "/");

  for (const pattern of singlesPatterns) {
    const normalizedPattern = pattern.replace(/\\/g, "/");

    // Exact match
    if (normalizedPath === normalizedPattern) {
      return true;
    }

    // Ends with pattern (for matching folder names)
    if (
      normalizedPath.endsWith("/" + normalizedPattern) ||
      normalizedPath.endsWith(normalizedPattern)
    ) {
      return true;
    }

    // Contains pattern
    if (normalizedPath.includes(normalizedPattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Get a display name for an album folder
 */
export function getAlbumDisplayName(albumPath: string): string {
  const parts = albumPath.split("/");
  if (parts.length >= 2) {
    // Return "Artist/Album" format
    return parts.slice(-2).join("/");
  }
  return parts[parts.length - 1] || albumPath;
}
