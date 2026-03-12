# Lint Command Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this
> plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `amusic lint` command that scans music libraries for tagging
problems, inconsistencies, and file integrity issues.

**Architecture:** Streaming two-phase engine — Phase 1 iterates files via
taglib-wasm batch API running per-file rules and building a lightweight album
index; Phase 2 iterates the album index running consistency rules. Output is
JSONL or formatted terminal text.

**Tech Stack:** Deno, taglib-wasm batch API, Cliffy CLI, @std/testing/bdd

**Spec:** `docs/superpowers/specs/2026-03-12-lint-command-design.md`

---

## Chunk 1: Core Types, Rules, and Unit Tests

### Task 1: LintIssue type and rule registry

**Files:**

- Create: `src/lib/lint.ts`
- Create: `src/lib/lint.test.ts`

- [ ] **Step 1: Write the failing tests for rule definitions**

In `src/lib/lint.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  ALBUM_RULES,
  type AlbumIndex,
  createLintSummary,
  FILE_METADATA_RULES,
  type FileMetadataForLint,
  type LintIssue,
  type LintSummary,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read --allow-env src/lib/lint.test.ts` Expected: FAIL
(module not found)

- [ ] **Step 3: Write types and rule registry skeleton**

In `src/lib/lint.ts`:

```ts
export type Severity = "error" | "warning" | "info";

export type LintIssue = {
  type: "issue";
  rule: string;
  severity: Severity;
  file?: string;
  album?: string;
  message: string;
};

export type LintSummary = {
  type: "summary";
  errors: number;
  warnings: number;
  info: number;
  filesOk: number;
  filesWithIssues: number;
  albumIssues: number;
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export type FileMetadataForLint = {
  path: string;
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  year?: number;
  track?: number;
  discNumber?: number;
  genre?: string;
  hasCoverArt: boolean;
  hasReplayGain: boolean;
  hasAcoustId: boolean;
  duration?: number;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  codec?: string;
  containerFormat?: string;
  isLossy: boolean;
};

export type AlbumIndexEntry = {
  albumArtists: Set<string>;
  years: Set<number>;
  trackNumbers: Map<number, string[]>; // discNumber (0 if unknown) -> track number strings
  discNumbers: Set<number>;
  formats: Set<string>; // "lossy" | "lossless"
  sampleRates: Set<number>;
  directories: Set<string>;
  fileCount: number;
  files: string[];
};

export type AlbumIndex = Map<string, AlbumIndexEntry>;

type FileRule = {
  name: string;
  severity: Severity;
  check: (file: FileMetadataForLint) => string | undefined;
};

type AlbumRule = {
  name: string;
  severity: Severity;
  check: (albumName: string, entry: AlbumIndexEntry) => LintIssue[];
};

export const FILE_METADATA_RULES: FileRule[] = [
  {
    name: "missing-title",
    severity: "error",
    check: (f) => !f.title ? "No title tag" : undefined,
  },
  {
    name: "missing-artist",
    severity: "error",
    check: (f) => !f.artist ? "No artist tag" : undefined,
  },
  {
    name: "missing-album",
    severity: "warning",
    check: (f) => !f.album ? "No album tag" : undefined,
  },
  {
    name: "missing-year",
    severity: "warning",
    check: (f) => !f.year ? "No year tag" : undefined,
  },
  {
    name: "missing-track-number",
    severity: "warning",
    check: (f) => !f.track ? "No track number" : undefined,
  },
  {
    name: "missing-genre",
    severity: "info",
    check: (f) => !f.genre ? "No genre tag" : undefined,
  },
  {
    name: "missing-cover-art",
    severity: "warning",
    check: (f) => !f.hasCoverArt ? "No embedded cover art" : undefined,
  },
  {
    name: "missing-replaygain",
    severity: "info",
    check: (f) => !f.hasReplayGain ? "No ReplayGain tags" : undefined,
  },
  {
    name: "missing-acoustid",
    severity: "info",
    check: (f) => !f.hasAcoustId ? "No AcoustID fingerprint/ID" : undefined,
  },
  {
    name: "suspicious-duration",
    severity: "warning",
    check: (f) => {
      if (!f.duration) return undefined;
      if (f.duration < 5) {
        return `Duration ${f.duration.toFixed(1)}s is unusually short (< 5s)`;
      }
      if (f.duration > 2700) {
        return `Duration ${
          (f.duration / 60).toFixed(0)
        }min is unusually long (> 45min)`;
      }
      return undefined;
    },
  },
  {
    name: "suspicious-bitrate",
    severity: "warning",
    check: (f) => {
      if (!f.isLossy || !f.bitrate) return undefined;
      if (f.bitrate < 64) {
        return `Bitrate ${f.bitrate}kbps is unusually low (< 64kbps)`;
      }
      return undefined;
    },
  },
];

export const ALBUM_RULES: AlbumRule[] = [
  {
    name: "inconsistent-artist",
    severity: "warning",
    check: (albumName, entry) => {
      if (entry.albumArtists.size <= 1) return [];
      const artists = [...entry.albumArtists].join(", ");
      return [{
        type: "issue",
        rule: "inconsistent-artist",
        severity: "warning",
        album: albumName,
        message: `Multiple album artists: ${artists}`,
      }];
    },
  },
  {
    name: "inconsistent-year",
    severity: "warning",
    check: (albumName, entry) => {
      if (entry.years.size <= 1) return [];
      const years = [...entry.years].sort().join(", ");
      return [{
        type: "issue",
        rule: "inconsistent-year",
        severity: "warning",
        album: albumName,
        message: `Mixed years: ${years}`,
      }];
    },
  },
  {
    name: "track-number-gaps",
    severity: "warning",
    check: (albumName, entry) => {
      const issues: LintIssue[] = [];
      const discs = entry.discNumbers.size > 0 ? [...entry.discNumbers] : [0];
      for (const disc of discs) {
        const tracks = entry.trackNumbers.get(disc);
        if (!tracks || tracks.length < 2) continue;
        const nums = tracks.map((t) => parseInt(t)).filter((n) => !isNaN(n))
          .sort((a, b) => a - b);
        if (nums.length < 2) continue;
        const missing: number[] = [];
        for (let i = nums[0]; i <= nums[nums.length - 1]; i++) {
          if (!nums.includes(i)) missing.push(i);
        }
        if (missing.length > 0) {
          const discLabel = disc > 0 ? ` (disc ${disc})` : "";
          issues.push({
            type: "issue",
            rule: "track-number-gaps",
            severity: "warning",
            album: albumName,
            message: `Missing track${missing.length > 1 ? "s" : ""} ${
              missing.join(", ")
            } in sequence ${nums[0]}-${nums[nums.length - 1]}${discLabel}`,
          });
        }
      }
      return issues;
    },
  },
  {
    name: "duplicate-track-number",
    severity: "error",
    check: (albumName, entry) => {
      const issues: LintIssue[] = [];
      const discs = entry.discNumbers.size > 0 ? [...entry.discNumbers] : [0];
      for (const disc of discs) {
        const tracks = entry.trackNumbers.get(disc);
        if (!tracks) continue;
        const seen = new Map<string, number>();
        for (const t of tracks) {
          seen.set(t, (seen.get(t) ?? 0) + 1);
        }
        for (const [trackNum, count] of seen) {
          if (count > 1) {
            const discLabel = disc > 0 ? ` on disc ${disc}` : "";
            issues.push({
              type: "issue",
              rule: "duplicate-track-number",
              severity: "error",
              album: albumName,
              message: `Track ${trackNum} appears ${count} times${discLabel}`,
            });
          }
        }
      }
      return issues;
    },
  },
  {
    name: "missing-disc-number",
    severity: "warning",
    check: (albumName, entry) => {
      if (entry.discNumbers.size > 0) return [];
      const allTracks = entry.trackNumbers.get(0);
      if (!allTracks) return [];
      const seen = new Set<string>();
      let hasDuplicates = false;
      for (const t of allTracks) {
        if (seen.has(t)) {
          hasDuplicates = true;
          break;
        }
        seen.add(t);
      }
      if (!hasDuplicates) return [];
      return [{
        type: "issue",
        rule: "missing-disc-number",
        severity: "warning",
        album: albumName,
        message:
          "Duplicate track numbers detected but no disc number tags — possible multi-disc album",
      }];
    },
  },
  {
    name: "mixed-formats",
    severity: "info",
    check: (albumName, entry) => {
      if (entry.formats.size <= 1) return [];
      return [{
        type: "issue",
        rule: "mixed-formats",
        severity: "info",
        album: albumName,
        message: "Album contains both lossy and lossless files",
      }];
    },
  },
  {
    name: "mixed-sample-rates",
    severity: "warning",
    check: (albumName, entry) => {
      if (entry.sampleRates.size <= 1) return [];
      const rates = [...entry.sampleRates].sort((a, b) => a - b).map((r) =>
        `${r}Hz`
      ).join(", ");
      return [{
        type: "issue",
        rule: "mixed-sample-rates",
        severity: "warning",
        album: albumName,
        message: `Mixed sample rates: ${rates}`,
      }];
    },
  },
];

export function runFileMetadataRules(file: FileMetadataForLint): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const rule of FILE_METADATA_RULES) {
    const message = rule.check(file);
    if (message) {
      issues.push({
        type: "issue",
        rule: rule.name,
        severity: rule.severity,
        file: file.path,
        message,
      });
    }
  }
  return issues;
}

export function runAlbumRules(albumIndex: AlbumIndex): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const [albumName, entry] of albumIndex) {
    for (const rule of ALBUM_RULES) {
      issues.push(...rule.check(albumName, entry));
    }
  }
  return issues;
}

export function createLintSummary(
  issues: LintIssue[],
  totalFiles: number,
): LintSummary {
  let errors = 0, warnings = 0, info = 0;
  const filesWithIssues = new Set<string>();
  let albumIssues = 0;

  for (const issue of issues) {
    if (issue.severity === "error") errors++;
    else if (issue.severity === "warning") warnings++;
    else info++;

    if (issue.file) filesWithIssues.add(issue.file);
    if (issue.album && !issue.file) albumIssues++;
  }

  return {
    type: "summary",
    errors,
    warnings,
    info,
    filesOk: totalFiles - filesWithIssues.size,
    filesWithIssues: filesWithIssues.size,
    albumIssues,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read --allow-env src/lib/lint.test.ts` Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/lint.ts src/lib/lint.test.ts
