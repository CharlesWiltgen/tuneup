// src/lib/confidence.ts
export type ConfidenceCategory = "high" | "medium" | "low";

const HIGH_THRESHOLD = 0.9;
const MEDIUM_THRESHOLD = 0.5;

export function categorizeConfidence(score: number): ConfidenceCategory {
  if (score >= HIGH_THRESHOLD) return "high";
  if (score >= MEDIUM_THRESHOLD) return "medium";
  return "low";
}
