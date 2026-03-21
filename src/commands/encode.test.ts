import { assertEquals, assertThrows } from "@std/assert";
import {
  displayWidth,
  extractFolderNameFromPath,
  wrapEncodingLine,
} from "./encode.ts";

Deno.test("displayWidth", async (t) => {
  await t.step("should count ASCII characters as 1 column each", () => {
    assertEquals(displayWidth("hello"), 5);
  });

  await t.step("should count emoji (>U+FFFF) as 2 columns", () => {
    // 🎧 is U+1F3A7, which is > U+FFFF
    assertEquals(displayWidth("🎧"), 2);
  });

  await t.step("should handle mixed ASCII and emoji", () => {
    // "   🎧 hi" = 3 spaces + 🎧(2) + space + "hi"(2) = 8
    assertEquals(displayWidth("   🎧 hi"), 8);
  });

  await t.step("should count arrow character as 1 column", () => {
    // → is U+2192, which is <= U+FFFF
    assertEquals(displayWidth("→"), 1);
  });

  await t.step("should handle empty string", () => {
    assertEquals(displayWidth(""), 0);
  });

  await t.step("should handle ANSI escape sequences as zero width", () => {
    assertEquals(displayWidth("\x1b[1m\x1b[94mtext\x1b[0m"), 4);
  });
});

Deno.test("extractFolderNameFromPath", async (t) => {
  await t.step(
    "should return directory name when path has trailing slash",
    () => {
      assertEquals(
        extractFolderNameFromPath("Music/Beach House/"),
        "Beach House",
      );
    },
  );

  await t.step(
    "should return directory name for bare directory with dots",
    async () => {
      const dirName = "B.B. King - Greatest Hits";
      await Deno.mkdir(dirName);
      try {
        assertEquals(extractFolderNameFromPath(dirName), dirName);
      } finally {
        await Deno.remove(dirName);
      }
    },
  );

  await t.step("should return '.' for bare filename with extension", () => {
    assertEquals(extractFolderNameFromPath("song.flac"), ".");
  });

  await t.step(
    "should return parent folder name from file path with slashes",
    () => {
      assertEquals(
        extractFolderNameFromPath("Music/Beach House/song.flac"),
        "Beach House",
      );
    },
  );

  await t.step("should return '.' for file with ./ prefix", () => {
    assertEquals(extractFolderNameFromPath("./song.flac"), ".");
  });

  await t.step("should propagate non-NotFound errors", () => {
    // A path with a null byte is invalid and throws a different error
    assertThrows(() => extractFolderNameFromPath("invalid\0path"));
  });
});

