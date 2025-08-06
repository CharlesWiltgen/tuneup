const ARTICLES = /^(the|a|an)\s+/i;
// Proper diacritics removal regex (combining diacritical marks)
const DIACRITICS_REGEX = /[\u0300-\u036f]/g;

export function normalizeForMatching(
  s: string,
  opts: {
    stripLeadingArticles?: boolean;
    romanToArabic?: boolean;
  } = {},
) {
  // 1) Unicode NFD + diacritics strip
  s = s.normalize("NFD").replace(DIACRITICS_REGEX, "");

  // 2) Canonicalize punctuation & spacing
  s = s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\//g, " ") // AC/DC -> AC DC
    .replace(/[^\w\s']/g, " ") // keep letters/digits/underscore/space/apos
    .replace(/\s+/g, " ")
    .trim();

  if (opts.stripLeadingArticles) s = s.replace(ARTICLES, "");
  if (opts.romanToArabic) {
    // Match valid Roman numerals (simplified regex that requires at least one character)
    s = s.replace(/\b([MDCLXVI]+)\b/gi, (match) => {
      // Validate it's a proper Roman numeral pattern
      if (
        /^M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i.test(match)
      ) {
        return romanToInt(match).toString();
      }
      return match; // Return unchanged if not a valid Roman numeral
    });
  }
  return s;
}

function romanToInt(r: string): number {
  const map: Record<string, number> = {
    i: 1,
    v: 5,
    x: 10,
    l: 50,
    c: 100,
    d: 500,
    m: 1000,
  };
  let prev = 0, sum = 0;
  for (let i = r.length - 1; i >= 0; i--) {
    const val = map[r[i].toLowerCase()] ?? 0;
    sum += val < prev ? -val : val;
    prev = val;
  }
  return sum;
}
