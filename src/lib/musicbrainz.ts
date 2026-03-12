import { VERSION } from "../version.ts";
import { normalizeForMatching } from "../utils/normalize.ts";

const MUSICBRAINZ_API_BASE = "https://musicbrainz.org/ws/2";
const USER_AGENT =
  `amusic/${VERSION} (https://github.com/CharlesWiltgen/amusic)`;
const RATE_LIMIT_MS = 1100;
const RETRY_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 10000;

// --- MusicBrainz API Response Types ---

export type MBArtistCredit = {
  name: string;
  artist: { id: string; name: string };
};

export type MBTrack = {
  id: string;
  number: string;
  title: string;
  length: number | null;
  position: number;
  recording: { id: string };
};

export type MBMedium = {
  position: number;
  format?: string;
  track_count: number;
  tracks?: MBTrack[];
};

export type MBRelease = {
  id: string;
  title: string;
  status?: string;
  date?: string;
  country?: string;
  "release-group"?: {
    id: string;
    "primary-type"?: string;
  };
  "artist-credit"?: MBArtistCredit[];
  media?: MBMedium[];
};

export type MBGenre = {
  name: string;
  count: number;
};

export type MBRecordingResponse = {
  id: string;
  title: string;
  length: number | null;
  "artist-credit"?: MBArtistCredit[];
  releases?: MBRelease[];
  genres?: MBGenre[];
};

// --- Rate Limiter ---

export class RateLimiter {
  private lastRequestTime = 0;

  constructor(private minIntervalMs: number = RATE_LIMIT_MS) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.minIntervalMs - elapsed)
      );
    }
    this.lastRequestTime = Date.now();
  }
}

// --- API Client ---

const defaultRateLimiter = new RateLimiter();

export async function fetchRecording(
  recordingId: string,
  rateLimiter: RateLimiter = defaultRateLimiter,
): Promise<MBRecordingResponse | null> {
  await rateLimiter.acquire();

  const url =
    `${MUSICBRAINZ_API_BASE}/recording/${recordingId}?inc=artists+releases+genres+media&fmt=json`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.status === 503) {
        await response.body?.cancel();
        if (attempt === 0) {
          console.error(
            `  MusicBrainz rate limited, retrying in ${
              RETRY_DELAY_MS / 1000
            }s...`,
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        console.error("  MusicBrainz rate limit retry failed, skipping.");
        return null;
      }

      if (response.status === 404) {
        await response.body?.cancel();
        console.error(
          `  MusicBrainz recording not found: ${recordingId}`,
        );
        return null;
      }

      if (!response.ok) {
        await response.body?.cancel();
        console.error(
          `  MusicBrainz API error: ${response.status} ${response.statusText}`,
        );
        return null;
      }

      return (await response.json()) as MBRecordingResponse;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        console.error(
          `  MusicBrainz request timed out for recording ${recordingId}`,
        );
      } else {
        console.error(
          `  MusicBrainz API error for ${recordingId}: ${error}`,
        );
      }
      return null;
    }
  }

  return null;
}

// --- String Similarity ---

export function normalizedSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0.5;

  const na = normalizeForMatching(a);
  const nb = normalizeForMatching(b);

  if (na === nb) return 1.0;
  if (na.length === 0 || nb.length === 0) return 0.5;

  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;

  let matches = 0;
  let j = 0;
  for (let i = 0; i < longer.length && j < shorter.length; i++) {
    if (longer[i] === shorter[j]) {
      matches++;
      j++;
    }
  }

  return matches / longer.length;
}

// --- Longest Increasing Subsequence ---

export function longestIncreasingSubsequenceLength(seq: number[]): number {
  if (seq.length === 0) return 0;
  const tails: number[] = [];
  for (const val of seq) {
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < val) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = val;
  }
  return tails.length;
}

// --- Release Scoring ---

export type AlbumFileInfo = {
  path: string;
  recordingId: string;
  duration: number;
  trackNumber?: number;
  discNumber?: number;
  existingTitle?: string;
  existingAlbum?: string;
  existingAlbumArtist?: string;
  existingArtist?: string;
  existingYear?: number;
  existingGenre?: string;
};

export type ScoreReleaseOptions = {
  isSingle?: boolean;
};

