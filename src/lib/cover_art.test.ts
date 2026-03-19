import { describe, it } from "@std/testing/bdd";
import { assertEquals } from "@std/assert";
import { buildCoverArtUrl } from "./cover_art.ts";

describe("buildCoverArtUrl", () => {
  it("should build correct URL for a release ID", () => {
    const url = buildCoverArtUrl("abc-123");
    assertEquals(url, "https://coverartarchive.org/release/abc-123/front");
  });

  it("should handle UUIDs", () => {
    const url = buildCoverArtUrl("f1234567-89ab-cdef-0123-456789abcdef");
    assertEquals(
      url,
      "https://coverartarchive.org/release/f1234567-89ab-cdef-0123-456789abcdef/front",
    );
  });
});
