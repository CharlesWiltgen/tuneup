import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  ALBUM_RULES,
  type AlbumIndex,
  type AlbumIndexEntry,
  createLintSummary,
  FILE_METADATA_RULES,
  type FileMetadataForLint,
  type LintIssue,
  runAlbumRules,
  runFileMetadataRules,
  SEVERITY_ORDER,
} from "./lint.ts";

describe("SEVERITY_ORDER", () => {
  it("should rank error > warning > info", () => {
    assertEquals(SEVERITY_ORDER.error < SEVERITY_ORDER.info, true);
    assertEquals(SEVERITY_ORDER.warning < SEVERITY_ORDER.info, true);
    assertEquals(SEVERITY_ORDER.error < SEVERITY_ORDER.warning, true);
  });
});

describe("FILE_METADATA_RULES", () => {
  it("should contain all 11 per-file metadata rules", () => {
    const ruleNames = FILE_METADATA_RULES.map((r) => r.name);
    assertEquals(ruleNames, [
      "missing-title",
      "missing-artist",
      "missing-album",
      "missing-year",
      "missing-track-number",
      "missing-genre",
      "missing-cover-art",
      "missing-replaygain",
      "missing-acoustid",
      "suspicious-duration",
      "suspicious-bitrate",
    ]);
  });
});

describe("ALBUM_RULES", () => {
  it("should contain all 7 per-album consistency rules", () => {
    const ruleNames = ALBUM_RULES.map((r) => r.name);
    assertEquals(ruleNames, [
      "inconsistent-artist",
      "inconsistent-year",
      "track-number-gaps",
      "duplicate-track-number",
      "missing-disc-number",
      "mixed-formats",
      "mixed-sample-rates",
    ]);
  });
});

function makeFile(
  overrides: Partial<FileMetadataForLint> = {},
): FileMetadataForLint {
  return {
    path: "/music/test.mp3",
    title: "Test Song",
    artist: "Test Artist",
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
    ...overrides,
  };
}

describe("runFileMetadataRules", () => {
  it("should return no issues for a complete file", () => {
    const issues = runFileMetadataRules(makeFile());
    assertEquals(issues, []);
  });

  it("should flag missing title as error", () => {
    const issues = runFileMetadataRules(makeFile({ title: undefined }));
    assertEquals(issues.length, 1);
    assertEquals(issues[0].rule, "missing-title");
    assertEquals(issues[0].severity, "error");
  });

  it("should flag missing artist as error", () => {
    const issues = runFileMetadataRules(makeFile({ artist: undefined }));
    assertEquals(issues.length, 1);
    assertEquals(issues[0].rule, "missing-artist");
    assertEquals(issues[0].severity, "error");
  });

  it("should flag missing album as warning", () => {
    const issues = runFileMetadataRules(makeFile({ album: undefined }));
    assertEquals(issues.length, 1);
    assertEquals(issues[0].rule, "missing-album");
    assertEquals(issues[0].severity, "warning");
  });

  it("should flag suspicious short duration", () => {
    const issues = runFileMetadataRules(makeFile({ duration: 3 }));
    const durationIssue = issues.find((i) => i.rule === "suspicious-duration");
    assertEquals(durationIssue?.severity, "warning");
    assertEquals(durationIssue?.message.includes("3.0s"), true);
  });

  it("should flag suspicious long duration", () => {
    const issues = runFileMetadataRules(makeFile({ duration: 3600 }));
    const durationIssue = issues.find((i) => i.rule === "suspicious-duration");
    assertEquals(durationIssue?.severity, "warning");
    assertEquals(durationIssue?.message.includes("60min"), true);
  });

  it("should flag low bitrate only for lossy files", () => {
    const lossyIssues = runFileMetadataRules(
      makeFile({ bitrate: 32, isLossy: true }),
    );
    assertEquals(
      lossyIssues.some((i) => i.rule === "suspicious-bitrate"),
      true,
    );

    const losslessIssues = runFileMetadataRules(
      makeFile({ bitrate: 32, isLossy: false }),
    );
    assertEquals(
      losslessIssues.some((i) => i.rule === "suspicious-bitrate"),
      false,
    );
  });

  it("should flag all missing optional metadata as appropriate severities", () => {
    const bareFile = makeFile({
      album: undefined,
      year: undefined,
      track: undefined,
      genre: undefined,
      hasCoverArt: false,
      hasReplayGain: false,
      hasAcoustId: false,
    });
    const issues = runFileMetadataRules(bareFile);
    const ruleNames = issues.map((i) => i.rule);
    assertEquals(ruleNames.includes("missing-album"), true);
    assertEquals(ruleNames.includes("missing-year"), true);
    assertEquals(ruleNames.includes("missing-track-number"), true);
    assertEquals(ruleNames.includes("missing-genre"), true);
    assertEquals(ruleNames.includes("missing-cover-art"), true);
    assertEquals(ruleNames.includes("missing-replaygain"), true);
    assertEquals(ruleNames.includes("missing-acoustid"), true);
  });
});

