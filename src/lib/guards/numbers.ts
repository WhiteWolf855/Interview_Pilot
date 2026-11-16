/**
 * Deterministic check against invented numbers. A "metric-like" number is one a
 * model should never make up about a candidate: percentages, money, numbers
 * with a k/m/bn suffix, decimals, and numbers of three or more digits.
 * Small bare numbers ("2 follow-ups", "first 90 days") are allowed.
 */

export interface NumberGuardOptions {
  /** Bare integers with at least this many digits are checked. Default 3. */
  minDigits?: number;
}

const NUMBER = /([$£€₹]\s?)?(\d[\d,]*(?:\.\d+)?)(\s?(?:%|percent|k\b|m\b|mm\b|bn\b|x\b))?/gi;

function digitsOnly(n: string): string {
  return n.replace(/,/g, "");
}

export function extractCheckedNumbers(text: string, options: NumberGuardOptions = {}): string[] {
  const minDigits = options.minDigits ?? 3;
  const found: string[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const raw = digitsOnly(match[2] ?? "");
    if (!raw) continue;
    const hasUnit = Boolean(match[1] || match[3]);
    const isDecimal = raw.includes(".");
    const intDigits = raw.split(".")[0]?.length ?? 0;
    if (hasUnit || isDecimal || intDigits >= minDigits) found.push(raw);
  }
  return found;
}

/** All number strings that appear in the source texts, in normalised form. */
function sourceNumbers(sources: string[]): Set<string> {
  const set = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      set.add(digitsOnly(match[0]).replace(/\.$/, ""));
    }
  }
  return set;
}

/** Returns the metric-like numbers in `text` that appear in none of the sources. */
export function findUnsupportedNumbers(
  text: string,
  sources: string[],
  options: NumberGuardOptions = {},
): string[] {
  const allowed = sourceNumbers(sources);
  const unsupported = extractCheckedNumbers(text, options).filter((n) => !allowed.has(n));
  return Array.from(new Set(unsupported));
}
