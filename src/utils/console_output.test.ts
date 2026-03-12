import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { returnsNext, stub } from "@std/testing/mock";
import { captureConsole, restoreConsole } from "../test_utils/mod.ts";
import {
  exitWithError,
  logError,
  logProcessingInfo,
  validateAudioFiles,
  validateDirectory,
  validateFiles,
} from "./console_output.ts";
import type { CommandOptions } from "../types/command.ts";

describe("logProcessingInfo", () => {
  it("should log warning when no API key is provided", () => {
    const capture = captureConsole();
    try {
      const options: CommandOptions = { quiet: false };
      logProcessingInfo(options, 5);
      const allOutput = capture.logs.join("\n");
      assertStringIncludes(allOutput, "WARNING");
      assertStringIncludes(allOutput, "fingerprint-only mode");
    } finally {
      restoreConsole(capture);
    }
  });

  it("should log file count", () => {
    const capture = captureConsole();
    try {
      const fileCount = 42;
      const options: CommandOptions = { quiet: false, apiKey: "test-key-123" };
      logProcessingInfo(options, fileCount);
      const allOutput = capture.logs.join("\n");
      assertStringIncludes(allOutput, `${fileCount}`);
    } finally {
      restoreConsole(capture);
    }
  });

  it("should not log anything when quiet is true", () => {
    const capture = captureConsole();
    try {
      const options: CommandOptions = { quiet: true };
      logProcessingInfo(options, 10);
      assertEquals(capture.logs.length, 0);
    } finally {
      restoreConsole(capture);
    }
  });

  it("should show truncated API key when provided", () => {
    const capture = captureConsole();
    try {
      const apiKey = "abcde12345";
      const options: CommandOptions = { quiet: false, apiKey };
      logProcessingInfo(options, 1);
      const allOutput = capture.logs.join("\n");
      assertStringIncludes(allOutput, "abcde...");
    } finally {
      restoreConsole(capture);
    }
  });
});

describe("logError", () => {
  it("should log to stderr", () => {
    const capture = captureConsole();
    try {
      const message = "Test error message";
      logError(message);
      assertEquals(capture.errors.length, 1);
      assertEquals(capture.errors[0], message);
    } finally {
      restoreConsole(capture);
    }
  });
});

describe("exitWithError", () => {
  it("should log error and call Deno.exit with given code", () => {
    const capture = captureConsole();
    const exitStub = stub(Deno, "exit", () => {
      throw new Error("EXIT_CALLED");
    });
    try {
      exitWithError("fatal error", 2);
    } catch (e) {
      assertEquals((e as Error).message, "EXIT_CALLED");
    } finally {
      restoreConsole(capture);
      exitStub.restore();
    }
    assertEquals(capture.errors.length, 1);
    assertStringIncludes(capture.errors[0], "fatal error");
    assertEquals(exitStub.calls.length, 1);
    assertEquals(exitStub.calls[0].args[0], 2);
  });

  it("should default to exit code 1", () => {
    const capture = captureConsole();
    const exitStub = stub(Deno, "exit", () => {
      throw new Error("EXIT_CALLED");
    });
    try {
      exitWithError("error");
    } catch {
      /* expected */
    } finally {
      restoreConsole(capture);
      exitStub.restore();
    }
    assertEquals(exitStub.calls[0].args[0], 1);
  });
});

describe("validateDirectory", () => {
  it("should reject non-directory paths", async () => {
    const statStub = stub(
      Deno,
      "stat",
      returnsNext([
        Promise.resolve({ isDirectory: false } as Deno.FileInfo),
      ]),
    );
    const capture = captureConsole();
    const exitStub = stub(Deno, "exit", () => {
      throw new Error("EXIT_CALLED");
    });
    try {
      await validateDirectory("/path/to/file.txt");
    } catch {
      /* expected */
    } finally {
      restoreConsole(capture);
      exitStub.restore();
      statStub.restore();
    }
    // exitWithError throws from our stub, which triggers .catch() calling exit again
    // In production Deno.exit() halts, so .catch() never fires
    assert(exitStub.calls.length >= 1);
    assertStringIncludes(capture.errors[0], "not a directory");
  });

  it("should reject non-existent paths", async () => {
    const statStub = stub(
      Deno,
      "stat",
      returnsNext([
        Promise.reject(new Error("not found")),
      ]),
    );
    const capture = captureConsole();
    const exitStub = stub(Deno, "exit", () => {
      throw new Error("EXIT_CALLED");
    });
    try {
      await validateDirectory("/nonexistent");
    } catch {
      /* expected */
    } finally {
      restoreConsole(capture);
      exitStub.restore();
      statStub.restore();
    }
    assert(exitStub.calls.length >= 1);
    assertStringIncludes(capture.errors[0], "Directory not found");
  });
});

describe("validateFiles", () => {
  it("should exit for empty array", () => {
    const capture = captureConsole();
    const exitStub = stub(Deno, "exit", () => {
      throw new Error("EXIT_CALLED");
    });
    try {
      validateFiles([]);
    } catch {
      /* expected */
    } finally {
      restoreConsole(capture);
      exitStub.restore();
    }
    assertEquals(exitStub.calls.length, 1);
    assertStringIncludes(capture.errors[0], "No files specified");
  });

  it("should not exit for non-empty array", () => {
    const exitStub = stub(Deno, "exit", () => {
      throw new Error("EXIT_CALLED");
    });
    try {
      validateFiles(["file1.mp3", "file2.mp3"]);
      assertEquals(exitStub.calls.length, 0);
    } finally {
      exitStub.restore();
    }
  });
});

describe("validateAudioFiles", () => {
  it("should exit for empty array", () => {
    const capture = captureConsole();
    const exitStub = stub(Deno, "exit", () => {
      throw new Error("EXIT_CALLED");
    });
    try {
      validateAudioFiles([]);
    } catch {
      /* expected */
    } finally {
      restoreConsole(capture);
      exitStub.restore();
    }
    assertEquals(exitStub.calls.length, 1);
    assertStringIncludes(capture.errors[0], "No supported audio files");
  });

  it("should not exit for non-empty array", () => {
    const exitStub = stub(Deno, "exit", () => {
      throw new Error("EXIT_CALLED");
    });
    try {
      validateAudioFiles(["song.flac"]);
      assertEquals(exitStub.calls.length, 0);
    } finally {
      exitStub.restore();
    }
  });
});
