import { assertEquals } from "@std/assert";
import {
  aggregateAlbumMetadata,
  type AlbumMetadata,
  type FileMetadata,
  isCompilationAlbum,
} from "./compilation_detection.ts";

Deno.test("isCompilationAlbum", async (t) => {
  await t.step("should detect compilation by album artist", () => {
    const metadata: AlbumMetadata = {
      albumArtist: "Various Artists",
      uniqueArtists: new Set(["Artist 1"]),
    };
    assertEquals(isCompilationAlbum(metadata), true);
  });

  await t.step("should detect compilation by normalized album artist", () => {
    const metadata: AlbumMetadata = {
      albumArtist: "VARIOUS ARTISTS",
      uniqueArtists: new Set(["Artist 1"]),
    };
    assertEquals(isCompilationAlbum(metadata), true);
  });

  await t.step("should detect compilation by flag string", () => {
    const metadata: AlbumMetadata = {
      compilationFlag: "1",
      uniqueArtists: new Set(["Artist 1"]),
    };
    assertEquals(isCompilationAlbum(metadata), true);
  });

  await t.step("should detect compilation by flag number", () => {
    const metadata: AlbumMetadata = {
      compilationFlag: 1,
      uniqueArtists: new Set(["Artist 1"]),
    };
    assertEquals(isCompilationAlbum(metadata), true);
  });

  await t.step("should detect compilation by flag boolean", () => {
    const metadata: AlbumMetadata = {
      compilationFlag: true,
      uniqueArtists: new Set(["Artist 1"]),
    };
    assertEquals(isCompilationAlbum(metadata), true);
  });

  await t.step("should detect compilation by artist count", () => {
    const metadata: AlbumMetadata = {
      uniqueArtists: new Set(["Artist 1", "Artist 2", "Artist 3"]),
    };
    assertEquals(isCompilationAlbum(metadata), true);
  });

  await t.step("should not detect regular album with one artist", () => {
    const metadata: AlbumMetadata = {
      albumArtist: "The Beatles",
      uniqueArtists: new Set(["The Beatles"]),
    };
    assertEquals(isCompilationAlbum(metadata), false);
  });

  await t.step("should not detect regular album with two artists", () => {
    const metadata: AlbumMetadata = {
      uniqueArtists: new Set(["Artist 1", "Artist 2"]),
    };
    assertEquals(isCompilationAlbum(metadata), false);
  });

  await t.step("should not detect with false compilation flag", () => {
    const metadata: AlbumMetadata = {
      compilationFlag: false,
      uniqueArtists: new Set(["Artist 1"]),
    };
    assertEquals(isCompilationAlbum(metadata), false);
  });

  await t.step("should not detect with '0' compilation flag", () => {
    const metadata: AlbumMetadata = {
      compilationFlag: "0",
      uniqueArtists: new Set(["Artist 1"]),
    };
    assertEquals(isCompilationAlbum(metadata), false);
  });
});

Deno.test("aggregateAlbumMetadata", async (t) => {
  await t.step("should aggregate artists from multiple files", () => {
    const files: FileMetadata[] = [
      { artist: "Artist 1" },
      { artist: "Artist 2" },
      { artist: "Artist 3" },
    ];
    const result = aggregateAlbumMetadata(files);
    assertEquals(result.uniqueArtists.size, 3);
    assertEquals(result.uniqueArtists.has("artist 1"), true);
    assertEquals(result.uniqueArtists.has("artist 2"), true);
    assertEquals(result.uniqueArtists.has("artist 3"), true);
  });

  await t.step("should normalize artist names", () => {
    const files: FileMetadata[] = [
      { artist: "The Beatles" },
      { artist: "THE BEATLES" },
      { artist: "the beatles" },
    ];
    const result = aggregateAlbumMetadata(files);
    assertEquals(result.uniqueArtists.size, 1);
    assertEquals(result.uniqueArtists.has("the beatles"), true);
  });

  await t.step("should take first album artist", () => {
    const files: FileMetadata[] = [
      { artist: "Artist 1" },
      { artist: "Artist 2", albumArtist: "Various Artists" },
      { artist: "Artist 3", albumArtist: "Another Album Artist" },
    ];
    const result = aggregateAlbumMetadata(files);
    assertEquals(result.albumArtist, "Various Artists");
  });

  await t.step("should take first compilation flag", () => {
    const files: FileMetadata[] = [
      { artist: "Artist 1" },
      { artist: "Artist 2", compilationFlag: "1" },
      { artist: "Artist 3", compilationFlag: true },
    ];
    const result = aggregateAlbumMetadata(files);
    assertEquals(result.compilationFlag, "1");
  });

  await t.step("should handle empty metadata", () => {
    const files: FileMetadata[] = [
      {},
      {},
    ];
    const result = aggregateAlbumMetadata(files);
    assertEquals(result.uniqueArtists.size, 0);
    assertEquals(result.albumArtist, undefined);
    assertEquals(result.compilationFlag, undefined);
  });

  await t.step("should skip empty artists", () => {
    const files: FileMetadata[] = [
      { artist: "Artist 1" },
      { artist: "" },
      { artist: "Artist 2" },
    ];
    const result = aggregateAlbumMetadata(files);
    assertEquals(result.uniqueArtists.size, 2);
  });
});
