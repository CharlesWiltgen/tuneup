# Interactive Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development
> (if subagents available) or superpowers:executing-plans to implement this plan.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default CLI command with an interactive prompt flow that
guides users through selecting operations and options, then delegates to the
existing `processCommand`.

**Architecture:** A new `interactiveCommand` function in
`src/commands/interactive.ts` uses `@cliffy/prompt` to collect user input
(path, operations, operation-specific options, common flags), assembles a
`ProcessCommandOptions` object, and calls `processCommand`. The function accepts
an optional `processCommandFn` parameter for dependency injection (used by
tests). The CLI's default action in `src/cli/cli.ts` is rewired to this new
handler. The argument signature changes from required `<...files:string>` to
optional `[path:string]`.

**Tech Stack:** `@cliffy/prompt@1.0.0` (JSR) — Checkbox, Input, Confirm, Secret

**Spec:** `docs/superpowers/specs/2026-03-17-interactive-mode-design.md`

---

### Task 1: Add `@cliffy/prompt` dependency

**Files:**

- Modify: `import_map.json`

- [ ] **Step 1: Add the import mapping**

In `import_map.json`, add these entries to the `"imports"` object:

```json
"@cliffy/prompt": "jsr:@cliffy/prompt@1.0.0",
"@cliffy/prompt/checkbox": "jsr:@cliffy/prompt@1.0.0/checkbox",
"@cliffy/prompt/confirm": "jsr:@cliffy/prompt@1.0.0/confirm",
"@cliffy/prompt/input": "jsr:@cliffy/prompt@1.0.0/input",
"@cliffy/prompt/secret": "jsr:@cliffy/prompt@1.0.0/secret"
```

- [ ] **Step 2: Verify the dependency resolves**

Run: `deno cache src/amusic.ts`

Expected: resolves without errors (the import map entry is valid even before any
code imports it).

- [ ] **Step 3: Commit**

```bash
git add import_map.json
git commit -m "chore: add @cliffy/prompt dependency for interactive mode"
```

---

### Task 2: Write `interactiveCommand` tests

**Files:**

- Create: `src/commands/interactive.test.ts`

Tests use Cliffy's static `inject()` method to pre-populate prompt responses,
so no stdin mocking is needed. Each test injects values, calls
`interactiveCommand` with an injected `processCommandFn`, and asserts that the
correct options object is passed through.

- [ ] **Step 1: Write the test file with todo stubs**

```ts
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { Checkbox } from "@cliffy/prompt/checkbox";
import { Confirm } from "@cliffy/prompt/confirm";
import { Input } from "@cliffy/prompt/input";
import { Secret } from "@cliffy/prompt/secret";
import type { ProcessCommandOptions } from "./process.ts";

// Test helper: creates a processCommandFn that captures its arguments
function createCapture() {
  let captured: { options: ProcessCommandOptions; paths: string[] } | null =
    null;
  const fn = async (
    options: ProcessCommandOptions,
    ...paths: string[]
  ): Promise<void> => {
    captured = { options, paths };
  };
  return {
    fn,
    get result() {
      if (!captured) throw new Error("processCommand was never called");
      return captured;
    },
  };
}

describe("interactiveCommand", () => {
  it.todo("should prompt for path when none provided");
  it.todo("should skip path prompt when path is provided as argument");
  it.todo(
    "should prompt for API key when AcoustID selected and env var not set",
  );
  it.todo("should skip API key prompt when env var is set");
  it.todo(
    "should prompt for output dir and lossy transcodes when encode selected",
  );
  it.todo(
    "should show summary and call processCommand with assembled options",
  );
  it.todo("should return without calling processCommand when not confirmed");
});
```

- [ ] **Step 2: Implement the path prompt test**

Replace the first `it.todo`:

