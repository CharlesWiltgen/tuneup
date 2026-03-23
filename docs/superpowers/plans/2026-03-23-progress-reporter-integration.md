# ProgressReporter Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all raw ANSI progress patterns across 9 commands with a unified `ProgressReporter`, absorb `EncodingSpinner`, and fix display inconsistencies.

**Architecture:** Extend `ProgressReporter` with configurable stream, discovery callback factory, and spinner support. Wire it into each command, then delete `EncodingSpinner`.

**Tech Stack:** Deno, TypeScript, `@std/testing/bdd`

**Spec:** `docs/superpowers/specs/2026-03-23-progress-reporter-integration-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/utils/progress_reporter.ts` | Unified progress display (counted, discovery, spinner) |
| `src/utils/progress_reporter.test.ts` | Tests for all reporter methods |
| `src/utils/spinner.ts` | **Deleted** — absorbed into ProgressReporter |
| `src/commands/process.ts` | Uses reporter for discovery + track progress |
| `src/commands/default.ts` | Uses reporter for discovery + batch AcoustID |
| `src/commands/show_tags_folder.ts` | Uses reporter for metadata reading |
| `src/commands/encode.ts` | Uses reporter spinner + discovery |
| `src/commands/easy.ts` | Uses reporter for discovery + album progress |
| `src/commands/soundcheck.ts` | Uses reporter for discovery + processing |
| `src/commands/process_collection.ts` | Uses reporter for track progress |
| `src/commands/x-ray.ts` | Uses reporter for discovery |
| `src/commands/lint.ts` | Uses reporter with stderr stream |

---

### Task 1: Add `stream` option to ProgressReporter

**Files:**
- Modify: `src/utils/progress_reporter.ts`
- Modify: `src/utils/progress_reporter.test.ts`

- [ ] **Step 1: Write failing test for stderr stream**

```ts
it("should write to stderr when stream is stderr", () => {
  const chunks: Uint8Array[] = [];
  const originalWrite = Deno.stderr.writeSync;
  Deno.stderr.writeSync = (p: Uint8Array) => {
    chunks.push(p.slice());
    return p.length;
  };
  // Suppress stdout to avoid cursor noise
  const originalStdout = Deno.stdout.writeSync;
  Deno.stdout.writeSync = (p: Uint8Array) => p.length;

  try {
    const reporter = new ProgressReporter({ stream: "stderr" });
    reporter.update(1, 10, "Scanning");
    reporter.dispose();

    const output = new TextDecoder().decode(
      new Uint8Array(chunks.flatMap((c) => [...c])),
    );
    assertEquals(output.includes("1/10"), true);
  } finally {
    Deno.stderr.writeSync = originalWrite;
    Deno.stdout.writeSync = originalStdout;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read --allow-run --allow-write --allow-env src/utils/progress_reporter.test.ts --filter "stderr"`
Expected: FAIL — `ProgressReporterOptions` doesn't accept `stream`

- [ ] **Step 3: Implement stream option**

In `progress_reporter.ts`:
- Add `stream?: "stdout" | "stderr"` to `ProgressReporterOptions`
- Add private `writer` property: `private writer = this.options.stream === "stderr" ? Deno.stderr : Deno.stdout`
- Replace all `Deno.stdout.writeSync` calls with `this.writer.writeSync`

- [ ] **Step 4: Run tests to verify all pass**

