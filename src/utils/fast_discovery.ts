import { basename, dirname, extname } from "@std/path";
import {
  AUDIO_EXTENSIONS,
  listAudioFilesRecursive,
} from "../lib/fastest_audio_scan_recursive.ts";
import { normalizeForMatching } from "./normalize.ts";
import {
  type AlbumGroup,
  groupTracksByAlbum,
  type OnAmbiguousCallback,
  readTrackMetadata,
} from "./album_grouping.ts";

/**
 * Result of music discovery
 */
export interface MusicDiscovery {
  /** Map of album directories to their audio files */
  albums: Map<string, string[]>;
  /** Map of compilation directories to their audio files */
  compilations: Map<string, string[]>;
  /** Individual files to process as singles */
  singles: string[];
  /** Total number of files found */
  totalFiles: number;
  /** Files to encode (excludes AAC when forEncoding=true) */
  filesToEncode?: string[];
  /** Files skipped due to being AAC (when forEncoding=true) */
  skippedFiles?: SkippedFile[];
  /** Raw scan data for further processing */
  scan: ScanResult;
  /** Metadata-based album groups (only populated when useMetadataGrouping is true) */
  albumGroups?: AlbumGroup[];
}

export interface SkippedFile {
  path: string;
  reason: "aac" | "already-encoded" | "error";
  codec?: string;
  encodedPath?: string;
}

/**
 * Options for discovery
 */
export interface DiscoveryOptions {
  /** Progress callback */
  onProgress?: (
    phase:
      | "scan"
      | "classify"
      | "validate"
      | "metadata-grouping",
    current: number,
    total?: number,
  ) => void;
  /** Patterns to treat as singles directories */
  singlePatterns?: string[];
  /** Whether this discovery is for encoding (triggers MPEG-4 validation) */
  forEncoding?: boolean;
  /** Force encoding even if lossy version exists */
  forceEncode?: boolean;
  /** Number of parallel workers for validation */
  parallelism?: number;
  /** Enable debug output */
  debug?: boolean;
  /** Use metadata-based album grouping instead of directory-structure heuristics */
  useMetadataGrouping?: boolean;
  /** Callback for ambiguous album grouping decisions (e.g. disc merge with absent metadata) */
  onAmbiguous?: OnAmbiguousCallback;
}

/**
 * Internal scan result
 */
export interface ScanResult {
  /** Files grouped by immediate parent directory */
  filesByDir: Map<string, string[]>;
  /** Directory metadata for classification */
  dirInfo: Map<string, DirInfo>;
  /** All discovered files */
  allFiles: string[];
}

/**
 * Directory information for classification
 */
interface DirInfo {
  path: string;
  parent: string | null;
  hasSubdirs: boolean;
  fileCount: number;
  depth: number;
}

/**
 * Build scan result from audio files
 */
export function buildScanResult(
  allFiles: string[],
  options?: DiscoveryOptions,
): ScanResult {
  const filesByDir = new Map<string, string[]>();
  const dirInfo = new Map<string, DirInfo>();

  for (let i = 0; i < allFiles.length; i++) {
    const file = allFiles[i];
    const dir = file.substring(0, file.lastIndexOf("/")) || ".";

    if (!filesByDir.has(dir)) {
      filesByDir.set(dir, []);

      const parent = dir.substring(0, dir.lastIndexOf("/")) || null;
      const depth = dir.split("/").filter(Boolean).length;

      dirInfo.set(dir, {
        path: dir,
        parent,
        hasSubdirs: false,
        fileCount: 0,
        depth,
      });
    }

    filesByDir.get(dir)!.push(file);

    if (i % 50 === 0) {
      options?.onProgress?.("scan", i);
    }
  }

  for (const [dir, info] of dirInfo) {
    info.fileCount = filesByDir.get(dir)?.length || 0;

    for (const [otherDir] of filesByDir) {
      if (otherDir.startsWith(dir + "/") && otherDir !== dir) {
        info.hasSubdirs = true;
        break;
      }
    }
  }

  options?.onProgress?.("scan", allFiles.length, allFiles.length);

  return { filesByDir, dirInfo, allFiles };
}

