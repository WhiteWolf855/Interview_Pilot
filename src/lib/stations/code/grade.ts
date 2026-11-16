import type { CheckResult, CodeConfig, StationResult } from "@/lib/schemas/stations";
import { testsOf, type CodeExecutor, type TestOutcome } from "./runner";

/** Static problems that make a generated code scenario unusable. */
export function validateCodeConfig(config: CodeConfig): string[] {
  const errors: string[] = [];
  config.tests.forEach((test, index) => {
    try {
      if (!Array.isArray(JSON.parse(test.argsJson))) errors.push(`test ${index + 1}: argsJson must be a JSON array`);
    } catch {
      errors.push(`test ${index + 1}: argsJson is not valid JSON`);
    }
    try {
      JSON.parse(test.expectedJson);
    } catch {
      errors.push(`test ${index + 1}: expectedJson is not valid JSON`);
    }
  });
  if (!config.starterCode.includes(config.functionName)) errors.push("starterCode does not define the named function");
  if (!config.referenceSolution.includes(config.functionName)) errors.push("referenceSolution does not define the named function");
  if (!config.tests.some((t) => !t.hidden)) errors.push("at least one test must be visible");
  return errors;
}

export interface PreparedCodeScenario {
  config: CodeConfig;
  /** How many tests the unedited starter code already passes. */
  starterPassed: number;
  usedFallback: boolean;
}

/**
 * Model-written code scenarios are checked by running them: the reference
 * solution must pass every test and the starter code must fail at least one.
 * If not, the built-in scenario is used instead.
 */
export async function prepareCodeScenario(
  config: CodeConfig,
  fallback: CodeConfig,
  execute: CodeExecutor,
): Promise<PreparedCodeScenario> {
  const check = async (candidate: CodeConfig) => {
    if (validateCodeConfig(candidate).length > 0) return null;
    const tests = testsOf(candidate);
    const reference = await execute(candidate.referenceSolution, candidate.functionName, tests);
    if (!reference.every((o) => o.passed)) return null;
    const starter = await execute(candidate.starterCode, candidate.functionName, tests);
    const starterPassed = starter.filter((o) => o.passed).length;
    if (starterPassed === tests.length) return null;
    return starterPassed;
  };
  const generated = await check(config);
  if (generated !== null) return { config, starterPassed: generated, usedFallback: false };
  const builtIn = await check(fallback);
  return { config: fallback, starterPassed: builtIn ?? 0, usedFallback: true };
}

export function scoreCode(outcomes: TestOutcome[], starterPassed: number): number {
  const total = outcomes.length;
  if (total === 0) return 0;
  const passed = outcomes.filter((o) => o.passed).length;
  if (passed === total) return 5;
  const gained = Math.max(0, passed - starterPassed);
  const available = Math.max(1, total - starterPassed);
  return Math.min(4, Math.floor((gained / available) * 5));
}

export function gradeCode(input: {
  config: CodeConfig;
  outcomes: TestOutcome[];
  starterPassed: number;
  code: string;
  notes: string;
}): StationResult {
  const { config, outcomes, starterPassed, code, notes } = input;
  const edited = code.trim() !== config.starterCode.trim();
  const checks: CheckResult[] = outcomes.map((o) => ({
    label: (o.hidden ? "Hidden test: " : "Test: ") + o.name,
    passed: o.passed,
    detail: o.error?.slice(0, 300),
  }));
  return {
    station: "code",
    checks,
    baseScore: edited ? scoreCode(outcomes, starterPassed) : 0,
    maxAdjust: 1,
    summary: `Final code:\n${code}`.slice(0, 8000),
    notes: notes.slice(0, 2000),
    attempted: edited,
  };
}
