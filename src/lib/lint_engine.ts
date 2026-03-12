import { readMetadataBatch } from "@charlesw/taglib-wasm/simple";
import { dirname, extname } from "@std/path";
import { normalizeForMatching } from "../utils/normalize.ts";
import { readFileHeader, validateFileHeader } from "./lint_media.ts";
import type {
  AlbumIndex,
  FileMetadataForLint,
  LintIssue,
  LintSummary,
  Severity,
} from "./lint.ts";
import {
  createLintSummary,
  runAlbumRules,
  runFileMetadataRules,
} from "./lint.ts";

const LOSSY_EXTENSIONS = new Set([".mp3", ".ogg", ".aac", ".opus", ".wma"]);
const LOSSLESS_EXTENSIONS = new Set([".wav", ".flac", ".alac"]);

export function classifyLossy(
  ext: string,
  isLossless: boolean | undefined,
): boolean {
  if (LOSSY_EXTENSIONS.has(ext)) return true;
  if (LOSSLESS_EXTENSIONS.has(ext)) return false;
  if (isLossless === true) return false;
  return true;
}

export function addToAlbumIndex(
  index: AlbumIndex,
  normalizedAlbum: string,
  file: FileMetadataForLint,
): void {
  let entry = index.get(normalizedAlbum);
  if (!entry) {
    entry = {
      albumArtists: new Set(),
      years: new Set(),
      trackNumbers: new Map(),
      discNumbers: new Set(),
      formats: new Set(),
      sampleRates: new Set(),
      directories: new Set(),
      fileCount: 0,
      files: [],
    };
    index.set(normalizedAlbum, entry);
  }

  const artist = file.albumArtist ?? file.artist;
  if (artist) entry.albumArtists.add(artist);
  if (file.year !== undefined) entry.years.add(file.year);

  const discNumber = 0;
  if (file.track !== undefined) {
    const tracks = entry.trackNumbers.get(discNumber) ?? [];
    tracks.push(String(file.track));
    entry.trackNumbers.set(discNumber, tracks);
  }

  entry.formats.add(file.isLossy ? "lossy" : "lossless");
  entry.sampleRates.add(file.sampleRate);
  entry.directories.add(dirname(file.path));
  entry.fileCount++;
  entry.files.push(file.path);
}

export type LintOptions = {
  deep: boolean;
  severity: Severity;
  quiet: boolean;
  json: boolean;
};

export type LintResult = {
  issues: LintIssue[];
  summary: LintSummary;
};

interface ExtendedBatchTags {
  title?: string[];
  artist?: string[];
  album?: string[];
  albumArtist?: string[];
  year?: number;
  track?: number;
  genre?: string[];
  acoustidFingerprint?: string[];
  acoustidId?: string[];
}

function batchItemToFileMetadata(
  item: {
    path: string;
    data: {
      tags?: unknown;
      properties?: {
        duration?: number;
        bitrate?: number;
        sampleRate?: number;
        channels?: number;
        codec?: string;
        containerFormat?: string;
        isLossless?: boolean;
      };
      dynamics?: {
        replayGainTrackGain?: string;
        replayGainAlbumGain?: string;
      };
      hasCoverArt?: boolean;
    };
  },
): FileMetadataForLint {
  const tags = item.data.tags as ExtendedBatchTags | undefined;
  const props = item.data.properties;
  const dynamics = item.data.dynamics;
  const ext = extname(item.path).toLowerCase();

  return {
    path: item.path,
    title: tags?.title?.[0],
    artist: tags?.artist?.[0],
    albumArtist: tags?.albumArtist?.[0],
    album: tags?.album?.[0],
    year: tags?.year,
    track: tags?.track,
    genre: tags?.genre?.[0],
    hasCoverArt: item.data.hasCoverArt ?? false,
    hasReplayGain: dynamics?.replayGainTrackGain !== undefined ||
      dynamics?.replayGainAlbumGain !== undefined,
    hasAcoustId: (tags?.acoustidFingerprint?.[0] !== undefined) ||
      (tags?.acoustidId?.[0] !== undefined),
    duration: props?.duration ?? 0,
    bitrate: props?.bitrate ?? 0,
    sampleRate: props?.sampleRate ?? 0,
    channels: props?.channels ?? 0,
    codec: props?.codec ?? "",
    containerFormat: props?.containerFormat ?? "",
    isLossy: classifyLossy(ext, props?.isLossless),
  };
}

export async function runLint(
  files: string[],
  options: LintOptions,
  onIssue?: (issue: LintIssue) => void,
  onProgress?: (processed: number, total: number) => void,
): Promise<LintResult> {
  const issues: LintIssue[] = [];
  const albumIndex: AlbumIndex = new Map();
  let processed = 0;

  const batchResult = await readMetadataBatch(files, {
    concurrency: 8,
    continueOnError: true,
  });

  for (const item of batchResult.items) {
    processed++;
    onProgress?.(processed, files.length);

    if (item.status === "error") {
      const issue: LintIssue = {
        type: "issue",
        rule: "parse-failure",
        severity: "error",
        file: item.path,
        message: `Failed to read metadata: ${item.error}`,
      };
      issues.push(issue);
      onIssue?.(issue);
      continue;
    }

    const fileMeta = batchItemToFileMetadata(item);

    const fileIssues = runFileMetadataRules(fileMeta);
    for (const issue of fileIssues) {
      issues.push(issue);
      onIssue?.(issue);
    }

    if (options.deep) {
      const ext = extname(item.path).toLowerCase();
      const headerBytes = await readFileHeader(item.path);
      const headerIssues = validateFileHeader(item.path, ext, headerBytes);
      for (const issue of headerIssues) {
        issues.push(issue);
        onIssue?.(issue);
      }
    }

    if (fileMeta.album) {
      const normalizedAlbum = normalizeForMatching(fileMeta.album, {
        stripLeadingArticles: false,
        romanToArabic: false,
      });
      addToAlbumIndex(albumIndex, normalizedAlbum, fileMeta);
    }
  }

  const albumIssues = runAlbumRules(albumIndex);
  for (const issue of albumIssues) {
    issues.push(issue);
    onIssue?.(issue);
  }

  const summary = createLintSummary(issues, files.length);
  return { issues, summary };
}
