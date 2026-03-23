// src/lib/pipeline_services.test.ts
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertGreater } from "@std/assert";
import type {
  AudioFileHandle,
  CoverArtInput,
  PipelineServices,
  TagHandle,
} from "./pipeline.ts";
import { runPipeline } from "./pipeline.ts";
import type { MusicDiscovery } from "../utils/fast_discovery.ts";
import type { LookupResult } from "./acoustid.ts";
import type { MBMedium, MBRecordingResponse } from "./musicbrainz.ts";
import type { ReviewDecision, ReviewItem } from "./review.ts";
import type { MoveResult } from "./organizer.ts";
import type { CoverArtResult } from "./cover_art.ts";
import type { RateLimiter } from "./musicbrainz.ts";

// --- Constants ---

const RECORDING_ID = "rec-001";
const RELEASE_ID = "rel-001";
const ACOUSTID = "aid-001";
const TEST_FILE = "/music/album/01-track.mp3";
const TEST_FILE_2 = "/music/album/02-track.mp3";

// --- Mock audio file ---

function createMockTagHandle(): TagHandle & {
  written: Record<string, unknown>;
} {
  const written: Record<string, unknown> = {};
  return {
    written,
    setTitle(v: string) {
      written.title = v;
    },
    setArtist(v: string) {
      written.artist = v;
    },
    setAlbum(v: string) {
      written.album = v;
    },
    setYear(v: number) {
      written.year = v;
    },
    setGenre(v: string) {
      written.genre = v;
    },
    setTrack(v: number) {
      written.track = v;
    },
  };
}

type MockAudioFile = ReturnType<typeof createMockAudioFile>;

function createMockAudioFile(): AudioFileHandle & {
  tagHandle: ReturnType<typeof createMockTagHandle>;
  savedCount: number;
  disposed: boolean;
  pictures: CoverArtInput[];
  properties: Record<string, string>;
} {
  const tagHandle = createMockTagHandle();
  const mock = {
    tagHandle,
    savedCount: 0,
    disposed: false,
    pictures: [] as CoverArtInput[],
    properties: {} as Record<string, string>,
    tag: () => tagHandle,
    setProperty(key: string, value: string) {
      mock.properties[key] = value;
    },
    getPictures: () => mock.pictures as unknown[],
    setPictures(pics: CoverArtInput[]) {
      mock.pictures = pics;
    },
    saveToFile: () => Promise.resolve(void (mock.savedCount++)),
    dispose: () => {
      mock.disposed = true;
    },
  };
  return mock;
}

// --- Mock data builders ---

// Build a recording with a release.
// trackCount controls release track count. By default, track 1's
// recording.id = RECORDING_ID so it matches the file.
// Set unmatchedRelease=true to make no tracks match RECORDING_ID
// (produces low confidence via coverage=0).
function makeRecording(opts?: {
  trackCount?: number;
  genre?: string;
  unmatchedRelease?: boolean;
}): MBRecordingResponse {
  const trackCount = opts?.trackCount ?? 1;
  const tracks = Array.from({ length: trackCount }, (_, i) => ({
    id: `track-${i + 1}`,
    number: String(i + 1),
    title: `Track ${i + 1}`,
    length: 240000,
    position: i + 1,
    recording: {
      id: opts?.unmatchedRelease
        ? `rec-unmatched-${i + 1}`
        : (i === 0 ? RECORDING_ID : `rec-00${i + 1}`),
    },
  }));

  const media: MBMedium[] = [{
    position: 1,
    format: "CD",
    track_count: trackCount,
    tracks,
  }];

  return {
    id: RECORDING_ID,
    title: "Track 1",
    length: 240000,
    "artist-credit": [{
      name: "Test Artist",
      artist: { id: "art-001", name: "Test Artist" },
    }],
    releases: [{
      id: RELEASE_ID,
      title: "Test Album",
      status: "Official",
      date: "2020-01-01",
      country: "US",
      "release-group": { id: "rg-001", "primary-type": "Album" },
      "artist-credit": [{
        name: "Test Artist",
        artist: { id: "art-001", name: "Test Artist" },
      }],
      media,
    }],
    genres: opts?.genre ? [{ name: opts.genre, count: 5 }] : [],
  };
}

