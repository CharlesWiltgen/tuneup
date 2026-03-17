import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { groupTracksByAlbum, type TrackMetadata } from "./album_grouping.ts";

describe("groupTracksByAlbum", () => {
  it("should group tracks with same album name and album artist", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "Abbey Road", albumArtist: "The Beatles" },
      { path: "t2.mp3", albumName: "Abbey Road", albumArtist: "The Beatles" },
      { path: "t3.mp3", albumName: "Abbey Road", albumArtist: "The Beatles" },
    ];
    const { albums, singles } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 1);
    assertEquals(albums[0].files, ["t1.mp3", "t2.mp3", "t3.mp3"]);
    assertEquals(albums[0].albumName, "Abbey Road");
    assertEquals(albums[0].isCompilation, false);
    assertEquals(singles, []);
  });

  it("should treat tracks with no album metadata as singles", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3" },
      { path: "t2.mp3" },
    ];
    const { albums, singles } = groupTracksByAlbum(tracks);
    assertEquals(albums, []);
    assertEquals(singles, ["t1.mp3", "t2.mp3"]);
  });

  it("should ignore album artist when it is 'Various Artists'", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "Now 47", albumArtist: "Various Artists" },
      { path: "t2.mp3", albumName: "Now 47", albumArtist: "Various Artists" },
      { path: "t3.mp3", albumName: "Now 98", albumArtist: "Various Artists" },
      { path: "t4.mp3", albumName: "Now 98", albumArtist: "Various Artists" },
    ];
    const { albums } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 2);
    const albumNames = albums.map((a) => a.albumName).sort();
    assertEquals(albumNames, ["Now 47", "Now 98"]);
  });

  it("should ignore blank album artist for grouping", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "Compilation", albumArtist: "" },
      { path: "t2.mp3", albumName: "Compilation" },
    ];
    const { albums } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 1);
    assertEquals(albums[0].files, ["t1.mp3", "t2.mp3"]);
  });

  it("should separate different albums in same folder", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "Album A", albumArtist: "Artist" },
      { path: "t2.mp3", albumName: "Album A", albumArtist: "Artist" },
      { path: "t3.mp3", albumName: "Album B", albumArtist: "Artist" },
      { path: "t4.mp3", albumName: "Album B", albumArtist: "Artist" },
    ];
    const { albums } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 2);
  });

  it("should treat single-track groups as singles", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "Album A", albumArtist: "Artist" },
      { path: "t2.mp3", albumName: "Album A", albumArtist: "Artist" },
      { path: "t3.mp3", albumName: "Orphan", albumArtist: "Other" },
    ];
    const { albums, singles } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 1);
    assertEquals(albums[0].files, ["t1.mp3", "t2.mp3"]);
    assertEquals(singles, ["t3.mp3"]);
  });

  it("should use normalized album names for grouping", () => {
    const tracks: TrackMetadata[] = [
      {
        path: "t1.mp3",
        albumName: "The Köln Concert",
        albumArtist: "Keith Jarrett",
      },
      {
        path: "t2.mp3",
        albumName: "the koln concert",
        albumArtist: "Keith Jarrett",
      },
    ];
    const { albums } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 1);
    assertEquals(albums[0].files, ["t1.mp3", "t2.mp3"]);
  });

  it("should detect compilations — 3+ distinct track artists", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "Now 47", artist: "Artist A" },
      { path: "t2.mp3", albumName: "Now 47", artist: "Artist B" },
      { path: "t3.mp3", albumName: "Now 47", artist: "Artist C" },
    ];
    const { albums } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 1);
    assertEquals(albums[0].isCompilation, true);
  });

  it("should not flag as compilation with fewer than 3 distinct artists", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "Split EP", artist: "Band A" },
      { path: "t2.mp3", albumName: "Split EP", artist: "Band B" },
    ];
    const { albums } = groupTracksByAlbum(tracks);
    assertEquals(albums.length, 1);
    assertEquals(albums[0].isCompilation, false);
  });

  it("should treat whitespace-only album names as singles", () => {
    const tracks: TrackMetadata[] = [
      { path: "t1.mp3", albumName: "   " },
      { path: "t2.mp3", albumName: "---" },
    ];
    const { albums, singles } = groupTracksByAlbum(tracks);
    assertEquals(albums, []);
    assertEquals(singles, ["t1.mp3", "t2.mp3"]);
  });

  it("should return empty results for empty input", () => {
    const { albums, singles } = groupTracksByAlbum([]);
    assertEquals(albums, []);
    assertEquals(singles, []);
  });
});