git commit -m "feat(lint): add core types, rule registry, and rule definitions"
```

### Task 2: Per-file rule unit tests

**Files:**

- Modify: `src/lib/lint.test.ts`

- [ ] **Step 1: Write tests for per-file metadata rules**

Add to `src/lib/lint.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `deno test --allow-read --allow-env src/lib/lint.test.ts` Expected: PASS
(rules are already implemented)

- [ ] **Step 3: Commit**

```bash
git add src/lib/lint.test.ts
git commit -m "test(lint): add per-file metadata rule unit tests"
```

### Task 3: Per-album rule unit tests

**Files:**

- Modify: `src/lib/lint.test.ts`

- [ ] **Step 1: Write tests for per-album consistency rules**

Add to `src/lib/lint.test.ts`:

```ts
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
      ["Test Album", makeAlbumEntry({ sampleRates: new Set([44100, 96000]) })],
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
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `deno test --allow-read --allow-env src/lib/lint.test.ts` Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/lib/lint.test.ts
git commit -m "test(lint): add per-album consistency rule and summary unit tests"
```

---

## Chunk 2: Media Validation and Lint Engine

### Task 4: Media validation module (--deep)

**Files:**

- Create: `src/lib/lint_media.ts`
- Create: `src/lib/lint_media.test.ts`

