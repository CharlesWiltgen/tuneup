// @ts-nocheck: Complex mocking setup
import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { returnsNext, stub } from "@std/testing/mock";
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
import { extractMusicBrainzIds } from "./acoustid.ts";
import {
  getAcoustIDTags,
  writeAcoustIDTags,
  writeMusicBrainzTags,
} from "./tagging.ts";

// --- Test Suites ---
Deno.test("Acoustid Tests", async (t) => {
  // Setup mocks
  await t.step("Setup Mocks", () => {
    MockDenoCommand.setup();
  });

  // Test generateFingerprint directly from acoustid module
  await t.step("generateFingerprint", async (tInner) => {
    await tInner.step(
      "should return fingerprint string on fpcalc success",
      async () => {
        const { generateFingerprint } = await import("./acoustid.ts");
        const expectedFingerprint = MOCK_FINGERPRINTS.DEFAULT;
        MockDenoCommand.addMock("fpcalc", {
          code: 0,
          stdout: JSON.stringify({
            duration: 180,
            fingerprint: expectedFingerprint,
          }),
        });
        const result = await generateFingerprint("test.mp3");
        assertEquals(result, expectedFingerprint);

        // Check that -json flag was used
        const args = MockDenoCommand.getLastArgs("fpcalc");
        assertExists(args);
        assertEquals(args[0], "-json");
      },
    );

    await tInner.step(
      "should return null and log error on fpcalc failure",
      async () => {
        const { generateFingerprint } = await import("./acoustid.ts");
        MockDenoCommand.addMock("fpcalc", {
          code: 1,
          stderr: "fpcalc failed miserably",
        });
        const consoleErrorStub = stubConsole("error");
        try {
          const result = await generateFingerprint("test.mp3");
          assertEquals(result, null);
          assertEquals(consoleErrorStub.calls.length, 1);
          assertStringIncludes(
            consoleErrorStub.calls[0].args[0],
            "fpcalc error: fpcalc failed miserably",
          );
        } finally {
          consoleErrorStub.restore();
          MockDenoCommand.commandMocks.set("fpcalc", []);
        }
      },
    );

    await tInner.step(
      "should return null and log error on malformed fpcalc output",
      async () => {
        const { generateFingerprint } = await import("./acoustid.ts");
        MockDenoCommand.addMock("fpcalc", {
          code: 0,
          stdout: "WRONG_OUTPUT_FORMAT",
        });
        const consoleErrorStub = stubConsole("error");
        try {
          const result = await generateFingerprint("test.mp3");
          assertEquals(result, null);
          assertEquals(consoleErrorStub.calls.length, 1);
          assertStringIncludes(
            consoleErrorStub.calls[0].args[0],
            "Could not parse fpcalc JSON output:",
          );
        } finally {
          consoleErrorStub.restore();
          MockDenoCommand.commandMocks.set("fpcalc", []);
        }
      },
    );

    await tInner.step(
      "should return null if JSON is valid but fingerprint is missing",
      async () => {
        const { generateFingerprint } = await import("./acoustid.ts");
        MockDenoCommand.addMock("fpcalc", {
          code: 0,
          stdout: JSON.stringify({
            duration: 180,
            // fingerprint is missing
          }),
        });
        const consoleErrorStub = stubConsole("error");
        try {
          const result = await generateFingerprint("test.mp3");
          assertEquals(result, null);
          assertEquals(consoleErrorStub.calls.length, 1);
          assertStringIncludes(
            consoleErrorStub.calls[0].args[0],
            "No fingerprint found in fpcalc JSON output",
          );
        } finally {
          consoleErrorStub.restore();
          MockDenoCommand.commandMocks.set("fpcalc", []);
        }
      },
    );
  });

  // Test lookupFingerprint
  await t.step("lookupFingerprint", async (tInner) => {
    let fetchStub: ReturnType<typeof stub> | undefined;
    let consoleErrorStub: ReturnType<typeof stub> | undefined;
    const testApiKey = TEST_API_KEYS.DUMMY;
    const testFingerprint = MOCK_FINGERPRINTS.ALTERNATIVE;
    const testDuration = 180;

    const resetLookupStubs = () => {
      if (fetchStub) {
        fetchStub.restore();
        fetchStub = undefined;
      }
      if (consoleErrorStub) {
        consoleErrorStub.restore();
        consoleErrorStub = undefined;
      }
    };

    await tInner.step("should return parsed data on API success", async () => {
      const { lookupFingerprint } = await import("./acoustid.ts");
      resetLookupStubs();
      const mockResponse = MOCK_API_RESPONSES.SUCCESS;
      fetchStub = createFetchStub({ json: mockResponse });
      const result = await lookupFingerprint(
        testFingerprint,
        testDuration,
        testApiKey,
      );
      assertEquals(result, mockResponse);
      assertEquals(fetchStub.calls.length, 1);
      const url = fetchStub.calls[0].args[0] as string;
      assertStringIncludes(url, `client=${testApiKey}`);
      assertStringIncludes(url, `duration=${testDuration}`);
      assertStringIncludes(url, `fingerprint=${testFingerprint}`);
      resetLookupStubs();
    });

    await tInner.step(
      "should return {results: []} when API returns no results",
      async () => {
        const { lookupFingerprint } = await import("./acoustid.ts");
        resetLookupStubs();
        const mockResponse = MOCK_API_RESPONSES.NO_RESULTS;
        fetchStub = createFetchStub({ json: mockResponse });
        const result = await lookupFingerprint(
          testFingerprint,
          testDuration,
          testApiKey,
        );
        assertEquals(result, { results: [] });
        assertEquals(fetchStub.calls.length, 1);
        resetLookupStubs();
      },
    );

    await tInner.step(
      "should return null and log on API error (JSON status error)",
      async () => {
        const { lookupFingerprint } = await import("./acoustid.ts");
        resetLookupStubs();
        const mockResponse = MOCK_API_RESPONSES.ERROR;
        fetchStub = createFetchStub({ json: mockResponse });
        consoleErrorStub = stubConsole("error");
        const result = await lookupFingerprint(
          testFingerprint,
          testDuration,
          testApiKey,
        );
        assertEquals(result, null);
        assertEquals(fetchStub.calls.length, 1);
        assertEquals(consoleErrorStub.calls.length, 1);
        assertStringIncludes(
          consoleErrorStub.calls[0].args[0],
          "AcoustID API returned error: Invalid API key",
        );
        resetLookupStubs();
      },
    );

    await tInner.step(
      "should return null and log on API error (HTTP error)",
      async () => {
        const { lookupFingerprint } = await import("./acoustid.ts");
        resetLookupStubs();
        fetchStub = createFetchStub({
          status: 500,
          statusText: "Server Error",
          text: "Internal Server Error",
        });
        consoleErrorStub = stubConsole("error");
        const result = await lookupFingerprint(
          testFingerprint,
          testDuration,
          testApiKey,
        );
        assertEquals(result, null);
        assertEquals(fetchStub.calls.length, 1);
        assertEquals(consoleErrorStub.calls.length, 1);
        assertStringIncludes(
          consoleErrorStub.calls[0].args[0],
          "AcoustID API error: 500 Server Error",
        );
        resetLookupStubs();
      },
    );

    await tInner.step(
      "should return null and log on network error",
      async () => {
        const { lookupFingerprint } = await import("./acoustid.ts");
        resetLookupStubs();
        fetchStub = createFetchStub(new Error("Network connection failed"));
        consoleErrorStub = stubConsole("error");
        const result = await lookupFingerprint(
          testFingerprint,
          testDuration,
          testApiKey,
        );
        assertEquals(result, null);
        assertEquals(fetchStub.calls.length, 1);
        assertEquals(consoleErrorStub.calls.length, 1);
        assertStringIncludes(
          consoleErrorStub.calls[0].args[0],
          "Error during AcoustID API request: Network connection failed",
        );
        resetLookupStubs();
      },
    );

    await tInner.step(
      "should return null and log if API key is missing",
      async () => {
        const { lookupFingerprint } = await import("./acoustid.ts");
        resetLookupStubs();
        consoleErrorStub = stubConsole("error");
        const result = await lookupFingerprint(
          testFingerprint,
          testDuration,
          "",
        ); // Empty API key
        assertEquals(result, null);
        assertEquals(consoleErrorStub.calls.length, 1);
        assertStringIncludes(
          consoleErrorStub.calls[0].args[0],
          "AcoustID API key is required",
        );
        resetLookupStubs();
      },
    );
  });

  // Test processAcoustIDTagging integration with minimal mocking
  await t.step("processAcoustIDTagging", async (tInner) => {
    await tInner.step("should handle file not found", async () => {
      const { processAcoustIDTagging } = await import("./acoustid.ts");
      const statStub = stub(
        Deno,
        "stat",
        returnsNext([
          Promise.reject(new Error("File not found")),
        ]),
      );

      const consoleErrorStub = stubConsole("error");
      try {
        const result = await processAcoustIDTagging(
          "nonexistent.mp3",
          "apikey123",
          false,
          true, // quiet
          false,
        );

        assertEquals(result, "failed");
        assertEquals(consoleErrorStub.calls.length, 1);
        assertStringIncludes(
          consoleErrorStub.calls[0].args[0],
          "File not found",
        );
      } finally {
        statStub.restore();
        consoleErrorStub.restore();
      }
    });

    await tInner.step("should handle non-file path", async () => {
      const { processAcoustIDTagging } = await import("./acoustid.ts");
      const statStub = stub(
        Deno,
        "stat",
        returnsNext([
          Promise.resolve({ isFile: false } as Deno.FileInfo),
        ]),
      );

      const consoleErrorStub = stubConsole("error");
      try {
        const result = await processAcoustIDTagging(
          "somedir",
          "apikey123",
          false,
          true, // quiet
          false,
        );

        assertEquals(result, "failed");
        assertEquals(consoleErrorStub.calls.length, 1);
        assertStringIncludes(
          consoleErrorStub.calls[0].args[0],
          'Path "somedir" is not a file',
        );
      } finally {
        statStub.restore();
        consoleErrorStub.restore();
      }
    });

    // Skip the fingerprint generation failure test as it requires complex mocking
    // of the tagging module which now uses WASM caching
  });

  // Restore mocks
  await t.step("Restore Mocks", () => {
    MockDenoCommand.restore();
  });
});

