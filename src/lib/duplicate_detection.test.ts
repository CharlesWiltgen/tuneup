import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  detectDuplicates,
  type FileQualityInfo,
  rankDuplicates,
} from "./duplicate_detection.ts";

describe("detectDuplicates", () => {
  it("should group files with the same acoustIdId", () => {
    const files: FileQualityInfo[] = [
      {
        path: "/a/song.flac",
        acoustIdId: "aid-1",
        recordingId: "rec-1",
        format: "flac",
        bitrate: 1411,
        tagCount: 8,
      },
      {
        path: "/b/song.mp3",
        acoustIdId: "aid-1",
        recordingId: "rec-1",
        format: "mp3",
        bitrate: 192,
        tagCount: 3,
      },
      {
        path: "/c/other.flac",
        acoustIdId: "aid-2",
        recordingId: "rec-2",
        format: "flac",
        bitrate: 1411,
        tagCount: 8,
      },
    ];
    const groups = detectDuplicates(files);
    assertEquals(groups.length, 1);
    assertEquals(groups[0].files.length, 2);
  });

  it("should group by recordingId when acoustIdId differs", () => {
    const files: FileQualityInfo[] = [
      {
        path: "/a/song.flac",
        acoustIdId: "aid-1",
        recordingId: "rec-1",
        format: "flac",
        bitrate: 1411,
        tagCount: 8,
      },
      {
        path: "/b/song.mp3",
        acoustIdId: "aid-99",
        recordingId: "rec-1",
        format: "mp3",
        bitrate: 192,
        tagCount: 3,
      },
    ];
    const groups = detectDuplicates(files);
    assertEquals(groups.length, 1);
    assertEquals(groups[0].files.length, 2);
  });

  it("should return no groups when no duplicates exist", () => {
    const files: FileQualityInfo[] = [
      {
        path: "/a/one.flac",
        acoustIdId: "aid-1",
        recordingId: "rec-1",
        format: "flac",
        bitrate: 1411,
        tagCount: 5,
      },
      {
        path: "/b/two.mp3",
        acoustIdId: "aid-2",
        recordingId: "rec-2",
        format: "mp3",
        bitrate: 320,
        tagCount: 5,
      },
    ];
    assertEquals(detectDuplicates(files).length, 0);
  });
});

describe("rankDuplicates", () => {
  it("should prefer lossless over lossy", () => {
    const group: FileQualityInfo[] = [
      {
        path: "/a/song.mp3",
        acoustIdId: "aid-1",
        recordingId: "rec-1",
        format: "mp3",
        bitrate: 320,
        tagCount: 8,
      },
      {
        path: "/b/song.flac",
        acoustIdId: "aid-1",
        recordingId: "rec-1",
        format: "flac",
        bitrate: 1411,
        tagCount: 8,
      },
    ];
    const ranked = rankDuplicates(group);
    assertEquals(ranked[0].path, "/b/song.flac");
  });

  it("should prefer higher bitrate within same format", () => {
    const group: FileQualityInfo[] = [
      {
        path: "/a/low.mp3",
        acoustIdId: "aid-1",
        recordingId: "rec-1",
        format: "mp3",
        bitrate: 128,
        tagCount: 5,
      },
      {
        path: "/b/high.mp3",
        acoustIdId: "aid-1",
        recordingId: "rec-1",
        format: "mp3",
        bitrate: 320,
        tagCount: 5,
      },
    ];
    const ranked = rankDuplicates(group);
    assertEquals(ranked[0].path, "/b/high.mp3");
  });

  it("should prefer better-tagged file as tiebreaker", () => {
    const group: FileQualityInfo[] = [
      {
        path: "/a/few-tags.flac",
        acoustIdId: "aid-1",
        recordingId: "rec-1",
        format: "flac",
        bitrate: 1411,
        tagCount: 2,
      },
      {
        path: "/b/many-tags.flac",
        acoustIdId: "aid-1",
        recordingId: "rec-1",
        format: "flac",
        bitrate: 1411,
        tagCount: 8,
      },
    ];
    const ranked = rankDuplicates(group);
    assertEquals(ranked[0].path, "/b/many-tags.flac");
  });
});
