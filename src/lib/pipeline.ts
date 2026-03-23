// src/lib/pipeline.ts

import { dirname, extname } from "@std/path";
import type { ConfidenceCategory } from "./confidence.ts";
import { categorizeConfidence } from "./confidence.ts";
import { discoverMusic as realDiscoverMusic } from "../utils/fast_discovery.ts";
import type { MusicDiscovery } from "../utils/fast_discovery.ts";
import {
  extractMusicBrainzIds,
  generateFingerprint as realGenerateFingerprint,
  lookupFingerprint as realLookupFingerprint,
  type LookupResult,
} from "./acoustid.ts";
import {
  getAudioDuration as realGetAudioDuration,
  getComprehensiveMetadata as realGetComprehensiveMetadata,
} from "./tagging.ts";
import {
  type AlbumFileInfo,
  fetchRecording as realFetchRecording,
  joinArtistCredits,
  type MBRecordingResponse,
  RateLimiter,
  type ScoredRelease,
  selectBestRelease,
} from "./musicbrainz.ts";
import { ensureTagLib } from "./taglib_init.ts";
import type { CoverArtResult } from "./cover_art.ts";
import { fetchCoverArt as realFetchCoverArt } from "./cover_art.ts";
import type { FileQualityInfo } from "./duplicate_detection.ts";
import { detectDuplicates } from "./duplicate_detection.ts";
import type { ReviewDecision, ReviewItem } from "./review.ts";
import { runBatchReview as realRunBatchReview } from "./review.ts";
import type { MoveResult } from "./organizer.ts";
import {
  buildOrganizedPath,
  cleanEmptyDirs,
  moveFile as realMoveFile,
} from "./organizer.ts";

// --- Audio File Handle (for DI) ---

export type TagHandle = {
  setTitle(v: string): void;
  setArtist(v: string): void;
  setAlbum(v: string): void;
  setYear(v: number): void;
  setGenre(v: string): void;
  setTrack(v: number): void;
};

export type CoverArtInput = {
  data: Uint8Array;
  mimeType: string;
  type: string;
  description: string;
};

export type AudioFileHandle = {
  tag(): TagHandle;
  setProperty(key: string, value: string): void;
  getPictures(): unknown[];
  setPictures(pics: CoverArtInput[]): void;
  saveToFile(): Promise<void>;
  dispose(): void;
};

// --- Pipeline Services (DI) ---

export type PipelineServices = {
  discoverMusic: (
    paths: string[],
    options?: { useMetadataGrouping?: boolean },
  ) => Promise<MusicDiscovery>;
  generateFingerprint: (filePath: string) => Promise<string | null>;
  getAudioDuration: (filePath: string) => Promise<number>;
  lookupFingerprint: (
    fingerprint: string,
    duration: number,
    apiKey: string,
  ) => Promise<LookupResult | null>;
  fetchRecording: (
    recordingId: string,
    rateLimiter: RateLimiter,
  ) => Promise<MBRecordingResponse | null>;
  getComprehensiveMetadata: (filePath: string) => Promise<ComprehensiveMeta>;
  fetchCoverArt: (releaseId: string) => Promise<CoverArtResult>;
  runBatchReview: (
    items: ReviewItem[],
  ) => Promise<Map<string, ReviewDecision>>;
  openAudioFile: (path: string) => Promise<AudioFileHandle | null>;
  moveFile: (
    source: string,
    destination: string,
    dryRun: boolean,
  ) => Promise<MoveResult>;
};

type ComprehensiveMeta = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: number;
  genre?: string;
  track?: number;
  duration?: number;
  bitrate?: number;
} | null;