Deno.test("extractMusicBrainzIds", async (t) => {
  await t.step("should extract all three IDs from a complete result", () => {
    const result = {
      results: [{
        id: "acoustid-123",
        score: 0.95,
        recordings: [{
          id: "mb-recording-123",
          artists: [{ id: "mb-artist-123", name: "Test" }],
          releasegroups: [{
            id: "rg-123",
            releases: [{ id: "mb-release-123", title: "Album" }],
          }],
        }],
      }],
    };
    assertEquals(extractMusicBrainzIds(result), {
      trackId: "mb-recording-123",
      artistId: "mb-artist-123",
      releaseId: "mb-release-123",
    });
  });

  await t.step("should return empty object when no recordings", () => {
    assertEquals(
      extractMusicBrainzIds({ results: [{ id: "x", score: 0.9 }] }),
      {},
    );
  });

  await t.step("should return partial IDs when some fields missing", () => {
    const result = {
      results: [{
        id: "x",
        score: 0.9,
        recordings: [{ id: "mb-rec", releasegroups: [] }],
      }],
    };
    assertEquals(extractMusicBrainzIds(result), { trackId: "mb-rec" });
  });

  await t.step("should return empty object for null/empty results", () => {
    assertEquals(extractMusicBrainzIds(null), {});
    assertEquals(extractMusicBrainzIds({ results: [] }), {});
  });
});

