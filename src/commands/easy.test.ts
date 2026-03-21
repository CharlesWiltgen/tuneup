import { assert } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

describe("easy command integration", () => {
  it("should exit with error when --api-key is missing", async () => {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--no-check",
        "--allow-read",
        "--allow-env",
        "--allow-net",
        "--allow-write",
        "--allow-run",
        "src/tuneup.ts",
        "easy",
        "/some/library/path",
      ],
      stdout: "piped",
      stderr: "piped",
      env: {
        // Ensure no env var API key is picked up
        ACOUSTID_API_KEY: "",
      },
    });
    const output = await cmd.output();
    assert(
      output.code !== 0,
      `Expected non-zero exit code, got ${output.code}`,
    );
    const stderr = new TextDecoder().decode(output.stderr);
    assert(
      stderr.includes("api-key") || stderr.includes("API"),
      `Expected error about missing API key, got: ${stderr}`,
    );
  });

  it("should run dry-run on a test directory with --api-key", async () => {
    const testDir = "/Volumes/T9 (4TB)/Downloads/Deezer/America/America - Hits";
    try {
      await Deno.stat(testDir);
    } catch {
      return; // Skip if test directory not available
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
        "src/tuneup.ts",
        "easy",
        "--dry-run",
        "--quiet",
        "--api-key",
        "test-dummy-key",
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
