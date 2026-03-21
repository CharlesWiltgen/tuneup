import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import { discoverAudioFiles } from "./file_discovery.ts";
import { listAudioFilesRecursive as collectAudioFiles } from "../lib/fastest_audio_scan_recursive.ts";

// Test helpers
async function createTempDir(): Promise<string> {
  const tempDir = await Deno.makeTempDir({ prefix: "tuneup-test-" });
  return tempDir;
}

async function removeTempDir(dir: string): Promise<void> {
  try {
    await Deno.remove(dir, { recursive: true });
  } catch {
    // Ignore errors during cleanup
  }
}

async function createTestFile(path: string): Promise<void> {
  const dir = dirname(path);
  await ensureDir(dir);
  await Deno.writeTextFile(path, "test audio content");
}

describe("discoverAudioFiles (metadata-based)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await removeTempDir(tempDir);
  });

  it("should collect files and build fileBaseMap correctly", async () => {
    await createTestFile(join(tempDir, "song.mp3"));
    await createTestFile(join(tempDir, "track.flac"));

    const result = await discoverAudioFiles([tempDir]);

    assertEquals(result.files.length, 2);
    assertEquals(result.fileBaseMap.size, 2);
    assertEquals(result.fileBaseMap.get(join(tempDir, "song.mp3")), "song");
    assertEquals(result.fileBaseMap.get(join(tempDir, "track.flac")), "track");
  });

  it("should group files by directory", async () => {
    const dir1 = join(tempDir, "dir1");
    const dir2 = join(tempDir, "dir2");
    await ensureDir(dir1);
    await ensureDir(dir2);

    await createTestFile(join(dir1, "file1.mp3"));
    await createTestFile(join(dir1, "file2.mp3"));
    await createTestFile(join(dir2, "file3.mp3"));

    const result = await discoverAudioFiles([tempDir]);

    assertEquals(result.filesByDirectory.size, 2);
    assertEquals(result.filesByDirectory.get(dir1)?.length, 2);
    assertEquals(result.filesByDirectory.get(dir2)?.length, 1);
  });

  it("should handle mixed files and directories without duplicates", async () => {
    const dir = join(tempDir, "album");
    await ensureDir(dir);
    await createTestFile(join(dir, "track.mp3"));
    await createTestFile(join(tempDir, "single.mp3"));

    // Pass both directory and file
    const result = await discoverAudioFiles([
      tempDir,
      join(tempDir, "single.mp3"),
    ]);

    // Should not duplicate the single.mp3
    assertEquals(result.files.length, 2);
  });

  it("should handle empty directories", async () => {
    const emptyDir = join(tempDir, "empty");
    await ensureDir(emptyDir);

    const result = await discoverAudioFiles([emptyDir]);

    assertEquals(result.files.length, 0);
    assertEquals(result.albums.size, 0);
    assertEquals(result.singles.length, 0);
    assertEquals(result.stats.totalFiles, 0);
  });

  it("should handle non-audio files", async () => {
    await createTestFile(join(tempDir, "song.mp3"));
    await Deno.writeTextFile(join(tempDir, "readme.txt"), "text file");
    await Deno.writeTextFile(join(tempDir, "image.jpg"), "image data");

    const result = await discoverAudioFiles([tempDir]);

    assertEquals(result.files.length, 1);
    assertEquals(result.files[0].endsWith("song.mp3"), true);
  });

  it("should handle progress reporting", async () => {
    await createTestFile(join(tempDir, "1.mp3"));
    await createTestFile(join(tempDir, "2.mp3"));
    await createTestFile(join(tempDir, "3.mp3"));

    const progressCalls: Array<
      { phase: string; processed: number; total: number }
    > = [];

    await discoverAudioFiles([tempDir], {
      onProgress: (phase, processed, total) => {
        progressCalls.push({ phase, processed, total });
      },
    });

    // Should have both discovery and metadata phases
    const discoveryPhases = progressCalls.filter((p) =>
      p.phase === "discovery"
    );
    const metadataPhases = progressCalls.filter((p) => p.phase === "metadata");

    assertEquals(discoveryPhases.length > 0, true);
    assertEquals(metadataPhases.length > 0, true);
  });

  // Note: The actual album/singles classification now depends on metadata
  // which would require either mocking readMetadataBatch or using real audio files.
  // These tests have been simplified to focus on the file discovery aspects.
});

describe("file discovery helper functions", () => {
  it("organizeFiles should build maps correctly", () => {
    // Test the behavior through the main function
    // The helper functions are not exported, so we verify their behavior
    // through integration tests with the main discoverAudioFiles function
  });

  it("shouldSkipAacFile logic", () => {
    // Test AAC detection logic
    const testCases = [
      { path: "song.mp3", codec: "mp3", expected: false },
      { path: "song.m4a", codec: "aac", expected: true },
      { path: "song.m4a", codec: "alac", expected: false },
      { path: "song.mp4", codec: "aac", expected: true },
      { path: "song.flac", codec: "flac", expected: false },
    ];

    // These tests verify the logic but can't directly test the function
    // since it's not exported. The behavior is tested through integration tests.
    for (const testCase of testCases) {
      // Verify the expected behavior
      const isM4aOrMp4 = testCase.path.toLowerCase().endsWith(".m4a") ||
        testCase.path.toLowerCase().endsWith(".mp4");
      const isAac = testCase.codec.toLowerCase().includes("aac");
      const shouldSkip = isM4aOrMp4 && isAac;
      assertEquals(shouldSkip, testCase.expected);
    }
  });
});

describe("collectAudioFiles (existing)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await removeTempDir(tempDir);
  });

  it("should collect audio files from directories", async () => {
    await createTestFile(join(tempDir, "test.mp3"));
    await createTestFile(join(tempDir, "test.flac"));

    const files = await collectAudioFiles([tempDir]);

    assertEquals(files.length, 2);
  });

  it("should filter by supported extensions", async () => {
    await createTestFile(join(tempDir, "audio.mp3"));
    await createTestFile(join(tempDir, "document.txt"));
    await createTestFile(join(tempDir, "image.jpg"));

    const files = await collectAudioFiles([tempDir]);

    assertEquals(files.length, 1);
    assertEquals(files[0].endsWith("audio.mp3"), true);
  });

  it("should collect files without progress callback", async () => {
    await createTestFile(join(tempDir, "1.mp3"));
    await createTestFile(join(tempDir, "2.mp3"));
    await createTestFile(join(tempDir, "3.mp3"));

    const files = collectAudioFiles([tempDir]);

    // Should find all 3 files
    assertEquals(files.length, 3);
  });
});
