# Lint Command Design Spec

## Overview

A `lint` subcommand for amusic that scans a music library and reports tagging
problems, inconsistencies, and gaps. Two tiers: metadata-only (default) and
media integrity (`--deep`).

## Architecture

### Two-Pass Streaming Engine

**Pass 1 (per-file):** Iterate files via taglib-wasm batch API. For each file:

- Run per-file metadata rules (missing title, missing cover art, etc.)
- Run per-file media rules if `--deep` (header validation, parse errors)
- Emit issues immediately (JSONL) or buffer for terminal display
- Accumulate lightweight album index entry per album:
  `{artists, years, trackNumbers, discNumbers, formats, sampleRates, directories, fileCount}`

**Pass 2 (per-album):** Iterate album index Map. For each album group:

- Run per-album consistency rules (mixed artists, year mismatches, track gaps)
- Emit issues

**Pass 3 (output):** Summary stats (counts by severity, category, rule).

### Memory Profile

- Per-file metadata: not retained after processing (streamed)
- Album index: ~200 bytes × ~50K albums = ~10MB at 500K files
- Issues list (terminal mode): proportional to problems found, not library size

### Album Grouping

Albums are grouped by normalized album tag (using existing
`normalizeForMatching()`) — not by directory structure. This catches issues that
directory-based grouping would miss (scattered tracks, mixed albums in one
folder).

## Rule Definitions

Rules are plain objects in an array (not separate files). Each has a name,
severity, category, and check function. Returns zero or more `LintIssue`
objects.

### LintIssue Type

```ts
type LintIssue = {
  rule: string;
  severity: "error" | "warning" | "info";
  file: string;
  album?: string;
  message: string;
};
```

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
| `suspicious-bitrate`   | Bitrate < 64kbps (lossy only)           | warning  |

### Per-File Media Rules (`--deep` only)

| Rule                 | Checks                                      | Severity |
| -------------------- | ------------------------------------------- | -------- |
| `invalid-header`     | File magic bytes don't match extension       | error    |
| `parse-failure`      | taglib-wasm can't open the file              | error    |
| `extension-mismatch` | Header says FLAC but extension is .mp3, etc. | warning  |

### Per-Album Consistency Rules

| Rule                    | Checks                                                         | Severity |
| ----------------------- | -------------------------------------------------------------- | -------- |
| `inconsistent-artist`   | Multiple different album artists within album                  | warning  |
| `inconsistent-year`     | Mixed years within album                                       | warning  |
| `track-number-gaps`     | Missing numbers in sequence (e.g., 1,2,4)                     | warning  |
| `duplicate-track-number`| Same track number appears twice                                | error    |
| `missing-disc-number`   | Track numbers reset (suggesting multi-disc) but no disc tags   | warning  |
| `mixed-formats`         | Album contains both lossy and lossless files                   | info     |
| `mixed-sample-rates`    | Different sample rates within album                            | warning  |

## CLI Interface

### Command Signature

```
amusic lint <path> [options]
```

### Options

| Flag                 | Description                                           |
| -------------------- | ----------------------------------------------------- |
| `--deep`             | Enable media integrity checks (header validation)     |
| `--json`             | Output as JSONL (one issue per line, summary last)    |
| `--severity <level>` | Minimum severity: `error`, `warning` (default), `info`|
| `--quiet`            | Errors only, no progress                              |

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

Each line is a serialized `LintIssue`. Final line is a summary object:

```json
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
| `src/lib/lint_engine.ts`  | Two-pass streaming engine, album index accumulation |
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
- Error utilities from `src/utils/error_utils.ts`

## Media Validation Strategy

### Current Scope (v1)

- **Header validation**: Read first 12 bytes, verify magic bytes match extension
- **taglib-wasm error classification**: Distinguish parse failures from missing
  files from unsupported formats
- **Extension mismatch detection**: Cross-reference detected format with file
  extension

### Future Scope

- Vendor ffprobe for stream-level corruption detection
- Frame-by-frame validation for truncated files
- Codec-specific integrity checks

## Design Decisions

1. **Metadata-based album grouping over directory-based**: The lint tool's job is
   to find problems — directory structure itself may be wrong. Grouping by
   normalized album tag is more accurate.

2. **Streaming two-pass over full in-memory**: Supports 500K+ file libraries
   without holding all metadata in memory. Only album index (~10MB at scale) is
   retained between passes.

3. **JSONL over structured JSON**: Streamable, pipe-friendly, handles large
   output without buffering entire result.

4. **Rule objects in array over plugin architecture**: ~20 rules don't warrant
   file-per-rule overhead. Rules are plain objects with check functions,
   testable individually.

5. **Header validation over ffprobe for v1**: Zero new dependencies, catches
   ~80% of common file integrity issues. ffprobe can be added later if needed.
