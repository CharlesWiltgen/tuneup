export interface AudioMetadata {
  // Basic tags
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string;
  comment?: string;
  track?: number;

  // Extended tags
  albumArtist?: string;
  composer?: string;
  acoustIdFingerprint?: string;
  acoustIdId?: string;
  musicBrainzTrackId?: string;

  // Audio properties
  audioProperties?: {
    duration?: number;
    bitrate?: number;
    sampleRate?: number;
    channels?: number;
    format?: string;
  };
}

export interface BatchMetadataResult {
  entries(): IterableIterator<[string, AudioMetadata | null]>;
  get(filePath: string): AudioMetadata | null;
  has(filePath: string): boolean;
  size: number;
}
