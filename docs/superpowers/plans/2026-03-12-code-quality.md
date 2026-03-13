# Code Quality: Silent Catch Blocks + File Consolidation

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this
> plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix silent error swallowing in predicate/check functions and
consolidate the duplicated fast_discovery files into one.

**Architecture:** Mechanical edits to ~10 catch blocks across 8 files, then a
file merge+rename for the fast_discovery pair. No new functionality — only
improved observability and reduced file count.

**Tech Stack:** Deno, TypeScript, taglib-wasm

**Spec:**
`docs/superpowers/specs/2026-03-12-code-quality-and-default-tests-design.md`

---

## Task 1: Fix predicate catch blocks — add error logging

These four functions silently return `false` on error. Add an `(error)` binding
and `console.error` with the file path before returning.

**Files:**

- Modify: `src/lib/soundcheck.ts:15`
- Modify: `src/lib/tagging.ts:68`
- Modify: `src/lib/tagging.ts:189`
- Modify: `src/lib/encoding.ts:139`

- [ ] **Step 1: Fix `hasSoundCheckTag` in `src/lib/soundcheck.ts`**

Change:

```typescript
} catch {
  return false;
}
```

To:

```typescript
} catch (error) {
  console.error(`Error checking SoundCheck tag for ${filePath}: ${formatError(error)}`);
  return false;
}
```

`formatError` is already imported in this file.

- [ ] **Step 2: Fix `hasAcoustIDTags` in `src/lib/tagging.ts`**

Change:

```typescript
} catch {
  return false;
}
```

(The one at line 68, inside `hasAcoustIDTags`)

To:

```typescript
} catch (error) {
  console.error(`Error checking AcoustID tags for ${filePath}: ${formatError(error)}`);
  return false;
}
```

`formatError` is already imported in this file.

- [ ] **Step 3: Fix `hasMusicBrainzTags` in `src/lib/tagging.ts`**

Change:

```typescript
} catch {
  return false;
}
```

(The one at line 189, inside `hasMusicBrainzTags`)

To:

```typescript
} catch (error) {
  console.error(`Error checking MusicBrainz tags for ${filePath}: ${formatError(error)}`);
  return false;
}
```

- [ ] **Step 4: Fix `isLosslessFormat` in `src/lib/encoding.ts`**

Change:

```typescript
} catch {
  return false;
}
```

(The one at line 139, inside `isLosslessFormat`)

To:

```typescript
} catch (error) {
  console.error(`Error checking lossless format for ${filePath}: ${formatError(error)}`);
  return false;
}
```

`formatError` is already imported in this file.

- [ ] **Step 5: Run tests to verify no regressions**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`

Expected: All tests pass. Some tests that stub these functions may now see
console.error output — that's expected and harmless.

- [ ] **Step 6: Run fmt and lint**

Run: `deno task check`

Expected: Pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/soundcheck.ts src/lib/tagging.ts src/lib/encoding.ts
git commit -m "fix: log errors in predicate functions instead of swallowing silently"
```

---

## Task 2: Include original error context in re-thrown errors

Two functions catch errors and throw/exit without the original error message.

**Files:**

- Modify: `src/lib/encoding.ts:102`
- Modify: `src/utils/console_output.ts:34`

- [ ] **Step 1: Fix `getAfconvertPath` in `src/lib/encoding.ts`**

Change:

```typescript
} catch {
  // afconvert not found in system, this is macOS-only tool
  throw new Error("afconvert not found. Audio encoding requires macOS.");
}
```

To:

```typescript
} catch (error) {
  throw new Error(`afconvert not found. Audio encoding requires macOS: ${formatError(error)}`);
}
```

- [ ] **Step 2: Fix `validateDirectory` in `src/utils/console_output.ts`**

Change:

```typescript
}).catch(() => {
  exitWithError(`Error: Directory not found at "${path}".`);
});
```

To:

```typescript
}).catch((error: unknown) => {
  exitWithError(`Error: Directory not found at "${path}": ${error instanceof Error ? error.message : String(error)}`);
});
```

Note: `console_output.ts` does not import `formatError`. Use inline error
formatting to avoid adding a dependency for one call site.

- [ ] **Step 3: Run tests**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`

Expected: All tests pass. The `validateDirectory` tests in
`src/utils/console_output.test.ts` check for `"Directory not found"` in stderr —
the added suffix won't break the `assertStringIncludes` check.

- [ ] **Step 4: Run fmt and lint**

Run: `deno task check`

Expected: Pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/encoding.ts src/utils/console_output.ts
git commit -m "fix: include original error context in re-thrown errors"
```

---

## Task 3: Log discovery/stat failures to stderr

Four catch blocks silently skip paths that fail `Deno.stat`. Add `console.error`
with the path.

**Files:**

- Modify: `src/lib/folder_processor.ts:44`
- Modify: `src/lib/replaygain.ts:44`
- Modify: `src/utils/file_discovery.ts:159`
- Modify: `src/utils/fast_discovery_refactored.ts:285`

- [ ] **Step 1: Fix `folder_processor.ts`**

Change:

```typescript
} catch {
  // Skip paths that don't exist
}
```

To:

```typescript
} catch (error) {
  console.error(`Skipping inaccessible path "${p}": ${error instanceof Error ? error.message : String(error)}`);
}
```

- [ ] **Step 2: Fix `replaygain.ts`**