- [ ] **Step 1: Write failing tests for header detection**

In `src/lib/lint_media.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { detectFormatFromHeader, validateFileHeader } from "./lint_media.ts";
import type { LintIssue } from "./lint.ts";

describe("detectFormatFromHeader", () => {
  it("should detect MP3 with ID3 header", () => {
    const buf = new Uint8Array([
      0x49,
      0x44,
      0x33,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "mp3");
  });

  it("should detect MP3 MPEG sync bytes (0xFF 0xFB)", () => {
    const buf = new Uint8Array([
      0xFF,
      0xFB,
      0x90,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "mp3");
  });

  it("should detect MP3 MPEG sync bytes (0xFF 0xE0 mask)", () => {
    // MPEG2 Layer III frame sync
    const buf = new Uint8Array([
      0xFF,
      0xE3,
      0x90,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "mp3");
  });

  it("should detect FLAC", () => {
    const buf = new Uint8Array([
      0x66,
      0x4C,
      0x61,
      0x43,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "flac");
  });

  it("should detect OGG", () => {
    const buf = new Uint8Array([
      0x4F,
      0x67,
      0x67,
      0x53,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "ogg");
  });

  it("should detect M4A/MP4 (ftyp at offset 4)", () => {
    const buf = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x20,
      0x66,
      0x74,
      0x79,
      0x70,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "m4a");
  });

  it("should detect WAV (RIFF)", () => {
    const buf = new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "wav");
  });

  it("should return null for unknown format", () => {
    const buf = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), null);
  });
});

describe("validateFileHeader", () => {
  it("should return invalid-header for unrecognized format", () => {
    const buf = new Uint8Array(12);
    const issues = validateFileHeader("/test/file.mp3", ".mp3", buf);
    assertEquals(issues.length, 1);
    assertEquals(issues[0].rule, "invalid-header");
    assertEquals(issues[0].severity, "error");
  });

  it("should return extension-mismatch when header differs from extension", () => {
    // FLAC header but .mp3 extension
    const buf = new Uint8Array([
      0x66,
      0x4C,
      0x61,
      0x43,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    const issues = validateFileHeader("/test/file.mp3", ".mp3", buf);
    assertEquals(issues.length, 1);
    assertEquals(issues[0].rule, "extension-mismatch");
    assertEquals(issues[0].severity, "warning");
  });

  it("should return no issues when header matches extension", () => {
    // FLAC header with .flac extension
    const buf = new Uint8Array([
      0x66,
      0x4C,
      0x61,
      0x43,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    const issues = validateFileHeader("/test/file.flac", ".flac", buf);
    assertEquals(issues, []);
  });

  it("should treat m4a and mp4 as equivalent for ftyp header", () => {
    const buf = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x20,
      0x66,
      0x74,
      0x79,
      0x70,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(validateFileHeader("/test/file.m4a", ".m4a", buf), []);
    assertEquals(validateFileHeader("/test/file.mp4", ".mp4", buf), []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read --allow-env src/lib/lint_media.test.ts` Expected:
