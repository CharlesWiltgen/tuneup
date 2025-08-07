// Removed unused imports (extname, join)
import { readMetadataBatch } from "jsr:@charlesw/taglib-wasm@0.5.4/simple";
import { listAudioFilesRecursive } from "../lib/fastest_audio_scan_recursive.ts";

// Using AUDIO_EXTENSIONS from fastest_audio_scan_recursive.ts
// Extensions include: .mp3, .flac, .ogg, .m4a, .wav, .aac, .opus, .wma

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
  encodedPath?: string; // Path to the existing encoded file
}

/**
 * Options for discovery
 */
export interface DiscoveryOptions {
  /** Progress callback */
  onProgress?: (
    phase: "scan" | "classify" | "validate",
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
}

/**
 * Internal scan result
 */
interface ScanResult {
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
 * Parallel directory scanner for maximum performance
 */
function parallelFileScan(
  roots: string[],
  options?: DiscoveryOptions,
): Promise<ScanResult> {
  const filesByDir = new Map<string, string[]>();
  const dirInfo = new Map<string, DirInfo>();

  // Use the synchronous scanner
  const allFiles = listAudioFilesRecursive(roots);

  // Group files by directory and build directory info
  for (let i = 0; i < allFiles.length; i++) {
    const file = allFiles[i];
    const dir = file.substring(0, file.lastIndexOf("/")) || ".";

    if (!filesByDir.has(dir)) {
      filesByDir.set(dir, []);

      // Calculate directory info
      const parent = dir.substring(0, dir.lastIndexOf("/")) || null;
      const depth = dir.split("/").filter(Boolean).length;

      dirInfo.set(dir, {
        path: dir,
        parent,
        hasSubdirs: false, // Will update later
        fileCount: 0,
        depth,
      });
    }

    filesByDir.get(dir)!.push(file);

    // Progress reporting
    if (i % 50 === 0) {
      options?.onProgress?.("scan", i);
    }
  }

  // Update directory info
  for (const [dir, info] of dirInfo) {
    info.fileCount = filesByDir.get(dir)?.length || 0;

    // Check if this dir has subdirs with files
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
function classifyDirectories(
  scan: ScanResult,
  singlePatterns: string[] = [],
  debug?: boolean,
): { albums: Map<string, string[]>; singles: string[] } {
  const albums = new Map<string, string[]>();
  const singles: string[] = [];

  for (const [dir, files] of scan.filesByDir) {
    const info = scan.dirInfo.get(dir);

    // Determine if this should be singles
    let isSingles = false;
    let reason = "";

    if (files.length === 1) {
      isSingles = true;
      reason = "single file";
    } else if (matchesSinglePattern(dir, singlePatterns)) {
      isSingles = true;
      reason = "matches pattern";
    } else if (info?.parent && scan.filesByDir.has(info.parent)) {
      // Parent directory also has files - likely a flat collection
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

  // Built-in patterns
  if (
    normalizedDir.includes("/singles/") || normalizedDir.endsWith("/singles")
  ) {
    return true;
  }
  if (normalizedDir.includes("/misc/") || normalizedDir.endsWith("/misc")) {
    return true;
  }

  // User patterns
  for (const pattern of patterns) {
    const normalizedPattern = pattern.toLowerCase();
    if (normalizedDir.includes(normalizedPattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Check MPEG-4 files for codec information in parallel
 */
export async function parallelCheckMpeg4Codecs(
  files: string[],
  parallelism: number = 8,
  debug?: boolean,
): Promise<{ aac: SkippedFile[]; lossless: string[] }> {
  const aac: SkippedFile[] = [];
  const lossless: string[] = [];

  if (files.length === 0) {
    return { aac, lossless };
  }

  if (debug) {
    console.log(`[DEBUG] Checking ${files.length} MPEG-4 files for codecs`);
  }

  try {
    const results = await readMetadataBatch(files, {
      concurrency: parallelism,
      continueOnError: true,
    });

    for (let i = 0; i < results.results.length; i++) {
      const result = results.results[i];
      const file = files[i];

      if ("error" in result && result.error) {
        aac.push({ path: file, reason: "error" });
        if (debug) {
          console.log(`[DEBUG] Error reading ${file}: ${result.error}`);
        }
        continue;
      }

      const properties = result.data?.properties;
      const codec = (properties?.codec || "").toLowerCase();

      if (debug) {
        console.log(`[DEBUG] ${file} codec: ${codec || "unknown"}`);
      }

      if (codec.includes("aac")) {
        aac.push({ path: file, reason: "aac", codec });
      } else if (codec.includes("alac") || codec.includes("apple lossless")) {
        lossless.push(file);
      } else {
        // Unknown or other codec - treat as encodable
        lossless.push(file);
      }
    }
  } catch (error) {
    if (debug) {
      console.error(`[DEBUG] Batch metadata read failed: ${error}`);
    }
    // On failure, treat all as encodable to be safe
    return { aac: [], lossless: files };
  }

  return { aac, lossless };
}

// The main discovery function has been refactored - see fast_discovery_refactored.ts
export { discoverMusicRefactored as discoverMusic } from "./fast_discovery_refactored.ts";

// Export internal functions and types for refactored version
export { classifyDirectories, parallelFileScan };
export { detectCompilationsRefactored as detectCompilations } from "./detect_compilations_refactored.ts";
export type { ScanResult };
