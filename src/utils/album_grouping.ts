import { basename, dirname } from "@std/path";
import { PROPERTIES } from "@charlesw/taglib-wasm";
import { ensureTagLib } from "../lib/taglib_init.ts";
import { normalizeForMatching } from "./normalize.ts";
import { parseFilenames } from "./filename_parser.ts";

export type TrackMetadata = {
  path: string;
  albumName?: string;
  albumArtist?: string;
  artist?: string;
  trackNumber?: number;
};

export type AlbumGroup = {
  albumName: string;
  albumArtist?: string;
  files: string[];
  isCompilation: boolean;
};

export type GroupingResult = {
  albums: AlbumGroup[];
  singles: string[];
};

export type AmbiguousContext = {
  type: "disc-merge-unknown" | "album-artist-conflict";
  description: string;
  paths: string[];
  options: Array<{ label: string; value: string }>;
};

export type OnAmbiguousCallback = (
  context: AmbiguousContext,
) => Promise<string>;

function isGenericAlbumArtist(albumArtist: string | undefined): boolean {
  if (!albumArtist || albumArtist.trim() === "") return true;
  const normalized = normalizeForMatching(albumArtist);
  return normalized === "various artists";
}

function groupingKey(track: TrackMetadata): string | null {
  if (!track.albumName) return null;
  const normalizedAlbum = normalizeForMatching(track.albumName);
  if (!normalizedAlbum) return null;
  if (isGenericAlbumArtist(track.albumArtist)) {
    return normalizedAlbum;
  }
  return `${normalizedAlbum}::${normalizeForMatching(track.albumArtist!)}`;
}

export function groupTracksByAlbum(tracks: TrackMetadata[]): GroupingResult {
  const groups = new Map<string, {
    albumName: string;
    albumArtist?: string;
    files: string[];
    artists: Set<string>;
  }>();
  const singles: string[] = [];

  for (const track of tracks) {
    const key = groupingKey(track);
    if (key === null) {
      singles.push(track.path);
      continue;
    }

    if (!groups.has(key)) {
      groups.set(key, {
        albumName: track.albumName!,
        albumArtist: isGenericAlbumArtist(track.albumArtist)
          ? undefined
          : track.albumArtist,
        files: [],
        artists: new Set(),
      });
    }

    const group = groups.get(key)!;
    group.files.push(track.path);
    if (track.artist) {
      group.artists.add(normalizeForMatching(track.artist));
    }
  }

  const albums: AlbumGroup[] = [];

  for (const group of groups.values()) {
    if (group.files.length < 2) {
      singles.push(...group.files);
    } else {
      albums.push({
        albumName: group.albumName,
        albumArtist: group.albumArtist,
        files: group.files,
        isCompilation: group.artists.size >= 3,
      });
    }
  }

  return { albums, singles };
}

export async function readTrackMetadata(
  files: string[],
): Promise<TrackMetadata[]> {
  const taglib = await ensureTagLib();
  const results: TrackMetadata[] = [];

  for (const file of files) {
    const metadata: TrackMetadata = { path: file };

    try {
      using audioFile = await taglib.open(file);
      const tag = audioFile.tag();

      metadata.albumName = tag.album || undefined;
      metadata.albumArtist =
        audioFile.getProperty(PROPERTIES.albumArtist.key) || undefined;
      metadata.artist = tag.artist || undefined;
      metadata.trackNumber = tag.track || undefined;
    } catch {
      // Tags unreadable — will fall through to fallbacks
    }

    // Fallback: directory name as album name
    if (!metadata.albumName) {
      metadata.albumName = basename(dirname(file));
    }

    results.push(metadata);
  }

  // Fallback: filename parsing for tracks missing metadata
  const missingData = results.filter(
    (r) => r.trackNumber == null || !r.artist,
  );
  if (missingData.length > 0) {
    const parsed = parseFilenames(missingData.map((r) => r.path));
    for (let i = 0; i < missingData.length; i++) {
      const p = parsed[i];
      if (p.track != null && missingData[i].trackNumber == null) {
        missingData[i].trackNumber = p.track;
      }
      if (p.artist && !missingData[i].artist) {
        missingData[i].artist = p.artist;
      }
    }
  }

  return results;
}
