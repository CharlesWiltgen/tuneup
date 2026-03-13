# Code Quality Fixes and Default Command Tests

## Context

After completing the testing gap analysis and adding 10 new test files, three
gaps remain: silent error swallowing in predicate/check functions, redundant
fast_discovery files, and missing tests for the main `default.ts` command.

## Plan 1: Code Quality — Silent Catch Blocks + File Consolidation

### Silent Catch Block Fixes

**Principle**: Predicate/check functions should log errors before returning
defaults. Cleanup catches (temp file deletion, cursor restoration) stay silent.
Discovery/stat failures log to stderr with path context.

Line numbers below refer to the `catch` keyword location, not the function
definition.

#### Add error logging (predicates/check functions)

| File (catch line)          | Function             | Current                  | Change                                                  |
| -------------------------- | -------------------- | ------------------------ | ------------------------------------------------------- |
| `src/lib/soundcheck.ts:15` | `hasSoundCheckTag`   | `catch { return false }` | Add `(error)` binding, log with file path, return false |
| `src/lib/tagging.ts:68`    | `hasAcoustIDTags`    | `catch { return false }` | Add `(error)` binding, log with file path, return false |
| `src/lib/tagging.ts:189`   | `hasMusicBrainzTags` | `catch { return false }` | Add `(error)` binding, log with file path, return false |
| `src/lib/encoding.ts:139`  | `isLosslessFormat`   | `catch { return false }` | Add `(error)` binding, log with file path, return false |

#### Include original error context in re-thrown errors

| File (catch line)                | Function            | Current                                            | Change                                                     |
| -------------------------------- | ------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `src/lib/encoding.ts:102`        | `getAfconvertPath`  | Catches original error, throws new without context | Include original error message in thrown error             |
| `src/utils/console_output.ts:34` | `validateDirectory` | `.catch(() => exitWithError(...))`                 | Add `(error)` parameter, include original error in message |

#### Log to stderr (discovery/stat failures)

| File (catch line)                            | Location     | Current            | Change                               |
| -------------------------------------------- | ------------ | ------------------ | ------------------------------------ |
| `src/lib/folder_processor.ts:44`             | stat failure | Comment-only catch | Log skipped path to stderr           |
| `src/lib/replaygain.ts:44`                   | stat failure | Comment-only catch | Log with file path context to stderr |
| `src/utils/file_discovery.ts:159`            | stat failure | Comment-only catch | Log skipped path to stderr           |
| `src/utils/fast_discovery_refactored.ts:285` | stat failure | Comment-only catch | Log skipped path to stderr           |

#### Leave silent (acceptable)

| File                         | Location                               | Reason                                                |
| ---------------------------- | -------------------------------------- | ----------------------------------------------------- |
| `src/lib/soundcheck.ts:78`   | `Deno.remove(tempDir).catch(() => {})` | Cleanup — temp dir may already be gone                |
| `src/lib/replaygain.ts:88`   | `Deno.remove(outputFile)` catch        | Cleanup — temp CSV may already be gone                |
| `src/commands/encode.ts:117` | `Deno.consoleSize()` catch             | Expected — returns Infinity fallback for piped output |
| `src/commands/encode.ts:224` | `Deno.stat(outputPath)` catch          | Expected — file not existing is the normal case       |
| `src/cli/cli.ts:20`          | `.env` loading catch                   | Expected — most users won't have a .env file          |

### File Consolidation

`fast_discovery.ts` contains types (`MusicDiscovery`, `SkippedFile`,
`DiscoveryOptions`, `ScanResult`) and helper functions (`buildScanResult`,
`classifyDirectories`, `parallelFileScan`, `parallelCheckMpeg4Codecs`) that
`fast_discovery_refactored.ts` imports and depends on. The bottom of
`fast_discovery.ts` re-exports `discoverMusicRefactored as discoverMusic`. This
is a **merge** operation, not a simple delete-and-rename.

Steps:

