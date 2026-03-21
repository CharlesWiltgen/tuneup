# Rename amusic → tuneup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the project from "amusic" to "tuneup" across all internal code,
GitHub, Homebrew distribution, and local dev environment.

**Architecture:** This is a pure rename — no logic changes. Work proceeds
inside-out: internal source first, then config/CI, then external systems
(GitHub, Homebrew tap). Each task is independently committable.

**Tech Stack:** Deno, GitHub Actions, Homebrew, JSR (noting: not currently
published to JSR — empty exports)

---

## File Structure

No new files created. Renames:

| Current                            | New                                |
| ---------------------------------- | ---------------------------------- |
| `src/amusic.ts`                    | `src/tuneup.ts`                    |
| `src/test_utils/amusic_helpers.ts` | `src/test_utils/tuneup_helpers.ts` |
| `src/amusic.test.ts`               | `src/tuneup.test.ts`               |
| `amusic.code-workspace`            | `tuneup.code-workspace`            |
| `homebrew/amusic.rb.template`      | `homebrew/tuneup.rb.template`      |
| `dist/amusic` (build output)       | `dist/tuneup`                      |
| `/usr/local/bin/amusic` (symlink)  | `/usr/local/bin/tuneup`            |

## External Systems (require manual steps)

- **GitHub**: Rename repo `CharlesWiltgen/amusic` → `CharlesWiltgen/tuneup`
  (Settings → General)
- **Homebrew tap**: Rename formula in `CharlesWiltgen/homebrew-tap` repo
- **JSR**: No action needed (empty exports, not published)
- **npm**: No action needed yet (not published)
- **Beads**: Update database name in `.beads/metadata.json`

---

### Task 1: Rename entry point and test helper files

**Files:**

- Rename: `src/amusic.ts` → `src/tuneup.ts`
- Rename: `src/amusic.test.ts` → `src/tuneup.test.ts`
- Rename: `src/test_utils/amusic_helpers.ts` →
  `src/test_utils/tuneup_helpers.ts`
- Modify: `src/test_utils/mod.ts`

- [ ] **Step 1: Rename the three files**

```bash
git mv src/amusic.ts src/tuneup.ts
git mv src/amusic.test.ts src/tuneup.test.ts
git mv src/test_utils/amusic_helpers.ts src/test_utils/tuneup_helpers.ts
```

- [ ] **Step 2: Update the export in `src/test_utils/mod.ts`**

Change `./amusic_helpers.ts` → `./tuneup_helpers.ts`

- [ ] **Step 3: Update internal references in
      `src/test_utils/tuneup_helpers.ts`**

- Change `AMUSIC_SCRIPT_PATH` → `TUNEUP_SCRIPT_PATH`
- Change `"./src/amusic.ts"` → `"./src/tuneup.ts"`
- Update comments: `amusic CLI` → `tuneup CLI`, `amusic.ts` → `tuneup.ts`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename entry point and test helper files from amusic to tuneup"
```

---

### Task 2: Update all source code string references

**Files:**

- Modify: `src/cli/cli.ts` (CLI name and examples)
- Modify: `src/lib/encoding.ts` (encoder comment string)
- Modify: `src/lib/replaygain.ts` (temp dir prefix)
- Modify: `src/lib/musicbrainz.ts` (user agent string)
- Modify: `src/commands/encode.ts` (console output)
- Modify: `src/commands/enrich.ts` (error message)
- Modify: `src/commands/fix.ts` (console output)

- [ ] **Step 1: Update `src/cli/cli.ts`**

- `.name("amusic")` → `.name("tuneup")`
- All example strings: `"amusic ..."` → `"tuneup ..."`

- [ ] **Step 2: Update `src/lib/encoding.ts`**

- `Encoded with amusic` → `Encoded with tuneup`

- [ ] **Step 3: Update `src/lib/replaygain.ts`**

- `prefix: "amusic-rg-"` → `prefix: "tuneup-rg-"`

- [ ] **Step 4: Update `src/lib/musicbrainz.ts`**

- User agent: `amusic/${VERSION}` → `tuneup/${VERSION}`
- URL: `https://github.com/CharlesWiltgen/amusic` →
  `https://github.com/CharlesWiltgen/tuneup`

- [ ] **Step 5: Update `src/commands/encode.ts`**

- Console strings: `amusic has started` → `tuneup has started`

- [ ] **Step 6: Update `src/commands/enrich.ts`**

- Error message: `Run 'amusic process` → `Run 'tuneup process`

- [ ] **Step 7: Update `src/commands/fix.ts`**

