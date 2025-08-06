import { basename, dirname, extname, join } from "jsr:@std/path";
import { normalizeForMatching } from "./normalize.ts";
import { readMetadataBatch } from "jsr:@charlesw/taglib-wasm@0.5.4/simple";

/** Supported audio file extensions */
export const SUPPORTED_EXTENSIONS = [
  "mp3",
  "flac",
  "ogg",
  "m4a",
  "wav",
];

/**
 * Result of the audio file discovery process
 */
export interface DiscoveryResult {
  /** All discovered audio files (sorted) */
  files: string[];
  /** Map of normalized album names to their file paths */
  albums: Map<string, string[]>;
  /** Files that are not part of any album */
  singles: string[];
  /** Map of file paths to their base names (without extension) */
  fileBaseMap: Map<string, string>;
  /** Map of directories to their contained files (for reference) */
  filesByDirectory: Map<string, string[]>;
  /** M4A/MP4 files that were skipped because they're already AAC encoded */
  skippedAacFiles: string[];
  /** Statistics about the discovery results */
  stats: {
    totalFiles: number;
    totalAlbums: number;
    totalSingles: number;
    skippedAacCount: number;
  };
}

/**
 * Options for the discovery process
 */
export interface DiscoveryOptions {
  /** Progress callback for tracking discovery phases */
  onProgress?: (phase: string, processed: number, total: number) => void;
  /** Whether to skip M4A/MP4 files that are already AAC encoded */
  skipAacFiles?: boolean;
}

/**
 * Internal type for file classification results
 */
interface FileClassification {
  albumGroups: Map<string, string[]>;
  singles: string[];
  skippedAacFiles: string[];
}

/**
 * Result of classifying a single file
 */
type FileClassificationResult =
  | { type: "error"; message: string }
  | { type: "skipped-aac"; filePath: string }
  | { type: "album-track"; filePath: string; albumKey: string }
  | { type: "single"; filePath: string };

// Import the actual types from taglib-wasm or use type inference
type BatchResult = Awaited<ReturnType<typeof readMetadataBatch>>;

/**
 * Recursively collects audio files from the given paths
 *
 * @param paths - Array of file or directory paths to scan
 * @param onProgress - Optional callback for progress updates
 * @returns Array of discovered audio file paths (sorted)
 *
 * @example
 * ```typescript
 * const files = await collectAudioFiles(["/music/albums", "/music/singles.mp3"]);
 * console.log(`Found ${files.length} audio files`);
 * ```
 */
export async function collectAudioFiles(
  paths: string[],
  onProgress?: (count: number) => void,
): Promise<string[]> {
  const filesToProcess: string[] = [];

  for (const fileOrDir of paths) {
    try {
      const info = await Deno.stat(fileOrDir);
      if (info.isDirectory) {
        const files = await collectAudioFilesFromDirectory(
          fileOrDir,
          (count) => {
            if (onProgress) onProgress(filesToProcess.length + count);
          },
        );
        filesToProcess.push(...files);
      } else if (info.isFile) {
        const ext = extname(fileOrDir).toLowerCase().slice(1);
        if (SUPPORTED_EXTENSIONS.includes(ext)) {
          filesToProcess.push(fileOrDir);
          if (onProgress) onProgress(filesToProcess.length);
        } else {
          console.error(
            `Warning: File "${fileOrDir}" has unsupported extension; skipping.`,
          );
        }
      }
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        console.error(`Error: Path "${fileOrDir}" not found; skipping.`);
      } else {
        console.error(
          `Warning: Path "${fileOrDir}" not found or inaccessible; skipping.`,
        );
      }
    }
  }

  return filesToProcess.sort();
}

/**
 * Recursively collects audio files from a directory
 *
 * @param dir - Directory path to scan
 * @param onProgress - Optional callback for progress updates
 * @returns Array of audio file paths found in the directory
 */
async function collectAudioFilesFromDirectory(
  dir: string,
  onProgress?: (count: number) => void,
): Promise<string[]> {
  const files: string[] = [];

  for await (const entry of Deno.readDir(dir)) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory) {
      const subFiles = await collectAudioFilesFromDirectory(
        fullPath,
        (count) => {
          if (onProgress) onProgress(files.length + count);
        },
      );
      files.push(...subFiles);
    } else if (entry.isFile) {
      const ext = extname(entry.name).toLowerCase().slice(1);
      if (SUPPORTED_EXTENSIONS.includes(ext)) {
        files.push(fullPath);
        if (onProgress) onProgress(files.length);
      }
    }
  }

  return files;
}

