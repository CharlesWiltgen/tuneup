import { PROPERTIES, type TagLib } from "@charlesw/taglib-wasm";
import {
  readMetadataBatch,
  readProperties,
  readTags,
} from "@charlesw/taglib-wasm/simple";
import { ensureTagLib } from "./taglib_init.ts";
import { formatError } from "../utils/error_utils.ts";

async function openFileForRead(taglib: TagLib, filePath: string) {
  return await taglib.open(filePath, { partial: true });
}

async function openFileForWrite(taglib: TagLib, filePath: string) {
  return await taglib.open(filePath);
}

/**
 * Reads ACOUSTID_FINGERPRINT and ACOUSTID_ID tags from a file using Taglib-Wasm.
 * Returns an object with the tags or null if not found or an error occurs.
 */
export async function getAcoustIDTags(
  filePath: string,
): Promise<{ ACOUSTID_FINGERPRINT?: string; ACOUSTID_ID?: string } | null> {
  const taglib = await ensureTagLib();

  let audioFile = null;
  try {
    audioFile = await openFileForRead(taglib, filePath);

    const tags: { ACOUSTID_FINGERPRINT?: string; ACOUSTID_ID?: string } = {};

    const fingerprint = audioFile.getProperty(
      PROPERTIES.acoustidFingerprint.key,
    );
    if (fingerprint) {
      tags.ACOUSTID_FINGERPRINT = fingerprint;
    }

    const acoustId = audioFile.getProperty(PROPERTIES.acoustidId.key);
    if (acoustId) {
      tags.ACOUSTID_ID = acoustId;
    }

    return Object.keys(tags).length > 0 ? tags : null;
  } catch (error) {
    console.error(`Error reading tags from ${filePath}: ${formatError(error)}`);
    return null;
  } finally {
    if (audioFile) {
      audioFile.dispose();
    }
  }
}

/**
 * Checks if the audio file already has AcoustID related tags.
 * Returns true if tags are found, false otherwise.
 */
export async function hasAcoustIDTags(filePath: string): Promise<boolean> {
  try {
    // Use Simple API for efficient tag checking
    const _tags = await readTags(filePath);
    // Check if tags have acoustID properties (may need to check via Full API if not exposed)
    const fullTags = await getAcoustIDTags(filePath);
    return fullTags !== null &&
      (!!fullTags.ACOUSTID_FINGERPRINT || !!fullTags.ACOUSTID_ID);
  } catch (error) {
    console.error(
      `Error checking AcoustID tags for ${filePath}: ${formatError(error)}`,
    );
    return false;
  }
}

/**
 * Gets the duration of an audio file in seconds using Taglib-Wasm.
 */
export async function getAudioDuration(filePath: string): Promise<number> {
  try {
    // Use Simple API for efficient read operation
    const properties = await readProperties(filePath);
    return properties?.duration || 0;
  } catch (error) {
    console.error(
      `Error getting audio duration from ${filePath}: ${formatError(error)}`,
    );
    return 0;
  }
}

/**
 * Writes ACOUSTID_FINGERPRINT and ACOUSTID_ID tags to the file using Taglib-Wasm.
 *
 * @param filePath Path to the audio file to tag.
 * @param fingerprint The fingerprint to embed.
 * @param acoustID The AcoustID to embed.
 * @returns True if tagging succeeded, false otherwise.
 */
export async function writeAcoustIDTags(
  filePath: string,
  fingerprint: string,
  acoustID: string,
): Promise<boolean> {
  const taglib = await ensureTagLib();

  let audioFile = null;
  try {
    audioFile = await openFileForWrite(taglib, filePath);

    audioFile.setProperty(PROPERTIES.acoustidFingerprint.key, fingerprint);
    if (acoustID) {
      audioFile.setProperty(PROPERTIES.acoustidId.key, acoustID);
    }

    await audioFile.saveToFile();
    return true;
  } catch (error) {
    console.error(
      `Error writing AcoustID tags to ${filePath}: ${formatError(error)}`,
    );
    return false;
  } finally {
    if (audioFile) {
      audioFile.dispose();
    }
  }
}

