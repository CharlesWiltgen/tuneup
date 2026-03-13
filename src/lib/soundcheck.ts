import type { ProcessResultStatus } from "./acoustid.ts";
import { getAfconvertPath } from "./encoding.ts";
import { ensureTagLib } from "./taglib_init.ts";
import { formatError } from "../utils/error_utils.ts";

export async function hasSoundCheckTag(filePath: string): Promise<boolean> {
  const taglib = await ensureTagLib();
  let audioFile = null;
  try {
    audioFile = await taglib.open(filePath, { partial: true });
    if (!audioFile) return false;
    const properties = audioFile.properties() ?? {};
    const itunnorm = properties["appleSoundCheck"]?.[0]?.trim() ?? "";
    return itunnorm.length > 0;
  } catch (error) {
    console.error(
      `Error checking SoundCheck tag for ${filePath}: ${formatError(error)}`,
    );
    return false;
  } finally {
    if (audioFile) audioFile.dispose();
  }
}

export async function generateSoundCheck(
  inputPath: string,
): Promise<string | null> {
  const afconvertPath = await getAfconvertPath();
  const tempDir = await Deno.makeTempDir({ prefix: "soundcheck-gen-" });
  const tempOutput = `${tempDir}/soundcheck_probe.m4a`;

  try {
    const cmd = new Deno.Command(afconvertPath, {
      args: [
        "-f",
        "m4af",
        "-d",
        "aac",
        "-s",
        "0",
        "-q",
        "0",
        "-b",
        "64000",
        "--soundcheck-generate",
        inputPath,
        tempOutput,
      ],
      stdout: "piped",
      stderr: "piped",
    });

    const process = await cmd.output();
    if (!process.success) {
      const errorOutput = new TextDecoder().decode(process.stderr);
      console.error(`  afconvert error: ${errorOutput}`);
      return null;
    }

    const taglib = await ensureTagLib();
    let audioFile = null;
    try {
      audioFile = await taglib.open(tempOutput, { partial: true });
      if (!audioFile) {
        console.error(`  Failed to open probe file: ${tempOutput}`);
        return null;
      }
      const properties = audioFile.properties() ?? {};
      const itunnorm = properties["appleSoundCheck"]?.[0]?.trim() ?? "";
      if (itunnorm.length === 0) {
        console.error(
          `  afconvert ran but wrote no ITUNNORM tag to probe file`,
        );
        return null;
      }
      return itunnorm;
    } finally {
      if (audioFile) audioFile.dispose();
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

export async function writeSoundCheckTag(
  filePath: string,
  itunnorm: string,
): Promise<boolean> {
  const taglib = await ensureTagLib();
  let audioFile = null;
  try {
    audioFile = await taglib.open(filePath);
    if (!audioFile) return false;
    audioFile.setProperties({ appleSoundCheck: [itunnorm] });
    await audioFile.saveToFile();
    return true;
  } catch (error) {
    console.error(
      `  Failed to write ITUNNORM to ${filePath}: ${formatError(error)}`,
    );
    return false;
  } finally {
    if (audioFile) audioFile.dispose();
  }
}

export async function processSoundCheck(
  filePath: string,
  options: { force: boolean; quiet: boolean; dryRun: boolean },
): Promise<ProcessResultStatus> {
  if (!options.quiet) console.log(`  Checking for existing SoundCheck data...`);

  const hasTag = await hasSoundCheckTag(filePath);
  if (hasTag && !options.force) {
    if (!options.quiet) {
      console.log(
        "  INFO: File already has SoundCheck (ITUNNORM) data. Skipping (use --force to overwrite).",
      );
    }
    return "skipped";
  }

  if (!options.quiet) {
    console.log("  ACTION: Generating SoundCheck data via afconvert...");
  }

  if (options.dryRun) {
    if (!options.quiet) {
      console.log(
        `  DRY RUN: Would generate and write ITUNNORM to ${filePath}`,
      );
    }
    return "processed";
  }

  const itunnorm = await generateSoundCheck(filePath);
  if (!itunnorm) {
    if (!options.quiet) {
      console.log("  WARNING: Could not generate SoundCheck data. Skipping.");
    }
    return "failed";
  }

  const success = await writeSoundCheckTag(filePath, itunnorm);
  if (success) {
    if (!options.quiet) console.log("  SUCCESS: SoundCheck data written.");
    return "processed";
  }

  return "failed";
}