1. **Merge** the types and helper functions from `fast_discovery.ts` into
   `fast_discovery_refactored.ts` (move `MusicDiscovery`, `SkippedFile`,
   `DiscoveryOptions`, `ScanResult`, `DirInfo`, `buildScanResult`,
   `classifyDirectories`, `parallelFileScan`, `parallelCheckMpeg4Codecs`)
2. Remove the self-imports from `fast_discovery_refactored.ts` (it currently
   imports these from `./fast_discovery.ts`)
3. Rename `discoverMusicRefactored` to `discoverMusic` within the merged file
4. Delete the old `fast_discovery.ts`
5. Rename `fast_discovery_refactored.ts` to `fast_discovery.ts`
6. Update imports in all 6 commands (`default.ts`, `easy.ts`, `encode.ts`,
   `process.ts`, `soundcheck.ts`, `x-ray.ts`) — path stays the same after
   rename, so only needed if any import `discoverMusicRefactored` directly
7. Update the import of `detectCompilationsRefactored` from
   `./detect_compilations_refactored.ts` within the merged file (path unchanged
   but verify after merge)
8. **Merge** tests from `fast_discovery.test.ts` into
   `fast_discovery_refactored.test.ts` (the helpers tested in the old file are
   still active code)
9. Delete old `fast_discovery.test.ts`
10. Rename `fast_discovery_refactored.test.ts` to `fast_discovery.test.ts`
11. Update any test imports that referenced the refactored path

## Plan 2: Testing + Fixes for `default.ts`

### Bug Fix: Batch mode missing try-catch

`defaultCommand` calls `batchProcessAcoustIDTagging` (around line 80) without a
try-catch. If the batch function throws, the cursor remains hidden and the
process crashes without printing a summary. Sequential mode already has per-file
try-catch.

**Fix**: Wrap the batch processing block in try-catch. On error, log to stderr
with `formatError`, mark all remaining files as failed in stats. The existing
finally block at the end of `defaultCommand` restores the cursor.

### Test File: `src/commands/default.test.ts`

#### E2E Tests (subprocess-based)

| Test                                           | Assertion                        |
| ---------------------------------------------- | -------------------------------- |
| Exits with error when no audio files found     | Non-zero exit code               |
| `--show-tags` displays tags without processing | Exit 0, output contains tag info |
| `--dry-run` completes without writing          | Exit 0                           |

E2E tests that require the external test directory skip when unavailable.

#### Unit Tests (mocked)

| Test                                                    | What it verifies                            |
| ------------------------------------------------------- | ------------------------------------------- |
| Single file without API key uses sequential processing  | `processAcoustIDTagging` called             |
| Multiple files with API key uses batch processing       | `batchProcessAcoustIDTagging` called        |
| Multiple files without API key falls back to sequential | No batch when API key missing               |
| Sequential mode catches per-file errors and continues   | Other files still processed                 |
| Batch mode catches errors and restores cursor           | Error isolation for batch path              |
| Stats accumulate mixed results correctly                | Summary shows correct counts                |
| Progress callback receives correct counts in batch mode | `onProgress(processed, total, file)` values |
| Quiet mode suppresses all console output                | No stdout/stderr when quiet=true            |

#### Test Infrastructure

Uses existing test utilities: `MockDenoCommand`, `createFetchStub`,
`stubConsole`, `createTestRunDir`, `setupTestFiles`. Pre-warms taglib-wasm
before fetch stubs are installed (same pattern as `acoustid.test.ts` batch
tests).

## Implementation Sequence

1. Plan 1: Silent catch block fixes (mechanical, no new files)
2. Plan 1: File consolidation (merge + rename + import updates)
3. Verify: `deno test`, `deno task check`
4. Plan 2: Add try-catch to batch mode in `default.ts`
5. Plan 2: Write `default.test.ts` with E2E and unit tests
6. Verify: `deno test`, `deno task check`
7. Commit and push

## Verification

After each phase:

```bash
deno test --allow-read --allow-run --allow-write --allow-env --allow-net
deno task check
```