FAIL (module not found)

- [ ] **Step 3: Write the media validation module**

In `src/lib/lint_media.ts`:

```ts
import type { LintIssue } from "./lint.ts";

const EXTENSION_TO_FORMATS: Record<string, string[]> = {
  ".mp3": ["mp3"],
  ".flac": ["flac"],
  ".ogg": ["ogg"],
  ".m4a": ["m4a"],
  ".mp4": ["m4a"],
  ".wav": ["wav"],
  ".aac": ["mp3", "m4a"], // AAC can appear in ADTS (mp3-like sync) or M4A containers
  ".opus": ["ogg"],
  ".wma": [], // WMA header detection not implemented
  ".alac": ["m4a"],
};

export function detectFormatFromHeader(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;

  // MP3: ID3 tag header
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return "mp3";

  // MP3: MPEG audio frame sync (top 11 bits set = 0xFFE0 mask)
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return "mp3";

  // FLAC: "fLaC"
  if (
    buf[0] === 0x66 && buf[1] === 0x4C && buf[2] === 0x61 && buf[3] === 0x43
  ) return "flac";

  // OGG: "OggS"
  if (
    buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53
  ) return "ogg";

  // M4A/MP4: "ftyp" at offset 4
  if (
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70
  ) return "m4a";

  // WAV: "RIFF"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
  ) return "wav";

  return null;
}

export function validateFileHeader(
  filePath: string,
  ext: string,
  headerBytes: Uint8Array,
): LintIssue[] {
  const detectedFormat = detectFormatFromHeader(headerBytes);

  if (!detectedFormat) {
    return [{
      type: "issue",
      rule: "invalid-header",
      severity: "error",
      file: filePath,
      message: `File header does not match any known audio format`,
    }];
  }

  const extLower = ext.toLowerCase();
  const expectedFormats = EXTENSION_TO_FORMATS[extLower] ?? [];

  if (expectedFormats.length > 0 && !expectedFormats.includes(detectedFormat)) {
    return [{
      type: "issue",
      rule: "extension-mismatch",
      severity: "warning",
      file: filePath,
      message:
        `File header indicates ${detectedFormat} but extension is ${extLower}`,
    }];
  }

  return [];
}

export async function readFileHeader(filePath: string): Promise<Uint8Array> {
  const file = await Deno.open(filePath, { read: true });
  try {
    const buf = new Uint8Array(12);
    await file.read(buf);
    return buf;
  } finally {
    file.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read --allow-env src/lib/lint_media.test.ts` Expected:
PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/lint_media.ts src/lib/lint_media.test.ts
git commit -m "feat(lint): add media header validation for --deep mode"
```

### Task 5: Lint engine (streaming orchestrator)

**Files:**

- Create: `src/lib/lint_engine.ts`
- Create: `src/lib/lint_engine.test.ts`

- [ ] **Step 1: Write failing test for album index building**

In `src/lib/lint_engine.test.ts`:

```ts
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
    assertEquals(classifyLossy(".m4a", undefined), true); // default to lossy
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
    assertEquals(entry.albumArtists.size, 1); // Same albumArtist
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
      duration: 180000,
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read --allow-env src/lib/lint_engine.test.ts` Expected:
FAIL (module not found)

- [ ] **Step 3: Write the lint engine**

In `src/lib/lint_engine.ts`:

```ts
import { readMetadataBatch } from "@charlesw/taglib-wasm/simple";
import { dirname, extname } from "@std/path";
import { normalizeForMatching } from "../utils/normalize.ts";
import {
  type AlbumIndex,
  type AlbumIndexEntry,
  createLintSummary,
  type FileMetadataForLint,
  type LintIssue,
  type LintSummary,
  runAlbumRules,
  runFileMetadataRules,
  type Severity,
  SEVERITY_ORDER,
} from "./lint.ts";
import { readFileHeader, validateFileHeader } from "./lint_media.ts";

const LOSSY_EXTENSIONS = new Set([".mp3", ".ogg", ".aac", ".opus", ".wma"]);
const LOSSLESS_EXTENSIONS = new Set([".wav", ".flac", ".alac"]);

export type LintOptions = {
  deep: boolean;
  severity: Severity;
  quiet: boolean;
  json: boolean;
};

export type LintResult = {
  issues: LintIssue[];
  summary: LintSummary;
};

export function classifyLossy(ext: string, isLossless?: boolean): boolean {
  const extLower = ext.toLowerCase();
  if (LOSSY_EXTENSIONS.has(extLower)) return true;
  if (LOSSLESS_EXTENSIONS.has(extLower)) return false;
  // Ambiguous (m4a, mp4): use audioProperties if available
  return !(isLossless ?? false);
}

export function addToAlbumIndex(
  index: AlbumIndex,
  normalizedAlbum: string,
  file: FileMetadataForLint,
): void {
  let entry = index.get(normalizedAlbum);
  if (!entry) {
    entry = {
      albumArtists: new Set(),
      years: new Set(),
      trackNumbers: new Map(),
      discNumbers: new Set(),
      formats: new Set(),
      sampleRates: new Set(),
      directories: new Set(),
      fileCount: 0,
      files: [],
    };
    index.set(normalizedAlbum, entry);
  }

  const artist = file.albumArtist || file.artist;
  if (artist) entry.albumArtists.add(artist);
  if (file.year) entry.years.add(file.year);

  const disc = file.discNumber ?? 0;
  if (file.discNumber) entry.discNumbers.add(file.discNumber);
  if (file.track) {
    const existing = entry.trackNumbers.get(disc) ?? [];
    existing.push(String(file.track));
    entry.trackNumbers.set(disc, existing);
  }

  entry.formats.add(file.isLossy ? "lossy" : "lossless");
  if (file.sampleRate) entry.sampleRates.add(file.sampleRate);
  entry.directories.add(dirname(file.path));
  entry.fileCount++;
  entry.files.push(file.path);
}

interface BatchItemOk {
  status: "ok";
  path: string;
  data: {
    tags?: {
      title?: string[];
      artist?: string[];
      album?: string[];
      albumArtist?: string[];
      year?: number;
      track?: number;
      genre?: string[];
      comment?: string[];
      acoustidFingerprint?: string[];
      acoustidId?: string[];
    };
    properties?: {
      duration?: number;
      bitrate?: number;
      sampleRate?: number;
      channels?: number;
      codec?: string;
      containerFormat?: string;
      isLossless?: boolean;
    };
    dynamics?: {
      replayGainTrackGain?: string;
      replayGainTrackPeak?: string;
      replayGainAlbumGain?: string;
      replayGainAlbumPeak?: string;
      hasCoverArt?: boolean;
    };
    hasCoverArt?: boolean;
  };
}

interface BatchItemError {
  status: "error";
  path: string;
  error: string;
}

