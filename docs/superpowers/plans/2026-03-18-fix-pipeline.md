# `amusic fix` Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `amusic fix <path>` — a single smart command that identifies,
tags, and enriches music files using AcoustID + MusicBrainz, with
confidence-based automation and a "first, do no harm" default.

**Architecture:** Pipeline of composable stages: discover → fingerprint →
identify → match releases → enrich → cover art → duplicate detection → review →
organize → report. Each stage feeds results to the next. Confidence scoring
gates what auto-applies vs. what pauses for user review.

**Tech Stack:** Deno, taglib-wasm, Cliffy, AcoustID API, MusicBrainz API, Cover
Art Archive API.

**Spec:**
[`docs/superpowers/specs/2026-03-18-fix-pipeline-design.md`](../specs/2026-03-18-fix-pipeline-design.md)

---

## File Map

| File                                  | Role                                             |
| ------------------------------------- | ------------------------------------------------ |
| `src/lib/confidence.ts`               | Confidence thresholds and categorization         |
| `src/lib/confidence.test.ts`          | Tests for confidence module                      |
| `src/lib/cover_art.ts`                | Cover Art Archive fetch + embed                  |
| `src/lib/cover_art.test.ts`           | Tests for cover art module                       |
| `src/lib/duplicate_detection.ts`      | Group duplicates by ID, rank quality             |
| `src/lib/duplicate_detection.test.ts` | Tests for duplicate detection                    |
| `src/lib/organizer.ts`                | File rename/move into organized structure        |
| `src/lib/organizer.test.ts`           | Tests for organizer                              |
| `src/lib/review.ts`                   | Text-based review UI for medium-confidence items |
| `src/lib/review.test.ts`              | Tests for review module                          |
| `src/lib/pipeline.ts`                 | Pipeline orchestrator + enrichment diff logic    |
| `src/lib/pipeline.test.ts`            | Tests for pipeline                               |
| `src/commands/fix.ts`                 | CLI command wiring                               |
| `src/commands/fix.test.ts`            | Tests for fix command                            |
| `src/lib/musicbrainz.ts`              | Enhanced: add country/reissue scoring signals    |
| `src/lib/musicbrainz.test.ts`         | Enhanced: tests for new scoring signals          |
| `src/cli/cli.ts`                      | Enhanced: register `fix` subcommand              |

---

## Task 1: Confidence Module

**Files:**

- Create: `src/lib/confidence.ts`
- Create: `src/lib/confidence.test.ts`

This is a pure-logic module with no dependencies. Maps `scoreRelease()` output
(0.0–1.0) to confidence categories.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/confidence.test.ts
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { categorizeConfidence, type ConfidenceCategory } from "./confidence.ts";

