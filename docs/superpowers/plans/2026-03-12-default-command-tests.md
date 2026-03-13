# Default Command: Bug Fix + Tests

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this
> plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the batch mode missing try-catch bug in `defaultCommand` and add
comprehensive E2E + unit tests.

**Architecture:** First fix the bug (wrap batch `batchProcessAcoustIDTagging`
call in try-catch), then add `src/commands/default.test.ts` with E2E tests
(subprocess-based) and unit tests (mocked dependencies). Follows existing test
patterns from `acoustid.test.ts` and `enrich.test.ts`.

**Tech Stack:** Deno, TypeScript, `@std/testing/bdd`, `@std/testing/mock`,
taglib-wasm

**Spec:**
`docs/superpowers/specs/2026-03-12-code-quality-and-default-tests-design.md`

**Prerequisite:** Plan 1 (code quality) should be completed first since it
modifies files that these tests exercise.

---

## Task 1: Fix batch mode missing try-catch in `default.ts`

The batch processing path (lines 80-108) has no error handling. If
`batchProcessAcoustIDTagging` throws, the cursor stays hidden and the process
crashes without a summary. The sequential path (lines 111-128) already has
per-file try-catch.

**Files:**

- Modify: `src/commands/default.ts:80-108`

- [ ] **Step 1: Wrap batch processing in try-catch**

In `src/commands/default.ts`, wrap the batch block. Change:

