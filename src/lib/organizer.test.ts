import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { buildOrganizedPath, sanitizeFilename } from "./organizer.ts";

describe("sanitizeFilename", () => {
  it("should replace filesystem-unsafe characters", () => {
    assertEquals(
      sanitizeFilename("AC/DC: Back In Black?"),
      "AC_DC_ Back In Black_",
    );
  });

  it("should trim whitespace", () => {
    assertEquals(sanitizeFilename("  hello  "), "hello");
  });
});

describe("buildOrganizedPath", () => {
  it("should build Artist/Album (Year)/NN Title.ext", () => {
    const result = buildOrganizedPath({
      libraryRoot: "/Music",
      artist: "Radiohead",
      album: "OK Computer",
      year: 1997,
      trackNumber: 1,
      title: "Airbag",
      extension: ".flac",
      totalTracks: 12,
    });
    assertEquals(result, "/Music/Radiohead/OK Computer (1997)/01 Airbag.flac");
  });

  it("should use Various Artists for compilations", () => {
    const result = buildOrganizedPath({
      libraryRoot: "/Music",
      artist: "Some Artist",
      album: "Lost in Translation",
      year: 2003,
      trackNumber: 8,
      title: "Just Like Honey",
      extension: ".mp3",
      isCompilation: true,
      totalTracks: 15,
    });
    assertEquals(
      result,
      "/Music/Various Artists/Lost in Translation (2003)/08 Just Like Honey.mp3",
    );
  });

  it("should place singles in Artist/Singles/", () => {
    const result = buildOrganizedPath({
      libraryRoot: "/Music",
      artist: "Radiohead",
      title: "Creep",
      extension: ".mp3",
      totalTracks: 1,
    });
    assertEquals(result, "/Music/Radiohead/Singles/Creep.mp3");
  });

  it("should zero-pad to 3 digits for 100+ track albums", () => {
    const result = buildOrganizedPath({
      libraryRoot: "/Music",
      artist: "Various",
      album: "Mega Mix",
      trackNumber: 5,
      title: "Song",
      extension: ".mp3",
      totalTracks: 150,
    });
    assertEquals(result, "/Music/Various/Mega Mix/005 Song.mp3");
  });

  it("should omit year from path when not available", () => {
    const result = buildOrganizedPath({
      libraryRoot: "/Music",
      artist: "Unknown",
      album: "Demos",
      trackNumber: 1,
      title: "Track 1",
      extension: ".mp3",
      totalTracks: 5,
    });
    assertEquals(result, "/Music/Unknown/Demos/01 Track 1.mp3");
  });
});
