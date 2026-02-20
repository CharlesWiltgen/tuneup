/**
 * Centralized TagLib initialization that handles both development and compiled binaries
 */

import { TagLib } from "@charlesw/taglib-wasm";

// Singleton instance
let taglibInstance: TagLib | null = null;

/**
 * Initialize TagLib with auto-detection: WASI filesystem mode for deno run,
 * buffer mode for compiled binaries
 */
export async function ensureTagLib(): Promise<TagLib> {
  if (!taglibInstance) {
    taglibInstance = await TagLib.initialize();
  }
  return taglibInstance!;
}