async function defaultOpenAudioFile(
  path: string,
): Promise<AudioFileHandle | null> {
  const taglib = await ensureTagLib();
  const file = await taglib.open(path);
  if (!file) return null;
  return {
    tag: () => file.tag(),
    setProperty: (key: string, value: string) => file.setProperty(key, value),
    getPictures: () => file.getPictures(),
    setPictures: (pics: CoverArtInput[]) =>
      file.setPictures(
        pics.map((p) => ({
          data: p.data,
          mimeType: p.mimeType,
          type: p.type as "FrontCover",
          description: p.description,
        })),
      ),
    saveToFile: () => file.saveToFile(),
    dispose: () => file.dispose(),
  };
}

function defaultServices(): PipelineServices {
  return {
    discoverMusic: realDiscoverMusic,
    generateFingerprint: realGenerateFingerprint,
    getAudioDuration: realGetAudioDuration,
    lookupFingerprint: realLookupFingerprint,
    fetchRecording: realFetchRecording,
    getComprehensiveMetadata: realGetComprehensiveMetadata,
    fetchCoverArt: realFetchCoverArt,
    runBatchReview: realRunBatchReview,
    openAudioFile: defaultOpenAudioFile,
    moveFile: realMoveFile,
  };
}

// --- Enrichment Diff ---

export type TagSet = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: number | string;
  genre?: string;
  trackNumber?: number | string;
};

export type ExistingTags = TagSet;
export type ProposedTags = TagSet;

export type EnrichmentDiff = {
  field: string;
  current?: string;
  proposed: string;
};

const TAG_FIELDS: (keyof ExistingTags)[] = [
  "title",
  "artist",
  "album",
  "albumArtist",
  "year",
  "genre",
  "trackNumber",
];

const FIELD_LABELS: Record<keyof ExistingTags, string> = {
  title: "Title",
  artist: "Artist",
  album: "Album",
  albumArtist: "AlbumArtist",
  year: "Year",
  genre: "Genre",
  trackNumber: "TrackNumber",
};

export function buildEnrichmentDiff(
  existing: ExistingTags,
  proposed: ProposedTags,
  overwrite: boolean,
): EnrichmentDiff[] {
  const diffs: EnrichmentDiff[] = [];

  for (const field of TAG_FIELDS) {
    const currentVal = existing[field];
    const proposedVal = proposed[field];

    const proposedStr = proposedVal != null ? String(proposedVal) : undefined;
    const currentStr = currentVal != null ? String(currentVal) : undefined;

    // Never overwrite with blank
    if (!proposedStr) continue;

    // Same value — skip
    if (currentStr === proposedStr) continue;

    // Field is empty — always fill
    if (!currentStr) {
      diffs.push({
        field: FIELD_LABELS[field],
        current: undefined,
        proposed: proposedStr,
      });
      continue;
    }

    // Field has value — only overwrite if flag is set
    if (overwrite) {
      diffs.push({
        field: FIELD_LABELS[field],
        current: currentStr,
        proposed: proposedStr,
      });
    }
  }

  return diffs;
}

// --- Pipeline Types ---

export type PipelineOptions = {
  apiKey: string;
  dryRun: boolean;
  overwrite: boolean;
  organize: boolean;
  noArt: boolean;
  quiet: boolean;
  force: boolean;
  libraryRoot: string;
};

export type PipelineFileResult = {
  path: string;
  confidence: ConfidenceCategory;
  score: number;
  matchedRelease?: string;
  enriched: boolean;
  artAdded: boolean;
  organized?: string;
  error?: string;
};

export type PipelineReport = {
  totalFiles: number;
  matched: number;
  enriched: number;
  artAdded: number;
  duplicatesFound: number;
  unresolved: number;
  organized: number;
  conflicts: number;
  files: PipelineFileResult[];
};

const ACOUSTID_RATE_LIMIT_MS = 334; // 3 requests/second

