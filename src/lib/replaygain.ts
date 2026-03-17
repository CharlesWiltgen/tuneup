import { getVendorBinaryPath } from "./vendor_tools.ts";
import { basename, extname, join } from "@std/path";

export interface ReplayGainResult {
  success: boolean;
  data?: {
    [filePath: string]: {
      trackGain: number;
      trackPeak: number;
      albumGain?: number;
      albumPeak?: number;
    };
  };
}

/**
 * Calculates and embeds ReplayGain metadata for the given target directory or file
 * using the platform-specific rsgain vendor binary.
 *
 * @param targetPath Path to the album directory or audio file.
 * @param quiet Whether to suppress informational output.
 * @param returnData Whether to parse and return the calculated ReplayGain values.
 * @returns ReplayGainResult with success status and optional calculated data.
 */
export async function calculateReplayGain(
  targetPath: string,
  quiet: boolean,
  returnData = false,
): Promise<ReplayGainResult> {
  // Determine mode based on directory (easy) or file (custom)
  let mode = "custom";
  let actionDesc = "file";
  let outputFile: string | undefined;

  try {
    const info = await Deno.stat(targetPath);
    if (info.isDirectory) {
      mode = "easy";
      actionDesc = "album";
      if (returnData) {
        outputFile = join(targetPath, "replaygain_data.csv");
      }
    }
  } catch (error) {
    console.error(
      `Could not stat "${targetPath}", defaulting to file mode: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!quiet) {
    console.log(`  ACTION: Calculating ReplayGain for ${actionDesc}...`);
  }

  const rsgainPath = getVendorBinaryPath("rsgain");
  const args = [mode, "-e"];

  // Add output option if we want to return data
  if (returnData && outputFile) {
    args.push("--output");
  }

  args.push(targetPath);

  const command = new Deno.Command(rsgainPath, {
    args,
    stdout: quiet ? "null" : "inherit",
    stderr: quiet ? "null" : "inherit",
  });

  const { code } = await command.output();
  const success = code === 0;

  if (!success) {
    return { success: false };
  }

  // If we don't need data or there's no output file, return just success
  if (!returnData || !outputFile) {
    return { success: true };
  }

  // Try to read and parse the CSV output
  try {
    const csvContent = await Deno.readTextFile(outputFile);
    const data = parseReplayGainCSV(csvContent);

    // Clean up the temporary CSV file
    try {
      await Deno.remove(outputFile);
    } catch {
      // Ignore cleanup errors
    }

    return { success: true, data };
  } catch (error) {
    console.error(`  Warning: Could not parse ReplayGain data: ${error}`);
    return { success: true }; // Still successful, just no data
  }
}

/**
 * Calculates ReplayGain for a specific group of files, regardless of whether
 * they share a directory. For single files, delegates to calculateReplayGain
 * in custom mode. For multiple files, creates a temp directory with symlinks
 * so rsgain can treat them as a single album.
 *
 * @param files Absolute paths to the audio files in the group.
 * @param quiet Whether to suppress informational output.
 * @param returnData Whether to parse and return the calculated ReplayGain values.
 * @returns ReplayGainResult with success status and optional calculated data.
 */
export async function calculateReplayGainForGroup(
  files: string[],
  quiet: boolean,
  returnData = false,
): Promise<ReplayGainResult> {
  if (files.length === 1) {
    return calculateReplayGain(files[0], quiet, returnData);
  }

  const tempDir = await Deno.makeTempDir({ prefix: "amusic-rg-" });
  try {
    const symlinkMap = new Map<string, string>();
    const usedNames = new Map<string, number>();
    for (const file of files) {
      let linkName = basename(file);
      const count = usedNames.get(linkName) ?? 0;
      if (count > 0) {
        const ext = extname(linkName);
        const stem = ext ? linkName.slice(0, -ext.length) : linkName;
        linkName = `${stem}_${count}${ext}`;
      }
      usedNames.set(basename(file), count + 1);
      const linkPath = join(tempDir, linkName);
      await Deno.symlink(file, linkPath);
      symlinkMap.set(linkPath, file);
    }

    const result = await calculateReplayGain(tempDir, quiet, returnData);

    if (result.data) {
      const remapped: typeof result.data = {};
      for (const [tempPath, data] of Object.entries(result.data)) {
        const originalPath = symlinkMap.get(tempPath) ?? tempPath;
        remapped[originalPath] = data;
      }
      result.data = remapped;
    }

    return result;
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Parses ReplayGain CSV output from rsgain.
 */
export function parseReplayGainCSV(csvContent: string): Record<string, {
  trackGain: number;
  trackPeak: number;
  albumGain?: number;
  albumPeak?: number;
}> {
  const lines = csvContent.trim().split("\n");
  const data: Record<string, {
    trackGain: number;
    trackPeak: number;
    albumGain?: number;
    albumPeak?: number;
  }> = {};

  for (const line of lines) {
    if (line.startsWith("#") || !line.trim()) continue; // Skip comments and empty lines

    const columns = line.split("\t");
    if (columns.length < 3) continue;

    const [filePath, trackGainStr, trackPeakStr, albumGainStr, albumPeakStr] =
      columns;

    if (filePath && trackGainStr && trackPeakStr) {
      data[filePath] = {
        trackGain: parseFloat(trackGainStr),
        trackPeak: parseFloat(trackPeakStr),
      };

      if (albumGainStr && albumPeakStr) {
        data[filePath].albumGain = parseFloat(albumGainStr);
        data[filePath].albumPeak = parseFloat(albumPeakStr);
      }
    }
  }

  return data;
}
