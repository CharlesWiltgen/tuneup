// src/lib/pipeline.ts

import type { ConfidenceCategory } from "./confidence.ts";
import { discoverMusic } from "../utils/fast_discovery.ts";
import {
  extractMusicBrainzIds,
  generateFingerprint,
  lookupFingerprint,
} from "./acoustid.ts";
import { getAudioDuration } from "./tagging.ts";
import { RateLimiter } from "./musicbrainz.ts";

// --- Enrichment Diff ---

export type ExistingTags = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: number | string;
  genre?: string;
  trackNumber?: number | string;
};

export type ProposedTags = {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  year?: number | string;
  genre?: string;
  trackNumber?: number | string;
};

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
): Promise<PipelineReport> {
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
  const discovery = await discoverMusic([options.libraryRoot], {
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

  for (const filePath of allFiles) {
    const fingerprint = await generateFingerprint(filePath);
    if (!fingerprint) {
      if (!options.quiet) {
        console.log(`  Skipped (no fingerprint): ${filePath}`);
      }
      continue;
    }

    const duration = await getAudioDuration(filePath);
    await acoustIdRateLimiter.acquire();
    const lookup = await lookupFingerprint(
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

  // Stages 4+ will be added in Task 10
  return report;
}
