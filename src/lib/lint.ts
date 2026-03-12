export type Severity = "error" | "warning" | "info";

export type LintIssue = {
  type: "issue";
  rule: string;
  severity: Severity;
  message: string;
  file?: string;
  album?: string;
};

export type LintSummary = {
  type: "summary";
  errors: number;
  warnings: number;
  info: number;
  filesOk: number;
  filesWithIssues: number;
  albumIssues: number;
};

export type FileMetadataForLint = {
  path: string;
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  track?: number;
  genre?: string;
  hasCoverArt: boolean;
  hasReplayGain: boolean;
  hasAcoustId: boolean;
  duration: number;
  bitrate: number;
  sampleRate: number;
  channels: number;
  codec: string;
  containerFormat: string;
  isLossy: boolean;
};

export type AlbumIndexEntry = {
  albumArtists: Set<string>;
  years: Set<number>;
  trackNumbers: Map<number, string[]>;
  discNumbers: Set<number>;
  formats: Set<string>;
  sampleRates: Set<number>;
  directories: Set<string>;
  fileCount: number;
  files: string[];
};

export type AlbumIndex = Map<string, AlbumIndexEntry>;

export const SEVERITY_ORDER: Record<Severity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

type FileMetadataRule = {
  name: string;
  check: (file: FileMetadataForLint) => LintIssue | null;
};

type AlbumRule = {
  name: string;
  check: (albumName: string, entry: AlbumIndexEntry) => LintIssue[];
};

export const FILE_METADATA_RULES: FileMetadataRule[] = [
  {
    name: "missing-title",
    check: (file) =>
      file.title === undefined
        ? {
          type: "issue",
          rule: "missing-title",
          severity: "error",
          file: file.path,
          message: "Missing title tag",
        }
        : null,
  },
  {
    name: "missing-artist",
    check: (file) =>
      file.artist === undefined
        ? {
          type: "issue",
          rule: "missing-artist",
          severity: "error",
          file: file.path,
          message: "Missing artist tag",
        }
        : null,
  },
  {
    name: "missing-album",
    check: (file) =>
      file.album === undefined
        ? {
          type: "issue",
          rule: "missing-album",
          severity: "warning",
          file: file.path,
          message: "Missing album tag",
        }
        : null,
  },
  {
    name: "missing-year",
    check: (file) =>
      file.year === undefined
        ? {
          type: "issue",
          rule: "missing-year",
          severity: "warning",
          file: file.path,
          message: "Missing year tag",
        }
        : null,
  },
  {
    name: "missing-track-number",
    check: (file) =>
      file.track === undefined
        ? {
          type: "issue",
          rule: "missing-track-number",
          severity: "warning",
          file: file.path,
          message: "Missing track number tag",
        }
        : null,
  },
  {
    name: "missing-genre",
    check: (file) =>
      file.genre === undefined
        ? {
          type: "issue",
          rule: "missing-genre",
          severity: "info",
          file: file.path,
          message: "Missing genre tag",
        }
        : null,
  },
  {
    name: "missing-cover-art",
    check: (file) =>
      !file.hasCoverArt
        ? {
          type: "issue",
          rule: "missing-cover-art",
          severity: "info",
          file: file.path,
          message: "Missing cover art",
        }
        : null,
  },
  {
    name: "missing-replaygain",
    check: (file) =>
      !file.hasReplayGain
        ? {
          type: "issue",
          rule: "missing-replaygain",
          severity: "info",
          file: file.path,
          message: "Missing ReplayGain tags",
        }
        : null,
  },
  {
    name: "missing-acoustid",
    check: (file) =>
      !file.hasAcoustId
        ? {
          type: "issue",
          rule: "missing-acoustid",
          severity: "info",
          file: file.path,
          message: "Missing AcoustID tags",
        }
        : null,
  },
  {
    name: "suspicious-duration",
    check: (file) => {
      const SUSPICIOUS_SHORT_SECONDS = 5;
      const SUSPICIOUS_LONG_SECONDS = 2700;
      if (file.duration < SUSPICIOUS_SHORT_SECONDS) {
        return {
          type: "issue",
          rule: "suspicious-duration",
          severity: "warning",
          file: file.path,
          message: `Suspicious duration: ${file.duration.toFixed(1)}s`,
        };
      }
      if (file.duration > SUSPICIOUS_LONG_SECONDS) {
        const minutes = Math.floor(file.duration / 60);
        return {
          type: "issue",
          rule: "suspicious-duration",
          severity: "warning",
          file: file.path,
          message: `Suspicious duration: ${minutes}min`,
        };
      }
      return null;
    },
  },
  {
    name: "suspicious-bitrate",
    check: (file) => {
      const SUSPICIOUS_LOW_BITRATE = 64;
      if (file.isLossy && file.bitrate < SUSPICIOUS_LOW_BITRATE) {
        return {
          type: "issue",
          rule: "suspicious-bitrate",
          severity: "warning",
          file: file.path,
          message: `Suspicious low bitrate: ${file.bitrate}kbps`,
        };
      }
      return null;
    },
  },
];

