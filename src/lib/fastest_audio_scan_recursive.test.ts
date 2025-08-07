import { assertEquals, assertThrows } from "jsr:@std/assert";
import { afterEach, beforeEach, describe, it } from "jsr:@std/testing/bdd";
import { ensureDir } from "jsr:@std/fs";
import { join } from "jsr:@std/path";
import { listAudioFilesRecursive } from "./fastest_audio_scan_recursive.ts";

// Test helpers
async function createTempDir(): Promise<string> {
  const tempDir = await Deno.makeTempDir({ prefix: "scanner-test-" });
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
  const dir = path.substring(0, path.lastIndexOf("/"));
  await ensureDir(dir);
  await Deno.writeTextFile(path, "test audio content");
}

describe("listAudioFilesRecursive", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await removeTempDir(tempDir);
  });

  it("should find audio files recursively", async () => {
    await createTestFile(join(tempDir, "song.mp3"));
    await createTestFile(join(tempDir, "album/track1.flac"));
    await createTestFile(join(tempDir, "album/track2.ogg"));
    await createTestFile(join(tempDir, "deep/nested/file.m4a"));

    const files = listAudioFilesRecursive([tempDir]);

    assertEquals(files.length, 4);
    assertEquals(files.filter((f) => f.endsWith(".mp3")).length, 1);
    assertEquals(files.filter((f) => f.endsWith(".flac")).length, 1);
    assertEquals(files.filter((f) => f.endsWith(".ogg")).length, 1);
    assertEquals(files.filter((f) => f.endsWith(".m4a")).length, 1);
  });

  it("should ignore non-audio files", async () => {
    await createTestFile(join(tempDir, "document.txt"));
    await createTestFile(join(tempDir, "image.jpg"));
    await createTestFile(join(tempDir, "video.mp4"));
    await createTestFile(join(tempDir, "audio.mp3"));

    const files = listAudioFilesRecursive([tempDir]);

    assertEquals(files.length, 1);
    assertEquals(files[0].endsWith("audio.mp3"), true);
  });

  it("should handle multiple root directories", async () => {
    const dir1 = join(tempDir, "library1");
    const dir2 = join(tempDir, "library2");
    await ensureDir(dir1);
    await ensureDir(dir2);

    await createTestFile(join(dir1, "song1.mp3"));
    await createTestFile(join(dir2, "song2.mp3"));

    const files = listAudioFilesRecursive([dir1, dir2]);

    assertEquals(files.length, 2);
  });

  it("should handle empty directories", async () => {
    const emptyDir = join(tempDir, "empty");
    await ensureDir(emptyDir);

    const files = listAudioFilesRecursive([emptyDir]);

    assertEquals(files.length, 0);
  });

  it("should throw for non-existent directories", () => {
    assertThrows(
      () => listAudioFilesRecursive(["/non/existent/directory"]),
      Deno.errors.NotFound,
    );
  });

  it("should throw for file paths instead of directories", async () => {
    const filePath = join(tempDir, "file.mp3");
    await createTestFile(filePath);

    assertThrows(
      () => listAudioFilesRecursive([filePath]),
      Deno.errors.NotADirectory,
    );
  });

  it("should handle all supported audio extensions", async () => {
    const extensions = [
      ".mp3",
      ".flac",
      ".ogg",
      ".m4a",
      ".wav",
      ".aac",
      ".opus",
      ".wma",
    ];

    for (const ext of extensions) {
      await createTestFile(join(tempDir, `test${ext}`));
    }

    const files = listAudioFilesRecursive([tempDir]);

    assertEquals(files.length, extensions.length);
    for (const ext of extensions) {
      assertEquals(files.some((f) => f.endsWith(ext)), true);
    }
  });

  it("should be case-insensitive for extensions", async () => {
    await createTestFile(join(tempDir, "UPPER.MP3"));
    await createTestFile(join(tempDir, "MiXeD.FlAc"));
    await createTestFile(join(tempDir, "lower.ogg"));

    const files = listAudioFilesRecursive([tempDir]);

    assertEquals(files.length, 3);
  });
});
