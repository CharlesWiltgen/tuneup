import { basename, extname } from "@std/path";

export interface ParsedFilename {
  track?: number;
  artist?: string;
  title?: string;
}

interface Pattern {
  regex: RegExp;
  extract: (match: RegExpMatchArray) => ParsedFilename;
}

const PATTERNS: Pattern[] = [
  {
    // ## - Artist - Title
    regex: /^(\d{1,3})\s*-\s*(.+?)\s*-\s*(.+)$/,
    extract: (m) => ({
      track: parseInt(m[1]),
      artist: m[2].trim(),
      title: m[3].trim(),
    }),
  },
  {
    // Artist - Title
    regex: /^(.+?)\s*-\s*(.+)$/,
    extract: (m) => ({ artist: m[1].trim(), title: m[2].trim() }),
  },
  {
    // ## Title (space separator)
    regex: /^(\d{1,3})\s+(?!-\s)(.+)$/,
    extract: (m) => ({ track: parseInt(m[1]), title: m[2].trim() }),
  },
  {
    // ##. Title (dot separator)
    regex: /^(\d{1,3})\.\s*(.+)$/,
    extract: (m) => ({ track: parseInt(m[1]), title: m[2].trim() }),
  },
  {
    // Track number only
    regex: /^(\d{1,3})$/,
    extract: (m) => ({ track: parseInt(m[1]) }),
  },
];

export function parseFilenames(filenames: string[]): ParsedFilename[] {
  if (filenames.length === 0) return [];

  const stems = filenames.map((f) => {
    const base = basename(f);
    const ext = extname(base);
    return ext ? base.slice(0, -ext.length) : base;
  });

  // Try each pattern — require all files to match for batch consistency
  for (const pattern of PATTERNS) {
    const matches = stems.map((s) => s.match(pattern.regex));
    if (matches.every((m) => m !== null)) {
      return matches.map((m) => pattern.extract(m!));
    }
  }

  // Fallback: entire stem as title
  return stems.map((s) => ({ title: s }));
}
