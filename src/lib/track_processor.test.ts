import { assertEquals, assertExists } from "@std/assert";
import {
  batchProcessTracks,
  processAlbum,
  processTrack,
  TrackProcessorPool,
} from "./track_processor.ts";
import { join } from "@std/path";
import { getVendorBinaryPath } from "./vendor_tools.ts";
import { getReplayGainTags, writeReplayGainTags } from "./tagging.ts";

// Mock the external dependencies
const originalCommand = Deno.Command;
const originalFetch = globalThis.fetch;
const mockCommands: Map<
  string,
  () => { success: boolean; stdout: Uint8Array; stderr: Uint8Array }
> = new Map();
let mockFetchResponse: (() => Promise<Response>) | null = null;

function setupMocks() {
  // @ts-ignore: Mocking Deno.Command
  Deno.Command = class MockCommand {
    constructor(public cmd: string, public options?: unknown) {}

    output() {
      const handler = mockCommands.get(this.cmd);
      if (handler) {
        return Promise.resolve(handler());
      }
      return Promise.resolve({
        success: false,
        stdout: new Uint8Array(),
        stderr: new TextEncoder().encode("Command not found"),
      });
    }
  };

  if (mockFetchResponse) {
    const _originalFetch = globalThis.fetch;
    // @ts-ignore: Mocking fetch
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.href
        : input.url;
      if (url.includes("api.acoustid.org")) {
        return mockFetchResponse!();
      }
      return _originalFetch(input, init);
    };
  }
}

function restoreMocks() {
  Deno.Command = originalCommand;
  globalThis.fetch = originalFetch;
  mockCommands.clear();
  mockFetchResponse = null;
}

Deno.test("processTrack - handles encoding only", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const inputFile = join(tempDir, "test.wav");
    await Deno.writeTextFile(inputFile, "fake audio data");

    const result = await processTrack(inputFile, {
      encode: true,
      dryRun: true, // Use dry run to avoid actual encoding
      quiet: true,
    });

    assertEquals(result.inputPath, inputFile);
    assertEquals(result.outputPath, join(tempDir, "test.m4a"));
    assertEquals(result.encoded, true); // Dry run still sets the encoded flag
    assertEquals(result.encodingError, undefined);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processTrack - handles lossy format rejection", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const inputFile = join(tempDir, "test.mp3");
    await Deno.writeTextFile(inputFile, "fake mp3 data");

    const result = await processTrack(inputFile, {
      encode: true,
      forceLossyTranscodes: false,
      quiet: true,
    });

    assertEquals(result.inputPath, inputFile);
    assertEquals(
      result.encodingError,
      "Cannot encode from lossy format without --force-lossy-transcodes",
    );
    assertEquals(result.encoded, undefined);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processTrack - handles AcoustID processing", async () => {
  mockFetchResponse = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          status: "ok",
          results: [{ id: "test-acoustid-123", score: 0.95 }],
        }),
        { status: 200 },
      ),
    );
  setupMocks();

  const tempDir = await Deno.makeTempDir();
  try {
    const inputFile = join(tempDir, "test.mp3");
    await Deno.copyFile("sample_audio_files/mp3_sample_512kb.mp3", inputFile);

    const fpcalcPath = getVendorBinaryPath("fpcalc");

    mockCommands.set(fpcalcPath, () => ({
      code: 0,
      success: true,
      stdout: new TextEncoder().encode(JSON.stringify({
        fingerprint: "test_fingerprint_123",
        duration: 180,
      })),
      stderr: new Uint8Array(),
    }));

    const result = await processTrack(inputFile, {
      processAcoustID: true,
      forceAcoustID: true,
      acoustIDApiKey: "test_key",
      dryRun: true,
      quiet: true,
    });

    assertEquals(result.inputPath, inputFile);
    assertEquals(result.acoustIDStatus, "processed");
    assertEquals(result.acoustIDError, undefined);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    restoreMocks();
  }
});