```ts
it("should prompt for path when none provided", async () => {
  const { interactiveCommand } = await import("./interactive.ts");
  const capture = createCapture();

  Input.inject("/tmp/test-music");
  Checkbox.inject(["replayGain"]);
  Confirm.inject(false); // dry-run
  Confirm.inject(false); // force
  Confirm.inject(true); // confirm

  await interactiveCommand(undefined, capture.fn);

  assertEquals(capture.result.paths, ["/tmp/test-music"]);
  assertEquals(capture.result.options.replayGain, true);
});
```

- [ ] **Step 3: Implement remaining tests**

**Skip path prompt when provided:**

```ts
it("should skip path prompt when path is provided as argument", async () => {
  const { interactiveCommand } = await import("./interactive.ts");
  const capture = createCapture();

  Checkbox.inject(["soundCheck"]);
  Confirm.inject(false); // dry-run
  Confirm.inject(false); // force
  Confirm.inject(true); // confirm

  await interactiveCommand("/tmp/provided-path", capture.fn);

  assertEquals(capture.result.paths, ["/tmp/provided-path"]);
  assertEquals(capture.result.options.soundCheck, true);
});
```

**AcoustID prompts for API key when env not set:**

```ts
it("should prompt for API key when AcoustID selected and env var not set", async () => {
  const { interactiveCommand } = await import("./interactive.ts");
  const capture = createCapture();
  const originalEnv = Deno.env.get("ACOUSTID_API_KEY");
  Deno.env.delete("ACOUSTID_API_KEY");

  try {
    Checkbox.inject(["acoustID"]);
    Secret.inject("test-api-key-123");
    Confirm.inject(false); // dry-run
    Confirm.inject(false); // force
    Confirm.inject(true); // confirm

    await interactiveCommand("/tmp/test", capture.fn);

    assertEquals(capture.result.options.apiKey, "test-api-key-123");
    assertEquals(capture.result.options.acoustID, true);
  } finally {
    if (originalEnv) Deno.env.set("ACOUSTID_API_KEY", originalEnv);
  }
});
```

**Skip API key prompt when env var is set:**

```ts
it("should skip API key prompt when env var is set", async () => {
  const { interactiveCommand } = await import("./interactive.ts");
  const capture = createCapture();
  const originalEnv = Deno.env.get("ACOUSTID_API_KEY");
  Deno.env.set("ACOUSTID_API_KEY", "env-key-456");

  try {
    Checkbox.inject(["acoustID"]);
    // No Secret.inject — should not prompt
    Confirm.inject(false); // dry-run
    Confirm.inject(false); // force
    Confirm.inject(true); // confirm

    await interactiveCommand("/tmp/test", capture.fn);

    assertEquals(capture.result.options.apiKey, "env-key-456");
  } finally {
    if (originalEnv) {
      Deno.env.set("ACOUSTID_API_KEY", originalEnv);
    } else {
      Deno.env.delete("ACOUSTID_API_KEY");
    }
  }
});
```

**Encode prompts for output dir and lossy transcodes:**

```ts
it("should prompt for output dir and lossy transcodes when encode selected", async () => {
  const { interactiveCommand } = await import("./interactive.ts");
  const capture = createCapture();

  Checkbox.inject(["encode"]);
  Input.inject("/tmp/output"); // output dir
  Confirm.inject(true); // force lossy transcodes
  Confirm.inject(false); // dry-run
  Confirm.inject(false); // force
  Confirm.inject(true); // confirm

  await interactiveCommand("/tmp/test", capture.fn);

  assertEquals(capture.result.options.encode, true);
  assertEquals(capture.result.options.outputDir, "/tmp/output");
  assertEquals(capture.result.options.forceLossyTranscodes, true);
});
```

**Full options assembled correctly:**

