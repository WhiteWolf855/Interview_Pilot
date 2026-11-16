import type { CheckResult, StationResult, WrittenConfig } from "@/lib/schemas/stations";
import { scoreFromChecks } from "../score";

export function countWords(textValue: string): number {
  return textValue.trim().split(/\s+/).filter(Boolean).length;
}

function mentionsAny(textValue: string, phrases: string[]): boolean {
  const lower = textValue.toLowerCase().replace(/\s+/g, " ");
  return phrases.some((phrase) => lower.includes(phrase.trim().toLowerCase()));
}

export function evaluateWritten(config: WrittenConfig, response: string): CheckResult[] {
  const words = countWords(response);
  return [
    ...config.mustInclude.map((item) => ({ label: `Covers: ${item.label}`, passed: mentionsAny(response, item.anyOf) })),
    ...config.mustAvoid.map((item) => ({ label: `Avoids: ${item.label}`, passed: words > 0 && !mentionsAny(response, item.anyOf) })),
    {
      label: `Length between ${config.minWords} and ${config.maxWords} words`,
      passed: words >= config.minWords && words <= config.maxWords,
      detail: `${words} words`,
    },
  ];
}

export function gradeWritten(config: WrittenConfig, response: string, notes: string): StationResult {
  const checks = evaluateWritten(config, response);
  const attempted = countWords(response) > 0;
  return {
    station: "written",
    checks,
    baseScore: attempted ? scoreFromChecks(checks) : 0,
    // Phrase checks are crude, so the model's reading of the text is allowed more weight here.
    maxAdjust: 2,
    summary: (response.trim() || "(nothing written)").slice(0, 8000),
    notes: notes.slice(0, 2000),
    attempted,
  };
}

export function validateWrittenConfig(config: WrittenConfig): string[] {
  const errors: string[] = [];
  if (config.minWords >= config.maxWords) errors.push("minWords must be less than maxWords");
  return errors;
}