function makeAlbumEntry(
  overrides: Partial<AlbumIndexEntry> = {},
): AlbumIndexEntry {
  return {
    albumArtists: new Set(["Test Artist"]),
    years: new Set([2024]),
    trackNumbers: new Map([[0, ["1", "2", "3"]]]),
    discNumbers: new Set(),
    formats: new Set(["lossy"]),
    sampleRates: new Set([44100]),
    directories: new Set(["/music/album"]),
    fileCount: 3,
    files: [
      "/music/album/01.mp3",
      "/music/album/02.mp3",
      "/music/album/03.mp3",
    ],
    ...overrides,
  };
}

describe("runAlbumRules", () => {
  it("should return no issues for a consistent album", () => {
    const index: AlbumIndex = new Map([["Test Album", makeAlbumEntry()]]);
    const issues = runAlbumRules(index);
    assertEquals(issues, []);
  });

  it("should flag inconsistent artists", () => {
    const index: AlbumIndex = new Map([
      [
        "Test Album",
        makeAlbumEntry({ albumArtists: new Set(["Artist A", "Artist B"]) }),
      ],
    ]);
    const issues = runAlbumRules(index);
    assertEquals(issues.some((i) => i.rule === "inconsistent-artist"), true);
  });

  it("should flag inconsistent years", () => {
    const index: AlbumIndex = new Map([
      ["Test Album", makeAlbumEntry({ years: new Set([2023, 2024]) })],
    ]);
    const issues = runAlbumRules(index);
    assertEquals(issues.some((i) => i.rule === "inconsistent-year"), true);
  });

  it("should detect track number gaps", () => {
    const index: AlbumIndex = new Map([
      [
        "Test Album",
        makeAlbumEntry({ trackNumbers: new Map([[0, ["1", "2", "4", "5"]]]) }),
      ],
    ]);
    const issues = runAlbumRules(index);
    const gapIssue = issues.find((i) => i.rule === "track-number-gaps");
    assertEquals(gapIssue?.message.includes("3"), true);
  });

  it("should detect duplicate track numbers", () => {
    const index: AlbumIndex = new Map([
      [
        "Test Album",
        makeAlbumEntry({ trackNumbers: new Map([[0, ["1", "2", "2", "3"]]]) }),
      ],
    ]);
    const issues = runAlbumRules(index);
    assertEquals(issues.some((i) => i.rule === "duplicate-track-number"), true);
  });

  it("should detect missing disc numbers when tracks repeat", () => {
    const index: AlbumIndex = new Map([
      [
        "Test Album",
        makeAlbumEntry({
          trackNumbers: new Map([[0, ["1", "2", "3", "1", "2"]]]),
          discNumbers: new Set(),
        }),
      ],
    ]);
    const issues = runAlbumRules(index);
    assertEquals(issues.some((i) => i.rule === "missing-disc-number"), true);
  });

  it("should not flag missing disc numbers when disc numbers are present", () => {
    const index: AlbumIndex = new Map([
      [
        "Test Album",
        makeAlbumEntry({
          trackNumbers: new Map([[1, ["1", "2", "3"]], [2, ["1", "2"]]]),
          discNumbers: new Set([1, 2]),
        }),
      ],
    ]);
    const issues = runAlbumRules(index);
    assertEquals(issues.some((i) => i.rule === "missing-disc-number"), false);
  });

  it("should check track gaps per-disc when disc numbers present", () => {
    const index: AlbumIndex = new Map([
      [
        "Test Album",
        makeAlbumEntry({
          trackNumbers: new Map([[1, ["1", "2", "4"]], [2, ["1", "2"]]]),
          discNumbers: new Set([1, 2]),
        }),
      ],
    ]);
    const issues = runAlbumRules(index);
    const gapIssue = issues.find((i) => i.rule === "track-number-gaps");
    assertEquals(gapIssue?.message.includes("disc 1"), true);
  });

  it("should flag mixed formats", () => {
    const index: AlbumIndex = new Map([
      [
        "Test Album",
        makeAlbumEntry({ formats: new Set(["lossy", "lossless"]) }),
      ],
    ]);
    const issues = runAlbumRules(index);
    assertEquals(issues.some((i) => i.rule === "mixed-formats"), true);
  });

  it("should flag mixed sample rates", () => {
    const index: AlbumIndex = new Map([
      [
        "Test Album",
        makeAlbumEntry({ sampleRates: new Set([44100, 96000]) }),
      ],
    ]);
    const issues = runAlbumRules(index);
    const rateIssue = issues.find((i) => i.rule === "mixed-sample-rates");
    assertEquals(rateIssue?.message.includes("44100Hz"), true);
    assertEquals(rateIssue?.message.includes("96000Hz"), true);
  });
});

describe("createLintSummary", () => {
  it("should correctly count issues by severity", () => {
    const issues: LintIssue[] = [
      {
        type: "issue",
        rule: "missing-title",
        severity: "error",
        file: "/a.mp3",
        message: "x",
      },
      {
        type: "issue",
        rule: "missing-album",
        severity: "warning",
        file: "/b.mp3",
        message: "x",
      },
      {
        type: "issue",
        rule: "missing-genre",
        severity: "info",
        file: "/b.mp3",
        message: "x",
      },
      {
        type: "issue",
        rule: "mixed-formats",
        severity: "info",
        album: "Album",
        message: "x",
      },
    ];
    const summary = createLintSummary(issues, 10);
    assertEquals(summary, {
      type: "summary",
      errors: 1,
      warnings: 1,
      info: 2,
      filesOk: 8,
      filesWithIssues: 2,
      albumIssues: 1,
    });
  });
});
