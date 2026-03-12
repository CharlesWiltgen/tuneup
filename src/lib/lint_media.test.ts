import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { detectFormatFromHeader, validateFileHeader } from "./lint_media.ts";

describe("detectFormatFromHeader", () => {
  it("should detect MP3 with ID3 header", () => {
    const buf = new Uint8Array([
      0x49,
      0x44,
      0x33,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "mp3");
  });

  it("should detect MP3 MPEG sync bytes (0xFF 0xFB)", () => {
    const buf = new Uint8Array([
      0xFF,
      0xFB,
      0x90,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "mp3");
  });

  it("should detect MP3 MPEG sync bytes (0xFF 0xE0 mask)", () => {
    const buf = new Uint8Array([
      0xFF,
      0xE3,
      0x90,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "mp3");
  });

  it("should detect FLAC", () => {
    const buf = new Uint8Array([
      0x66,
      0x4C,
      0x61,
      0x43,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "flac");
  });

  it("should detect OGG", () => {
    const buf = new Uint8Array([
      0x4F,
      0x67,
      0x67,
      0x53,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "ogg");
  });

  it("should detect M4A/MP4 (ftyp at offset 4)", () => {
    const buf = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x20,
      0x66,
      0x74,
      0x79,
      0x70,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "m4a");
  });

  it("should detect WAV (RIFF)", () => {
    const buf = new Uint8Array([
      0x52,
      0x49,
      0x46,
      0x46,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), "wav");
  });

  it("should return null for unknown format", () => {
    const buf = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(detectFormatFromHeader(buf), null);
  });
});

describe("validateFileHeader", () => {
  it("should return invalid-header for unrecognized format", () => {
    const buf = new Uint8Array(12);
    const issues = validateFileHeader("/test/file.mp3", ".mp3", buf);
    assertEquals(issues.length, 1);
    assertEquals(issues[0].rule, "invalid-header");
    assertEquals(issues[0].severity, "error");
  });

  it("should return extension-mismatch when header differs from extension", () => {
    const buf = new Uint8Array([
      0x66,
      0x4C,
      0x61,
      0x43,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    const issues = validateFileHeader("/test/file.mp3", ".mp3", buf);
    assertEquals(issues.length, 1);
    assertEquals(issues[0].rule, "extension-mismatch");
    assertEquals(issues[0].severity, "warning");
  });

  it("should return no issues when header matches extension", () => {
    const buf = new Uint8Array([
      0x66,
      0x4C,
      0x61,
      0x43,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    const issues = validateFileHeader("/test/file.flac", ".flac", buf);
    assertEquals(issues, []);
  });

  it("should treat m4a and mp4 as equivalent for ftyp header", () => {
    const buf = new Uint8Array([
      0x00,
      0x00,
      0x00,
      0x20,
      0x66,
      0x74,
      0x79,
      0x70,
      0x00,
      0x00,
      0x00,
      0x00,
    ]);
    assertEquals(validateFileHeader("/test/file.m4a", ".m4a", buf), []);
    assertEquals(validateFileHeader("/test/file.mp4", ".mp4", buf), []);
  });
});