export async function runPipeline(
  options: PipelineOptions,
  services?: Partial<PipelineServices>,
): Promise<PipelineReport> {
  const svc = { ...defaultServices(), ...services };

  const report: PipelineReport = {
    totalFiles: 0,
    matched: 0,
    enriched: 0,
    artAdded: 0,
    duplicatesFound: 0,
    unresolved: 0,
    organized: 0,
    conflicts: 0,
    files: [],
  };

  // Stage 1: Discover
  if (!options.quiet) console.log("\nStage 1: Discovering audio files...");
  const discovery = await svc.discoverMusic([options.libraryRoot], {
    useMetadataGrouping: true,
  });

  const allFiles: string[] = [
    ...(discovery.albumGroups?.flatMap((g) => g.files) ?? []),
    ...discovery.singles,
  ];
  report.totalFiles = allFiles.length;

  if (allFiles.length === 0) {
    if (!options.quiet) console.log("  No audio files found.");
    return report;
  }

  if (!options.quiet) console.log(`  Found ${allFiles.length} audio files.`);

  // Stage 2-3: Fingerprint + Identify
  if (!options.quiet) {
    console.log("\nStage 2-3: Fingerprinting and identifying...");
  }
  const acoustIdRateLimiter = new RateLimiter(ACOUSTID_RATE_LIMIT_MS);

  const fileRecordingMap = new Map<string, string>(); // path -> recordingId
  const fileAcoustIdMap = new Map<string, string>(); // path -> acoustId

  let fingerprintCount = 0;
  for (const filePath of allFiles) {
    fingerprintCount++;
    if (!options.quiet && fingerprintCount % 10 === 0) {
      console.log(`  Processing ${fingerprintCount}/${allFiles.length}...`);
    }
    const fingerprint = await svc.generateFingerprint(filePath);
    if (!fingerprint) {
      if (!options.quiet) {
        console.log(`  Skipped (no fingerprint): ${filePath}`);
      }
      continue;
    }

    const duration = await svc.getAudioDuration(filePath);
    await acoustIdRateLimiter.acquire();
    const lookup = await svc.lookupFingerprint(
      fingerprint,
      duration,
      options.apiKey,
    );
    const mbIds = extractMusicBrainzIds(lookup);

    if (mbIds.trackId) {
      fileRecordingMap.set(filePath, mbIds.trackId);
    }
    if (lookup?.results?.[0]?.id) {
      fileAcoustIdMap.set(filePath, lookup.results[0].id);
    }
  }

  if (!options.quiet) {
    console.log(
      `  Identified ${fileRecordingMap.size}/${allFiles.length} files.`,
    );
  }

  // Stage 4: Match Releases
  if (!options.quiet) console.log("\nStage 4: Matching releases...");
  const mbRateLimiter = new RateLimiter();

  const recordingCache = new Map<string, MBRecordingResponse>();
  const uniqueRecordingIds = new Set(fileRecordingMap.values());
  let recFetchCount = 0;
  for (const recId of uniqueRecordingIds) {
    recFetchCount++;
    if (!options.quiet && recFetchCount % 5 === 0) {
      console.log(
        `  Fetching recording ${recFetchCount}/${uniqueRecordingIds.size}...`,
      );
    }
    const recording = await svc.fetchRecording(recId, mbRateLimiter);
    if (recording) recordingCache.set(recId, recording);
  }

  // Cache metadata to avoid redundant file reads
  const metadataCache = new Map<string, ComprehensiveMeta>();
  async function getCachedMetadata(
    filePath: string,
  ): Promise<ComprehensiveMeta> {
    const cached = metadataCache.get(filePath);
    if (cached !== undefined) return cached;
    const meta = await svc.getComprehensiveMetadata(filePath);
    metadataCache.set(filePath, meta);
    return meta;
  }

  type MatchedGroup = {
    files: string[];
    bestRelease: ScoredRelease;
    albumFiles: AlbumFileInfo[];
  };
  const matchedGroups: MatchedGroup[] = [];
  const unmatchedFiles: string[] = [];

  const albumGroups = discovery.albumGroups ?? [];
  for (const group of albumGroups) {
    const albumFiles: AlbumFileInfo[] = [];
    for (const filePath of group.files) {
      const recordingId = fileRecordingMap.get(filePath);
      if (!recordingId) continue;
      const meta = await getCachedMetadata(filePath);
      albumFiles.push({
        path: filePath,
        recordingId,
        duration: meta?.duration ?? 0,
        trackNumber: meta?.track,
        existingTitle: meta?.title ?? undefined,
        existingArtist: meta?.artist ?? undefined,
        existingAlbum: meta?.album ?? undefined,
        existingAlbumArtist: meta?.albumArtist ?? undefined,
        existingYear: meta?.year ?? undefined,
        existingGenre: meta?.genre ?? undefined,
      });
    }

    if (albumFiles.length === 0) {
      unmatchedFiles.push(...group.files);
      continue;
    }

    const best = selectBestRelease(albumFiles, recordingCache);
    if (best) {
      matchedGroups.push({
        files: group.files,
        bestRelease: best,
        albumFiles,
      });
      report.matched += albumFiles.length;
    } else {
      unmatchedFiles.push(...group.files);
    }
  }

  // Handle singles
  for (const filePath of discovery.singles) {
    const recordingId = fileRecordingMap.get(filePath);
    if (!recordingId) {
      unmatchedFiles.push(filePath);
      continue;
    }
    const meta = await getCachedMetadata(filePath);
    const albumFiles: AlbumFileInfo[] = [{
      path: filePath,
      recordingId,
      duration: meta?.duration ?? 0,
      existingTitle: meta?.title ?? undefined,
      existingArtist: meta?.artist ?? undefined,
    }];
    const best = selectBestRelease(albumFiles, recordingCache, {
      isSingle: true,
    });
    if (best) {
      matchedGroups.push({
        files: [filePath],
        bestRelease: best,
        albumFiles,
      });
      report.matched++;
    } else {
      unmatchedFiles.push(filePath);
    }
  }

  report.unresolved = unmatchedFiles.length;
  if (!options.quiet) {
    console.log(
      `  Matched ${matchedGroups.length} group(s), ${unmatchedFiles.length} unresolved.`,
    );
  }

  // Stage 5-6: Enrich + Cover Art
  if (!options.quiet) {
    console.log("\nStage 5-6: Enriching and fetching cover art...");
  }
  const reviewItems: ReviewItem[] = [];
  const pendingReviewData = new Map<string, {
    diff: EnrichmentDiff[];
    coverArtData: Uint8Array | undefined;
    fileResult: PipelineFileResult;
  }>();

  for (const group of matchedGroups) {
    const release = group.bestRelease.release;
    const confidence = categorizeConfidence(group.bestRelease.score);
    const tracks = (release.media ?? []).flatMap((m) => m.tracks ?? []);
    const trackById = new Map(tracks.map((t) => [t.recording.id, t]));
    // Aggregate genres across all recordings in the group
    const genreCounts = new Map<string, number>();
    for (const f of group.albumFiles) {
      const rec = recordingCache.get(f.recordingId);
      for (const g of rec?.genres ?? []) {
        genreCounts.set(g.name, (genreCounts.get(g.name) ?? 0) + g.count);
      }
    }
    const primaryGenre = genreCounts.size > 0
      ? [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : undefined;
    const releaseArtist = release["artist-credit"]
      ? joinArtistCredits(release["artist-credit"])
      : undefined;
    const releaseYear = release.date
      ? parseInt(release.date.substring(0, 4), 10)
      : undefined;

    // Cover art (once per group/release)
    let coverArtData: Uint8Array | undefined;
    if (!options.noArt && confidence !== "low") {
      const art = await svc.fetchCoverArt(release.id);
      if (art) coverArtData = art.data;
    }

    for (const fileInfo of group.albumFiles) {
      const track = trackById.get(fileInfo.recordingId);
      const proposed: ProposedTags = {
        title: track?.title,
        artist: releaseArtist,
        album: release.title,
        albumArtist: releaseArtist,
        year: releaseYear,
        genre: primaryGenre,
        trackNumber: track?.position,
      };

      const existing: ExistingTags = {
        title: fileInfo.existingTitle,
        artist: fileInfo.existingArtist,
        album: fileInfo.existingAlbum,
        albumArtist: fileInfo.existingAlbumArtist,
        year: fileInfo.existingYear,
        genre: fileInfo.existingGenre,
        trackNumber: fileInfo.trackNumber,
      };

      const diff = buildEnrichmentDiff(existing, proposed, options.overwrite);
      const fileResult: PipelineFileResult = {
        path: fileInfo.path,
        confidence,
        score: group.bestRelease.score,
        matchedRelease: release.title,
        enriched: false,
        artAdded: false,
      };

      // Auto-apply high-confidence matches
      if (confidence === "high" && diff.length > 0 && !options.dryRun) {
        const audioFile = await svc.openAudioFile(fileInfo.path);
        if (audioFile) {
          try {
            for (const d of diff) {
              applyTagDiff(audioFile, d);
            }
            if (coverArtData && audioFile.getPictures().length === 0) {
              audioFile.setPictures([{
                data: coverArtData,
                mimeType: "image/jpeg",
                type: "FrontCover",
                description: "",
              }]);
              fileResult.artAdded = true;
              report.artAdded++;
            }
            await audioFile.saveToFile();
            fileResult.enriched = true;
            report.enriched++;
          } finally {
            audioFile.dispose();
          }
        }
      }

      // Queue medium-confidence matches for review
      if (confidence === "medium" && diff.length > 0) {
        reviewItems.push({
          sourcePath: fileInfo.path,
          proposedTitle: track?.title,
          proposedArtist: releaseArtist,
          proposedAlbum: release.title,
          proposedYear: releaseYear,
          confidence: group.bestRelease.score,
          confidenceReason: buildConfidenceReason(
            group.bestRelease,
            group.albumFiles,
          ),
          diffs: diff.map((d) => ({
            field: d.field,
            current: d.current,
            proposed: d.proposed,
          })),
        });
        pendingReviewData.set(fileInfo.path, {
          diff,
          coverArtData,
          fileResult,
        });
      }

      report.files.push(fileResult);
    }
  }

  // Stage 7: Review (medium-confidence items)
  if (reviewItems.length > 0) {
    if (!options.quiet) {
      console.log(
        `\nStage 7: ${reviewItems.length} item(s) need review...`,
      );
    }
    const decisions = await svc.runBatchReview(reviewItems);

    for (const [path, decision] of decisions) {
      if (decision !== "accept") continue;
      const pending = pendingReviewData.get(path);
      if (!pending || options.dryRun) continue;

      const audioFile = await svc.openAudioFile(path);
      if (audioFile) {
        try {
          for (const d of pending.diff) {
            applyTagDiff(audioFile, d);
          }
          if (pending.coverArtData && audioFile.getPictures().length === 0) {
            audioFile.setPictures([{
              data: pending.coverArtData,
              mimeType: "image/jpeg",
              type: "FrontCover",
              description: "",
            }]);
            pending.fileResult.artAdded = true;
            report.artAdded++;
          }
          await audioFile.saveToFile();
          pending.fileResult.enriched = true;
          report.enriched++;
        } finally {
          audioFile.dispose();
        }
      }
    }
  }

  // Stage 8: Duplicate Detection
  if (!options.quiet) console.log("\nStage 8: Checking for duplicates...");

  const qualityInfos: FileQualityInfo[] = [];
  for (const fileResult of report.files) {
    const meta = await getCachedMetadata(fileResult.path);
    qualityInfos.push({
      path: fileResult.path,
      acoustIdId: fileAcoustIdMap.get(fileResult.path),
      recordingId: fileRecordingMap.get(fileResult.path),
      format: extname(fileResult.path).slice(1).toLowerCase(),
      bitrate: meta?.bitrate ?? 0,
      tagCount: Object.values(meta ?? {}).filter(Boolean).length,
      title: meta?.title,
      artist: meta?.artist,
    });
  }

  const duplicateGroups = detectDuplicates(qualityInfos);
  report.duplicatesFound = duplicateGroups.length;

  if (duplicateGroups.length > 0 && !options.quiet) {
    console.log(`\nDuplicates found:`);
    for (const group of duplicateGroups) {
      const title = group.title ?? "Unknown";
      const artist = group.artist ?? "Unknown";
      console.log(`  "${title}" by ${artist}`);
      console.log(
        `    KEEP:  ${group.files[0].path} (${
          group.files[0].format.toUpperCase()
        }, ${group.files[0].bitrate}kbps)`,
      );
      for (let i = 1; i < group.files.length; i++) {
        console.log(
          `    EXTRA: ${group.files[i].path} (${
            group.files[i].format.toUpperCase()
          }, ${group.files[i].bitrate}kbps)`,
        );
      }
    }
  }

  // Stage 9: Organize (optional)
  if (options.organize) {
    if (!options.quiet) console.log("\nStage 9: Organizing files...");

    for (const group of matchedGroups) {
      const release = group.bestRelease.release;
      const tracks = (release.media ?? []).flatMap((m) => m.tracks ?? []);
      const trackById = new Map(tracks.map((t) => [t.recording.id, t]));
      const releaseArtist = release["artist-credit"]
        ? joinArtistCredits(release["artist-credit"])
        : "Unknown Artist";
      const releaseYear = release.date
        ? parseInt(release.date.substring(0, 4), 10)
        : undefined;
      const isCompilation = group.albumFiles.length > 2 &&
        new Set(group.albumFiles.map((f) => f.existingArtist)).size >= 3;

      for (const fileInfo of group.albumFiles) {
        const track = trackById.get(fileInfo.recordingId);
        const destination = buildOrganizedPath({
          libraryRoot: options.libraryRoot,
          artist: isCompilation ? "Various Artists" : releaseArtist,
          album: release.title,
          year: releaseYear,
          trackNumber: track?.position,
          title: track?.title ?? fileInfo.existingTitle ?? "Unknown",
          extension: extname(fileInfo.path),
          isCompilation,
          totalTracks: tracks.length,
        });

        if (destination === fileInfo.path) continue;

        const result = await svc.moveFile(
          fileInfo.path,
          destination,
          options.dryRun,
        );
        if (result.status === "moved") {
          report.organized++;
          if (!options.quiet) {
            console.log(`  ${fileInfo.path} -> ${destination}`);
          }
          await cleanEmptyDirs(dirname(fileInfo.path));
        } else if (result.status === "conflict") {
          report.conflicts++;
          if (!options.quiet) {
            console.log(`  CONFLICT: ${destination} already exists`);
          }
        } else if (result.status === "dry-run" && !options.quiet) {
          console.log(`  [dry-run] ${fileInfo.path} -> ${destination}`);
        }
      }
    }
  }

  return report;
}

function buildConfidenceReason(
  scored: ScoredRelease,
  files: AlbumFileInfo[],
): string {
  const release = scored.release;
  const trackCount = (release.media ?? []).reduce(
    (sum, m) => sum + m.track_count,
    0,
  );
  if (files.length !== trackCount) {
    return `fingerprint matched but track count mismatch (${files.length} files, ${trackCount}-track release)`;
  }
  if (scored.matchedRecordings < files.length) {
    return `${scored.matchedRecordings}/${files.length} tracks matched`;
  }
  return "fingerprint matched, limited tag corroboration";
}

function applyTagDiff(audioFile: AudioFileHandle, diff: EnrichmentDiff): void {
  const tag = audioFile.tag();
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
    case "AlbumArtist":
      audioFile.setProperty("ALBUMARTIST", diff.proposed);
      break;
    case "Year":
      tag.setYear(parseInt(diff.proposed, 10));
      break;
    case "Genre":
      tag.setGenre(diff.proposed);
      break;
    case "TrackNumber":
      tag.setTrack(parseInt(diff.proposed, 10));
      break;
  }
}
