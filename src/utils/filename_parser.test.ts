import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parseFilenames } from "./filename_parser.ts";

describe("parseFilenames", () => {
  it("should parse '## - Artist - Title' pattern", () => {
    const filenames = [
      "01 - Miles Davis - So What.mp3",
      "02 - Miles Davis - Freddie Freeloader.mp3",
      "03 - Miles Davis - Blue in Green.mp3",
    ];
    const results = parseFilenames(filenames);
    assertEquals(results, [
      { track: 1, artist: "Miles Davis", title: "So What" },
      { track: 2, artist: "Miles Davis", title: "Freddie Freeloader" },
      { track: 3, artist: "Miles Davis", title: "Blue in Green" },
    ]);
  });

  it("should parse '## - Title' pattern (no artist)", () => {
    const filenames = [
      "01 - Blue In Green.mp3",
      "02 - Freddie Freeloader.mp3",
    ];
    const results = parseFilenames(filenames);
    assertEquals(results, [
      { track: 1, title: "Blue In Green" },
      { track: 2, title: "Freddie Freeloader" },
    ]);
  });

  it("should parse 'Artist - Title' pattern", () => {
    const filenames = [
      "Miles Davis - So What.mp3",
      "Miles Davis - Freddie Freeloader.mp3",
    ];
    const results = parseFilenames(filenames);
    assertEquals(results, [
      { artist: "Miles Davis", title: "So What" },
      { artist: "Miles Davis", title: "Freddie Freeloader" },
    ]);
  });

  it("should parse '## Title' pattern (space separator)", () => {
    const filenames = [
      "01 So What.flac",
      "02 Freddie Freeloader.flac",
      "03 Blue in Green.flac",
    ];
    const results = parseFilenames(filenames);
    assertEquals(results, [
      { track: 1, title: "So What" },
      { track: 2, title: "Freddie Freeloader" },
      { track: 3, title: "Blue in Green" },
    ]);
  });

  it("should parse '##. Title' pattern (dot separator)", () => {
    const filenames = [
      "01. So What.mp3",
      "02. Freddie Freeloader.mp3",
    ];
    const results = parseFilenames(filenames);
    assertEquals(results, [
      { track: 1, title: "So What" },
      { track: 2, title: "Freddie Freeloader" },
    ]);
  });

  it("should fall back to title-only for unrecognized patterns", () => {
    const filenames = ["So What.mp3", "Freddie Freeloader.mp3"];
    const results = parseFilenames(filenames);
    assertEquals(results, [
      { title: "So What" },
      { title: "Freddie Freeloader" },
    ]);
  });

  it("should require batch consistency — all files must match same pattern", () => {
    const filenames = [
      "01 - Artist - Title.mp3",
      "Some Random Name.mp3",
      "02 - Artist - Other.mp3",
    ];
    const results = parseFilenames(filenames);
    assertEquals(results, [
      { title: "01 - Artist - Title" },
      { title: "Some Random Name" },
      { title: "02 - Artist - Other" },
    ]);
  });

  it("should handle track numbers with no leading zero", () => {
    const filenames = [
      "1 - Artist - Title.mp3",
      "2 - Artist - Other.mp3",
    ];
    const results = parseFilenames(filenames);
    assertEquals(results, [
      { track: 1, artist: "Artist", title: "Title" },
      { track: 2, artist: "Artist", title: "Other" },
    ]);
  });

  it("should return empty array for empty input", () => {
    assertEquals(parseFilenames([]), []);
  });
});