Deno.test("wrapEncodingLine", async (t) => {
  const prefix = "   🎧 ";
  const prefixWidth = 6; // 3 spaces + 🎧(2) + 1 space

  await t.step("should return line unchanged if shorter than maxWidth", () => {
    const line = `${prefix}short line`;
    assertEquals(wrapEncodingLine(line, 80), line);
  });

  await t.step("should return non-🎧 line unchanged even if long", () => {
    const line = "x".repeat(200);
    assertEquals(wrapEncodingLine(line, 80), line);
  });

  await t.step("should wrap line that exactly equals maxWidth", () => {
    // Build a line whose display width === maxWidth (40)
    // prefix(6) + 34 chars = 40 display cols
    const line = `${prefix}${"A".repeat(30)} end`;
    assertEquals(displayWidth(line), 40);
    const result = wrapEncodingLine(line, 40);
    // Should wrap — line at exact terminal width should not touch the edge
    const lines = result.split("\n");
    assertEquals(lines.length > 1, true);
  });

  await t.step("should break at / boundary with proper indent", () => {
    // Build a line that exceeds 40 columns
    // "   🎧 FolderName/track.flac → .m4a" where FolderName is long enough
    const longLine = `${prefix}${"A".repeat(30)}/track.flac`;
    // displayWidth = 6 + 30 + 1 + 10 = 47, exceeds 40
    const result = wrapEncodingLine(longLine, 40);
    const continuationIndent = " ".repeat(prefixWidth);
    assertEquals(
      result,
      `${prefix}${"A".repeat(30)}/\n${continuationIndent}track.flac`,
    );
  });

  await t.step("should break at space boundary when no / available", () => {
    const longLine = `${prefix}${"A".repeat(30)} something`;
    // displayWidth = 6 + 30 + 1 + 9 = 46, exceeds 40
    const result = wrapEncodingLine(longLine, 40);
    const continuationIndent = " ".repeat(prefixWidth);
    assertEquals(
      result,
      `${prefix}${"A".repeat(30)}\n${continuationIndent}something`,
    );
  });

  await t.step("should hard break when no good break point found", () => {
    const longLine = `${prefix}${"A".repeat(50)}`;
    // displayWidth = 6 + 50 = 56, exceeds 40
    const result = wrapEncodingLine(longLine, 40);
    const continuationIndent = " ".repeat(prefixWidth);
    assertEquals(
      result,
      `${prefix}${"A".repeat(34)}\n${continuationIndent}${"A".repeat(16)}`,
    );
  });

  await t.step("should handle multi-wrap for very long lines", () => {
    // Line so long it needs 3 physical lines at width 30
    // prefix(6) + content fits 24 chars per line
    const longLine = `${prefix}part1/part2/part3/part4/part5/endofline`;
    const result = wrapEncodingLine(longLine, 30);
    const lines = result.split("\n");
    // Each line should be <= 30 display columns
    for (const line of lines) {
      const w = displayWidth(line);
      if (w > 30) {
        throw new Error(`Line "${line}" has width ${w}, exceeds 30`);
      }
    }
  });

  await t.step("should prefer / over space as break point", () => {
    const longLine = `${prefix}folder name/filename here`;
    // displayWidth = 6 + 11 + 1 + 13 = 31
    const result = wrapEncodingLine(longLine, 25);
    // Should break at /, not at space
    const continuationIndent = " ".repeat(prefixWidth);
    assertEquals(result.includes("/\n" + continuationIndent), true);
  });

  await t.step("should return Infinity-width line unchanged", () => {
    const longLine = `${prefix}${"A".repeat(500)}`;
    assertEquals(wrapEncodingLine(longLine, Infinity), longLine);
  });

  const discPrefix = "💿 ";
  const discIndent = "   "; // 3 spaces to match disc prefix display width

  await t.step("should return short 💿 line unchanged", () => {
    const line = `${discPrefix}Encoding 'short.flac'`;
    assertEquals(wrapEncodingLine(line, 80), line);
  });

  await t.step("should wrap long 💿 line at space with 3-space indent", () => {
    const longName = "A".repeat(30);
    const line = `${discPrefix}Encoding '${longName} something.flac'`;
    const result = wrapEncodingLine(line, 40);
    const lines = result.split("\n");
    assertEquals(lines.length > 1, true);
    // Continuation lines should start with 3-space indent
    for (let i = 1; i < lines.length; i++) {
      assertEquals(lines[i].startsWith(discIndent), true);
    }
    // All lines should fit within maxWidth
    for (const l of lines) {
      const w = displayWidth(l);
      if (w > 40) {
        throw new Error(`Line "${l}" has width ${w}, exceeds 40`);
      }
    }
  });

  await t.step("should wrap long 💿 line at / boundary", () => {
    const line = `${discPrefix}${"A".repeat(30)}/filename.flac`;
    // displayWidth = 3 + 30 + 1 + 13 = 47, exceeds 40
    const result = wrapEncodingLine(line, 40);
    assertEquals(
      result,
      `${discPrefix}${"A".repeat(30)}/\n${discIndent}filename.flac`,
    );
  });

  const folderPrefix = "  📁 ";
  const folderIndent = "     "; // 5 spaces to match folder prefix display width

  await t.step("should return short 📁 line unchanged", () => {
    const line = `${folderPrefix}Short Folder`;
    assertEquals(wrapEncodingLine(line, 80), line);
  });

  await t.step("should wrap long 📁 line at space with 5-space indent", () => {
    const line =
      `${folderPrefix}Run The Jewels – caminando en la nieve (feat. Akapellah, Apache & Pawmps)`;
    const result = wrapEncodingLine(line, 60);
    const lines = result.split("\n");
    assertEquals(lines.length > 1, true);
    for (let i = 1; i < lines.length; i++) {
      assertEquals(lines[i].startsWith(folderIndent), true);
    }
    for (const l of lines) {
      const w = displayWidth(l);
      if (w > 60) {
        throw new Error(`Line "${l}" has width ${w}, exceeds 60`);
      }
    }
  });

  await t.step("should wrap 📁 line with ANSI codes correctly", () => {
    const folder = "A".repeat(50);
    const line = `${folderPrefix}\x1b[1m\x1b[94m${folder}\x1b[0m`;
    const result = wrapEncodingLine(line, 40);
    const lines = result.split("\n");
    assertEquals(lines.length > 1, true);
    for (const l of lines) {
      const w = displayWidth(l);
      if (w > 40) {
        throw new Error(`Line "${l}" has width ${w}, exceeds 40`);
      }
    }
  });
});

// --- E2E Tests ---
import { assert } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

describe("encode command E2E", () => {
  it("should exit with error when no input files match", async () => {
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
        "encode",
        "/nonexistent/path/file.flac",
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const output = await cmd.output();
    assert(
      output.code !== 0,
      `Expected non-zero exit code, got ${output.code}`,
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
        "encode",
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