function makeLookupResult(): LookupResult {
  return {
    status: "ok",
    results: [{
      id: ACOUSTID,
      score: 0.99,
      recordings: [{
        id: RECORDING_ID,
        artists: [{ id: "art-001", name: "Test Artist" }],
        releasegroups: [{
          id: "rg-001",
          type: "Album",
          releases: [{ id: RELEASE_ID, title: "Test Album" }],
        }],
      }],
    }],
  };
}

function makeDiscovery(files: string[], asSingles = false): MusicDiscovery {
  return {
    albums: new Map(),
    compilations: new Map(),
    singles: asSingles ? files : [],
    totalFiles: files.length,
    scan: {
      allFiles: files,
      filesByDir: new Map(),
      dirInfo: new Map(),
    },
    albumGroups: asSingles ? [] : [{
      albumName: "Test Album",
      files,
      isCompilation: false,
    }],
  };
}

function baseOptions() {
  return {
    apiKey: "test-key",
    dryRun: false,
    overwrite: false,
    organize: false,
    noArt: false,
    quiet: true,
    force: false,
    libraryRoot: "/music",
  };
}

// --- Service factory ---
// Builds mock services.
// Confidence is controlled via recording data:
//   - trackCount=1 (default): 1 file matching 1-track release → high (~0.94)
//   - trackCount=10: 1 file matching 10-track release → medium (~0.67)
//   - unmatchedRelease + trackCount=2: 0 tracks match → low (~0.42)

function createMockServices(overrides?: {
  trackCount?: number;
  unmatchedRelease?: boolean;
  genre?: string;
  audioFiles?: Map<string, MockAudioFile>;
  reviewDecisions?: Map<string, ReviewDecision>;
  coverArtData?: Uint8Array | null;
  fingerprintResult?: string | null;
  existingMeta?: Record<string, unknown>;
  discoveryFiles?: string[];
}): PipelineServices {
  const audioFiles = overrides?.audioFiles ?? new Map<string, MockAudioFile>();
  const coverArt = overrides?.coverArtData;
  const discoveryFiles = overrides?.discoveryFiles ?? [TEST_FILE];

  return {
    discoverMusic: () => Promise.resolve(makeDiscovery(discoveryFiles)),
    generateFingerprint: () =>
      Promise.resolve(
        overrides?.fingerprintResult === null
          ? null
          : (overrides?.fingerprintResult ?? "fp-mock-123"),
      ),
    getAudioDuration: () => Promise.resolve(240),
    lookupFingerprint: (): Promise<LookupResult | null> =>
      Promise.resolve(makeLookupResult()),
    fetchRecording: (
      _id: string,
      _rl: RateLimiter,
    ): Promise<MBRecordingResponse | null> =>
      Promise.resolve(
        makeRecording({
          trackCount: overrides?.trackCount,
          genre: overrides?.genre ?? "rock",
          unmatchedRelease: overrides?.unmatchedRelease,
        }),
      ),
    getComprehensiveMetadata: () =>
      Promise.resolve({
        title: undefined as string | undefined,
        artist: undefined as string | undefined,
        album: undefined as string | undefined,
        year: undefined as number | undefined,
        genre: undefined as string | undefined,
        track: undefined as number | undefined,
        duration: 240,
        bitrate: 320,
        ...overrides?.existingMeta,
      }),
    fetchCoverArt: (): Promise<CoverArtResult> => {
      if (coverArt === null) return Promise.resolve(null);
      return Promise.resolve(
        coverArt
          ? { data: coverArt, mimeType: "image/jpeg" }
          : { data: new Uint8Array([0xFF, 0xD8]), mimeType: "image/jpeg" },
      );
    },
    runBatchReview: (
      _items: ReviewItem[],
    ): Promise<Map<string, ReviewDecision>> =>
      Promise.resolve(overrides?.reviewDecisions ?? new Map()),
    openAudioFile: (path: string): Promise<AudioFileHandle | null> => {
      const existing = audioFiles.get(path);
      if (existing) return Promise.resolve(existing);
      const mock = createMockAudioFile();
      audioFiles.set(path, mock);
      return Promise.resolve(mock);
    },
    moveFile: (
      source: string,
      destination: string,
      dryRun: boolean,
    ): Promise<MoveResult> =>
      Promise.resolve({
        source,
        destination,
        status: dryRun ? "dry-run" as const : "moved" as const,
      }),
  };
}

