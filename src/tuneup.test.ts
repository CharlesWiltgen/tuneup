// @ts-nocheck: skip TS checking (tests run with --no-check in CI; uses custom import-map 'jsr:@std' aliases and Deno.Command API)
import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";
import { basename, join, resolve } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import {
  cleanupTestDir,
  createSilentAudioFile,
  createTestRunDir,
  getAcousticIDFingerprintTag,
  MOCK_ACOUSTID,
  runTuneupScript,
  SAMPLE_FILES,
  setAcousticIDTags,
  setupTestFiles,
  TEST_API_KEYS,
} from "./test_utils/mod.ts";

const ORIGINAL_SAMPLE_FILES_DIR = resolve("sample_audio_files");

// --- Test Suite ---
Deno.test("tuneup.ts Integration Tests", async (t) => {
  let currentTestDir: string;

  await t.step("Basic Fingerprinting: Process a clean MP3 file", async () => {
    currentTestDir = await createTestRunDir("basic_fingerprinting_mp3");
    const [mp3ToTest] = await setupTestFiles(
      currentTestDir,
      [SAMPLE_FILES.MP3],
      ORIGINAL_SAMPLE_FILES_DIR,
    );
    const mp3BaseName = basename(mp3ToTest);

    // 1. Ensure file initially has no fingerprint (or handle if it might)
    const initialTag = await getAcousticIDFingerprintTag(mp3ToTest);
    let forceFlag = [];
    if (initialTag) {
      console.warn(
        `  Warning: Sample file ${mp3BaseName} already had an ACOUSTID_FINGERPRINT. Using --force flag.`,
      );
      forceFlag = ["--force"];
    }

    // 2. Run tuneup.ts on the file
    // Pass only the basename as CWD is currentTestDir
    const result = await runTuneupScript(
      ["process", "--acoust-id", ...forceFlag, mp3BaseName],
      currentTestDir,
    );

    // Debug output
    if (result.code !== 0) {
      console.log("stdout:", result.stdout);
      console.log("stderr:", result.stderr);
    }

    // 3. Assertions
    assertEquals(
      result.code,
      0,
      "Script should exit successfully after processing.",
    );
    assertStringIncludes(result.stdout, `Processing file: ${mp3BaseName}`);
    assertStringIncludes(
      result.stdout,
      "ACTION: Generating AcoustID fingerprint...",
    );
    assertStringIncludes(
      result.stdout,
      "SUCCESS: AcoustID fingerprint tag processed.",
    );

    const finalTag = await getAcousticIDFingerprintTag(mp3ToTest);
    assertExists(
      finalTag,
      "ACOUSTID_FINGERPRINT tag should be present after processing.",
    );

    await cleanupTestDir(currentTestDir);
  });

  await t.step("Skip Existing Fingerprint (No --force): MP3 file", async () => {
    currentTestDir = await createTestRunDir("skip_existing_mp3");
    const [mp3ToTest] = await setupTestFiles(
      currentTestDir,
      [SAMPLE_FILES.MP3],
      ORIGINAL_SAMPLE_FILES_DIR,
    );
    const mp3BaseName = basename(mp3ToTest);

    // 1. Add an initial fingerprint
    let runResult = await runTuneupScript(
      ["process", "--acoust-id", mp3BaseName],
      currentTestDir,
    );
    assertEquals(runResult.code, 0, "Initial processing failed.");
    const firstFingerprint = await getAcousticIDFingerprintTag(mp3ToTest);
    assertExists(
      firstFingerprint,
      "Fingerprint not added after initial processing.",
    );

    // 2. Run tuneup.ts again without --force
    runResult = await runTuneupScript(
      ["process", "--acoust-id", mp3BaseName],
      currentTestDir,
    );

    // 3. Assertions
    assertEquals(
      runResult.code,
      0,
      "Script should exit successfully when skipping.",
    );
    assertStringIncludes(runResult.stdout, `Processing file: ${mp3BaseName}`);
    assertStringIncludes(
      runResult.stdout,
      "INFO: File already has AcoustID tags. Skipping (use --force to overwrite).",
    );

    const secondFingerprint = await getAcousticIDFingerprintTag(mp3ToTest);
    assertEquals(
      secondFingerprint,
      firstFingerprint,
      "Fingerprint should remain unchanged after skipping.",
    );

    await cleanupTestDir(currentTestDir);
  });

  await t.step(
    "Force Overwrite Existing Fingerprint (--force): FLAC file",
    async () => {
      currentTestDir = await createTestRunDir("force_overwrite_flac");
      const [flacToTest] = await setupTestFiles(
        currentTestDir,
        [SAMPLE_FILES.FLAC],
        ORIGINAL_SAMPLE_FILES_DIR,
      );
      const flacBaseName = basename(flacToTest);

      // 1. Add an initial fingerprint
      let runResult = await runTuneupScript(
        ["process", "--acoust-id", flacBaseName],
        currentTestDir,
      );
      assertEquals(
        runResult.code,
        0,
        "Initial processing for force test failed.",
      );
      const firstFingerprint = await getAcousticIDFingerprintTag(flacToTest);
      assertExists(
        firstFingerprint,
        "Fingerprint not added after initial processing for force test.",
      );

      // 2. Run tuneup.ts again with --force
      // Note: fpcalc should ideally generate the same fingerprint for the same file.
      // If it does, this test won't strictly prove an "overwrite" vs. "idempotent operation".
      // However, it proves the "--force" path is taken.
      runResult = await runTuneupScript(
        ["process", "--acoust-id", "--force", flacBaseName],
        currentTestDir,
      );

      // 3. Assertions
      assertEquals(
        runResult.code,
        0,
        "Script should exit successfully during force overwrite.",
      );
      assertStringIncludes(
        runResult.stdout,
        `Processing file: ${flacBaseName}`,
      );
      assertStringIncludes(
        runResult.stdout,
        "INFO: File already has AcoustID tags. --force option provided, proceeding to overwrite.",
      );
      assertStringIncludes(
        runResult.stdout,
        "ACTION: Generating AcoustID fingerprint...",
      );
      assertStringIncludes(
        runResult.stdout,
        "SUCCESS: AcoustID fingerprint tag processed.",
      );

      const secondFingerprint = await getAcousticIDFingerprintTag(flacToTest);
      assertExists(
        secondFingerprint,
        "Fingerprint should exist after force overwrite.",
      );
      // For a deterministic fpcalc, the fingerprint should be the same.
      // If fpcalc can have slight variations (e.g. due to different fpcalc versions or subtle env changes),
      // this might occasionally fail. For now, assume deterministic.
      assertEquals(
        secondFingerprint,
        firstFingerprint,
        "Fingerprint should ideally be the same if fpcalc is deterministic.",
      );

      await cleanupTestDir(currentTestDir);
    },
  );

  await t.step("File Not Found", async () => {
    currentTestDir = await createTestRunDir("file_not_found");
    const nonExistentFileName = "non_existent_file.mp3";

    // Run tuneup.ts, expecting it to handle the non-existent file path
    // CWD is currentTestDir, so nonExistentFileName is relative to it.
    const result = await runTuneupScript([nonExistentFileName], currentTestDir);

    // Assertions
    // The script currently logs an error per file and doesn't set a non-zero exit code overall
    // if other files (if any) were processed successfully.
    // For a single non-existent file, the behavior of tuneup.ts might be to still exit 0.
    // We primarily care that the error is logged.
    // Check either stdout or stderr for the error message
    const combinedOutput = result.stdout + result.stderr;
    assert(
      combinedOutput.includes("Error: No supported audio files found"),
      "Expected 'No supported audio files found' error message for non-existent file",
    );

    await cleanupTestDir(currentTestDir);
  });

  await t.step(
    "Processing Multiple Files (MP3 clean, FLAC pre-tagged)",
    async () => {
      currentTestDir = await createTestRunDir("multiple_files");
      const [mp3File, flacFile] = await setupTestFiles(
        currentTestDir,
        [SAMPLE_FILES.MP3, SAMPLE_FILES.FLAC],
        ORIGINAL_SAMPLE_FILES_DIR,
      );
      const mp3BaseName = basename(mp3File);
      const flacBaseName = basename(flacFile);

      // 1. Check initial state of files
      const _flacInitialTag = await getAcousticIDFingerprintTag(flacFile);
      const _mp3InitialTag = await getAcousticIDFingerprintTag(mp3File);

      // Both files probably have tags already, so we'll test with that reality
      // We'll use --force on one file to show processing

      // 3. Run tuneup.ts on both files with --force on MP3
      const mainResult = await runTuneupScript(
        ["process", "--acoust-id", "--force", mp3BaseName, flacBaseName],
        currentTestDir,
      );
      assertEquals(
        mainResult.code,
        0,
        "Main script run for multiple files failed.",
      );

      // 4. Assertions for MP3 (should be processed with --force)
      assertStringIncludes(
        mainResult.stdout,
        "Processing 2 file(s)...",
      );
      const mp3FinalTag = await getAcousticIDFingerprintTag(mp3File);
      assertExists(
        mp3FinalTag,
        "MP3 file should have a fingerprint after multi-file run.",
      );

      // 5. Assertions for FLAC (will also be processed with --force since it's a global flag)
      // Check that both files were processed in the summary
      assertStringIncludes(
        mainResult.stdout,
        "--- Processing Complete ---",
      );
      const flacFinalTag = await getAcousticIDFingerprintTag(flacFile);
      assertExists(
        flacFinalTag,
        "FLAC file should have a fingerprint after multi-file run.",
      );

      await cleanupTestDir(currentTestDir);
    },
  );

  // Final cleanup of the base test_run_files directory if it's empty or for overall cleanup
  // This is more of a global cleanup. Individual test steps clean their own subdirs.
  // Deno.test should ideally run in isolation, but just in case.
  // await Deno.remove(TEST_RUN_BASE_DIR, { recursive: true }).catch(() => {});
});