export type MusicBrainzIds = {
  trackId?: string;
  artistId?: string;
  releaseId?: string;
};

/**
 * Writes MusicBrainz ID tags to an audio file.
 * @param filePath Path to the audio file
 * @param ids Object containing MusicBrainz IDs to write
 * @returns True if successful, false otherwise
 */
export async function writeMusicBrainzTags(
  filePath: string,
  ids: MusicBrainzIds,
): Promise<boolean> {
  if (!ids.trackId && !ids.artistId && !ids.releaseId) {
    return true;
  }

  const taglib = await ensureTagLib();

  let audioFile = null;
  try {
    audioFile = await openFileForWrite(taglib, filePath);

    if (ids.trackId) {
      audioFile.setProperty(PROPERTIES.musicbrainzTrackId.key, ids.trackId);
    }
    if (ids.artistId) {
      audioFile.setProperty(PROPERTIES.musicbrainzArtistId.key, ids.artistId);
    }
    if (ids.releaseId) {
      audioFile.setProperty(PROPERTIES.musicbrainzReleaseId.key, ids.releaseId);
    }

    await audioFile.saveToFile();
    return true;
  } catch (error) {
    console.error(
      `Error writing MusicBrainz tags to ${filePath}: ${formatError(error)}`,
    );
    return false;
  } finally {
    if (audioFile) {
      audioFile.dispose();
    }
  }
}

/**
 * Checks if an audio file has a MusicBrainz track ID tag.
 * Returns true if the tag is present, false otherwise (including on error).
 */
export async function hasMusicBrainzTags(filePath: string): Promise<boolean> {
  const taglib = await ensureTagLib();

  let audioFile = null;
  try {
    audioFile = await openFileForRead(taglib, filePath);
    const trackId = audioFile.getProperty(PROPERTIES.musicbrainzTrackId.key);
    return trackId !== null && trackId !== undefined && trackId.length > 0;
  } catch (error) {
    console.error(
      `Error checking MusicBrainz tags for ${filePath}: ${formatError(error)}`,
    );
    return false;
  } finally {
    if (audioFile) {
      audioFile.dispose();
    }
  }
}

/**
 * Gets ReplayGain tags from an audio file.
 * Returns an object with all ReplayGain values or null if none exist.
 */
export async function getReplayGainTags(
  filePath: string,
): Promise<
  {
    trackGain?: string;
    trackPeak?: string;
    albumGain?: string;
    albumPeak?: string;
  } | null
> {
  const taglib = await ensureTagLib();

  let audioFile = null;
  try {
    audioFile = await openFileForRead(taglib, filePath);

    const tags: {
      trackGain?: string;
      trackPeak?: string;
      albumGain?: string;
      albumPeak?: string;
    } = {};

    const trackGain = audioFile.getProperty(PROPERTIES.replayGainTrackGain.key);
    if (trackGain !== null && trackGain !== undefined) {
      tags.trackGain = trackGain;
    }

    const trackPeak = audioFile.getProperty(PROPERTIES.replayGainTrackPeak.key);
    if (trackPeak !== null && trackPeak !== undefined) {
      tags.trackPeak = trackPeak;
    }

    const albumGain = audioFile.getProperty(PROPERTIES.replayGainAlbumGain.key);
    if (albumGain !== null && albumGain !== undefined) {
      tags.albumGain = albumGain;
    }

    const albumPeak = audioFile.getProperty(PROPERTIES.replayGainAlbumPeak.key);
    if (albumPeak !== null && albumPeak !== undefined) {
      tags.albumPeak = albumPeak;
    }

    return Object.keys(tags).length > 0 ? tags : null;
  } catch (error) {
    console.error(
      `Error reading ReplayGain tags from ${filePath}: ${formatError(error)}`,
    );
    return null;
  } finally {
    if (audioFile) {
      audioFile.dispose();
    }
  }
}

/**
 * Writes ReplayGain tags to an audio file.
 * @param filePath Path to the audio file
 * @param tags Object containing ReplayGain values to write
 * @returns True if successful, false otherwise
 */