// Note: The batch API's `tags` shorthand may not include albumArtist or discNumber.
// albumArtist falls back to artist for the inconsistent-artist rule.
// discNumber is unavailable from batch API — multi-disc rules degrade to treating
// all tracks as disc 0. This is acceptable for v1; a future enhancement could use
// individual file reads for albums that appear to have duplicate track numbers.
function batchItemToFileMetadata(item: BatchItemOk): FileMetadataForLint {
  const tags = item.data.tags;
  const props = item.data.properties;
  const dynamics = item.data.dynamics;
  const ext = extname(item.path).toLowerCase();

  return {
    path: item.path,
    title: tags?.title?.[0],
    artist: tags?.artist?.[0],
    albumArtist: tags?.albumArtist?.[0], // may be undefined if batch API doesn't expose it
    album: tags?.album?.[0],
    year: tags?.year,
    track: tags?.track,
    genre: tags?.genre?.[0],
    hasCoverArt: item.data.hasCoverArt ?? dynamics?.hasCoverArt ?? false,
    hasReplayGain:
      !!(dynamics?.replayGainTrackGain || dynamics?.replayGainAlbumGain),
    hasAcoustId: !!(tags?.acoustidFingerprint?.[0] || tags?.acoustidId?.[0]),
    duration: props?.duration,
    bitrate: props?.bitrate,
    sampleRate: props?.sampleRate,
    channels: props?.channels,
    codec: props?.codec,
    containerFormat: props?.containerFormat,
    isLossy: classifyLossy(ext, props?.isLossless),
  };
}

