export type SummaryLine =
  | { label: string; key: string }
  | { label: string; key: string; subKeys: { label: string; key: string }[] };

export interface SummaryConfig {
  lines: SummaryLine[];
}

export class OperationStats {
  private counts = new Map<string, number>();
  private subCounts = new Map<string, Map<string, number>>();

  increment(key: string, amount = 1): void {
    this.counts.set(key, (this.counts.get(key) ?? 0) + amount);
  }

  incrementSub(key: string, subKey: string, amount = 1): void {
    let sub = this.subCounts.get(key);
    if (!sub) {
      sub = new Map<string, number>();
      this.subCounts.set(key, sub);
    }
    sub.set(subKey, (sub.get(subKey) ?? 0) + amount);
  }

  get(key: string): number {
    return this.counts.get(key) ?? 0;
  }

  getSub(key: string, subKey: string): number {
    return this.subCounts.get(key)?.get(subKey) ?? 0;
  }

  getSubTotal(key: string): number {
    const sub = this.subCounts.get(key);
    if (!sub) return 0;
    let total = 0;
    for (const v of sub.values()) total += v;
    return total;
  }

  incrementSuccess(): void {
    this.increment("processed");
  }

  incrementFailed(): void {
    this.increment("failed");
  }

  incrementSkipped(reason?: string): void {
    if (reason) {
      this.incrementSub("skipped", reason);
    } else {
      this.increment("skipped");
    }
  }

  printSummary(title: string, config: SummaryConfig, isDryRun = false): void {
    console.log(`\n--- ${title} ---`);

    for (const line of config.lines) {
      if ("subKeys" in line) {
        const total = this.getSubTotal(line.key);
        console.log(`${line.label}: ${total}`);
        if (total > 0) {
          for (const sub of line.subKeys) {
            const subVal = this.getSub(line.key, sub.key);
            if (subVal > 0) {
              console.log(`  ${sub.label}: ${subVal}`);
            }
          }
        }
      } else {
        console.log(`${line.label}: ${this.get(line.key)}`);
      }
    }

    if (isDryRun) {
      console.log("\nNOTE: This was a dry run. No files were modified.");
    }
  }
}

export const PROCESSING_SUMMARY: SummaryConfig = {
  lines: [
    { label: "Successfully processed", key: "processed" },
    {
      label: "Skipped (already tagged/force not used)",
      key: "skipped",
    },
    { label: "No AcoustID results found", key: "no_results" },
    {
      label: "AcoustID lookup failed (API/network issues)",
      key: "lookup_failed",
    },
    {
      label: "Other failures (e.g., file access, fpcalc)",
      key: "failed",
    },
  ],
};

export const ENCODING_SUMMARY: SummaryConfig = {
  lines: [
    { label: "Successfully encoded", key: "processed" },
    {
      label: "Files skipped",
      key: "skipped",
      subKeys: [
        { label: "Already M4A format", key: "already_m4a" },
        {
          label: "Lossy format (use --force-lossy-transcodes)",
          key: "lossy_format",
        },
        { label: "Output already exists", key: "output_exists" },
      ],
    },
    { label: "Failed", key: "failed" },
  ],
};

export const EASY_MODE_SUMMARY: SummaryConfig = {
  lines: [
    { label: "Files processed", key: "processed" },
    { label: "Skipped (already tagged)", key: "skipped" },
    { label: "No AcoustID results found", key: "no_results" },
    { label: "AcoustID lookup failed", key: "lookup_failed" },
    { label: "Other failures", key: "failed" },
  ],
};