export async function writeReplayGainTags(
  filePath: string,
  tags: {
    trackGain?: string;
    trackPeak?: string;
    albumGain?: string;
    albumPeak?: string;
  },
): Promise<boolean> {
  const taglib = await ensureTagLib();

  let audioFile = null;
  try {
    audioFile = await openFileForWrite(taglib, filePath);

    if (tags.trackGain !== undefined) {
      audioFile.setProperty(PROPERTIES.replayGainTrackGain.key, tags.trackGain);
    }
    if (tags.trackPeak !== undefined) {
      audioFile.setProperty(PROPERTIES.replayGainTrackPeak.key, tags.trackPeak);
    }
    if (tags.albumGain !== undefined) {
      audioFile.setProperty(PROPERTIES.replayGainAlbumGain.key, tags.albumGain);
    }
    if (tags.albumPeak !== undefined) {
      audioFile.setProperty(PROPERTIES.replayGainAlbumPeak.key, tags.albumPeak);
    }

    await audioFile.saveToFile();
    return true;
  } catch (error) {
    console.error(
      `Error writing ReplayGain tags to ${filePath}: ${formatError(error)}`,
    );
    return false;
  } finally {
    if (audioFile) {
      audioFile.dispose();
    }
  }
}

/**
 * Gets comprehensive metadata from an audio file using PropertyMap.
 * This function accesses ALL metadata fields, including non-standard ones.
 */
export async function getComprehensiveMetadataWithPropertyMap(
  filePath: string,
): Promise<Record<string, string[] | undefined> | null> {
  const taglib = await ensureTagLib();

  let audioFile = null;
  try {
    audioFile = await openFileForRead(taglib, filePath);
    const properties = audioFile.properties();

    // Return all properties as-is for maximum flexibility
    return properties;
  } catch (error) {
    console.error(
      `Error reading property map from ${filePath}: ${formatError(error)}`,
    );
    return null;
  } finally {
    if (audioFile) {
      audioFile.dispose();
    }
  }
}

/**
 * Gets comprehensive metadata from an audio file.
 * Returns an object with all available metadata.
 */
export async function getComprehensiveMetadata(
  filePath: string,
): Promise<
  {
    // Basic tags
    title?: string;
    artist?: string;
    album?: string;
    comment?: string;
    genre?: string;
    year?: number;
    track?: number;

    // Audio properties
    duration?: number;
    bitrate?: number;
    sampleRate?: number;
    channels?: number;
    format?: string;

    // Extended tags
    acoustIdFingerprint?: string;
    acoustIdId?: string;
    musicBrainzTrackId?: string;
    musicBrainzReleaseId?: string;
    musicBrainzArtistId?: string;

    // ReplayGain
    replayGainTrackGain?: string;
    replayGainTrackPeak?: string;
    replayGainAlbumGain?: string;
    replayGainAlbumPeak?: string;

    // Cover art
    hasCoverArt?: boolean;
    coverArtCount?: number;
  } | null