// --- Tests ---

describe("runPipeline", () => {
  it("should return zeroed report for empty library", async () => {
    const services = createMockServices({ discoveryFiles: [] });

    const report = await runPipeline(baseOptions(), services);

    assertEquals(report.totalFiles, 0);
    assertEquals(report.matched, 0);
    assertEquals(report.enriched, 0);
    assertEquals(report.artAdded, 0);
    assertEquals(report.duplicatesFound, 0);
    assertEquals(report.unresolved, 0);
    assertEquals(report.files.length, 0);
  });

  it("should auto-enrich high-confidence matches with tags and art", async () => {
    // trackCount=1 → 1 file matching 1-track release → high confidence
    const audioFiles = new Map<string, MockAudioFile>();
    const services = createMockServices({
      audioFiles,
      genre: "rock",
    });

    const report = await runPipeline(baseOptions(), services);

    assertEquals(report.matched, 1);
    assertEquals(report.enriched, 1);
    assertEquals(report.artAdded, 1);
    assertEquals(report.files[0].confidence, "high");

    const audioFile = audioFiles.get(TEST_FILE)!;
    assertEquals(audioFile.tagHandle.written.title, "Track 1");
    assertEquals(audioFile.tagHandle.written.album, "Test Album");
    assertEquals(audioFile.tagHandle.written.genre, "rock");
    assertEquals(audioFile.savedCount, 1);
    assertEquals(audioFile.disposed, true);
  });

  it("should queue medium-confidence matches for review and apply accepted", async () => {
    // trackCount=10 → 1 file matching 10-track release → medium (~0.67)
    const audioFiles = new Map<string, MockAudioFile>();
    const reviewDecisions = new Map<string, ReviewDecision>();
    reviewDecisions.set(TEST_FILE, "accept");

    const services = createMockServices({
      trackCount: 10,
      audioFiles,
      reviewDecisions,
    });

    const report = await runPipeline(baseOptions(), services);

    assertEquals(report.matched, 1);
    assertEquals(report.enriched, 1);
    assertEquals(report.files[0].confidence, "medium");

    const audioFile = audioFiles.get(TEST_FILE)!;
    assertEquals(audioFile.savedCount, 1);
    assertEquals(audioFile.disposed, true);
  });

  it("should not apply skipped medium-confidence reviews", async () => {
    // trackCount=10 → medium confidence
    const reviewDecisions = new Map<string, ReviewDecision>();
    reviewDecisions.set(TEST_FILE, "skip");

    const services = createMockServices({
      trackCount: 10,
      reviewDecisions,
    });

    const report = await runPipeline(baseOptions(), services);

    assertEquals(report.matched, 1);
    assertEquals(report.enriched, 0);
    assertEquals(report.files[0].confidence, "medium");
  });

  it("should skip enrichment and art for low-confidence matches", async () => {
    // unmatchedRelease + trackCount=2 → no tracks match → low (~0.42)
    let fetchCoverArtCalled = false;
    const services = createMockServices({
      unmatchedRelease: true,
      trackCount: 2,
    });
    services.fetchCoverArt = () => {
      fetchCoverArtCalled = true;
      return Promise.resolve({
        data: new Uint8Array([0xFF]),
        mimeType: "image/jpeg",
      });
    };

    const report = await runPipeline(baseOptions(), services);

    assertEquals(report.enriched, 0);
    assertEquals(report.artAdded, 0);
    assertEquals(fetchCoverArtCalled, false);
  });

  it("should count files with no fingerprint match as unresolved", async () => {
    const services = createMockServices({ fingerprintResult: null });

    const report = await runPipeline(baseOptions(), services);

    assertEquals(report.totalFiles, 1);
    assertEquals(report.matched, 0);
    assertEquals(report.unresolved, 1);
  });

  it("should preserve existing tags when overwrite=false", async () => {
    const audioFiles = new Map<string, MockAudioFile>();
    const services = createMockServices({
      audioFiles,
      existingMeta: {
        title: "My Custom Title",
        artist: "My Artist",
        album: "My Album",
        albumArtist: "My Album Artist",
        year: 2019,
        genre: "pop",
        track: 1,
      },
    });

    const opts = { ...baseOptions(), overwrite: false };
    const report = await runPipeline(opts, services);

    // All fields filled including albumArtist → no diffs → no enrichment
    assertEquals(report.enriched, 0);
  });

  it("should replace existing tags when overwrite=true", async () => {
    // Mismatched existing tags lower scoring → medium confidence → review.
    const audioFiles = new Map<string, MockAudioFile>();
    const reviewDecisions = new Map<string, ReviewDecision>();
    reviewDecisions.set(TEST_FILE, "accept");

    const services = createMockServices({
      audioFiles,
      reviewDecisions,
      existingMeta: {
        title: "Old Title",
        artist: "Old Artist",
        album: "Old Album",
        year: 2010,
        genre: "jazz",
        track: 5,
      },
    });

    const opts = { ...baseOptions(), overwrite: true };
    const report = await runPipeline(opts, services);

    assertEquals(report.enriched, 1);
    const audioFile = audioFiles.get(TEST_FILE)!;
    assertEquals(audioFile.tagHandle.written.title, "Track 1");
    assertEquals(audioFile.tagHandle.written.artist, "Test Artist");
    assertEquals(audioFile.tagHandle.written.album, "Test Album");
  });

  it("should not write changes when dryRun=true", async () => {
    const audioFiles = new Map<string, MockAudioFile>();
    const services = createMockServices({ audioFiles });

    const opts = { ...baseOptions(), dryRun: true };
    const report = await runPipeline(opts, services);

    assertEquals(report.matched, 1);
    assertEquals(report.enriched, 0);
    assertEquals(report.artAdded, 0);
    assertEquals(audioFiles.size, 0);
  });

  it("should call moveFile when organize=true", async () => {
    const moves: { source: string; destination: string }[] = [];
    const services = createMockServices();
    services.moveFile = (source, destination, dryRun) => {
      moves.push({ source, destination });
      return Promise.resolve({
        source,
        destination,
        status: dryRun ? "dry-run" as const : "moved" as const,
      });
    };

    const opts = { ...baseOptions(), organize: true };
    const report = await runPipeline(opts, services);

    assertEquals(report.organized, 1);
    assertGreater(moves.length, 0);
    assertEquals(moves[0].source, TEST_FILE);
  });

  it("should not call fetchCoverArt when noArt=true", async () => {
    let fetchCoverArtCalled = false;
    const services = createMockServices();
    services.fetchCoverArt = () => {
      fetchCoverArtCalled = true;
      return Promise.resolve(null);
    };

    const opts = { ...baseOptions(), noArt: true };
    await runPipeline(opts, services);

    assertEquals(fetchCoverArtCalled, false);
  });

  it("should detect duplicates when files share a recording ID", async () => {
    const services = createMockServices({
      discoveryFiles: [TEST_FILE, TEST_FILE_2],
      trackCount: 2,
    });
    services.getComprehensiveMetadata = (path: string) =>
      Promise.resolve({
        title: "Track 1",
        artist: "Test Artist",
        album: "Test Album",
        year: 2020,
        genre: "rock",
        track: 1,
        duration: 240,
        bitrate: path === TEST_FILE ? 320 : 128,
      });

    const report = await runPipeline(baseOptions(), services);

    assertGreater(report.duplicatesFound, 0);
  });
});