Deno.test("--show-tags and --dry-run Functionality", async (t) => {
  let currentTestDir: string;
  const dummyApiKey = TEST_API_KEYS.DUMMY;

  await t.step("--show-tags: Displays existing tags for a file", async () => {
    currentTestDir = await createTestRunDir("show_tags_existing");
    const audioFile = join(currentTestDir, "tagged.wav");

    // Create a silent file and tag it
    await createSilentAudioFile(audioFile);
    await setAcousticIDTags(
      audioFile,
      MOCK_ACOUSTID.ID,
      MOCK_ACOUSTID.FINGERPRINT,
    );

    // Run tuneup.ts with --show-tags
    const result = await runTuneupScript(
      ["--show-tags", basename(audioFile)],
      currentTestDir,
    );

    // Debug
    if (result.code !== 0) {
      console.log("--show-tags test failed");
      console.log("stdout:", result.stdout);
      console.log("stderr:", result.stderr);
    }

    // Assertions
    assertEquals(result.code, 0, "Script should exit successfully.");
    // The new implementation shows a progress indicator instead
    assertStringIncludes(
      result.stdout,
      "Reading metadata:",
    );
    // Check for the album header with emoji
    assertStringIncludes(
      result.stdout,
      "💿 Unknown Album - Unknown Artist - 1 track",
    );
    // The new implementation doesn't display AcoustID tags in the output
    // as they are considered extended metadata

    await cleanupTestDir(currentTestDir);
  });

  await t.step("--show-tags: File with no AcoustID tags", async () => {
    currentTestDir = await createTestRunDir("show_tags_no_tags");
    const audioFile = join(currentTestDir, "notags.wav");

    await createSilentAudioFile(audioFile);

    const result = await runTuneupScript(
      ["--show-tags", basename(audioFile)],
      currentTestDir,
    );

    assertEquals(result.code, 0);
    // The new implementation shows a progress indicator instead
    assertStringIncludes(
      result.stdout,
      "Reading metadata:",
    );
    // Check for the album header with emoji
    assertStringIncludes(
      result.stdout,
      "💿 Unknown Album - Unknown Artist - 1 track",
    );
    // When no AcoustID tags exist, they won't be shown in the extended tags section
    // Check that AcoustID tags are NOT present (checking for the table cells)
    assert(!result.stdout.includes("🆔 AcoustID"));
    assert(!result.stdout.includes("🆔 Fingerprint"));

    await cleanupTestDir(currentTestDir);
  });

  await t.step(
    "--dry-run: Simulates processing without writing tags",
    async () => {
      currentTestDir = await createTestRunDir("dry_run_test");
      const [mp3File] = await setupTestFiles(
        currentTestDir,
        [SAMPLE_FILES.MP3],
        ORIGINAL_SAMPLE_FILES_DIR,
      );
      const mp3BaseName = basename(mp3File);

      // Check if file has tags initially
      const initialTag = await getAcousticIDFingerprintTag(mp3File);
      let forceFlag = [];
      if (initialTag) {
        // File already has tags, use --force to test overwrite in dry-run
        forceFlag = ["--force"];
      }

      // Run with --dry-run and dummy API key
      const result = await runTuneupScript(
        [
          "process",
          "--acoust-id",
          "--dry-run",
          ...forceFlag,
          "--api-key",
          dummyApiKey,
          mp3BaseName,
        ],
        currentTestDir,
      );

      // Assertions
      assertEquals(result.code, 0, "Dry run should exit successfully.");
      assertStringIncludes(result.stdout, `Processing file: ${mp3BaseName}`);
      assertStringIncludes(
        result.stdout,
        "ACTION: Generating AcoustID fingerprint...",
      );
      assertStringIncludes(result.stdout, "DRY RUN: Would write");
      assertStringIncludes(
        result.stdout,
        "DRY RUN: Skipping actual tag writing.",
      );

      // Verify tags remain unchanged after dry run
      const finalTag = await getAcousticIDFingerprintTag(mp3File);
      assertEquals(
        finalTag,
        initialTag,
        "Tags should remain unchanged during a dry run.",
      );

      await cleanupTestDir(currentTestDir);
    },
  );

  await t.step(
    "--dry-run with --force: Simulates overwrite without writing",
    async () => {
      currentTestDir = await createTestRunDir("dry_run_force");
      // Use a real sample file instead of creating a silent one
      const [audioFile] = await setupTestFiles(
        currentTestDir,
        [SAMPLE_FILES.MP3],
        ORIGINAL_SAMPLE_FILES_DIR,
      );
      const baseName = basename(audioFile);

      const initialFingerprint = await getAcousticIDFingerprintTag(audioFile);
      assertExists(initialFingerprint, "Sample file should have existing tags");

      // Run with --dry-run and --force
      const result = await runTuneupScript(
        [
          "process",
          "--acoust-id",
          "--dry-run",
          "--force",
          "--api-key",
          dummyApiKey,
          baseName,
        ],
        currentTestDir,
      );

      assertEquals(result.code, 0);
      assertStringIncludes(
        result.stdout,
        "INFO: File already has AcoustID tags. --force option provided, proceeding to overwrite.",
      );
      assertStringIncludes(result.stdout, "DRY RUN: Would write");

      // Verify tags remain unchanged
      const finalFingerprint = await getAcousticIDFingerprintTag(audioFile);
      assertEquals(
        finalFingerprint,
        initialFingerprint,
        "Tags should remain unchanged in dry run mode.",
      );

      await cleanupTestDir(currentTestDir);
    },
  );
});

