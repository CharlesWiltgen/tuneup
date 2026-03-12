# Lint Command Design Spec

## Overview

A `lint` subcommand for amusic that scans a music library and reports tagging
problems, inconsistencies, and gaps. Two tiers: metadata-only (default) and
media integrity (`--deep`).

## Architecture

### Streaming Engine

**Phase 1 (per-file):** Iterate files via taglib-wasm batch API. For each file:

- Run per-file metadata rules (missing title, missing cover art, etc.)
- Run per-file media rules if `--deep` (header validation, parse errors)
- Emit issues immediately (JSONL) or buffer for terminal display
- Accumulate lightweight album index entry per album:
  `{albumArtists, years, trackNumbers, discNumbers, formats, sampleRates, directories, fileCount}`

**Phase 2 (per-album):** Iterate album index Map. For each album group:

- Run per-album consistency rules (mixed artists, year mismatches, track gaps)
- Emit issues

**Output:** Summary stats emitted after both phases (counts by severity,
category, rule).

### Memory Profile

- Per-file metadata: not retained after processing (streamed)
- Album index: ~200 bytes × ~50K albums = ~10MB at 500K files
- Issues list (terminal mode): proportional to problems found, not library size

### Album Grouping

Albums are grouped by normalized album tag using `normalizeForMatching()` with
options `{ stripLeadingArticles: false, romanToArabic: false }` — conservative
defaults to avoid merging distinct albums and producing false positives.

Grouping is metadata-based, not directory-based. This catches issues that
directory-based grouping would miss (scattered tracks, mixed albums in one
folder).

## Rule Definitions

Rules are plain objects in an array (not separate files). Each has a name,
severity, category, and check function. Returns zero or more `LintIssue`
objects.

### LintIssue Type

```ts
type LintIssue = {
  type: "issue";
  rule: string;
  severity: "error" | "warning" | "info";
  file?: string;
  album?: string;
  message: string;
};
```

- Per-file issues: `file` is set, `album` is optional
- Per-album issues: `album` is set, `file` is omitted

### Lossy vs. Lossless Classification

For rules that distinguish lossy from lossless (e.g., `suspicious-bitrate`,
`mixed-formats`), use the existing classification from `src/lib/encoding.ts`:

- **Lossless**: wav, flac, alac
- **Lossy**: mp3, ogg, aac, opus, wma
- **Ambiguous** (m4a, mp4): check `audioProperties.isLossless`

### Per-File Metadata Rules

| Rule                   | Checks                                  | Severity |
| ---------------------- | --------------------------------------- | -------- |
| `missing-title`        | No title tag                            | error    |
| `missing-artist`       | No artist tag                           | error    |
| `missing-album`        | No album tag                            | warning  |
| `missing-year`         | No year tag                             | warning  |
| `missing-track-number` | No track number                         | warning  |
| `missing-genre`        | No genre tag                            | info     |
| `missing-cover-art`    | No embedded artwork                     | warning  |
| `missing-replaygain`   | No ReplayGain tags                      | info     |
| `missing-acoustid`     | No AcoustID fingerprint/ID              | info     |
| `suspicious-duration`  | Duration < 5s or > 45min                | warning  |
| `suspicious-bitrate`   | Bitrate < 64kbps (lossy only, per above)| warning  |

### Per-File Media Rules (`--deep` only)

| Rule                 | Checks                                                   | Severity |
| -------------------- | -------------------------------------------------------- | -------- |
| `invalid-header`     | Magic bytes don't match ANY known audio format (corrupt) | error    |
| `parse-failure`      | taglib-wasm can't open the file                          | error    |
| `extension-mismatch` | Magic bytes match a valid format, but DIFFERENT from ext | warning  |

`invalid-header` fires when the file isn't recognizable audio at all.
`extension-mismatch` fires when it IS valid audio but the extension is wrong.
These are mutually exclusive.

### Per-Album Consistency Rules

| Rule                    | Checks                                                         | Severity |
| ----------------------- | -------------------------------------------------------------- | -------- |
| `inconsistent-artist`   | Multiple different album artists within album (uses `albumArtist` tag, falls back to `artist`) | warning  |
| `inconsistent-year`     | Mixed years within album                                       | warning  |
| `track-number-gaps`     | Missing numbers in track sequence; checked per-disc when disc numbers present | warning  |
| `duplicate-track-number`| Same track number appears twice within same disc               | error    |
| `missing-disc-number`   | 2+ files share a track number AND no files have disc number tags | warning  |
| `mixed-formats`         | Album contains both lossy and lossless files                   | info     |
| `mixed-sample-rates`    | Different sample rates within album                            | warning  |

**Multi-disc handling**: When disc numbers are present, `track-number-gaps` and
`duplicate-track-number` operate per-disc. When disc numbers are absent but
track numbers repeat, `missing-disc-number` fires instead.

## CLI Interface

### Command Signature

```
amusic lint <path> [options]
```

### Options

