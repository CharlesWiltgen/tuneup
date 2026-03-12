import { listAudioFilesRecursive } from "../lib/fastest_audio_scan_recursive.ts";
import { readMetadataBatch } from "@charlesw/taglib-wasm/simple";
import { dirname } from "@std/path";
import {
  type AlbumFileInfo,
  fetchRecording,
  type MBRecordingResponse,
  type MBRelease,
  selectBestRelease,
} from "../lib/musicbrainz.ts";
import { ensureTagLib } from "../lib/taglib_init.ts";
import { PROPERTIES } from "@charlesw/taglib-wasm";

type TagDiff = {
  field: string;
  current: string;
  proposed: string;
};

type FileDiff = {
  path: string;
  diffs: TagDiff[];
};

type AlbumDiff = {
  directory: string;
  releaseTitle: string;
  releaseId: string;
  score: number;
  files: FileDiff[];
};

function writeStderr(text: string) {
  Deno.stderr.writeSync(new TextEncoder().encode(text));
}

export async function enrichCommand(
  options: {
    yes: boolean;
    dryRun: boolean;
    quiet: boolean;
    force: boolean;
  },
  path: string,
): Promise<void> {
  // Validate path
  let files: string[];
  try {
    const stat = await Deno.stat(path);
    if (stat.isFile) {
      files = [path];
    } else if (stat.isDirectory) {
      files = listAudioFilesRecursive([path]);
    } else {
      console.error(`Error: ${path} is not a file or directory`);
      Deno.exit(2);
      return;
    }
  } catch (err) {
    console.error(
      `Error: Cannot access ${path}: ${
        err instanceof Error ? err.message : err
      }`,
    );
    Deno.exit(2);
    return;
  }

  if (files.length === 0) {
    console.error(`Error: No audio files found in ${path}`);
    Deno.exit(2);
    return;
  }

  if (!options.quiet) {
    writeStderr(
      `Found ${files.length.toLocaleString()} files. Reading tags...\n`,
    );
  }

  // Read tags via batch API
  const batchResult = await readMetadataBatch(files, {
    concurrency: 8,
    continueOnError: true,
  });

  // Build file info and group by directory
  const taglib = await ensureTagLib();
  const albumGroups = new Map<string, AlbumFileInfo[]>();
  let skippedNoMbId = 0;
  let skippedPreviouslyEnriched = 0;

  for (const item of batchResult.items) {
    if (item.status === "error") continue;

    const props = item.data.properties;

    let audioFile = null;
    try {
      audioFile = await taglib.open(item.path, { partial: true });
      const mbTrackId =
        audioFile.getProperty(PROPERTIES.musicbrainzTrackId.key) ?? undefined;

      if (!mbTrackId) {
        skippedNoMbId++;
        continue;
      }

      // Check enrichment marker (skip if previously enriched unless --force)
      const enrichedMarker = audioFile.getProperty("AMUSIC_ENRICHED");
      if (enrichedMarker && !options.force) {
        skippedPreviouslyEnriched++;
        continue;
      }

      const tag = audioFile.tag();
      const dir = dirname(item.path);
      const fileInfo: AlbumFileInfo = {
        path: item.path,
        recordingId: mbTrackId,
        duration: props?.duration ?? 0,
        trackNumber: tag.track || undefined,
        discNumber: parseInt(audioFile.getProperty("DISCNUMBER") || "0", 10) ||
          undefined,
        existingTitle: tag.title || undefined,
        existingAlbum: tag.album || undefined,
        existingAlbumArtist: audioFile.getProperty("ALBUMARTIST") || undefined,
        existingArtist: tag.artist || undefined,
        existingYear: tag.year || undefined,
        existingGenre: tag.genre || undefined,
      };

      const group = albumGroups.get(dir) ?? [];
      group.push(fileInfo);
      albumGroups.set(dir, group);
    } catch (error) {
      console.error(
        `  Warning: Could not read tags from ${item.path}: ${
          error instanceof Error ? error.message : error
        }`,
      );
      continue;
    } finally {
      audioFile?.dispose();
    }
  }

  if (skippedNoMbId > 0 && !options.quiet) {
    writeStderr(
      `Skipped ${skippedNoMbId} files without MusicBrainz recording ID. Run 'amusic process --acoust-id' first.\n`,
    );
  }

  if (skippedPreviouslyEnriched > 0 && !options.quiet) {
    writeStderr(
      `Skipped ${skippedPreviouslyEnriched} previously enriched files. Use --force to re-enrich.\n`,
    );
  }

  if (albumGroups.size === 0) {
    console.error("No files with MusicBrainz recording IDs found.");
    Deno.exit(1);
    return;
  }

  if (!options.quiet) {
    writeStderr(
      `Processing ${albumGroups.size} album group(s)...\n\n`,
    );
  }

  // Process each album group
  let albumsEnriched = 0;
  let albumsSkipped = 0;
  let filesUpdated = 0;
  let errors = 0;

  for (const [dir, albumFiles] of albumGroups) {
    const isSingle = albumFiles.length === 1;

    // Fetch MusicBrainz data for each unique recording
    const uniqueRecordingIds = [
      ...new Set(albumFiles.map((f) => f.recordingId)),
    ];

    if (!options.quiet) {
      writeStderr(
        `${
          isSingle ? "Single" : "Album"
        }: ${dir} (${uniqueRecordingIds.length} recordings)\n`,
      );
    }

    const recordings = new Map<string, MBRecordingResponse>();
    for (const recId of uniqueRecordingIds) {
      const response = await fetchRecording(recId);
      if (response) {
        recordings.set(recId, response);
      }
    }

    if (recordings.size === 0) {
      if (!options.quiet) {
        console.error(`  Could not fetch any recordings, skipping.`);
      }
      errors++;
      continue;
    }

    // Select best release
    const bestRelease = selectBestRelease(albumFiles, recordings, {
      isSingle,
    });
    if (!bestRelease) {
      if (!options.quiet) {
        console.log(
          `  Could not confidently identify release. Skipping.`,
        );
      }
      albumsSkipped++;
      continue;
    }

    // Build diff
    const albumDiff = buildAlbumDiff(
      dir,
      albumFiles,
      bestRelease.release,
      bestRelease.score,
      recordings,
    );

    if (albumDiff.files.length === 0) {
      if (!options.quiet) {
        console.log(`  No changes needed.`);
      }
      albumsSkipped++;
      continue;
    }

    // Display diff
    displayAlbumDiff(albumDiff);

    // Confirm and apply
    let shouldApply = options.yes;
    if (!shouldApply && !options.dryRun) {
      shouldApply = confirm(
        `  Apply changes to ${albumDiff.files.length} files?`,
      );
    }

    if (shouldApply && !options.dryRun) {
      for (const fileDiff of albumDiff.files) {
        const success = await applyFileDiff(fileDiff);
        if (success) filesUpdated++;
        else errors++;
      }
      albumsEnriched++;
    } else {
      albumsSkipped++;
    }

    console.log();
  }

  // Summary
  console.log(
    `\nSummary: ${albumsEnriched} enriched, ${albumsSkipped} skipped, ${filesUpdated} files updated, ${errors} errors`,
  );

  Deno.exit(errors > 0 ? 1 : 0);
}