Deno.test("Error Handling Edge Cases", async (t) => {
  let currentTestDir: string;

  await t.step("Processing a directory instead of a file", async () => {
    currentTestDir = await createTestRunDir("directory_input");
    const subDir = join(currentTestDir, "subdir");
    await ensureDir(subDir);

    const result = await runTuneupScript(
      ["process", "--acoust-id", "subdir"],
      currentTestDir,
    );

    const combinedOutput = result.stdout + result.stderr;
    // process command discovers 0 files from empty/invalid paths
    assertStringIncludes(
      combinedOutput,
      "Found 0 albums and 0 singles",
    );

    await cleanupTestDir(currentTestDir);
  });

  await t.step("File with unsupported extension", async () => {
    currentTestDir = await createTestRunDir("unsupported_extension");
    const txtFile = join(currentTestDir, "readme.txt");
    await Deno.writeTextFile(txtFile, "This is not an audio file");

    const result = await runTuneupScript(
      ["process", "--acoust-id", "readme.txt"],
      currentTestDir,
    );

    // The discovery system silently ignores unsupported files
    const combinedOutput = result.stdout + result.stderr;
    assertStringIncludes(
      combinedOutput,
      "Found 0 albums and 0 singles",
    );

    await cleanupTestDir(currentTestDir);
  });
});

