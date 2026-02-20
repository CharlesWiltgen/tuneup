import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  EASY_MODE_SUMMARY,
  ENCODING_SUMMARY,
  OperationStats,
  PROCESSING_SUMMARY,
} from "./operation_stats.ts";

describe("OperationStats", () => {
  describe("increment / get", () => {
    it("should start at zero for unknown keys", () => {
      const stats = new OperationStats();
      assertEquals(stats.get("processed"), 0);
    });

    it("should increment a counter by 1 by default", () => {
      const stats = new OperationStats();
      stats.increment("processed");
      assertEquals(stats.get("processed"), 1);
    });

    it("should increment a counter by a custom amount", () => {
      const stats = new OperationStats();
      stats.increment("processed", 5);
      assertEquals(stats.get("processed"), 5);
    });

    it("should accumulate multiple increments", () => {
      const stats = new OperationStats();
      stats.increment("processed");
      stats.increment("processed");
      stats.increment("processed", 3);
      assertEquals(stats.get("processed"), 5);
    });
  });

  describe("incrementSub / getSub / getSubTotal", () => {
    it("should start at zero for unknown sub-keys", () => {
      const stats = new OperationStats();
      assertEquals(stats.getSub("skipped", "already_m4a"), 0);
    });

    it("should increment a sub-counter", () => {
      const stats = new OperationStats();
      stats.incrementSub("skipped", "already_m4a");
      assertEquals(stats.getSub("skipped", "already_m4a"), 1);
    });

    it("should track multiple sub-keys independently", () => {
      const stats = new OperationStats();
      stats.incrementSub("skipped", "already_m4a", 2);
      stats.incrementSub("skipped", "lossy_format", 3);
      assertEquals(stats.getSub("skipped", "already_m4a"), 2);
      assertEquals(stats.getSub("skipped", "lossy_format"), 3);
    });

    it("should compute sub-total across all sub-keys", () => {
      const stats = new OperationStats();
      stats.incrementSub("skipped", "already_m4a", 2);
      stats.incrementSub("skipped", "lossy_format", 3);
      stats.incrementSub("skipped", "output_exists", 1);
      assertEquals(stats.getSubTotal("skipped"), 6);
    });

    it("should return zero sub-total for unknown key", () => {
      const stats = new OperationStats();
      assertEquals(stats.getSubTotal("unknown"), 0);
    });
  });

  describe("convenience aliases", () => {
    it("should increment 'processed' via incrementSuccess", () => {
      const stats = new OperationStats();
      stats.incrementSuccess();
      stats.incrementSuccess();
      assertEquals(stats.get("processed"), 2);
    });

    it("should increment 'failed' via incrementFailed", () => {
      const stats = new OperationStats();
      stats.incrementFailed();
      assertEquals(stats.get("failed"), 1);
    });

    it("should increment flat 'skipped' via incrementSkipped without reason", () => {
      const stats = new OperationStats();
      stats.incrementSkipped();
      assertEquals(stats.get("skipped"), 1);
    });

    it("should increment sub-count via incrementSkipped with reason", () => {
      const stats = new OperationStats();
      stats.incrementSkipped("already_m4a");
      assertEquals(stats.getSub("skipped", "already_m4a"), 1);
      assertEquals(stats.getSubTotal("skipped"), 1);
    });
  });

  describe("printSummary", () => {
    function captureLogs(fn: () => void): string[] {
      const original = console.log;
      const lines: string[] = [];
      console.log = (...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      };
      try {
        fn();
      } finally {
        console.log = original;
      }
      return lines;
    }

    it("should print processing summary with correct labels", () => {
      const stats = new OperationStats();
      stats.increment("processed", 10);
      stats.increment("skipped", 3);
      stats.increment("no_results", 1);
      stats.increment("lookup_failed", 2);
      stats.increment("failed", 1);

      const lines = captureLogs(() =>
        stats.printSummary("Processing Complete", PROCESSING_SUMMARY)
      );

      assertEquals(lines[0], "\n--- Processing Complete ---");
      assertEquals(lines[1], "Successfully processed: 10");
      assertEquals(
        lines[2],
        "Skipped (already tagged/force not used): 3",
      );
      assertEquals(lines[3], "No AcoustID results found: 1");
      assertEquals(
        lines[4],
        "AcoustID lookup failed (API/network issues): 2",
      );
      assertEquals(
        lines[5],
        "Other failures (e.g., file access, fpcalc): 1",
      );
    });

    it("should print encoding summary with sub-count breakdown", () => {
      const stats = new OperationStats();
      stats.increment("processed", 5);
      stats.incrementSub("skipped", "already_m4a", 2);
      stats.incrementSub("skipped", "lossy_format", 1);
      stats.increment("failed", 0);

      const lines = captureLogs(() =>
        stats.printSummary("Encoding Complete", ENCODING_SUMMARY)
      );

      assertEquals(lines[0], "\n--- Encoding Complete ---");
      assertEquals(lines[1], "Successfully encoded: 5");
      assertEquals(lines[2], "Files skipped: 3");
      assertEquals(lines[3], "  Already M4A format: 2");
      assertEquals(
        lines[4],
        "  Lossy format (use --force-lossy-transcodes): 1",
      );
      assertEquals(lines[5], "Failed: 0");
    });

    it("should hide sub-count lines when count is zero", () => {
      const stats = new OperationStats();
      stats.increment("processed", 5);

      const lines = captureLogs(() =>
        stats.printSummary("Encoding Complete", ENCODING_SUMMARY)
      );

      assertEquals(lines[0], "\n--- Encoding Complete ---");
      assertEquals(lines[1], "Successfully encoded: 5");
      assertEquals(lines[2], "Files skipped: 0");
      assertEquals(lines[3], "Failed: 0");
    });

    it("should print easy mode summary", () => {
      const stats = new OperationStats();
      stats.increment("processed", 20);
      stats.increment("skipped", 5);
      stats.increment("no_results", 2);
      stats.increment("lookup_failed", 1);
      stats.increment("failed", 0);

      const lines = captureLogs(() =>
        stats.printSummary("Easy Mode Complete", EASY_MODE_SUMMARY)
      );

      assertEquals(lines[0], "\n--- Easy Mode Complete ---");
      assertEquals(lines[1], "Files processed: 20");
      assertEquals(lines[2], "Skipped (already tagged): 5");
      assertEquals(lines[3], "No AcoustID results found: 2");
      assertEquals(lines[4], "AcoustID lookup failed: 1");
      assertEquals(lines[5], "Other failures: 0");
    });

    it("should append dry-run notice when isDryRun is true", () => {
      const stats = new OperationStats();
      stats.increment("processed", 1);

      const lines = captureLogs(() =>
        stats.printSummary("Processing Complete", PROCESSING_SUMMARY, true)
      );

      const lastLine = lines[lines.length - 1];
      assertEquals(
        lastLine,
        "\nNOTE: This was a dry run. No files were modified.",
      );
    });

    it("should not append dry-run notice when isDryRun is false", () => {
      const stats = new OperationStats();
      stats.increment("processed", 1);

      const lines = captureLogs(() =>
        stats.printSummary("Processing Complete", PROCESSING_SUMMARY, false)
      );

      const lastLine = lines[lines.length - 1];
      assertEquals(
        lastLine,
        "Other failures (e.g., file access, fpcalc): 0",
      );
    });
  });
});