```ts
it("should show summary and call processCommand with assembled options", async () => {
  const { interactiveCommand } = await import("./interactive.ts");
  const capture = createCapture();
  const originalEnv = Deno.env.get("ACOUSTID_API_KEY");
  Deno.env.set("ACOUSTID_API_KEY", "env-key");

  try {
    Checkbox.inject(["encode", "replayGain", "acoustID", "soundCheck"]);
    Input.inject("/tmp/out"); // output dir
    Confirm.inject(false); // lossy transcodes
    Confirm.inject(true); // dry-run
    Confirm.inject(true); // force
    Confirm.inject(true); // confirm

    await interactiveCommand("/tmp/music", capture.fn);

    assertEquals(capture.result.paths, ["/tmp/music"]);
    assertEquals(capture.result.options, {
      quiet: false,
      encode: true,
      replayGain: true,
      acoustID: true,
      soundCheck: true,
      forceLossyTranscodes: false,
      outputDir: "/tmp/out",
      apiKey: "env-key",
      dryRun: true,
      force: true,
    });
  } finally {
    if (originalEnv) {
      Deno.env.set("ACOUSTID_API_KEY", originalEnv);
    } else {
      Deno.env.delete("ACOUSTID_API_KEY");
    }
  }
});
```

**Cancellation (user declines at confirmation):**

```ts
it("should return without calling processCommand when not confirmed", async () => {
  const { interactiveCommand } = await import("./interactive.ts");
  let called = false;
  const fn = async () => {
    called = true;
  };

  Checkbox.inject(["replayGain"]);
  Confirm.inject(false); // dry-run
  Confirm.inject(false); // force
  Confirm.inject(false); // confirm → no

  await interactiveCommand("/tmp/test", fn as never);

  assertEquals(called, false);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run:
`deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/commands/interactive.test.ts`

Expected: FAIL — `./interactive.ts` module not found.

- [ ] **Step 5: Commit**

```bash
git add src/commands/interactive.test.ts
git commit -m "test: add interactive mode tests (red phase)"
```

---

### Task 3: Implement `interactiveCommand`

**Files:**

- Create: `src/commands/interactive.ts`

The function accepts an optional `processCommandFn` parameter for dependency
injection, defaulting to the real `processCommand`.

- [ ] **Step 1: Create the interactive command module**

```ts
import { Checkbox } from "@cliffy/prompt/checkbox";
import { Confirm } from "@cliffy/prompt/confirm";
import { Input } from "@cliffy/prompt/input";
import { Secret } from "@cliffy/prompt/secret";
import { processCommand } from "./process.ts";
import type { ProcessCommandOptions } from "./process.ts";

type ProcessCommandFn = (
  options: ProcessCommandOptions,
  ...paths: string[]
) => Promise<void>;

const OPERATIONS = [
  { name: "Encode (to M4A/AAC)", value: "encode" },
  { name: "ReplayGain", value: "replayGain" },
  { name: "AcoustID", value: "acoustID" },
  { name: "SoundCheck", value: "soundCheck" },
] as const;

