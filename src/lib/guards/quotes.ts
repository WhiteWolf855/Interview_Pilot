/** Loose text matching used to check that a quote really comes from a source. */

export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, "-")
    .replace(/[^a-z0-9%$+#.'"\-/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the quote (ignoring case, punctuation spacing and trailing dots) is in the source. */
export function quoteAppearsIn(quote: string, source: string): boolean {
  const q = normalizeForMatch(quote).replace(/^["'. ]+|["'. ]+$/g, "");
  if (q.length < 2) return false;
  return normalizeForMatch(source).includes(q);
}

/** Whole-token, case-insensitive containment: "17" matches "it was 17." but not "117". */
export function containsToken(haystack: string, needle: string): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i").test(haystack);
}

export function containsAnyToken(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => containsToken(haystack, needle));
}
