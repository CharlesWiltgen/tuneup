import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { formatCodec, formatContainerFormat } from "./show_tags_folder.ts";

describe("formatContainerFormat", () => {
  it("should add descriptive name for MP4", () => {
    assertEquals(formatContainerFormat("MP4"), "MP4 (ISOBMFF)");
  });

  it("should add descriptive name for WAV", () => {
    assertEquals(formatContainerFormat("WAV"), "WAV (RIFF)");
  });

  it("should pass through simple formats unchanged", () => {
    assertEquals(formatContainerFormat("OGG"), "OGG");
    assertEquals(formatContainerFormat("MP3"), "MP3");
    assertEquals(formatContainerFormat("FLAC"), "FLAC");
    assertEquals(formatContainerFormat("AIFF"), "AIFF");
  });

  it("should return unknown formats as-is", () => {
    assertEquals(formatContainerFormat("WMA"), "WMA");
    assertEquals(formatContainerFormat("UNKNOWN"), "UNKNOWN");
  });
});

describe("formatCodec", () => {
  it("should expand AAC to AAC-LC", () => {
    assertEquals(formatCodec("AAC"), "AAC-LC");
  });

  it("should expand ALAC to Apple Lossless", () => {
    assertEquals(formatCodec("ALAC"), "Apple Lossless");
  });

  it("should pass through codecs with standard names", () => {
    assertEquals(formatCodec("MP3"), "MP3");
    assertEquals(formatCodec("FLAC"), "FLAC");
    assertEquals(formatCodec("Vorbis"), "Vorbis");
    assertEquals(formatCodec("Opus"), "Opus");
    assertEquals(formatCodec("PCM"), "PCM");
    assertEquals(formatCodec("IEEE Float"), "IEEE Float");
  });

  it("should return unknown codecs as-is", () => {
    assertEquals(formatCodec("DSD"), "DSD");
    assertEquals(formatCodec("AC3"), "AC3");
  });
});
