# Interactive Mode Design

## Summary

Replace the current default command (AcoustID-only processing) with an
interactive mode that guides users through selecting operations and options via
terminal prompts. Uses `@cliffy/prompt` for consistency with existing Cliffy
dependencies.

## Entry Points

- `amusic` — prompts for path, then operations
- `amusic /path` — skips path prompt, goes straight to operation selection
- All existing subcommands (`process`, `easy`, `encode`, `lint`, etc.) are
  unchanged

## Breaking Change

The current behavior of `amusic <files>` (runs AcoustID fingerprinting on
specified files) is replaced by interactive mode. This functionality remains
available via `amusic process --acoust-id <files>`.

## Interactive Flow

### Cancellation

Ctrl+C or Escape at any prompt exits cleanly with a brief message (e.g.,
"Cancelled.") and exit code 0. No stack traces. Partial state is discarded.

### Step 1: Path (if not provided as argument)

- Prompt type: `Input`
- Message: "Path to music folder"
- Validation: path exists and is a directory. If the directory contains no audio
  files, show an error and re-prompt.
- Only directories are accepted (not individual files or globs — use subcommands
  for those).

### Step 2: Operation Selection

- Prompt type: `Checkbox`
- Message: "Select operations to perform"
- Options:
  - Encode (to M4A/AAC)
  - ReplayGain
  - AcoustID
  - SoundCheck
- Constraint: at least one must be selected

### Step 3: Conditional Follow-ups

Only shown for checked operations:

**If Encode selected:**

- `Input` for output directory (default: source directory)
- `Confirm` for force lossy transcodes (default: no) — always shown when encode
  is selected, since scanning all files upfront would be slow for large
  libraries

**If AcoustID selected:**

- Skip prompt entirely if `$ACOUSTID_API_KEY` env var is set
- Otherwise, `Input` for API key (required — validation rejects empty input)

### Step 4: Common Options

- `Confirm` for dry-run mode (default: no)
- `Confirm` for force reprocessing (default: no)

### Step 5: Summary and Confirmation

Display a summary of:

- Target path
- Selected operations
- Any non-default options

Then `Confirm` to proceed (default: yes).

### Step 6: Execute

Delegate to `processCommand` with assembled options object. No new processing
logic — interactive mode is purely a prompt-based frontend to the existing
`process` command.

## Files Changed

| File | Change |
| --- | --- |
| `src/commands/interactive.ts` | New — prompt flow and option assembly |
| `src/commands/interactive.test.ts` | New — tests using `inject()` for non-interactive testing |
| `src/cli/cli.ts` | Replace default command action with interactive handler |
| `import_map.json` | Add `@cliffy/prompt` dependency |

## Files NOT Changed

- `src/commands/process.ts` — reused as-is
- All other subcommands — unchanged
- No new processing logic

## Dependencies

- `@cliffy/prompt@1.0.0` (JSR) — same version line as existing `@cliffy/command`
  and `@cliffy/table`

## Out of Scope

- Spinners or progress bars (existing command output handles progress)
- Interactive modes for other subcommands
- Changes to the `easy` command
- Any new processing logic
