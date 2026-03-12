import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { stub } from "@std/testing/mock";
import {
  captureConsole,
  MockDenoCommand,
  restoreConsole,
} from "../test_utils/mod.ts";
import { ensureCommandExists } from "./command.ts";

describe("ensureCommandExists", () => {
  it("should succeed silently for an existing command", async () => {
    MockDenoCommand.setup();
    MockDenoCommand.addMock("test-binary", { code: 0 });
    const capture = captureConsole();
    try {
      await ensureCommandExists("test-binary");
      assertEquals(capture.errors.length, 0);
    } finally {
      restoreConsole(capture);
      MockDenoCommand.restore();
    }
  });

  it("should log error and exit for a missing command (NotFound)", async () => {
    // Restore any previous mock so we use real Deno.Command
    // which will throw NotFound for a non-existent binary
    const capture = captureConsole();
    const exitStub = stub(Deno, "exit", () => {
      throw new Error("EXIT_CALLED");
    });
    try {
      await ensureCommandExists(
        "/nonexistent/path/to/binary_that_does_not_exist_anywhere",
      );
    } catch {
      /* expected from exit stub */
    } finally {
      restoreConsole(capture);
      exitStub.restore();
    }
    assertEquals(exitStub.calls.length, 1);
    assertEquals(exitStub.calls[0].args[0], 1);
  });
});
