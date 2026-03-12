import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { addToAlbumIndex, classifyLossy } from "./lint_engine.ts";
import type { AlbumIndex, FileMetadataForLint } from "./lint.ts";

describe("classifyLossy", () => {
  it("should classify known lossy formats", () => {
    assertEquals(classifyLossy(".mp3", undefined), true);
    assertEquals(classifyLossy(".ogg", undefined), true);
    assertEquals(classifyLossy(".aac", undefined), true);
    assertEquals(classifyLossy(".opus", undefined), true);
    assertEquals(classifyLossy(".wma", undefined), true);
  });

  it("should classify known lossless formats", () => {
    assertEquals(classifyLossy(".wav", undefined), false);
    assertEquals(classifyLossy(".flac", undefined), false);
    assertEquals(classifyLossy(".alac", undefined), false);
  });

  it("should use isLossless for ambiguous formats", () => {
    assertEquals(classifyLossy(".m4a", true), false);
    assertEquals(classifyLossy(".m4a", false), true);
    assertEquals(classifyLossy(".m4a", undefined), true);
  });
});

describe("addToAlbumIndex", () => {
  it("should create a new album entry", () => {
    const index: AlbumIndex = new Map();
    const file: FileMetadataForLint = {
      path: "/music/album/01.mp3",
      title: "Song",
      artist: "Artist",
      albumArtist: "Album Artist",
      album: "Test Album",
      year: 2024,
      track: 1,
      genre: "Rock",
      hasCoverArt: true,
      hasReplayGain: true,
      hasAcoustId: true,
      duration: 180,
      bitrate: 320,
      sampleRate: 44100,
      channels: 2,
      codec: "MP3",
      containerFormat: "MP3",
      isLossy: true,
    };
    addToAlbumIndex(index, "test album", file);
    const entry = index.get("test album")!;
    assertEquals(entry.fileCount, 1);
    assertEquals(entry.albumArtists.has("Album Artist"), true);
    assertEquals(entry.years.has(2024), true);
    assertEquals(entry.formats.has("lossy"), true);
  });

  it("should accumulate across multiple files in same album", () => {
    const index: AlbumIndex = new Map();
    const base = {
      title: "Song",
      album: "Test Album",
      genre: "Rock",
      hasCoverArt: true,
      hasReplayGain: true,
      hasAcoustId: true,
      duration: 180,
      bitrate: 320,
      channels: 2,
      codec: "MP3",
      containerFormat: "MP3",
      isLossy: true,
    };
    addToAlbumIndex(index, "test album", {
      ...base,
      path: "/a/01.mp3",
      artist: "A",
      albumArtist: "AA",
      year: 2024,
      track: 1,
      sampleRate: 44100,
    });
    addToAlbumIndex(index, "test album", {
      ...base,
      path: "/a/02.mp3",
      artist: "B",
      albumArtist: "AA",
      year: 2024,
      track: 2,
      sampleRate: 44100,
    });
    const entry = index.get("test album")!;
    assertEquals(entry.fileCount, 2);
    assertEquals(entry.albumArtists.size, 1);
    assertEquals(entry.files.length, 2);
  });

  it("should use artist as fallback when albumArtist is missing", () => {
    const index: AlbumIndex = new Map();
    addToAlbumIndex(index, "test album", {
      path: "/a/01.mp3",
      title: "Song",
      artist: "Track Artist",
      album: "Test Album",
      year: 2024,
      track: 1,
      genre: "Rock",
      hasCoverArt: true,
      hasReplayGain: true,
      hasAcoustId: true,
      duration: 180,
      bitrate: 320,
      sampleRate: 44100,
      channels: 2,
      codec: "MP3",
      containerFormat: "MP3",
      isLossy: true,
    });
    const entry = index.get("test album")!;
    assertEquals(entry.albumArtists.has("Track Artist"), true);
  });
});