/**
 * Classify directories into albums and singles based on structure
 */
export function classifyDirectories(
  scan: ScanResult,
  singlePatterns: string[] = [],
  debug?: boolean,
): { albums: Map<string, string[]>; singles: string[] } {
  const albums = new Map<string, string[]>();
  const singles: string[] = [];

  for (const [dir, files] of scan.filesByDir) {
    const info = scan.dirInfo.get(dir);

    let isSingles = false;
    let reason = "";

    if (files.length === 1) {
      isSingles = true;
      reason = "single file";
    } else if (matchesSinglePattern(dir, singlePatterns)) {
      isSingles = true;
      reason = "matches pattern";
    } else if (info?.parent && scan.filesByDir.has(info.parent)) {
      isSingles = true;
      reason = "parent has files";
    }

    if (debug && isSingles) {
      console.log(`[DEBUG] Classifying "${dir}" as singles (${reason})`);
    }

    if (isSingles) {
      singles.push(...files);
    } else {
      albums.set(dir, files);
      if (debug) {
        console.log(
          `[DEBUG] Classifying "${dir}" as album (${files.length} tracks)`,
        );
      }
    }
  }

  return { albums, singles };
}

/**
 * Check if a directory path matches single patterns
 */
function matchesSinglePattern(dir: string, patterns: string[]): boolean {
  const normalizedDir = dir.toLowerCase();

  if (
    normalizedDir.includes("/singles/") || normalizedDir.endsWith("/singles")
  ) {
    return true;
  }
  if (normalizedDir.includes("/misc/") || normalizedDir.endsWith("/misc")) {
    return true;
  }

  for (const pattern of patterns) {
    const normalizedPattern = pattern.toLowerCase();
    if (normalizedDir.includes(normalizedPattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Brand type for file paths to ensure type safety
 */
export type FilePath = string & { __brand: "FilePath" };
export type DirectoryPath = string & { __brand: "DirectoryPath" };

/**
 * Type guard to ensure string is a FilePath
 */
export function asFilePath(path: string): FilePath {
  return path as FilePath;
}

/**
 * Type guard to ensure string is a DirectoryPath
 */
export function asDirectoryPath(path: string): DirectoryPath {
  return path as DirectoryPath;
}

/**
 * Configuration for file map building
 */
interface FileMapConfig {
  files: FilePath[];
  debug?: boolean;
}

/**
 * Result of building file maps
 */
interface FileMaps {
  byBaseName: Map<string, FilePath[]>;
  mpeg4Files: FilePath[];
}

/**
 * Configuration for duplicate detection
 */
interface DuplicateDetectionConfig {
  files: FilePath[];
  fileMaps: FileMaps;
  aacFiles: Set<FilePath>;
  forceEncode?: boolean;
  debug?: boolean;
}

/**
 * Result of duplicate detection
 */
interface DuplicateDetectionResult {
  filesToEncode: FilePath[];
  skippedFiles: SkippedFile[];
}

/**
 * Build file maps for efficient lookup
 */
export function buildFileMaps(config: FileMapConfig): FileMaps {
  const { files, debug } = config;
  const byBaseName = new Map<string, FilePath[]>();
  const mpeg4Files: FilePath[] = [];

  for (const file of files) {
    const lower = file.toLowerCase();
    if (
      lower.endsWith(".m4a") || lower.endsWith(".mp4") ||
      lower.endsWith(".alac")
    ) {
      mpeg4Files.push(file);
    }

    const dir = file.substring(0, file.lastIndexOf("/"));
    const filename = file.substring(file.lastIndexOf("/") + 1);
    const extIndex = filename.lastIndexOf(".");

    if (extIndex > 0) {
      const baseName = dir + "/" + filename.substring(0, extIndex);
      if (!byBaseName.has(baseName)) {
        byBaseName.set(baseName, []);
      }
      byBaseName.get(baseName)!.push(file);
    }
  }

  if (debug) {
    console.log(
      `[DEBUG] Built file maps: ${byBaseName.size} unique base names, ${mpeg4Files.length} MPEG-4 files`,
    );
  }

  return { byBaseName, mpeg4Files };
}

/**
 * Detect files that have already been encoded
 */
export function detectAlreadyEncodedFiles(
  config: DuplicateDetectionConfig,
): DuplicateDetectionResult {
  const { files, fileMaps, aacFiles, forceEncode, debug } = config;
  const filesToEncode: FilePath[] = [];
  const skippedFiles: SkippedFile[] = [];

  const losslessFormats = new Set(["flac", "wav", "aiff", "ape", "wv"]);
  const lossyFormats = new Set(["mp3", "ogg", "opus", "wma"]);

  for (const file of files) {
    const ext = extname(file).slice(1).toLowerCase();

    if (aacFiles.has(file)) {
      continue;
    }

    if (losslessFormats.has(ext)) {
      const dir = file.substring(0, file.lastIndexOf("/"));
      const filename = file.substring(file.lastIndexOf("/") + 1);
      const extIndex = filename.lastIndexOf(".");
      const baseName = dir + "/" + filename.substring(0, extIndex);

      const relatedFiles = fileMaps.byBaseName.get(baseName) || [];
      let hasLossyVersion = false;
      let encodedPath = "";

      for (const related of relatedFiles) {
        if (related === file) continue;

        const relatedExt = extname(related).slice(1).toLowerCase();

        if (lossyFormats.has(relatedExt)) {
          hasLossyVersion = true;
          encodedPath = related;
          break;
        }

        if (
          (relatedExt === "m4a" || relatedExt === "mp4") &&
          aacFiles.has(related)
        ) {
          hasLossyVersion = true;
          encodedPath = related;
          break;
        }
      }

      if (hasLossyVersion && !forceEncode) {
        skippedFiles.push({
          path: file,
          reason: "already-encoded",
          encodedPath,
        });
        if (debug) {
          console.log(
            `[DEBUG] Skipping ${file}: already encoded as ${encodedPath}`,
          );
        }
      } else {
        filesToEncode.push(file);
      }
    } else if (ext === "m4a" || ext === "mp4") {
      if (!aacFiles.has(file)) {
        filesToEncode.push(file);
      }
    } else if (ext === "alac") {
      filesToEncode.push(file);
    } else if (!lossyFormats.has(ext)) {
      filesToEncode.push(file);
    }
  }

  return { filesToEncode, skippedFiles };
}

/**
 * Validate MPEG-4 files using file extensions
 * .alac files are considered lossless (ALAC)
 * .m4a/.mp4 files are considered lossy (AAC)
 * This is a performance optimization to avoid slow metadata reading
 */
export function validateMpeg4Files(
  mpeg4Files: FilePath[],
  _parallelism: number = 8,
  debug?: boolean,
): { aacSkipped: SkippedFile[]; aacFiles: Set<FilePath> } {
  const aacSkipped: SkippedFile[] = [];
  const aacFiles = new Set<FilePath>();

  if (mpeg4Files.length === 0) {
    return { aacSkipped, aacFiles };
  }

  if (debug) {
    console.log(
      `[DEBUG] Validating ${mpeg4Files.length} MPEG-4 files by extension`,
    );
  }

  for (const file of mpeg4Files) {
    const ext = extname(file).toLowerCase();

    if (ext === ".alac") {
      if (debug) {
        console.log(`[DEBUG] ${file} extension: .alac (ALAC/lossless)`);
      }
    } else if (ext === ".m4a" || ext === ".mp4") {
      aacSkipped.push({ path: file, reason: "aac", codec: "aac (assumed)" });
      aacFiles.add(file);
      if (debug) {
        console.log(`[DEBUG] ${file} extension: ${ext} (AAC/lossy assumed)`);
      }
    }
  }

  return { aacSkipped, aacFiles };
}

const DISC_PATTERN = /^(?:disc|cd|disk)\s*\d+$/i;

/**
 * Merge disc subfolders (Disc 1, CD2, disk 3, etc.) into their parent directories.
 * Operates on a map of directory path → file paths.
 */
export function mergeDiscSubfolders(
  filesByDir: Map<string, string[]>,
): Map<string, string[]> {
  const merged = new Map<string, string[]>();
  const discDirs = new Set<string>();

  for (const dir of filesByDir.keys()) {
    const folderName = basename(dir);
    if (DISC_PATTERN.test(folderName)) {
      discDirs.add(dir);
    }
  }

  for (const [dir, files] of filesByDir) {
    const target = discDirs.has(dir) ? dirname(dir) : dir;
    if (!merged.has(target)) merged.set(target, []);
    merged.get(target)!.push(...files);
  }

  return merged;
}

export type DiscGroupInput = Map<
  string,
  { albumName: string; files: string[] }
>;

export type ValidateDiscMergeResult = {
  merged: Array<{ parent: string; files: string[] }>;
  separate: Array<{ path: string; files: string[] }>;
};

/**
 * Validate disc subfolders by checking album metadata before merging.
 * Discs that share the same normalized album name are merged into their parent;
 * discs with differing album names (box sets) are kept separate.
 */
export function validateDiscMerge(
  discGroups: DiscGroupInput,
): ValidateDiscMergeResult {
  const byParent = new Map<
    string,
    Array<{ path: string; albumName: string; files: string[] }>
  >();

  for (const [path, { albumName, files }] of discGroups) {
    const parent = dirname(path);
    const existing = byParent.get(parent) ?? [];
    existing.push({ path, albumName, files });
    byParent.set(parent, existing);
  }

  const merged: Array<{ parent: string; files: string[] }> = [];
  const separate: Array<{ path: string; files: string[] }> = [];

  for (const [parent, discs] of byParent) {
    const normalizedNames = new Set(
      discs.map((d) => normalizeForMatching(d.albumName)),
    );

    if (normalizedNames.size === 1) {
      merged.push({ parent, files: discs.flatMap((d) => d.files) });
    } else {
      for (const disc of discs) {
        separate.push({ path: disc.path, files: disc.files });
      }
    }
  }

  return { merged, separate };
}

/**
 * Classify files using metadata-based album grouping.
 * Reads tags via taglib-wasm to group tracks by album name/artist,
 * with disc subfolder merging and compilation detection.
 *
 * Performance note: readTrackMetadata is currently sequential per file.
 * Batch/worker-pool optimization is a future improvement.
 */
async function classifyWithMetadata(
  scan: ScanResult,
  singlePatterns: string[],
  debug?: boolean,
  onAmbiguous?: OnAmbiguousCallback,
): Promise<{
  albums: Map<string, string[]>;
  compilations: Map<string, string[]>;
  singles: string[];
  albumGroups: AlbumGroup[];
}> {
  let filesByDir = new Map(scan.filesByDir);
  const albumNameOverrides = new Map<string, string>();

  // Step 1: Identify disc subfolders
  const discDirs = new Map<string, string[]>();
  const nonDiscDirs = new Map<string, string[]>();
  for (const [dir, files] of filesByDir) {
    if (DISC_PATTERN.test(basename(dir))) {
      discDirs.set(dir, files);
    } else {
      nonDiscDirs.set(dir, files);
    }
  }

  // Step 2: Validate disc merges using album metadata
  if (discDirs.size > 0) {
    const discGroupInput: DiscGroupInput = new Map();
    const dirsWithAbsentMetadata = new Set<string>();

    for (const [dir, files] of discDirs) {
      const sampleMetadata = await readTrackMetadata([files[0]]);
      const tagAlbumName = sampleMetadata[0]?.albumName;
      const dirBaseName = basename(dir);
      const metadataIsAbsent = !tagAlbumName || tagAlbumName === dirBaseName;
      const albumName = tagAlbumName ?? dirBaseName;
      if (metadataIsAbsent) {
        dirsWithAbsentMetadata.add(dir);
      }
      discGroupInput.set(dir, { albumName, files });
    }

    // Prompt for disc groups where ALL discs under a parent have absent metadata
    if (onAmbiguous && dirsWithAbsentMetadata.size > 0) {
      const byParent = new Map<string, string[]>();
      for (const dir of dirsWithAbsentMetadata) {
        const parent = dirname(dir);
        const existing = byParent.get(parent) ?? [];
        existing.push(dir);
        byParent.set(parent, existing);
      }

      for (const [parent, _dirs] of byParent) {
        const allDiscsUnderParent = [...discDirs.keys()].filter((d) =>
          dirname(d) === parent
        );
        const allAbsent = allDiscsUnderParent.every((d) =>
          dirsWithAbsentMetadata.has(d)
        );
        if (!allAbsent) continue;

        const discPaths = allDiscsUnderParent.flatMap((d) =>
          discDirs.get(d) ?? []
        );
        const answer = await onAmbiguous({
          type: "disc-merge-unknown",
          description: `Disc subfolders found under "${
            basename(parent)
          }" but album metadata is missing. Should they be merged as one album?`,
          paths: discPaths,
          options: [
            { label: "Merge as one album", value: "merge" },
            { label: "Keep as separate albums", value: "separate" },
          ],
        });

        if (answer === "merge") {
          const mergedAlbumName = basename(parent);
          for (const dir of allDiscsUnderParent) {
            const entry = discGroupInput.get(dir);
            if (entry) {
              discGroupInput.set(dir, {
                ...entry,
                albumName: mergedAlbumName,
              });
              for (const file of entry.files) {
                albumNameOverrides.set(file, mergedAlbumName);
              }
            }
          }
        } else {
          for (const dir of allDiscsUnderParent) {
            const entry = discGroupInput.get(dir);
            if (entry) {
              discGroupInput.delete(dir);
              nonDiscDirs.set(dir, entry.files);
            }
          }
        }
      }
    }

    const { merged, separate } = validateDiscMerge(discGroupInput);

    filesByDir = new Map(nonDiscDirs);
    for (const { parent, files } of merged) {
      const existing = filesByDir.get(parent) ?? [];
      filesByDir.set(parent, [...existing, ...files]);
    }
    for (const { path, files } of separate) {
      filesByDir.set(path, files);
    }

    if (debug) {
      console.log(
        `[DEBUG] Disc merge: ${merged.length} merged, ${separate.length} kept separate`,
      );
    }
  }

  // Step 3: Filter out singles directories before metadata reading
  const dirsToRead = new Map<string, string[]>();
  const singles: string[] = [];
  for (const [dir, files] of filesByDir) {
    if (matchesSinglePattern(dir, singlePatterns)) {
      singles.push(...files);
      if (debug) {
        console.log(
          `[DEBUG] Classifying "${dir}" as singles (matches pattern)`,
        );
      }
    } else {
      dirsToRead.set(dir, files);
    }
  }

  // Step 4: Read metadata for all remaining files
  const allFilesToRead = [...dirsToRead.values()].flat();
  const trackMetadata = await readTrackMetadata(allFilesToRead);

  // Apply album name overrides from user-confirmed disc merges
  for (const track of trackMetadata) {
    const override = albumNameOverrides.get(track.path);
    if (override) {
      track.albumName = override;
    }
  }

  // Step 5: Group tracks by album metadata
  const { albums: albumGroups, singles: metadataSingles } = groupTracksByAlbum(
    trackMetadata,
  );
  singles.push(...metadataSingles);

  // Step 6: Populate Maps for backward compatibility
  // Key albums by their common directory (or the album name if files span dirs)
  const albums = new Map<string, string[]>();
  const compilations = new Map<string, string[]>();

  for (const group of albumGroups) {
    const commonDir = findCommonDirectory(group.files);
    const key = commonDir ?? group.albumName;
    if (group.isCompilation) {
      compilations.set(key, group.files);
    } else {
      albums.set(key, group.files);
    }
  }

  if (debug) {
    console.log(
      `[DEBUG] Metadata grouping: ${albums.size} albums, ${compilations.size} compilations, ${singles.length} singles`,
    );
  }

  return { albums, compilations, singles, albumGroups };
}

function findCommonDirectory(files: string[]): string | null {
  if (files.length === 0) return null;
  const dirs = [...new Set(files.map((f) => dirname(f)))];
  if (dirs.length === 1) return dirs[0];
  const sorted = dirs.sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  let i = 0;
  while (i < first.length && first[i] === last[i]) i++;
  let prefix: string;
  if (i === first.length && (i === last.length || last[i] === "/")) {
    prefix = first;
  } else {
    prefix = first.substring(0, first.lastIndexOf("/", i));
  }
  return prefix || null;
}

/**
 * Discover music files, classify into albums/singles, and optionally validate for encoding
 */
export async function discoverMusic(
  paths: string[],
  options?: DiscoveryOptions,
): Promise<MusicDiscovery> {
  const debug = options?.debug;

  if (debug) {
    console.log(`[DEBUG] Starting discovery for: ${paths.join(", ")}`);
    console.log(
      `[DEBUG] Options: forEncoding=${options.forEncoding}, parallelism=${options.parallelism}`,
    );
  }

  // Phase 1: Fast FS scan
  // Separate individual files from directories since listAudioFilesRecursive only handles directories
  const directories: string[] = [];
  const individualFiles: string[] = [];
  for (const path of paths) {
    try {
      if (Deno.statSync(path).isFile) {
        if (AUDIO_EXTENSIONS.has(extname(path).toLowerCase())) {
          individualFiles.push(path);
        }
      } else {
        directories.push(path);
      }
    } catch (error) {
      console.error(
        `Skipping inaccessible path "${path}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const scannedFiles = directories.length > 0
    ? listAudioFilesRecursive(directories)
    : [];
  const allFiles = [...scannedFiles, ...individualFiles];
  const scan = buildScanResult(allFiles, options);

  if (debug) {
    console.log(
      `[DEBUG] Scan complete: ${scan.allFiles.length} files in ${scan.filesByDir.size} directories`,
    );
  }

  // Phase 2: Classify directories
  let albums: Map<string, string[]>;
  let compilations: Map<string, string[]>;
  let singles: string[];
  let albumGroups: AlbumGroup[] | undefined;

  if (options?.useMetadataGrouping) {
    options?.onProgress?.("metadata-grouping", 0);
    const classified = await classifyWithMetadata(
      scan,
      options?.singlePatterns ?? [],
      debug,
      options?.onAmbiguous,
    );
    albums = classified.albums;
    compilations = classified.compilations;
    singles = classified.singles;
    albumGroups = classified.albumGroups;
    options?.onProgress?.(
      "metadata-grouping",
      scan.allFiles.length,
      scan.allFiles.length,
    );
  } else {
    options?.onProgress?.("classify", 0);
    const classified = classifyDirectories(
      scan,
      options?.singlePatterns,
      debug,
    );
    albums = classified.albums;
    compilations = new Map<string, string[]>();
    singles = classified.singles;
    options?.onProgress?.("classify", 1, 1);
  }

  if (debug) {
    console.log(
      `[DEBUG] Classification: ${albums.size} albums, ${compilations.size} compilations, ${singles.length} singles`,
    );
  }

  const result: MusicDiscovery = {
    albums,
    compilations,
    singles,
    totalFiles: scan.allFiles.length,
    scan,
    albumGroups,
  };

  // Phase 3: For encoding, detect compilations and validate files
  if (options?.forEncoding) {
    options?.onProgress?.("validate", 0);

    const filePaths = scan.allFiles.map(asFilePath);
    const fileMaps = buildFileMaps({ files: filePaths, debug });

    const { aacSkipped, aacFiles } = validateMpeg4Files(
      fileMaps.mpeg4Files,
      options?.parallelism,
      debug,
    );

    const { filesToEncode, skippedFiles: alreadyEncoded } =
      detectAlreadyEncodedFiles({
        files: filePaths,
        fileMaps,
        aacFiles,
        forceEncode: options?.forceEncode,
        debug,
      });

    result.filesToEncode = filesToEncode;
    result.skippedFiles = [...aacSkipped, ...alreadyEncoded];

    if (debug) {
      console.log(
        `[DEBUG] Validation complete: ${result.skippedFiles.length} files skipped`,
      );
    }

    options?.onProgress?.("validate", 1, 1);
  }

  return result;
}
