import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { returnsNext, stub } from "@std/testing/mock";
import { MockDenoCommand, stubConsole } from "../test_utils/mod.ts";
import { calculateReplayGain, parseReplayGainCSV } from "./replaygain.ts";

describe("parseReplayGainCSV", () => {
  it("should parse track gain and peak from tab-separated CSV", () => {
    const csv = "/path/to/song.mp3\t-6.5\t0.95";
    const result = parseReplayGainCSV(csv);
    assertEquals(result, {
      "/path/to/song.mp3": {
        trackGain: -6.5,
        trackPeak: 0.95,
      },
    });
  });

  it("should parse album gain and peak when present", () => {
    const csv = "/path/to/song.flac\t-7.2\t0.88\t-6.1\t0.92";
    const result = parseReplayGainCSV(csv);
    assertEquals(result, {
      "/path/to/song.flac": {
        trackGain: -7.2,
        trackPeak: 0.88,
        albumGain: -6.1,
        albumPeak: 0.92,
      },
    });
  });

  it("should parse multiple files", () => {
    const csv = [
      "/path/track01.mp3\t-5.0\t0.90\t-4.5\t0.85",
      "/path/track02.mp3\t-6.0\t0.92\t-4.5\t0.85",
    ].join("\n");

    const result = parseReplayGainCSV(csv);
    assertEquals(Object.keys(result).length, 2);
    assertEquals(result["/path/track01.mp3"].trackGain, -5.0);
    assertEquals(result["/path/track02.mp3"].trackGain, -6.0);
    assertEquals(result["/path/track01.mp3"].albumGain, -4.5);
    assertEquals(result["/path/track02.mp3"].albumGain, -4.5);
  });

  it("should skip comment lines starting with #", () => {
    const csv = [
      "# ReplayGain output",
      "/path/song.mp3\t-5.0\t0.90",
    ].join("\n");

    const result = parseReplayGainCSV(csv);
    assertEquals(Object.keys(result).length, 1);
    assertEquals(result["/path/song.mp3"].trackGain, -5.0);
  });

  it("should skip empty lines", () => {
    const csv = [
      "/path/song1.mp3\t-5.0\t0.90",
      "",
      "   ",
      "/path/song2.mp3\t-6.0\t0.85",
    ].join("\n");

    const result = parseReplayGainCSV(csv);
    assertEquals(Object.keys(result).length, 2);
  });

  it("should skip lines with fewer than 3 columns", () => {
    const csv = [
      "/path/song.mp3\t-5.0",
      "/path/valid.mp3\t-5.0\t0.90",
    ].join("\n");

    const result = parseReplayGainCSV(csv);
    assertEquals(Object.keys(result).length, 1);
    assertEquals(result["/path/valid.mp3"].trackGain, -5.0);
  });

  it("should return empty object for empty input", () => {
    assertEquals(parseReplayGainCSV(""), {});
  });

  it("should return empty object for comments-only input", () => {
    assertEquals(parseReplayGainCSV("# comment only"), {});
  });

  it("should handle positive gain values", () => {
    const csv = "/path/quiet.mp3\t3.2\t0.45";
    const result = parseReplayGainCSV(csv);
    assertEquals(result["/path/quiet.mp3"].trackGain, 3.2);
  });
});

