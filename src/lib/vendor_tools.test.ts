import { assertEquals, assertMatch } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { getVendorBinaryPath } from "./vendor_tools.ts";

describe("getVendorBinaryPath", () => {
  it("should return a path containing the tool name for fpcalc", () => {
    const path = getVendorBinaryPath("fpcalc");
    assertMatch(path, /fpcalc/);
  });

  it("should return a path containing the tool name for rsgain", () => {
    const path = getVendorBinaryPath("rsgain");
    assertMatch(path, /rsgain/);
  });

  it("should return a path containing the platform directory", () => {
    const path = getVendorBinaryPath("fpcalc");
    assertMatch(path, /(macos|linux|windows)-(arm64|x86_64)/);
  });

  it("should return a path that exists on disk for fpcalc", () => {
    const path = getVendorBinaryPath("fpcalc");
    const info = Deno.statSync(path);
    assertEquals(info.isFile, true);
  });

  it("should return a path that exists on disk for rsgain", () => {
    const path = getVendorBinaryPath("rsgain");
    const info = Deno.statSync(path);
    assertEquals(info.isFile, true);
  });
});
