import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  asDirectoryPath,
  asFilePath,
  buildFileMaps,
  buildScanResult,
  classifyDirectories,
  detectAlreadyEncodedFiles,
  type FilePath,
  mergeDiscSubfolders,
  type ScanResult,
  type SkippedFile as _SkippedFile,
  validateDiscMerge,
  validateMpeg4Files,
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

describe("buildFileMaps", () => {
  it("should create empty maps for empty input", () => {
    const result = buildFileMaps({ files: [] });

    assertEquals(result.byBaseName.size, 0);
    assertEquals(result.mpeg4Files.length, 0);
  });

  it("should group files by base name", () => {
    const files = [
      asFilePath("/music/song.mp3"),
      asFilePath("/music/song.flac"),
      asFilePath("/music/other.mp3"),
    ];

    const result = buildFileMaps({ files });

    assertEquals(result.byBaseName.size, 2);
    assertEquals(result.byBaseName.get("/music/song"), [
      asFilePath("/music/song.mp3"),
      asFilePath("/music/song.flac"),
    ]);
    assertEquals(result.byBaseName.get("/music/other"), [
      asFilePath("/music/other.mp3"),
    ]);
  });

  it("should identify MPEG-4 files", () => {
    const files = [
      asFilePath("/music/song.m4a"),
      asFilePath("/music/video.mp4"),
      asFilePath("/music/audio.mp3"),
      asFilePath("/music/Song.M4A"), // uppercase
    ];

    const result = buildFileMaps({ files });

    assertEquals(result.mpeg4Files.length, 3);
    assertEquals(result.mpeg4Files, [
      asFilePath("/music/song.m4a"),
      asFilePath("/music/video.mp4"),
      asFilePath("/music/Song.M4A"),
    ]);
  });

  it("should handle files without extensions", () => {
    const files = [
      asFilePath("/music/noext"),
      asFilePath("/music/.hidden"),
    ];

    const result = buildFileMaps({ files });

    assertEquals(result.byBaseName.size, 0);
    assertEquals(result.mpeg4Files.length, 0);
  });

  it("should handle complex paths with multiple dots", () => {
    const files = [
      asFilePath("/music/artist.name/song.title.mp3"),
      asFilePath("/music/artist.name/song.title.flac"),
    ];

    const result = buildFileMaps({ files });

    assertEquals(result.byBaseName.size, 1);
    assertEquals(result.byBaseName.get("/music/artist.name/song.title"), [
      asFilePath("/music/artist.name/song.title.mp3"),
      asFilePath("/music/artist.name/song.title.flac"),
    ]);
  });
});