describe("calculateReplayGain", () => {
  it("should run rsgain in 'easy' mode for directory target", async () => {
    const statStub = stub(
      Deno,
      "stat",
      returnsNext([
        Promise.resolve({ isDirectory: true } as Deno.FileInfo),
      ]),
    );
    MockDenoCommand.setup();
    MockDenoCommand.addMock("rsgain", { code: 0 });
    const consoleStub = stubConsole("log");
    try {
      const result = await calculateReplayGain("/path/to/album", false);
      assertEquals(result, { success: true });
      const args = MockDenoCommand.getLastArgs("rsgain");
      assertEquals(args?.[0], "easy");
      assertEquals(args?.[1], "-e");
    } finally {
      consoleStub.restore();
      MockDenoCommand.restore();
      statStub.restore();
    }
  });

  it("should run rsgain in 'custom' mode for file target", async () => {
    const statStub = stub(
      Deno,
      "stat",
      returnsNext([
        Promise.resolve({ isDirectory: false } as Deno.FileInfo),
      ]),
    );
    MockDenoCommand.setup();
    MockDenoCommand.addMock("rsgain", { code: 0 });
    const consoleStub = stubConsole("log");
    try {
      const result = await calculateReplayGain("/path/to/song.mp3", false);
      assertEquals(result, { success: true });
      const args = MockDenoCommand.getLastArgs("rsgain");
      assertEquals(args?.[0], "custom");
      assertEquals(args?.[1], "-e");
    } finally {
      consoleStub.restore();
      MockDenoCommand.restore();
      statStub.restore();
    }
  });

  it("should return { success: false } on non-zero exit code", async () => {
    const statStub = stub(
      Deno,
      "stat",
      returnsNext([
        Promise.resolve({ isDirectory: false } as Deno.FileInfo),
      ]),
    );
    MockDenoCommand.setup();
    MockDenoCommand.addMock("rsgain", { code: 1 });
    const consoleStub = stubConsole("log");
    try {
      const result = await calculateReplayGain("/path/to/song.mp3", false);
      assertEquals(result, { success: false });
    } finally {
      consoleStub.restore();
      MockDenoCommand.restore();
      statStub.restore();
    }
  });

  it("should suppress output when quiet=true", async () => {
    const statStub = stub(
      Deno,
      "stat",
      returnsNext([
        Promise.resolve({ isDirectory: false } as Deno.FileInfo),
      ]),
    );
    MockDenoCommand.setup();
    MockDenoCommand.addMock("rsgain", { code: 0 });
    const consoleStub = stubConsole("log");
    try {
      await calculateReplayGain("/path/to/song.mp3", true);
      assertEquals(consoleStub.calls.length, 0);
    } finally {
      consoleStub.restore();
      MockDenoCommand.restore();
      statStub.restore();
    }
  });

  it("should default to 'custom' mode when stat fails", async () => {
    const statStub = stub(
      Deno,
      "stat",
      returnsNext([
        Promise.reject(new Error("stat failed")),
      ]),
    );
    MockDenoCommand.setup();
    MockDenoCommand.addMock("rsgain", { code: 0 });
    const consoleStub = stubConsole("log");
    try {
      const result = await calculateReplayGain("/nonexistent/path", false);
      assertEquals(result, { success: true });
      const args = MockDenoCommand.getLastArgs("rsgain");
      assertEquals(args?.[0], "custom");
      assertEquals(args?.[1], "-e");
    } finally {
      consoleStub.restore();
      MockDenoCommand.restore();
      statStub.restore();
    }
  });

  it("should return parsed CSV data when returnData=true for directory", async () => {
    const csvContent = "/path/to/song.mp3\t-6.5\t0.95\t-5.0\t0.88";
    const statStub = stub(
      Deno,
      "stat",
      returnsNext([
        Promise.resolve({ isDirectory: true } as Deno.FileInfo),
      ]),
    );
    MockDenoCommand.setup();
    MockDenoCommand.addMock("rsgain", { code: 0 });
    const readTextStub = stub(
      Deno,
      "readTextFile",
      returnsNext([Promise.resolve(csvContent)]),
    );
    const removeStub = stub(
      Deno,
      "remove",
      returnsNext([Promise.resolve()]),
    );
    const consoleStub = stubConsole("log");
    try {
      const result = await calculateReplayGain("/path/to/album", false, true);
      assertEquals(result.success, true);
      assertEquals(result.data?.["/path/to/song.mp3"]?.trackGain, -6.5);
      assertEquals(result.data?.["/path/to/song.mp3"]?.albumGain, -5.0);
    } finally {
      consoleStub.restore();
      removeStub.restore();
      readTextStub.restore();
      MockDenoCommand.restore();
      statStub.restore();
    }
  });
});
