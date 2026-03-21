import { assert, assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

describe("soundcheck command integration", () => {
  it("should discover 0 files for nonexistent path", async () => {
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
        "soundcheck",
        "/nonexistent/path/to/audio",
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    assertEquals(output.code, 0);
    const stdout = new TextDecoder().decode(output.stdout);
    assert(
      stdout.includes("Discovered 0 audio files"),
      `Expected '0 audio files' in output, got: ${stdout}`,
    );
  });

  it("should run dry-run on a test directory", async () => {
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
        "soundcheck",
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
