# Album Detection Improvements

## Problem

amusic's current album vs. singles classification relies entirely on directory
structure: a folder with 2+ audio files is an album, a folder with 1 file or
matching `/singles/`/`/misc/` patterns is singles. This causes incorrect
behavior:

- A folder of random unrelated tracks gets album-level ReplayGain applied as if
  they belong together
- Multi-disc albums in separate subfolders are treated as independent albums
- No metadata is consulted — album name, album artist, and track numbers are
  ignored for grouping decisions
- Compilation detection only runs during encoding, not for ReplayGain

## Design

### 1. Metadata-Based Album Grouping

Replace the current "2+ files = album" heuristic with metadata-aware grouping.

**Metadata resolution order** (per track):

1. **Tags** — album name, album artist, track number (authoritative)
2. **Directory name** — fallback for album name
3. **Filename parsing** — last resort for track number, artist, title

**Grouping algorithm**:

1. Read metadata for all tracks in a folder using the resolution chain above
2. Group by **(normalized album name + normalized album artist)**
   - When album artist is "Various Artists" or blank, group by album name alone
   - Album artist is only used as a disambiguation key when it identifies a
     specific artist
3. Any group of 2+ tracks with matching album identity is treated as an album
4. Tracks that don't belong to any group are treated as singles (track-only
   ReplayGain)
5. When signals are ambiguous (e.g., same album name but different album
   artists, no clear resolution), prompt the user rather than guess

### 2. Confidence-Based Grouping

Rather than a hard percentage threshold, multiple signals contribute to the
confidence that tracks belong together as an album:

- **Strong signals**: matching album name + album artist, sequential track
  numbers
- **Moderate signals**: matching album name alone (album artist missing or
  generic), shared folder
- **Weak signals**: filename-derived metadata, directory name as album name

The intent is to be tolerant of incomplete albums (bad rips, missing tracks,
incomplete downloads) — an album missing a couple of tracks should still be
recognized and processed as an album.

A minimum of 2 tracks is required for album grouping — single-track groups are
treated as singles. Classical albums, DJ mixes, and other formats with few
tracks are still supported since they typically have at least 2 tracks.

### 3. Multi-Disc Folder Merging

Detect disc subfolders and merge them into the parent album **at discovery
time**, before any processing.

**Detection**: Subfolders matching `Disc`, `CD`, `Disk` followed by a number
(case-insensitive, e.g., `Disc 1`, `CD2`, `disk01`). Bare names without a number
(e.g., just `CD` or `Disc`) are excluded to avoid false matches on thematic
folders like CD singles collections.

**Metadata validation**: After identifying disc subfolders by name, read album
metadata from at least one file per subfolder. Only merge if album names match
across subfolders. If album names don't match or metadata is absent, prompt the
user.

**Box set handling**: Disc subfolders with different album names are treated as
separate albums (e.g., a box set where each disc is a distinct original
release). Each gets independent album-level ReplayGain.

**Scope**: Merging applies to all operations (ReplayGain, AcoustID, SoundCheck,
encoding), not just ReplayGain.

### 4. Per-Group rsgain Invocation

rsgain processes whole directories, so mixed folders (album tracks + singles)
require per-group invocation:

- For each album group: create a temporary directory with **symlinks** to the
  group's files, run rsgain in `easy` mode against that temp directory
- For singles/outlier tracks: run rsgain in `custom` (single-file) mode
- **Cleanup must be bulletproof**: temp directories are removed in a `finally`
  block regardless of rsgain success or failure

### 5. Filename Parsing (Last Resort)

Port the beets `fromfilename` approach to TypeScript as a utility. The
algorithm:

1. Strip file extension and path
2. Try regex patterns from most to least specific against all files in a batch
3. Require all files to match the **same pattern** before accepting results
   (batch consistency = confidence)

Patterns in priority order:

1. `## - Artist - Title` (track-artist-title)
2. `Artist - Title` (artist-title)
3. `## Title` (track number + space + title, common in EAC/dBpoweramp rips)
4. `##. Title` (track-title with dot separator)
5. `##` (track number only)
6. Entire filename as title (fallback)

This data is used for filling in missing tag metadata for grouping decisions.

### 6. Compilation Detection from Full Metadata Pass

Since the new design reads metadata for all tracks during grouping, compilation
detection is a byproduct of that pass — no separate sampling step needed. Any
album group with 3+ distinct track artists (not album artist) is flagged as a
compilation. This replaces the current 3-file sampling approach, which can
misclassify when the first 3 tracks happen to share an artist.

### 7. Scope

These improvements apply uniformly to **all operations**: ReplayGain, AcoustID,
SoundCheck, and encoding. The classification is done once at discovery time.

## Files to Modify

- `src/utils/fast_discovery.ts` — disc subfolder merging, updated classification
  logic
- `src/lib/track_processor.ts` — per-group rsgain invocation with symlink temp
  directories
- New: `src/utils/filename_parser.ts` — beets-style filename parsing utility
- New: `src/utils/filename_parser.test.ts` — tests for filename parsing
- `src/utils/detect_compilations_refactored.ts` — replaced by full-pass
  compilation detection in the grouping step
- `src/commands/easy.ts` — consume updated discovery results
- `src/commands/process_collection.ts` — consume updated discovery results

## Out of Scope

- MusicBrainz lookups for metadata enrichment (separate feature)
- Fuzzy string matching for album name normalization (can be added later if
  simple normalization proves insufficient)
- Classical name inversion normalization (e.g., "Karajan, Herbert von" vs
  "Herbert von Karajan") — acknowledged as a known limitation
- Writing parsed filename data back to tags (separate decision)
- Album name suffix stripping (e.g., "(Remastered)", "[Deluxe Edition]") —
  different releases have different loudness profiles and should stay separate