describe("detectAlreadyEncodedFiles", () => {
  const createFileMaps = (files: FilePath[]) => buildFileMaps({ files });

  it("should not skip files when no lossy versions exist", () => {
    const files = [
      asFilePath("/music/song1.flac"),
      asFilePath("/music/song2.wav"),
    ];

    const result = detectAlreadyEncodedFiles({
      files,
      fileMaps: createFileMaps(files),
      aacFiles: new Set<FilePath>(),
    });

    assertEquals(result.filesToEncode, files);
    assertEquals(result.skippedFiles, []);
  });

  it("should skip lossless files with lossy counterparts", () => {
    const files = [
      asFilePath("/music/song.flac"),
      asFilePath("/music/song.mp3"),
    ];

    const result = detectAlreadyEncodedFiles({
      files,
      fileMaps: createFileMaps(files),
      aacFiles: new Set<FilePath>(),
    });

    assertEquals(result.filesToEncode, []);
    assertEquals(result.skippedFiles, [{
      path: "/music/song.flac",
      reason: "already-encoded",
      encodedPath: "/music/song.mp3",
    }]);
  });

  it("should skip lossless files with AAC M4A counterparts", () => {
    const files = [
      asFilePath("/music/song.flac"),
      asFilePath("/music/song.m4a"),
    ];
    const aacFiles = new Set([asFilePath("/music/song.m4a")]);

    const result = detectAlreadyEncodedFiles({
      files,
      fileMaps: createFileMaps(files),
      aacFiles,
    });

    assertEquals(result.filesToEncode, []);
    assertEquals(result.skippedFiles, [{
      path: "/music/song.flac",
      reason: "already-encoded",
      encodedPath: "/music/song.m4a",
    }]);
  });

  it("should not skip when forceEncode is true", () => {
    const files = [
      asFilePath("/music/song.flac"),
      asFilePath("/music/song.mp3"),
    ];

    const result = detectAlreadyEncodedFiles({
      files,
      fileMaps: createFileMaps(files),
      aacFiles: new Set<FilePath>(),
      forceEncode: true,
    });

    assertEquals(result.filesToEncode, [asFilePath("/music/song.flac")]);
    assertEquals(result.skippedFiles, []);
  });

  it("should include ALAC M4A files for encoding", () => {
    const files = [
      asFilePath("/music/song.m4a"), // Not in aacFiles, so it's ALAC
    ];

    const result = detectAlreadyEncodedFiles({
      files,
      fileMaps: createFileMaps(files),
      aacFiles: new Set<FilePath>(), // Empty, so m4a is ALAC
    });

    assertEquals(result.filesToEncode, [asFilePath("/music/song.m4a")]);
    assertEquals(result.skippedFiles, []);
  });

  it("should skip AAC M4A files", () => {
    const files = [
      asFilePath("/music/song.m4a"),
    ];
    const aacFiles = new Set([asFilePath("/music/song.m4a")]);

    const result = detectAlreadyEncodedFiles({
      files,
      fileMaps: createFileMaps(files),
      aacFiles,
    });

    assertEquals(result.filesToEncode, []);
    assertEquals(result.skippedFiles, []);
  });

  it("should ignore lossy formats", () => {
    const files = [
      asFilePath("/music/song.mp3"),
      asFilePath("/music/song.ogg"),
      asFilePath("/music/song.opus"),
    ];

    const result = detectAlreadyEncodedFiles({
      files,
      fileMaps: createFileMaps(files),
      aacFiles: new Set<FilePath>(),
    });

    assertEquals(result.filesToEncode, []);
    assertEquals(result.skippedFiles, []);
  });

  it("should handle multiple files with same base name", () => {
    const files = [
      asFilePath("/music/song.flac"),
      asFilePath("/music/song.wav"),
      asFilePath("/music/song.mp3"),
      asFilePath("/music/song.ogg"),
    ];

    const result = detectAlreadyEncodedFiles({
      files,
      fileMaps: createFileMaps(files),
      aacFiles: new Set<FilePath>(),
    });

    assertEquals(result.filesToEncode, []);
    assertEquals(result.skippedFiles.length, 2);

    const skippedPaths = result.skippedFiles.map((s) => s.path);
    assertEquals(skippedPaths.includes("/music/song.flac"), true);
    assertEquals(skippedPaths.includes("/music/song.wav"), true);
  });
});

describe("validateMpeg4Files", () => {
  it("should return empty results for empty input", async () => {
    const result = await validateMpeg4Files([]);

    assertEquals(result.aacSkipped, []);
    assertEquals(result.aacFiles.size, 0);
  });
});

describe("mergeDiscSubfolders", () => {
  it("should merge 'Disc 1' and 'Disc 2' subfolders into parent", () => {
    const filesByDir = new Map([
      ["/music/Album/Disc 1", ["track1.mp3", "track2.mp3"]],
      ["/music/Album/Disc 2", ["track3.mp3", "track4.mp3"]],
    ]);
    const result = mergeDiscSubfolders(filesByDir);
    assertEquals(result.get("/music/Album"), [
      "track1.mp3",
      "track2.mp3",
      "track3.mp3",
      "track4.mp3",
    ]);
    assertEquals(result.has("/music/Album/Disc 1"), false);
    assertEquals(result.has("/music/Album/Disc 2"), false);
  });

  it("should handle CD1, CD2 naming", () => {
    const filesByDir = new Map([
      ["/music/Album/CD1", ["track1.mp3"]],
      ["/music/Album/CD2", ["track2.mp3"]],
    ]);
    const result = mergeDiscSubfolders(filesByDir);
    assertEquals(result.get("/music/Album"), ["track1.mp3", "track2.mp3"]);
  });

  it("should handle case-insensitive disc patterns", () => {
    const filesByDir = new Map([
      ["/music/Album/disc 1", ["track1.mp3"]],
      ["/music/Album/DISK2", ["track2.mp3"]],
    ]);
    const result = mergeDiscSubfolders(filesByDir);
    assertEquals(result.get("/music/Album"), ["track1.mp3", "track2.mp3"]);
  });

  it("should not merge non-disc subfolders", () => {
    const filesByDir = new Map([
      ["/music/Album/Extras", ["bonus.mp3"]],
      ["/music/Album", ["track1.mp3"]],
    ]);
    const result = mergeDiscSubfolders(filesByDir);
    assertEquals(result.get("/music/Album"), ["track1.mp3"]);
    assertEquals(result.get("/music/Album/Extras"), ["bonus.mp3"]);
  });

  it("should preserve non-disc directories unchanged", () => {
    const filesByDir = new Map([
      ["/music/Singles", ["song1.mp3", "song2.mp3"]],
    ]);
    const result = mergeDiscSubfolders(filesByDir);
    assertEquals(result.get("/music/Singles"), ["song1.mp3", "song2.mp3"]);
  });

  it("should merge disc subfolders with parent that also has files", () => {
    const filesByDir = new Map([
      ["/music/Album", ["booklet.mp3"]],
      ["/music/Album/Disc 1", ["track1.mp3"]],
      ["/music/Album/Disc 2", ["track2.mp3"]],
    ]);
    const result = mergeDiscSubfolders(filesByDir);
    assertEquals(result.get("/music/Album"), [
      "booklet.mp3",
      "track1.mp3",
      "track2.mp3",
    ]);
  });
});

