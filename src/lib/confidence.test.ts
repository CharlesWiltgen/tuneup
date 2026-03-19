// src/lib/confidence.test.ts
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  categorizeConfidence,
  type ConfidenceCategory as _ConfidenceCategory,
} from "./confidence.ts";

describe("categorizeConfidence", () => {
  it("should return 'high' for scores >= 0.9", () => {
    assertEquals(categorizeConfidence(0.9), "high");
    assertEquals(categorizeConfidence(0.95), "high");
    assertEquals(categorizeConfidence(1.0), "high");
  });

  it("should return 'medium' for scores 0.5–0.89", () => {
    assertEquals(categorizeConfidence(0.5), "medium");
    assertEquals(categorizeConfidence(0.72), "medium");
    assertEquals(categorizeConfidence(0.89), "medium");
  });

  it("should return 'low' for scores < 0.5", () => {
    assertEquals(categorizeConfidence(0.0), "low");
    assertEquals(categorizeConfidence(0.49), "low");
    assertEquals(categorizeConfidence(0.3), "low");
  });
});