- Console output: `amusic fix:` → `tuneup fix:`

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: update all source code string references from amusic to tuneup"
```

---

### Task 3: Update all test file references

**Files:**

- Modify: `src/tuneup.test.ts` (already renamed in Task 1)
- Modify: `src/commands/default.test.ts`
- Modify: `src/commands/easy.test.ts`
- Modify: `src/commands/encode.test.ts`
- Modify: `src/commands/soundcheck.test.ts`
- Modify: `src/commands/x-ray.test.ts`
- Modify: `src/commands/enrich.test.ts`
- Modify: `src/commands/lint.test.ts`
- Modify: `src/commands/fix.test.ts`
- Modify: `src/lib/replaygain.test.ts`
- Modify: `src/lib/tagging.test.ts`
- Modify: `src/utils/file_discovery.test.ts`

- [ ] **Step 1: Update `src/tuneup.test.ts`**

- Test suite name: `"amusic.ts Integration Tests"` →
  `"tuneup.ts Integration Tests"`
- All comments referencing `amusic.ts` → `tuneup.ts`

- [ ] **Step 2: Update all command test files**

In each of these files, replace `"src/amusic.ts"` → `"src/tuneup.ts"`:

- `src/commands/default.test.ts`
- `src/commands/easy.test.ts`
- `src/commands/encode.test.ts`
- `src/commands/soundcheck.test.ts`
- `src/commands/x-ray.test.ts`
- `src/commands/enrich.test.ts`
- `src/commands/lint.test.ts`
- `src/commands/fix.test.ts`

- [ ] **Step 3: Update lib test files**

- `src/lib/replaygain.test.ts`: `amusic-rg-test` → `tuneup-rg-test`,
  `amusic-rg-fail` → `tuneup-rg-fail`
- `src/lib/tagging.test.ts`: `prefix: "amusic-test-mb-"` →
  `prefix: "tuneup-test-mb-"`
- `src/utils/file_discovery.test.ts`: `prefix: "amusic-test-"` →
  `prefix: "tuneup-test-"`
- `src/commands/fix.test.ts`: `prefix: "amusic-fix-test-"` →
  `prefix: "tuneup-fix-test-"`

- [ ] **Step 4: Run tests to verify nothing broke**

```bash
deno test --allow-read --allow-run --allow-write --allow-env --allow-net
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "test: update all test references from amusic to tuneup"
```

---

### Task 4: Update config files

**Files:**

- Modify: `deno.json`
- Modify: `scripts/sign_macos.ts`
- Rename: `amusic.code-workspace` → `tuneup.code-workspace` (update contents
  too)
- Modify: `.gitignore`
- Modify: `.beads/metadata.json`

- [ ] **Step 1: Update `deno.json`**

- `"name": "amusic"` → `"name": "tuneup"`
- Task `start`: `src/amusic.ts` → `src/tuneup.ts`
- Task `build`: `dist/amusic src/amusic.ts` → `dist/tuneup src/tuneup.ts`
- Exclude arrays: `"amusic"` → `"tuneup"`

- [ ] **Step 2: Update `scripts/sign_macos.ts`**

- Binary path: `"dist/amusic"` → `"dist/tuneup"`
- Symlink path: `"/usr/local/bin/amusic"` → `"/usr/local/bin/tuneup"`
- All console output strings: `amusic` → `tuneup`

- [ ] **Step 3: Rename and update workspace file**

```bash
git mv amusic.code-workspace tuneup.code-workspace
```

Update spellcheck word list inside: `"amusic"` → `"tuneup"`

- [ ] **Step 4: Update `.gitignore`**

- Comment: `amusic.ts integration tests` → `tuneup.ts integration tests`
- Workspace exclusion: `amusic.code-workspace` → `tuneup.code-workspace`

- [ ] **Step 5: Update `.beads/metadata.json`**

- `"dolt_database": "beads_amusic"` → `"dolt_database": "beads_tuneup"`

- [ ] **Step 6: Run format and lint checks**

```bash
deno task check
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: update config files for amusic → tuneup rename"
```

---

### Task 5: Update CI/CD workflows

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/homebrew-update.yml`

- [ ] **Step 1: Update `.github/workflows/ci.yml`**

- Comment: `amusic.ts` → `tuneup.ts`

- [ ] **Step 2: Update `.github/workflows/release.yml`**

- All artifact names: `amusic-macos-arm64` → `tuneup-macos-arm64`, etc.
- Source file: `src/amusic.ts` → `src/tuneup.ts`
- Output binary: `dist/amusic` → `dist/tuneup`