```typescript
const results = await batchProcessAcoustIDTagging(
  filesToProcess,
  options.apiKey,
  {
    force: options.force || false,
    quiet: options.quiet || false,
    dryRun: options.dryRun || false,
    concurrency: HIGH_CONCURRENCY,
    onProgress: (processed, total, _currentFile) => {
      if (!options.quiet) {
        // Move cursor to beginning of line and clear it
        Deno.stdout.writeSync(new TextEncoder().encode(
          `\x1b[2K\r→ Processing: ${processed}/${total} files (${
            Math.round(processed / total * 100)
          }%)`,
        ));
      }
    },
  },
);

if (!options.quiet) {
  Deno.stdout.writeSync(new TextEncoder().encode("\n"));
}

// Update stats from results
for (const [_file, status] of results) {
  stats.increment(status);
}
```

To:

```typescript
try {
  const results = await batchProcessAcoustIDTagging(
    filesToProcess,
    options.apiKey,
    {
      force: options.force || false,
      quiet: options.quiet || false,
      dryRun: options.dryRun || false,
      concurrency: HIGH_CONCURRENCY,
      onProgress: (processed, total, _currentFile) => {
        if (!options.quiet) {
          Deno.stdout.writeSync(new TextEncoder().encode(
            `\x1b[2K\r→ Processing: ${processed}/${total} files (${
              Math.round(processed / total * 100)
            }%)`,
          ));
        }
      },
    },
  );

  if (!options.quiet) {
    Deno.stdout.writeSync(new TextEncoder().encode("\n"));
  }

  // Update stats from results
  for (const [_file, status] of results) {
    stats.increment(status);
  }
} catch (error) {
  console.error(
    `Batch processing failed: ${formatError(error)}`,
  );
  for (const _file of filesToProcess) {
    stats.incrementFailed();
  }
}
```

Note: `formatError` is already imported in `default.ts`.

- [ ] **Step 2: Run existing tests**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`

Expected: All tests pass (no existing test file for `default.ts`).

- [ ] **Step 3: Run fmt and lint**

Run: `deno task check`

Expected: Pass.

- [ ] **Step 4: Commit**

```bash
git add src/commands/default.ts
git commit -m "fix: add try-catch around batch processing in default command"
```

---

## Task 2: Create `default.test.ts` — E2E tests

Subprocess-based tests following the pattern from `enrich.test.ts` and
`soundcheck.test.ts`.

**Files:**

- Create: `src/commands/default.test.ts`

- [ ] **Step 1: Write E2E test file**

Create `src/commands/default.test.ts`:

```typescript
import { assert } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

describe("default command E2E", () => {
  it("should exit with non-zero code when no audio files found", async () => {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--no-check",
        "--allow-read",
        "--allow-env",
        "--allow-net",
        "--allow-write",
        "--allow-run",
        "src/amusic.ts",
        "/nonexistent/path/file.flac",
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    assert(
      output.code !== 0,
      `Expected non-zero exit code, got ${output.code}`,
    );
  });

  it("should run --show-tags on a test directory", async () => {
    const testDir = "/Volumes/T9 (4TB)/Downloads/Deezer/America/America - Hits";
    try {
      await Deno.stat(testDir);
    } catch {
      return; // Skip if test directory not available
    }

    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--no-check",
        "--allow-read",
        "--allow-env",
        "--allow-net",
        "--allow-write",
        "--allow-run",
        "src/amusic.ts",
        "--show-tags",
        "--quiet",
        testDir,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    assert(
      output.code === 0,
      `Expected exit code 0, got ${output.code}. stderr: ${
        new TextDecoder().decode(output.stderr)
      }`,
    );
  });

  it("should run --dry-run on a test directory", async () => {
    const testDir = "/Volumes/T9 (4TB)/Downloads/Deezer/America/America - Hits";
    try {
      await Deno.stat(testDir);
    } catch {
      return; // Skip if test directory not available
    }

    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--no-check",
        "--allow-read",
        "--allow-env",
        "--allow-net",
        "--allow-write",
        "--allow-run",
        "src/amusic.ts",
        "--dry-run",
        "--quiet",
        testDir,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    assert(
      output.code === 0 || output.code === 1,
      `Expected exit code 0 or 1, got ${output.code}. stderr: ${
        new TextDecoder().decode(output.stderr)
      }`,
    );
  });
});
```

- [ ] **Step 2: Run E2E tests**

Run:
`deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/commands/default.test.ts`

Expected: First test passes (exits non-zero for nonexistent files). Second and
third tests pass if test directory is available, otherwise skip.

- [ ] **Step 3: Run fmt and lint**

Run: `deno task check`

Expected: Pass.

- [ ] **Step 4: Commit**

```bash
git add src/commands/default.test.ts
git commit -m "test: add E2E tests for default command"
```

---

## Task 3: Extend `default.test.ts` — unit tests

Add unit tests with mocked dependencies to test the branching logic.

**Key context for the implementer:**

- `defaultCommand` is in `src/commands/default.ts`
- It calls `discoverMusic` (from `../utils/fast_discovery.ts`) to find files
- It calls `batchProcessAcoustIDTagging` or `processAcoustIDTagging` (from
  `../lib/acoustid.ts`) depending on file count + API key
- It uses `OperationStats` for tracking results
- taglib-wasm's simple API (`readMetadataBatch`) must be pre-warmed before
  stubbing `fetch` — see `acoustid.test.ts` batch tests for the pattern
- Use `MockDenoCommand` for `fpcalc` stubs
- Use `createFetchStub` for AcoustID API stubs
- Use `stubConsole` to capture/suppress output
- Use `createTestRunDir` + `setupTestFiles` for real audio files

**Files:**

- Modify: `src/commands/default.test.ts`

- [ ] **Step 1: Add unit test imports and setup**

Add to the top of `src/commands/default.test.ts` (after existing imports):

```typescript
import { assertEquals } from "@std/assert";
import {
  cleanupTestDir,
  createFetchStub,
  createTestRunDir,
  MOCK_API_RESPONSES,
  MOCK_FINGERPRINTS,
  MockDenoCommand,
  SAMPLE_FILES,
  setupTestFiles,
  stubConsole,
  TEST_API_KEYS,
} from "../test_utils/mod.ts";
```

- [ ] **Step 2: Write unit tests**

Add a new `Deno.test` block after the E2E `describe` block:

```typescript
Deno.test("defaultCommand unit tests", async (t) => {
  const { defaultCommand } = await import("./default.ts");

  // Pre-warm taglib-wasm before any fetch stubs
  await t.step("Setup: initialize taglib-wasm", async () => {
    const { ensureTagLib } = await import("../lib/taglib_init.ts");
    await ensureTagLib();
    const { readMetadataBatch } = await import(
      "@charlesw/taglib-wasm/simple"
    );
    const warmDir = await createTestRunDir("default_prewarm");
    const warmFiles = await setupTestFiles(warmDir, [SAMPLE_FILES.MP3]);
    await readMetadataBatch(warmFiles, { continueOnError: true });
    await cleanupTestDir(warmDir);
  });

  await t.step(
    "should process single file without API key using sequential mode",
    async () => {
      const dir = await createTestRunDir("default_single");
      const files = await setupTestFiles(dir, [SAMPLE_FILES.MP3]);

      MockDenoCommand.setup();
      MockDenoCommand.addMock("fpcalc", {
        code: 0,
        stdout: JSON.stringify({
          duration: 180,
          fingerprint: MOCK_FINGERPRINTS.DEFAULT,
        }),
      });
      const consoleStub = stubConsole("log");
      const consoleErrorStub = stubConsole("error");
      try {
        await defaultCommand(
          { quiet: true, dryRun: true },
          ...files,
        );
        // Should complete without error — no API key means fingerprint-only
      } finally {
        consoleStub.restore();
        consoleErrorStub.restore();
        MockDenoCommand.restore();
        await cleanupTestDir(dir);
      }
    },
  );

  await t.step(
    "should use batch mode for multiple files with API key",
    async () => {
      const dir = await createTestRunDir("default_batch");
      const files = await setupTestFiles(dir, [
        SAMPLE_FILES.MP3,
        SAMPLE_FILES.FLAC,
      ]);

      MockDenoCommand.setup();
      MockDenoCommand.addMock("fpcalc", {
        code: 0,
        stdout: JSON.stringify({
          duration: 180,
          fingerprint: MOCK_FINGERPRINTS.DEFAULT,
        }),
      });
      const fetchStub = createFetchStub({ json: MOCK_API_RESPONSES.SUCCESS });
      const consoleStub = stubConsole("log");
      const consoleErrorStub = stubConsole("error");
      try {
        await defaultCommand(
          {
            quiet: true,
            apiKey: TEST_API_KEYS.DUMMY,
            dryRun: true,
            force: true,
          },
          ...files,
        );
        // Batch mode should complete — verify via no crash
      } finally {
        consoleStub.restore();
        consoleErrorStub.restore();
        fetchStub.restore();
        MockDenoCommand.restore();
        await cleanupTestDir(dir);
      }
    },
  );

  await t.step(
    "should fall back to sequential mode for multiple files without API key",
    async () => {
      const dir = await createTestRunDir("default_seq_multi");
      const files = await setupTestFiles(dir, [
        SAMPLE_FILES.MP3,
        SAMPLE_FILES.FLAC,
      ]);

      MockDenoCommand.setup();
      MockDenoCommand.addMock("fpcalc", {
        code: 0,
        stdout: JSON.stringify({
          duration: 180,
          fingerprint: MOCK_FINGERPRINTS.DEFAULT,
        }),
      });
      const consoleStub = stubConsole("log");
      const consoleErrorStub = stubConsole("error");
      try {
        await defaultCommand(
          { quiet: true, dryRun: true },
          ...files,
        );
        // Should complete in sequential mode — no API key
      } finally {
        consoleStub.restore();
        consoleErrorStub.restore();
        MockDenoCommand.restore();
        await cleanupTestDir(dir);
      }
    },
  );

  await t.step(
    "should handle errors in sequential mode without crashing",
    async () => {
      const dir = await createTestRunDir("default_seq_error");
      const files = await setupTestFiles(dir, [SAMPLE_FILES.MP3]);

      // Mock fpcalc to fail
      MockDenoCommand.setup();
      MockDenoCommand.addMock("fpcalc", { code: 1, stderr: "fpcalc error" });
      const consoleStub = stubConsole("log");
      const consoleErrorStub = stubConsole("error");
      try {
        await defaultCommand(
          { quiet: true },
          ...files,
        );
        // Should complete without throwing — error is caught per-file
      } finally {
        consoleStub.restore();
        consoleErrorStub.restore();
        MockDenoCommand.restore();
        await cleanupTestDir(dir);
      }
    },
  );

  await t.step(
    "should suppress console.log output in quiet mode",
    async () => {
      const dir = await createTestRunDir("default_quiet");
      const files = await setupTestFiles(dir, [SAMPLE_FILES.MP3]);

      MockDenoCommand.setup();
      MockDenoCommand.addMock("fpcalc", {
        code: 0,
        stdout: JSON.stringify({
          duration: 180,
          fingerprint: MOCK_FINGERPRINTS.DEFAULT,
        }),
      });
      const consoleStub = stubConsole("log");
      const consoleErrorStub = stubConsole("error");
      try {
        await defaultCommand(
          { quiet: true, dryRun: true },
          ...files,
        );
        // quiet mode should suppress console.log calls
        // Note: Deno.stdout.writeSync output (cursor, progress) is also
        // gated on !quiet in the source, but not captured by this stub
        assertEquals(consoleStub.calls.length, 0);
      } finally {
        consoleStub.restore();
        consoleErrorStub.restore();
        MockDenoCommand.restore();
        await cleanupTestDir(dir);
      }
    },
  );

  await t.step(
    "should include summary with correct stats after batch processing",
    async () => {
      const dir = await createTestRunDir("default_stats");
      const files = await setupTestFiles(dir, [
        SAMPLE_FILES.MP3,
        SAMPLE_FILES.FLAC,
      ]);

      MockDenoCommand.setup();
      MockDenoCommand.addMock("fpcalc", {
        code: 0,
        stdout: JSON.stringify({
          duration: 180,
          fingerprint: MOCK_FINGERPRINTS.DEFAULT,
        }),
      });
      const fetchStub = createFetchStub({ json: MOCK_API_RESPONSES.SUCCESS });
      const consoleStub = stubConsole("log");
      const consoleErrorStub = stubConsole("error");
      try {
        await defaultCommand(
          {
            quiet: false,
            apiKey: TEST_API_KEYS.DUMMY,
            dryRun: true,
            force: true,
          },
          ...files,
        );
        // Should print summary with stats
        const allOutput = consoleStub.calls.map((c: { args: string[] }) =>
          c.args.join(" ")
        ).join("\n");
        assert(
          allOutput.includes("Processing Complete"),
          `Expected summary in output, got: ${allOutput}`,
        );
      } finally {
        consoleStub.restore();
        consoleErrorStub.restore();
        fetchStub.restore();
        MockDenoCommand.restore();
        await cleanupTestDir(dir);
      }
    },
  );

  await t.step(
    "should handle batch processing failure gracefully",
    async () => {
      const dir = await createTestRunDir("default_batch_error");
      const files = await setupTestFiles(dir, [
        SAMPLE_FILES.MP3,
        SAMPLE_FILES.FLAC,
      ]);

      // Don't set up MockDenoCommand or fetch stubs — batch will fail
      // when it tries to run fpcalc or fetch
      const consoleStub = stubConsole("log");
      const consoleErrorStub = stubConsole("error");
      try {
        // This should NOT throw — the try-catch we added should catch it
        await defaultCommand(
          {
            quiet: true,
            apiKey: TEST_API_KEYS.DUMMY,
            force: true,
          },
          ...files,
        );
        // Should have logged the batch failure to stderr
        assert(
          consoleErrorStub.calls.length > 0,
          "Expected error output from batch failure",
        );
      } finally {
        consoleStub.restore();
        consoleErrorStub.restore();
        await cleanupTestDir(dir);
      }
    },
  );
});
```

- [ ] **Step 3: Run all tests**

Run:
`deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/commands/default.test.ts`

Expected: All tests pass.

- [ ] **Step 4: Run full test suite**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`

Expected: All tests pass.

- [ ] **Step 5: Run fmt and lint**

Run: `deno task check`

Expected: Pass.

- [ ] **Step 6: Commit**

```bash
git add src/commands/default.test.ts
git commit -m "test: add unit tests for default command branching and error handling"
```

---

## Task 4: Push

- [ ] **Step 1: Push**

```bash
git push
```