Deno.test("processTrack - handles multiple operations", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const inputFile = join(tempDir, "test.wav");
    await Deno.writeTextFile(inputFile, "fake audio data");

    const result = await processTrack(inputFile, {
      encode: true,
      calculateGain: true,
      albumGainData: new Map([[inputFile, { albumGain: 0.5, albumPeak: 0.9 }]]),
      processAcoustID: false, // Skip AcoustID to avoid mocking
      dryRun: true,
      quiet: true,
    });

    assertEquals(result.inputPath, inputFile);
    assertEquals(result.outputPath, join(tempDir, "test.m4a"));
    assertEquals(result.replayGainApplied, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("batchProcessTracks - processes multiple files in parallel", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const files = [];
    for (let i = 0; i < 5; i++) {
      const file = join(tempDir, `track${i}.wav`);
      await Deno.writeTextFile(file, "fake audio");
      files.push(file);
    }

    let progressCalls = 0;
    const results = await batchProcessTracks(files, {
      encode: true,
      dryRun: true,
      quiet: true,
      concurrency: 2,
      onProgress: () => {
        progressCalls++;
      },
    });

    assertEquals(results.length, 5);
    assertEquals(progressCalls, 5);

    // All files should have output paths
    for (let i = 0; i < 5; i++) {
      assertEquals(results[i].inputPath, files[i]);
      assertExists(results[i].outputPath);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("processAlbum - calculates ReplayGain for album", async () => {
  setupMocks();

  const tempDir = await Deno.makeTempDir();
  try {
    const albumDir = join(tempDir, "Album");
    await Deno.mkdir(albumDir);

    const files = [];
    for (let i = 0; i < 3; i++) {
      const file = join(albumDir, `track${i}.mp3`);
      await Deno.writeTextFile(file, "fake audio");
      files.push(file);
    }

    const rsgainPath = getVendorBinaryPath("rsgain");

    mockCommands.set(rsgainPath, () => ({
      code: 0,
      success: true,
      stdout: new Uint8Array(),
      stderr: new Uint8Array(),
    }));

    const results = await processAlbum(albumDir, files, {
      calculateGain: true,
      processAcoustID: false,
      dryRun: true,
      quiet: true,
    });

    assertEquals(results.length, 3);

    // Each result should have the album path
    for (const result of results) {
      assertEquals(files.includes(result.inputPath), true);
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
    restoreMocks();
  }
});

Deno.test("TrackProcessorPool - manages concurrent processing", async () => {
  const pool = new TrackProcessorPool(2); // Max 2 concurrent workers

  const tempDir = await Deno.makeTempDir();
  try {
    const files = [];
    for (let i = 0; i < 4; i++) {
      const file = join(tempDir, `track${i}.wav`);
      await Deno.writeTextFile(file, "fake audio");
      files.push(file);
    }

    // Process files through the pool
    const promises = files.map((file) =>
      pool.processTrack(file, {
        encode: true,
        dryRun: true,
        quiet: true,
      })
    );

    // Check pool status during processing
    const status = pool.getStatus();
    assertEquals(status.activeWorkers <= 2, true);
    assertEquals(status.queuedTasks >= 0, true);
    assertEquals(status.isShuttingDown, false);

    const results = await Promise.all(promises);
    assertEquals(results.length, 4);

    await pool.shutdown();

    // Check pool status after shutdown
    const shutdownStatus = pool.getStatus();
    assertEquals(shutdownStatus.activeWorkers, 0);
    assertEquals(shutdownStatus.isShuttingDown, true);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("TrackProcessorPool - rejects tasks after shutdown", async () => {
  const pool = new TrackProcessorPool(1);
  await pool.shutdown();

  try {
    await pool.processTrack("test.mp3", { quiet: true });
    throw new Error("Should have thrown error");
  } catch (error) {
    assertEquals((error as Error).message, "Processor pool is shutting down");
  }
});

Deno.test({
  name: "processTrack - copies ReplayGain tags from source to encoded file",
  ignore: Deno.build.os !== "darwin",
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const inputFile = join(tempDir, "test.flac");
      await Deno.copyFile(
        "sample_audio_files/flac_sample_3mb.flac",
        inputFile,
      );

      const trackGain = "-6.5 dB";
      const trackPeak = "0.987654";
      const albumGain = "-7.2 dB";
      const albumPeak = "0.998765";
      await writeReplayGainTags(inputFile, {
        trackGain,
        trackPeak,
        albumGain,
        albumPeak,
      });

      const result = await processTrack(inputFile, {
        encode: true,
        quiet: true,
      });

      assertEquals(result.encoded, true);
      assertEquals(result.replayGainApplied, true);

      assertExists(result.outputPath);
      const rgTags = await getReplayGainTags(result.outputPath);
      assertExists(rgTags);
      assertEquals(rgTags.trackGain, trackGain);
      assertEquals(rgTags.trackPeak, trackPeak);
      assertEquals(rgTags.albumGain, albumGain);
      assertEquals(rgTags.albumPeak, albumPeak);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "processTrack - copies partial ReplayGain tags (track-level only)",
  ignore: Deno.build.os !== "darwin",
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const inputFile = join(tempDir, "test.flac");
      await Deno.copyFile(
        "sample_audio_files/flac_sample_3mb.flac",
        inputFile,
      );

      const trackGain = "-4.3 dB";
      const trackPeak = "0.912345";
      await writeReplayGainTags(inputFile, { trackGain, trackPeak });

      const result = await processTrack(inputFile, {
        encode: true,
        quiet: true,
      });

      assertEquals(result.encoded, true);
      assertEquals(result.replayGainApplied, true);

      assertExists(result.outputPath);
      const rgTags = await getReplayGainTags(result.outputPath);
      assertExists(rgTags);
      assertEquals(rgTags.trackGain, trackGain);
      assertEquals(rgTags.trackPeak, trackPeak);
      assertEquals(rgTags.albumGain, undefined);
      assertEquals(rgTags.albumPeak, undefined);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "processTrack - encoding without source RG tags succeeds without error",
  ignore: Deno.build.os !== "darwin",
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    try {
      const inputFile = join(tempDir, "test.flac");
      await Deno.copyFile(
        "sample_audio_files/flac_sample_3mb.flac",
        inputFile,
      );

      const result = await processTrack(inputFile, {
        encode: true,
        quiet: true,
      });

      assertEquals(result.encoded, true);
      assertEquals(result.encodingError, undefined);
      assertEquals(result.replayGainApplied, undefined);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test("processTrack - preserves directory structure in output", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const inputFile = join(tempDir, "Artist/Album/track.wav");
    await Deno.mkdir(join(tempDir, "Artist/Album"), { recursive: true });
    await Deno.writeTextFile(inputFile, "fake audio");

    const outputDir = join(tempDir, "output");

    const result = await processTrack(inputFile, {
      encode: true,
      outputDirectory: outputDir,
      basePath: tempDir,
      dryRun: true,
      quiet: true,
    });

    assertEquals(result.outputPath, join(outputDir, "Artist/Album/track.m4a"));
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
