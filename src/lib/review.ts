import { basename } from "@std/path";

export type ReviewItem = {
  sourcePath: string;
  proposedTitle?: string;
  proposedArtist?: string;
  proposedAlbum?: string;
  proposedYear?: number;
  confidence: number;
  confidenceReason: string;
  diffs?: TagDiff[];
};

export type TagDiff = {
  field: string;
  current?: string;
  proposed?: string;
};

export type ReviewDecision = "accept" | "skip";

const FIELD_PAD = 9;

export function formatDiffLine(
  field: string,
  current: string | undefined,
  proposed: string | undefined,
): string {
  const paddedField = `${field}:`.padEnd(FIELD_PAD);
  if (!current && proposed) {
    return `  ${paddedField}(empty) -> "${proposed}"`;
  }
  if (current === proposed) {
    return `  ${paddedField}"${current}" (kept)`;
  }
  return `  ${paddedField}"${current}" -> "${proposed}"`;
}

export function formatReviewItem(item: ReviewItem, index: number): string {
  const filename = basename(item.sourcePath);
  const confidence = Math.round(item.confidence * 100);
  const match = item.proposedAlbum
    ? `"${item.proposedTitle}" by ${item.proposedArtist} (${item.proposedAlbum}, ${
      item.proposedYear ?? "?"
    })`
    : `"${item.proposedTitle}" by ${item.proposedArtist}`;

  return [
    `${index}. "${filename}" -> ${match}`,
    `   Confidence: ${confidence}% — ${item.confidenceReason}`,
    `   [y] Accept  [n] Skip  [d] Show diff`,
  ].join("\n");
}

export function formatDiff(item: ReviewItem): string {
  if (!item.diffs || item.diffs.length === 0) return "  (no changes)";
  return item.diffs
    .map((d) => formatDiffLine(d.field, d.current, d.proposed))
    .join("\n");
}

export async function runBatchReview(
  items: ReviewItem[],
  promptFn: (message: string) => Promise<string> = defaultPrompt,
): Promise<Map<string, ReviewDecision>> {
  const decisions = new Map<string, ReviewDecision>();

  if (items.length === 0) return decisions;

  console.log(`\n${items.length} item(s) need your review:\n`);

  for (let i = 0; i < items.length; i++) {
    console.log(formatReviewItem(items[i], i + 1));
    const answer = await promptFn("\nYour choice (y/n/d): ");

    if (answer.toLowerCase() === "d") {
      console.log(formatDiff(items[i]));
      const confirmAnswer = await promptFn("Accept? (y/n): ");
      decisions.set(
        items[i].sourcePath,
        confirmAnswer.toLowerCase() === "y" ? "accept" : "skip",
      );
    } else {
      decisions.set(
        items[i].sourcePath,
        answer.toLowerCase() === "y" ? "accept" : "skip",
      );
    }
    console.log();
  }

  return decisions;
}

async function defaultPrompt(message: string): Promise<string> {
  const buf = new Uint8Array(64);
  await Deno.stdout.write(new TextEncoder().encode(message));
  const n = await Deno.stdin.read(buf);
  return new TextDecoder().decode(buf.subarray(0, n ?? 0)).trim();
}
