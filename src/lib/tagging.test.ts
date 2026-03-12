import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { copy } from "@std/fs";
import { join } from "@std/path";
import {
  hasMusicBrainzTags,
  type MusicBrainzIds,
  writeMusicBrainzTags,
} from "./tagging.ts";

const FIXTURE_FILE =
  "/Users/Charles/Projects/amusic/tests/test_run_files/show_tags_none/clean.wav";

async function withTempCopy(fn: (tmpFile: string) => Promise<void>) {
  const tmpDir = await Deno.makeTempDir({ prefix: "amusic-test-mb-" });
  try {
    const tmpFile = join(tmpDir, "clean.wav");
    await copy(FIXTURE_FILE, tmpFile);
    await fn(tmpFile);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

describe("writeMusicBrainzTags", () => {
  it("should write and read back MusicBrainz IDs from a real audio file", async () => {
    await withTempCopy(async (testFile) => {
      const ids: MusicBrainzIds = {
        trackId: "12345678-1234-1234-1234-123456789abc",
        artistId: "abcdefab-abcd-abcd-abcd-abcdefabcdef",
        releaseId: "fedcba98-fedc-fedc-fedc-fedcba987654",
      };

      const result = await writeMusicBrainzTags(testFile, ids);
      assertEquals(result, true);

      const hasTags = await hasMusicBrainzTags(testFile);
      assertEquals(hasTags, true);
    });
  });

  it("should return true even when writing partial IDs", async () => {
    await withTempCopy(async (testFile) => {
      const ids: MusicBrainzIds = {
        trackId: "12345678-1234-1234-1234-123456789abc",
      };
      const result = await writeMusicBrainzTags(testFile, ids);
      assertEquals(result, true);
    });
  });
});

describe("hasMusicBrainzTags", () => {
  it("should return false for a file without MusicBrainz tags", async () => {
    const hasTags = await hasMusicBrainzTags(FIXTURE_FILE);
    assertEquals(hasTags, false);
  });
});