describe("validateDiscMerge", () => {
  it("should confirm merge when album names match across discs", () => {
    const discGroups = new Map([
      ["/album/Disc 1", { albumName: "The Wall", files: ["t1.mp3"] }],
      ["/album/Disc 2", { albumName: "The Wall", files: ["t2.mp3"] }],
    ]);
    const result = validateDiscMerge(discGroups);
    assertEquals(result.merged, [
      { parent: "/album", files: ["t1.mp3", "t2.mp3"] },
    ]);
    assertEquals(result.separate, []);
  });

  it("should keep discs separate when album names differ (box set)", () => {
    const discGroups = new Map([
      ["/box/Disc 1", { albumName: "Kind of Blue", files: ["t1.mp3"] }],
      ["/box/Disc 2", { albumName: "Bitches Brew", files: ["t2.mp3"] }],
    ]);
    const result = validateDiscMerge(discGroups);
    assertEquals(result.merged, []);
    assertEquals(result.separate, [
      { path: "/box/Disc 1", files: ["t1.mp3"] },
      { path: "/box/Disc 2", files: ["t2.mp3"] },
    ]);
  });

  it("should use normalized album names for comparison", () => {
    const discGroups = new Map([
      ["/album/Disc 1", { albumName: "The Wall", files: ["t1.mp3"] }],
      ["/album/Disc 2", { albumName: "the wall", files: ["t2.mp3"] }],
    ]);
    const result = validateDiscMerge(discGroups);
    assertEquals(result.merged.length, 1);
    assertEquals(result.merged[0].files, ["t1.mp3", "t2.mp3"]);
  });

  it("should handle multiple separate parents", () => {
    const discGroups = new Map([
      ["/albumA/Disc 1", { albumName: "Album A", files: ["a1.mp3"] }],
      ["/albumA/Disc 2", { albumName: "Album A", files: ["a2.mp3"] }],
      ["/albumB/CD1", { albumName: "Album B", files: ["b1.mp3"] }],
      ["/albumB/CD2", { albumName: "Album B", files: ["b2.mp3"] }],
    ]);
    const result = validateDiscMerge(discGroups);
    assertEquals(result.merged.length, 2);
    assertEquals(result.separate, []);
  });

  it("should handle mix of matching and non-matching parents", () => {
    const discGroups = new Map([
      ["/album/Disc 1", { albumName: "Same", files: ["a1.mp3"] }],
      ["/album/Disc 2", { albumName: "Same", files: ["a2.mp3"] }],
      ["/box/Disc 1", { albumName: "Different A", files: ["b1.mp3"] }],
      ["/box/Disc 2", { albumName: "Different B", files: ["b2.mp3"] }],
    ]);
    const result = validateDiscMerge(discGroups);
    assertEquals(result.merged.length, 1);
    assertEquals(result.merged[0].parent, "/album");
    assertEquals(result.separate.length, 2);
  });

  it("should merge a single disc subfolder into parent", () => {
    const discGroups = new Map([
      ["/album/Disc 1", { albumName: "The Wall", files: ["t1.mp3"] }],
    ]);
    const result = validateDiscMerge(discGroups);
    assertEquals(result.merged, [{ parent: "/album", files: ["t1.mp3"] }]);
    assertEquals(result.separate, []);
  });
});

describe("branded types", () => {
  it("should create FilePath from string", () => {
    const path = asFilePath("/music/song.mp3");
    assertExists(path);
    assertEquals(typeof path, "string");
  });

  it("should create DirectoryPath from string", () => {
    const path = asDirectoryPath("/music/");
    assertExists(path);
    assertEquals(typeof path, "string");
  });
});