export async function runLint(
  files: string[],
  options: LintOptions,
  onIssue?: (issue: LintIssue) => void,
  onProgress?: (processed: number, total: number) => void,
): Promise<LintResult> {
  const allIssues: LintIssue[] = [];
  const albumIndex: AlbumIndex = new Map();
  const minSeverity = SEVERITY_ORDER[options.severity];

  function emit(issue: LintIssue) {
    if (SEVERITY_ORDER[issue.severity] <= minSeverity) {
      allIssues.push(issue);
      onIssue?.(issue);
    }
  }

  // Phase 1: per-file
  const batchResult = await readMetadataBatch(files, {
    concurrency: 8,
    continueOnError: true,
    onProgress: (processed, total) => onProgress?.(processed, total),
  });

  for (const item of batchResult.items) {
    if (item.status === "error") {
      // parse-failure emits regardless of --deep: a completely unreadable file
      // is always worth reporting (spec lists it under --deep media rules, but
      // the batch API surfaces these errors in normal mode too)
      emit({
        type: "issue",
        rule: "parse-failure",
        severity: "error",
        file: item.path,
        message: `Failed to read file: ${(item as BatchItemError).error}`,
      });
      continue;
    }

    const okItem = item as unknown as BatchItemOk;
    const fileMeta = batchItemToFileMetadata(okItem);

    // Per-file metadata rules
    for (const issue of runFileMetadataRules(fileMeta)) {
      emit(issue);
    }

    // Deep media checks
    if (options.deep) {
      try {
        const headerBytes = await readFileHeader(fileMeta.path);
        const ext = extname(fileMeta.path);
        for (
          const issue of validateFileHeader(fileMeta.path, ext, headerBytes)
        ) {
          emit(issue);
        }
      } catch (error) {
        emit({
          type: "issue",
          rule: "invalid-header",
          severity: "error",
          file: fileMeta.path,
          message: `Failed to read file header: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }

    // Build album index
    if (fileMeta.album) {
      const normalized = normalizeForMatching(fileMeta.album, {
        stripLeadingArticles: false,
        romanToArabic: false,
      });
      addToAlbumIndex(albumIndex, normalized, fileMeta);
    }
  }

  // Phase 2: per-album
  for (const issue of runAlbumRules(albumIndex)) {
    emit(issue);
  }

  const summary = createLintSummary(allIssues, files.length);
  return { issues: allIssues, summary };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read --allow-env src/lib/lint_engine.test.ts` Expected:
PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/lint_engine.ts src/lib/lint_engine.test.ts
git commit -m "feat(lint): add streaming lint engine with album index building"
```

---

## Chunk 3: CLI Command and Integration

### Task 6: Lint command handler and output formatting

**Files:**

- Create: `src/commands/lint.ts`

- [ ] **Step 1: Write the command handler**

In `src/commands/lint.ts`:

```ts
import { listAudioFilesRecursive } from "../lib/fastest_audio_scan_recursive.ts";
import {
  type LintOptions,
  type LintResult,
  runLint,
} from "../lib/lint_engine.ts";
import type { LintIssue, LintSummary, Severity } from "../lib/lint.ts";

const SEVERITY_ICONS: Record<string, string> = {
  error: "\u274C", // ❌
  warning: "\u26A0\uFE0F", // ⚠️
  info: "\u2139\uFE0F", // ℹ️
};

function formatIssueTerminal(issue: LintIssue): string {
  const icon = SEVERITY_ICONS[issue.severity];
  if (issue.file) {
    return `${icon} ${issue.file}: ${issue.rule} \u2014 ${issue.message}`;
  }
  return `${icon} Album "${issue.album}": ${issue.rule} \u2014 ${issue.message}`;
}

function formatSummaryTerminal(summary: LintSummary): string {
  const lines = [
    "Summary:",
    `  ${summary.errors} error${
      summary.errors !== 1 ? "s" : ""
    } \u00B7 ${summary.warnings} warning${
      summary.warnings !== 1 ? "s" : ""
    } \u00B7 ${summary.info} info`,
    `  ${summary.filesOk} file${
      summary.filesOk !== 1 ? "s" : ""
    } OK \u00B7 ${summary.filesWithIssues} file${
      summary.filesWithIssues !== 1 ? "s" : ""
    } with issues \u00B7 ${summary.albumIssues} album issue${
      summary.albumIssues !== 1 ? "s" : ""
    }`,
  ];
  return lines.join("\n");
}

function writeStderr(text: string) {
  Deno.stderr.writeSync(new TextEncoder().encode(text));
}

export async function lintCommand(
  options: {
    deep: boolean;
    json: boolean;
    severity: string;
    quiet: boolean;
  },
  path: string,
): Promise<void> {
  // Validate path and discover files
  let files: string[];
  try {
    const stat = await Deno.stat(path);
    if (stat.isFile) {
      files = [path];
    } else if (stat.isDirectory) {
      files = listAudioFilesRecursive([path]);
    } else {
      console.error(`Error: ${path} is not a file or directory`);
      Deno.exit(2);
      return; // unreachable, satisfies TS
    }
  } catch {
    console.error(`Error: Cannot access ${path}`);
    Deno.exit(2);
    return;
  }

  if (files.length === 0) {
    console.error(`Error: No audio files found in ${path}`);
    Deno.exit(2);
  }

  if (!options.quiet && !options.json) {
    writeStderr(`Scanning ${files.length.toLocaleString()} files...\n\n`);
  }

  const lintOptions: LintOptions = {
    deep: options.deep,
    severity: options.severity as Severity,
    quiet: options.quiet,
    json: options.json,
  };

  const terminalIssues: LintIssue[] = [];
  let lastProgressUpdate = 0;

  const result = await runLint(
    files,
    lintOptions,
    // onIssue
    (issue) => {
      if (options.json) {
        console.log(JSON.stringify(issue));
      } else {
        terminalIssues.push(issue);
      }
    },
    // onProgress
    (processed, total) => {
      if (options.quiet || options.json) return;
      const now = Date.now();
      if (
        processed === total || processed % 1000 === 0 ||
        now - lastProgressUpdate > 1000
      ) {
        writeStderr(
          `\x1b[2K\rScanning: ${processed.toLocaleString()}/${total.toLocaleString()} files`,
        );
        lastProgressUpdate = now;
      }
    },
  );

  // Output
  if (options.json) {
    console.log(JSON.stringify(result.summary));
  } else {
    if (!options.quiet) {
      writeStderr(`\x1b[2K\r`); // Clear progress line
    }
    for (const issue of terminalIssues) {
      console.log(formatIssueTerminal(issue));
    }
    if (terminalIssues.length > 0) {
      console.log();
    }
    console.log(formatSummaryTerminal(result.summary));
  }

  // Exit code
  Deno.exit(result.summary.errors > 0 ? 1 : 0);
}
```

- [ ] **Step 2: Run linter and formatter**

Run: `deno fmt src/commands/lint.ts && deno lint src/commands/lint.ts` Expected:
PASS

- [ ] **Step 3: Commit**

```bash
git add src/commands/lint.ts
git commit -m "feat(lint): add CLI command handler with terminal and JSONL output"
```

### Task 7: Wire lint command into CLI

**Files:**

- Modify: `src/cli/cli.ts`

- [ ] **Step 1: Add lint subcommand to CLI**

Add import at top of `src/cli/cli.ts`:

```ts
import { lintCommand } from "../commands/lint.ts";
```

Add before `return program;` at end of `setupCLI()`:

```ts
// Add lint subcommand
program
  .command(
    "lint <path:string>",
    "Scan music library for tagging problems, inconsistencies, and file integrity issues",
  )
  .option(
    "--deep",
    "Enable media integrity checks (header validation)",
    { default: false },
  )
  .option(
    "--json",
    "Output as JSONL (one issue per line, summary last line)",
    { default: false },
  )
  .option(
    "--severity <level:string>",
    "Minimum severity to report: error, warning (default), info",
    { default: "warning" },
  )
  .option(
    "-q, --quiet",
    "Suppress progress output",
    { default: false },
  )
  .action(lintCommand);
```

- [ ] **Step 2: Run formatter and linter**

Run: `deno fmt src/cli/cli.ts && deno lint src/cli/cli.ts` Expected: PASS

- [ ] **Step 3: Verify CLI shows lint in help**

Run: `deno run --allow-read --allow-env src/amusic.ts --help` Expected: `lint`
command appears in the help output

- [ ] **Step 4: Commit**

```bash
git add src/cli/cli.ts
git commit -m "feat(lint): wire lint subcommand into CLI"
```

### Task 8: Integration test with real audio files

**Files:**

- Create: `src/commands/lint.test.ts`

- [ ] **Step 1: Write integration test**

In `src/commands/lint.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

describe("lint command integration", () => {
  it("should exit with code 2 when path does not exist", async () => {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-env",
        "--allow-net",
        "src/amusic.ts",
        "lint",
        "/nonexistent/path",
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    assertEquals(output.code, 2);
  });

  it("should produce valid JSONL with --json flag on a test directory", async () => {
    // Use a small subset of the Deezer library for integration testing
    // Skip if the test directory doesn't exist
    try {
      await Deno.stat("/Volumes/T9 (4TB)/Downloads/Deezer");
    } catch {
      return; // Skip test if external drive not available
    }

    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-env",
        "--allow-net",
        "src/amusic.ts",
        "lint",
        "--json",
        "--severity",
        "info",
        "--quiet",
        "/Volumes/T9 (4TB)/Downloads/Deezer",
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const lines = stdout.trim().split("\n").filter((l) => l.length > 0);

    // Every line should be valid JSON
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assertEquals(typeof parsed.type, "string");
    }

    // Last line should be summary
    if (lines.length > 0) {
      const lastLine = JSON.parse(lines[lines.length - 1]);
      assertEquals(lastLine.type, "summary");
      assertEquals(typeof lastLine.errors, "number");
      assertEquals(typeof lastLine.warnings, "number");
    }
  });
});
```

- [ ] **Step 2: Run integration test**

Run:
`deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/commands/lint.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/commands/lint.test.ts
git commit -m "test(lint): add integration tests for lint command"
```

### Task 9: Format, lint, and full test suite

**Files:** (no new files)

- [ ] **Step 1: Format all new files**

Run:
`deno fmt src/lib/lint.ts src/lib/lint.test.ts src/lib/lint_media.ts src/lib/lint_media.test.ts src/lib/lint_engine.ts src/lib/lint_engine.test.ts src/commands/lint.ts src/commands/lint.test.ts`

- [ ] **Step 2: Lint all new files**

Run:
`deno lint src/lib/lint.ts src/lib/lint.test.ts src/lib/lint_media.ts src/lib/lint_media.test.ts src/lib/lint_engine.ts src/lib/lint_engine.test.ts src/commands/lint.ts src/commands/lint.test.ts`

- [ ] **Step 3: Run full test suite**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`
Expected: All tests PASS including existing ones

- [ ] **Step 4: Fix any issues and commit**

```bash
git add -A
git commit -m "chore(lint): format and lint cleanup"
```

### Task 10: Manual smoke test and final commit

- [ ] **Step 1: Run lint on a test album folder**

Run:
`deno run --allow-read --allow-env --allow-net src/amusic.ts lint --severity info "/Volumes/T9 (4TB)/Downloads/Deezer"`
Expected: Formatted terminal output with issues and summary

- [ ] **Step 2: Run lint with --deep**

Run:
`deno run --allow-read --allow-env --allow-net src/amusic.ts lint --deep --severity info "/Volumes/T9 (4TB)/Downloads/Deezer"`
Expected: Additional media validation issues appear

- [ ] **Step 3: Run lint with --json**

Run:
`deno run --allow-read --allow-env --allow-net src/amusic.ts lint --json --severity info "/Volumes/T9 (4TB)/Downloads/Deezer" | head -20`
Expected: Valid JSONL output

- [ ] **Step 4: Push to remote**

```bash
git push
```

- [ ] **Step 5: Close beads issue**

```bash
bd close amusic-ecw --reason="Implemented lint command with metadata and media validation"
```
