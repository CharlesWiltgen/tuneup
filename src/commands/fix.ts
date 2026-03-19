import { resolve } from "@std/path";

export async function fixCommand(
  options: {
    dryRun: boolean;
    overwrite: boolean;
    organize: boolean;
    art: boolean;
    quiet: boolean;
    force: boolean;
    apiKey?: string;
  },
  path: string,
): Promise<void> {
  const resolvedPath = resolve(path);

  const apiKey = options.apiKey ?? Deno.env.get("ACOUSTID_API_KEY");
  if (!apiKey) {
    console.error(
      "Error: AcoustID API key required. Set ACOUSTID_API_KEY env var or use --api-key.",
    );
    return;
  }

  try {
    await Deno.stat(resolvedPath);
  } catch {
    console.error(`Error: Path not found: ${resolvedPath}`);
    return;
  }

  if (!options.quiet) {
    console.log(`\namusic fix: processing ${resolvedPath}`);
    if (options.dryRun) {
      console.log("  (dry run — no changes will be written)");
    }
    if (options.overwrite) {
      console.log("  (overwrite mode — existing tags may be replaced)");
    }
    if (options.organize) {
      console.log("  (organize mode — files will be moved)");
    }
  }

  // Pipeline execution will be wired in Task 10
  if (!options.quiet) {
    console.log("\n[fix pipeline not yet wired — coming in subsequent tasks]");
  }
}
