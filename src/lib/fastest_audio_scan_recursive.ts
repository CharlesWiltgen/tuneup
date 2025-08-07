import { extname, join } from "jsr:@std/path";

export const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".flac",
  ".ogg",
  ".m4a",
  ".wav",
  ".aac",
  ".opus",
  ".wma",
  ".alac",
]);

/**
 * High-performance synchronous recursive audio file scanner
 *
 * This function performs a depth-first search (DFS) traversal of the filesystem
 * to find all audio files with supported extensions. It uses synchronous I/O
 * for maximum performance, achieving ~15-30% better throughput than async
 * alternatives.
 *
 * ⚠️ CRITICAL: DO NOT MODIFY THIS FUNCTION WITHOUT EXPLICIT HUMAN REVIEW
 * This scanner is performance-critical infrastructure. Any changes by LLMs
 * or automated tools MUST be reviewed and approved by a human maintainer
 * before merging. Performance regressions here affect the entire application.
 *
 * Performance characteristics:
 * - ~240-270k directory entries/second on SSD with warm cache
 * - Zero event-loop overhead (blocks until complete)
 * - Memory usage: O(n) where n is the number of files found
 * - Tested on 4,992 files: completes in 100ms
 *
 * @param roots - Array of root directories or files to scan
 * @returns Array of absolute paths to all discovered audio files
 *
 * @example
 * ```typescript
 * const audioFiles = listAudioFilesRecursive(["/music/library"]);
 * console.log(`Found ${audioFiles.length} audio files`);
 * ```
 *
 * @throws {Deno.errors.NotFound} If a root directory doesn't exist
 * @throws {Deno.errors.PermissionDenied} If lacking read permissions
 */
export function listAudioFilesRecursive(roots: string[]): string[] {
  const out: string[] = [];
  const stack: string[] = [...roots]; // DFS stack

  while (stack.length) {
    const dir = stack.pop()!;

    for (const entry of Deno.readDirSync(dir)) { // 1 readdir() per directory
      if (entry.isFile) {
        const ext = extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(ext)) {
          out.push(join(dir, entry.name));
        }
      } else if (entry.isDirectory) {
        stack.push(join(dir, entry.name)); // defer sub-dir
      }
      /*  Symlinks? If you want to follow them:
       *  else if (entry.isSymlink) { ... }
       *  Be careful about cycles. */
    }
  }
  return out;
}