// --- batchProcessAcoustIDTagging Tests ---
Deno.test("batchProcessAcoustIDTagging", async (t) => {
  const {
    batchProcessAcoustIDTagging,
  } = await import("./acoustid.ts");

  const MOCK_API_WITH_RECORDINGS = {
    status: "ok",
    results: [{
      id: "acoustid-batch-123",
      score: 0.95,
      recordings: [{
        id: "mb-recording-batch-123",
        artists: [{ id: "mb-artist-batch-123", name: "Test Artist" }],
        releasegroups: [{
          id: "rg-batch-123",
          releases: [{ id: "mb-release-batch-123", title: "Test Album" }],
        }],
      }],
    }],
  };

  // Pre-warm taglib-wasm AND the simple API so subsequent tests don't need network
  await t.step("Setup: initialize taglib-wasm", async () => {
    const { ensureTagLib } = await import("./taglib_init.ts");
    await ensureTagLib();
    // Also pre-warm readMetadataBatch which has its own internal TagLib init
    const { readMetadataBatch } = await import(
      "@charlesw/taglib-wasm/simple"
    );
    const warmDir = await createTestRunDir("batch_prewarm");
    const warmFiles = await setupTestFiles(warmDir, [SAMPLE_FILES.MP3]);
    await readMetadataBatch(warmFiles, { continueOnError: true });
    await cleanupTestDir(warmDir);
  });

  await t.step(
    "should return 'failed' when fingerprint generation fails",
    async () => {
      const dir = await createTestRunDir("batch_fp_fail");
      const files = await setupTestFiles(dir, [SAMPLE_FILES.MP3]);
      MockDenoCommand.setup();
      MockDenoCommand.addMock("fpcalc", { code: 1, stderr: "fpcalc error" });
      const consoleErrorStub = stubConsole("error");
      try {
        const results = await batchProcessAcoustIDTagging(
          files,
          TEST_API_KEYS.DUMMY,
          { quiet: true, concurrency: 1, force: true },
        );
        assertEquals(results.get(files[0]), "failed");
      } finally {
        consoleErrorStub.restore();
        MockDenoCommand.restore();
        await cleanupTestDir(dir);
      }
    },
  );

  await t.step(
    "should return 'no_results' when API returns empty results",
    async () => {
      const dir = await createTestRunDir("batch_no_results");
      const files = await setupTestFiles(dir, [SAMPLE_FILES.MP3]);
      MockDenoCommand.setup();
      MockDenoCommand.addMock("fpcalc", {
        code: 0,
        stdout: JSON.stringify({
          duration: 180,
          fingerprint: MOCK_FINGERPRINTS.DEFAULT,
        }),
      });
      const fetchStub = createFetchStub({
        json: MOCK_API_RESPONSES.NO_RESULTS,
      });
      const consoleErrorStub = stubConsole("error");
      try {
        const results = await batchProcessAcoustIDTagging(
          files,
          TEST_API_KEYS.DUMMY,
          { quiet: true, concurrency: 1, force: true },
        );
        assertEquals(results.get(files[0]), "no_results");
      } finally {
        consoleErrorStub.restore();
        fetchStub.restore();
        MockDenoCommand.restore();
        await cleanupTestDir(dir);
      }
    },
  );

  await t.step(
    "should return 'lookup_failed' when API returns null",
    async () => {
      const dir = await createTestRunDir("batch_lookup_fail");
      const files = await setupTestFiles(dir, [SAMPLE_FILES.MP3]);
      MockDenoCommand.setup();
      MockDenoCommand.addMock("fpcalc", {
        code: 0,
        stdout: JSON.stringify({
          duration: 180,
          fingerprint: MOCK_FINGERPRINTS.DEFAULT,
        }),
      });
      const fetchStub = createFetchStub({
        status: 500,
        statusText: "Server Error",
        text: "Internal Server Error",
      });
      const consoleErrorStub = stubConsole("error");
      try {
        const results = await batchProcessAcoustIDTagging(
          files,
          TEST_API_KEYS.DUMMY,
          { quiet: true, concurrency: 1, force: true },
        );
        assertEquals(results.get(files[0]), "lookup_failed");
      } finally {
        consoleErrorStub.restore();
        fetchStub.restore();
        MockDenoCommand.restore();
        await cleanupTestDir(dir);
      }
    },
  );

  await t.step("should call onProgress callback", async () => {
    const dir = await createTestRunDir("batch_progress");
    const files = await setupTestFiles(dir, [SAMPLE_FILES.MP3]);
    MockDenoCommand.setup();
    MockDenoCommand.addMock("fpcalc", {
      code: 0,
      stdout: JSON.stringify({
        duration: 180,
        fingerprint: MOCK_FINGERPRINTS.DEFAULT,
      }),
    });
    const fetchStub = createFetchStub({ json: MOCK_API_WITH_RECORDINGS });
    const consoleErrorStub = stubConsole("error");
    const progressCalls: { processed: number; total: number; file: string }[] =
      [];
    try {
      await batchProcessAcoustIDTagging(
        files,
        TEST_API_KEYS.DUMMY,
        {
          quiet: true,
          concurrency: 1,
          onProgress: (processed, total, currentFile) => {
            progressCalls.push({
              processed,
              total,
              file: currentFile,
            });
          },
        },
      );
      assertEquals(progressCalls.length, 1);
      assertEquals(progressCalls[0].total, files.length);
      assertEquals(progressCalls[0].file, files[0]);
    } finally {
      consoleErrorStub.restore();
      fetchStub.restore();
      MockDenoCommand.restore();
      await cleanupTestDir(dir);
    }
  });

  await t.step(
    "should not write tags in dryRun mode",
    async () => {
      const dir = await createTestRunDir("batch_dryrun");
      const files = await setupTestFiles(dir, [SAMPLE_FILES.MP3]);

      // Record existing tag values before batch call
      const tagsBefore = await getAcoustIDTags(files[0]);

      MockDenoCommand.setup();
      MockDenoCommand.addMock("fpcalc", {
        code: 0,
        stdout: JSON.stringify({
          duration: 180,
          fingerprint: MOCK_FINGERPRINTS.DEFAULT,
        }),
      });
      const fetchStub = createFetchStub({ json: MOCK_API_WITH_RECORDINGS });
      const consoleErrorStub = stubConsole("error");
      try {
        await batchProcessAcoustIDTagging(
          files,
          TEST_API_KEYS.DUMMY,
          { quiet: true, concurrency: 1, dryRun: true, force: true },
        );

        // Tags should be unchanged after dry run
        MockDenoCommand.restore();
        fetchStub.restore();
        const tagsAfter = await getAcoustIDTags(files[0]);
        assertEquals(tagsAfter, tagsBefore);
      } finally {
        consoleErrorStub.restore();
        try {
          fetchStub.restore();
        } catch { /* already restored */ }
        try {
          MockDenoCommand.restore();
        } catch { /* already restored */ }
        await cleanupTestDir(dir);
      }
    },
  );

  await t.step(
    "should return 'skipped' for files with existing AcoustID and MusicBrainz tags",
    async () => {
      const dir = await createTestRunDir("batch_skipped");
      const files = await setupTestFiles(dir, [SAMPLE_FILES.MP3]);

      // Pre-write tags to simulate existing tagged file
      await writeAcoustIDTags(files[0], "existing-fp", "existing-id");
      await writeMusicBrainzTags(files[0], {
        trackId: "existing-track",
        artistId: "existing-artist",
      });

      MockDenoCommand.setup();
      const consoleErrorStub = stubConsole("error");
      try {
        const results = await batchProcessAcoustIDTagging(
          files,
          TEST_API_KEYS.DUMMY,
          { quiet: true, concurrency: 1, force: false },
        );
        assertEquals(results.get(files[0]), "skipped");
      } finally {
        consoleErrorStub.restore();
        MockDenoCommand.restore();
        await cleanupTestDir(dir);
      }
    },
  );
});
