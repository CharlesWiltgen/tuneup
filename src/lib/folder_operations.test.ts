import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { AudioFileMetadata } from "@charlesw/taglib-wasm";
import {
  formatMetadataForDisplay,
  groupFilesByAlbum,
  groupFilesByDirectory,
} from "./folder_operations.ts";

function makeMetadata(
  path: string,
  overrides: Partial<AudioFileMetadata> = {},
): AudioFileMetadata {
  return {
    path,
    tags: { title: ["Test"], artist: ["Artist"], album: ["Album"] },
    properties: {
      duration: 180,
      bitrate: 320,
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 16,
      codec: "MP3",
      containerFormat: "MP3",
      isLossless: false,
    },
    ...overrides,
  } as AudioFileMetadata;
}

describe("groupFilesByAlbum", () => {
  it("should group files with the same album tag", () => {
    const files = [
      makeMetadata("/music/track1.mp3", {
        tags: { album: ["Album A"], title: ["T1"] },
      }),
      makeMetadata("/music/track2.mp3", {
        tags: { album: ["Album A"], title: ["T2"] },
      }),
      makeMetadata("/music/track3.mp3", {
        tags: { album: ["Album B"], title: ["T3"] },
      }),
    ];

    const result = groupFilesByAlbum(files as AudioFileMetadata[]);
    assertEquals(result.size, 2);
    assertEquals(result.get("Album A")?.length, 2);
    assertEquals(result.get("Album B")?.length, 1);
  });

  it("should group files without album tag under 'Unknown Album'", () => {
    const files = [
      makeMetadata("/music/track1.mp3", { tags: { title: ["T1"] } }),
      makeMetadata("/music/track2.mp3", { tags: { title: ["T2"] } }),
    ];

    const result = groupFilesByAlbum(files as AudioFileMetadata[]);
    assertEquals(result.size, 1);
    assertEquals(result.get("Unknown Album")?.length, 2);
  });

  it("should return empty map for empty input", () => {
    const result = groupFilesByAlbum([]);
    assertEquals(result.size, 0);
  });
});

describe("groupFilesByDirectory", () => {
  it("should group files by their parent directory", () => {
    const files = [
      makeMetadata("/music/albumA/track1.mp3"),
      makeMetadata("/music/albumA/track2.mp3"),
      makeMetadata("/music/albumB/track1.mp3"),
    ];

    const result = groupFilesByDirectory(files as AudioFileMetadata[]);
    assertEquals(result.size, 2);
    assertEquals(result.get("/music/albumA")?.length, 2);
    assertEquals(result.get("/music/albumB")?.length, 1);
  });

  it("should return empty map for empty input", () => {
    const result = groupFilesByDirectory([]);
    assertEquals(result.size, 0);
  });
});

describe("formatMetadataForDisplay", () => {
  it("should extract basic tags", () => {
    const metadata = makeMetadata("/music/song.mp3", {
      tags: {
        title: ["My Song"],
        artist: ["The Band"],
        album: ["Greatest Hits"],
        year: 2020,
        track: 5,
        genre: ["Rock"],
        comment: ["A comment"],
      },
    });

    const result = formatMetadataForDisplay(metadata as AudioFileMetadata);
    assertEquals(result.title, "My Song");
    assertEquals(result.artist, "The Band");
    assertEquals(result.album, "Greatest Hits");
    assertEquals(result.year, 2020);
    assertEquals(result.track, 5);
    assertEquals(result.genre, "Rock");
    assertEquals(result.comment, "A comment");
  });

  it("should extract audio properties", () => {
    const metadata = makeMetadata("/music/song.mp3", {
      properties: {
        duration: 240,
        bitrate: 256,
        sampleRate: 48000,
        channels: 2,
        bitsPerSample: 16,
        codec: "MP3",
        containerFormat: "MP3",
        isLossless: false,
      },
    });

    const result = formatMetadataForDisplay(metadata as AudioFileMetadata);
    assertEquals(result.duration, 240);
    assertEquals(result.bitrate, 256);
    assertEquals(result.sampleRate, 48000);
    assertEquals(result.channels, 2);
  });

  it("should handle metadata with no tags", () => {
    const metadata = makeMetadata("/music/song.mp3", {
      tags: undefined,
      properties: undefined,
    });

    const result = formatMetadataForDisplay(metadata as AudioFileMetadata);
    assertEquals(result, {});
  });
});
