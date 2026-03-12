# MusicBrainz Enrichment Design Spec

## Overview

Two-tier MusicBrainz integration for amusic. Tier 1 automatically captures
MusicBrainz IDs that the AcoustID API already returns (currently discarded).
Tier 2 adds a new `amusic enrich` command that queries the MusicBrainz API for
authoritative metadata, uses album-level scoring to identify the correct
release, and lets the user review and apply tag corrections.

## Tier 1: Capture MusicBrainz IDs During AcoustID Processing

### What Changes

The AcoustID API already returns MusicBrainz recording data in its response
(requested via `meta=recordings+releasegroups+compress`). Currently only the
AcoustID UUID is extracted and written. After this change, three additional tags
are written when available:

| Tag                      | Source                                           |
| ------------------------ | ------------------------------------------------ |
| `MUSICBRAINZ_TRACKID`   | `recordings[0].id`                               |
| `MUSICBRAINZ_ARTISTID`  | `recordings[0].artists[0].id`                    |
| `MUSICBRAINZ_RELEASEID` | `recordings[0].releasegroups[0].releases[0].id`  |

All three are already supported by taglib-wasm (`musicbrainzTrackId`,
`musicbrainzArtistId`, `musicbrainzReleaseId` property keys).

### Null Handling

Each tag is written independently. If the AcoustID response lacks a particular
field (e.g., no release groups, no artists), that tag is simply not written. The
other tags are still written if their data is available. Specifically:

- No `recordings` array or empty → no MusicBrainz tags written (only AcoustID)
- Recording present but no `artists` → skip `MUSICBRAINZ_ARTISTID`, write the
  others
- Recording present but no `releasegroups` or empty `releases` → skip
  `MUSICBRAINZ_RELEASEID`, write the others

### Matching Strategy

Use the highest-score recording from the AcoustID response (same as current
behavior for AcoustID ID). For release, pick the first release from the first
release group. This is a best-effort default — Tier 2 refines it with
album-level scoring and will overwrite the Tier 1 `MUSICBRAINZ_RELEASEID` with
a more accurate value.

### Skip Logic

MusicBrainz tag writing is independent of AcoustID tag skip logic. The flow is:

1. AcoustID processing runs as before (skip if ACOUSTID_ID present unless
   `--force`)
2. **Regardless of whether AcoustID tags were skipped**, if `MUSICBRAINZ_TRACKID`
   is absent, extract and write available MusicBrainz IDs from the lookup
   response
3. If `MUSICBRAINZ_TRACKID` is already present, skip MusicBrainz tag writing
   unless `--force`

This means existing libraries that already have AcoustID tags will get
MusicBrainz IDs on the next run without needing `--force` — as long as the
AcoustID lookup still executes (which it does, since the fingerprint is needed
to check the existing tag).

**Implementation note**: This requires restructuring `processAcoustIDTagging()`
to separate the "lookup" step (always needed) from the "write AcoustID tags"
step (skippable). The MusicBrainz tag write uses the lookup result but has its
own skip condition.

### Tag Writing Approach

Create a new `writeMusicBrainzTags(filePath, ids)` function in `tagging.ts`
rather than modifying the existing `writeAcoustIDTags` signature. This keeps the
two concerns separate and avoids breaking existing callers. The new function
accepts:

```ts
type MusicBrainzIds = {
  trackId?: string;
  artistId?: string;
  releaseId?: string;
};
```

### Files Modified

- `src/lib/acoustid.ts` — Extract MusicBrainz IDs from lookup response,
  restructure skip logic
- `src/lib/tagging.ts` — Add `writeMusicBrainzTags()` function

### No New Commands or Flags

This is a behavioral change to existing AcoustID processing. No user action
required.

## Tier 2: `amusic enrich` Command

### Purpose

Query MusicBrainz API using recording IDs already in tags, fetch authoritative
metadata, identify the correct release using album-level scoring, show a diff,
and let the user confirm before writing.

### Prerequisites

Files must have `MUSICBRAINZ_TRACKID` tags (written by Tier 1 during AcoustID
processing). Files without this tag are skipped with a message suggesting
`amusic process --acoust-id` first.

