# Pipeline Dependency Injection & Testing

**Date:** 2026-03-23
**Status:** Approved

## Problem

`runPipeline` is a ~460-line orchestrator that directly imports 13+ external
dependencies (AcoustID API, MusicBrainz API, Cover Art Archive, fpcalc binary,
taglib-wasm, stdin for review, filesystem for organize). Every call is a
hardcoded import, making the function untestable without hitting real APIs,
binaries, and the filesystem.

The pipeline is tuneup's most complex feature (9 stages) and has zero direct
tests. Only `buildEnrichmentDiff` — a pure helper — is covered.

## Solution

Introduce a `PipelineServices` type that encapsulates every external boundary.
`runPipeline` accepts an optional `services` parameter defaulting to real
implementations. Tests pass mock services — no filesystem, no network, no
binaries.

This follows the `Prompter` DI pattern already established in
`src/commands/interactive.ts`.

## Design

### `PipelineServices` type

```ts
type PipelineServices = {
  discoverMusic: typeof discoverMusic;
  generateFingerprint: typeof generateFingerprint;
  getAudioDuration: typeof getAudioDuration;
  lookupFingerprint: typeof lookupFingerprint;
  fetchRecording: typeof fetchRecording;
  getComprehensiveMetadata: typeof getComprehensiveMetadata;
  fetchCoverArt: typeof fetchCoverArt;
  runBatchReview: typeof runBatchReview;
  openAudioFile: (path: string) => Promise<AudioFileHandle | null>;
  moveFile: typeof moveFile;
};
```

### `AudioFileHandle` interface

Extracts the taglib-wasm surface that `runPipeline` actually uses:

```ts
type AudioFileHandle = {
  tag(): TagHandle;
  setProperty(key: string, value: string): void;
  getPictures(): unknown[];
  setPictures(pics: CoverArtInput[]): void;
  saveToFile(): Promise<void>;
  dispose(): void;
};

type TagHandle = {
  setTitle(v: string): void;
  setArtist(v: string): void;
  setAlbum(v: string): void;
  setYear(v: number): void;
  setGenre(v: string): void;
  setTrack(v: number): void;
};

type CoverArtInput = {
  data: Uint8Array;
  mimeType: string;
  type: string;
  description: string;
};
```

### Signature change

```ts
// Before
async function runPipeline(options: PipelineOptions): Promise<PipelineReport>

// After
async function runPipeline(
  options: PipelineOptions,
  services?: Partial<PipelineServices>,
): Promise<PipelineReport>
```

Internally merges with defaults: `const svc = { ...defaultServices(), ...services }`.
Zero breaking change — existing callers pass nothing and get real implementations.

### `defaultServices()` factory

Wraps real implementations. The `openAudioFile` default handles
`ensureTagLib()` + `taglib.open()` so the pipeline body never touches
taglib-wasm directly.

### Test cases

All in `src/lib/pipeline.test.ts`, using mock services that return canned data.

| # | Scenario | Key assertion |
|---|----------|--------------|
| 1 | Empty library | Report all zeros |
| 2 | High-confidence match | Auto-enriches, tags written, art embedded |
| 3 | Medium-confidence → accept | Queued for review, applied after accept |
| 4 | Medium-confidence → skip | Queued for review, NOT applied |
| 5 | Low-confidence match | No enrichment, no art |
| 6 | No fingerprint match | Counted as unresolved |
| 7 | overwrite=false | Existing tags preserved |
| 8 | overwrite=true | Existing tags replaced |
| 9 | dryRun=true | Report populated, no write calls |
| 10 | organize=true | moveFile called with correct paths |
| 11 | noArt=true | fetchCoverArt never called |
| 12 | Duplicate detection | duplicatesFound > 0 in report |

### Files changed

| File | Change |
|------|--------|
| `src/lib/pipeline.ts` | Add types, refactor to use injected services |
| `src/lib/pipeline.test.ts` | Add 12 test cases with mock services |

No other files change.

## Future: Electron GUI

The `PipelineServices` seam means a GUI app passes its own service
implementations (e.g., `runBatchReview` routes to a React dialog instead of
stdin). Progress reporting (`onProgress` callback) is out of scope here but is a
smaller follow-up change to `PipelineOptions`.