Change:

```typescript
} catch {
  // If stat fails, default to custom mode on file
}
```

To:

```typescript
} catch (error) {
  console.error(`Could not stat "${targetPath}", defaulting to file mode: ${error instanceof Error ? error.message : String(error)}`);
}
```

- [ ] **Step 3: Fix `file_discovery.ts`**

Change:

```typescript
} catch {
  // Ignore inaccessible paths
}
```

To:

```typescript
} catch (error) {
  console.error(`Skipping inaccessible path "${path}": ${error instanceof Error ? error.message : String(error)}`);
}
```

- [ ] **Step 4: Fix `fast_discovery_refactored.ts`**

Change:

```typescript
} catch {
  // Skip paths that don't exist
}
```

To:

```typescript
} catch (error) {
  console.error(`Skipping inaccessible path "${path}": ${error instanceof Error ? error.message : String(error)}`);
}
```

- [ ] **Step 5: Run tests**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`

Expected: All tests pass. Tests that pass nonexistent paths may now see stderr
output — that's expected.

- [ ] **Step 6: Run fmt and lint**

Run: `deno task check`

Expected: Pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/folder_processor.ts src/lib/replaygain.ts src/utils/file_discovery.ts src/utils/fast_discovery_refactored.ts
git commit -m "fix: log discovery stat failures instead of swallowing silently"
```

---

## Task 4: Consolidate fast_discovery files

Merge `fast_discovery.ts` (types + helpers) into `fast_discovery_refactored.ts`,
then rename to `fast_discovery.ts`.

**Files:**

- Delete: `src/utils/fast_discovery.ts`
- Modify+Rename: `src/utils/fast_discovery_refactored.ts` →
  `src/utils/fast_discovery.ts`
- Delete: `src/utils/fast_discovery.test.ts`
- Modify+Rename: `src/utils/fast_discovery_refactored.test.ts` →
  `src/utils/fast_discovery.test.ts`

- [ ] **Step 1: Copy types and helpers from `fast_discovery.ts` into
      `fast_discovery_refactored.ts`**

Move the following from `fast_discovery.ts` into the top of
`fast_discovery_refactored.ts` (after the existing imports):

- `MusicDiscovery` interface (lines 11-26) — **must be exported**
- `SkippedFile` interface (lines 28-31) — **must be exported**
- `DiscoveryOptions` interface (find it in the file) — **must be exported**
- `ScanResult` interface (find it in the file) — **must be exported** (tests
  import it)
- `DirInfo` type (if present)
- `buildScanResult` function — **must be exported** (tests import it)
- `classifyDirectories` function — **must be exported** (tests import it)
- `parallelFileScan` function — check if used; if only used by the old shim's
  re-export and nowhere else, **delete it** instead of moving (dead code)
- `parallelCheckMpeg4Codecs` function — check if used by the refactored file; if
  not, **delete it** instead of moving (dead code after merge)

Also copy any imports from `fast_discovery.ts` that the moved code depends on
(e.g., `readMetadataBatch` from `@charlesw/taglib-wasm/simple`).

- [ ] **Step 2: Remove self-imports from `fast_discovery_refactored.ts`**

Remove the import block:

```typescript
import {
  buildScanResult,
  classifyDirectories,
  type DiscoveryOptions,
  type MusicDiscovery,
  type SkippedFile,
} from "./fast_discovery.ts";
```

And remove the re-export:

```typescript
export type { SkippedFile } from "./fast_discovery.ts";
```

Instead, export `SkippedFile` directly from its definition in the merged file.

- [ ] **Step 3: Rename `discoverMusicRefactored` to `discoverMusic`**

In the merged `fast_discovery_refactored.ts`, find all occurrences of
`discoverMusicRefactored` and rename to `discoverMusic`.

- [ ] **Step 4: Delete old `fast_discovery.ts`**

Remove the file. All its content has been merged.

- [ ] **Step 5: Rename `fast_discovery_refactored.ts` to `fast_discovery.ts`**

```bash
git mv src/utils/fast_discovery_refactored.ts src/utils/fast_discovery.ts
```

- [ ] **Step 6: Update command imports**

Check all 6 commands. They import `discoverMusic` from
`"../utils/fast_discovery.ts"` — path is unchanged after rename, so they should
work. Verify no command imports `discoverMusicRefactored` directly.

Commands: `src/commands/default.ts`, `src/commands/easy.ts`,
`src/commands/encode.ts`, `src/commands/process.ts`,
`src/commands/soundcheck.ts`, `src/commands/x-ray.ts`

- [ ] **Step 7: Merge test files**

Copy the test cases from `src/utils/fast_discovery.test.ts` (tests for
`buildScanResult` and `classifyDirectories`) into
`src/utils/fast_discovery_refactored.test.ts`. Update imports to point to the
new `./fast_discovery.ts` path.

- [ ] **Step 8: Delete old test file and rename**

```bash
rm src/utils/fast_discovery.test.ts
git mv src/utils/fast_discovery_refactored.test.ts src/utils/fast_discovery.test.ts
```

- [ ] **Step 9: Run tests**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`

Expected: All tests pass.

- [ ] **Step 10: Run fmt and lint**

Run: `deno task check`

Expected: Pass.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "refactor: consolidate fast_discovery files into single module"
```

---

## Task 5: Push

- [ ] **Step 1: Push**

```bash
git push
```