export function scoreRelease(
  files: AlbumFileInfo[],
  release: MBRelease,
  options: ScoreReleaseOptions = {},
): number {
  const media = release.media ?? [];
  if (media.length === 0) return 0;

  const fileRecordingIds = new Set(files.map((f) => f.recordingId));

  let bestMedium = media[0];
  let bestMediumMatches = 0;
  for (const medium of media) {
    const matches = (medium.tracks ?? []).filter((t) =>
      fileRecordingIds.has(t.recording.id)
    ).length;
    if (matches > bestMediumMatches) {
      bestMediumMatches = matches;
      bestMedium = medium;
    }
  }

  const tracks = bestMedium.tracks ?? [];
  const releaseTrackCount = bestMedium.track_count || tracks.length;

  // 1. Track count match (weight: 30)
  let trackCountScore: number;
  if (files.length <= releaseTrackCount) {
    trackCountScore = files.length / releaseTrackCount;
  } else {
    trackCountScore = (releaseTrackCount / files.length) * 0.5;
  }

  // 2. Recording coverage (weight: 25)
  const releaseRecordingIds = new Set(tracks.map((t) => t.recording.id));
  const matched = files.filter((f) => releaseRecordingIds.has(f.recordingId))
    .length;
  const coverageScore = files.length > 0 ? matched / files.length : 0;

  // 3. Duration match (weight: 15)
  const trackById = new Map(tracks.map((t) => [t.recording.id, t]));
  const durationScores: number[] = [];
  for (const file of files) {
    const track = trackById.get(file.recordingId);
    if (!track || track.length === null) continue;
    const mbDuration = track.length / 1000;
    const diff = Math.abs(file.duration - mbDuration);
    if (diff <= 3) durationScores.push(1.0);
    else if (diff <= 10) durationScores.push(0.5);
    else durationScores.push(0.0);
  }
  const durationScore = durationScores.length > 0
    ? durationScores.reduce((a, b) => a + b, 0) / durationScores.length
    : 0.5;

  // 4. Track order match (weight: 10)
  const sortedFiles = [...files].sort((a, b) =>
    (a.trackNumber ?? 0) - (b.trackNumber ?? 0) ||
    a.path.localeCompare(b.path)
  );
  const positions: number[] = [];
  for (const file of sortedFiles) {
    const track = trackById.get(file.recordingId);
    if (track) positions.push(track.position);
  }
  const orderScore = positions.length > 0
    ? longestIncreasingSubsequenceLength(positions) / positions.length
    : 0.5;

  // 5. Existing tag agreement (weight: 10)
  const tagScores: number[] = [];
  const firstFile = files[0];
  if (firstFile?.existingAlbum) {
    tagScores.push(
      normalizedSimilarity(firstFile.existingAlbum, release.title),
    );
  }
  if (firstFile?.existingYear && release.date) {
    const releaseYear = parseInt(release.date.substring(0, 4), 10);
    if (firstFile.existingYear === releaseYear) tagScores.push(1.0);
    else if (Math.abs(firstFile.existingYear - releaseYear) <= 1) {
      tagScores.push(0.5);
    } else tagScores.push(0.0);
  }
  if (firstFile?.existingArtist && release["artist-credit"]?.[0]) {
    const releaseArtist = release["artist-credit"]
      .map((c) => c.name)
      .join(", ");
    tagScores.push(
      normalizedSimilarity(firstFile.existingArtist, releaseArtist),
    );
  }
  const tagScore = tagScores.length > 0
    ? tagScores.reduce((a, b) => a + b, 0) / tagScores.length
    : 0.5;

  // 6. Release quality signals (weight: 10)
  const statusScores: Record<string, number> = {
    "Official": 1.0,
    "Promotion": 0.3,
    "Bootleg": 0.1,
  };
  const typeScores: Record<string, number> = options.isSingle
    ? { "Single": 1.0, "Album": 0.8, "EP": 0.6, "Compilation": 0.2 }
    : { "Album": 1.0, "EP": 0.8, "Single": 0.6, "Compilation": 0.3 };
  const formatScores: Record<string, number> = {
    "Digital Media": 1.0,
    "CD": 0.8,
  };

  const statusScore = statusScores[release.status ?? ""] ?? 0.5;
  const primaryType = release["release-group"]?.["primary-type"] ?? "";
  const typeScore = typeScores[primaryType] ?? 0.5;
  const format = bestMedium.format ?? "";
  const formatScore = formatScores[format] ?? 0.5;
  const qualityScore = (statusScore + typeScore + formatScore) / 3;

  // Weighted sum (weights sum to 100)
  const score = (trackCountScore * 30 +
    coverageScore * 25 +
    durationScore * 15 +
    orderScore * 10 +
    tagScore * 10 +
    qualityScore * 10) / 100;

  return score;
}
