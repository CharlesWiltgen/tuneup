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
]);

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