### CLI Interface

```
amusic enrich <path> [options]
  --yes        Apply all changes without prompting
  --dry-run    Show what would change without writing
  --quiet      Suppress progress output (errors and warnings still shown)
  --force      Re-enrich even if enrichment was previously applied
```

`<path>` is a positional argument (directory or file), same pattern as the
`lint` command.

### Enrichment Detection

A file is considered "previously enriched" if it has a non-empty
`MUSICBRAINZ_RELEASEID` tag AND at least one of: album, year, or track number
tags that were set by a prior enrich run. To track this, the enrich command
writes a marker property `AMUSIC_ENRICHED=1` after applying changes. The
`--force` flag ignores this marker.

### Exit Codes

| Code | Meaning                                    |
| ---- | ------------------------------------------ |
| 0    | Success (changes applied or nothing to do) |
| 1    | Some files had errors                      |
| 2    | Could not run (invalid path, etc.)         |

### MusicBrainz API

- **Endpoint**: `GET /ws/2/recording/{id}?inc=artists+releases+genres&fmt=json`
- **Rate limit**: 1 request/second sustained, burst capacity of 1 (strictly
  1 req/sec, no bursting). If MusicBrainz returns HTTP 503, wait 5 seconds
  then retry once. If retry also fails, skip that recording and warn.
- **User-Agent**: `amusic/{version} (https://github.com/CharlesWiltgen/amusic)`
- **Authentication**: None required
- **Duration units**: MusicBrainz returns durations in milliseconds; convert to
  seconds before comparing with file durations from taglib-wasm.

### Error Handling

| Error                    | Behavior                                       |
| ------------------------ | ---------------------------------------------- |
| HTTP 503 (rate limited)  | Wait 5s, retry once. If still 503, skip + warn |
| HTTP 404 (invalid ID)    | Skip file, warn "Recording ID not found"       |
| Network timeout (10s)    | Skip file, warn                                |
| Partial album failure    | Continue with available data; scoring uses only successfully fetched recordings. Warn about skipped files. |
| All recordings fail      | Skip album entirely, warn                      |

### Processing Flow

#### Step 1: Discovery and Grouping

1. Scan path for audio files using `listAudioFilesRecursive()`
2. Read existing tags from each file via taglib-wasm batch API (MusicBrainz
   recording ID, album, artist, year, track number, disc number, genre) and
   audio properties (duration)
3. Group files by directory using existing `groupFilesByDirectory()` from
   `src/lib/folder_operations.ts`
4. Directories with a single file are treated as singles (per-file mode)

#### Step 2: Per-Album Enrichment

For each album group:

1. Collect all `MUSICBRAINZ_TRACKID` values from the group
2. Query MusicBrainz API for each unique recording ID (rate-limited)
3. Build candidate release list from all recordings' releases
4. Score each candidate release using the weighted scoring model (see below)
5. Select highest-scoring release
6. Map each file to its track on the selected release

#### Step 3: Per-Single Enrichment

For loose files (single-file directories):

1. Query MusicBrainz for the recording
2. Score candidate releases: prefer "Single" type (1.0), then "Album" (0.8),
   then "EP" (0.6). Rank compilations last (0.2). Among same-type releases,
   prefer "Official" status, then earliest release with a complete date. If
   only year is available, use year. If no date, rank last within the type.
3. Map metadata from the recording + selected release

#### Step 4: Diff and Confirmation

- Display album-level changes first: `Album: "current" → "new"`
- Then per-track changes: `field: "current" → "new"`
- Skip files with no changes
- Three modes:
  - **Interactive** (default): show diff per album, ask y/n
  - **`--yes`**: apply all without prompting
  - **`--dry-run`**: show diff, write nothing

### Fields Updated

| Field        | Source                                     |
| ------------ | ------------------------------------------ |
| Title        | Recording title                            |
| Artist       | Recording artist credits (joined)          |
| Album        | Release title                              |
| Album Artist | Release artist credits (joined)            |
| Year         | Release date (year component)              |
| Track Number | Track position on the matched medium       |
| Disc Number  | Medium position within release (1-indexed) |
| Genre        | Recording genres preferred; fall back to release group genres if recording has none |

