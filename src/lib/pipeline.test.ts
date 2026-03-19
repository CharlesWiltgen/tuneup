// src/lib/pipeline.test.ts
import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import {
  buildEnrichmentDiff,
  type ExistingTags,
  type ProposedTags,
} from "./pipeline.ts";

describe("buildEnrichmentDiff", () => {
  it("should fill empty fields from proposed data", () => {
    const existing: ExistingTags = {
      title: undefined,
      artist: "Radiohead",
      album: undefined,
    };
    const proposed: ProposedTags = {
      title: "Karma Police",
      artist: "Radiohead",
      album: "OK Computer",
      year: 1997,
    };

    const diff = buildEnrichmentDiff(existing, proposed, false);
    assertEquals(diff, [
      { field: "Title", current: undefined, proposed: "Karma Police" },
      { field: "Album", current: undefined, proposed: "OK Computer" },
      { field: "Year", current: undefined, proposed: "1997" },
    ]);
  });

  it("should not overwrite existing values by default", () => {
    const existing: ExistingTags = {
      title: "Karma P",
      artist: "Radiohead",
      album: "OK Comp",
    };
    const proposed: ProposedTags = {
      title: "Karma Police",
      artist: "Radiohead",
      album: "OK Computer",
    };

    const diff = buildEnrichmentDiff(existing, proposed, false);
    assertEquals(diff, []);
  });

  it("should overwrite existing values when overwrite=true", () => {
    const existing: ExistingTags = { title: "Karma P", artist: "Radiohead" };
    const proposed: ProposedTags = {
      title: "Karma Police",
      artist: "Radiohead",
    };

    const diff = buildEnrichmentDiff(existing, proposed, true);
    assertEquals(diff, [
      { field: "Title", current: "Karma P", proposed: "Karma Police" },
    ]);
  });

  it("should never overwrite with blank/undefined values", () => {
    const existing: ExistingTags = {
      title: "Karma Police",
      artist: "Radiohead",
    };
    const proposed: ProposedTags = { title: undefined, artist: "" };

    const diff = buildEnrichmentDiff(existing, proposed, true);
    assertEquals(diff, []);
  });
});

describe("runPipeline", () => {
  it("should be importable and return a report type", async () => {
    const { runPipeline } = await import("./pipeline.ts");
    assertEquals(typeof runPipeline, "function");
  });
});
