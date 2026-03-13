import { assertEquals, assertNotEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  generateSoundCheck,
  hasSoundCheckTag,
  processSoundCheck,
} from "./soundcheck.ts";
import { encodeToM4A } from "./encoding.ts";

const SAMPLE_FLAC = "sample_audio_files/flac_sample_3mb.flac";

describe("hasSoundCheckTag", () => {
  it("should return false for file without ITUNNORM", async () => {
    const result = await hasSoundCheckTag(SAMPLE_FLAC);
    assertEquals(result, false);
  });

  it({
    name: "should return true for file with ITUNNORM",
    ignore: Deno.build.os !== "darwin",
    fn: async () => {
      const tempDir = await Deno.makeTempDir({
        prefix: "soundcheck-has-tag-",
      });
      const outputPath = `${tempDir}/output.m4a`;

      try {
        await encodeToM4A(SAMPLE_FLAC, outputPath);
        const result = await hasSoundCheckTag(outputPath);
        assertEquals(result, true);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    },
  });
});

describe("generateSoundCheck", () => {
  it({
    name: "should return non-empty ITUNNORM string from FLAC",
    ignore: Deno.build.os !== "darwin",
    fn: async () => {
      const itunnorm = await generateSoundCheck(SAMPLE_FLAC);

      assertNotEquals(itunnorm, null, "Should return an ITUNNORM value");
      assertNotEquals(itunnorm!, "", "ITUNNORM should be non-empty");
    },
  });
});

describe("processSoundCheck", () => {
  it({
    name: "should generate and write ITUNNORM to a file",
    ignore: Deno.build.os !== "darwin",
    fn: async () => {
      const tempDir = await Deno.makeTempDir({
        prefix: "soundcheck-process-",
      });
      const testCopy = `${tempDir}/test.flac`;

      try {
        await Deno.copyFile(SAMPLE_FLAC, testCopy);

        const status = await processSoundCheck(testCopy, {
          force: false,
          quiet: true,
          dryRun: false,
        });

        assertEquals(status, "processed");
        assertEquals(await hasSoundCheckTag(testCopy), true);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    },
  });

  it({
    name: "should skip file that already has ITUNNORM",
    ignore: Deno.build.os !== "darwin",
    fn: async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "soundcheck-skip-" });
      const testCopy = `${tempDir}/test.flac`;

      try {
        await Deno.copyFile(SAMPLE_FLAC, testCopy);

        const firstStatus = await processSoundCheck(testCopy, {
          force: false,
          quiet: true,
          dryRun: false,
        });
        assertEquals(firstStatus, "processed");

        const secondStatus = await processSoundCheck(testCopy, {
          force: false,
          quiet: true,
          dryRun: false,
        });
        assertEquals(secondStatus, "skipped");
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    },
  });

  it({
    name: "should overwrite when force is true",
    ignore: Deno.build.os !== "darwin",
    fn: async () => {
      const tempDir = await Deno.makeTempDir({ prefix: "soundcheck-force-" });
      const testCopy = `${tempDir}/test.flac`;

      try {
        await Deno.copyFile(SAMPLE_FLAC, testCopy);

        await processSoundCheck(testCopy, {
          force: false,
          quiet: true,
          dryRun: false,
        });

        const status = await processSoundCheck(testCopy, {
          force: true,
          quiet: true,
          dryRun: false,
        });
        assertEquals(status, "processed");
        assertEquals(await hasSoundCheckTag(testCopy), true);
      } finally {
        await Deno.remove(tempDir, { recursive: true });
      }
    },
  });
});