Only fields that differ from existing tags are shown in the diff. Empty fields
that MusicBrainz can fill are included.

### Multi-Disc Release Handling

Track count and position are always relative to the medium (disc), not the
entire release. When scoring track count match, compare the user's file count
against the medium's track count that contains the most matched recordings. If
files span multiple media (e.g., a 2-disc set in one folder), each medium is
scored separately and the total coverage across media is used.

## Album-Level Release Scoring Model

### Overview

When a recording appears on multiple releases (original album, deluxe edition,
compilation, greatest hits), we need to identify which release the user actually
has. Single-file matching is unreliable. Album-level scoring uses collective
signals across all files in a directory to pick the correct release.

### Candidate Generation

For each recording in the album group, query MusicBrainz and collect all
releases the recording appears on. The union of these release sets forms the
candidate list. Releases that contain zero of the album's recordings are
discarded.

### Scoring Signals

Each signal produces a normalized score (0.0–1.0). The final release score is
the weighted sum of all components, normalized to 0.0–1.0.

#### Track Count Match (weight: 30)

Measures how well the release track count matches the number of files. Uses
per-medium track count (see Multi-Disc Release Handling).

```
release_tracks = track count on best-matching medium
user_files = number of files in directory

if user_files <= release_tracks:
    # User might be missing some tracks (partial album)
    score = user_files / release_tracks
else:
    # User has more files than the release — bad match
    score = release_tracks / user_files * 0.5
```

A 12-file directory scores 0.86 against a 14-track deluxe edition (12/14) and
1.0 against a 12-track standard edition. But duration and order signals below
break ties.

#### Recording Coverage (weight: 25)

What fraction of the user's files appear on this release as recordings?

```
matched = number of user recordings found on this release
score = matched / user_files
```

A release that contains 12/12 of the user's recordings scores 1.0. A release
that contains 10/12 scores 0.83.

#### Duration Match (weight: 15)

For each recording matched to a release track, compare durations. MusicBrainz
durations are in milliseconds; file durations from taglib-wasm are in seconds.
Convert MB durations to seconds before comparing.

```
per_track_score = 1.0 if |file_duration - mb_duration| <= 3s
                  0.5 if |file_duration - mb_duration| <= 10s
                  0.0 otherwise
score = average(per_track_scores)
```

If MusicBrainz has no duration for a track, that track is excluded from the
average (neutral).

#### Track Order Match (weight: 10)

Do the recordings appear in the same sequence on the release as in the
directory (sorted by existing track number tag, falling back to filename sort)?

```
matched_positions = list of release track positions for user files, in user order
score = length_of_longest_increasing_subsequence(matched_positions) / len(matched_positions)
```

If all tracks are in order, score = 1.0. Shuffled tracks score lower.

Implementation note: LIS is O(n log n) via patience sorting. For typical album
sizes (10–25 tracks) this is trivial. Implement from scratch — no dependency
needed for a ~15-line function.

#### Existing Tag Agreement (weight: 10)

How well do existing tags match the release metadata?

- Album title: normalized comparison using existing `normalizeForMatching()`
  from `src/utils/normalize.ts`, then simple ratio of matching characters
  (no external fuzzy matching library needed)
- Year: exact match = 1.0, within 1 year = 0.5, else 0.0
- Artist: same normalized comparison as album title

```
score = average(album_sim, year_sim, artist_sim)
```

Only non-empty existing tags contribute to the average. If all tags are empty,
this signal is neutral (0.5).

#### Release Quality Signals (weight: 10)

Prefer authoritative releases.

```
status_score:
  "Official" = 1.0
  "Promotion" = 0.3
  "Bootleg" = 0.1
  other/unknown = 0.5

type_score:
  "Album" = 1.0 (for album groups)
  "Single" = 1.0 (for singles)
  "EP" = 0.8
  "Compilation" = 0.3
  other = 0.5

format_score:
  "Digital Media" = 1.0
  "CD" = 0.8
  other = 0.5

score = average(status_score, type_score, format_score)
```

### Partial Album Handling

