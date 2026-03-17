import { normalizeForMatching } from "./normalize.ts";

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

function isGenericAlbumArtist(albumArtist: string | undefined): boolean {
  if (!albumArtist || albumArtist.trim() === "") return true;
  const normalized = normalizeForMatching(albumArtist);
  return normalized === "various artists";
}

function groupingKey(track: TrackMetadata): string | null {
  if (!track.albumName) return null;
  const normalizedAlbum = normalizeForMatching(track.albumName);
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