function buildAlbumDiff(
  directory: string,
  files: AlbumFileInfo[],
  release: MBRelease,
  score: number,
  recordings: Map<string, MBRecordingResponse>,
): AlbumDiff {
  const tracks = (release.media ?? []).flatMap((m) =>
    (m.tracks ?? []).map((t) => ({ ...t, discNumber: m.position }))
  );
  const trackByRecording = new Map(
    tracks.map((t) => [t.recording.id, t]),
  );

  const releaseArtist = release["artist-credit"]
    ?.map((c) => c.name)
    .join(", ") ?? "";
  const releaseYear = release.date?.substring(0, 4) ?? "";

  const fileDiffs: FileDiff[] = [];

  for (const file of files) {
    const recording = recordings.get(file.recordingId);
    const track = trackByRecording.get(file.recordingId);
    if (!recording) continue;

    const diffs: TagDiff[] = [];

    // Title
    if (recording.title && file.existingTitle !== recording.title) {
      diffs.push({
        field: "Title",
        current: file.existingTitle ?? "(empty)",
        proposed: recording.title,
      });
    }

    // Artist
    const recordingArtist = recording["artist-credit"]
      ?.map((c) => c.name)
      .join(", ") ?? "";
    if (recordingArtist && file.existingArtist !== recordingArtist) {
      diffs.push({
        field: "Artist",
        current: file.existingArtist ?? "(empty)",
        proposed: recordingArtist,
      });
    }

    // Album
    if (release.title && file.existingAlbum !== release.title) {
      diffs.push({
        field: "Album",
        current: file.existingAlbum ?? "(empty)",
        proposed: release.title,
      });
    }

    // Album Artist
    if (releaseArtist && file.existingAlbumArtist !== releaseArtist) {
      diffs.push({
        field: "Album Artist",
        current: file.existingAlbumArtist ?? "(empty)",
        proposed: releaseArtist,
      });
    }

    // Year
    if (releaseYear && file.existingYear !== parseInt(releaseYear, 10)) {
      diffs.push({
        field: "Year",
        current: file.existingYear?.toString() ?? "(empty)",
        proposed: releaseYear,
      });
    }

    // Track number
    if (track && file.trackNumber !== track.position) {
      diffs.push({
        field: "Track",
        current: file.trackNumber?.toString() ?? "(empty)",
        proposed: String(track.position),
      });
    }

    // Disc number
    if (track && file.discNumber !== track.discNumber) {
      diffs.push({
        field: "Disc Number",
        current: file.discNumber?.toString() ?? "(empty)",
        proposed: String(track.discNumber),
      });
    }

    // Genre
    const genres = (recording.genres ?? [])
      .sort((a, b) => b.count - a.count)
      .map((g) => g.name);
    const newGenre = genres[0] ?? "";
    if (newGenre && file.existingGenre !== newGenre) {
      diffs.push({
        field: "Genre",
        current: file.existingGenre ?? "(empty)",
        proposed: newGenre,
      });
    }

    if (diffs.length > 0) {
      fileDiffs.push({ path: file.path, diffs });
    }
  }

  return {
    directory,
    releaseTitle: release.title,
    releaseId: release.id,
    score,
    files: fileDiffs,
  };
}

