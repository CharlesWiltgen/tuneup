import {
  assert,
  assertEquals,
  assertGreater,
  assertNotEquals,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  type AlbumFileInfo,
  fetchRecording,
  longestIncreasingSubsequenceLength,
  type MBRecordingResponse,
  type MBRelease,
  normalizedSimilarity,
  RateLimiter,
  scoreRelease,
  selectBestRelease,
} from "./musicbrainz.ts";

describe("RateLimiter", () => {
  it("should allow first request immediately", async () => {
    const limiter = new RateLimiter(1000);
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    assert(elapsed < 50, `Expected first request < 50ms, got ${elapsed}ms`);
  });

  it("should enforce delay between requests", async () => {
    const limiter = new RateLimiter(200);
    await limiter.acquire();
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    assertGreater(elapsed, 150);
  });
});

describe("fetchRecording", () => {
  it("should return null for a nonexistent recording ID", async () => {
    const limiter = new RateLimiter(0);
    const result = await fetchRecording(
      "00000000-0000-0000-0000-000000000000",
      limiter,
    );
    assertEquals(result, null);
  });

  it("should return recording data for a known recording ID", async () => {
    const limiter = new RateLimiter(0);
    const knownId = "140e147b-7b45-4e1c-80e0-ab68e5e2c2c1"; // Smells Like Teen Spirit
    const result = await fetchRecording(knownId, limiter);
    assertNotEquals(result, null);
    assertEquals(result!.id, knownId);
    assert(result!.title.length > 0, "Expected non-empty title");
    assert(
      (result!.releases ?? []).length > 0,
      "Expected at least one release",
    );
  });
});

describe("normalizedSimilarity", () => {
  it("should return 1.0 for identical strings", () => {
    assertEquals(normalizedSimilarity("Abbey Road", "Abbey Road"), 1.0);
  });

  it("should return 1.0 for case/diacritics differences", () => {
    assertEquals(normalizedSimilarity("Björk", "bjork"), 1.0);
  });

  it("should return high score for minor differences", () => {
    const score = normalizedSimilarity("Abbey Road (Deluxe)", "Abbey Road");
    assertGreater(score, 0.5);
  });

  it("should return low score for very different strings", () => {
    const score = normalizedSimilarity("Abbey Road", "Thriller");
    assert(
      score < 0.3,
      `Expected score < 0.3 for very different strings, got ${score}`,
    );
  });

  it("should return 0.5 when either string is empty", () => {
    assertEquals(normalizedSimilarity("", "Abbey Road"), 0.5);
    assertEquals(normalizedSimilarity("Abbey Road", ""), 0.5);
  });
});

describe("longestIncreasingSubsequenceLength", () => {
  it("should return full length for sorted sequence", () => {
    assertEquals(longestIncreasingSubsequenceLength([1, 2, 3, 4, 5]), 5);
  });

  it("should return 1 for reverse-sorted sequence", () => {
    assertEquals(longestIncreasingSubsequenceLength([5, 4, 3, 2, 1]), 1);
  });

  it("should find LIS in mixed sequence", () => {
    assertEquals(longestIncreasingSubsequenceLength([1, 3, 2, 4, 5]), 4);
  });

  it("should return 0 for empty sequence", () => {
    assertEquals(longestIncreasingSubsequenceLength([]), 0);
  });

  it("should handle single element", () => {
    assertEquals(longestIncreasingSubsequenceLength([42]), 1);
  });
});

describe("scoreRelease", () => {
  const makeFiles = (count: number): AlbumFileInfo[] =>
    Array.from({ length: count }, (_, i) => ({
      path: `/music/album/${String(i + 1).padStart(2, "0")}.mp3`,
      recordingId: `rec-${i + 1}`,
      duration: 200 + i,
      trackNumber: i + 1,
      discNumber: 1,
      existingAlbum: "Test Album",
      existingArtist: "Test Artist",
      existingYear: 2020,
    }));

  const makeRelease = (
    trackCount: number,
    recordingIds: string[],
    overrides: Partial<MBRelease> = {},
  ): MBRelease => ({
    id: "rel-1",
    title: "Test Album",
    status: "Official",
    date: "2020",
    media: [{
      position: 1,
      track_count: trackCount,
      tracks: recordingIds.map((id, i) => ({
        id: `track-${i}`,
        number: String(i + 1),
        title: `Track ${i + 1}`,
        length: (200 + i) * 1000,
        position: i + 1,
        recording: { id },
      })),
    }],
    "release-group": { id: "rg-1", "primary-type": "Album" },
    ...overrides,
  });

  it("should score a perfect match close to 1.0", () => {
    const files = makeFiles(10);
    const recordingIds = files.map((f) => f.recordingId);
    const release = makeRelease(10, recordingIds);
    const score = scoreRelease(files, release);
    assertGreater(score, 0.9);
  });

  it("should score a partial album (12 of 14 tracks) reasonably", () => {
    const files = makeFiles(12);
    const allRecordings = [
      ...files.map((f) => f.recordingId),
      "rec-extra-1",
      "rec-extra-2",
    ];
    const release = makeRelease(14, allRecordings);
    const score = scoreRelease(files, release);
    assertGreater(score, 0.7);
  });

  it("should score a compilation lower than an album", () => {
    const files = makeFiles(10);
    const recordingIds = files.map((f) => f.recordingId);
    const album = makeRelease(10, recordingIds);
    const compilation = makeRelease(10, recordingIds, {
      "release-group": { id: "rg-2", "primary-type": "Compilation" },
    });
    const albumScore = scoreRelease(files, album);
    const compScore = scoreRelease(files, compilation);
    assertGreater(albumScore, compScore);
  });
});

describe("selectBestRelease", () => {
  it("should return null when no files", () => {
    const result = selectBestRelease([], new Map());
    assertEquals(result, null);
  });

  it("should return null when no candidates (recordings have no releases)", () => {
    const files: AlbumFileInfo[] = [{
      path: "/a.mp3",
      recordingId: "rec-orphan",
      duration: 200,
    }];
    const recordings = new Map<string, MBRecordingResponse>();
    recordings.set("rec-orphan", {
      id: "rec-orphan",
      title: "Orphan",
      length: 200000,
      releases: [],
    });
    const result = selectBestRelease(files, recordings);
    assertEquals(result, null);
  });
});
