import { extname } from "@std/path";
import {
  buildScanResult,
  classifyDirectories,
  type DiscoveryOptions,
  type MusicDiscovery,
  type SkippedFile,
} from "./fast_discovery.ts";
import {
  AUDIO_EXTENSIONS,
  listAudioFilesRecursive,
} from "../lib/fastest_audio_scan_recursive.ts";
import { detectCompilationsRefactored } from "./detect_compilations_refactored.ts";

// Re-export SkippedFile for external use
export type { SkippedFile } from "./fast_discovery.ts";

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
 * Extracts the file map building logic from discoverMusic
 */
export function buildFileMaps(config: FileMapConfig): FileMaps {
  const { files, debug } = config;
  const byBaseName = new Map<string, FilePath[]>();
  const mpeg4Files: FilePath[] = [];

  for (const file of files) {
    // Extract MPEG-4 files (.m4a, .mp4, .alac)
    const lower = file.toLowerCase();
    if (
      lower.endsWith(".m4a") || lower.endsWith(".mp4") ||
      lower.endsWith(".alac")
    ) {
      mpeg4Files.push(file);
    }

    // Build base name map
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
 * Extracts the duplicate detection logic from discoverMusic
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

    // Check if already marked as AAC
    if (aacFiles.has(file)) {
      continue; // Already in skippedFiles from AAC check
    }

    if (losslessFormats.has(ext)) {
      // Check for existing lossy version
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

        // Check if it's a lossy format
        if (lossyFormats.has(relatedExt)) {
          hasLossyVersion = true;
          encodedPath = related;
          break;
        }

        // Check if it's an AAC M4A file
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
      // M4A/MP4 files assumed to be AAC (lossy) - skip unless forced
      if (!aacFiles.has(file)) {
        filesToEncode.push(file);
      }
    } else if (ext === "alac") {
      // ALAC files are lossless and should be encodable
      filesToEncode.push(file);
    } else if (!lossyFormats.has(ext)) {
      // Other formats that might be encodable
      filesToEncode.push(file);
    }
    // Skip lossy formats (mp3, ogg, etc) - they won't be encoded
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

  // Use file extension to determine codec
  // .alac = ALAC (lossless, not skipped)
  // .m4a/.mp4 = AAC (lossy, skipped)
  for (const file of mpeg4Files) {
    const ext = extname(file).toLowerCase();

    if (ext === ".alac") {
      // ALAC files are lossless, don't skip
      if (debug) {
        console.log(`[DEBUG] ${file} extension: .alac (ALAC/lossless)`);
      }
    } else if (ext === ".m4a" || ext === ".mp4") {
      // M4A/MP4 files are assumed to be AAC (lossy)
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
 * Main discovery function refactored to use smaller functions
 */
export async function discoverMusicRefactored(
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
    } catch {
      // Skip paths that don't exist
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

    // Build file maps once (performance optimization)
    const filePaths = scan.allFiles.map(asFilePath);
    const fileMaps = buildFileMaps({ files: filePaths, debug });

    // Skip compilation detection if explicitly requested or no MPEG-4 files
    // This is a performance optimization since compilation detection reads metadata
    // which is slow (~10s per file). We only need compilation detection for organizing
    // encoded output, so if there are no M4A files to validate, we can skip it.
    // Exception: Always detect for single small albums (quick to check 3 files)
    const shouldDetectCompilations = !options?.skipCompilationDetection &&
      (fileMaps.mpeg4Files.length > 0 ||
        (albums.size === 1 &&
          scan.allFiles.length <= MAX_FILES_FOR_SMALL_COLLECTION));

    if (shouldDetectCompilations && albums.size > 0) {
      // Report compilation detection phase
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

    // Validate MPEG-4 files
    const { aacSkipped, aacFiles } = validateMpeg4Files(
      fileMaps.mpeg4Files,
      options?.parallelism,
      debug,
    );

    // Detect already encoded files
    const { filesToEncode, skippedFiles: alreadyEncoded } =
      detectAlreadyEncodedFiles({
        files: filePaths,
        fileMaps,
        aacFiles,
        forceEncode: options?.forceEncode,
        debug,
      });

    // Combine results
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