function displayAlbumDiff(diff: AlbumDiff): void {
  console.log(
    `  Release: "${diff.releaseTitle}" (score: ${diff.score.toFixed(2)})`,
  );
  for (const fileDiff of diff.files) {
    const filename = fileDiff.path.split("/").pop() ?? fileDiff.path;
    console.log(`    ${filename}:`);
    for (const d of fileDiff.diffs) {
      console.log(
        `      ${d.field}: "${d.current}" \u2192 "${d.proposed}"`,
      );
    }
  }
}

async function applyFileDiff(fileDiff: FileDiff): Promise<boolean> {
  const taglib = await ensureTagLib();
  let audioFile = null;
  try {
    audioFile = await taglib.open(fileDiff.path);
    const tag = audioFile.tag();
    for (const diff of fileDiff.diffs) {
      switch (diff.field) {
        case "Title":
          tag.setTitle(diff.proposed);
          break;
        case "Artist":
          tag.setArtist(diff.proposed);
          break;
        case "Album":
          tag.setAlbum(diff.proposed);
          break;
        case "Album Artist":
          audioFile.setProperty("ALBUMARTIST", diff.proposed);
          break;
        case "Year":
          tag.setYear(parseInt(diff.proposed, 10));
          break;
        case "Track":
          tag.setTrack(parseInt(diff.proposed, 10));
          break;
        case "Disc Number":
          audioFile.setProperty("DISCNUMBER", diff.proposed);
          break;
        case "Genre":
          tag.setGenre(diff.proposed);
          break;
      }
    }
    // Write AMUSIC_ENRICHED marker
    audioFile.setProperty("AMUSIC_ENRICHED", "1");
    await audioFile.saveToFile();
    return true;
  } catch (error) {
    console.error(`  Error writing tags to ${fileDiff.path}: ${error}`);
    return false;
  } finally {
    audioFile?.dispose();
  }
}
