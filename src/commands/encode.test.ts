import { assertEquals } from "jsr:@std/assert";
import { displayWidth, wrapEncodingLine } from "./encode.ts";

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
});