A directory with 12 files should still match a 14-track release if 12 of its
recordings appear on that release. The scoring model handles this naturally:

- Track count score: 12/14 = 0.86 (not 0, not a disqualification)
- Recording coverage: 12/12 = 1.0 (all user files found)
- The release with the highest combined score wins

A 12-file match against a 12-track standard edition vs a 14-track deluxe
edition is resolved by the other signals (duration, order, existing tags).

### Confidence Threshold

If the top-scoring release scores below 0.4 (tunable constant), enrichment is
skipped for that album with a warning: "Could not confidently identify release
for album 'X'." In interactive mode, the user is still shown the top 3
candidates and can pick one. The 0.4 threshold is conservative — most signals
return 0.5 for neutral/unknown, so a score below 0.4 indicates active
disagreement between signals.

### Tie Breaking

If two releases score within 0.05 of each other:
1. Prefer the release with more recordings matched
2. Prefer the earlier release date (original over reissue)
3. In interactive mode, present both and let user choose

## File Structure

### New Files

| File                      | Purpose                                                      |
| ------------------------- | ------------------------------------------------------------ |
| `src/lib/musicbrainz.ts`  | MusicBrainz API client, response types, rate limiter, release scoring model |
| `src/commands/enrich.ts`  | CLI command handler, diff display, confirmation flow         |

### Modified Files

| File                  | Change                                                    |
| --------------------- | --------------------------------------------------------- |
| `src/lib/acoustid.ts` | Extract MusicBrainz IDs from lookup response, restructure skip logic |
| `src/lib/tagging.ts`  | Add `writeMusicBrainzTags()` function                     |
| `src/cli/cli.ts`      | Add `enrich` subcommand with `<path>` positional argument |

### Test Files

| File                           | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `src/lib/musicbrainz.test.ts`  | Response parsing, scoring model, rate limiter, LIS, disambiguation |
| `src/commands/enrich.test.ts`  | Integration tests for enrich command                 |

## Design Decisions

1. **Album-level scoring over per-file matching**: A single recording can
   appear on dozens of releases. Per-file matching is unreliable. Album-level
   collective signals (track count, order, coverage) dramatically improve
   accuracy, especially for identifying deluxe editions and handling partial
   albums.

2. **Weighted scoring model over heuristic rules**: Weights allow signals to
   combine gracefully. A strong track-count match with weak tag agreement still
   scores well. Heuristic rules (if/else chains) break on edge cases.

3. **Directory-based grouping for Tier 2**: Unlike the lint command (which
   groups by album tag), enrich uses directory grouping because the album tag
   itself may be wrong — that's what we're trying to fix.

4. **Separate command over process flag**: Enrichment is an interactive
   review/correction workflow, not a batch operation. Mixing interactive
   prompts into the process pipeline would complicate both.

5. **No authentication required**: MusicBrainz API allows unauthenticated
   read-only access at 1 req/sec. Rate limiting is enforced client-side.

6. **Tier 1 automatic, Tier 2 opt-in**: Writing IDs we already have is a
   no-brainer default. Full metadata enrichment requires user review and
   confirmation.

7. **Partial album tolerance**: The scoring model treats missing tracks as a
   soft penalty, not a disqualification. A 90% match on a deluxe edition can
   outscore a 100% match on a standard edition when other signals agree.

8. **Confidence threshold with manual override**: Below 0.4 confidence, we
   don't auto-apply. But in interactive mode we still show candidates so the
   user can decide.

9. **Separate `writeMusicBrainzTags` function**: Keeps AcoustID and MusicBrainz
   tag writing independent. Avoids breaking existing `writeAcoustIDTags`
   callers and allows MusicBrainz tags to have their own skip logic.

10. **No external fuzzy matching dependency**: Use existing
    `normalizeForMatching()` for string similarity rather than adding a
    Levenshtein library. Sufficient for comparing album/artist names.

11. **Tier 2 overwrites Tier 1 release ID**: Tier 1 writes a best-effort
    `MUSICBRAINZ_RELEASEID` from the first release in the AcoustID response.
    Tier 2 replaces this with the album-level scored release, which is more
    accurate.
