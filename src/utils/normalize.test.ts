import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { normalizeForMatching } from "./normalize.ts";

describe("normalizeForMatching", () => {
  it("should lowercase and trim text", () => {
    assertEquals(normalizeForMatching("  HELLO WORLD  "), "hello world");
    assertEquals(normalizeForMatching("Mixed Case"), "mixed case");
  });

  it("should remove diacritics", () => {
    assertEquals(normalizeForMatching("Björk"), "bjork");
    assertEquals(normalizeForMatching("Café"), "cafe");
    assertEquals(normalizeForMatching("Naïve"), "naive");
    assertEquals(normalizeForMatching("Münchën"), "munchen");
  });

  it("should normalize punctuation", () => {
    assertEquals(normalizeForMatching("AC/DC"), "ac dc");
    assertEquals(normalizeForMatching("Rock & Roll"), "rock and roll");
    assertEquals(normalizeForMatching("Hello-World"), "hello world");
    assertEquals(normalizeForMatching("Test@Example!"), "test example");
  });

  it("should preserve apostrophes", () => {
    assertEquals(normalizeForMatching("Don't Stop"), "don't stop");
    assertEquals(normalizeForMatching("U2's Best"), "u2's best");
    assertEquals(normalizeForMatching("Sgt. Pepper's"), "sgt pepper's");
  });

  it("should collapse multiple spaces", () => {
    assertEquals(
      normalizeForMatching("Too   Many     Spaces"),
      "too many spaces",
    );
    assertEquals(normalizeForMatching("Tab\tSpace"), "tab space");
  });

  it("should strip leading articles when option is enabled", () => {
    assertEquals(
      normalizeForMatching("The Beatles", { stripLeadingArticles: true }),
      "beatles",
    );
    assertEquals(
      normalizeForMatching("A Hard Day's Night", {
        stripLeadingArticles: true,
      }),
      "hard day's night",
    );
    assertEquals(
      normalizeForMatching("An Album", { stripLeadingArticles: true }),
      "album",
    );
    // Should not strip if not at beginning
    assertEquals(
      normalizeForMatching("Meet The Beatles", { stripLeadingArticles: true }),
      "meet the beatles",
    );
  });

  it("should convert Roman numerals when option is enabled", () => {
    assertEquals(
      normalizeForMatching("Led Zeppelin IV", { romanToArabic: true }),
      "led zeppelin 4",
    );
    assertEquals(
      normalizeForMatching("Star Wars Episode III", { romanToArabic: true }),
      "star wars episode 3",
    );
    assertEquals(
      normalizeForMatching("Chapter IX", { romanToArabic: true }),
      "chapter 9",
    );
    assertEquals(
      normalizeForMatching("MCMXCIX", { romanToArabic: true }),
      "1999",
    );
  });

  it("should handle complex cases", () => {
    assertEquals(
      normalizeForMatching("The Köln Concert / Part I", {
        stripLeadingArticles: true,
        romanToArabic: true,
      }),
      "koln concert part 1",
    );
    assertEquals(
      normalizeForMatching("AC/DC - Back in Black & More!", {
        stripLeadingArticles: false,
        romanToArabic: false,
      }),
      "ac dc back in black and more",
    );
  });

  it("should preserve numbers", () => {
    assertEquals(normalizeForMatching("Blink-182"), "blink 182");
    assertEquals(normalizeForMatching("U2"), "u2");
    assertEquals(normalizeForMatching("3 Doors Down"), "3 doors down");
  });

  it("should handle empty or whitespace-only strings", () => {
    assertEquals(normalizeForMatching(""), "");
    assertEquals(normalizeForMatching("   "), "");
    assertEquals(normalizeForMatching("\t\n"), "");
  });
});
