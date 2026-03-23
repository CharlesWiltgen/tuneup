import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { ProgressReporter } from "./progress_reporter.ts";

describe("ProgressReporter", () => {
  // Helper to capture stdout
  function captureStdout(fn: () => void): string {
    const originalWrite = Deno.stdout.writeSync;
    const chunks: Uint8Array[] = [];

    Deno.stdout.writeSync = (p: Uint8Array) => {
      chunks.push(p.slice());
      return p.length;
    };

    try {
      fn();
    } finally {
      Deno.stdout.writeSync = originalWrite;
    }

    const decoder = new TextDecoder();
    return chunks.map((chunk) => decoder.decode(chunk)).join("");
  }

  it("should hide cursor on construction when not quiet", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter();
      reporter.dispose(); // Clean up
    });

    // Should contain hide cursor sequence
    assertEquals(output.includes("\x1b[?25l"), true);
  });

  it("should not hide cursor when quiet option is true", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter({ quiet: true });
      reporter.dispose();
    });

    // Should not contain hide cursor sequence
    assertEquals(output.includes("\x1b[?25l"), false);
  });

  it("should update progress with percentage", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter();
      reporter.update(5, 10);
      reporter.dispose();
    });

    // Should contain progress update with 50%
    assertEquals(output.includes("5/10 (50%)"), true);
    // Should clear line before update
    assertEquals(output.includes("\x1b[2K\r"), true);
  });

  it("should update progress with custom message", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter();
      reporter.update(3, 10, "Encoding files");
      reporter.dispose();
    });

    assertEquals(output.includes("Encoding files: 3/10 (30%)"), true);
  });

  it("should not output when quiet", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter({ quiet: true });
      reporter.update(5, 10);
      reporter.complete("Done");
      reporter.section("Test");
    });

    // Should have no output except for potential cursor control
    assertEquals(output, "");
  });

  it("should complete with success message", () => {
    let consoleOutput = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      consoleOutput = msg;
    };

    try {
      const reporter = new ProgressReporter();
      reporter.complete("All files processed");
      reporter.dispose();

      assertEquals(consoleOutput, "\x1b[2K\r✅ All files processed");
    } finally {
      console.log = originalLog;
    }
  });

  it("should show cursor on dispose", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter();
      reporter.dispose();
    });

    // Should contain show cursor sequence
    assertEquals(output.includes("\x1b[?25h"), true);
  });

  it("should handle section headers", () => {
    let consoleOutput = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      consoleOutput = msg;
    };

    try {
      const reporter = new ProgressReporter();
      reporter.section("Processing Album");
      reporter.dispose();

      assertEquals(consoleOutput, "\n--- Processing Album ---");
    } finally {
      console.log = originalLog;
    }
  });

  it("should write to stderr when stream is stderr", () => {
    const chunks: Uint8Array[] = [];
    const originalWrite = Deno.stderr.writeSync;
    Deno.stderr.writeSync = (p: Uint8Array) => {
      chunks.push(p.slice());
      return p.length;
    };
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

  it("should clear current line before updating", () => {
    const output = captureStdout(() => {
      const reporter = new ProgressReporter();
      reporter.update(1, 3);
      reporter.update(2, 3);
      reporter.dispose();
    });

    // Should have multiple clear line sequences
    // deno-lint-ignore no-control-regex
    const clearCount = (output.match(/\x1b\[2K\r/g) || []).length;
    assertEquals(clearCount >= 2, true);
  });
});
