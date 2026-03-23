# ProgressReporter Integration

**Date:** 2026-03-23
**Status:** Approved

## Problem

Eight commands use raw ANSI escape sequences for progress display
(`\x1b[2K\r`, `\x1b[?25l`/`\x1b[?25h`, `Deno.stdout.writeSync`). This
duplicates cursor management, line clearing, and progress formatting across
the codebase. A separate `EncodingSpinner` class in `spinner.ts` duplicates
more of the same cursor/ANSI logic. Inconsistencies exist: `soundcheck.ts`
uses ASCII `->` instead of Unicode `→`, `easy.ts` never hides the cursor,
`lint.ts` writes to stderr while others use stdout, and `encode.ts` uses a
different erase sequence order.

`ProgressReporter` already exists with the right primitives but is not wired
into any command.

## Solution

Extend `ProgressReporter` with a configurable output stream, a discovery
callback factory, and spinner support. Replace all raw ANSI patterns in
commands. Delete `EncodingSpinner`.

## Design

### ProgressReporter API

```ts
type ProgressReporterOptions = {
  quiet?: boolean;
  stream?: "stdout" | "stderr"; // default: "stdout"
};

class ProgressReporter {
  constructor(options?: ProgressReporterOptions);

  // Existing (unchanged API)
  update(current: number, total: number, message?: string): void;
  complete(message: string): void;
  section(title: string): void;
  dispose(): void;

  // New
  discoveryCallback(): (phase: string, current: number, total?: number) => void;
  startSpinner(message: string): void;
  stopSpinner(message?: string): void;
}
```

**`stream`**: Routes all writes to `Deno.stdout` or `Deno.stderr`. Defaults
to stdout. Commands like `lint --json` use stderr so JSONL output stays clean.

**`discoveryCallback()`**: Returns a function compatible with `discoverMusic`'s
`onProgress` parameter. Format: `→ ${phase}: ${current}${total ? /${total} : ""} files`.
Eliminates 7 copies of the same inline callback.

**`startSpinner(message)`**: Begins animated spinner with braille characters
(`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`), hides cursor. Absorbs `EncodingSpinner` logic.

**`stopSpinner(message?)`**: Stops animation, clears line, optionally prints
completion message, shows cursor.

### Command Changes

| Command | Pattern replaced | Reporter methods used |
|---------|-----------------|----------------------|
| `process.ts` | Manual cursor hide/show, raw discovery + track progress | `discoveryCallback()`, `update()`, `complete()` |
| `default.ts` | Raw discovery + batch AcoustID progress | `discoveryCallback()`, `update()`, `complete()` |
| `show_tags_folder.ts` | Raw metadata reading progress | `update()`, `complete()` |
| `encode.ts` | `EncodingSpinner` + raw discovery | `discoveryCallback()`, `startSpinner()`, `stopSpinner()` |
| `easy.ts` | Raw discovery + per-album progress, no cursor hide | `discoveryCallback()`, `update()` |
| `soundcheck.ts` | Raw progress with ASCII `->` arrow | `discoveryCallback()`, `update()` |
| `process_collection.ts` | Raw track progress | `update()` |
| `x-ray.ts` | Raw discovery progress | `discoveryCallback()` |
| `lint.ts` | Raw progress via stderr helper | `ProgressReporter({ stream: "stderr" })`, `update()` |

### Consistency Fixes

These come for free from using ProgressReporter:

- `soundcheck.ts` ASCII `->` becomes Unicode `→`
- `easy.ts` gains cursor hide/show via constructor/dispose
- All commands use the same line-erase pattern (`\x1b[2K\r`)

### Files Changed

| File | Change |
|------|--------|
| `src/utils/progress_reporter.ts` | Add `stream`, `discoveryCallback()`, spinner methods |
| `src/utils/progress_reporter.test.ts` | Tests for new methods |
| `src/utils/spinner.ts` | Deleted |
| `src/commands/process.ts` | Replace raw ANSI with reporter |
| `src/commands/default.ts` | Replace raw ANSI with reporter |
| `src/commands/show_tags_folder.ts` | Replace raw ANSI with reporter |
| `src/commands/encode.ts` | Replace `EncodingSpinner` + raw ANSI with reporter |
| `src/commands/easy.ts` | Replace raw ANSI with reporter |
| `src/commands/soundcheck.ts` | Replace raw ANSI with reporter |
| `src/commands/process_collection.ts` | Replace raw ANSI with reporter |
| `src/commands/x-ray.ts` | Replace raw ANSI with reporter |
| `src/commands/lint.ts` | Replace stderr helper with reporter |

### Not in Scope

- `enrich.ts` — no inline progress patterns
- `fix.ts`, `interactive.ts` — no ANSI progress patterns
- `pipeline.ts` — uses `console.log` for progress (future `onProgress`
  callback is separate work)

### Future: Electron GUI

`ProgressReporter` can be extended or replaced for a GUI context. The
`stream` option already decouples output from stdout. A future GUI adapter
could implement the same interface, routing `update()` to a progress bar
component and `startSpinner()` to a loading indicator.
