import { resolve } from "@std/path";
import { runPipeline } from "../lib/pipeline.ts";

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
    console.log(`\ntuneup fix: processing ${resolvedPath}`);
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

  const report = await runPipeline({
    apiKey,
    dryRun: options.dryRun,
    overwrite: options.overwrite,
    organize: options.organize,
    noArt: !options.art,
    quiet: options.quiet,
    force: options.force,
    libraryRoot: resolvedPath,
  });

  if (!options.quiet) {
    console.log("\n--- Fix Summary ---");
    console.log(`  Files found:    ${report.totalFiles}`);
    console.log(`  Matched:        ${report.matched}`);
    console.log(`  Enriched:       ${report.enriched}`);
    console.log(`  Art added:      ${report.artAdded}`);
    console.log(`  Duplicates:     ${report.duplicatesFound}`);
    console.log(`  Unresolved:     ${report.unresolved}`);
    if (options.organize) {
      console.log(`  Organized:      ${report.organized}`);
      console.log(`  Conflicts:      ${report.conflicts}`);
    }
  }
}
