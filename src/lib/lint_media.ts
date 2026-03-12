import type { LintIssue } from "./lint.ts";

const EXTENSION_TO_FORMATS: Record<string, string[]> = {
  ".mp3": ["mp3"],
  ".flac": ["flac"],
  ".ogg": ["ogg"],
  ".m4a": ["m4a"],
  ".mp4": ["m4a"],
  ".wav": ["wav"],
  ".aac": ["mp3", "m4a"],
  ".opus": ["ogg"],
  ".wma": [],
  ".alac": ["m4a"],
};

export function detectFormatFromHeader(buf: Uint8Array): string | null {
  if (buf.length < 12) return null;
  // MP3: ID3 tag header
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return "mp3";
  // MP3: MPEG audio frame sync (top 11 bits set = 0xFFE0 mask)
  if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return "mp3";
  // FLAC: "fLaC"
  if (
    buf[0] === 0x66 && buf[1] === 0x4C && buf[2] === 0x61 && buf[3] === 0x43
  ) return "flac";
  // OGG: "OggS"
  if (
    buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53
  ) return "ogg";
  // M4A/MP4: "ftyp" at offset 4
  if (
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70
  ) return "m4a";
  // WAV: "RIFF"
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
  ) return "wav";
  return null;
}

export function validateFileHeader(
  filePath: string,
  ext: string,
  headerBytes: Uint8Array,
): LintIssue[] {
  const detectedFormat = detectFormatFromHeader(headerBytes);
  if (!detectedFormat) {
    return [{
      type: "issue",
      rule: "invalid-header",
      severity: "error",
      file: filePath,
      message: "File header does not match any known audio format",
    }];
  }
  const extLower = ext.toLowerCase();
  const expectedFormats = EXTENSION_TO_FORMATS[extLower] ?? [];
  if (expectedFormats.length > 0 && !expectedFormats.includes(detectedFormat)) {
    return [{
      type: "issue",
      rule: "extension-mismatch",
      severity: "warning",
      file: filePath,
      message:
        `File header indicates ${detectedFormat} but extension is ${extLower}`,
    }];
  }
  return [];
}

export async function readFileHeader(filePath: string): Promise<Uint8Array> {
  const file = await Deno.open(filePath, { read: true });
  try {
    const buf = new Uint8Array(12);
    const bytesRead = await file.read(buf);
    if (bytesRead === null || bytesRead < 12) {
      return buf.subarray(0, bytesRead ?? 0);
    }
    return buf;
  } finally {
    file.close();
  }
}
