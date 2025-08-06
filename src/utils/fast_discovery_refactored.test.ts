import { assertEquals, assertExists } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import {
  asDirectoryPath,
  asFilePath,
  buildFileMaps,
  detectAlreadyEncodedFiles,
  type FilePath,
  type SkippedFile as _SkippedFile,
  validateMpeg4Files,
} from "./fast_discovery_refactored.ts";

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

    // Both lossless files should be skipped
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

  // Note: Full testing of validateMpeg4Files requires mocking readMetadataBatch
  // which would be done in integration tests. Here we just test the interface.
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
