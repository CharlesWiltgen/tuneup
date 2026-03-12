import { assert, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

describe("x-ray command integration", () => {
  it("should exit 0 and display library structure", async () => {
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
        "src/amusic.ts",
        "x-ray",
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
    const stdout = new TextDecoder().decode(output.stdout);
    assertStringIncludes(stdout, "X-ray");
    assertStringIncludes(stdout, "Summary");
  });

  it("should work with --for-encoding flag", async () => {
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
        "src/amusic.ts",
        "x-ray",
        "--for-encoding",
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
    const stdout = new TextDecoder().decode(output.stdout);
    assertStringIncludes(stdout, "X-ray");
  });
});
