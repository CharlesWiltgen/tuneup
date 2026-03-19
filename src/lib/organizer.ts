import { dirname, join } from "@std/path";

const UNSAFE_CHARS = /[<>:"/\\|?*]/g;

export function sanitizeFilename(name: string): string {
  return name.replace(UNSAFE_CHARS, "_").trim();
}

export type OrganizePathInput = {
  libraryRoot: string;
  artist: string;
  album?: string;
  year?: number;
  trackNumber?: number;
  title: string;
  extension: string;
  isCompilation?: boolean;
  totalTracks?: number;
};

export function buildOrganizedPath(input: OrganizePathInput): string {
  const artist = sanitizeFilename(
    input.isCompilation ? "Various Artists" : input.artist,
  );

  const isSingle = !input.album || (input.totalTracks ?? 0) <= 1;

  if (isSingle) {
    const title = sanitizeFilename(input.title);
    return join(
      input.libraryRoot,
      artist,
      "Singles",
      `${title}${input.extension}`,
    );
  }

  const albumPart = input.year
    ? `${sanitizeFilename(input.album!)} (${input.year})`
    : sanitizeFilename(input.album!);

  const padWidth = (input.totalTracks ?? 0) >= 100 ? 3 : 2;
  const trackNum = input.trackNumber
    ? String(input.trackNumber).padStart(padWidth, "0") + " "
    : "";

  const title = sanitizeFilename(input.title);
  const filename = `${trackNum}${title}${input.extension}`;

  return join(input.libraryRoot, artist, albumPart, filename);
}

export type MoveResult = {
  source: string;
  destination: string;
  status: "moved" | "conflict" | "dry-run";
};

export async function moveFile(
  source: string,
  destination: string,
  dryRun: boolean,
): Promise<MoveResult> {
  if (dryRun) {
    return { source, destination, status: "dry-run" };
  }

  try {
    await Deno.stat(destination);
    return { source, destination, status: "conflict" };
  } catch {
    // Destination doesn't exist — good
  }

  await Deno.mkdir(dirname(destination), { recursive: true });
  await Deno.rename(source, destination);
  return { source, destination, status: "moved" };
}

export async function cleanEmptyDirs(dirPath: string): Promise<void> {
  try {
    for await (const _ of Deno.readDir(dirPath)) {
      return; // Not empty
    }
    await Deno.remove(dirPath);
    await cleanEmptyDirs(dirname(dirPath));
  } catch {
    // Ignore errors (dir doesn't exist, permission, etc.)
  }
}
