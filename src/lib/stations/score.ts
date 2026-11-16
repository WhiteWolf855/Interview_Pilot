import type { CheckResult } from "@/lib/schemas/stations";

/** Converts passed checks into a 0 to 5 score. */
export function scoreFromChecks(checks: CheckResult[]): number {
  if (checks.length === 0) return 0;
  const passed = checks.filter((c) => c.passed).length;
  if (passed === checks.length) return 5;
  // Anything short of every check passing is capped at 4.
  return Math.min(4, Math.round((passed / checks.length) * 5));
}

export const HONEST_APPROACH_FLOOR = 3;

/**
 * Combines the deterministic base score with the model's judgement.
 * The model may move the score by at most `maxAdjust`. An honest "I haven't
 * done this, here is how I'd approach it" with a sound approach never scores
 * below 3. Both rules are applied here, in code.
 */
export function finalStationScore(input: {
  baseScore: number;
  maxAdjust: number;
  modelScore: number;
  honestSoundApproach: boolean;
  attempted: boolean;
}): number {
  const low = Math.max(0, input.baseScore - input.maxAdjust);
  const high = Math.min(5, input.baseScore + input.maxAdjust);
  let score = Math.min(high, Math.max(low, Math.round(input.modelScore)));
  if (!input.attempted && !input.honestSoundApproach) score = 0;
  if (input.honestSoundApproach) score = Math.max(score, HONEST_APPROACH_FLOOR);
  return score;
}

/** The same floor for conversation stages. */
export function finalConversationScore(input: {
  modelScore: number;
  honestSoundApproach: boolean;
  answered: boolean;
}): number {
  if (!input.answered) return 0;
  let score = Math.min(5, Math.max(0, Math.round(input.modelScore)));
  if (input.honestSoundApproach) score = Math.max(score, HONEST_APPROACH_FLOOR);
  return score;
}
