// @ts-nocheck: Complex mocking setup
import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  captureConsole,
  cleanupTestDir,
  createFetchSequence,
  createTestRunDir,
  MOCK_API_RESPONSES,
  MOCK_FINGERPRINTS,
  MockDenoCommand,
  restoreConsole,
  SAMPLE_FILES,
  setupTestFiles,
  TEST_API_KEYS,
} from "../test_utils/mod.ts";

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
      return;
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
      return;
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

Deno.test("defaultCommand unit tests", async (t) => {
  const { defaultCommand } = await import("./default.ts");

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
      const capture = captureConsole();
      try {
        await defaultCommand(
          { quiet: true, dryRun: true },
          ...files,
        );
      } finally {
        restoreConsole(capture);
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
      for (const _file of files) {
        MockDenoCommand.addMock("fpcalc", {
          code: 0,
          stdout: JSON.stringify({
            duration: 180,
            fingerprint: MOCK_FINGERPRINTS.DEFAULT,
          }),
        });
      }
      const fetchStub = createFetchSequence(
        files.map(() => ({ json: MOCK_API_RESPONSES.SUCCESS })),
      );
      const capture = captureConsole();
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
      } finally {
        restoreConsole(capture);
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
      for (const _file of files) {
        MockDenoCommand.addMock("fpcalc", {
          code: 0,
          stdout: JSON.stringify({
            duration: 180,
            fingerprint: MOCK_FINGERPRINTS.DEFAULT,
          }),
        });
      }
      const capture = captureConsole();
      try {
        await defaultCommand(
          { quiet: true, dryRun: true },
          ...files,
        );
      } finally {
        restoreConsole(capture);
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

      MockDenoCommand.setup();
      MockDenoCommand.addMock("fpcalc", { code: 1, stderr: "fpcalc error" });
      const capture = captureConsole();
      try {
        await defaultCommand(
          { quiet: true },
          ...files,
        );
      } finally {
        restoreConsole(capture);
        MockDenoCommand.restore();
        await cleanupTestDir(dir);
      }
    },
  );

  await t.step(
    "should suppress discovery and progress logs in quiet mode",
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
      const capture = captureConsole();
      try {
        await defaultCommand(
          { quiet: true, dryRun: true },
          ...files,
        );
        const discoveryOrProgressLogs = capture.logs.filter(
          (msg) =>
            msg.includes("Discovering audio files") ||
            (msg.includes("Processing ") && msg.includes("file") &&
              !msg.includes("Complete")) ||
            msg.includes("WARNING: No --api-key") ||
            msg.includes("Using API Key") ||
            msg.includes("Batch processing"),
        );
        assertEquals(discoveryOrProgressLogs, []);
      } finally {
        restoreConsole(capture);
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
      for (const _file of files) {
        MockDenoCommand.addMock("fpcalc", {
          code: 0,
          stdout: JSON.stringify({
            duration: 180,
            fingerprint: MOCK_FINGERPRINTS.DEFAULT,
          }),
        });
      }
      const fetchStub = createFetchSequence(
        files.map(() => ({ json: MOCK_API_RESPONSES.SUCCESS })),
      );
      const capture = captureConsole();
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
        const allOutput = capture.logs.join("\n");
        assert(
          allOutput.includes("Processing Complete"),
          `Expected summary in output, got: ${allOutput}`,
        );
      } finally {
        restoreConsole(capture);
        fetchStub.restore();
        MockDenoCommand.restore();
        await cleanupTestDir(dir);
      }
    },
  );

  await t.step(
    "should handle per-file errors in batch mode without crashing",
    async () => {
      const dir = await createTestRunDir("default_batch_error");
      const files = await setupTestFiles(dir, [
        SAMPLE_FILES.MP3,
        SAMPLE_FILES.FLAC,
      ]);

      // Mock fpcalc to fail — batch processing handles per-file errors
      // internally and continues, logging errors to stderr
      MockDenoCommand.setup();
      for (const _file of files) {
        MockDenoCommand.addMock("fpcalc", {
          code: 1,
          stderr: "fpcalc error",
        });
      }
      const fetchStub = createFetchSequence(
        files.map(() => ({ json: MOCK_API_RESPONSES.SUCCESS })),
      );
      const capture = captureConsole();
      try {
        await defaultCommand(
          {
            quiet: true,
            apiKey: TEST_API_KEYS.DUMMY,
            force: true,
          },
          ...files,
        );
        // Should complete without throwing — per-file errors are caught
        // internally by batchProcessAcoustIDTagging
        assert(
          capture.errors.length > 0,
          "Expected error output from per-file failures in batch mode",
        );
      } finally {
        restoreConsole(capture);
        fetchStub.restore();
        MockDenoCommand.restore();
        await cleanupTestDir(dir);
      }
    },
  );
});
