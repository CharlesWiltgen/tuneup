import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

describe("lint command integration", () => {
  it("should exit with code 2 when path does not exist", async () => {
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-env",
        "--allow-net",
        "src/amusic.ts",
        "lint",
        "/nonexistent/path",
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    assertEquals(output.code, 2);
  });

  it("should produce valid JSONL with --json flag on a test directory", async () => {
    const testDir = "/Volumes/T9 (4TB)/Downloads/Deezer/America/America - Hits";
    try {
      await Deno.stat(testDir);
    } catch {
      return;
    }

    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-env",
        "--allow-net",
        "src/amusic.ts",
        "lint",
        "--json",
        "--severity",
        "info",
        "--quiet",
        testDir,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    const stdout = new TextDecoder().decode(output.stdout);
    const lines = stdout.trim().split("\n").filter((l) => l.length > 0);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      assertEquals(typeof parsed.type, "string");
    }

    if (lines.length > 0) {
      const lastLine = JSON.parse(lines[lines.length - 1]);
      assertEquals(lastLine.type, "summary");
      assertEquals(typeof lastLine.errors, "number");
      assertEquals(typeof lastLine.warnings, "number");
    }
  });
});
