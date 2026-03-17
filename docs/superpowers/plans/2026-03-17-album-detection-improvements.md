# Album Detection Improvements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this
> plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace directory-structure-based album classification with
metadata-aware grouping that correctly handles compilations, multi-disc albums,
box sets, and mixed folders.

**Architecture:** Three-layer approach: (1) filename parser extracts metadata
from filenames as a last resort, (2) metadata-based grouping replaces the
current `classifyDirectories` with confidence-weighted album detection, (3)
per-group rsgain invocation via symlink temp directories replaces per-directory
invocation for mixed folders.

**Tech Stack:** Deno, taglib-wasm, @std/testing/bdd, @std/path

**Spec:** `docs/superpowers/specs/2026-03-17-album-detection-improvements-design.md`

---

## Chunk 1: Filename Parser

Standalone utility with no dependencies on the rest of the codebase. Can be
built and tested independently.

### Task 1: Filename parser — core patterns

**Files:**

- Create: `src/utils/filename_parser.ts`
- Create: `src/utils/filename_parser.test.ts`

- [ ] **Step 1: Write failing tests for filename parsing**

In `src/utils/filename_parser.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parseFilenames, type ParsedFilename } from "./filename_parser.ts";

describe("parseFilenames", () => {
  it("should parse '## - Artist - Title' pattern", () => {
    const filenames = [
      "01 - Miles Davis - So What.mp3",
      "02 - Miles Davis - Freddie Freeloader.mp3",
      "03 - Miles Davis - Blue in Green.mp3",
    ];
    const results = parseFilenames(filenames);
    assertEquals(results, [
      { track: 1, artist: "Miles Davis", title: "So What" },
      { track: 2, artist: "Miles Davis", title: "Freddie Freeloader" },
      { track: 3, artist: "Miles Davis", title: "Blue in Green" },
    ]);
  });

  it("should parse 'Artist - Title' pattern", () => {
    const filenames = [
      "Miles Davis - So What.mp3",
      "Miles Davis - Freddie Freeloader.mp3",
    ];
    const results = parseFilenames(filenames);
    assertEquals(results, [
      { artist: "Miles Davis", title: "So What" },
      { artist: "Miles Davis", title: "Freddie Freeloader" },
    ]);
  });

  it("should parse '## Title' pattern (space separator)", () => {
    const filenames = [
      "01 So What.flac",
      "02 Freddie Freeloader.flac",
      "03 Blue in Green.flac",
    ];
    const results = parseFilenames(filenames);
    assertEquals(results, [
      { track: 1, title: "So What" },
      { track: 2, title: "Freddie Freeloader" },
      { track: 3, title: "Blue in Green" },
    ]);
  });

  it("should parse '##. Title' pattern (dot separator)", () => {
    const filenames = [
      "01. So What.mp3",
      "02. Freddie Freeloader.mp3",
    ];
    const results = parseFilenames(filenames);
    assertEquals(results, [
      { track: 1, title: "So What" },
      { track: 2, title: "Freddie Freeloader" },
    ]);
  });

  it("should fall back to title-only for unrecognized patterns", () => {
    const filenames = ["So What.mp3", "Freddie Freeloader.mp3"];
    const results = parseFilenames(filenames);
    assertEquals(results, [
      { title: "So What" },
      { title: "Freddie Freeloader" },
    ]);
  });

  it("should require batch consistency — all files must match same pattern", () => {
    const filenames = [
      "01 - Artist - Title.mp3",
      "Some Random Name.mp3",
      "02 - Artist - Other.mp3",
    ];
    const results = parseFilenames(filenames);
    // Falls through to title-only since not all files match the same pattern
    assertEquals(results, [
      { title: "01 - Artist - Title" },
      { title: "Some Random Name" },
      { title: "02 - Artist - Other" },
    ]);
  });

  it("should handle track numbers with no leading zero", () => {
    const filenames = [
      "1 - Artist - Title.mp3",
      "2 - Artist - Other.mp3",
    ];
    const results = parseFilenames(filenames);
    assertEquals(results[0].track, 1);
    assertEquals(results[1].track, 2);
  });

  it("should return empty array for empty input", () => {
    assertEquals(parseFilenames([]), []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read --allow-env src/utils/filename_parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement filename parser**

In `src/utils/filename_parser.ts`:

```ts
import { basename, extname } from "@std/path";

