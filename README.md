# tuneup

`tuneup` is a command-line music utility for the care and feeding of local music
libraries. It handles the full lifecycle of music metadata: fingerprinting,
identification, enrichment, volume normalization, encoding, and quality checks.

## Get Started

```bash
brew tap CharlesWiltgen/tap
brew install tuneup
```

To update to the latest version:

```bash
brew upgrade tuneup
```

See [Installation](#installation) for other options including pre-built binaries
and building from source.

## Features

- **AcoustID Fingerprinting** — Generates and embeds AcoustID fingerprints and
  IDs, uniquely identifying each track for metadata lookup.
- **MusicBrainz Enrichment** — Enriches metadata (title, artist, album, year,
  genre, track/disc numbers) from MusicBrainz using an album-level scoring
  model. Interactive by default — shows a diff and asks before overwriting any
  tags.
- **ReplayGain** — Calculates and embeds ReplayGain metadata so players can
  normalize volume across albums mastered at different loudness levels.
- **Apple SoundCheck** — Generates and embeds Apple SoundCheck (ITUNNORM)
  metadata, Apple's equivalent of ReplayGain.
- **High-quality AAC Encoding** — On macOS, encodes lossless audio (FLAC, WAV,
  ALAC) to audibly-transparent `.m4a` files using Apple's Core Audio framework.
- **Library Linting** — Scans a music library for tagging problems (missing
  tags, inconsistent metadata, suspicious durations/bitrates), file integrity
  issues (invalid headers, extension mismatches), and album-level
  inconsistencies (track gaps, mixed formats/sample rates).
- **Unified Processing** — Process tracks with multiple operations (encoding,
  ReplayGain, AcoustID, SoundCheck) in a single pass.
- **Intelligent Folder Processing** — Automatically treats folders as albums,
  with support for processing entire music libraries organized by artist/album
  hierarchy.
- **Parallel Processing** — Uses worker pools to process multiple tracks
  concurrently for improved performance.

### AcoustID Processing Details

The script queries the AcoustID web service using the generated fingerprint and
an AcoustID API key. You can provide your API key via the `--api-key <key>`
option or by setting the `ACOUSTID_API_KEY` environment variable:

```bash
# Set your key in the environment (once per session)
export ACOUSTID_API_KEY=your_api_key_here

# Then run without repeating the flag:
tuneup <file1> [file2 ...]
```

Alternatively, you can pass the key directly:

```bash
tuneup --api-key $ACOUSTID_API_KEY <file1> [file2 ...]
```

It retrieves and embeds the `ACOUSTID_ID` (the UUID from the AcoustID database)
and MusicBrainz recording IDs. To enrich tags with full metadata (title, artist,
album, etc.), run `tuneup enrich` after AcoustID processing.

## Dependencies

`tuneup` requires only Deno to run. All audio metadata operations are handled by
the built-in taglib-wasm library, and the required external tools are included
as vendor binaries:

- **Deno**: The runtime for the script. Installation instructions can be found
  at [https://deno.land/](https://deno.land/).
- **taglib-wasm**: Universal audio metadata library (included as npm
  dependency). Handles all tag reading/writing operations for MP3, M4A/MP4,
  FLAC, OGG, WAV, and more.
- **fpcalc**: Used for generating AcoustID fingerprints. Native binaries are
  included in the `vendor` directory for all supported platforms.
- **rsgain**: Used for ReplayGain analysis and metadata tagging. Native binaries
  are included in the `vendor` directory for all supported platforms.

No external tools need to be installed - everything is self-contained within the
project.

## Installation

### Option 1: Homebrew (macOS and Linux)

Once the Homebrew tap is set up, you can install tuneup with:

```bash
brew tap CharlesWiltgen/tap
brew install tuneup
```

To update to the latest version:

```bash
brew update
brew upgrade tuneup
```

### Option 2: Download Pre-built Binary

Download the latest release for your platform from the
[Releases](https://github.com/CharlesWiltgen/tuneup/releases) page. Pre-built
binaries are available for:

- macOS (Apple Silicon M1/M2/M3 and Intel)
- Linux (x86_64)
- Windows (x86_64)

Extract the archive and optionally move the binary to a location in your PATH.

### Option 3: Build from Source

1. Ensure Deno is installed.
2. Clone this repository:
   ```bash
   git clone https://github.com/CharlesWiltgen/tuneup.git
   cd tuneup
   ```
3. (Optional) Build a standalone executable (includes the platform-specific
   vendor binaries):

   ```bash
   deno task build
   ```

> **Note (macOS)**\
> The build task will automatically remove any quarantine attributes and perform
> an ad-hoc code signing of the generated `dist/tuneup` binary so that the
> embedded vendor tools (`fpcalc`/`rsgain`) can be executed without encountering
> "No such file or directory (os error 2)".

## Usage

> **Note:** If you've built a standalone executable using `deno task build`, you
> can run it directly from `dist/tuneup`:

```bash
./dist/tuneup [options] <file1> [file2 ...]
```

To use `tuneup`, navigate to the directory containing `tuneup.ts` and run the
script using `deno run`. Provide the paths to the audio files you want to
process as arguments.

**Syntax:**

```bash
deno run --allow-read --allow-run --allow-write --allow-env --allow-net tuneup.ts [options] <file1> [file2 ...]
```

- `--allow-read`: Required to read audio files.
- `--allow-run`: Required to execute vendor binaries (`fpcalc` and `rsgain`).
- `--allow-write`: Required to write updated audio files with new tags.
- `--allow-env`: Required to read environment variables like `ACOUSTID_API_KEY`.
- `--allow-net`: Required for AcoustID API lookups (optional, only needed when
  using API key).
- `<file1> [file2 ...]`: One or more paths to audio files to be processed.

**Options:**

- `-f, --force`: Force recalculation and saving of the AcoustID fingerprint even
  if existing AcoustID tags are found in the file. Without this flag, files with
  existing tags will be skipped.
- `-q, --quiet`: Suppress informational output during processing. Error messages
  and the final summary report will still be displayed.
- `--show-tags`: Display existing `ACOUSTID_ID` and `ACOUSTID_FINGERPRINT` tags
  for the specified files and then exit. This option does not modify files or
  perform any online lookups.
- `--dry-run`: Simulate the entire tagging process, including fingerprint
  generation and AcoustID API lookups (if an `--api-key` is provided), but do
  not make any actual changes to the audio files. This is useful for testing or
  previewing what actions would be performed. A notice will be shown in the
  summary report if a dry run was performed.

After processing all files, a summary report is displayed, showing the number of
files successfully processed, skipped, and failed.

## Commands

### Default Command: AcoustID Processing

Process files to generate and embed AcoustID fingerprints:

```bash
tuneup [options] <files...>
```

### Easy Mode: Process Music Library

Process a music library organized by album folders. Calculates ReplayGain for
each album and AcoustID for each track:

```bash
tuneup easy <library> [options]
```

### Process Command: Unified Processing

Process audio files with multiple operations in a single pass. By default,
folders are treated as albums:

```bash
tuneup process [options] <paths...>
```

Options:

- `--encode`: Encode files to M4A/AAC format
- `--replay-gain`: Calculate and apply ReplayGain metadata
- `--acoust-id`: Generate and embed AcoustID fingerprints
- `--soundcheck`: Generate and embed Apple SoundCheck (ITUNNORM) data
- `--singles <patterns...>`: Folder patterns to treat as singles instead of
  albums
- `-o, --output-dir <dir>`: Output directory for encoded files
- `--force-lossy-transcodes`: Allow encoding from lossy formats (not
  recommended)

### Enrich Command: MusicBrainz Metadata Enrichment

Enrich your music library with metadata from MusicBrainz. Requires files to
already have MusicBrainz recording IDs (run `tuneup process --acoust-id` first).

```bash
tuneup enrich <path>
```

**By default, `enrich` is interactive.** For each album, it shows a diff of
every tag it wants to change and asks for your confirmation before writing
anything. No tags are ever overwritten without your explicit approval.

Options:

- `--dangerously-overwrite-tags`: Skip all confirmation prompts and apply every
  proposed change automatically. This will overwrite existing metadata across
  your entire library without asking. Use with extreme caution.
- `--dry-run`: Show what would change without writing anything
- `-f, --force`: Re-enrich files that were previously enriched
- `-q, --quiet`: Suppress progress output

```bash
# Interactive (default) — review and approve each album
tuneup enrich /path/to/music/library

# Preview changes without writing anything
tuneup enrich --dry-run /path/to/music/library

# Unattended — overwrites all tags without prompting (use with caution)
tuneup enrich --dangerously-overwrite-tags /path/to/music/library
```

### Encode Command: High-Quality AAC Encoding

Encode lossless audio files to M4A/AAC format (macOS only):

```bash
tuneup encode [options] <files...>
```

Options:

- `-o, --output-dir <dir>`: Output directory for encoded files
- `--force-lossy-transcodes`: Allow encoding from lossy formats (MP3, OGG)

### SoundCheck Command: Apple Volume Normalization

Generate and embed Apple SoundCheck (ITUNNORM) metadata:

```bash
tuneup soundcheck [options] <files...>
```

Options:

- `-f, --force`: Force reprocessing even if ITUNNORM already exists
- `--dry-run`: Simulate processing without writing tags
- `-q, --quiet`: Suppress progress output

### Lint Command: Library Quality Checks

Scan a music library for tagging problems, inconsistencies, and file integrity
issues:

```bash
tuneup lint [options] <path>
```

Options:

- `--deep`: Enable media integrity checks (header validation, extension mismatch
  detection)
- `--severity <level>`: Minimum severity to report: `error`, `warning`
  (default), `info`
- `--json`: Output as JSONL (one issue per line, summary on last line)
- `-q, --quiet`: Suppress progress output

Lint checks include: missing tags (title, artist, album, year, genre, track
number, cover art, ReplayGain, AcoustID), suspicious audio properties (duration,
bitrate), and album-level issues (inconsistent artist/year, track number gaps,
duplicates, missing disc numbers, mixed formats/sample rates).

### X-ray Command: Library Structure Inspection

Inspect the music library structure without processing files (useful for
debugging):

```bash
tuneup x-ray [options] <files...>
```

Options:

- `--for-encoding`: Validate MPEG-4 codecs as if preparing for encoding
- `--singles <patterns...>`: Folder patterns to treat as singles
- `--debug`: Enable debug output

## Folder Processing Behavior

By default, `tuneup` intelligently processes folders:

- **Leaf folders** (containing audio files but no subfolders) are treated as
  **albums**
- **Parent folders** (containing subfolders) have each subfolder processed as
  potential albums
- **Singles override**: Use `--singles` patterns to treat specific folders as
  collections of individual tracks

This makes it easy to process entire music libraries organized by artist/album
hierarchy.

### Album/Single Detection Rules

`tuneup` uses both directory structure and metadata to determine whether tracks
should be processed as albums or singles:

**Core Principle**: An album is a group of 2+ audio files that share the same
album tag.

**Detection Rules**:

1. **Album Requirements**
   - Must have 2+ files with identical album tags (non-empty)
   - Artist can vary (supports compilation albums)
   - Files must be in the same directory

2. **Single Classification** A file is treated as a single if:
   - It has no album tag (empty/missing)
   - It's the only file with that album tag in its directory
   - It's in a directory but doesn't meet album requirements

3. **Directory Scanning**
   - When scanning a directory, files are grouped by album tag
   - Each group with 2+ files becomes an album
   - Remaining files become singles

4. **Special Cases**
   - **Mixed content**: A directory can contain multiple albums AND singles
   - **Compilation albums**: Different artists + same album tag = valid album

**Example Scenarios**:

```
/Music/Album1/
  ├── track1.mp3 (album: "Greatest Hits")
  ├── track2.mp3 (album: "Greatest Hits")
  └── track3.mp3 (album: "Greatest Hits")
  → Result: 1 album with 3 tracks

/Music/Mixed/
  ├── song1.mp3 (album: "Album A")
  ├── song2.mp3 (album: "Album A")
  ├── song3.mp3 (album: "Album B")
  ├── song4.mp3 (no album tag)
  └── song5.mp3 (album: "Album C")
  → Result: 1 album ("Album A" with 2 tracks) + 3 singles

/Music/Singles/
  ├── track1.mp3 (album: "Solo Album")
  └── track2.mp3 (album: "Different Album")
  → Result: 2 singles
```

## Examples

1. **Generate and add fingerprint to an audio file:**

   ```bash
   tuneup "./path/to/your/music file.mp3"
   ```

2. **Process an album folder:** Calculate and embed ReplayGain metadata and
   generate AcoustID fingerprints for all tracks in a single folder:

   ```bash
   tuneup process --replay-gain --acoust-id "/path/to/album_folder"
   ```

3. **Process multiple artists with some singles folders:**

   ```bash
   tuneup process --encode --replay-gain --acoust-id \
     --singles "Singles" --singles "Compilations" \
     "/Music/Prince" "/Music/Madonna" "/Music/Singles"
   ```

4. **Encode lossless files to AAC, preserving folder structure:**

   ```bash
   tuneup encode -o "/Music/AAC" "/Music/FLAC"
   ```

5. **Preview encoding without writing files:**

   ```bash
   tuneup encode --dry-run "/Music/FLAC/Artist/Album"
   ```

6. **Easy Mode: Process entire music library:**

   ```bash
   tuneup easy /path/to/music/library --api-key $ACOUSTID_API_KEY
   ```

7. **Process with unified command for maximum efficiency:**

   ```bash
   # Process everything in one pass: encode to M4A, calculate ReplayGain, and add AcoustID
   tuneup process --encode --replay-gain --acoust-id \
     --output-dir "/Music/Encoded" \
     "/Music/Lossless/Artist1" "/Music/Lossless/Artist2"
   ```

8. **Enrich metadata from MusicBrainz** (interactive — review each album):

   ```bash
   tuneup enrich /path/to/music/library
   ```

9. **Preview enrichment changes without writing:**

   ```bash
   tuneup enrich --dry-run /path/to/music/library
   ```

10. **Re-enrich previously enriched files:**

    ```bash
    tuneup enrich --force /path/to/music/library
    ```

11. **Check a library for tagging problems:**

    ```bash
    tuneup lint /path/to/music/library
    tuneup lint --deep /path/to/music/library  # includes file integrity checks
    ```

## Contributing

Contributions are welcome! If you'd like to help improve `tuneup` or add new
features, please feel free to:

- Report a bug or suggest a feature by opening an issue.
- Check existing issues for ideas or ongoing discussions.
- Submit a pull request with your improvements.

When contributing code, please ensure you run `deno fmt` and `deno lint` before
submitting.

### Development

```bash
# Run from source
deno task start [options] <files>

# Run tests
deno task test

# Check formatting and linting
deno task check

# Fix formatting
deno task fix

# Build executable
deno task build

# Bump version (patch, minor, major, or specific version)
deno task bump patch
```

### Releases

Releases are automated via GitHub Actions. See [RELEASING.md](docs/RELEASING.md)
for details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file
for details.
