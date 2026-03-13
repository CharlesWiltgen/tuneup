import { extname } from "@std/path";
import {
  AUDIO_EXTENSIONS,
  listAudioFilesRecursive,
} from "../lib/fastest_audio_scan_recursive.ts";
import { detectCompilationsRefactored } from "./detect_compilations_refactored.ts";

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
    phase: "scan" | "classify" | "validate" | "compilation-detection",
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
  /** Skip compilation detection (for performance when not needed) */
  skipCompilationDetection?: boolean;
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
 * Performance optimization constants for compilation detection
 */
const MAX_FILES_FOR_SMALL_COLLECTION = 10;

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
  options?.onProgress?.("classify", 0);
  const { albums, singles } = classifyDirectories(
    scan,
    options?.singlePatterns,
    debug,
  );
  options?.onProgress?.("classify", 1, 1);

  if (debug) {
    console.log(
      `[DEBUG] Classification: ${albums.size} albums, ${singles.length} singles`,
    );
  }

  const result: MusicDiscovery = {
    albums,
    compilations: new Map<string, string[]>(),
    singles,
    totalFiles: scan.allFiles.length,
    scan,
  };

  // Phase 3: For encoding, detect compilations and validate files
  if (options?.forEncoding) {
    options?.onProgress?.("validate", 0);

    const filePaths = scan.allFiles.map(asFilePath);
    const fileMaps = buildFileMaps({ files: filePaths, debug });

    const shouldDetectCompilations = !options?.skipCompilationDetection &&
      (fileMaps.mpeg4Files.length > 0 ||
        (albums.size === 1 &&
          scan.allFiles.length <= MAX_FILES_FOR_SMALL_COLLECTION));

    if (shouldDetectCompilations && albums.size > 0) {
      options?.onProgress?.("compilation-detection", 0, albums.size);

      const { albums: regularAlbums, compilations } =
        await detectCompilationsRefactored(
          albums,
          debug,
        );
      result.albums = regularAlbums;
      result.compilations = compilations;

      if (debug && compilations.size > 0) {
        console.log(`[DEBUG] Detected ${compilations.size} compilations`);
      }

      options?.onProgress?.("compilation-detection", albums.size, albums.size);
    } else if (debug) {
      const reason = options?.skipCompilationDetection
        ? "explicitly skipped"
        : `no MPEG-4 files and ${albums.size} albums`;
      console.log(
        `[DEBUG] Skipping compilation detection (${reason})`,
      );
    }

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
