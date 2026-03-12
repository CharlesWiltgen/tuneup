# MusicBrainz Enrichment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture MusicBrainz IDs during AcoustID processing (Tier 1) and add an
`amusic enrich` command that uses album-level scoring to identify correct
releases and apply authoritative metadata (Tier 2).

**Architecture:** Tier 1 modifies the existing AcoustID pipeline to write three
additional MusicBrainz ID tags from data already in the API response. Tier 2
adds a new `musicbrainz.ts` module (API client, rate limiter, scoring model) and
`enrich.ts` command (discovery, diff display, confirmation flow).

**Tech Stack:** Deno, taglib-wasm v1.0.0, Cliffy (CLI framework), MusicBrainz
API v2 (JSON, unauthenticated)

**Spec:** `docs/superpowers/specs/2026-03-12-musicbrainz-enrichment-design.md`

---

## Chunk 1: Tier 1 — Capture MusicBrainz IDs

### Task 1: Add `writeMusicBrainzTags` function to tagging.ts

**Files:**
- Modify: `src/lib/tagging.ts`
- Test: `src/lib/tagging.test.ts` (create — no existing test file for tagging)

**Context:** `tagging.ts` already has `writeAcoustIDTags()` (line 97) and
`writeReplayGainTags()` (line 193) as patterns. taglib-wasm property keys are
available via `PROPERTIES.musicbrainzTrackId.key`,
`PROPERTIES.musicbrainzArtistId.key`, `PROPERTIES.musicbrainzReleaseId.key`.
The `openFileForWrite` helper (line 14) handles file opening.

- [ ] **Step 1: Write the failing test**

Create `src/lib/tagging.test.ts`. Use real audio fixtures from
`tests/test_run_files/` for round-trip write/read tests. Available fixtures:
`tests/test_run_files/dry_run_no_write/dry_run_test.wav` and
`tests/test_run_files/show_tags_none/clean.wav`.

```ts
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { copy } from "@std/fs";
import { join } from "@std/path";
import {
  hasMusicBrainzTags,
  type MusicBrainzIds,
  writeMusicBrainzTags,
} from "./tagging.ts";

const FIXTURE_FILE = "tests/test_run_files/show_tags_none/clean.wav";

async function withTempCopy(fn: (tmpFile: string) => Promise<void>) {
  const tmpDir = await Deno.makeTempDir({ prefix: "amusic-test-mb-" });
  try {
    const tmpFile = join(tmpDir, "clean.wav");
    await copy(FIXTURE_FILE, tmpFile);
    await fn(tmpFile);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}

describe("writeMusicBrainzTags", () => {
  it("should write and read back MusicBrainz IDs from a real audio file", async () => {
    await withTempCopy(async (testFile) => {
      const ids: MusicBrainzIds = {
        trackId: "12345678-1234-1234-1234-123456789abc",
        artistId: "abcdefab-abcd-abcd-abcd-abcdefabcdef",
        releaseId: "fedcba98-fedc-fedc-fedc-fedcba987654",
      };

      const result = await writeMusicBrainzTags(testFile, ids);
      assertEquals(result, true);

      const hasTags = await hasMusicBrainzTags(testFile);
      assertEquals(hasTags, true);
    });
  });

  it("should return true even when writing partial IDs", async () => {
    await withTempCopy(async (testFile) => {
      const ids: MusicBrainzIds = {
        trackId: "12345678-1234-1234-1234-123456789abc",
      };
      const result = await writeMusicBrainzTags(testFile, ids);
      assertEquals(result, true);
    });
  });
});

describe("hasMusicBrainzTags", () => {
  it("should return false for a file without MusicBrainz tags", async () => {
    const hasTags = await hasMusicBrainzTags(FIXTURE_FILE);
    assertEquals(hasTags, false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read --allow-write --allow-env --allow-net src/lib/tagging.test.ts`
Expected: FAIL — `writeMusicBrainzTags` not exported

- [ ] **Step 3: Implement `writeMusicBrainzTags`**

Add to `src/lib/tagging.ts` after `writeAcoustIDTags` (after line 125):

```ts
export type MusicBrainzIds = {
  trackId?: string;
  artistId?: string;
  releaseId?: string;
};

export async function writeMusicBrainzTags(
  filePath: string,
  ids: MusicBrainzIds,
): Promise<boolean> {
  const taglib = await ensureTagLib();

  let audioFile = null;
  try {
    audioFile = await openFileForWrite(taglib, filePath);

    if (ids.trackId) {
      audioFile.setProperty(PROPERTIES.musicbrainzTrackId.key, ids.trackId);
    }
    if (ids.artistId) {
      audioFile.setProperty(PROPERTIES.musicbrainzArtistId.key, ids.artistId);
    }
    if (ids.releaseId) {
      audioFile.setProperty(PROPERTIES.musicbrainzReleaseId.key, ids.releaseId);
    }

    await audioFile.saveToFile();
    return true;
  } catch (error) {
    console.error(
      `Error writing MusicBrainz tags to ${filePath}: ${formatError(error)}`,
    );
    return false;
  } finally {
    if (audioFile) {
      audioFile.dispose();
    }
  }
}
```

Also add a `hasMusicBrainzTags` function (needed for skip logic):

```ts
export async function hasMusicBrainzTags(filePath: string): Promise<boolean> {
  const taglib = await ensureTagLib();

  let audioFile = null;
  try {
    audioFile = await openFileForRead(taglib, filePath);
    const trackId = audioFile.getProperty(PROPERTIES.musicbrainzTrackId.key);
    return trackId !== null && trackId !== undefined && trackId.length > 0;
  } catch {
    return false;
  } finally {
    if (audioFile) {
      audioFile.dispose();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read --allow-write --allow-env --allow-net src/lib/tagging.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/tagging.ts src/lib/tagging.test.ts
git commit -m "feat: add writeMusicBrainzTags and hasMusicBrainzTags functions"
```

---

### Task 2: Add `extractMusicBrainzIds` helper to acoustid.ts

**Files:**
- Modify: `src/lib/acoustid.ts`
- Test: `src/lib/acoustid.test.ts` (existing)

**Context:** The `LookupResult` → `ResultItem` → `Recording` → `ReleaseGroup`
type chain is at lines 23-57 of `acoustid.ts`. The function must safely traverse
nullable nested fields. Currently `lookupResult.results[0].id` is extracted at
line 255. We need a parallel extraction for MusicBrainz IDs.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/acoustid.test.ts`:

```ts
import { extractMusicBrainzIds } from "./acoustid.ts";