- [ ] **Step 3: Update `.github/workflows/homebrew-update.yml`**

- All `amusic-` prefixed references → `tuneup-`
- Formula file: `amusic.rb` → `tuneup.rb`
- Branch name: `update-amusic-` → `update-tuneup-`
- Commit/PR messages: `amusic` → `tuneup`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "ci: update workflow references from amusic to tuneup"
```

---

### Task 6: Update Homebrew template and docs

**Files:**

- Rename: `homebrew/amusic.rb.template` → `homebrew/tuneup.rb.template`
- Modify: `homebrew/tuneup.rb.template` (contents)
- Modify: `homebrew/README.md`
- Modify: `README.md`
- Modify: `docs/REQUIREMENTS.md`
- Modify: `docs/RELEASING.md`
- Modify: `TASKS.md`
- Modify: `BACKLOG.md`

- [ ] **Step 1: Rename and update Homebrew template**

```bash
git mv homebrew/amusic.rb.template homebrew/tuneup.rb.template
```

Update contents:

- Class name: `Amusic` → `Tuneup`
- All URLs and binary names: `amusic` → `tuneup`

- [ ] **Step 2: Update `homebrew/README.md`**

- All `amusic` references → `tuneup`

- [ ] **Step 3: Update `README.md`**

- All `amusic` references → `tuneup` (title, install instructions, usage
  examples, etc.)

- [ ] **Step 4: Update `docs/REQUIREMENTS.md`**

- Title: `amusic CLI` → `tuneup CLI`

- [ ] **Step 5: Update `docs/RELEASING.md`**

- All `amusic` references → `tuneup`

- [ ] **Step 6: Update `TASKS.md` and `BACKLOG.md`**

- Heading: `# amusic Development Tasks` → `# tuneup Development Tasks`
- Heading: `# amusic Backlog` → `# tuneup Backlog`

**Note:** Historical plans in `docs/superpowers/` are intentionally left as-is —
they are timestamped records of prior work under the old name.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: update all documentation for amusic → tuneup rename"
```

---

### Task 7: Update CLAUDE.local.md and CLAUDE.md project docs

**Files:**

- Modify: `CLAUDE.local.md`
- Modify: `CLAUDE.md` (if it references "amusic")

- [ ] **Step 1: Update `CLAUDE.local.md`**

- All references to `amusic` → `tuneup` (project name, binary name, CLI
  examples, symlink mention)
- GitHub URL: `CharlesWiltgen/amusic` → `CharlesWiltgen/tuneup`

- [ ] **Step 2: Update `CLAUDE.md` if needed**

- Check for any `amusic` references and update

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: update Claude Code project docs for tuneup rename"
```

---

### Task 8: External systems (manual steps)

These require human action or careful coordination:

- [ ] **Step 1: Rename GitHub repository**

Go to https://github.com/CharlesWiltgen/amusic → Settings → General → Repository
name → change to `tuneup`. GitHub auto-redirects the old URL.

- [ ] **Step 2: Update local git remote**

```bash
git remote set-url origin https://github.com/CharlesWiltgen/tuneup.git
```

- [ ] **Step 3: Rename local project directory**

```bash
mv /Users/Charles/Projects/amusic /Users/Charles/Projects/tuneup
```

- [ ] **Step 4: Rebuild and update symlink**

```bash
cd /Users/Charles/Projects/tuneup
deno task build
rm /usr/local/bin/amusic
ln -s /Users/Charles/Projects/tuneup/dist/tuneup /usr/local/bin/tuneup
```

- [ ] **Step 5: Update Homebrew tap repository**

In `CharlesWiltgen/homebrew-tap`:

- Rename `Formula/amusic.rb` → `Formula/tuneup.rb`
- Update class name and all references inside the formula
- Users will `brew install CharlesWiltgen/tap/tuneup`

- [ ] **Step 6: Update Claude Code memory and beads**

- Update `/Users/Charles/.claude/projects/` path references (new project path)
- Verify beads database works after rename

- [ ] **Step 7: Verify everything works**

```bash
tuneup --version
tuneup --help
deno test --allow-read --allow-run --allow-write --allow-env --allow-net
```

---

## Order of Operations

1. **Tasks 1–7**: Internal rename (do on a branch, merge to main)
2. **Task 8 Steps 1–2**: Rename GitHub repo + update remote
3. **Task 8 Step 3**: Rename local directory
4. **Task 8 Steps 4–7**: Rebuild, symlink, Homebrew, verify
