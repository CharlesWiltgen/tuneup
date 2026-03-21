import { describe, it } from "@std/testing/bdd";
import { assertEquals, assertNotEquals } from "@std/assert";
import { setupCLI } from "../cli/cli.ts";

describe("fix command registration", () => {
  it("should register fix as a valid subcommand", () => {
    const program = setupCLI();
    const commands = program.getCommands();
    const fixCmd = commands.find((c) => c.getName() === "fix");
    assertNotEquals(fixCmd, undefined);
  });
});

describe("fix command E2E", () => {
  it("should run fix --dry-run on an empty folder without errors", async () => {
    const testDir = await Deno.makeTempDir({ prefix: "tuneup-fix-test-" });
    try {
      const cmd = new Deno.Command("deno", {
        args: [
          "run",
          "--allow-read",
          "--allow-run",
          "--allow-write",
          "--allow-env",
          "--allow-net",
          "src/tuneup.ts",
          "fix",
          testDir,
          "--dry-run",
          "--api-key",
          "test-key",
        ],
        stdout: "piped",
        stderr: "piped",
      });
      const output = await cmd.output();
      const stdout = new TextDecoder().decode(output.stdout);
      // Should exit cleanly (0) even with no files
      assertEquals(output.code, 0);
      // Should report 0 files found
      assertEquals(stdout.includes("Found"), false);
    } finally {
      await Deno.remove(testDir, { recursive: true });
    }
  });
});