export const ALBUM_RULES: AlbumRule[] = [
  {
    name: "inconsistent-artist",
    check: (albumName, entry) => {
      if (entry.albumArtists.size > 1) {
        const artists = [...entry.albumArtists].join(", ");
        return [
          {
            type: "issue",
            rule: "inconsistent-artist",
            severity: "warning",
            album: albumName,
            message: `Inconsistent album artists: ${artists}`,
          },
        ];
      }
      return [];
    },
  },
  {
    name: "inconsistent-year",
    check: (albumName, entry) => {
      if (entry.years.size > 1) {
        const years = [...entry.years].sort((a, b) => a - b).join(", ");
        return [
          {
            type: "issue",
            rule: "inconsistent-year",
            severity: "warning",
            album: albumName,
            message: `Inconsistent years: ${years}`,
          },
        ];
      }
      return [];
    },
  },
  {
    name: "track-number-gaps",
    check: (albumName, entry) => {
      const issues: LintIssue[] = [];
      const isMultiDisc = entry.discNumbers.size > 1;

      for (const [disc, tracks] of entry.trackNumbers) {
        const nums = tracks
          .map((t) => parseInt(t, 10))
          .filter((n) => !isNaN(n))
          .sort((a, b) => a - b);

        if (nums.length < 2) continue;

        const numSet = new Set(nums);
        const gaps: number[] = [];
        for (let i = nums[0]; i <= nums[nums.length - 1]; i++) {
          if (!numSet.has(i)) {
            gaps.push(i);
          }
        }

        if (gaps.length > 0) {
          const discLabel = isMultiDisc ? ` disc ${disc}` : "";
          issues.push({
            type: "issue",
            rule: "track-number-gaps",
            severity: "warning",
            album: albumName,
            message: `Missing track numbers on${discLabel}: ${gaps.join(", ")}`,
          });
        }
      }

      return issues;
    },
  },
  {
    name: "duplicate-track-number",
    check: (albumName, entry) => {
      const issues: LintIssue[] = [];
      const isMultiDisc = entry.discNumbers.size > 1;

      for (const [disc, tracks] of entry.trackNumbers) {
        const seen = new Set<string>();
        const duplicates = new Set<string>();
        for (const t of tracks) {
          if (seen.has(t)) {
            duplicates.add(t);
          }
          seen.add(t);
        }

        if (duplicates.size > 0) {
          const discLabel = isMultiDisc ? ` on disc ${disc}` : "";
          issues.push({
            type: "issue",
            rule: "duplicate-track-number",
            severity: "error",
            album: albumName,
            message: `Duplicate track numbers${discLabel}: ${
              [...duplicates].join(", ")
            }`,
          });
        }
      }

      return issues;
    },
  },
  {
    name: "missing-disc-number",
    check: (albumName, entry) => {
      if (entry.discNumbers.size > 0) return [];

      const tracks = entry.trackNumbers.get(0) ?? [];
      const nums = tracks.map((t) => parseInt(t, 10)).filter((n) => !isNaN(n));
      const hasDuplicates = new Set(nums).size < nums.length;

      if (hasDuplicates) {
        return [
          {
            type: "issue",
            rule: "missing-disc-number",
            severity: "warning",
            album: albumName,
            message: "Duplicate track numbers found but no disc numbers set",
          },
        ];
      }

      return [];
    },
  },
  {
    name: "mixed-formats",
    check: (albumName, entry) => {
      if (entry.formats.size > 1) {
        const formats = [...entry.formats].join(", ");
        return [
          {
            type: "issue",
            rule: "mixed-formats",
            severity: "info",
            album: albumName,
            message: `Mixed audio formats: ${formats}`,
          },
        ];
      }
      return [];
    },
  },
  {
    name: "mixed-sample-rates",
    check: (albumName, entry) => {
      if (entry.sampleRates.size > 1) {
        const rates = [...entry.sampleRates]
          .sort((a, b) => a - b)
          .map((r) => `${r}Hz`)
          .join(", ");
        return [
          {
            type: "issue",
            rule: "mixed-sample-rates",
            severity: "info",
            album: albumName,
            message: `Mixed sample rates: ${rates}`,
          },
        ];
      }
      return [];
    },
  },
];

export function runFileMetadataRules(file: FileMetadataForLint): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const rule of FILE_METADATA_RULES) {
    const issue = rule.check(file);
    if (issue !== null) {
      issues.push(issue);
    }
  }
  return issues;
}

export function runAlbumRules(albumIndex: AlbumIndex): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const [albumName, entry] of albumIndex) {
    for (const rule of ALBUM_RULES) {
      issues.push(...rule.check(albumName, entry));
    }
  }
  return issues;
}

export function createLintSummary(
  issues: LintIssue[],
  totalFiles: number,
): LintSummary {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  let albumIssues = 0;
  const filesWithIssues = new Set<string>();

  for (const issue of issues) {
    if (issue.severity === "error") errors++;
    else if (issue.severity === "warning") warnings++;
    else info++;

    if (issue.file) {
      filesWithIssues.add(issue.file);
    } else {
      albumIssues++;
    }
  }

  return {
    type: "summary",
    errors,
    warnings,
    info,
    filesOk: totalFiles - filesWithIssues.size,
    filesWithIssues: filesWithIssues.size,
    albumIssues,
  };
}