export async function interactiveCommand(
  path?: string,
  processCommandFn: ProcessCommandFn = processCommand,
): Promise<void> {
  try {
    // Step 1: Get path
    const targetPath = path ?? await Input.prompt({
      message: "Path to music folder",
      validate: (value) => {
        if (!value.trim()) return "Path is required";
        try {
          const stat = Deno.statSync(value);
          if (!stat.isDirectory) return "Path must be a directory";
        } catch {
          return "Path does not exist";
        }
        return true;
      },
    });

    // Step 2: Select operations
    const selectedOps = await Checkbox.prompt({
      message: "Select operations to perform",
      options: OPERATIONS.map((op) => ({
        name: op.name,
        value: op.value,
      })),
      minOptions: 1,
    });

    const ops = new Set(selectedOps);

    // Step 3: Conditional follow-ups
    let outputDir: string | undefined;
    let forceLossyTranscodes = false;
    let apiKey: string | undefined;

    if (ops.has("encode")) {
      const dir = await Input.prompt({
        message: "Output directory for encoded files",
        default: "(source directory)",
      });
      if (dir !== "(source directory)") outputDir = dir;

      forceLossyTranscodes = await Confirm.prompt({
        message: "Allow transcoding from lossy formats (MP3, OGG)?",
        default: false,
      });
    }

    if (ops.has("acoustID")) {
      const envKey = Deno.env.get("ACOUSTID_API_KEY");
      if (envKey) {
        apiKey = envKey;
      } else {
        apiKey = await Secret.prompt({
          message: "AcoustID API key",
          validate: (value) => {
            if (!value.trim()) {
              return "API key is required for AcoustID lookups";
            }
            return true;
          },
        });
      }
    }

    // Step 4: Common options
    const dryRun = await Confirm.prompt({
      message: "Dry run (simulate without writing)?",
      default: false,
    });

    const force = await Confirm.prompt({
      message: "Force reprocessing (overwrite existing tags)?",
      default: false,
    });

    // Step 5: Summary
    console.log("\n--- Summary ---");
    console.log(`  Path:       ${targetPath}`);
    console.log(`  Operations: ${selectedOps.join(", ")}`);
    if (outputDir) console.log(`  Output dir: ${outputDir}`);
    if (dryRun) console.log(`  Dry run:    yes`);
    if (force) console.log(`  Force:      yes`);
    console.log("");

    const confirmed = await Confirm.prompt({
      message: "Proceed?",
      default: true,
    });

    if (!confirmed) {
      console.log("Cancelled.");
      return;
    }

    // Step 6: Execute
    const options: ProcessCommandOptions = {
      quiet: false,
      encode: ops.has("encode"),
      replayGain: ops.has("replayGain"),
      acoustID: ops.has("acoustID"),
      soundCheck: ops.has("soundCheck"),
      forceLossyTranscodes,
      outputDir,
      apiKey,
      dryRun,
      force,
    };

    await processCommandFn(options, targetPath);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("canceled") ||
        error.message.includes("aborted"))
    ) {
      console.log("\nCancelled.");
      Deno.exit(0);
    }
    throw error;
  }
}
```

- [ ] **Step 2: Run the tests**

Run:
`deno test --allow-read --allow-run --allow-write --allow-env --allow-net src/commands/interactive.test.ts`

Expected: tests pass. If any fail, fix the implementation to match the expected
behavior from the tests.

- [ ] **Step 3: Run the formatter**

Run: `deno fmt src/commands/interactive.ts src/commands/interactive.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/commands/interactive.ts src/commands/interactive.test.ts
git commit -m "feat: implement interactive mode prompt flow"
```

---

### Task 4: Wire interactive mode into the CLI

**Files:**

- Modify: `src/cli/cli.ts` (lines 56–82: replace default command arguments and
  action)

- [ ] **Step 1: Update the default command in `cli.ts`**

Replace the current default command configuration (the options block from
`--force` through `.action(defaultCommand)`, lines 56–82) with:

```ts
    // Interactive mode as default action
    .option(
      "--show-tags",
      "Display existing tags (AcoustID, ReplayGain, MusicBrainz, and more)",
    )
    .option(
      "-q, --quiet",
      "Suppress informational output (errors still shown)",
      { default: false },
    )
    .option(
      "--debug",
      "Enable debug output for troubleshooting",
      { default: false },
    )
    .option(
      "--api-key <key:string>",
      "AcoustID API key (required for lookups)",
      { default: Deno.env.get("ACOUSTID_API_KEY") },
    )
    .arguments("[path:string]")
    .action(async (options: Record<string, unknown>, path?: string) => {
      if (options.showTags && path) {
        await defaultCommand(
          {
            quiet: options.quiet as boolean,
            showTags: true,
            debug: options.debug as boolean,
          },
          path,
        );
        return;
      }
      await interactiveCommand(path);
    });