/**
 * Discovers audio files and classifies them into albums and singles based on metadata
 *
 * This function performs a two-pass approach:
 * 1. Discovery phase: Recursively finds all audio files
 * 2. Metadata phase: Reads metadata and classifies files by album
 *
 * Albums are identified as groups of 2+ files sharing the same album tag.
 * Files without album tags or single-file albums become singles.
 *
 * @param paths - Array of file or directory paths to process
 * @param options - Discovery options including progress callback and AAC skip flag
 * @returns Discovery result with classified files and statistics
 *
 * @example
 * ```typescript
 * const result = await discoverAudioFiles(["/music/library"], {
 *   onProgress: (phase, processed, total) => {
 *     console.log(`${phase}: ${processed}/${total}`);
 *   },
 *   skipAacFiles: true
 * });
 *
 * console.log(`Found ${result.stats.totalAlbums} albums and ${result.stats.totalSingles} singles`);
 * ```
 */
export async function discoverAudioFiles(
  paths: string[],
  options?: DiscoveryOptions,
): Promise<DiscoveryResult> {
  // Phase 1: Discovery
  const allFiles = await discoverFilesWithProgress(paths, options);

  // Phase 2: Organize files
  const { fileBaseMap, filesByDirectory } = organizeFiles(allFiles);

  // Phase 3: Read metadata
  const metadataMap = await readMetadataWithProgress(
    Array.from(allFiles),
    options,
  );

  // Phase 4: Classify files
  const classification = classifyFilesByMetadata(
    metadataMap,
    options?.skipAacFiles,
  );

  // Phase 5: Build result
  return buildDiscoveryResult(
    allFiles,
    fileBaseMap,
    filesByDirectory,
    classification,
  );
}

/**
 * Discovers files with progress reporting
 *
 * @param paths - Paths to scan for audio files
 * @param options - Discovery options
 * @returns Set of unique file paths
 */
async function discoverFilesWithProgress(
  paths: string[],
  options?: DiscoveryOptions,
): Promise<Set<string>> {
  if (options?.onProgress) {
    options.onProgress("discovery", 0, 0);
  }

  const allFiles = await collectAudioFiles(paths, (count) => {
    if (options?.onProgress) {
      options.onProgress("discovery", count, count);
    }
  });

  return new Set(allFiles); // Deduplication
}

/**
 * Organizes files into maps for efficient access
 *
 * @param files - Set of file paths to organize
 * @returns Maps for file base names and directory grouping
 */
function organizeFiles(files: Set<string>): {
  fileBaseMap: Map<string, string>;
  filesByDirectory: Map<string, string[]>;
} {
  const fileBaseMap = new Map<string, string>();
  const filesByDirectory = new Map<string, string[]>();

  for (const file of files) {
    // Build fileBaseMap
    const base = basename(file);
    const ext = extname(base);
    const nameWithoutExt = base.slice(0, base.length - ext.length);
    fileBaseMap.set(file, nameWithoutExt);

    // Group by directory
    const dir = dirname(file);
    if (!filesByDirectory.has(dir)) {
      filesByDirectory.set(dir, []);
    }
    filesByDirectory.get(dir)!.push(file);
  }

  return { fileBaseMap, filesByDirectory };
}

/**
 * Reads metadata for all files with progress reporting
 *
 * @param files - Array of file paths to read metadata from
 * @param options - Discovery options for progress callback
 * @returns Batch result containing metadata for all files
 */
async function readMetadataWithProgress(
  files: string[],
  options?: DiscoveryOptions,
): Promise<BatchResult> {
  if (options?.onProgress) {
    options.onProgress("metadata", 0, files.length);
  }

  return await readMetadataBatch(files, {
    concurrency: 8,
    continueOnError: true,
    onProgress: (processed, total) => {
      if (options?.onProgress) {
        options.onProgress("metadata", processed, total);
      }
    },
  });
}

/**
 * Classifies files into albums and singles based on metadata
 *
 * @param batchResult - Metadata read results for all files
 * @param skipAacFiles - Whether to skip AAC-encoded M4A/MP4 files
 * @returns Classification result with albums, singles, and skipped files
 */
