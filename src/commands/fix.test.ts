import { describe, it } from "@std/testing/bdd";
import { assertNotEquals } from "@std/assert";
import { setupCLI } from "../cli/cli.ts";

describe("fix command registration", () => {
  it("should register fix as a valid subcommand", () => {
    const program = setupCLI();
    const commands = program.getCommands();
    const fixCmd = commands.find((c) => c.getName() === "fix");
    assertNotEquals(fixCmd, undefined);
  });
});
