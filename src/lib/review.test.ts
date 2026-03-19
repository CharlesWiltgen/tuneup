import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { formatDiffLine, formatReviewItem, type ReviewItem } from "./review.ts";

describe("formatDiffLine", () => {
  it("should format empty-to-value as fill", () => {
    assertEquals(
      formatDiffLine("Title", undefined, "Karma Police"),
      '  Title:   (empty) -> "Karma Police"',
    );
  });

  it("should show kept values", () => {
    assertEquals(
      formatDiffLine("Artist", "Radiohead", "Radiohead"),
      '  Artist:  "Radiohead" (kept)',
    );
  });

  it("should show changed values", () => {
    assertEquals(
      formatDiffLine("Year", "1996", "1997"),
      '  Year:    "1996" -> "1997"',
    );
  });
});

describe("formatReviewItem", () => {
  it("should include filename, proposed match, and confidence", () => {
    const item: ReviewItem = {
      sourcePath: "/music/track03.mp3",
      proposedTitle: "Karma Police",
      proposedArtist: "Radiohead",
      proposedAlbum: "OK Computer",
      proposedYear: 1997,
      confidence: 0.72,
      confidenceReason: "fingerprint matched but track count mismatch",
    };
    const formatted = formatReviewItem(item, 1);
    assertEquals(formatted.includes("track03.mp3"), true);
    assertEquals(formatted.includes("Karma Police"), true);
    assertEquals(formatted.includes("72%"), true);
  });
});