function classifyFilesByMetadata(
  batchResult: BatchResult,
  skipAacFiles?: boolean,
): FileClassification {
  const albumGroups = new Map<string, string[]>();
  const singles: string[] = [];
  const skippedAacFiles: string[] = [];

  for (const result of batchResult.results) {
    const classification = classifySingleFile(result, skipAacFiles);

    switch (classification.type) {
      case "error":
        console.error(classification.message);
        break;
      case "skipped-aac":
        skippedAacFiles.push(classification.filePath);
        break;
      case "album-track":
        addToAlbumGroup(
          albumGroups,
          classification.albumKey,
          classification.filePath,
        );
        break;
      case "single":
        singles.push(classification.filePath);
        break;
    }
  }

  // Promote single-track albums to singles
  promoteSingleTrackAlbums(albumGroups, singles);

  return { albumGroups, singles, skippedAacFiles };
}

/**
 * Classifies a single file based on its metadata
 *
 * @param result - Metadata result for a single file
 * @param skipAacFiles - Whether to skip AAC files
 * @returns Classification result indicating file type
 */
function classifySingleFile(
  result: BatchResult["results"][0],
  skipAacFiles?: boolean,
): FileClassificationResult {
  // Handle errors
  if ("error" in result && result.error) {
    return {
      type: "error",
      message: `Error reading metadata for ${result.file}: ${result.error}`,
    };
  }

  const { file: filePath, data } = result;

  // Check AAC skip
  if (skipAacFiles && data && shouldSkipAacFile(filePath, data.properties)) {
    return { type: "skipped-aac", filePath };
  }

  // Classify by album
  // deno-lint-ignore no-explicit-any -- taglib-wasm returns untyped tags object
  const albumName = (data?.tags as any)?.album || "";
  if (albumName) {
    const albumKey = normalizeForMatching(albumName, {
      stripLeadingArticles: true,
      romanToArabic: true,
    });
    return { type: "album-track", filePath, albumKey };
  }

  return { type: "single", filePath };
}

/**
 * Checks if a file should be skipped as AAC
 *
 * @param filePath - Path to the file
 * @param properties - Audio properties from metadata
 * @returns True if file is AAC-encoded M4A/MP4
 */
function shouldSkipAacFile(
  filePath: string,
  // deno-lint-ignore no-explicit-any -- taglib-wasm properties type varies by format
  properties?: any,
): boolean {
  const isM4aOrMp4 = filePath.toLowerCase().endsWith(".m4a") ||
    filePath.toLowerCase().endsWith(".mp4");

  if (!isM4aOrMp4) return false;

  const codec = properties?.codec || "";
  return codec.toLowerCase().includes("aac");
}

/**
 * Adds a file to an album group
 *
 * @param albumGroups - Map of album groups
 * @param albumKey - Normalized album key
 * @param filePath - File path to add
 */
function addToAlbumGroup(
  albumGroups: Map<string, string[]>,
  albumKey: string,
  filePath: string,
): void {
  if (!albumGroups.has(albumKey)) {
    albumGroups.set(albumKey, []);
  }
  albumGroups.get(albumKey)!.push(filePath);
}

/**
 * Promotes albums with only one track to singles
 *
 * @param albumGroups - Map of album groups
 * @param singles - Array of singles to add promoted tracks to
 */
function promoteSingleTrackAlbums(
  albumGroups: Map<string, string[]>,
  singles: string[],
): void {
  for (const [albumName, files] of albumGroups.entries()) {
    if (files.length === 1) {
      singles.push(files[0]);
      albumGroups.delete(albumName);
    }
  }
}

/**
 * Builds the final discovery result
 *
 * @param allFiles - Set of all discovered files
 * @param fileBaseMap - Map of file paths to base names
 * @param filesByDirectory - Map of directories to files
 * @param classification - File classification result
 * @returns Complete discovery result with sorted data and statistics
 */
function buildDiscoveryResult(
  allFiles: Set<string>,
  fileBaseMap: Map<string, string>,
  filesByDirectory: Map<string, string[]>,
  classification: FileClassification,
): DiscoveryResult {
  // Sort files in albums and singles
  for (const files of classification.albumGroups.values()) {
    files.sort();
  }
  classification.singles.sort();

  return {
    files: Array.from(allFiles).sort(),
    albums: classification.albumGroups,
    singles: classification.singles,
    fileBaseMap,
    filesByDirectory,
    skippedAacFiles: classification.skippedAacFiles,
    stats: {
      totalFiles: allFiles.size - classification.skippedAacFiles.length,
      totalAlbums: classification.albumGroups.size,
      totalSingles: classification.singles.length,
      skippedAacCount: classification.skippedAacFiles.length,
    },
  };
}
