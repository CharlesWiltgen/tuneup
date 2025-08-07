import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { processCollection } from "./process_collection.ts";
import { ProcessingStats } from "../utils/processing_stats.ts";
import { join } from "jsr:@std/path";
import { ensureDir } from "jsr:@std/fs";

Deno.test("processCollection", async (t) => {
  const testDir = await Deno.makeTempDir();

  await t.step("should handle empty collections gracefully", async () => {
    const stats = new ProcessingStats();
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output += msg + "\n";
    };

    // Empty album map
    await processCollection({
      collection: new Map(),
      type: "album",
      options: { quiet: false },
      stats,
      paths: [testDir],
    });

    // Empty singles array
    await processCollection({
      collection: [],
      type: "singles",
      options: { quiet: false },
      stats,
      paths: [testDir],
    });

    console.log = originalLog;

    // Should not have printed any processing messages
    assertEquals(output.includes("Processing"), false);
  });

  await t.step("should display correct headers for each type", async () => {
    const stats = new ProcessingStats();
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output += msg + "\n";
    };

    // Create test files
    const albumDir = join(testDir, "album");
    await ensureDir(albumDir);
    await Deno.writeTextFile(join(albumDir, "track1.mp3"), "");
    await Deno.writeTextFile(join(albumDir, "track2.mp3"), "");

    // Test album processing header
    output = "";
    await processCollection({
      collection: new Map([[albumDir, [
        join(albumDir, "track1.mp3"),
        join(albumDir, "track2.mp3"),
      ]]]),
      type: "album",
      options: {
        quiet: false,
        dryRun: true,
        encode: true,
      },
      stats,
      paths: [testDir],
    });

    assertStringIncludes(output, "🎼 Processing albums...");
    assertStringIncludes(output, "💿 Processing album:");

    // Test compilation processing header
    output = "";
    await processCollection({
      collection: new Map([[albumDir, [
        join(albumDir, "track1.mp3"),
        join(albumDir, "track2.mp3"),
      ]]]),
      type: "compilation",
      options: {
        quiet: false,
        dryRun: true,
        encode: true,
      },
      stats,
      paths: [testDir],
    });

    assertStringIncludes(output, "🎭 Processing compilations...");
    assertStringIncludes(output, "💿 Processing compilation:");

    // Test singles processing header
    output = "";
    await processCollection({
      collection: [join(albumDir, "track1.mp3"), join(albumDir, "track2.mp3")],
      type: "singles",
      options: {
        quiet: false,
        dryRun: true,
        encode: true,
      },
      stats,
      paths: [testDir],
    });

    assertStringIncludes(output, "🎵 Processing singles...");

    console.log = originalLog;
  });

  await t.step("should respect quiet option", async () => {
    const stats = new ProcessingStats();
    let output = "";
    const originalLog = console.log;
    console.log = (msg: string) => {
      output += msg + "\n";
    };

    const albumDir = join(testDir, "quiet-test");
    await ensureDir(albumDir);
    await Deno.writeTextFile(join(albumDir, "track.mp3"), "");

    await processCollection({
      collection: new Map([[albumDir, [join(albumDir, "track.mp3")]]]),
      type: "album",
      options: {
        quiet: true,
        dryRun: true,
        encode: true,
      },
      stats,
      paths: [testDir],
    });

    console.log = originalLog;

    // Should not output anything when quiet
    assertEquals(output, "");
  });

  // Cleanup
  await Deno.remove(testDir, { recursive: true });
});
