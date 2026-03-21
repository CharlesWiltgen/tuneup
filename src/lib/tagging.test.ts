import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { join } from "@std/path";
import { PROPERTIES } from "@charlesw/taglib-wasm";
import {
  hasMusicBrainzTags,
  type MusicBrainzIds,
  writeMusicBrainzTags,
} from "./tagging.ts";
import { ensureTagLib } from "./taglib_init.ts";
import { createSilentAudioFile } from "../test_utils/file_helpers.ts";

async function withTempAudioFile(fn: (tmpFile: string) => Promise<void>) {
  const tmpDir = await Deno.makeTempDir({ prefix: "tuneup-test-mb-" });
  try {
    const tmpFile = join(tmpDir, "test.wav");
    await createSilentAudioFile(tmpFile);
    await fn(tmpFile);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

describe("writeMusicBrainzTags", () => {
  it("should write and read back exact MusicBrainz IDs from a real audio file", async () => {
    await withTempAudioFile(async (testFile) => {
      const ids: MusicBrainzIds = {
        trackId: "12345678-1234-1234-1234-123456789abc",
        artistId: "abcdefab-abcd-abcd-abcd-abcdefabcdef",
        releaseId: "fedcba98-fedc-fedc-fedc-fedcba987654",
      };

      const result = await writeMusicBrainzTags(testFile, ids);
      assertEquals(result, true);

      const taglib = await ensureTagLib();
      const audioFile = await taglib.open(testFile, { partial: true });
      try {
        assertEquals(
          audioFile.getProperty(PROPERTIES.musicbrainzTrackId.key),
          ids.trackId,
        );
        assertEquals(
          audioFile.getProperty(PROPERTIES.musicbrainzArtistId.key),
          ids.artistId,
        );
        assertEquals(
          audioFile.getProperty(PROPERTIES.musicbrainzReleaseId.key),
          ids.releaseId,
        );
      } finally {
        audioFile.dispose();
      }
    });
  });

  it("should write only provided IDs when given partial input", async () => {
    await withTempAudioFile(async (testFile) => {
      const ids: MusicBrainzIds = {
        trackId: "12345678-1234-1234-1234-123456789abc",
      };
      const result = await writeMusicBrainzTags(testFile, ids);
      assertEquals(result, true);

      const taglib = await ensureTagLib();
      const audioFile = await taglib.open(testFile, { partial: true });
      try {
        assertEquals(
          audioFile.getProperty(PROPERTIES.musicbrainzTrackId.key),
          ids.trackId,
        );
        assertEquals(
          audioFile.getProperty(PROPERTIES.musicbrainzArtistId.key) ?? null,
          null,
        );
        assertEquals(
          audioFile.getProperty(PROPERTIES.musicbrainzReleaseId.key) ?? null,
          null,
        );
      } finally {
        audioFile.dispose();
      }
    });
  });

  it("should return true without writing when given empty IDs", async () => {
    await withTempAudioFile(async (testFile) => {
      const result = await writeMusicBrainzTags(testFile, {});
      assertEquals(result, true);

      const hasTags = await hasMusicBrainzTags(testFile);
      assertEquals(hasTags, false);
    });
  });
});

describe("hasMusicBrainzTags", () => {
  it("should return false for a file without MusicBrainz tags", async () => {
    await withTempAudioFile(async (testFile) => {
      const hasTags = await hasMusicBrainzTags(testFile);
      assertEquals(hasTags, false);
    });
  });
});