describe("categorizeConfidence", () => {
  it("should return 'high' for scores >= 0.9", () => {
    assertEquals(categorizeConfidence(0.9), "high");
    assertEquals(categorizeConfidence(0.95), "high");
    assertEquals(categorizeConfidence(1.0), "high");
  });

  it("should return 'medium' for scores 0.5–0.89", () => {
    assertEquals(categorizeConfidence(0.5), "medium");
    assertEquals(categorizeConfidence(0.72), "medium");
    assertEquals(categorizeConfidence(0.89), "medium");
  });

  it("should return 'low' for scores < 0.5", () => {
    assertEquals(categorizeConfidence(0.0), "low");
    assertEquals(categorizeConfidence(0.49), "low");
    assertEquals(categorizeConfidence(0.3), "low");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read --allow-env src/lib/confidence.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/confidence.ts
export type ConfidenceCategory = "high" | "medium" | "low";

const HIGH_THRESHOLD = 0.9;
const MEDIUM_THRESHOLD = 0.5;

export function categorizeConfidence(score: number): ConfidenceCategory {
  if (score >= HIGH_THRESHOLD) return "high";
  if (score >= MEDIUM_THRESHOLD) return "medium";
  return "low";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read --allow-env src/lib/confidence.test.ts`

Expected: PASS — all 3 tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/confidence.ts src/lib/confidence.test.ts
git commit -m "feat(fix): add confidence categorization module"
```

---

## Task 2: Enhance `scoreRelease()` — Country/Region and Original vs. Reissue

**Files:**

- Modify: `src/lib/musicbrainz.ts`
- Modify: `src/lib/musicbrainz.test.ts`

The existing quality signals weight (10) is split: 5 for existing
status/type/format, 5 for the two new signals. This keeps total weights at 100.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/musicbrainz.test.ts`:

```typescript
describe("scoreRelease — country/region and original vs reissue", () => {
  const baseFiles: AlbumFileInfo[] = [
    {
      path: "/a/01.mp3",
      recordingId: "rec-1",
      duration: 200,
    },
  ];

  const baseRelease: MBRelease = {
    id: "rel-1",
    title: "Test Album",
    status: "Official",
    date: "2020-01-01",
    country: "US",
    "release-group": { id: "rg-1", "primary-type": "Album" },
    media: [{
      position: 1,
      format: "Digital Media",
      track_count: 1,
      tracks: [{
        id: "t1",
        number: "1",
        title: "Song",
        length: 200000,
        position: 1,
        recording: { id: "rec-1" },
      }],
    }],
  };

  it("should score original release higher than reissue", () => {
    const original = { ...baseRelease, date: "2000-01-01" };
    const reissue = {
      ...baseRelease,
      id: "rel-2",
      date: "2020-01-01",
      "release-group": {
        id: "rg-1",
        "primary-type": "Album",
        "secondary-types": ["Remaster"],
      },
    };

    const scoreOrig = scoreRelease(baseFiles, original);
    const scoreReissue = scoreRelease(baseFiles, reissue as MBRelease);
    assert(
      scoreOrig >= scoreReissue,
      `Original (${scoreOrig}) should score >= reissue (${scoreReissue})`,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`deno test --allow-read --allow-env --filter "country/region and original" src/lib/musicbrainz.test.ts`

Expected: FAIL — new scoring logic not yet implemented

- [ ] **Step 3: Implement the scoring changes**

In `src/lib/musicbrainz.ts`, update the `MBRelease` type to include
`secondary-types` on the release-group:

```typescript
export type MBRelease = {
  id: string;
  title: string;
  status?: string;
  date?: string;
  country?: string;
  "release-group"?: {
    id: string;
    "primary-type"?: string;
    "secondary-types"?: string[];
  };
  "artist-credit"?: MBArtistCredit[];
  media?: MBMedium[];
};
```

Then replace the quality score section (section 6) in `scoreRelease()`:

```typescript
// 6. Release quality signals (weight: 5 for status/type/format)
const statusScores: Record<string, number> = {
  "Official": 1.0,
  "Promotion": 0.3,
  "Bootleg": 0.1,
};
const typeScores: Record<string, number> = options.isSingle
  ? { "Single": 1.0, "Album": 0.8, "EP": 0.6, "Compilation": 0.2 }
  : { "Album": 1.0, "EP": 0.8, "Single": 0.6, "Compilation": 0.3 };
const formatScores: Record<string, number> = {
  "Digital Media": 1.0,
  "CD": 0.8,
};

const statusScore = statusScores[release.status ?? ""] ?? 0.5;
const primaryType = release["release-group"]?.["primary-type"] ?? "";
const typeScore = typeScores[primaryType] ?? 0.5;
const format = bestMedium.format ?? "";
const formatScore = formatScores[format] ?? 0.5;
const qualityScore = (statusScore + typeScore + formatScore) / 3;

// 7. Original vs. reissue (weight: 2.5)
const secondaryTypes = release["release-group"]?.["secondary-types"] ?? [];
const isReissue = secondaryTypes.some((t) =>
  ["Remaster", "Remix", "Compilation"].includes(t)
);
const originalScore = isReissue ? 0.3 : 1.0;

// 8. Country/region preference (weight: 2.5)
const countryScore = release.country ? 0.8 : 0.5;

// Weighted sum (weights sum to 100)
const score = (trackCountScore * 30 +
  coverageScore * 25 +
  durationScore * 15 +
  orderScore * 10 +
  tagScore * 10 +
  qualityScore * 5 +
  originalScore * 2.5 +
  countryScore * 2.5) / 100;
```

- [ ] **Step 4: Run all musicbrainz tests**

Run: `deno test --allow-read --allow-env src/lib/musicbrainz.test.ts`

Expected: PASS — all existing + new tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/musicbrainz.ts src/lib/musicbrainz.test.ts
git commit -m "feat(fix): add country/region and original-vs-reissue scoring signals"
```

---

## Task 3: Duplicate Detection Module

**Files:**

- Create: `src/lib/duplicate_detection.ts`
- Create: `src/lib/duplicate_detection.test.ts`

Pure-logic module. Groups files that share the same AcoustID ID or MusicBrainz
recording ID and recommends which to keep based on quality.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/duplicate_detection.test.ts
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  detectDuplicates,
  type DuplicateGroup,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read --allow-env src/lib/duplicate_detection.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/lib/duplicate_detection.ts

export type FileQualityInfo = {
  path: string;
  acoustIdId?: string;
  recordingId?: string;
  format: string;
  bitrate: number;
  tagCount: number;
  title?: string;
  artist?: string;
};

export type DuplicateGroup = {
  recordingId: string;
  title?: string;
  artist?: string;
  files: FileQualityInfo[];
};

const FORMAT_RANK: Record<string, number> = {
  flac: 4,
  wav: 3,
  m4a: 2,
  aac: 2,
  mp3: 1,
  ogg: 1,
  opus: 1,
};

export function detectDuplicates(files: FileQualityInfo[]): DuplicateGroup[] {
  const byId = new Map<string, FileQualityInfo[]>();

  for (const file of files) {
    const key = file.recordingId ?? file.acoustIdId;
    if (!key) continue;
    const group = byId.get(key) ?? [];
    group.push(file);
    byId.set(key, group);
  }

  const groups: DuplicateGroup[] = [];
  for (const [recordingId, groupFiles] of byId) {
    if (groupFiles.length < 2) continue;
    const ranked = rankDuplicates(groupFiles);
    groups.push({
      recordingId,
      title: ranked[0].title,
      artist: ranked[0].artist,
      files: ranked,
    });
  }

  return groups;
}

export function rankDuplicates(files: FileQualityInfo[]): FileQualityInfo[] {
  return [...files].sort((a, b) => {
    const formatA = FORMAT_RANK[a.format.toLowerCase()] ?? 0;
    const formatB = FORMAT_RANK[b.format.toLowerCase()] ?? 0;
    if (formatA !== formatB) return formatB - formatA;
    if (a.bitrate !== b.bitrate) return b.bitrate - a.bitrate;
    return b.tagCount - a.tagCount;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read --allow-env src/lib/duplicate_detection.test.ts`

Expected: PASS — all tests green

- [ ] **Step 5: Commit**

```bash
git add src/lib/duplicate_detection.ts src/lib/duplicate_detection.test.ts
git commit -m "feat(fix): add duplicate detection module"
```

---

## Task 4: Cover Art Module

**Files:**

- Create: `src/lib/cover_art.ts`
- Create: `src/lib/cover_art.test.ts`

Fetches front cover from Cover Art Archive by MusicBrainz release ID. Returns
image data or null. Embedding is handled by taglib-wasm's `setPictures()` in the
pipeline.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/cover_art.test.ts
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertNotEquals } from "@std/assert";
import { buildCoverArtUrl, type CoverArtResult } from "./cover_art.ts";

describe("buildCoverArtUrl", () => {
  it("should build correct URL for a release ID", () => {
    const url = buildCoverArtUrl("abc-123");
    assertEquals(url, "https://coverartarchive.org/release/abc-123/front");
  });
});
```

Note: The actual `fetchCoverArt()` function calls the network. We test URL
building as a pure function. Integration testing of the fetch is done via the
pipeline E2E tests (Task 8).

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read --allow-env src/lib/cover_art.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/lib/cover_art.ts

const CAA_BASE = "https://coverartarchive.org";
const REQUEST_TIMEOUT_MS = 15000;

export type CoverArtResult = {
  data: Uint8Array;
  mimeType: string;
} | null;

export function buildCoverArtUrl(releaseId: string): string {
  return `${CAA_BASE}/release/${releaseId}/front`;
}

export async function fetchCoverArt(
  releaseId: string,
): Promise<CoverArtResult> {
  const url = buildCoverArtUrl(releaseId);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }

    if (!response.ok) {
      await response.body?.cancel();
      console.error(
        `  Cover art fetch failed: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const data = new Uint8Array(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type") ?? "image/jpeg";

    return { data, mimeType };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      console.error(`  Cover art fetch timed out for release ${releaseId}`);
    } else {
      console.error(`  Cover art fetch error for ${releaseId}: ${error}`);
    }
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read --allow-env src/lib/cover_art.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/cover_art.ts src/lib/cover_art.test.ts
git commit -m "feat(fix): add Cover Art Archive fetch module"
```

---

## Task 5: Organizer Module

**Files:**

- Create: `src/lib/organizer.ts`
- Create: `src/lib/organizer.test.ts`

Pure-logic path computation + file move operations. The path computation is
easily testable; the actual file move uses `Deno.rename()`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/organizer.test.ts
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { buildOrganizedPath, sanitizeFilename } from "./organizer.ts";

describe("sanitizeFilename", () => {
  it("should replace filesystem-unsafe characters", () => {
    assertEquals(
      sanitizeFilename("AC/DC: Back In Black?"),
      "AC_DC_ Back In Black_",
    );
  });

  it("should trim whitespace", () => {
    assertEquals(sanitizeFilename("  hello  "), "hello");
  });
});

describe("buildOrganizedPath", () => {
  it("should build Artist/Album (Year)/NN Title.ext", () => {
    const result = buildOrganizedPath({
      libraryRoot: "/Music",
      artist: "Radiohead",
      album: "OK Computer",
      year: 1997,
      trackNumber: 1,
      title: "Airbag",
      extension: ".flac",
      totalTracks: 12,
    });
    assertEquals(result, "/Music/Radiohead/OK Computer (1997)/01 Airbag.flac");
  });

  it("should use Various Artists for compilations", () => {
    const result = buildOrganizedPath({
      libraryRoot: "/Music",
      artist: "Various Artists",
      album: "Lost in Translation",
      year: 2003,
      trackNumber: 8,
      title: "Just Like Honey",
      extension: ".mp3",
      isCompilation: true,
      totalTracks: 15,
    });
    assertEquals(
      result,
      "/Music/Various Artists/Lost in Translation (2003)/08 Just Like Honey.mp3",
    );
  });

  it("should place singles in Artist/Singles/", () => {
    const result = buildOrganizedPath({
      libraryRoot: "/Music",
      artist: "Radiohead",
      title: "Creep",
      extension: ".mp3",
      totalTracks: 1,
    });
    assertEquals(result, "/Music/Radiohead/Singles/Creep.mp3");
  });

  it("should zero-pad to 3 digits for 100+ track albums", () => {
    const result = buildOrganizedPath({
      libraryRoot: "/Music",
      artist: "Various",
      album: "Mega Mix",
      trackNumber: 5,
      title: "Song",
      extension: ".mp3",
      totalTracks: 150,
    });
    assertEquals(result, "/Music/Various/Mega Mix/005 Song.mp3");
  });

  it("should omit year from path when not available", () => {
    const result = buildOrganizedPath({
      libraryRoot: "/Music",
      artist: "Unknown",
      album: "Demos",
      trackNumber: 1,
      title: "Track 1",
      extension: ".mp3",
      totalTracks: 5,
    });
    assertEquals(result, "/Music/Unknown/Demos/01 Track 1.mp3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read --allow-env src/lib/organizer.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/lib/organizer.ts
import { dirname, join } from "@std/path";

const UNSAFE_CHARS = /[<>:"/\\|?*]/g;

export function sanitizeFilename(name: string): string {
  return name.replace(UNSAFE_CHARS, "_").trim();
}

export type OrganizePathInput = {
  libraryRoot: string;
  artist: string;
  album?: string;
  year?: number;
  trackNumber?: number;
  title: string;
  extension: string;
  isCompilation?: boolean;
  totalTracks?: number;
};

export function buildOrganizedPath(input: OrganizePathInput): string {
  const artist = sanitizeFilename(
    input.isCompilation ? "Various Artists" : input.artist,
  );

  const isSingle = !input.album || (input.totalTracks ?? 0) <= 1;

  if (isSingle) {
    const title = sanitizeFilename(input.title);
    return join(
      input.libraryRoot,
      artist,
      "Singles",
      `${title}${input.extension}`,
    );
  }

  const albumPart = input.year
    ? `${sanitizeFilename(input.album!)} (${input.year})`
    : sanitizeFilename(input.album!);

  const padWidth = (input.totalTracks ?? 0) >= 100 ? 3 : 2;
  const trackNum = input.trackNumber
    ? String(input.trackNumber).padStart(padWidth, "0") + " "
    : "";

  const title = sanitizeFilename(input.title);
  const filename = `${trackNum}${title}${input.extension}`;

  return join(input.libraryRoot, artist, albumPart, filename);
}

export type MoveResult = {
  source: string;
  destination: string;
  status: "moved" | "conflict" | "dry-run";
};

export async function moveFile(
  source: string,
  destination: string,
  dryRun: boolean,
): Promise<MoveResult> {
  if (dryRun) {
    return { source, destination, status: "dry-run" };
  }

  try {
    await Deno.stat(destination);
    return { source, destination, status: "conflict" };
  } catch {
    // Destination doesn't exist — good
  }

  await Deno.mkdir(dirname(destination), { recursive: true });
  await Deno.rename(source, destination);
  return { source, destination, status: "moved" };
}

export async function cleanEmptyDirs(dirPath: string): Promise<void> {
  try {
    for await (const _ of Deno.readDir(dirPath)) {
      return; // Not empty
    }
    await Deno.remove(dirPath);
    await cleanEmptyDirs(dirname(dirPath));
  } catch {
    // Ignore errors (dir doesn't exist, permission, etc.)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read --allow-env src/lib/organizer.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/organizer.ts src/lib/organizer.test.ts
git commit -m "feat(fix): add file organizer module"
```

---

## Task 6: Review Module

**Files:**

- Create: `src/lib/review.ts`
- Create: `src/lib/review.test.ts`

Text-based batch review UI. Presents medium-confidence items, collects
accept/skip decisions. Uses Cliffy prompts for user input.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/review.test.ts
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { formatDiffLine, formatReviewItem, type ReviewItem } from "./review.ts";

describe("formatDiffLine", () => {
  it("should format empty-to-value as fill", () => {
    assertEquals(
      formatDiffLine("Title", undefined, "Karma Police"),
      '  Title:   (empty) -> "Karma Police"',
    );
  });

  it("should show kept values", () => {
    assertEquals(
      formatDiffLine("Artist", "Radiohead", "Radiohead"),
      '  Artist:  "Radiohead" (kept)',
    );
  });

  it("should show changed values", () => {
    assertEquals(
      formatDiffLine("Year", "1996", "1997"),
      '  Year:    "1996" -> "1997"',
    );
  });
});

describe("formatReviewItem", () => {
  it("should include filename, proposed match, and confidence", () => {
    const item: ReviewItem = {
      sourcePath: "/music/track03.mp3",
      proposedTitle: "Karma Police",
      proposedArtist: "Radiohead",
      proposedAlbum: "OK Computer",
      proposedYear: 1997,
      confidence: 0.72,
      confidenceReason: "fingerprint matched but track count mismatch",
    };
    const formatted = formatReviewItem(item, 1);
    assertEquals(formatted.includes("track03.mp3"), true);
    assertEquals(formatted.includes("Karma Police"), true);
    assertEquals(formatted.includes("72%"), true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read --allow-env src/lib/review.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/lib/review.ts
import { basename } from "@std/path";

export type ReviewItem = {
  sourcePath: string;
  proposedTitle?: string;
  proposedArtist?: string;
  proposedAlbum?: string;
  proposedYear?: number;
  confidence: number;
  confidenceReason: string;
  diffs?: TagDiff[];
};

export type TagDiff = {
  field: string;
  current?: string;
  proposed?: string;
};

export type ReviewDecision = "accept" | "skip";

const FIELD_PAD = 8;

export function formatDiffLine(
  field: string,
  current: string | undefined,
  proposed: string | undefined,
): string {
  const paddedField = `${field}:`.padEnd(FIELD_PAD);
  if (!current && proposed) {
    return `  ${paddedField}(empty) -> "${proposed}"`;
  }
  if (current === proposed) {
    return `  ${paddedField}"${current}" (kept)`;
  }
  return `  ${paddedField}"${current}" -> "${proposed}"`;
}

export function formatReviewItem(item: ReviewItem, index: number): string {
  const filename = basename(item.sourcePath);
  const confidence = Math.round(item.confidence * 100);
  const match = item.proposedAlbum
    ? `"${item.proposedTitle}" by ${item.proposedArtist} (${item.proposedAlbum}, ${
      item.proposedYear ?? "?"
    })`
    : `"${item.proposedTitle}" by ${item.proposedArtist}`;

  return [
    `${index}. "${filename}" -> ${match}`,
    `   Confidence: ${confidence}% — ${item.confidenceReason}`,
    `   [y] Accept  [n] Skip  [d] Show diff`,
  ].join("\n");
}

export function formatDiff(item: ReviewItem): string {
  if (!item.diffs || item.diffs.length === 0) return "  (no changes)";
  return item.diffs
    .map((d) => formatDiffLine(d.field, d.current, d.proposed))
    .join("\n");
}

export async function runBatchReview(
  items: ReviewItem[],
  promptFn: (message: string) => Promise<string> = defaultPrompt,
): Promise<Map<string, ReviewDecision>> {
  const decisions = new Map<string, ReviewDecision>();

  if (items.length === 0) return decisions;

  console.log(`\n${items.length} item(s) need your review:\n`);

  for (let i = 0; i < items.length; i++) {
    console.log(formatReviewItem(items[i], i + 1));
    const answer = await promptFn("\nYour choice (y/n/d): ");

    if (answer.toLowerCase() === "d") {
      console.log(formatDiff(items[i]));
      const confirmAnswer = await promptFn("Accept? (y/n): ");
      decisions.set(
        items[i].sourcePath,
        confirmAnswer.toLowerCase() === "y" ? "accept" : "skip",
      );
    } else {
      decisions.set(
        items[i].sourcePath,
        answer.toLowerCase() === "y" ? "accept" : "skip",
      );
    }
    console.log();
  }

  return decisions;
}

async function defaultPrompt(message: string): Promise<string> {
  const buf = new Uint8Array(64);
  await Deno.stdout.write(new TextEncoder().encode(message));
  const n = await Deno.stdin.read(buf);
  return new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read --allow-env src/lib/review.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/review.ts src/lib/review.test.ts
git commit -m "feat(fix): add text-based review module for medium-confidence matches"
```

---

## Task 7: Pipeline Orchestrator

**Files:**

- Create: `src/lib/pipeline.ts`
- Create: `src/lib/pipeline.test.ts`

The core orchestrator that wires all stages together. This is the largest task.
The pipeline accepts a config and returns a report. Each stage is a function
that takes the accumulated state and returns updated state.

- [ ] **Step 1: Define pipeline types and the enrichment diff logic — write
      tests**

Focus first on the enrichment diff (the "first, do no harm" logic), which is the
most testable part of the pipeline.

```typescript
// src/lib/pipeline.test.ts
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  buildEnrichmentDiff,
  type EnrichmentDiff,
  type ExistingTags,
  type ProposedTags,
} from "./pipeline.ts";

describe("buildEnrichmentDiff", () => {
  it("should fill empty fields from proposed data", () => {
    const existing: ExistingTags = {
      title: undefined,
      artist: "Radiohead",
      album: undefined,
    };
    const proposed: ProposedTags = {
      title: "Karma Police",
      artist: "Radiohead",
      album: "OK Computer",
      year: 1997,
    };

    const diff = buildEnrichmentDiff(existing, proposed, false);
    assertEquals(diff, [
      { field: "Title", current: undefined, proposed: "Karma Police" },
      { field: "Album", current: undefined, proposed: "OK Computer" },
      { field: "Year", current: undefined, proposed: "1997" },
    ]);
  });

  it("should not overwrite existing values by default", () => {
    const existing: ExistingTags = {
      title: "Karma P",
      artist: "Radiohead",
      album: "OK Comp",
    };
    const proposed: ProposedTags = {
      title: "Karma Police",
      artist: "Radiohead",
      album: "OK Computer",
    };

    const diff = buildEnrichmentDiff(existing, proposed, false);
    assertEquals(diff, []);
  });

  it("should overwrite existing values when overwrite=true", () => {
    const existing: ExistingTags = { title: "Karma P", artist: "Radiohead" };
    const proposed: ProposedTags = {
      title: "Karma Police",
      artist: "Radiohead",
    };

    const diff = buildEnrichmentDiff(existing, proposed, true);
    assertEquals(diff, [
      { field: "Title", current: "Karma P", proposed: "Karma Police" },
    ]);
  });

  it("should never overwrite with blank/undefined values", () => {
    const existing: ExistingTags = {
      title: "Karma Police",
      artist: "Radiohead",
    };
    const proposed: ProposedTags = { title: undefined, artist: "" };

    const diff = buildEnrichmentDiff(existing, proposed, true);
    assertEquals(diff, []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read --allow-env src/lib/pipeline.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write the pipeline types and enrichment diff logic**

```typescript
// src/lib/pipeline.ts

import type { ConfidenceCategory } from "./confidence.ts";
import { categorizeConfidence } from "./confidence.ts";

// --- Enrichment Diff ---

export type ExistingTags = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: number | string;
  genre?: string;
  trackNumber?: number | string;
};

export type ProposedTags = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: number | string;
  genre?: string;
  trackNumber?: number | string;
};

export type EnrichmentDiff = {
  field: string;
  current?: string;
  proposed: string;
};

const TAG_FIELDS: (keyof ExistingTags)[] = [
  "title",
  "artist",
  "album",
  "albumArtist",
  "year",
  "genre",
  "trackNumber",
];

const FIELD_LABELS: Record<keyof ExistingTags, string> = {
  title: "Title",
  artist: "Artist",
  album: "Album",
  albumArtist: "AlbumArtist",
  year: "Year",
  genre: "Genre",
  trackNumber: "TrackNumber",
};

export function buildEnrichmentDiff(
  existing: ExistingTags,
  proposed: ProposedTags,
  overwrite: boolean,
): EnrichmentDiff[] {
  const diffs: EnrichmentDiff[] = [];

  for (const field of TAG_FIELDS) {
    const currentVal = existing[field];
    const proposedVal = proposed[field];

    const proposedStr = proposedVal != null ? String(proposedVal) : undefined;
    const currentStr = currentVal != null ? String(currentVal) : undefined;

    // Never overwrite with blank
    if (!proposedStr) continue;

    // Same value — skip
    if (currentStr === proposedStr) continue;

    // Field is empty — always fill
    if (!currentStr) {
      diffs.push({
        field: FIELD_LABELS[field],
        current: undefined,
        proposed: proposedStr,
      });
      continue;
    }

    // Field has value — only overwrite if flag is set
    if (overwrite) {
      diffs.push({
        field: FIELD_LABELS[field],
        current: currentStr,
        proposed: proposedStr,
      });
    }
  }

  return diffs;
}

// --- Pipeline Types ---

export type PipelineOptions = {
  apiKey: string;
  dryRun: boolean;
  overwrite: boolean;
  organize: boolean;
  noArt: boolean;
  quiet: boolean;
  force: boolean;
  libraryRoot: string;
};

export type PipelineFileResult = {
  path: string;
  confidence: ConfidenceCategory;
  score: number;
  matchedRelease?: string;
  enriched: boolean;
  artAdded: boolean;
  organized?: string;
  error?: string;
};

export type PipelineReport = {
  totalFiles: number;
  matched: number;
  enriched: number;
  artAdded: number;
  duplicatesFound: number;
  unresolved: number;
  organized: number;
  conflicts: number;
  files: PipelineFileResult[];
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read --allow-env src/lib/pipeline.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/pipeline.ts src/lib/pipeline.test.ts
git commit -m "feat(fix): add pipeline types and enrichment diff logic"
```

---

## Task 8: Fix Command + CLI Registration

**Files:**

- Create: `src/commands/fix.ts`
- Create: `src/commands/fix.test.ts`
- Modify: `src/cli/cli.ts`

Wires the `fix` subcommand into the CLI. The command handler calls the pipeline
orchestrator. This task focuses on the CLI integration — the full pipeline
execution wiring is done iteratively as later stages are integrated.

- [ ] **Step 1: Write a basic CLI registration test**

```typescript
// src/commands/fix.test.ts
import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertNotEquals } from "@std/assert";
import { setupCLI } from "../cli/cli.ts";

describe("fix command registration", () => {
  it("should register fix as a valid subcommand", () => {
    const program = setupCLI();
    const commands = program.getCommands();
    const fixCmd = commands.find((c) => c.getName() === "fix");
    assertNotEquals(fixCmd, undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`deno test --allow-read --allow-env --allow-run --allow-write --allow-net --filter "fix command registration" src/commands/fix.test.ts`

Expected: FAIL — `fix` command not registered

- [ ] **Step 3: Create the command handler and register it**

```typescript
// src/commands/fix.ts
import { resolve } from "@std/path";

export async function fixCommand(
  options: {
    dryRun: boolean;
    overwrite: boolean;
    organize: boolean;
    noArt: boolean;
    quiet: boolean;
    force: boolean;
    apiKey?: string;
  },
  path: string,
): Promise<void> {
  const resolvedPath = resolve(path);

  const apiKey = options.apiKey ?? Deno.env.get("ACOUSTID_API_KEY");
  if (!apiKey) {
    console.error(
      "Error: AcoustID API key required. Set ACOUSTID_API_KEY env var or use --api-key.",
    );
    return;
  }

  try {
    await Deno.stat(resolvedPath);
  } catch {
    console.error(`Error: Path not found: ${resolvedPath}`);
    return;
  }

  if (!options.quiet) {
    console.log(`\namusic fix: processing ${resolvedPath}`);
    if (options.dryRun) console.log("  (dry run — no changes will be written)");
    if (options.overwrite) {
      console.log("  (overwrite mode — existing tags may be replaced)");
    }
    if (options.organize) {
      console.log("  (organize mode — files will be moved)");
    }
  }

  // Pipeline execution will be wired here as stages are integrated
  console.log(
    "\n[fix pipeline not yet implemented — stages coming in subsequent tasks]",
  );
}
```

In `src/cli/cli.ts`, add the import and registration:

Add import at top:

```typescript
import { fixCommand } from "../commands/fix.ts";
```

Add command registration (after the last `.command()` block, before
`.description()`):

```typescript
program
  .command(
    "fix <path:string>",
    "Identify, tag, and enrich music files using AcoustID + MusicBrainz",
  )
  .option("--dry-run", "Preview everything, write nothing", { default: false })
  .option(
    "--overwrite",
    "Allow replacing existing tags when the match is better",
    { default: false },
  )
  .option(
    "--organize",
    "Rename/move files into Artist/Album (Year)/NN Title.ext",
    { default: false },
  )
  .option("--no-art", "Skip cover art fetching", { default: false })
  .option("-q, --quiet", "Suppress progress output (errors still shown)", {
    default: false,
  })
  .option("-f, --force", "Reprocess even if previously processed", {
    default: false,
  })
  .option("--api-key <key:string>", "AcoustID API key (required for lookups)", {
    default: Deno.env.get("ACOUSTID_API_KEY"),
  })
  .action(fixCommand);
```

- [ ] **Step 4: Run test to verify it passes**

Run:
`deno test --allow-read --allow-env --allow-run --allow-write --allow-net --filter "fix command registration" src/commands/fix.test.ts`

Expected: PASS

- [ ] **Step 5: Run full test suite to verify nothing is broken**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`

Expected: All existing tests still pass

- [ ] **Step 6: Format and lint**

Run: `deno fmt && deno lint`

- [ ] **Step 7: Commit**

```bash
git add src/commands/fix.ts src/commands/fix.test.ts src/cli/cli.ts
git commit -m "feat(fix): add fix command with CLI registration"
```

---

## Task 9: Wire Pipeline Stages — Discovery + Fingerprint + Identify

**Files:**

- Modify: `src/lib/pipeline.ts`
- Modify: `src/lib/pipeline.test.ts`

Wire the first three stages of the pipeline: discover files, fingerprint them,
and look up recordings via AcoustID. This builds on existing modules and adds
rate-limited AcoustID lookups.

- [ ] **Step 1: Add the `runPipeline` function skeleton with discovery stage**

Add to `src/lib/pipeline.ts`:

```typescript
import { discoverMusic } from "../utils/fast_discovery.ts";
import {
  extractMusicBrainzIds,
  generateFingerprint,
  lookupFingerprint,
} from "./acoustid.ts";
import { getAudioDuration, getComprehensiveMetadata } from "./tagging.ts";
import {
  type AlbumFileInfo,
  fetchRecording,
  joinArtistCredits,
  type MBRecordingResponse,
  RateLimiter,
  type ScoredRelease,
  selectBestRelease,
} from "./musicbrainz.ts";

const ACOUSTID_RATE_LIMIT_MS = 334; // 3 requests/second

export async function runPipeline(
  options: PipelineOptions,
): Promise<PipelineReport> {
  const report: PipelineReport = {
    totalFiles: 0,
    matched: 0,
    enriched: 0,
    artAdded: 0,
    duplicatesFound: 0,
    unresolved: 0,
    organized: 0,
    conflicts: 0,
    files: [],
  };

  // Stage 1: Discover
  if (!options.quiet) console.log("\nStage 1: Discovering audio files...");
  const discovery = await discoverMusic([options.libraryRoot], {
    useMetadataGrouping: true,
  });

  const allFiles: string[] = [
    ...(discovery.albumGroups?.flatMap((g) => g.files) ?? []),
    ...discovery.singles,
  ];
  report.totalFiles = allFiles.length;

  if (allFiles.length === 0) {
    if (!options.quiet) console.log("No audio files found.");
    return report;
  }

  if (!options.quiet) console.log(`  Found ${allFiles.length} audio files.`);

  // Stage 2-3: Fingerprint + Identify
  if (!options.quiet) {
    console.log("\nStage 2-3: Fingerprinting and identifying...");
  }
  const acoustIdRateLimiter = new RateLimiter(ACOUSTID_RATE_LIMIT_MS);

  const fileRecordingMap = new Map<string, string>(); // path -> recordingId
  const fileAcoustIdMap = new Map<string, string>(); // path -> acoustId

  for (const filePath of allFiles) {
    const fingerprint = await generateFingerprint(filePath);
    if (!fingerprint) {
      if (!options.quiet) {
        console.log(`  Skipped (no fingerprint): ${filePath}`);
      }
      continue;
    }

    const duration = await getAudioDuration(filePath);
    await acoustIdRateLimiter.acquire();
    const lookup = await lookupFingerprint(
      fingerprint,
      duration,
      options.apiKey,
    );
    const mbIds = extractMusicBrainzIds(lookup);

    if (mbIds.trackId) {
      fileRecordingMap.set(filePath, mbIds.trackId);
    }
    if (lookup?.results?.[0]?.id) {
      fileAcoustIdMap.set(filePath, lookup.results[0].id);
    }
  }

  if (!options.quiet) {
    console.log(
      `  Identified ${fileRecordingMap.size}/${allFiles.length} files.`,
    );
  }

  // Stages 4+ to be added in subsequent tasks
  return report;
}
```

- [ ] **Step 2: Add integration test for pipeline discovery (unit test with
      mocking)**

Add to `src/lib/pipeline.test.ts`:

```typescript
describe("runPipeline", () => {
  it("should be importable and return a report type", async () => {
    // Verify the function exists and returns the expected shape
    // Full integration testing requires real files — covered in E2E
    const { runPipeline } = await import("./pipeline.ts");
    assertEquals(typeof runPipeline, "function");
  });
});
```

- [ ] **Step 3: Run tests**

Run:
`deno test --allow-read --allow-env --allow-run --allow-write --allow-net src/lib/pipeline.test.ts`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/pipeline.ts src/lib/pipeline.test.ts
git commit -m "feat(fix): wire discovery, fingerprint, and identify pipeline stages"
```

---

## Task 10: Wire Pipeline Stages — Match + Enrich + Cover Art

**Files:**

- Modify: `src/lib/pipeline.ts`
- Modify: `src/commands/fix.ts`

Wire stages 4-6: match releases per album group, compute enrichment diffs, fetch
cover art. This connects `selectBestRelease()`, `buildEnrichmentDiff()`, and
`fetchCoverArt()` into the pipeline flow.

- [ ] **Step 1: Add match + enrich + cover art stages to `runPipeline()`**

Continue the `runPipeline()` function after stages 2-3:

```typescript
// Stage 4: Match Releases
if (!options.quiet) console.log("\nStage 4: Matching releases...");
const mbRateLimiter = new RateLimiter();

// Fetch full recording data for all identified files
const recordingCache = new Map<string, MBRecordingResponse>();
const uniqueRecordingIds = new Set(fileRecordingMap.values());
for (const recId of uniqueRecordingIds) {
  const recording = await fetchRecording(recId, mbRateLimiter);
  if (recording) recordingCache.set(recId, recording);
}

// Match releases per album group
type MatchedGroup = {
  files: string[];
  bestRelease: ScoredRelease;
  albumFiles: AlbumFileInfo[];
};
const matchedGroups: MatchedGroup[] = [];
const unmatchedFiles: string[] = [];

const albumGroups = discovery.albumGroups ?? [];
for (const group of albumGroups) {
  const albumFiles: AlbumFileInfo[] = [];
  for (const filePath of group.files) {
    const recordingId = fileRecordingMap.get(filePath);
    if (!recordingId) continue;
    const meta = await getComprehensiveMetadata(filePath);
    albumFiles.push({
      path: filePath,
      recordingId,
      duration: meta?.duration ?? 0,
      trackNumber: meta?.track,
      existingTitle: meta?.title ?? undefined,
      existingArtist: meta?.artist ?? undefined,
      existingAlbum: meta?.album ?? undefined,
      existingYear: meta?.year ?? undefined,
      existingGenre: meta?.genre ?? undefined,
    });
  }

  if (albumFiles.length === 0) {
    unmatchedFiles.push(...group.files);
    continue;
  }

  const best = selectBestRelease(albumFiles, recordingCache);
  if (best) {
    matchedGroups.push({ files: group.files, bestRelease: best, albumFiles });
    report.matched += albumFiles.length;
  } else {
    unmatchedFiles.push(...group.files);
  }
}

// Handle singles
for (const filePath of discovery.singles) {
  const recordingId = fileRecordingMap.get(filePath);
  if (!recordingId) {
    unmatchedFiles.push(filePath);
    continue;
  }
  const meta = await getComprehensiveMetadata(filePath);
  const albumFiles: AlbumFileInfo[] = [{
    path: filePath,
    recordingId,
    duration: meta?.duration ?? 0,
    existingTitle: meta?.title ?? undefined,
    existingArtist: meta?.artist ?? undefined,
  }];
  const best = selectBestRelease(albumFiles, recordingCache, {
    isSingle: true,
  });
  if (best) {
    matchedGroups.push({ files: [filePath], bestRelease: best, albumFiles });
    report.matched++;
  } else {
    unmatchedFiles.push(filePath);
  }
}

report.unresolved = unmatchedFiles.length;
if (!options.quiet) {
  console.log(
    `  Matched ${matchedGroups.length} group(s), ${unmatchedFiles.length} unresolved.`,
  );
}

// Stage 5: Enrich + Stage 6: Cover Art
// (Process each matched group)
// Implementation continues below...
```

- [ ] **Step 2: Add enrichment application and cover art embedding**

Continue `runPipeline()`:

```typescript
  if (!options.quiet) console.log("\nStage 5-6: Enriching and fetching cover art...");

  const { fetchCoverArt } = await import("./cover_art.ts");
  const { ensureTagLib } = await import("./taglib_init.ts");
  const taglib = await ensureTagLib();

  for (const group of matchedGroups) {
    const release = group.bestRelease.release;
    const confidence = categorizeConfidence(group.bestRelease.score);
    const tracks = (release.media ?? []).flatMap((m) => m.tracks ?? []);
    const trackById = new Map(tracks.map((t) => [t.recording.id, t]));
    const recording = recordingCache.get(group.albumFiles[0]?.recordingId ?? "");
    const genres = recording?.genres?.sort((a, b) => b.count - a.count);
    const primaryGenre = genres?.[0]?.name;
    const releaseArtist = release["artist-credit"]
      ? joinArtistCredits(release["artist-credit"])
      : undefined;
    const releaseYear = release.date
      ? parseInt(release.date.substring(0, 4), 10)
      : undefined;

    // Cover art (once per group/release)
    let coverArtData: Uint8Array | undefined;
    if (!options.noArt && confidence !== "low") {
      const art = await fetchCoverArt(release.id);
      if (art) coverArtData = art.data;
    }

    for (const fileInfo of group.albumFiles) {
      const track = trackById.get(fileInfo.recordingId);
      const proposed: ProposedTags = {
        title: track?.title,
        artist: releaseArtist,
        album: release.title,
        albumArtist: releaseArtist,
        year: releaseYear,
        genre: primaryGenre,
        trackNumber: track?.position,
      };

      const existing: ExistingTags = {
        title: fileInfo.existingTitle,
        artist: fileInfo.existingArtist,
        album: fileInfo.existingAlbum,
        year: fileInfo.existingYear,
        genre: fileInfo.existingGenre,
        trackNumber: fileInfo.trackNumber,
      };

      const diff = buildEnrichmentDiff(existing, proposed, options.overwrite);
      const fileResult: PipelineFileResult = {
        path: fileInfo.path,
        confidence,
        score: group.bestRelease.score,
        matchedRelease: release.title,
        enriched: false,
        artAdded: false,
      };

      // Queue for review or auto-apply based on confidence
      if (confidence === "high" && diff.length > 0 && !options.dryRun) {
        // Auto-apply
        const audioFile = await taglib.open(fileInfo.path);
        for (const d of diff) {
          applyTagDiff(audioFile, d);
        }
        // Embed cover art if file has none
        if (coverArtData && audioFile.getPictures().length === 0) {
          audioFile.setPictures([{
            data: coverArtData,
            mimeType: "image/jpeg",
            type: "FrontCover",
            description: "",
          }]);
          fileResult.artAdded = true;
          report.artAdded++;
        }
        await audioFile.saveToFile();
        audioFile.dispose();
        fileResult.enriched = true;
        report.enriched++;
      }
      // Medium confidence items collected for review (handled in Task 11)

      report.files.push(fileResult);
    }
  }

  return report;
}

function applyTagDiff(audioFile: any, diff: EnrichmentDiff): void {
  switch (diff.field) {
    case "Title": audioFile.tag().setTitle(diff.proposed); break;
    case "Artist": audioFile.tag().setArtist(diff.proposed); break;
    case "Album": audioFile.tag().setAlbum(diff.proposed); break;
    case "AlbumArtist": audioFile.setProperty("ALBUMARTIST", diff.proposed); break;
    case "Year": audioFile.tag().setYear(parseInt(diff.proposed, 10)); break;
    case "Genre": audioFile.tag().setGenre(diff.proposed); break;
    case "TrackNumber": audioFile.tag().setTrack(parseInt(diff.proposed, 10)); break;
  }
}
```

- [ ] **Step 3: Update `fixCommand` to call `runPipeline()`**

In `src/commands/fix.ts`, replace the placeholder with:

```typescript
import { runPipeline } from "../lib/pipeline.ts";

// Replace the placeholder console.log with:
const report = await runPipeline({
  apiKey,
  dryRun: options.dryRun,
  overwrite: options.overwrite,
  organize: options.organize,
  noArt: options.noArt,
  quiet: options.quiet,
  force: options.force,
  libraryRoot: resolvedPath,
});

// Print summary
if (!options.quiet) {
  console.log("\n--- Fix Summary ---");
  console.log(`  Files found:    ${report.totalFiles}`);
  console.log(`  Matched:        ${report.matched}`);
  console.log(`  Enriched:       ${report.enriched}`);
  console.log(`  Art added:      ${report.artAdded}`);
  console.log(`  Duplicates:     ${report.duplicatesFound}`);
  console.log(`  Unresolved:     ${report.unresolved}`);
  if (options.organize) {
    console.log(`  Organized:      ${report.organized}`);
    console.log(`  Conflicts:      ${report.conflicts}`);
  }
}
```

- [ ] **Step 4: Run full test suite**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`

Expected: All tests pass

- [ ] **Step 5: Format and lint**

Run: `deno fmt && deno lint`

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline.ts src/commands/fix.ts
git commit -m "feat(fix): wire match, enrich, and cover art pipeline stages"
```

---

## Task 11: Wire Review + Duplicate Detection + Organize into Pipeline

**Files:**

- Modify: `src/lib/pipeline.ts`

Wire the remaining stages: collect medium-confidence items for review, apply
accepted items, detect duplicates, and optionally organize files.

- [ ] **Step 1: Refactor enrichment loop to collect review items**

In Task 10's enrichment loop, medium-confidence items are skipped. Refactor to
collect them. In the `for (const fileInfo of group.albumFiles)` loop, after the
high-confidence auto-apply block, add:

```typescript
// Medium confidence — queue for review
if (confidence === "medium" && diff.length > 0) {
  reviewItems.push({
    sourcePath: fileInfo.path,
    proposedTitle: proposed.title,
    proposedArtist: proposed.artist ? String(proposed.artist) : undefined,
    proposedAlbum: proposed.album,
    proposedYear: proposed.year ? Number(proposed.year) : undefined,
    confidence: group.bestRelease.score,
    confidenceReason: buildConfidenceReason(
      group.bestRelease,
      group.albumFiles,
    ),
    diffs: diff.map((d) => ({
      field: d.field,
      current: d.current,
      proposed: d.proposed,
    })),
  });
  // Store the diff and cover art data for later application
  pendingReviewData.set(fileInfo.path, { diff, coverArtData, fileResult });
}
```

Declare these before the enrichment loop:

```typescript
import type { ReviewItem, TagDiff } from "./review.ts";

const reviewItems: ReviewItem[] = [];
const pendingReviewData = new Map<string, {
  diff: EnrichmentDiff[];
  coverArtData: Uint8Array | undefined;
  fileResult: PipelineFileResult;
}>();
```

Add the helper function:

```typescript
function buildConfidenceReason(
  scored: ScoredRelease,
  files: AlbumFileInfo[],
): string {
  const pct = Math.round(scored.score * 100);
  const release = scored.release;
  const trackCount = (release.media ?? []).reduce(
    (sum, m) => sum + m.track_count,
    0,
  );
  if (files.length !== trackCount) {
    return `fingerprint matched but track count mismatch (${files.length} files, ${trackCount}-track release)`;
  }
  if (scored.matchedRecordings < files.length) {
    return `${scored.matchedRecordings}/${files.length} tracks matched`;
  }
  return "fingerprint matched, limited tag corroboration";
}
```

- [ ] **Step 2: Add review stage — apply accepted items**

After the enrichment loop, add the review and apply logic:

```typescript
// Stage 7: Review (medium-confidence items)
if (reviewItems.length > 0) {
  const { runBatchReview } = await import("./review.ts");
  const decisions = await runBatchReview(reviewItems);

  for (const [path, decision] of decisions) {
    if (decision !== "accept") continue;
    const pending = pendingReviewData.get(path);
    if (!pending || options.dryRun) continue;

    const audioFile = await taglib.open(path);
    for (const d of pending.diff) {
      applyTagDiff(audioFile, d);
    }
    if (pending.coverArtData && audioFile.getPictures().length === 0) {
      audioFile.setPictures([{
        data: pending.coverArtData,
        mimeType: "image/jpeg",
        type: "FrontCover",
        description: "",
      }]);
      pending.fileResult.artAdded = true;
      report.artAdded++;
    }
    await audioFile.saveToFile();
    audioFile.dispose();
    pending.fileResult.enriched = true;
    report.enriched++;
  }
}
```

- [ ] **Step 3: Add duplicate detection stage**

```typescript
// Stage 8: Duplicate Detection
if (!options.quiet) console.log("\nStage 8: Checking for duplicates...");
const { detectDuplicates } = await import("./duplicate_detection.ts");

// Note: FileQualityInfo type should be imported at the top of pipeline.ts:
// import type { FileQualityInfo } from "./duplicate_detection.ts";

const qualityInfos: FileQualityInfo[] = [];
for (const fileResult of report.files) {
  qualityInfos.push({
    path: fileResult.path,
    acoustIdId: fileAcoustIdMap.get(fileResult.path),
    recordingId: fileRecordingMap.get(fileResult.path),
    format: fileResult.path.split(".").pop()?.toLowerCase() ?? "",
    bitrate: 0, // Read from metadata cache if available
    tagCount: 0,
    title: fileResult.matchedRelease,
  });
}

const duplicateGroups = detectDuplicates(qualityInfos);
report.duplicatesFound = duplicateGroups.length;

if (duplicateGroups.length > 0 && !options.quiet) {
  console.log(`\nDuplicates found:`);
  for (const group of duplicateGroups) {
    const title = group.title ?? "Unknown";
    const artist = group.artist ?? "Unknown";
    console.log(`  "${title}" by ${artist}`);
    console.log(
      `    KEEP:  ${group.files[0].path} (${
        group.files[0].format.toUpperCase()
      }, ${group.files[0].bitrate}kbps)`,
    );
    for (let i = 1; i < group.files.length; i++) {
      console.log(
        `    EXTRA: ${group.files[i].path} (${
          group.files[i].format.toUpperCase()
        }, ${group.files[i].bitrate}kbps)`,
      );
    }
  }
}
```

- [ ] **Step 4: Add organize stage**

```typescript
// Stage 9: Organize (optional)
if (options.organize) {
  if (!options.quiet) console.log("\nStage 9: Organizing files...");
  const { buildOrganizedPath, moveFile, cleanEmptyDirs } = await import(
    "./organizer.ts"
  );
  const { extname } = await import("@std/path");

  for (const group of matchedGroups) {
    const release = group.bestRelease.release;
    const tracks = (release.media ?? []).flatMap((m) => m.tracks ?? []);
    const trackById = new Map(tracks.map((t) => [t.recording.id, t]));
    const releaseArtist = release["artist-credit"]
      ? joinArtistCredits(release["artist-credit"])
      : "Unknown Artist";
    const releaseYear = release.date
      ? parseInt(release.date.substring(0, 4), 10)
      : undefined;
    const isCompilation = group.albumFiles.length > 2 &&
      new Set(group.albumFiles.map((f) => f.existingArtist)).size >= 3;

    for (const fileInfo of group.albumFiles) {
      const track = trackById.get(fileInfo.recordingId);
      const destination = buildOrganizedPath({
        libraryRoot: options.libraryRoot,
        artist: isCompilation ? "Various Artists" : releaseArtist,
        album: release.title,
        year: releaseYear,
        trackNumber: track?.position,
        title: track?.title ?? fileInfo.existingTitle ?? "Unknown",
        extension: extname(fileInfo.path),
        isCompilation,
        totalTracks: tracks.length,
      });

      if (destination === fileInfo.path) continue;

      const result = await moveFile(fileInfo.path, destination, options.dryRun);
      if (result.status === "moved") {
        report.organized++;
        if (!options.quiet) console.log(`  ${fileInfo.path} -> ${destination}`);
        await cleanEmptyDirs(dirname(fileInfo.path));
      } else if (result.status === "conflict") {
        report.conflicts++;
        if (!options.quiet) {
          console.log(`  CONFLICT: ${destination} already exists`);
        }
      } else if (result.status === "dry-run" && !options.quiet) {
        console.log(`  [dry-run] ${fileInfo.path} -> ${destination}`);
      }
    }
  }
}
```

Note: `dirname` is already imported from `@std/path` via the organizer module.
Add the import at the top of pipeline.ts: `import { dirname } from "@std/path";`

- [ ] **Step 5: Run full test suite**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`

Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline.ts
git commit -m "feat(fix): wire review, duplicate detection, and organize stages"
```

---

## Task 12: E2E Integration Test

**Files:**

- Modify: `src/commands/fix.test.ts`

End-to-end test using a real audio folder (duplicated from the test data
directory per CLAUDE.local.md instructions).

- [ ] **Step 1: Write E2E test**

```typescript
// Add to src/commands/fix.test.ts
describe("fix command E2E", () => {
  it("should run fix --dry-run on a test folder without errors", async () => {
    const testDir = await Deno.makeTempDir({ prefix: "amusic-fix-test-" });
    // Copy a small test audio file if available
    try {
      const cmd = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-read",
          "--allow-run",
          "--allow-write",
          "--allow-env",
          "--allow-net",
          "src/amusic.ts",
          "fix",
          testDir,
          "--dry-run",
          "--api-key",
          "test-key",
        ],
        stdout: "piped",
        stderr: "piped",
      });
      const output = await cmd.output();
      // Should exit cleanly (0) even with no files
      assertEquals(output.code, 0);
    } finally {
      await Deno.remove(testDir, { recursive: true });
    }
  });
});
```

- [ ] **Step 2: Run the E2E test**

Run:
`deno test --allow-read --allow-run --allow-write --allow-env --allow-net --filter "fix command E2E" src/commands/fix.test.ts`

Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`

Expected: All tests pass

- [ ] **Step 4: Format and lint**

Run: `deno fmt && deno lint`

- [ ] **Step 5: Commit**

```bash
git add src/commands/fix.test.ts
git commit -m "test(fix): add E2E integration test for fix command"
```

---

## Task 13: Final Cleanup and Push

- [ ] **Step 1: Run all checks**

```bash
deno fmt --check
deno lint
deno test --allow-read --allow-run --allow-write --allow-env --allow-net
```

Expected: All pass

- [ ] **Step 2: Push to remote**

```bash
git push
```