| Flag                 | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| `--deep`             | Enable media integrity checks (header validation)              |
| `--json`             | Output as JSONL (one issue per line, summary last)             |
| `--severity <level>` | Minimum severity to report: `error`, `warning` (default), `info` |
| `--quiet`            | Suppress progress output (does not change severity filtering)  |

`--quiet` controls progress display only. `--severity` controls which issues
are reported. They are independent.

### Exit Codes

| Code | Meaning                                    |
| ---- | ------------------------------------------ |
| 0    | No errors found (warnings/info may exist)  |
| 1    | One or more error-severity issues found     |
| 2    | Lint could not run (invalid path, etc.)     |

### Terminal Output (default)

```
Scanning 1,247 files...

❌ /music/Album/01 Track.mp3: missing-title — No title tag
⚠️  /music/Album/03 Track.mp3: suspicious-bitrate — Bitrate 32kbps is unusually low
⚠️  Album "Dark Side of the Moon": track-number-gaps — Missing track 4 in sequence 1-8
ℹ️  Album "OK Computer": mixed-formats — Contains both mp3 and flac files

Summary:
  2 errors · 14 warnings · 7 info
  1,220 files OK · 27 files with issues · 3 album issues
```

### JSONL Output (`--json`)

Each issue line includes `"type":"issue"`. Final line is a summary:

```jsonl
{"type":"issue","rule":"missing-title","severity":"error","file":"/music/Album/01 Track.mp3","message":"No title tag"}
{"type":"summary","errors":2,"warnings":14,"info":7,"filesOk":1220,"filesWithIssues":27,"albumIssues":3}
```

### Progress

Displayed on stderr so it doesn't interfere with piped JSONL. Updates every
~1000 files or every second.

## File Structure

### New Files

| File                      | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `src/lib/lint.ts`         | Rule registry, rule definitions, `LintIssue` type  |
| `src/lib/lint_engine.ts`  | Streaming engine, album index accumulation          |
| `src/lib/lint_media.ts`   | `--deep` media checks (header validation)          |
| `src/commands/lint.ts`    | CLI command handler, output formatting              |

### Modified Files

| File              | Change                          |
| ----------------- | ------------------------------- |
| `src/cli/cli.ts`  | Add `lint` subcommand           |

### Reused Code

- taglib-wasm batch API (pattern from `show_tags_folder.ts`)
- `normalizeForMatching()` from `src/utils/normalize.ts`
- `listAudioFilesRecursive()` from `src/lib/fastest_audio_scan_recursive.ts`
- Lossy/lossless classification from `src/lib/encoding.ts`
- Error utilities from `src/utils/error_utils.ts`

## Media Validation Strategy

### Current Scope (v1)

- **Header validation**: Read first 12 bytes, verify magic bytes match a known
  audio format
- **Extension mismatch**: Cross-reference detected format from magic bytes with
  file extension
- **taglib-wasm error classification**: Distinguish parse failures from missing
  files from unsupported formats

### Magic Bytes Reference

| Format     | Offset | Bytes                    |
| ---------- | ------ | ------------------------ |
| MP3 (ID3)  | 0      | `49 44 33` ("ID3")       |
| MP3 (sync) | 0      | `FF FB` or `FF FA`       |
| FLAC       | 0      | `66 4C 61 43` ("fLaC")   |
| OGG        | 0      | `4F 67 67 53` ("OggS")   |
| M4A/MP4    | 4      | `66 74 79 70` ("ftyp")   |
| WAV        | 0      | `52 49 46 46` ("RIFF")   |

### Future Scope

- Vendor ffprobe for stream-level corruption detection
- Frame-by-frame validation for truncated files
- Codec-specific integrity checks

## Design Decisions

1. **Metadata-based album grouping over directory-based**: The lint tool's job is
   to find problems — directory structure itself may be wrong. Grouping by
   normalized album tag is more accurate.

2. **Streaming over full in-memory**: Supports 500K+ file libraries without
   holding all metadata in memory. Only album index (~10MB at scale) is retained
   between phases.

3. **JSONL over structured JSON**: Streamable, pipe-friendly, handles large
   output without buffering entire result. `type` discriminator on every line
   for robust parsing.

4. **Rule objects in array over plugin architecture**: ~20 rules don't warrant
   file-per-rule overhead. Rules are plain objects with check functions,
   testable individually.

5. **Header validation over ffprobe for v1**: Zero new dependencies, catches
   ~80% of common file integrity issues. ffprobe can be added later if needed.

6. **Conservative normalization for album grouping**: No article stripping or
   Roman numeral conversion — avoids false merges of distinct albums.

7. **`albumArtist` for consistency checks**: Uses the album artist tag (not
   track artist) since that's the field that should be consistent within an
   album. Falls back to track artist when album artist is absent.

8. **Per-disc track validation**: Track number rules operate within disc
   boundaries when disc numbers are present, avoiding false positives on
   multi-disc albums.