Run: `deno test --allow-read --allow-run --allow-write --allow-env src/utils/progress_reporter.test.ts`
Expected: All tests pass including new one

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/utils/progress_reporter.ts src/utils/progress_reporter.test.ts
deno lint src/utils/progress_reporter.ts src/utils/progress_reporter.test.ts
git add src/utils/progress_reporter.ts src/utils/progress_reporter.test.ts
git commit -m "feat(progress): add configurable stream option to ProgressReporter"
```

---

### Task 2: Add `discoveryCallback()` method

**Files:**
- Modify: `src/utils/progress_reporter.ts`
- Modify: `src/utils/progress_reporter.test.ts`

- [ ] **Step 1: Write failing tests for discoveryCallback**

```ts
describe("discoveryCallback", () => {
  it("should return a function that formats discovery progress", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter();
      const cb = reporter.discoveryCallback();
      cb("scan", 42);
      reporter.dispose();
    });

    assertEquals(output.includes("→ scan: 42 files"), true);
  });

  it("should include total when provided", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter();
      const cb = reporter.discoveryCallback();
      cb("classify", 5, 10);
      reporter.dispose();
    });

    assertEquals(output.includes("→ classify: 5/10 files"), true);
  });

  it("should be silent when quiet", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter({ quiet: true });
      const cb = reporter.discoveryCallback();
      cb("scan", 42);
    });

    assertEquals(output, "");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read --allow-run --allow-write --allow-env src/utils/progress_reporter.test.ts --filter "discoveryCallback"`
Expected: FAIL — `discoveryCallback` not a function

- [ ] **Step 3: Implement discoveryCallback**

Add to `ProgressReporter`:

```ts
discoveryCallback(): (phase: string, current: number, total?: number) => void {
  return (phase: string, current: number, total?: number) => {
    if (this.options.quiet) return;
    const count = total ? `${current}/${total}` : `${current}`;
    const output = `\x1b[2K\r→ ${phase}: ${count} files`;
    this.writer.writeSync(this.encoder.encode(output));
  };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `deno test --allow-read --allow-run --allow-write --allow-env src/utils/progress_reporter.test.ts`
Expected: All pass

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/utils/progress_reporter.ts src/utils/progress_reporter.test.ts
deno lint src/utils/progress_reporter.ts src/utils/progress_reporter.test.ts
git add src/utils/progress_reporter.ts src/utils/progress_reporter.test.ts
git commit -m "feat(progress): add discoveryCallback method to ProgressReporter"
```

---

### Task 3: Add spinner methods

**Files:**
- Modify: `src/utils/progress_reporter.ts`
- Modify: `src/utils/progress_reporter.test.ts`

- [ ] **Step 1: Write failing tests for spinner**

```ts
describe("spinner", () => {
  it("should start and stop spinner without error", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter();
      reporter.startSpinner("Working...");
      reporter.stopSpinner("Done");
      reporter.dispose();
    });

    assertEquals(output.includes("Done"), true);
  });

  it("should be silent when quiet", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter({ quiet: true });
      reporter.startSpinner("Working...");
      reporter.stopSpinner("Done");
    });

    assertEquals(output, "");
  });

  it("should stop previous spinner when starting new one", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter();
      reporter.startSpinner("First");
      reporter.startSpinner("Second");
      reporter.stopSpinner();
      reporter.dispose();
    });

    // Should not throw, should contain clear sequences
    assertEquals(output.includes("\x1b[2K\r"), true);
  });

  it("should stop spinner on dispose", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter();
      reporter.startSpinner("Working...");
      reporter.dispose();
    });

    // Should contain show cursor (from dispose cleaning up spinner)
    assertEquals(output.includes("\x1b[?25h"), true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read --allow-run --allow-write --allow-env src/utils/progress_reporter.test.ts --filter "spinner"`
Expected: FAIL — `startSpinner` not a function

- [ ] **Step 3: Implement spinner methods**

Add to `ProgressReporter`:

```ts
private spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
private spinnerFrame = 0;
private spinnerIntervalId: number | null = null;
private spinnerMessage = "";

startSpinner(message: string): void {
  if (this.options.quiet) return;
  this.stopSpinner(); // Stop any existing spinner
  if (!this.cursorHidden) this.hideCursor();
  this.spinnerMessage = message;
  this.renderSpinner();
  this.spinnerIntervalId = setInterval(() => this.renderSpinner(), 80);
}

stopSpinner(message?: string): void {
  if (this.spinnerIntervalId !== null) {
    clearInterval(this.spinnerIntervalId);
    this.spinnerIntervalId = null;
  }
  if (this.options.quiet) return;
  if (message) {
    this.writer.writeSync(this.encoder.encode(`\x1b[2K\r✅ ${message}\n`));
  } else {
    this.writer.writeSync(this.encoder.encode("\x1b[2K\r"));
  }
}

private renderSpinner(): void {
  const frame = this.spinnerFrames[this.spinnerFrame];
  this.spinnerFrame = (this.spinnerFrame + 1) % this.spinnerFrames.length;
  this.writer.writeSync(
    this.encoder.encode(`\x1b[2K\r${frame} ${this.spinnerMessage}`),
  );
}
```

Update `dispose()` to stop any running spinner:

```ts
dispose(): void {
  this.stopSpinner();
  if (this.cursorHidden) {
    this.showCursor();
  }
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `deno test --allow-read --allow-run --allow-write --allow-env src/utils/progress_reporter.test.ts`
Expected: All pass

- [ ] **Step 5: Format, lint, commit**

```bash
deno fmt src/utils/progress_reporter.ts src/utils/progress_reporter.test.ts
deno lint src/utils/progress_reporter.ts src/utils/progress_reporter.test.ts
git add src/utils/progress_reporter.ts src/utils/progress_reporter.test.ts
git commit -m "feat(progress): add spinner methods to ProgressReporter"
```

---

### Task 4: Wire ProgressReporter into `process.ts`

**Files:**
- Modify: `src/commands/process.ts`

**Reference:** Check current raw ANSI patterns at lines 34, 52-57, 63-65, 167.

- [ ] **Step 1: Read process.ts and identify all raw ANSI patterns**

- [ ] **Step 2: Replace raw patterns with ProgressReporter**

Key changes:
- Remove `new TextEncoder()` usage for ANSI
- Create `ProgressReporter` at function start
- Replace discovery `onProgress` inline callback with `reporter.discoveryCallback()`
- Replace track progress `\x1b[2K\r→ Processing...` with `reporter.update()`
- Replace completion messages with `reporter.complete()`
- Replace manual cursor hide/show with reporter constructor/dispose
- Wrap in try/finally to ensure `reporter.dispose()` is called

- [ ] **Step 3: Run existing process tests**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/commands/process.test.ts`
Expected: All pass

- [ ] **Step 4: Format, lint, commit**

```bash
deno fmt src/commands/process.ts
deno lint src/commands/process.ts
git add src/commands/process.ts
git commit -m "refactor: wire ProgressReporter into process command"
```

---

### Task 5: Wire ProgressReporter into `default.ts`

**Files:**
- Modify: `src/commands/default.ts`

**Reference:** Check current raw ANSI patterns at lines 25, 37-42, 54-61, 92-97, 103.

- [ ] **Step 1: Read default.ts and identify all raw ANSI patterns**

- [ ] **Step 2: Replace raw patterns with ProgressReporter**

Same approach as Task 4:
- Create `ProgressReporter` at function start
- Use `reporter.discoveryCallback()` for discovery progress
- Use `reporter.update()` for batch AcoustID progress
- Use `reporter.complete()` for completion
- Wrap in try/finally for `reporter.dispose()`

- [ ] **Step 3: Run existing tests**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/commands/default.test.ts`
Expected: All pass

- [ ] **Step 4: Format, lint, commit**

```bash
deno fmt src/commands/default.ts
deno lint src/commands/default.ts
git add src/commands/default.ts
git commit -m "refactor: wire ProgressReporter into default command"
```

---

### Task 6: Wire ProgressReporter into `show_tags_folder.ts`

**Files:**
- Modify: `src/commands/show_tags_folder.ts`

**Reference:** Check raw ANSI at lines 103-108, 120-125, 133-139, 301.

- [ ] **Step 1: Read show_tags_folder.ts and identify all raw ANSI patterns**

- [ ] **Step 2: Replace raw patterns with ProgressReporter**

- Use `reporter.update(processed, total, "Reading metadata")` for in-flight progress
- Use `reporter.complete()` for final count
- Wrap in try/finally for `reporter.dispose()`

- [ ] **Step 3: Run existing tests**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/commands/show_tags_folder.test.ts`
Expected: All pass (tests may skip if external volume unmounted)

- [ ] **Step 4: Format, lint, commit**

```bash
deno fmt src/commands/show_tags_folder.ts
deno lint src/commands/show_tags_folder.ts
git add src/commands/show_tags_folder.ts
git commit -m "refactor: wire ProgressReporter into show-tags-folder command"
```

---

### Task 7: Wire ProgressReporter into `encode.ts` and delete spinner.ts

**Files:**
- Modify: `src/commands/encode.ts`
- Delete: `src/utils/spinner.ts`

**Reference:** Check `EncodingSpinner` usage at lines 8, 356, 424-425, 442-445, 462-463, 584, 589-590. Discovery raw ANSI at lines 293-301, 305.

- [ ] **Step 1: Read encode.ts and map all spinner + raw ANSI usage**

- [ ] **Step 2: Replace EncodingSpinner with ProgressReporter spinner**

Key changes:
- Replace `import { EncodingSpinner }` with `import { ProgressReporter }`
- Replace `new EncodingSpinner(totalFiles)` with `new ProgressReporter({ quiet: options.quiet })`
- Replace `spinner.start()` with `reporter.startSpinner("Encoding... (0/${total} complete)")`
- Replace `spinner.incrementCompleted()` + `spinner.start()` with updating the spinner message
- Replace `spinner.stop()` with `reporter.stopSpinner()`
- Replace discovery raw ANSI with `reporter.discoveryCallback()`
- Change `ctx.spinner` type from `EncodingSpinner | null` to `ProgressReporter | null`

- [ ] **Step 3: Delete spinner.ts**

```bash
git rm src/utils/spinner.ts
```

- [ ] **Step 4: Verify no other imports of spinner.ts**

Run: `deno lint src/commands/encode.ts`
Also grep for any remaining imports: search for `spinner.ts` across the codebase.

- [ ] **Step 5: Run existing tests**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/commands/encode.test.ts`
Expected: All pass

- [ ] **Step 6: Format, lint, commit**

```bash
deno fmt src/commands/encode.ts
deno lint src/commands/encode.ts
git add src/commands/encode.ts src/utils/spinner.ts
git commit -m "refactor: replace EncodingSpinner with ProgressReporter, delete spinner.ts"
```

---

### Task 8: Wire ProgressReporter into remaining commands

**Files:**
- Modify: `src/commands/easy.ts`
- Modify: `src/commands/soundcheck.ts`
- Modify: `src/commands/process_collection.ts`
- Modify: `src/commands/x-ray.ts`
- Modify: `src/commands/lint.ts`

These 5 commands follow the same pattern. Handle them as a batch since each is a small, mechanical change.

- [ ] **Step 1: Read each file and identify raw ANSI patterns**

- [ ] **Step 2: Wire ProgressReporter into `easy.ts`**

- Use `reporter.discoveryCallback()` for discovery
- Use `reporter.update()` for per-album track progress
- Add try/finally with `reporter.dispose()` (fixes missing cursor show)

- [ ] **Step 3: Wire ProgressReporter into `soundcheck.ts`**

- Use `reporter.discoveryCallback()` (fixes ASCII `->` to Unicode `→`)
- Use `reporter.update()` for processing progress
- Replace manual cursor hide/show with reporter constructor/dispose

- [ ] **Step 4: Wire ProgressReporter into `process_collection.ts`**

- Use `reporter.update()` for track progress (albums + singles)
- Note: this function may receive a reporter from its caller (`process.ts`, `easy.ts`). Check if it should accept a reporter parameter or create its own.

- [ ] **Step 5: Wire ProgressReporter into `x-ray.ts`**

- Use `reporter.discoveryCallback()` for discovery progress
- Add try/finally with `reporter.dispose()`

- [ ] **Step 6: Wire ProgressReporter into `lint.ts`**

- Use `new ProgressReporter({ stream: "stderr" })` (preserves stdout for JSONL)
- Use `reporter.update()` for scan progress
- Remove the `writeStderr` helper function

- [ ] **Step 7: Run all tests**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`
Expected: All tests pass

- [ ] **Step 8: Format, lint, commit**

```bash
deno fmt src/commands/easy.ts src/commands/soundcheck.ts src/commands/process_collection.ts src/commands/x-ray.ts src/commands/lint.ts
deno lint src/commands/easy.ts src/commands/soundcheck.ts src/commands/process_collection.ts src/commands/x-ray.ts src/commands/lint.ts
git add src/commands/easy.ts src/commands/soundcheck.ts src/commands/process_collection.ts src/commands/x-ray.ts src/commands/lint.ts
git commit -m "refactor: wire ProgressReporter into remaining commands"
```

---

### Task 9: Final verification and push

- [ ] **Step 1: Run full test suite**

```bash
deno test --allow-read --allow-run --allow-write --allow-env --allow-net
```

- [ ] **Step 2: Verify no remaining raw ANSI in commands**

Search for leftover patterns:
```bash
grep -rn '\x1b\[2K' src/commands/ || echo "clean"
grep -rn '\x1b\[?25' src/commands/ || echo "clean"
grep -rn 'writeSync' src/commands/ || echo "clean"
```

Only `progress_reporter.ts` and its test should contain these patterns.

- [ ] **Step 3: Verify spinner.ts is deleted**

```bash
ls src/utils/spinner.ts 2>&1 || echo "deleted"
```

- [ ] **Step 4: Push**

```bash
git push
```