describe("extractMusicBrainzIds", () => {
  it("should extract all three IDs from a complete result", () => {
    const result = {
      results: [{
        id: "acoustid-123",
        score: 0.95,
        recordings: [{
          id: "mb-recording-123",
          artists: [{ id: "mb-artist-123", name: "Test" }],
          releasegroups: [{
            id: "rg-123",
            releases: [{ id: "mb-release-123", title: "Album" }],
          }],
        }],
      }],
    };
    assertEquals(extractMusicBrainzIds(result), {
      trackId: "mb-recording-123",
      artistId: "mb-artist-123",
      releaseId: "mb-release-123",
    });
  });

  it("should return empty object when no recordings", () => {
    assertEquals(extractMusicBrainzIds({ results: [{ id: "x", score: 0.9 }] }), {});
  });

  it("should return partial IDs when some fields missing", () => {
    const result = {
      results: [{
        id: "x",
        score: 0.9,
        recordings: [{ id: "mb-rec", releasegroups: [] }],
      }],
    };
    assertEquals(extractMusicBrainzIds(result), { trackId: "mb-rec" });
  });

  it("should return empty object for null/empty results", () => {
    assertEquals(extractMusicBrainzIds(null), {});
    assertEquals(extractMusicBrainzIds({ results: [] }), {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/lib/acoustid.test.ts --filter "extractMusicBrainzIds"`
Expected: FAIL — `extractMusicBrainzIds` not exported

- [ ] **Step 3: Implement `extractMusicBrainzIds`**

Add to `src/lib/acoustid.ts` (after the type definitions, before
`generateFingerprint`):

```ts
import type { MusicBrainzIds } from "./tagging.ts";

export function extractMusicBrainzIds(
  lookupResult: LookupResult | null,
): MusicBrainzIds {
  const ids: MusicBrainzIds = {};
  const recording = lookupResult?.results?.[0]?.recordings?.[0];
  if (!recording) return ids;

  ids.trackId = recording.id;

  if (recording.artists?.[0]?.id) {
    ids.artistId = recording.artists[0].id;
  }

  const release = recording.releasegroups?.[0]?.releases?.[0];
  if (release?.id) {
    ids.releaseId = release.id;
  }

  return ids;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/lib/acoustid.test.ts --filter "extractMusicBrainzIds"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/acoustid.ts src/lib/acoustid.test.ts
git commit -m "feat: add extractMusicBrainzIds to extract MB IDs from AcoustID response"
```

---

### Task 3: Wire MusicBrainz tag writing into AcoustID processing

**Files:**
- Modify: `src/lib/acoustid.ts`
- Test: Manual integration test (run on real file)

**Context:** `processAcoustIDTagging()` (line 158) currently:
1. Checks for existing AcoustID tags (line 184) — returns `"skipped"` if present
2. Generates fingerprint (line 204)
3. Looks up via API (line 232)
4. Extracts `acoustIDToWrite = lookupResult.results[0].id` (line 255)
5. Writes AcoustID tags (line 283)

**Critical restructuring needed per spec (lines 49-69):** The current early
return at line 184 prevents MusicBrainz tag writing for files that already have
AcoustID tags. The spec requires: "Regardless of whether AcoustID tags were
skipped, if `MUSICBRAINZ_TRACKID` is absent, extract and write MusicBrainz IDs
from the lookup response." This means the lookup must still execute even when
AcoustID tags are present (the lookup needs the fingerprint which requires
fpcalc to run).

The restructured flow:
1. Generate fingerprint (always — needed for both AcoustID and MB)
2. Look up via API (always — if apiKey present)
3. Write AcoustID tags (skip if present unless `--force`)
4. Write MusicBrainz tags (independent skip: skip if MUSICBRAINZ_TRACKID present
   unless `--force`)

- [ ] **Step 1: Restructure `processAcoustIDTagging` and add MB tag writing**

In `src/lib/acoustid.ts`, add imports at top:

```ts
import {
  hasMusicBrainzTags,
  writeMusicBrainzTags,
} from "./tagging.ts";
```

Restructure the function so fingerprint generation and lookup always execute.
Move the AcoustID skip check to only guard the AcoustID tag *write*, not the
lookup. Specifically:

1. Hoist `lookupResult` declaration to function scope (before the `if (apiKey)`
   block). Change `const lookupResult = await lookupFingerprint(...)` at
   line 232 to `lookupResult = await lookupFingerprint(...)` (assignment, not
   declaration).

2. Replace the early return at line 184 (`if (hasExistingTags && !force)
   return "skipped"`) with a flag: `const skipAcoustIdWrite = hasExistingTags
   && !force;`

3. Keep fingerprint generation and API lookup running unconditionally (they are
   needed for MB tag extraction even when AcoustID tags exist).

4. Guard the AcoustID tag write section with `if (!skipAcoustIdWrite)`.

5. Return value: when AcoustID tags were skipped but MB tags were written,
   return `"processed"`. When both were skipped (MB tags also already present),
   return `"skipped"`.

6. Add the MB tag writing block after the AcoustID section:

```ts
  // Write MusicBrainz tags (independent of AcoustID skip logic)
  if (lookupResult?.results?.[0]?.recordings?.length) {
    const hasMBTags = await hasMusicBrainzTags(filePath);
    if (!hasMBTags || force) {
      const mbIds = extractMusicBrainzIds(lookupResult);
      if (Object.keys(mbIds).length > 0) {
        if (!dryRun) {
          const mbSuccess = await writeMusicBrainzTags(filePath, mbIds);
          if (!quiet) {
            if (mbSuccess) {
              console.log(`  SUCCESS: MusicBrainz IDs written (${Object.keys(mbIds).join(", ")}).`);
            } else {
              console.log("  WARNING: Failed to write MusicBrainz tags.");
            }
          }
        } else if (!quiet) {
          console.log(`  DRY RUN: Would write MusicBrainz IDs: ${JSON.stringify(mbIds)}`);
        }
      }
    }
  }
```

- [ ] **Step 2: Restructure `batchProcessAcoustIDTagging` similarly**

The batch function (line 301) has the same issue: it filters out files with
existing AcoustID tags at lines 330-337, so those files never get MB tags.

Restructure the batch function:

1. Keep the file list unfiltered — process all files, not just those missing
   AcoustID tags. For each file, track whether it needs AcoustID write
   (`needsAcoustIdWrite`) vs. just MB write.

2. Hoist `lookupResult` declaration above the `if (apiKey)` block (same
   pattern as Step 1). Change `const` to assignment inside the block.

3. For each file in the loop: if `needsAcoustIdWrite`, write AcoustID tags.
   Then independently check MB tags and write if needed.

**Performance note**: This means files that already have AcoustID tags will
still run through fingerprint generation and API lookup (needed to get MB
data). This is acceptable for Tier 1 — the fpcalc call is the expensive part,
and it's needed to get the fingerprint for the AcoustID API lookup which
returns the MB data. If a file has *both* AcoustID and MB tags, the function
skips both writes quickly.

```ts
        // Write MusicBrainz tags (independent skip logic)
        if (lookupResult?.results?.[0]?.recordings?.length) {
          const hasMBTags = await hasMusicBrainzTags(filePath);
          if (!hasMBTags || force) {
            const mbIds = extractMusicBrainzIds(lookupResult);
            if (Object.keys(mbIds).length > 0 && !dryRun) {
              await writeMusicBrainzTags(filePath, mbIds);
            }
          }
        }
```

- [ ] **Step 3: Run existing AcoustID tests to verify no regressions**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/lib/acoustid.test.ts`
Expected: All existing tests PASS

- [ ] **Step 4: Run full test suite**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/acoustid.ts
git commit -m "feat: write MusicBrainz IDs during AcoustID processing (Tier 1)"
```

---

## Chunk 2: Tier 2 Foundation — MusicBrainz API Client and Scoring Model

### Task 4: MusicBrainz API types and rate-limited client

**Files:**
- Create: `src/lib/musicbrainz.ts`
- Test: `src/lib/musicbrainz.test.ts`

**Context:** MusicBrainz API v2 returns JSON. The recording endpoint
`/ws/2/recording/{id}?inc=artists+releases+genres&fmt=json` returns a recording
with nested releases, each containing media with tracks. Rate limit is strictly
1 req/sec. The User-Agent must identify the application.

The `VERSION` constant is in `src/version.ts`.

- [ ] **Step 1: Write failing tests for types and rate limiter**

Create `src/lib/musicbrainz.test.ts`:

```ts
import { assert, assertEquals, assertGreater, assertNotEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  fetchRecording,
  type MBRecordingResponse,
  type MBRelease,
  RateLimiter,
} from "./musicbrainz.ts";

describe("RateLimiter", () => {
  it("should allow first request immediately", async () => {
    const limiter = new RateLimiter(1000);
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    assert(elapsed < 50, `Expected first request < 50ms, got ${elapsed}ms`);
  });

  it("should enforce delay between requests", async () => {
    const limiter = new RateLimiter(200); // 200ms for fast test
    await limiter.acquire();
    const start = Date.now();
    await limiter.acquire();
    const elapsed = Date.now() - start;
    assertGreater(elapsed, 150);
  });
});

describe("fetchRecording", () => {
  it("should return null for a nonexistent recording ID", async () => {
    const limiter = new RateLimiter(0); // no delay for tests
    const result = await fetchRecording(
      "00000000-0000-0000-0000-000000000000",
      limiter,
    );
    assertEquals(result, null);
  });

  it("should return recording data for a known recording ID", async () => {
    const limiter = new RateLimiter(0);
    // "Yesterday" by The Beatles — well-known, stable MusicBrainz ID
    const result = await fetchRecording(
      "465ad10c-dc4c-45c1-9f7d-ee5225e39741",
      limiter,
    );
    assertNotEquals(result, null);
    assertEquals(result!.id, "465ad10c-dc4c-45c1-9f7d-ee5225e39741");
    assert(result!.title.length > 0, "Expected non-empty title");
    assert((result!.releases ?? []).length > 0, "Expected at least one release");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read --allow-env --allow-net src/lib/musicbrainz.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement types and rate limiter**

Create `src/lib/musicbrainz.ts`:

```ts
import { VERSION } from "../version.ts";

const MUSICBRAINZ_API_BASE = "https://musicbrainz.org/ws/2";
const USER_AGENT = `amusic/${VERSION} (https://github.com/CharlesWiltgen/amusic)`;
const RATE_LIMIT_MS = 1100; // slightly over 1s to be safe
const RETRY_DELAY_MS = 5000;
const REQUEST_TIMEOUT_MS = 10000;

// --- MusicBrainz API Response Types ---

export type MBArtistCredit = {
  name: string;
  artist: { id: string; name: string };
};

export type MBTrack = {
  id: string;
  number: string;
  title: string;
  length: number | null; // milliseconds
  position: number;
  recording: { id: string };
};

export type MBMedium = {
  position: number;
  format?: string;
  track_count: number;
  tracks?: MBTrack[];
};

export type MBRelease = {
  id: string;
  title: string;
  status?: string;
  date?: string;
  country?: string;
  "release-group"?: {
    id: string;
    "primary-type"?: string;
  };
  "artist-credit"?: MBArtistCredit[];
  media?: MBMedium[];
};

export type MBGenre = {
  name: string;
  count: number;
};

export type MBRecordingResponse = {
  id: string;
  title: string;
  length: number | null; // milliseconds
  "artist-credit"?: MBArtistCredit[];
  releases?: MBRelease[];
  genres?: MBGenre[];
};

// --- Rate Limiter ---

export class RateLimiter {
  private lastRequestTime = 0;

  constructor(private minIntervalMs: number = RATE_LIMIT_MS) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minIntervalMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.minIntervalMs - elapsed)
      );
    }
    this.lastRequestTime = Date.now();
  }
}

// --- API Client ---

// Default rate limiter instance. `fetchRecording` accepts a limiter parameter
// so tests can inject their own (avoids untestable module-level state).
const defaultRateLimiter = new RateLimiter();

export async function fetchRecording(
  recordingId: string,
  rateLimiter: RateLimiter = defaultRateLimiter,
): Promise<MBRecordingResponse | null> {
  await rateLimiter.acquire();

  // Note: `+media` is intentionally added beyond the spec's `inc=artists+releases+genres`.
  // Media data (tracks with positions and durations) is required for the scoring model
  // to match recordings to release tracks.
  const url =
    `${MUSICBRAINZ_API_BASE}/recording/${recordingId}?inc=artists+releases+genres+media&fmt=json`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.status === 503) {
        if (attempt === 0) {
          console.error(
            `  MusicBrainz rate limited, retrying in ${RETRY_DELAY_MS / 1000}s...`,
          );
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        console.error("  MusicBrainz rate limit retry failed, skipping.");
        return null;
      }

      if (response.status === 404) {
        console.error(
          `  MusicBrainz recording not found: ${recordingId}`,
        );
        return null;
      }

      if (!response.ok) {
        console.error(
          `  MusicBrainz API error: ${response.status} ${response.statusText}`,
        );
        return null;
      }

      return (await response.json()) as MBRecordingResponse;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        console.error(
          `  MusicBrainz request timed out for recording ${recordingId}`,
        );
      } else {
        console.error(
          `  MusicBrainz API error for ${recordingId}: ${error}`,
        );
      }
      return null;
    }
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read --allow-env --allow-net src/lib/musicbrainz.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/musicbrainz.ts src/lib/musicbrainz.test.ts
git commit -m "feat: add MusicBrainz API types, rate limiter, and fetch client"
```

---

### Task 5: String similarity using normalizeForMatching

**Files:**
- Modify: `src/lib/musicbrainz.ts`
- Test: `src/lib/musicbrainz.test.ts`

**Context:** The scoring model needs string similarity for album/artist tag
agreement. Per spec, use existing `normalizeForMatching()` from
`src/utils/normalize.ts` rather than adding a Levenshtein library. After
normalizing both strings, compute a simple ratio of common characters.

- [ ] **Step 1: Write failing tests**

Add to `src/lib/musicbrainz.test.ts`:

```ts
import { normalizedSimilarity } from "./musicbrainz.ts";

describe("normalizedSimilarity", () => {
  it("should return 1.0 for identical strings", () => {
    assertEquals(normalizedSimilarity("Abbey Road", "Abbey Road"), 1.0);
  });

  it("should return 1.0 for case/diacritics differences", () => {
    assertEquals(normalizedSimilarity("Björk", "bjork"), 1.0);
  });

  it("should return high score for minor differences", () => {
    const score = normalizedSimilarity(
      "Abbey Road (Deluxe)",
      "Abbey Road",
    );
    assertGreater(score, 0.6);
  });

  it("should return low score for very different strings", () => {
    const score = normalizedSimilarity("Abbey Road", "Thriller");
    assert(score < 0.3, `Expected score < 0.3 for very different strings, got ${score}`);
  });

  it("should return 0.5 when either string is empty", () => {
    assertEquals(normalizedSimilarity("", "Abbey Road"), 0.5);
    assertEquals(normalizedSimilarity("Abbey Road", ""), 0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read --allow-env --allow-net src/lib/musicbrainz.test.ts --filter "normalizedSimilarity"`
Expected: FAIL

- [ ] **Step 3: Implement `normalizedSimilarity`**

Add to `src/lib/musicbrainz.ts`:

```ts
import { normalizeForMatching } from "../utils/normalize.ts";

export function normalizedSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0.5;

  const na = normalizeForMatching(a);
  const nb = normalizeForMatching(b);

  if (na === nb) return 1.0;
  if (na.length === 0 || nb.length === 0) return 0.5;

  // Longest common subsequence ratio
  const longer = na.length >= nb.length ? na : nb;
  const shorter = na.length >= nb.length ? nb : na;

  let matches = 0;
  let j = 0;
  for (let i = 0; i < longer.length && j < shorter.length; i++) {
    if (longer[i] === shorter[j]) {
      matches++;
      j++;
    }
  }

  return matches / longer.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read --allow-env --allow-net src/lib/musicbrainz.test.ts --filter "normalizedSimilarity"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/musicbrainz.ts src/lib/musicbrainz.test.ts
git commit -m "feat: add normalizedSimilarity for tag agreement scoring"
```

---

### Task 6: Longest increasing subsequence (track order scoring)

**Files:**
- Modify: `src/lib/musicbrainz.ts`
- Test: `src/lib/musicbrainz.test.ts`

**Context:** Track order scoring needs LIS length. O(n log n) via patience
sorting. ~15 lines, no dependency needed.

- [ ] **Step 1: Write failing tests**

Add to `src/lib/musicbrainz.test.ts`:

```ts
import { longestIncreasingSubsequenceLength } from "./musicbrainz.ts";

describe("longestIncreasingSubsequenceLength", () => {
  it("should return full length for sorted sequence", () => {
    assertEquals(longestIncreasingSubsequenceLength([1, 2, 3, 4, 5]), 5);
  });

  it("should return 1 for reverse-sorted sequence", () => {
    assertEquals(longestIncreasingSubsequenceLength([5, 4, 3, 2, 1]), 1);
  });

  it("should find LIS in mixed sequence", () => {
    assertEquals(longestIncreasingSubsequenceLength([1, 3, 2, 4, 5]), 4);
  });

  it("should return 0 for empty sequence", () => {
    assertEquals(longestIncreasingSubsequenceLength([]), 0);
  });

  it("should handle single element", () => {
    assertEquals(longestIncreasingSubsequenceLength([42]), 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement LIS**

Add to `src/lib/musicbrainz.ts`:

```ts
export function longestIncreasingSubsequenceLength(seq: number[]): number {
  if (seq.length === 0) return 0;
  const tails: number[] = [];
  for (const val of seq) {
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < val) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = val;
  }
  return tails.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/lib/musicbrainz.ts src/lib/musicbrainz.test.ts
git commit -m "feat: add longest increasing subsequence for track order scoring"
```

---

### Task 7: Release scoring model

**Files:**
- Modify: `src/lib/musicbrainz.ts`
- Test: `src/lib/musicbrainz.test.ts`

**Context:** The scoring model takes an album group (list of user files with
their recording IDs, durations, existing tags) and a candidate release (from
MusicBrainz), and returns a 0.0–1.0 score. Six weighted signals per the spec:
track count (30), recording coverage (25), duration (15), track order (10),
tag agreement (10), release quality (10).

- [ ] **Step 1: Write failing tests**

Add to `src/lib/musicbrainz.test.ts`:

```ts
import { scoreRelease, type AlbumFileInfo } from "./musicbrainz.ts";

describe("scoreRelease", () => {
  const makeFiles = (count: number): AlbumFileInfo[] =>
    Array.from({ length: count }, (_, i) => ({
      path: `/music/album/${String(i + 1).padStart(2, "0")}.mp3`,
      recordingId: `rec-${i + 1}`,
      duration: 200 + i,
      trackNumber: i + 1,
      discNumber: 1,
      existingAlbum: "Test Album",
      existingArtist: "Test Artist",
      existingYear: 2020,
    }));

  const makeRelease = (
    trackCount: number,
    recordingIds: string[],
    overrides: Partial<MBRelease> = {},
  ): MBRelease => ({
    id: "rel-1",
    title: "Test Album",
    status: "Official",
    date: "2020",
    media: [{
      position: 1,
      track_count: trackCount,
      tracks: recordingIds.map((id, i) => ({
        id: `track-${i}`,
        number: String(i + 1),
        title: `Track ${i + 1}`,
        length: (200 + i) * 1000, // ms
        position: i + 1,
        recording: { id },
      })),
    }],
    "release-group": { id: "rg-1", "primary-type": "Album" },
    ...overrides,
  });

  it("should score a perfect match close to 1.0", () => {
    const files = makeFiles(10);
    const recordingIds = files.map((f) => f.recordingId);
    const release = makeRelease(10, recordingIds);
    const score = scoreRelease(files, release);
    assertGreater(score, 0.9);
  });

  it("should score a partial album (12 of 14 tracks) reasonably", () => {
    const files = makeFiles(12);
    const allRecordings = [
      ...files.map((f) => f.recordingId),
      "rec-extra-1",
      "rec-extra-2",
    ];
    const release = makeRelease(14, allRecordings);
    const score = scoreRelease(files, release);
    assertGreater(score, 0.7);
  });

  it("should score a compilation lower than an album", () => {
    const files = makeFiles(10);
    const recordingIds = files.map((f) => f.recordingId);
    const album = makeRelease(10, recordingIds);
    const compilation = makeRelease(10, recordingIds, {
      "release-group": { id: "rg-2", "primary-type": "Compilation" },
    });
    const albumScore = scoreRelease(files, album);
    const compScore = scoreRelease(files, compilation);
    assertGreater(albumScore, compScore);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `scoreRelease`**

Add types and scoring function to `src/lib/musicbrainz.ts`:

```ts
export type AlbumFileInfo = {
  path: string;
  recordingId: string;
  duration: number; // seconds
  trackNumber?: number;
  discNumber?: number;
  existingTitle?: string;
  existingAlbum?: string;
  existingAlbumArtist?: string;
  existingArtist?: string;
  existingYear?: number;
  existingGenre?: string;
};

export type ScoreReleaseOptions = {
  isSingle?: boolean;
};

export function scoreRelease(
  files: AlbumFileInfo[],
  release: MBRelease,
  options: ScoreReleaseOptions = {},
): number {
  // Find the best-matching medium
  const media = release.media ?? [];
  if (media.length === 0) return 0;

  const fileRecordingIds = new Set(files.map((f) => f.recordingId));

  // Score each medium to find the best one
  let bestMedium = media[0];
  let bestMediumMatches = 0;
  for (const medium of media) {
    const matches = (medium.tracks ?? []).filter((t) =>
      fileRecordingIds.has(t.recording.id)
    ).length;
    if (matches > bestMediumMatches) {
      bestMediumMatches = matches;
      bestMedium = medium;
    }
  }

  const tracks = bestMedium.tracks ?? [];
  const releaseTrackCount = bestMedium.track_count || tracks.length;

  // 1. Track count match (weight: 30)
  let trackCountScore: number;
  if (files.length <= releaseTrackCount) {
    trackCountScore = files.length / releaseTrackCount;
  } else {
    trackCountScore = (releaseTrackCount / files.length) * 0.5;
  }

  // 2. Recording coverage (weight: 25)
  const releaseRecordingIds = new Set(tracks.map((t) => t.recording.id));
  const matched = files.filter((f) => releaseRecordingIds.has(f.recordingId))
    .length;
  const coverageScore = files.length > 0 ? matched / files.length : 0;

  // 3. Duration match (weight: 15)
  const trackById = new Map(tracks.map((t) => [t.recording.id, t]));
  const durationScores: number[] = [];
  for (const file of files) {
    const track = trackById.get(file.recordingId);
    if (!track || track.length === null) continue;
    const mbDuration = track.length / 1000; // ms -> s
    const diff = Math.abs(file.duration - mbDuration);
    if (diff <= 3) durationScores.push(1.0);
    else if (diff <= 10) durationScores.push(0.5);
    else durationScores.push(0.0);
  }
  const durationScore = durationScores.length > 0
    ? durationScores.reduce((a, b) => a + b, 0) / durationScores.length
    : 0.5;

  // 4. Track order match (weight: 10)
  const sortedFiles = [...files].sort((a, b) =>
    (a.trackNumber ?? 0) - (b.trackNumber ?? 0) ||
    a.path.localeCompare(b.path)
  );
  const positions: number[] = [];
  for (const file of sortedFiles) {
    const track = trackById.get(file.recordingId);
    if (track) positions.push(track.position);
  }
  const orderScore = positions.length > 0
    ? longestIncreasingSubsequenceLength(positions) / positions.length
    : 0.5;

  // 5. Existing tag agreement (weight: 10)
  const tagScores: number[] = [];
  const firstFile = files[0];
  if (firstFile?.existingAlbum) {
    tagScores.push(normalizedSimilarity(firstFile.existingAlbum, release.title));
  }
  if (firstFile?.existingYear && release.date) {
    const releaseYear = parseInt(release.date.substring(0, 4), 10);
    if (firstFile.existingYear === releaseYear) tagScores.push(1.0);
    else if (Math.abs(firstFile.existingYear - releaseYear) <= 1) {
      tagScores.push(0.5);
    } else tagScores.push(0.0);
  }
  if (firstFile?.existingArtist && release["artist-credit"]?.[0]) {
    const releaseArtist = release["artist-credit"]
      .map((c) => c.name)
      .join(", ");
    tagScores.push(
      normalizedSimilarity(firstFile.existingArtist, releaseArtist),
    );
  }
  const tagScore = tagScores.length > 0
    ? tagScores.reduce((a, b) => a + b, 0) / tagScores.length
    : 0.5;

  // 6. Release quality signals (weight: 10)
  const statusScores: Record<string, number> = {
    "Official": 1.0,
    "Promotion": 0.3,
    "Bootleg": 0.1,
  };
  // Context-dependent type scoring per spec:
  // For album groups, prefer "Album" type. For singles, prefer "Single" type.
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

  // Weighted sum (weights sum to 100)
  const score =
    (trackCountScore * 30 +
      coverageScore * 25 +
      durationScore * 15 +
      orderScore * 10 +
      tagScore * 10 +
      qualityScore * 10) / 100;

  return score;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read --allow-env --allow-net src/lib/musicbrainz.test.ts --filter "scoreRelease"`
Expected: PASS

- [ ] **Step 5: Run all musicbrainz tests**

Run: `deno test --allow-read --allow-env --allow-net src/lib/musicbrainz.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/musicbrainz.ts src/lib/musicbrainz.test.ts
git commit -m "feat: add album-level release scoring model with 6 weighted signals"
```

---

## Chunk 3: Tier 2 — Enrich Command

### Task 8: `selectBestRelease` — orchestrate scoring across candidates

**Files:**
- Modify: `src/lib/musicbrainz.ts`
- Test: `src/lib/musicbrainz.test.ts`

**Context:** Given an album's files and all MusicBrainz recording responses,
build the candidate release set, score each, apply confidence threshold (0.4),
and return the best release with its score. Handle tie-breaking per spec.

- [ ] **Step 1: Write failing tests**

Add to `src/lib/musicbrainz.test.ts`:

```ts
import { selectBestRelease, type ScoreReleaseOptions } from "./musicbrainz.ts";

describe("selectBestRelease", () => {
  it("should return null when no candidates", () => {
    const result = selectBestRelease([], new Map());
    assertEquals(result, null);
  });

  it("should return null when score below confidence threshold", () => {
    // Test with files that don't match any release well
    const files: AlbumFileInfo[] = [{
      path: "/a.mp3",
      recordingId: "rec-orphan",
      duration: 200,
    }];
    const recordings = new Map<string, MBRecordingResponse>();
    recordings.set("rec-orphan", {
      id: "rec-orphan",
      title: "Orphan",
      length: 200000,
      releases: [],
    });
    const result = selectBestRelease(files, recordings);
    assertEquals(result, null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `selectBestRelease`**

```ts
const CONFIDENCE_THRESHOLD = 0.4;

export type ScoredRelease = {
  release: MBRelease;
  score: number;
  matchedRecordings: number;
};

export function selectBestRelease(
  files: AlbumFileInfo[],
  recordings: Map<string, MBRecordingResponse>,
  options: ScoreReleaseOptions = {},
): ScoredRelease | null {
  if (files.length === 0) return null;

  // Build candidate release set
  const candidateMap = new Map<string, MBRelease>();
  for (const [, recording] of recordings) {
    for (const release of recording.releases ?? []) {
      if (!candidateMap.has(release.id)) {
        candidateMap.set(release.id, release);
      }
    }
  }

  if (candidateMap.size === 0) return null;

  // Score each candidate (pass through isSingle for context-dependent scoring)
  const scored: ScoredRelease[] = [];
  for (const release of candidateMap.values()) {
    const score = scoreRelease(files, release, options);
    const tracks = (release.media ?? []).flatMap((m) => m.tracks ?? []);
    const releaseRecIds = new Set(tracks.map((t) => t.recording.id));
    const matchedRecordings = files.filter((f) =>
      releaseRecIds.has(f.recordingId)
    ).length;
    scored.push({ release, score, matchedRecordings });
  }

  // Sort by score descending, then by matched recordings, then by date
  scored.sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.05) return b.score - a.score;
    if (a.matchedRecordings !== b.matchedRecordings) {
      return b.matchedRecordings - a.matchedRecordings;
    }
    const dateA = a.release.date ?? "9999";
    const dateB = b.release.date ?? "9999";
    return dateA.localeCompare(dateB);
  });

  const best = scored[0];
  if (best.score < CONFIDENCE_THRESHOLD) return null;

  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add src/lib/musicbrainz.ts src/lib/musicbrainz.test.ts
git commit -m "feat: add selectBestRelease with confidence threshold and tie-breaking"
```

---

### Task 9: Enrich command — CLI wiring and diff display

**Files:**
- Create: `src/commands/enrich.ts`
- Modify: `src/cli/cli.ts`
- Test: `src/commands/enrich.test.ts`

**Context:** Follow the pattern of `src/commands/lint.ts` for the command
handler. Uses `listAudioFilesRecursive()` for file discovery, taglib-wasm
batch API for reading existing tags, groups by directory, calls MusicBrainz
for each album group, builds diff, displays and confirms.

This is the largest task. The command handler orchestrates:
1. File discovery
2. Tag reading (batch API)
3. Grouping by directory
4. Per-album: fetch recordings, select release, build diff
5. Per-single: fetch recording, select release, build diff
6. Display diff, confirm, write tags

- [ ] **Step 1: Create minimal command with CLI wiring**

Create `src/commands/enrich.ts` with the command handler skeleton that
validates the path and discovers files:

```ts
import { listAudioFilesRecursive } from "../lib/fastest_audio_scan_recursive.ts";
import { readMetadataBatch } from "@charlesw/taglib-wasm/simple";
import { dirname } from "@std/path";
import {
  type AlbumFileInfo,
  fetchRecording,
  type MBRecordingResponse,
  selectBestRelease,
} from "../lib/musicbrainz.ts";
import {
  type MusicBrainzIds,
  writeMusicBrainzTags,
} from "../lib/tagging.ts";
import { ensureTagLib } from "../lib/taglib_init.ts";
import { PROPERTIES } from "@charlesw/taglib-wasm";

type TagDiff = {
  field: string;
  current: string;
  proposed: string;
};

type FileDiff = {
  path: string;
  diffs: TagDiff[];
};

type AlbumDiff = {
  directory: string;
  releaseTitle: string;
  releaseId: string;
  score: number;
  files: FileDiff[];
};

function writeStderr(text: string) {
  Deno.stderr.writeSync(new TextEncoder().encode(text));
}

export async function enrichCommand(
  options: {
    yes: boolean;
    dryRun: boolean;
    quiet: boolean;
    force: boolean;
  },
  path: string,
): Promise<void> {
  // Validate path
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
      return;
    }
  } catch (err) {
    console.error(
      `Error: Cannot access ${path}: ${err instanceof Error ? err.message : err}`,
    );
    Deno.exit(2);
    return;
  }

  if (files.length === 0) {
    console.error(`Error: No audio files found in ${path}`);
    Deno.exit(2);
    return;
  }

  if (!options.quiet) {
    writeStderr(
      `Found ${files.length.toLocaleString()} files. Reading tags...\n`,
    );
  }

  // Read tags via batch API
  const batchResult = await readMetadataBatch(files, {
    concurrency: 8,
    continueOnError: true,
  });

  // Build file info and group by directory
  // Read extended properties (MusicBrainz IDs, enrichment marker) via full API
  // since batch API doesn't expose getProperty() for arbitrary properties.
  const taglib = await ensureTagLib();
  const albumGroups = new Map<string, AlbumFileInfo[]>();
  let skippedNoMbId = 0;
  let skippedPreviouslyEnriched = 0;

  for (const item of batchResult.items) {
    if (item.status === "error") continue;

    const props = item.data.properties;

    let audioFile = null;
    try {
      audioFile = await taglib.open(item.path, { partial: true });
      const mbTrackId =
        audioFile.getProperty(PROPERTIES.musicbrainzTrackId.key) ?? undefined;

      if (!mbTrackId) {
        skippedNoMbId++;
        continue;
      }

      // Check enrichment marker (skip if previously enriched unless --force)
      const enrichedMarker = audioFile.getProperty("AMUSIC_ENRICHED");
      if (enrichedMarker && !options.force) {
        skippedPreviouslyEnriched++;
        continue;
      }

      const tag = audioFile.tag();
      const dir = dirname(item.path);
      const fileInfo: AlbumFileInfo = {
        path: item.path,
        recordingId: mbTrackId,
        duration: props?.duration ?? 0,
        trackNumber: tag.track || undefined,
        discNumber: parseInt(audioFile.getProperty("DISCNUMBER") || "0", 10) || undefined,
        existingTitle: tag.title || undefined,
        existingAlbum: tag.album || undefined,
        existingAlbumArtist: audioFile.getProperty("ALBUMARTIST") || undefined,
        existingArtist: tag.artist || undefined,
        existingYear: tag.year || undefined,
        existingGenre: tag.genre || undefined,
      };

      const group = albumGroups.get(dir) ?? [];
      group.push(fileInfo);
      albumGroups.set(dir, group);
    } catch (error) {
      console.error(
        `  Warning: Could not read tags from ${item.path}: ${error instanceof Error ? error.message : error}`,
      );
      continue;
    } finally {
      audioFile?.dispose();
    }
  }

  if (skippedNoMbId > 0 && !options.quiet) {
    writeStderr(
      `Skipped ${skippedNoMbId} files without MusicBrainz recording ID. Run 'amusic process --acoust-id' first.\n`,
    );
  }

  if (skippedPreviouslyEnriched > 0 && !options.quiet) {
    writeStderr(
      `Skipped ${skippedPreviouslyEnriched} previously enriched files. Use --force to re-enrich.\n`,
    );
  }

  if (albumGroups.size === 0) {
    console.error("No files with MusicBrainz recording IDs found.");
    Deno.exit(1);
    return;
  }

  if (!options.quiet) {
    writeStderr(
      `Processing ${albumGroups.size} album group(s)...\n\n`,
    );
  }

  // Process each album group
  let albumsEnriched = 0;
  let albumsSkipped = 0;
  let filesUpdated = 0;
  let errors = 0;

  for (const [dir, albumFiles] of albumGroups) {
    const isSingle = albumFiles.length === 1;

    // Fetch MusicBrainz data for each unique recording
    const uniqueRecordingIds = [
      ...new Set(albumFiles.map((f) => f.recordingId)),
    ];

    if (!options.quiet) {
      writeStderr(
        `${isSingle ? "Single" : "Album"}: ${dir} (${uniqueRecordingIds.length} recordings)\n`,
      );
    }

    const recordings = new Map<string, MBRecordingResponse>();
    for (const recId of uniqueRecordingIds) {
      const response = await fetchRecording(recId);
      if (response) {
        recordings.set(recId, response);
      }
    }

    if (recordings.size === 0) {
      if (!options.quiet) {
        console.error(`  Could not fetch any recordings, skipping.`);
      }
      errors++;
      continue;
    }

    // Select best release (pass isSingle for context-dependent type scoring)
    const bestRelease = selectBestRelease(albumFiles, recordings, { isSingle });
    if (!bestRelease) {
      if (!options.quiet) {
        console.log(
          `  Could not confidently identify release. Skipping.`,
        );
      }
      albumsSkipped++;
      continue;
    }

    // Build diff
    const albumDiff = buildAlbumDiff(
      dir,
      albumFiles,
      bestRelease.release,
      bestRelease.score,
      recordings,
    );

    if (albumDiff.files.length === 0) {
      if (!options.quiet) {
        console.log(`  No changes needed.`);
      }
      albumsSkipped++;
      continue;
    }

    // Display diff
    displayAlbumDiff(albumDiff);

    // Confirm and apply
    let shouldApply = options.yes;
    if (!shouldApply && !options.dryRun) {
      shouldApply = confirm(`  Apply changes to ${albumDiff.files.length} files?`);
    }

    if (shouldApply && !options.dryRun) {
      for (const fileDiff of albumDiff.files) {
        const success = await applyFileDiff(fileDiff);
        if (success) filesUpdated++;
        else errors++;
      }
      albumsEnriched++;
    } else {
      albumsSkipped++;
    }

    console.log();
  }

  // Summary
  console.log(
    `\nSummary: ${albumsEnriched} enriched, ${albumsSkipped} skipped, ${filesUpdated} files updated, ${errors} errors`,
  );

  Deno.exit(errors > 0 ? 1 : 0);
}

function buildAlbumDiff(
  directory: string,
  files: AlbumFileInfo[],
  release: import("../lib/musicbrainz.ts").MBRelease,
  score: number,
  recordings: Map<string, import("../lib/musicbrainz.ts").MBRecordingResponse>,
): AlbumDiff {
  const tracks = (release.media ?? []).flatMap((m) =>
    (m.tracks ?? []).map((t) => ({ ...t, discNumber: m.position }))
  );
  const trackByRecording = new Map(
    tracks.map((t) => [t.recording.id, t]),
  );

  const releaseArtist = release["artist-credit"]
    ?.map((c) => c.name)
    .join(", ") ?? "";
  const releaseYear = release.date?.substring(0, 4) ?? "";

  const fileDiffs: FileDiff[] = [];

  for (const file of files) {
    const recording = recordings.get(file.recordingId);
    const track = trackByRecording.get(file.recordingId);
    if (!recording) continue;

    const diffs: TagDiff[] = [];

    // Title (spec: Recording title)
    if (recording.title && file.existingTitle !== recording.title) {
      diffs.push({
        field: "Title",
        current: file.existingTitle ?? "(empty)",
        proposed: recording.title,
      });
    }

    // Artist (spec: Recording artist credits, joined)
    const recordingArtist = recording["artist-credit"]
      ?.map((c) => c.name)
      .join(", ") ?? "";
    if (recordingArtist && file.existingArtist !== recordingArtist) {
      diffs.push({
        field: "Artist",
        current: file.existingArtist ?? "(empty)",
        proposed: recordingArtist,
      });
    }

    // Album (spec: Release title)
    if (release.title && file.existingAlbum !== release.title) {
      diffs.push({
        field: "Album",
        current: file.existingAlbum ?? "(empty)",
        proposed: release.title,
      });
    }

    // Album Artist (spec: Release artist credits, joined)
    if (releaseArtist && file.existingAlbumArtist !== releaseArtist) {
      diffs.push({
        field: "Album Artist",
        current: file.existingAlbumArtist ?? "(empty)",
        proposed: releaseArtist,
      });
    }

    // Year (spec: Release date, year component)
    if (releaseYear && file.existingYear !== parseInt(releaseYear, 10)) {
      diffs.push({
        field: "Year",
        current: file.existingYear?.toString() ?? "(empty)",
        proposed: releaseYear,
      });
    }

    // Track number (spec: Track position on matched medium)
    if (track && file.trackNumber !== track.position) {
      diffs.push({
        field: "Track",
        current: file.trackNumber?.toString() ?? "(empty)",
        proposed: String(track.position),
      });
    }

    // Disc number (spec: Medium position within release, 1-indexed)
    if (track && file.discNumber !== track.discNumber) {
      diffs.push({
        field: "Disc Number",
        current: file.discNumber?.toString() ?? "(empty)",
        proposed: String(track.discNumber),
      });
    }

    // Genre (spec: Recording genres preferred; fall back to release group genres)
    // Note: Release group genre fallback deferred — would require an additional
    // API call to GET /ws/2/release-group/{id}?inc=genres which isn't worth the
    // rate limit cost. Recording genres cover the majority of cases.
    const genres = (recording.genres ?? [])
      .sort((a, b) => b.count - a.count)
      .map((g) => g.name);
    const newGenre = genres[0] ?? "";
    if (newGenre && file.existingGenre !== newGenre) {
      diffs.push({
        field: "Genre",
        current: file.existingGenre ?? "(empty)",
        proposed: newGenre,
      });
    }

    if (diffs.length > 0) {
      fileDiffs.push({ path: file.path, diffs });
    }
  }

  return {
    directory,
    releaseTitle: release.title,
    releaseId: release.id,
    score,
    files: fileDiffs,
  };
}

function displayAlbumDiff(diff: AlbumDiff): void {
  console.log(
    `  Release: "${diff.releaseTitle}" (score: ${diff.score.toFixed(2)})`,
  );
  for (const fileDiff of diff.files) {
    const filename = fileDiff.path.split("/").pop() ?? fileDiff.path;
    console.log(`    ${filename}:`);
    for (const d of fileDiff.diffs) {
      console.log(`      ${d.field}: "${d.current}" \u2192 "${d.proposed}"`);
    }
  }
}

async function applyFileDiff(fileDiff: FileDiff): Promise<boolean> {
  const taglib = await ensureTagLib();
  let audioFile = null;
  try {
    audioFile = await taglib.open(fileDiff.path);
    const tag = audioFile.tag();
    for (const diff of fileDiff.diffs) {
      // Use setter methods (not property assignment) per codebase convention
      // (see src/lib/encoding.ts:219-225)
      switch (diff.field) {
        case "Title":
          tag.setTitle(diff.proposed);
          break;
        case "Artist":
          tag.setArtist(diff.proposed);
          break;
        case "Album":
          tag.setAlbum(diff.proposed);
          break;
        case "Album Artist":
          audioFile.setProperty("ALBUMARTIST", diff.proposed);
          break;
        case "Year":
          tag.setYear(parseInt(diff.proposed, 10));
          break;
        case "Track":
          tag.setTrack(parseInt(diff.proposed, 10));
          break;
        case "Disc Number":
          audioFile.setProperty("DISCNUMBER", diff.proposed);
          break;
        case "Genre":
          tag.setGenre(diff.proposed);
          break;
      }
    }
    // Write AMUSIC_ENRICHED marker per spec (enrichment detection)
    audioFile.setProperty("AMUSIC_ENRICHED", "1");
    await audioFile.saveToFile();
    return true;
  } catch (error) {
    console.error(`  Error writing tags to ${fileDiff.path}: ${error}`);
    return false;
  } finally {
    audioFile?.dispose();
  }
}
```

- [ ] **Step 2: Wire into CLI**

Add to `src/cli/cli.ts` after the lint subcommand (after line 236):

Import at top:
```ts
import { enrichCommand } from "../commands/enrich.ts";
```

Command definition:
```ts
  // Add enrich subcommand
  program
    .command(
      "enrich <path:string>",
      "Enrich music metadata using MusicBrainz (requires existing MusicBrainz recording IDs from AcoustID processing)",
    )
    .option(
      "--yes",
      "Apply all changes without prompting",
      { default: false },
    )
    .option(
      "--dry-run",
      "Show what would change without writing",
      { default: false },
    )
    .option(
      "-q, --quiet",
      "Suppress progress output (errors still shown)",
      { default: false },
    )
    .option(
      "-f, --force",
      "Re-enrich even if previously enriched",
      { default: false },
    )
    .action(enrichCommand);
```

- [ ] **Step 3: Write integration test**

Create `src/commands/enrich.test.ts`:

```ts
import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

describe("enrich command integration", () => {
  it("should exit with code 2 when path does not exist", async () => {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-env",
        "--allow-net",
        "--allow-write",
        "src/amusic.ts",
        "enrich",
        "/nonexistent/path",
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    assertEquals(output.code, 2);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/commands/enrich.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`
Expected: All PASS

- [ ] **Step 6: Format and lint**

Run: `deno fmt && deno lint`

- [ ] **Step 7: Commit**

```bash
git add src/commands/enrich.ts src/commands/enrich.test.ts src/cli/cli.ts
git commit -m "feat: add 'amusic enrich' command for MusicBrainz metadata enrichment"
```

---

### Task 10: End-to-end integration test with real files

**Files:**
- Modify: `src/commands/enrich.test.ts`

**Context:** Test the full enrichment flow on a real album from the test
directory. This validates that the command reads tags, queries MusicBrainz,
scores releases, and produces output. Uses `--dry-run` to avoid modifying
files.

- [ ] **Step 1: Add integration test**

Add to `src/commands/enrich.test.ts`:

```ts
  it("should run dry-run on a test directory with --quiet --dry-run", async () => {
    const testDir =
      "/Volumes/T9 (4TB)/Downloads/Deezer/America/America - Hits";
    try {
      await Deno.stat(testDir);
    } catch {
      return; // Skip if test directory not available
    }

    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-env",
        "--allow-net",
        "--allow-write",
        "src/amusic.ts",
        "enrich",
        "--dry-run",
        "--quiet",
        testDir,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    // Should succeed (0) or report errors (1), not crash (2)
    assert(
      output.code === 0 || output.code === 1,
      `Expected exit code 0 or 1, got ${output.code}. stderr: ${new TextDecoder().decode(output.stderr)}`,
    );
  });
```

- [ ] **Step 2: Run test**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/commands/enrich.test.ts`
Expected: PASS (or skip if test dir unavailable)

- [ ] **Step 3: Run full test suite**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`
Expected: All PASS

- [ ] **Step 4: Format and lint**

Run: `deno fmt && deno lint`

- [ ] **Step 5: Commit**

```bash
git add src/commands/enrich.test.ts
git commit -m "test: add end-to-end integration test for enrich command"
```