export interface ParsedFilename {
  track?: number;
  artist?: string;
  title?: string;
}

interface Pattern {
  regex: RegExp;
  extract: (match: RegExpMatchArray) => ParsedFilename;
}

const PATTERNS: Pattern[] = [
  {
    // ## - Artist - Title
    regex: /^(\d{1,3})\s*-\s*(.+?)\s*-\s*(.+)$/,
    extract: (m) => ({ track: parseInt(m[1]), artist: m[2].trim(), title: m[3].trim() }),
  },
  {
    // Artist - Title
    regex: /^(.+?)\s*-\s*(.+)$/,
    extract: (m) => ({ artist: m[1].trim(), title: m[2].trim() }),
  },
  {
    // ## Title (space separator)
    regex: /^(\d{1,3})\s+(?!-\s)(.+)$/,
    extract: (m) => ({ track: parseInt(m[1]), title: m[2].trim() }),
  },
  {
    // ##. Title (dot separator)
    regex: /^(\d{1,3})\.\s*(.+)$/,
    extract: (m) => ({ track: parseInt(m[1]), title: m[2].trim() }),
  },
  {
    // Track number only
    regex: /^(\d{1,3})$/,
    extract: (m) => ({ track: parseInt(m[1]) }),
  },
];

export function parseFilenames(filenames: string[]): ParsedFilename[] {
  if (filenames.length === 0) return [];

  const stems = filenames.map((f) => {
    const base = basename(f);
    const ext = extname(base);
    return ext ? base.slice(0, -ext.length) : base;
  });

  // Try each pattern — require all files to match for batch consistency
  for (const pattern of PATTERNS) {
    const matches = stems.map((s) => s.match(pattern.regex));
    if (matches.every((m) => m !== null)) {
      return matches.map((m) => pattern.extract(m!));
    }
  }

  // Fallback: entire stem as title
  return stems.map((s) => ({ title: s }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read --allow-env src/utils/filename_parser.test.ts`
Expected: PASS

- [ ] **Step 5: Run formatter and linter**

Run: `deno fmt src/utils/filename_parser.ts src/utils/filename_parser.test.ts && deno lint src/utils/filename_parser.ts src/utils/filename_parser.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/utils/filename_parser.ts src/utils/filename_parser.test.ts
git commit -m "feat: add beets-style filename parser for metadata extraction"
```

---

## Chunk 2: Multi-Disc Folder Merging

Adds disc subfolder detection and merging to the discovery phase. Independent
of the metadata grouping work.

### Task 2: Disc subfolder detection and merging

**Files:**

- Modify: `src/utils/fast_discovery.ts`
- Modify: `src/utils/fast_discovery.test.ts`

- [ ] **Step 1: Write failing tests for disc detection**

Add to `src/utils/fast_discovery.test.ts`:

```ts
describe("mergeDiscSubfolders", () => {
  it("should merge 'Disc 1' and 'Disc 2' subfolders into parent", () => {
    const filesByDir = new Map([
      ["/music/Album/Disc 1", ["track1.mp3", "track2.mp3"]],
      ["/music/Album/Disc 2", ["track3.mp3", "track4.mp3"]],
    ]);
    const result = mergeDiscSubfolders(filesByDir);
    assertEquals(result.get("/music/Album"), [
      "track1.mp3", "track2.mp3", "track3.mp3", "track4.mp3",
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
      "booklet.mp3", "track1.mp3", "track2.mp3",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read --allow-run --allow-write --allow-env src/utils/fast_discovery.test.ts --filter "mergeDiscSubfolders"`
Expected: FAIL — function not exported

- [ ] **Step 3: Implement `mergeDiscSubfolders`**

Add to `src/utils/fast_discovery.ts`:

```ts
const DISC_PATTERN = /^(?:disc|cd|disk)\s*\d*$/i;

export function mergeDiscSubfolders(
  filesByDir: Map<string, string[]>,
): Map<string, string[]> {
  const merged = new Map<string, string[]>();
  const discDirs = new Set<string>();

  // Identify disc subfolders
  for (const dir of filesByDir.keys()) {
    const folderName = dir.substring(dir.lastIndexOf("/") + 1);
    if (DISC_PATTERN.test(folderName)) {
      discDirs.add(dir);
    }
  }

  // Merge disc subfolders into their parents
  for (const [dir, files] of filesByDir) {
    if (discDirs.has(dir)) {
      const parent = dir.substring(0, dir.lastIndexOf("/"));
      const existing = merged.get(parent) ?? [];
      merged.set(parent, [...existing, ...files]);
    } else {
      const existing = merged.get(dir) ?? [];
      merged.set(dir, [...existing, ...files]);
    }
  }

  return merged;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read --allow-run --allow-write --allow-env src/utils/fast_discovery.test.ts --filter "mergeDiscSubfolders"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/fast_discovery.ts src/utils/fast_discovery.test.ts
git commit -m "feat: add disc subfolder merging for multi-disc albums"
```

### Task 3: Validate disc merges with album metadata

Disc subfolders are only merged if album names match across subfolders. If
they don't match (box set with distinct albums per disc), each disc is treated
as a separate album. If metadata is absent, prompt the user.

**Files:**

- Modify: `src/utils/fast_discovery.ts`
- Modify: `src/utils/fast_discovery.test.ts`

- [ ] **Step 1: Write failing tests for validated disc merging**

Add to `src/utils/fast_discovery.test.ts`:

```ts
describe("validateDiscMerge", () => {
  it("should confirm merge when album names match across discs", async () => {
    const discGroups = new Map([
      ["/album/Disc 1", { albumName: "The Wall", files: ["t1.mp3"] }],
      ["/album/Disc 2", { albumName: "The Wall", files: ["t2.mp3"] }],
    ]);
    const result = await validateDiscMerge(discGroups);
    assertEquals(result.merged, [
      { parent: "/album", files: ["t1.mp3", "t2.mp3"] },
    ]);
    assertEquals(result.separate, []);
  });

  it("should keep discs separate when album names differ (box set)", async () => {
    const discGroups = new Map([
      ["/box/Disc 1", { albumName: "Kind of Blue", files: ["t1.mp3"] }],
      ["/box/Disc 2", { albumName: "Bitches Brew", files: ["t2.mp3"] }],
    ]);
    const result = await validateDiscMerge(discGroups);
    assertEquals(result.merged, []);
    assertEquals(result.separate, [
      { path: "/box/Disc 1", files: ["t1.mp3"] },
      { path: "/box/Disc 2", files: ["t2.mp3"] },
    ]);
  });

  it("should use normalized album names for comparison", async () => {
    const discGroups = new Map([
      ["/album/Disc 1", { albumName: "The Wall", files: ["t1.mp3"] }],
      ["/album/Disc 2", { albumName: "the wall", files: ["t2.mp3"] }],
    ]);
    const result = await validateDiscMerge(discGroups);
    assertEquals(result.merged.length, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `validateDiscMerge`**

This function takes grouped disc subfolders (with album name read from at
least one file per subfolder) and returns which should be merged vs. kept
separate. Uses `normalizeForMatching` for album name comparison.

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Wire into `discoverMusic` — call `mergeDiscSubfolders` on the
  scan result, then `validateDiscMerge` on identified disc groups**

- [ ] **Step 6: Run full fast_discovery test suite**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/utils/fast_discovery.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/fast_discovery.ts src/utils/fast_discovery.test.ts
git commit -m "feat: validate disc merges with album metadata, handle box sets"
```

---

## Chunk 3: Metadata-Based Album Grouping

The core of the feature — read metadata for all tracks and group by album
identity instead of directory structure.

### Task 4: Track metadata reader for grouping

**Files:**

- Create: `src/utils/album_grouping.ts`
- Create: `src/utils/album_grouping.test.ts`

- [ ] **Step 1: Write failing tests for metadata reading and grouping types**

In `src/utils/album_grouping.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  groupTracksByAlbum,
  type TrackMetadata,
  type AlbumGroup,
} from "./album_grouping.ts";

describe("groupTracksByAlbum", () => {
  it("should group tracks with same album name and album artist", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "Abbey Road", albumArtist: "The Beatles" },
      { path: "t2.mp3", albumName: "Abbey Road", albumArtist: "The Beatles" },
      { path: "t3.mp3", albumName: "Abbey Road", albumArtist: "The Beatles" },
    ];
    const { albums, singles } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 1);
    assertEquals(albums[0].files, ["t1.mp3", "t2.mp3", "t3.mp3"]);
    assertEquals(singles, []);
  });

  it("should treat tracks with no album metadata as singles", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3" },
      { path: "t2.mp3" },
    ];
    const { albums, singles } = groupTracksByAlbum(tracks);
    assertEquals(albums, []);
    assertEquals(singles, ["t1.mp3", "t2.mp3"]);
  });

  it("should ignore album artist when it is 'Various Artists'", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "Now 47", albumArtist: "Various Artists" },
      { path: "t2.mp3", albumName: "Now 47", albumArtist: "Various Artists" },
      { path: "t3.mp3", albumName: "Now 98", albumArtist: "Various Artists" },
    ];
    const { albums } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 2);
  });

  it("should ignore blank album artist for grouping", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "Compilation", albumArtist: "" },
      { path: "t2.mp3", albumName: "Compilation" },
    ];
    const { albums } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 1);
    assertEquals(albums[0].files, ["t1.mp3", "t2.mp3"]);
  });

  it("should separate different albums in same folder", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "Album A", albumArtist: "Artist" },
      { path: "t2.mp3", albumName: "Album A", albumArtist: "Artist" },
      { path: "t3.mp3", albumName: "Album B", albumArtist: "Artist" },
      { path: "t4.mp3", albumName: "Album B", albumArtist: "Artist" },
    ];
    const { albums } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 2);
  });

  it("should treat single-track groups as singles", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "Album A", albumArtist: "Artist" },
      { path: "t2.mp3", albumName: "Album A", albumArtist: "Artist" },
      { path: "t3.mp3", albumName: "Orphan", albumArtist: "Other" },
    ];
    const { albums, singles } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 1);
    assertEquals(albums[0].files, ["t1.mp3", "t2.mp3"]);
    assertEquals(singles, ["t3.mp3"]);
  });

  it("should use normalized album names for grouping", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "The Köln Concert", albumArtist: "Keith Jarrett" },
      { path: "t2.mp3", albumName: "the koln concert", albumArtist: "Keith Jarrett" },
    ];
    const { albums } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 1);
  });

  it("should detect compilations — 3+ distinct track artists", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "Now 47", artist: "Artist A" },
      { path: "t2.mp3", albumName: "Now 47", artist: "Artist B" },
      { path: "t3.mp3", albumName: "Now 47", artist: "Artist C" },
    ];
    const { albums } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 1);
    assertEquals(albums[0].isCompilation, true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read --allow-env src/utils/album_grouping.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `groupTracksByAlbum`**

In `src/utils/album_grouping.ts`:

```ts
import { normalizeForMatching } from "./normalize.ts";

export interface TrackMetadata {
  path: string;
  albumName?: string;
  albumArtist?: string;
  artist?: string;
  trackNumber?: number;
}

export interface AlbumGroup {
  albumName: string;
  albumArtist?: string;
  files: string[];
  isCompilation: boolean;
}

export interface GroupingResult {
  albums: AlbumGroup[];
  singles: string[];
}

function isGenericAlbumArtist(albumArtist: string | undefined): boolean {
  if (!albumArtist || albumArtist.trim() === "") return true;
  const normalized = normalizeForMatching(albumArtist);
  return normalized === "various artists";
}

function groupingKey(track: TrackMetadata): string | null {
  if (!track.albumName) return null;
  const normalizedAlbum = normalizeForMatching(track.albumName);
  if (isGenericAlbumArtist(track.albumArtist)) {
    return normalizedAlbum;
  }
  return `${normalizedAlbum}::${normalizeForMatching(track.albumArtist!)}`;
}

export function groupTracksByAlbum(tracks: TrackMetadata[]): GroupingResult {
  const groups = new Map<string, {
    albumName: string;
    albumArtist?: string;
    files: string[];
    artists: Set<string>;
  }>();
  const singles: string[] = [];

  for (const track of tracks) {
    const key = groupingKey(track);
    if (key === null) {
      singles.push(track.path);
      continue;
    }

    if (!groups.has(key)) {
      groups.set(key, {
        albumName: track.albumName!,
        albumArtist: isGenericAlbumArtist(track.albumArtist)
          ? undefined
          : track.albumArtist,
        files: [],
        artists: new Set(),
      });
    }

    const group = groups.get(key)!;
    group.files.push(track.path);
    if (track.artist) {
      group.artists.add(normalizeForMatching(track.artist));
    }
  }

  const albums: AlbumGroup[] = [];

  for (const group of groups.values()) {
    if (group.files.length < 2) {
      singles.push(...group.files);
    } else {
      albums.push({
        albumName: group.albumName,
        albumArtist: group.albumArtist,
        files: group.files,
        isCompilation: group.artists.size >= 3,
      });
    }
  }

  return { albums, singles };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read --allow-env src/utils/album_grouping.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/album_grouping.ts src/utils/album_grouping.test.ts
git commit -m "feat: add metadata-based album grouping with compilation detection"
```

### Task 5: Read track metadata for grouping

Reads album name, album artist, artist, and track number from all files in a
directory using taglib-wasm. Falls back to directory name and filename parsing
when tags are missing.

**Files:**

- Modify: `src/utils/album_grouping.ts`
- Modify: `src/utils/album_grouping.test.ts`

- [ ] **Step 1: Write failing test for `readTrackMetadata`**

Add integration test in `src/utils/album_grouping.test.ts`:

```ts
Deno.test({
  name: "readTrackMetadata - reads album metadata from real audio files",
  ignore: Deno.build.os !== "darwin",
  fn: async () => {
    const metadata = await readTrackMetadata([
      "sample_audio_files/flac_sample_3mb.flac",
    ]);
    assertEquals(metadata.length, 1);
    assertEquals(metadata[0].path, "sample_audio_files/flac_sample_3mb.flac");
    // Should have at least path — other fields depend on sample file tags
    assertExists(metadata[0].path);
  },
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement `readTrackMetadata`**

Add to `src/utils/album_grouping.ts`:

```ts
import { ensureTagLib } from "../lib/taglib_init.ts";
import { PROPERTIES } from "@charlesw/taglib-wasm";
import { basename, dirname } from "@std/path";
import { parseFilenames } from "./filename_parser.ts";

export async function readTrackMetadata(
  files: string[],
): Promise<TrackMetadata[]> {
  const taglib = await ensureTagLib();
  const results: TrackMetadata[] = [];

  for (const file of files) {
    const metadata: TrackMetadata = { path: file };

    try {
      using audioFile = await taglib.open(file);
      const tag = audioFile.tag();

      metadata.albumName = tag.album || undefined;
      metadata.albumArtist =
        audioFile.getProperty(PROPERTIES.albumArtist.key) || undefined;
      metadata.artist = tag.artist || undefined;
      metadata.trackNumber = tag.track || undefined;
    } catch {
      // Tags unreadable — will fall through to filename parsing
    }

    // Fallback: directory name as album name
    if (!metadata.albumName) {
      metadata.albumName = basename(dirname(file));
    }

    results.push(metadata);
  }

  // Fallback: filename parsing for tracks missing metadata
  const missingTrackNumbers = results.filter((r) => r.trackNumber == null);
  if (missingTrackNumbers.length > 0) {
    const parsed = parseFilenames(missingTrackNumbers.map((r) => r.path));
    for (let i = 0; i < missingTrackNumbers.length; i++) {
      const p = parsed[i];
      if (p.track != null && missingTrackNumbers[i].trackNumber == null) {
        missingTrackNumbers[i].trackNumber = p.track;
      }
      if (p.artist && !missingTrackNumbers[i].artist) {
        missingTrackNumbers[i].artist = p.artist;
      }
    }
  }

  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read --allow-env --allow-net src/utils/album_grouping.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/album_grouping.ts src/utils/album_grouping.test.ts
git commit -m "feat: add track metadata reader with tag/dirname/filename fallbacks"
```

---

## Chunk 4: Wire Grouping Into Discovery

Replace `classifyDirectories` with the new metadata-based grouping and update
callers.

### Task 6: Integrate metadata grouping into `discoverMusic`

**Files:**

- Modify: `src/utils/fast_discovery.ts`
- Modify: `src/utils/fast_discovery.test.ts`

- [ ] **Step 1: Write failing test for metadata-aware discovery**

Add integration test in `src/utils/fast_discovery.test.ts` using real audio
files copied into a temp directory structure that exercises the new grouping.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Update `discoverMusic` to use new grouping**

In `src/utils/fast_discovery.ts`, after the FS scan phase:

1. Call `mergeDiscSubfolders` on the scan result
2. For each directory group, call `readTrackMetadata` to get per-file metadata
3. Call `groupTracksByAlbum` to classify into albums/compilations/singles
4. Replace the current `classifyDirectories` call with this new pipeline
5. Keep `classifyDirectories` as a fast path for when metadata reading is
   not needed (e.g., when only doing encoding validation)

- [ ] **Step 4: Run full discovery test suite**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/utils/fast_discovery.test.ts`
Expected: PASS

- [ ] **Step 5: Run existing command tests to verify nothing breaks**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/utils/fast_discovery.ts src/utils/fast_discovery.test.ts
git commit -m "feat: integrate metadata-based album grouping into discovery"
```

---

## Chunk 5: Per-Group rsgain Invocation

Replace per-directory rsgain with per-group invocation via symlink temp
directories.

### Task 7: Symlink-based per-group ReplayGain calculation

**Files:**

- Modify: `src/lib/replaygain.ts`
- Modify: `src/lib/replaygain.test.ts`
- Modify: `src/lib/track_processor.ts`

- [ ] **Step 1: Write failing test for `calculateReplayGainForGroup`**

Add to `src/lib/replaygain.test.ts`:

```ts
describe("calculateReplayGainForGroup", () => {
  it("should create temp directory with symlinks and run rsgain", async () => {
    // Uses MockDenoCommand — verify rsgain is called with the temp dir path
    // and that symlinks are created for each file
  });

  it("should clean up temp directory even if rsgain fails", async () => {
    // Mock rsgain to fail (code: 1)
    // Verify temp directory is removed after failure
  });

  it("should run rsgain in custom mode for single files", async () => {
    // Single file should use custom mode, no temp dir needed
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement `calculateReplayGainForGroup`**

Add to `src/lib/replaygain.ts`:

```ts
export async function calculateReplayGainForGroup(
  files: string[],
  quiet: boolean,
  returnData = false,
): Promise<ReplayGainResult> {
  // Single file — use custom mode directly
  if (files.length === 1) {
    return calculateReplayGain(files[0], quiet, returnData);
  }

  // Multiple files — create temp dir with symlinks
  const tempDir = await Deno.makeTempDir({ prefix: "amusic-rg-" });
  try {
    for (const file of files) {
      const linkPath = join(tempDir, basename(file));
      await Deno.symlink(file, linkPath);
    }
    return await calculateReplayGain(tempDir, quiet, returnData);
  } finally {
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch {
      // Best-effort cleanup — log but don't throw
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Update `processAlbum` in `track_processor.ts` to accept
  `AlbumGroup` instead of a directory path**

The current `processAlbum` takes `albumPath: string` and passes it to
`calculateReplayGain`. Update it to use `calculateReplayGainForGroup` with
the group's file list instead, so it works for groups that span directories
or are subsets of a directory.

- [ ] **Step 6: Run full test suite**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/replaygain.ts src/lib/replaygain.test.ts src/lib/track_processor.ts
git commit -m "feat: per-group ReplayGain calculation via symlink temp directories"
```

---

## Chunk 6: Update Commands and Remove Legacy Code

Wire the updated discovery and processing into the `easy` and `process`
commands. Remove the old 3-file sampling compilation detection.

### Task 8: Update `easy` and `process` commands

**Files:**

- Modify: `src/commands/easy.ts`
- Modify: `src/commands/process_collection.ts`

- [ ] **Step 1: Update `easy` command to use new discovery results**

The `easy` command currently iterates `discovery.albums` as
`Map<dirPath, files>`. Update it to work with the new `AlbumGroup` structure
from metadata-based grouping. Compilations and albums are both processed
with album-level ReplayGain. Singles get track-only.

- [ ] **Step 2: Update `process` command similarly**

- [ ] **Step 3: Run E2E tests**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/amusic.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/commands/easy.ts src/commands/process_collection.ts
git commit -m "feat: update commands to use metadata-based album grouping"
```

### Task 9: Remove legacy compilation detection

**Files:**

- Modify: `src/utils/fast_discovery.ts` — remove import and call to
  `detectCompilationsRefactored`
- Delete: `src/utils/detect_compilations_refactored.ts` (functionality
  replaced by `groupTracksByAlbum`)
- Keep: `src/utils/compilation_detection.ts` — the pure functions
  `isCompilationAlbum` and `aggregateAlbumMetadata` may still be useful,
  evaluate whether they're still referenced

- [ ] **Step 1: Remove `detectCompilationsRefactored` import and usage from
  `fast_discovery.ts`**

- [ ] **Step 2: Delete `detect_compilations_refactored.ts` if no longer
  imported anywhere**

- [ ] **Step 3: Run full test suite to verify nothing breaks**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove legacy 3-file sampling compilation detection"
```

---

## Chunk 7: User Prompting for Ambiguous Cases

Add interactive prompting when metadata signals are ambiguous.

### Task 10: Prompt user for ambiguous grouping decisions

**Files:**

- Modify: `src/utils/album_grouping.ts`
- Modify: `src/utils/fast_discovery.ts`

- [ ] **Step 1: Identify ambiguous scenarios that need prompting**

- Same album name, different album artists, no clear resolution
- Disc subfolders with missing metadata
- Any other case where confidence is low

- [ ] **Step 2: Add `onAmbiguous` callback to grouping options**

```ts
export interface GroupingOptions {
  onAmbiguous?: (context: AmbiguousContext) => Promise<"merge" | "separate" | "singles">;
}
```

This keeps the grouping logic pure — the callback is injected by the caller
(the CLI command) and handles the actual user interaction.

- [ ] **Step 3: Wire prompting into `easy` and `process` commands using
  Cliffy's `prompt` or `confirm`**

- [ ] **Step 4: Add tests verifying that ambiguous cases trigger the callback**

- [ ] **Step 5: Commit**

```bash
git add src/utils/album_grouping.ts src/utils/fast_discovery.ts \
  src/commands/easy.ts src/commands/process_collection.ts
git commit -m "feat: prompt user for ambiguous album grouping decisions"
```
