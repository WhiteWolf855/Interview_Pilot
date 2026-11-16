import { describe, expect, it } from "vitest";
import { WrittenConfigSchema } from "@/lib/schemas/stations";
import { LIBRARY } from "@/lib/stations/library";
import { countWords, evaluateWritten, gradeWritten, validateWrittenConfig } from "@/lib/stations/written/grade";

const config = LIBRARY.written.config;

const GOOD = `Subject: Sign-in problem this morning

This morning, between 09:12 and 09:59, you were unable to sign in to your account. That was 47 minutes during which you could not reach your account, and we are sorry for the disruption.

The problem was caused by a change we made, which we have since rolled back. Sign-in has been restored and we are monitoring it closely.

We are reviewing exactly what went wrong and will share what we found, and what we are changing, by Friday. If you still have trouble signing in, reply to this email and we will help straight away.`;

describe("written station", () => {
  it("counts words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  one   two\nthree ")).toBe(3);
  });

  it("the built-in scenario is valid", () => {
    expect(WrittenConfigSchema.safeParse(config).success).toBe(true);
    expect(validateWrittenConfig(config)).toEqual([]);
    expect(validateWrittenConfig({ ...config, minWords: 200, maxWords: 100 })).toHaveLength(1);
  });

  it("scores 0 for an empty submission and marks it not attempted", () => {
    const result = gradeWritten(config, "   ", "");
    expect(result.baseScore).toBe(0);
    expect(result.attempted).toBe(false);
    expect(result.checks.every((c) => !c.passed)).toBe(true);
  });

  it("scores 5 for a response that covers everything and avoids the traps", () => {
    const result = gradeWritten(config, GOOD, "Led with the impact.");
    expect(result.checks.filter((c) => !c.passed)).toEqual([]);
    expect(result.baseScore).toBe(5);
    expect(result.maxAdjust).toBe(2);
    expect(result.summary).toContain("47 minutes");
  });

  it("fails the right checks for speculation, blame and missing points", () => {
    const bad = "Hi all. There was a small issue earlier which was probably a database thing caused by human error on another team. It is fine now. Thanks for your patience and understanding while we looked at this for you today, we appreciate it and hope you have a good rest of your week ahead with us as always and forever more ok.";
    const byLabel = Object.fromEntries(evaluateWritten(config, bad).map((c) => [c.label, c.passed]));
    expect(byLabel["Avoids: guessing at the cause"]).toBe(false);
    expect(byLabel["Avoids: blaming a person or team"]).toBe(false);
    expect(byLabel["Covers: an apology"]).toBe(false);
    expect(byLabel["Covers: how long it lasted"]).toBe(false);
    expect(gradeWritten(config, bad, "").baseScore).toBeLessThanOrEqual(2);
  });

  it("enforces the length limits in both directions", () => {
    const length = (text: string) => evaluateWritten(config, text).at(-1)!;
    expect(length("Sorry, sign in was down for 47 minutes. It is restored. Review by Friday.").passed).toBe(false);
    expect(length(GOOD).passed).toBe(true);
    expect(length(`${GOOD} ${"more words ".repeat(100)}`).passed).toBe(false);
    expect(length(GOOD).detail).toMatch(/^\d+ words$/);
  });

  it("matches phrases regardless of case and line breaks", () => {
    const text = GOOD.replace("47 minutes", "47\nMINUTES");
    expect(evaluateWritten(config, text).find((c) => c.label === "Covers: how long it lasted")!.passed).toBe(true);
  });
});