```

Also add the import at the top of the file:

```ts
import { interactiveCommand } from "../commands/interactive.ts";
```

Key changes:

- Arguments changed from `<...files:string>` (required) to `[path:string]`
  (optional)
- Default action now routes to `interactiveCommand`
- `--show-tags` preserved as a non-interactive passthrough to `defaultCommand`
- Removed `--force`, `--dry-run` from CLI flags (now interactive prompts)

- [ ] **Step 2: Update the program description**

Change the `.description(...)` to:

```ts
    .description(
      "A music library toolkit powered by taglib-wasm.\n\n" +
        "Supports MP3, M4A/MP4, FLAC, OGG, and WAV files.\n\n" +
        "Run without a subcommand for interactive mode.",
    )
```

- [ ] **Step 3: Run all tests to verify nothing is broken**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`

Expected: interactive.test.ts passes. Some E2E tests in default.test.ts may
fail — that's expected and fixed in Task 5.

- [ ] **Step 4: Run format and lint**

Run: `deno task check`

- [ ] **Step 5: Commit**

```bash
git add src/cli/cli.ts
git commit -m "feat: wire interactive mode as default CLI action"
```

---

### Task 5: Update existing tests for the new default behavior

**Files:**

- Modify: `src/commands/default.test.ts`

E2E tests that run `amusic` via CLI without a subcommand will now enter
interactive mode and hang (stdin piped, no TTY). Update them to use explicit
subcommands.

- [ ] **Step 1: Update the "no audio files found" E2E test**

Change the args in the first test (line 25–31) from:

```ts
args: [
  "run", "--no-check", "--allow-read", "--allow-env",
  "--allow-net", "--allow-write", "--allow-run",
  "src/amusic.ts", "/nonexistent/path/file.flac",
],
```

to:

```ts
args: [
  "run", "--no-check", "--allow-read", "--allow-env",
  "--allow-net", "--allow-write", "--allow-run",
  "src/amusic.ts", "process", "--acoust-id",
  "/nonexistent/path/file.flac",
],
```

- [ ] **Step 2: Update the `--dry-run` E2E test**

Change the args in the third test (line 84–95) from:

```ts
args: [
  "run", "--no-check", "--allow-read", "--allow-env",
  "--allow-net", "--allow-write", "--allow-run",
  "src/amusic.ts", "--dry-run", "--quiet", testDir,
],
```

to:

```ts
args: [
  "run", "--no-check", "--allow-read", "--allow-env",
  "--allow-net", "--allow-write", "--allow-run",
  "src/amusic.ts", "process", "--acoust-id",
  "--dry-run", "--quiet", testDir,
],
```

The `--show-tags` test (second test) still passes as-is since `--show-tags` is
preserved on the default command.

- [ ] **Step 3: Run all tests**

Run: `deno test --allow-read --allow-run --allow-write --allow-env --allow-net`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/commands/default.test.ts
git commit -m "test: update E2E tests for interactive mode default"
```

---

### Task 6: Manual smoke test

- [ ] **Step 1: Run `amusic` with no arguments**

Run: `deno task start`

Expected: path prompt appears first.

- [ ] **Step 2: Run `amusic /path` with a test folder**

Run:
`deno run --allow-read --allow-run --allow-write --allow-env --allow-net src/amusic.ts "/Volumes/T9 (4TB)/Downloads/Deezer/America/America - Hits"`

Expected: skips path prompt, goes straight to operation selection.

- [ ] **Step 3: Test Ctrl+C exits cleanly**

Run `amusic`, then press Ctrl+C at any prompt.

Expected: prints "Cancelled." and exits with code 0. No stack trace.

- [ ] **Step 4: Verify subcommands still work**

Run:
`deno run --allow-read --allow-run --allow-write --allow-env --allow-net src/amusic.ts process --encode --dry-run "/Volumes/T9 (4TB)/Downloads/Deezer/America/America - Hits"`

Expected: runs process command directly, no interactive prompts.

- [ ] **Step 5: Verify `--show-tags` still works**

Run:
`deno run --allow-read --allow-run --allow-write --allow-env --allow-net src/amusic.ts --show-tags "/Volumes/T9 (4TB)/Downloads/Deezer/America/America - Hits"`

Expected: shows tags non-interactively, same as before.
