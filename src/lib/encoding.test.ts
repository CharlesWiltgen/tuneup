// encoding.test.ts
import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import {
  encodeToM4A,
  generateOutputPath,
  isLosslessFormat,
} from "./encoding.ts";
import { ensureTagLib } from "./taglib_init.ts";

Deno.test("isLosslessFormat - correctly identifies lossless formats", async () => {
  assertEquals(await isLosslessFormat("/path/to/file.wav"), true);
  assertEquals(await isLosslessFormat("/path/to/file.flac"), true);
  assertEquals(await isLosslessFormat("/path/to/file.WAV"), true);
  assertEquals(await isLosslessFormat("/path/to/file.FLAC"), true);
  // Note: m4a/M4A removed from this test as they need actual file inspection
});

Deno.test("isLosslessFormat - correctly identifies lossy formats", async () => {
  assertEquals(await isLosslessFormat("/path/to/file.mp3"), false);
  assertEquals(await isLosslessFormat("/path/to/file.ogg"), false);
  assertEquals(await isLosslessFormat("/path/to/file.MP3"), false);
  assertEquals(await isLosslessFormat("/path/to/file.OGG"), false);
});

Deno.test("isLosslessFormat - ambiguous formats default to false when file cannot be inspected", async () => {
  assertEquals(await isLosslessFormat("/path/to/nonexistent.m4a"), false);
  assertEquals(await isLosslessFormat("/path/to/nonexistent.mp4"), false);
});

Deno.test("generateOutputPath - generates correct output paths", () => {
  assertEquals(
    generateOutputPath("/path/to/file.wav"),
    "/path/to/file.m4a",
  );

  assertEquals(
    generateOutputPath("/path/to/file.flac", "/output/dir"),
    "/output/dir/file.m4a",
  );

  assertEquals(
    generateOutputPath("/some/deep/path/song.mp3", "/custom/output"),
    "/custom/output/song.m4a",
  );
});

Deno.test("generateOutputPath - preserves structure with basePath", () => {
  assertEquals(
    generateOutputPath(
      "/music/artist/album/song.wav",
      "/output",
      "/music",
    ),
    "/output/artist/album/song.m4a",
  );

  // When basePath is a file (no subdirs to preserve)
  assertEquals(
    generateOutputPath("/music/song.wav", "/output", "/music/song.wav"),
    "/output/song.m4a",
  );
});

Deno.test("encodeToM4A - rejects lossy formats without force flag", async () => {
  await assertRejects(
    async () => {
      await encodeToM4A("/path/to/file.mp3", "/output/file.m4a");
    },
    Error,
    'Cannot encode from lossy format "mp3". Use --force-lossy-transcodes to override.',
  );

  await assertRejects(
    async () => {
      await encodeToM4A("/path/to/file.ogg", "/output/file.m4a");
    },
    Error,
    'Cannot encode from lossy format "ogg". Use --force-lossy-transcodes to override.',
  );
});

Deno.test("encodeToM4A - rejects unsupported formats", async () => {
  await assertRejects(
    async () => {
      await encodeToM4A("/path/to/file.txt", "/output/file.m4a");
    },
    Error,
    "Unsupported input format: txt",
  );
});

Deno.test("encodeToM4A - dry run returns success message", async () => {
  const result = await encodeToM4A("/path/to/file.wav", "/output/file.m4a", {
    dryRun: true,
  });
  assertEquals(
    result.success,
    "[DRY RUN] Would encode: /path/to/file.wav -> /output/file.m4a",
  );
});

Deno.test("encodeToM4A - generates SoundCheck (ITUNNORM) data in encoded output", async () => {
  const sampleFlac = "sample_audio_files/flac_sample_3mb.flac";
  const tempDir = await Deno.makeTempDir({ prefix: "soundcheck-test-" });
  const outputPath = `${tempDir}/output.m4a`;

  try {
    await encodeToM4A(sampleFlac, outputPath);

    const taglib = await ensureTagLib();
    const file = await taglib.open(outputPath, { partial: true });
    assertNotEquals(file, null, "Should be able to open encoded M4A file");

    try {
      const properties = file!.properties() ?? {};
      const itunnorm = properties["appleSoundCheck"]?.[0]?.trim() ?? "";

      assertNotEquals(
        itunnorm,
        "",
        "Encoded M4A should contain non-empty ITUNNORM (SoundCheck) data",
      );
    } finally {
      file!.dispose();
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
