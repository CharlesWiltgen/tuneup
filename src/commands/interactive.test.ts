import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ProcessCommandOptions } from "./process.ts";
import type { Prompter } from "./interactive.ts";

function createCapture() {
  let captured: { options: ProcessCommandOptions; paths: string[] } | null =
    null;
  const fn = (
    options: ProcessCommandOptions,
    ...paths: string[]
  ): Promise<void> => {
    captured = { options, paths };
    return Promise.resolve();
  };
  return {
    fn,
    get result() {
      if (!captured) throw new Error("processCommand was never called");
      return captured;
    },
  };
}

function createMockPrompter(
  responses: {
    inputs?: string[];
    checkboxes?: string[][];
    confirms?: boolean[];
    secrets?: string[];
  },
): Prompter {
  const inputQueue = [...(responses.inputs ?? [])];
  const checkboxQueue = [...(responses.checkboxes ?? [])];
  const confirmQueue = [...(responses.confirms ?? [])];
  const secretQueue = [...(responses.secrets ?? [])];

  return {
    input(_message, _options) {
      const val = inputQueue.shift();
      if (val === undefined) throw new Error("No more input values");
      return Promise.resolve(val);
    },
    checkbox(_message, _options) {
      const val = checkboxQueue.shift();
      if (val === undefined) throw new Error("No more checkbox values");
      return Promise.resolve(val);
    },
    confirm(_message, _defaultValue) {
      const val = confirmQueue.shift();
      if (val === undefined) throw new Error("No more confirm values");
      return Promise.resolve(val);
    },
    secret(_message, _options) {
      const val = secretQueue.shift();
      if (val === undefined) throw new Error("No more secret values");
      return Promise.resolve(val);
    },
  };
}

describe("interactiveCommand", () => {
  it("should prompt for path when none provided", async () => {
    const { interactiveCommand } = await import("./interactive.ts");
    const capture = createCapture();
    const prompter = createMockPrompter({
      inputs: ["/tmp/test-music"],
      checkboxes: [["replayGain"]],
      confirms: [false, false, true], // dry-run, force, confirm
    });
    await interactiveCommand(undefined, capture.fn, prompter);
    assertEquals(capture.result.paths, ["/tmp/test-music"]);
    assertEquals(capture.result.options.replayGain, true);
  });

  it("should skip path prompt when path is provided as argument", async () => {
    const { interactiveCommand } = await import("./interactive.ts");
    const capture = createCapture();
    const prompter = createMockPrompter({
      checkboxes: [["soundCheck"]],
      confirms: [false, false, true],
    });
    await interactiveCommand("/tmp/provided-path", capture.fn, prompter);
    assertEquals(capture.result.paths, ["/tmp/provided-path"]);
    assertEquals(capture.result.options.soundCheck, true);
  });

  it("should prompt for API key when AcoustID selected and env var not set", async () => {
    const { interactiveCommand } = await import("./interactive.ts");
    const capture = createCapture();
    const originalEnv = Deno.env.get("ACOUSTID_API_KEY");
    Deno.env.delete("ACOUSTID_API_KEY");
    try {
      const prompter = createMockPrompter({
        checkboxes: [["acoustID"]],
        secrets: ["test-api-key-123"],
        confirms: [false, false, true],
      });
      await interactiveCommand("/tmp/test", capture.fn, prompter);
      assertEquals(capture.result.options.apiKey, "test-api-key-123");
      assertEquals(capture.result.options.acoustID, true);
    } finally {
      if (originalEnv) Deno.env.set("ACOUSTID_API_KEY", originalEnv);
    }
  });

  it("should skip API key prompt when env var is set", async () => {
    const { interactiveCommand } = await import("./interactive.ts");
    const capture = createCapture();
    const originalEnv = Deno.env.get("ACOUSTID_API_KEY");
    Deno.env.set("ACOUSTID_API_KEY", "env-key-456");
    try {
      const prompter = createMockPrompter({
        checkboxes: [["acoustID"]],
        confirms: [false, false, true],
      });
      await interactiveCommand("/tmp/test", capture.fn, prompter);
      assertEquals(capture.result.options.apiKey, "env-key-456");
    } finally {
      if (originalEnv) {
        Deno.env.set("ACOUSTID_API_KEY", originalEnv);
      } else {
        Deno.env.delete("ACOUSTID_API_KEY");
      }
    }
  });

  it("should prompt for output dir and lossy transcodes when encode selected", async () => {
    const { interactiveCommand } = await import("./interactive.ts");
    const capture = createCapture();
    const prompter = createMockPrompter({
      checkboxes: [["encode"]],
      inputs: ["/tmp/output"],
      confirms: [true, false, false, true], // lossy, dry-run, force, confirm
    });
    await interactiveCommand("/tmp/test", capture.fn, prompter);
    assertEquals(capture.result.options.encode, true);
    assertEquals(capture.result.options.outputDir, "/tmp/output");
    assertEquals(capture.result.options.forceLossyTranscodes, true);
  });

  it("should assemble all options correctly", async () => {
    const { interactiveCommand } = await import("./interactive.ts");
    const capture = createCapture();
    const originalEnv = Deno.env.get("ACOUSTID_API_KEY");
    Deno.env.set("ACOUSTID_API_KEY", "env-key");
    try {
      const prompter = createMockPrompter({
        checkboxes: [["encode", "replayGain", "acoustID", "soundCheck"]],
        inputs: ["/tmp/out"],
        confirms: [false, true, true, true], // lossy, dry-run, force, confirm
      });
      await interactiveCommand("/tmp/music", capture.fn, prompter);
      assertEquals(capture.result.paths, ["/tmp/music"]);
      assertEquals(capture.result.options, {
        quiet: false,
        encode: true,
        replayGain: true,
        acoustID: true,
        soundCheck: true,
        forceLossyTranscodes: false,
        outputDir: "/tmp/out",
        apiKey: "env-key",
        dryRun: true,
        force: true,
      });
    } finally {
      if (originalEnv) {
        Deno.env.set("ACOUSTID_API_KEY", originalEnv);
      } else {
        Deno.env.delete("ACOUSTID_API_KEY");
      }
    }
  });

  it("should return without calling processCommand when not confirmed", async () => {
    const { interactiveCommand } = await import("./interactive.ts");
    let called = false;
    const fn = () => {
      called = true;
      return Promise.resolve();
    };
    const prompter = createMockPrompter({
      checkboxes: [["replayGain"]],
      confirms: [false, false, false], // dry-run, force, confirm -> no
    });
    await interactiveCommand("/tmp/test", fn as never, prompter);
    assertEquals(called, false);
  });

  it("should handle cancellation gracefully", async () => {
    const { interactiveCommand } = await import("./interactive.ts");
    const capture = createCapture();
    const prompter: Prompter = {
      ...createMockPrompter({}),
      checkbox() {
        return Promise.reject(new Error("prompt was canceled"));
      },
    };
    await interactiveCommand("/tmp/test", capture.fn, prompter);
    let threw = false;
    try {
      capture.result;
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });
});
