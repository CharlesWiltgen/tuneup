export type FileQualityInfo = {
  path: string;
  acoustIdId?: string;
  recordingId?: string;
  format: string;
  bitrate: number;
  tagCount: number;
  title?: string;
  artist?: string;
};

export type DuplicateGroup = {
  recordingId: string;
  title?: string;
  artist?: string;
  files: FileQualityInfo[];
};

const FORMAT_RANK: Record<string, number> = {
  flac: 4,
  wav: 3,
  m4a: 2,
  aac: 2,
  mp3: 1,
  ogg: 1,
  opus: 1,
};

export function detectDuplicates(files: FileQualityInfo[]): DuplicateGroup[] {
  const byId = new Map<string, FileQualityInfo[]>();

  for (const file of files) {
    // Prefer recordingId for grouping, fall back to acoustIdId
    const key = file.recordingId ?? file.acoustIdId;
    if (!key) continue;
    const group = byId.get(key) ?? [];
    group.push(file);
    byId.set(key, group);
  }

  const groups: DuplicateGroup[] = [];
  for (const [recordingId, groupFiles] of byId) {
    if (groupFiles.length < 2) continue;
    const ranked = rankDuplicates(groupFiles);
    groups.push({
      recordingId,
      title: ranked[0].title,
      artist: ranked[0].artist,
      files: ranked,
    });
  }

  return groups;
}

export function rankDuplicates(files: FileQualityInfo[]): FileQualityInfo[] {
  return [...files].sort((a, b) => {
    const formatA = FORMAT_RANK[a.format.toLowerCase()] ?? 0;
    const formatB = FORMAT_RANK[b.format.toLowerCase()] ?? 0;
    if (formatA !== formatB) return formatB - formatA;
    if (a.bitrate !== b.bitrate) return b.bitrate - a.bitrate;
    return b.tagCount - a.tagCount;
  });
}
