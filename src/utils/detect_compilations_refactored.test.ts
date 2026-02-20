import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { copy } from "@std/fs";
import { detectCompilationsRefactored } from "./detect_compilations_refactored.ts";
import { ensureTagLib } from "../lib/taglib_init.ts";

// Helper to create test audio files with metadata
async function createTestAudioFile(
  dir: string,
  filename: string,
  metadata: {
    artist?: string;
    albumArtist?: string;
    album?: string;
    compilation?: string | boolean;
  },
): Promise<void> {
  const taglib = await ensureTagLib();

  // Copy a sample MP3 file as base
  const sourceFile = "sample_audio_files/mp3_sample_512kb.mp3";
  const filePath = join(dir, filename);
  await copy(sourceFile, filePath);

  // Read the file and add metadata
  const fileData = await Deno.readFile(filePath);
  const tags = await taglib.open(fileData);
  try {
    if (metadata.artist) tags.setProperty("ARTIST", metadata.artist);
    if (metadata.albumArtist) {
      tags.setProperty("ALBUMARTIST", metadata.albumArtist);
    }
    if (metadata.album) tags.setProperty("ALBUM", metadata.album);
    if (metadata.compilation !== undefined) {
      tags.setProperty("COMPILATION", String(metadata.compilation));
    }

    const saveResult = tags.save();
    if (!saveResult) {
      throw new Error("Failed to save tags");
    }

    const buffer = tags.getFileBuffer();
    await Deno.writeFile(filePath, new Uint8Array(buffer));
  } finally {
    tags.dispose();
  }
}

Deno.test("detectCompilationsRefactored", async (t) => {
  const testDir = await Deno.makeTempDir();

  await t.step("should detect compilation by Various Artists", async () => {
    const albumDir = join(testDir, "various-artists-album");
    await Deno.mkdir(albumDir);

    await createTestAudioFile(albumDir, "01-track.mp3", {
      artist: "Artist 1",
      albumArtist: "Various Artists",
      album: "Greatest Hits",
    });

    await createTestAudioFile(albumDir, "02-track.mp3", {
      artist: "Artist 2",
      albumArtist: "Various Artists",
      album: "Greatest Hits",
    });

    const albums = new Map([[albumDir, [
      join(albumDir, "01-track.mp3"),
      join(albumDir, "02-track.mp3"),
    ]]]);

    const result = await detectCompilationsRefactored(albums, true);

    assertEquals(result.albums.size, 0);
    assertEquals(result.compilations.size, 1);
    assertEquals(result.compilations.has(albumDir), true);
  });

  await t.step("should detect compilation by flag", async () => {
    const albumDir = join(testDir, "compilation-flag-album");
    await Deno.mkdir(albumDir);

    await createTestAudioFile(albumDir, "01-track.mp3", {
      artist: "Artist 1",
      album: "Dance Mix",
      compilation: "1",
    });

    await createTestAudioFile(albumDir, "02-track.mp3", {
      artist: "Artist 2",
      album: "Dance Mix",
      compilation: "1",
    });

    const albums = new Map([[albumDir, [
      join(albumDir, "01-track.mp3"),
      join(albumDir, "02-track.mp3"),
    ]]]);

    const result = await detectCompilationsRefactored(albums);

    assertEquals(result.albums.size, 0);
    assertEquals(result.compilations.size, 1);
    assertEquals(result.compilations.has(albumDir), true);
  });

  await t.step("should detect compilation by artist diversity", async () => {
    const albumDir = join(testDir, "diverse-artists-album");
    await Deno.mkdir(albumDir);

    await createTestAudioFile(albumDir, "01-track.mp3", {
      artist: "Artist 1",
      album: "Mix Tape",
    });

    await createTestAudioFile(albumDir, "02-track.mp3", {
      artist: "Artist 2",
      album: "Mix Tape",
    });

    await createTestAudioFile(albumDir, "03-track.mp3", {
      artist: "Artist 3",
      album: "Mix Tape",
    });

    const albums = new Map([[albumDir, [
      join(albumDir, "01-track.mp3"),
      join(albumDir, "02-track.mp3"),
      join(albumDir, "03-track.mp3"),
    ]]]);

    const result = await detectCompilationsRefactored(albums);

    assertEquals(result.albums.size, 0);
    assertEquals(result.compilations.size, 1);
    assertEquals(result.compilations.has(albumDir), true);
  });

  await t.step("should not detect regular album", async () => {
    const albumDir = join(testDir, "regular-album");
    await Deno.mkdir(albumDir);

    await createTestAudioFile(albumDir, "01-track.mp3", {
      artist: "The Beatles",
      albumArtist: "The Beatles",
      album: "Abbey Road",
    });

    await createTestAudioFile(albumDir, "02-track.mp3", {
      artist: "The Beatles",
      albumArtist: "The Beatles",
      album: "Abbey Road",
    });

    const albums = new Map([[albumDir, [
      join(albumDir, "01-track.mp3"),
      join(albumDir, "02-track.mp3"),
    ]]]);

    const result = await detectCompilationsRefactored(albums);

    assertEquals(result.albums.size, 1);
    assertEquals(result.compilations.size, 0);
    assertEquals(result.albums.has(albumDir), true);
  });

  await t.step("should handle multiple albums", async () => {
    const regularDir = join(testDir, "regular-multi");
    const compilationDir = join(testDir, "compilation-multi");
    await Deno.mkdir(regularDir);
    await Deno.mkdir(compilationDir);

    // Regular album
    await createTestAudioFile(regularDir, "01-track.mp3", {
      artist: "Artist A",
      album: "Regular Album",
    });

    // Compilation
    await createTestAudioFile(compilationDir, "01-track.mp3", {
      artist: "Artist 1",
      albumArtist: "Various Artists",
      album: "Compilation Album",
    });

    const albums = new Map([
      [regularDir, [join(regularDir, "01-track.mp3")]],
      [compilationDir, [join(compilationDir, "01-track.mp3")]],
    ]);

    const result = await detectCompilationsRefactored(albums);

    assertEquals(result.albums.size, 1);
    assertEquals(result.compilations.size, 1);
    assertEquals(result.albums.has(regularDir), true);
    assertEquals(result.compilations.has(compilationDir), true);
  });

  // Cleanup
  await Deno.remove(testDir, { recursive: true });
});