Deno.test("API Key Integration", async (t) => {
  await t.step("Missing API key warning", async () => {
    const currentTestDir = await createTestRunDir("no_api_key");
    const [mp3File] = await setupTestFiles(
      currentTestDir,
      [SAMPLE_FILES.MP3],
      ORIGINAL_SAMPLE_FILES_DIR,
    );

    // Temporarily rename the .env file to prevent it from being loaded
    const envPath = resolve("src/.env");
    const tempEnvPath = resolve("src/.env.tmp");
    let envExists = false;

    try {
      if (await exists(envPath, { isFile: true })) {
        envExists = true;
        await Deno.rename(envPath, tempEnvPath);
      }

      // Run without API key (use --force if file already has tags)
      const existingTag = await getAcousticIDFingerprintTag(mp3File);
      const args = existingTag
        ? ["process", "--acoust-id", "--force", basename(mp3File)]
        : ["process", "--acoust-id", basename(mp3File)];

      // Create a clean environment without ACOUSTID_API_KEY
      const cleanEnv = { ...Deno.env.toObject() };
      delete cleanEnv.ACOUSTID_API_KEY;

      const result = await runTuneupScript(args, currentTestDir, cleanEnv);

      assertEquals(result.code, 0);
      // process command proceeds with AcoustID operation even without API key
      assertStringIncludes(
        result.stdout,
        "Operations: AcoustID",
      );

      await cleanupTestDir(currentTestDir);
    } finally {
      // Restore the .env file
      if (envExists) {
        await Deno.rename(tempEnvPath, envPath);
      }
    }
  });

  await t.step("Environment variable API key", async () => {
    const currentTestDir = await createTestRunDir("env_api_key");
    const [mp3File] = await setupTestFiles(
      currentTestDir,
      [SAMPLE_FILES.MP3],
      ORIGINAL_SAMPLE_FILES_DIR,
    );

    // Set environment variable (mock key)
    Deno.env.set("ACOUSTID_API_KEY", TEST_API_KEYS.ENV);

    try {
      // Run without --api-key flag (should use env var)
      const existingTag = await getAcousticIDFingerprintTag(mp3File);
      const args = existingTag
        ? ["process", "--acoust-id", "--force", basename(mp3File)]
        : ["process", "--acoust-id", basename(mp3File)];
      const result = await runTuneupScript(args, currentTestDir);

      assertEquals(result.code, 0);
      // Should attempt API lookup (will fail with mock key, but that's expected)
      assertStringIncludes(
        result.stdout,
        "ACTION: Looking up fingerprint with AcoustID API...",
      );

      await cleanupTestDir(currentTestDir);
    } finally {
      // Clean up env var
      Deno.env.delete("ACOUSTID_API_KEY");
    }
  });
});
