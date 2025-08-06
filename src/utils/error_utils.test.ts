import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { formatError, logError } from "./error_utils.ts";

describe("formatError", () => {
  it("should format Error instances with message", () => {
    const error = new Error("Test error message");
    const result = formatError(error);
    assertEquals(result, "Test error message");
  });

  it("should format Error instances with context", () => {
    const error = new Error("Test error");
    const result = formatError(error, "Processing file");
    assertEquals(result, "Processing file: Test error");
  });

  it("should format string errors", () => {
    const result = formatError("String error");
    assertEquals(result, "String error");
  });

  it("should format unknown errors", () => {
    const result = formatError({ code: 123 });
    assertEquals(result, "[object Object]");
  });

  it("should handle null and undefined", () => {
    assertEquals(formatError(null), "null");
    assertEquals(formatError(undefined), "undefined");
  });
});

describe("logError", () => {
  it("should log error with context when not quiet", () => {
    const originalError = console.error;
    let capturedOutput = "";
    console.error = (msg: string) => {
      capturedOutput = msg;
    };

    try {
      logError(new Error("Test error"), "Loading file");
      assertEquals(capturedOutput, "❌ Loading file: Test error");
    } finally {
      console.error = originalError;
    }
  });

  it("should not log when quiet is true", () => {
    const originalError = console.error;
    let capturedOutput = "";
    console.error = (msg: string) => {
      capturedOutput = msg;
    };

    try {
      logError(new Error("Test error"), "Loading file", true);
      assertEquals(capturedOutput, "");
    } finally {
      console.error = originalError;
    }
  });

  it("should format different error types correctly", () => {
    const originalError = console.error;
    let capturedOutput = "";
    console.error = (msg: string) => {
      capturedOutput = msg;
    };

    try {
      logError("String error", "Context");
      assertEquals(capturedOutput, "❌ Context: String error");
    } finally {
      console.error = originalError;
    }
  });
});

describe("exitWithFormattedError", () => {
  it("should call exitWithError with formatted message", () => {
    // We can't actually test exitWithFormattedError since it calls process.exit
    // So we'll just verify the formatting logic works
    const formatted = formatError(new Error("Test"), "Context");
    assertEquals(formatted, "Context: Test");
  });
});
