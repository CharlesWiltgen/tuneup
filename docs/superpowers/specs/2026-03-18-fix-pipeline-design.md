# Design: `amusic fix` — Smart Music Identification Pipeline

**Date:** 2026-03-18 **Status:** Approved

## Vision

Replace Beets and MusicBrainz Picard with a single command that "does the right
thing" for average users. Core principle: **first, do no harm** — defaults
enhance and fill gaps, never silently overwrite.

## The Command

```
amusic fix <path>
amusic fix .
amusic fix ~/Music
```

### Flags

- `--dry-run` — preview everything, write nothing
- `--overwrite` — allow replacing existing tags when the match is better
- `--organize` — rename/move files into `Artist/Album (Year)/NN Title.ext`
- `--no-art` — skip cover art fetching
- `--api-key` — AcoustID API key (or `ACOUSTID_API_KEY` env var)

### Automation Model

- **High confidence (>=90%):** auto-apply, log what happened
- **Medium confidence (50-89%):** queue for batch review
- **Low confidence (<50%):** skip, report as unresolved

---

## Pipeline Stages

### 1. Discover

Recursively find all audio files and group by album. Reuses existing
`src/utils/fast_discovery.ts` and `src/utils/album_grouping.ts`.

### 2. Fingerprint

Generate AcoustID fingerprints for files missing them. Reuses
`src/lib/acoustid.ts` (`generateFingerprint()`). Note: duration must also be
read (via `src/lib/tagging.ts`) since the AcoustID API requires both fingerprint
and duration. The existing `batchProcessAcoustIDTagging` in
`src/lib/acoustid.ts` already handles this pattern and can be reused for stages
2-3.

### 3. Identify

Look up fingerprints against AcoustID API to get MusicBrainz recording IDs.
Reuses `src/lib/acoustid.ts`. AcoustID API rate limit: 3 requests/second for
free keys. Reuse the `RateLimiter` class from `src/lib/musicbrainz.ts` (or
extract to a shared utility) to enforce this.

### 4. Match Releases

This stage finds the best MusicBrainz _release_ for each album group. A
fingerprint gives a _recording_, but a recording can appear on dozens of
_releases_ (original album, compilations, deluxe editions, regional variants).

**Relationship to existing code:** `src/lib/musicbrainz.ts` already contains
`scoreRelease()` and `selectBestRelease()` with numeric weights. This stage
extends that existing logic rather than replacing it. No new
`release_matching.ts` module is needed — enhance `musicbrainz.ts` instead.

**Matching strategy:** Album-level, not track-level. Fingerprint every file in
an album group, then find the MusicBrainz release where the most recordings
match.

**Release scoring heuristics:** Extend the existing `scoreRelease()` weights in
`musicbrainz.ts`. Current weights (out of 100):

| Signal                               | Current Weight | Change                               |
| ------------------------------------ | -------------- | ------------------------------------ |
| Track count match                    | 30             | Keep                                 |
| Recording coverage                   | 25             | Keep                                 |
| Duration match                       | 15             | Keep                                 |
| Track order match                    | 10             | Keep                                 |
| Tag agreement                        | 10             | Keep                                 |
| Quality signals (status/type/format) | 10             | Keep                                 |
| Country/region preference            | —              | Add (5, from quality signals budget) |
| Original over reissue                | —              | Add (5, from quality signals budget) |

The quality signals category (currently 10) is split: 5 for existing
status/type/format logic, 5 for the two new signals (country/region and
original-vs-reissue at 2.5 each, or combined as tiebreakers within quality).

**Confidence mapping:** The `scoreRelease()` function returns 0.0–1.0. This maps
directly to the confidence percentages:

- Score >= 0.9 → high confidence (auto-apply)
- Score 0.5–0.89 → medium confidence (queue for review)
- Score < 0.5 → low confidence (skip, report)

The existing `CONFIDENCE_THRESHOLD = 0.4` in `musicbrainz.ts` remains as the
floor for `selectBestRelease()` — releases below 0.4 are not even considered as
candidates.

**Singles handling:** Files not part of an album group get matched as individual
recordings. Genre and artist metadata filled from MusicBrainz, no release-level
matching required. Note: MusicBrainz genre coverage for individual recordings is
spotty — some singles may end up without genre data.

### 5. Enrich

Fill metadata gaps from the matched release: title, artist, album, year, genre,
track number.

