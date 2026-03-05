import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  buildScanResult,
  classifyDirectories,
  type ScanResult,
} from "./fast_discovery.ts";

function makeScanResult(filesByDirEntries: [string, string[]][]): ScanResult {
  const allFiles = filesByDirEntries.flatMap(([_, files]) => files);
  return buildScanResult(allFiles);
}

describe("classifyDirectories", () => {
  it("should classify directories with multiple files as albums", () => {
    const scan = makeScanResult([
      ["/music/albumA", [
        "/music/albumA/track1.mp3",
        "/music/albumA/track2.mp3",
      ]],
    ]);

    const result = classifyDirectories(scan);
    assertEquals(result.albums.size, 1);
    assertEquals(result.albums.get("/music/albumA")?.length, 2);
    assertEquals(result.singles.length, 0);
  });

  it("should classify single-file directories as singles", () => {
    const scan = makeScanResult([
      ["/music/random", ["/music/random/song.mp3"]],
    ]);

    const result = classifyDirectories(scan);
    assertEquals(result.albums.size, 0);
    assertEquals(result.singles.length, 1);
    assertEquals(result.singles[0], "/music/random/song.mp3");
  });

  it("should classify directories matching 'singles' pattern as singles", () => {
    const scan = makeScanResult([
      ["/music/singles", [
        "/music/singles/track1.mp3",
        "/music/singles/track2.mp3",
      ]],
    ]);

    const result = classifyDirectories(scan);
    assertEquals(result.albums.size, 0);
    assertEquals(result.singles.length, 2);
  });

  it("should classify directories matching 'misc' pattern as singles", () => {
    const scan = makeScanResult([
      ["/music/misc", [
        "/music/misc/track1.mp3",
        "/music/misc/track2.mp3",
      ]],
    ]);

    const result = classifyDirectories(scan);
    assertEquals(result.albums.size, 0);
    assertEquals(result.singles.length, 2);
  });

  it("should match custom single patterns", () => {
    const scan = makeScanResult([
      ["/music/loose tracks", [
        "/music/loose tracks/a.mp3",
        "/music/loose tracks/b.mp3",
      ]],
    ]);

    const result = classifyDirectories(scan, ["loose tracks"]);
    assertEquals(result.albums.size, 0);
    assertEquals(result.singles.length, 2);
  });

  it("should handle mixed albums and singles", () => {
    const scan = makeScanResult([
      ["/music/albumA", [
        "/music/albumA/track1.mp3",
        "/music/albumA/track2.mp3",
        "/music/albumA/track3.mp3",
      ]],
      ["/music/random", ["/music/random/lonely.mp3"]],
    ]);

    const result = classifyDirectories(scan);
    assertEquals(result.albums.size, 1);
    assertEquals(result.singles.length, 1);
  });

  it("should return empty results for empty scan", () => {
    const scan = makeScanResult([]);
    const result = classifyDirectories(scan);
    assertEquals(result.albums.size, 0);
    assertEquals(result.singles.length, 0);
  });
});

describe("buildScanResult", () => {
  it("should group files by directory", () => {
    const files = [
      "/music/albumA/track1.mp3",
      "/music/albumA/track2.mp3",
      "/music/albumB/track1.flac",
    ];

    const result = buildScanResult(files);
    assertEquals(result.filesByDir.size, 2);
    assertEquals(result.filesByDir.get("/music/albumA")?.length, 2);
    assertEquals(result.filesByDir.get("/music/albumB")?.length, 1);
    assertEquals(result.allFiles.length, 3);
  });

  it("should detect subdirectories", () => {
    const files = [
      "/music/artist/album/track.mp3",
      "/music/artist/single.mp3",
    ];

    const result = buildScanResult(files);
    const artistInfo = result.dirInfo.get("/music/artist");
    assertEquals(artistInfo?.hasSubdirs, true);

    const albumInfo = result.dirInfo.get("/music/artist/album");
    assertEquals(albumInfo?.hasSubdirs, false);
  });

  it("should handle empty file list", () => {
    const result = buildScanResult([]);
    assertEquals(result.filesByDir.size, 0);
    assertEquals(result.allFiles.length, 0);
  });

  it("should calculate directory depth", () => {
    const files = ["/a/b/c/track.mp3"];
    const result = buildScanResult(files);
    const dirInfo = result.dirInfo.get("/a/b/c");
    assertEquals(dirInfo?.depth, 3);
  });
});
