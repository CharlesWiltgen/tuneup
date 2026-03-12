import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { ensureTagLib } from "./taglib_init.ts";

describe("ensureTagLib", () => {
  it("should return a TagLib instance", async () => {
    const taglib = await ensureTagLib();
    assertExists(taglib);
  });

  it("should return the same instance on subsequent calls (singleton)", async () => {
    const first = await ensureTagLib();
    const second = await ensureTagLib();
    assertEquals(first, second);
  });
});