**Relationship to existing code:** The existing `enrich` command
(`src/commands/enrich.ts`) uses `buildAlbumDiff`/`applyFileDiff` which builds a
diff for all fields and prompts the user. The `fix` pipeline uses different
semantics: fill-only by default, overwrite only with `--overwrite`. Rather than
modifying the existing `enrich` code (which would change its behavior), the
`fix` pipeline implements its own enrichment logic in `src/lib/pipeline.ts` that
filters the diff to only include empty-field fills (or all changes if
`--overwrite` is set). The existing `enrich` command is unaffected.

**"First, do no harm" rules:**

- Never overwrite an existing tag with a blank value
- If existing tag is more specific than MB data, preserve it
- If existing and MB values differ superficially (e.g., "Abbey Road" vs "Abbey
  Road (Remastered)"), keep existing unless `--overwrite` is set
- Only fill empty fields by default
- With `--overwrite`, replace existing tags when the matched data is higher
  confidence

**Genre handling:**

- Use MusicBrainz genres as-is (community-voted, reasonably curated)
- Pick the most popular/relevant genre from MB's ranked list as the primary tag
- Preserve full genre data in extended tags

### 6. Cover Art

**Source:** Cover Art Archive only (linked to MusicBrainz releases, free, high
quality). No scraping.

**Behavior:**

- Only embed art if the file has no existing cover art
- With `--overwrite`, replace if CAA has higher resolution
- Prefer "front" image type from CAA
- Phase 1: embed at original resolution from CAA (no resizing). Image resizing
  (cap at ~1200x1200, JPEG re-encode) deferred to a later phase — requires
  adding an image processing dependency (e.g., Wasm-based library or shelling
  out to a tool). Original CAA images are typically reasonable sizes.

**Error handling:**

- Cover art fetch failures are non-fatal. Log the failure and continue
  processing.
- CAA 404 (no art for release): skip silently, note in report
- Network timeouts: skip with warning, note in report

**"Do no harm":**

- Never remove existing art
- Never replace art with lower-resolution art

### 7. Duplicate Detection

Detected as a natural byproduct of identification.

**Detection:**

- Same AcoustID ID (the short ID returned by the API, not the raw fingerprint)
  or same MusicBrainz recording ID = same recording. Raw fingerprints vary
  between encodings of the same song, so fingerprint comparison alone is
  unreliable.

**Recommendation logic:**

- Prefer lossless over lossy (FLAC > M4A/AAC > MP3 > OGG)
- Within same format, prefer higher bitrate
- Within same quality, prefer better-tagged file
- Flag but never auto-delete

**Output example:**

```
Duplicates found:
  "Just Like Honey" by The Jesus and Mary Chain
    KEEP:  ~/Music/TJAMC/Psychocandy/09 Just Like Honey.flac (FLAC, 1411kbps)
    EXTRA: ~/Music/Downloads/just_like_honey.mp3 (MP3, 192kbps)
```

With `--organize`, duplicates surfaced before files get moved.

### 8. Review

Medium-confidence items presented as a batch after the pipeline runs.

**Phase 1 (v1): Text-based review.**

```
3 items need your review:

1. "track03.mp3" -> "Karma Police" by Radiohead (OK Computer, 1997)
   Confidence: 72% — fingerprint matched but track count mismatch
   [y] Accept  [n] Skip  [d] Show diff

2. "unknown.flac" -> "Everything In Its Right Place" by Radiohead (Kid A, 2000)
   Confidence: 55% — fingerprint matched, no existing tags to corroborate
   [y] Accept  [n] Skip  [d] Show diff
```

**Diff display** — shows what will change, not raw metadata:

```
Title:   (empty) -> "Karma Police"
Artist:  "Radiohead" (kept)
Album:   (empty) -> "OK Computer"
Year:    (empty) -> "1997"
Genre:   (empty) -> "Alternative Rock"
Art:     (none) -> [embedded, 600x600]
```

**Phase 2 (future): TUI with lazygit-style interface.**

- Left pane: album groups and match status
- Right pane: track details, metadata diff
- Keyboard-driven navigation and batch operations

### 9. Organize (optional, `--organize` flag only)

**Default structure:**

```
<library-root>/Artist/Album (Year)/NN Title.ext
```

**Rules:**

- Track number zero-padded to 2 digits (3 for 100+ track albums)
- Filesystem-unsafe characters sanitized
- "Various Artists" for compilations
- Singles: `Artist/Singles/Title.ext`
- Never overwrite existing destination files — report conflicts
- Clean up empty source directories after moves

**No template language.** One sensible structure, deliberately opinionated.

`--dry-run` applies to all stages including `--organize`. Preview shows proposed
file paths without moving anything.

### 10. Report

Summary of all actions taken:

- Files processed, matched, enriched
- Cover art added
- Duplicates found
- Unresolved files (no match or low confidence)
- Conflicts (if `--organize`)

---

## Architecture

### Modules Used by `fix` (unchanged)

- `src/utils/fast_discovery.ts` — parallel file discovery with worker pools
- `src/utils/album_grouping.ts` — metadata-based album classification
- `src/lib/acoustid.ts` — fingerprinting and AcoustID lookup
- `src/lib/tagging.ts` — taglib-wasm wrapper for metadata
- `src/lib/vendor_tools.ts` — platform binary resolution

### Other Existing Modules (not touched by `fix`)

- `src/lib/encoding.ts`, `src/lib/soundcheck.ts`, `src/lib/lint_engine.ts` —
  standalone utility commands, unrelated to the `fix` pipeline

### New Modules

- **`src/commands/fix.ts`** — the `fix` command, wires up the pipeline
- **`src/lib/pipeline.ts`** — orchestrator, runs stages in sequence, manages
  confidence gates and enrichment logic (fill-only vs. overwrite)
- **`src/lib/cover_art.ts`** — Cover Art Archive fetching and embedding
- **`src/lib/duplicate_detection.ts`** — groups files by recording/AcoustID ID,
  ranks quality
- **`src/lib/confidence.ts`** — confidence scoring and threshold logic
- **`src/lib/review.ts`** — text-based review UI for medium-confidence items
- **`src/lib/organizer.ts`** — file rename/move logic

### Enhanced Modules

- **`src/lib/musicbrainz.ts`** — extend `scoreRelease()` with country/region and
  original-vs-reissue signals. Add any missing release-level API queries needed
  by the pipeline. Existing `enrich` command behavior unaffected.

### Data Flow

```
fix command
  -> discover (fast_discovery + album_grouping — existing)
  -> fingerprint (acoustid — existing)
  -> identify (acoustid API — existing, add rate limiting)
  -> match releases (musicbrainz scoreRelease — enhanced)
  -> enrich (pipeline.ts — NEW, fill-only semantics)
  -> cover art (cover_art — NEW)
  -> detect duplicates (duplicate_detection — NEW)
  -> review (review — NEW, if medium-confidence items)
  -> organize (organizer — NEW, if --organize flag)
  -> report (summary)
```

### Existing Commands Preserved

All existing commands remain as power-user tools: `process`, `encode`, `lint`,
`soundcheck`, `enrich`, `easy`, `x-ray`. The `--show-tags` flag and default
interactive mode (no subcommand) are also unchanged.

`fix` is a subcommand only. It is not integrated into the default interactive
mode in v1. The interactive mode could offer `fix` as an operation choice in a
future update.

---

## Scope Exclusions

- **ReplayGain** is not part of the `fix` pipeline. Use `process --replay-gain`
  or `easy` for ReplayGain calculation.
- **Image resizing** deferred to a later phase (see Cover Art section).
- **Automatic duplicate deletion** not in v1 — report and recommend only.
- **TUI** is phase 2 — v1 uses text-based review.
- **Library state/index** (e.g., DuckDB) not in v1 — one-shot processing only.

---

## Priority Order

1. **Identification pipeline** (discover → fingerprint → identify → match →
   enrich) — the foundation
2. **Cover art** — fetching and embedding from CAA
3. **File organization** — optional `--organize` flag
4. **Duplicate detection** — reporting with recommendations
5. **TUI for review** — phase 2, lazygit-style interface

---

## Key Design Decisions

1. **"First, do no harm"** — defaults never destroy data, only enhance.
   Overwrite is opt-in via `--overwrite` flag.
2. **Confidence-based automation** — high auto-applies, medium pauses for
   review, low skips. Users see a preview before anything writes.
3. **Album-level matching** — match recordings to releases as groups, not
   individually. This is how humans think about music.
4. **No template language** — one opinionated folder structure. Avoids the Beets
   config complexity trap.
5. **No library state** — one-shot processing. A persistent index (e.g., DuckDB)
   is a future optimization, not a core requirement.
6. **Cover Art Archive only** — single trusted source, no scraping.
7. **Existing commands preserved** — `fix` is additive, not a replacement of
   current functionality.