> {
  const taglib = await ensureTagLib();

  let audioFile = null;
  try {
    audioFile = await openFileForRead(taglib, filePath);

    const metadata: Record<string, unknown> = {};

    // Basic tags
    const tag = audioFile.tag();
    if (tag.title) metadata.title = tag.title;
    if (tag.artist) metadata.artist = tag.artist;
    if (tag.album) metadata.album = tag.album;
    if (tag.comment) metadata.comment = tag.comment;
    if (tag.genre) metadata.genre = tag.genre;
    if (tag.year) metadata.year = tag.year;
    if (tag.track) metadata.track = tag.track;

    // Audio properties
    const props = audioFile.audioProperties();
    if (props?.duration !== undefined) metadata.duration = props.duration;
    if (props?.bitrate !== undefined) metadata.bitrate = props.bitrate;
    if (props?.sampleRate !== undefined) metadata.sampleRate = props.sampleRate;
    if (props?.channels !== undefined) metadata.channels = props.channels;

    // Format - derive from file extension
    const format = filePath.substring(filePath.lastIndexOf(".") + 1)
      .toUpperCase();
    if (format) metadata.format = format;

    // Extended tags - use getProperty
    // AcoustID
    const fingerprint = audioFile.getProperty(
      PROPERTIES.acoustidFingerprint.key,
    );
    if (fingerprint) {
      metadata.acoustIdFingerprint = fingerprint;
    }
    const acoustId = audioFile.getProperty(PROPERTIES.acoustidId.key);
    if (acoustId) {
      metadata.acoustIdId = acoustId;
    }

    // MusicBrainz
    const mbTrackId = audioFile.getProperty(PROPERTIES.musicbrainzTrackId.key);
    if (mbTrackId) {
      metadata.musicBrainzTrackId = mbTrackId;
    }
    const mbReleaseId = audioFile.getProperty(
      PROPERTIES.musicbrainzReleaseId.key,
    );
    if (mbReleaseId) {
      metadata.musicBrainzReleaseId = mbReleaseId;
    }
    const mbArtistId = audioFile.getProperty(
      PROPERTIES.musicbrainzArtistId.key,
    );
    if (mbArtistId) {
      metadata.musicBrainzArtistId = mbArtistId;
    }

    // ReplayGain
    const trackGain = audioFile.getProperty(PROPERTIES.replayGainTrackGain.key);
    if (trackGain !== null && trackGain !== undefined) {
      metadata.replayGainTrackGain = trackGain;
    }
    const trackPeak = audioFile.getProperty(PROPERTIES.replayGainTrackPeak.key);
    if (trackPeak !== null && trackPeak !== undefined) {
      metadata.replayGainTrackPeak = trackPeak;
    }
    const albumGain = audioFile.getProperty(PROPERTIES.replayGainAlbumGain.key);
    if (albumGain !== null && albumGain !== undefined) {
      metadata.replayGainAlbumGain = albumGain;
    }
    const albumPeak = audioFile.getProperty(PROPERTIES.replayGainAlbumPeak.key);
    if (albumPeak !== null && albumPeak !== undefined) {
      metadata.replayGainAlbumPeak = albumPeak;
    }

    // Cover art
    try {
      const pictures = audioFile.getPictures();
      if (pictures && pictures.length > 0) {
        metadata.hasCoverArt = true;
        metadata.coverArtCount = pictures.length;
      } else {
        metadata.hasCoverArt = false;
        metadata.coverArtCount = 0;
      }
    } catch {
      // Some formats may not support pictures
      metadata.hasCoverArt = false;
      metadata.coverArtCount = 0;
    }

    return Object.keys(metadata).length > 0 ? metadata : null;
  } catch (error) {
    console.error(
      `Error reading comprehensive metadata from ${filePath}: ${
        formatError(error)
      }`,
    );
    return null;
  } finally {
    if (audioFile) {
      audioFile.dispose();
    }
  }
}

/**
 * Batch check for AcoustID tags across multiple files.
 * Returns a map of filePath to boolean indicating presence of tags.
 */
export async function batchCheckAcoustIDTags(
  filePaths: string[],
  concurrency: number = 8,
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();

  // Process in chunks for memory efficiency
  const chunkSize = 100;
  for (let i = 0; i < filePaths.length; i += chunkSize) {
    const chunk = filePaths.slice(i, i + chunkSize);

    // Use readMetadataBatch for efficient batch reading
    const batchResult = await readMetadataBatch(chunk, {
      concurrency,
      continueOnError: true,
    });

    // Check each result for AcoustID tags
    for (const result of batchResult.items) {
      if (result.status === "error") {
        results.set(result.path, false);
        continue;
      }

      const hasAcoustId = await hasAcoustIDTags(result.path);
      results.set(result.path, hasAcoustId);
    }
  }

  return results;
}

/**
 * Batch read audio properties for multiple files.
 * Much faster than reading files individually.
 */
export async function batchGetAudioProperties(
  filePaths: string[],
  concurrency: number = 8,
): Promise<Map<string, { duration: number; bitrate: number }>> {
  const results = new Map<string, { duration: number; bitrate: number }>();

  const batchResult = await readMetadataBatch(filePaths, {
    concurrency,
    continueOnError: true,
  });

  for (const result of batchResult.items) {
    if (result.status === "ok" && result.data.properties) {
      results.set(result.path, {
        duration: result.data.properties.duration || 0,
        bitrate: result.data.properties.bitrate || 0,
      });
    }
  }

  return results;
}
