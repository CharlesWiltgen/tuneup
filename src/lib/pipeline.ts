// src/lib/pipeline.ts

import type { ConfidenceCategory } from "./confidence.ts";

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
