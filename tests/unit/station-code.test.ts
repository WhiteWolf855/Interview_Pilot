import { describe, expect, it } from "vitest";
import { CodeConfigSchema, type CodeConfig } from "@/lib/schemas/stations";
import { gradeCode, prepareCodeScenario, scoreCode, validateCodeConfig } from "@/lib/stations/code/grade";
import { testsOf } from "@/lib/stations/code/runner";
import { LIBRARY } from "@/lib/stations/library";
import { nodeExecutor } from "../helpers/node-executor";

const config = LIBRARY.code.config;
const tests = testsOf(config);

describe("code runner", () => {
  it("passes every test with the reference solution", async () => {
    const outcomes = await nodeExecutor(config.referenceSolution, config.functionName, tests);
    expect(outcomes.map((o) => o.passed)).toEqual([true, true, true, true, true]);
  });

  it("fails the buggy starter code and reports the thrown error", async () => {
    const outcomes = await nodeExecutor(config.starterCode, config.functionName, tests);
    expect(outcomes.every((o) => !o.passed)).toBe(true);
    expect(outcomes[0]!.error).toMatch(/undefined|null/i);
  });

  it("reports a wrong return value with what was returned", async () => {
    const outcomes = await nodeExecutor("function totalsByCustomer() { return { alice: 1 }; }", config.functionName, tests);
    expect(outcomes[1]).toMatchObject({ passed: false, actual: '{"alice":1}' });
  });

  it("reports syntax errors and a missing function", async () => {
    const syntax = await nodeExecutor("function totalsByCustomer( {", config.functionName, tests);
    expect(syntax.every((o) => !o.passed && o.error!.includes("did not load"))).toBe(true);
    const missing = await nodeExecutor("function somethingElse() {}", config.functionName, tests);
    expect(missing[0]!.error).toContain("is not defined");
  });

  it("compares objects regardless of key order and does not share arguments between tests", async () => {
    const reordered = await nodeExecutor(
      "function f(a) { a.push(1); return { b: 2, a: a.length }; }",
      "f",
      [
        { name: "first", argsJson: "[[]]", expectedJson: '{"a":1,"b":2}', hidden: false },
        { name: "second", argsJson: "[[]]", expectedJson: '{"a":1,"b":2}', hidden: false },
      ],
    );
    expect(reordered.map((o) => o.passed)).toEqual([true, true]);
  });

  it("stops an infinite loop with a timeout", async () => {
    const outcomes = await nodeExecutor("function totalsByCustomer() { while (true) {} }", config.functionName, tests);
    expect(outcomes.every((o) => !o.passed && o.error!.includes("Timed out"))).toBe(true);
  });
});

describe("code grading", () => {
  it("the built-in scenario is valid", () => {
    expect(CodeConfigSchema.safeParse(config).success).toBe(true);
    expect(validateCodeConfig(config)).toEqual([]);
  });

  it("scores relative to what the starter code already passed", () => {
    const outcomes = (passed: number, total = 5) => Array.from({ length: total }, (_, i) => ({ name: `t${i}`, hidden: false, passed: i < passed }));
    expect(scoreCode(outcomes(5), 0)).toBe(5);
    expect(scoreCode(outcomes(0), 0)).toBe(0);
    expect(scoreCode(outcomes(3), 0)).toBe(3);
    expect(scoreCode(outcomes(4), 0)).toBe(4);
    // No credit for tests that passed before the candidate touched anything.
    expect(scoreCode(outcomes(2), 2)).toBe(0);
    expect(scoreCode(outcomes(4), 2)).toBe(3);
    expect(scoreCode([], 0)).toBe(0);
  });

  it("gives 0 for unedited code, 5 for a full fix, partial credit for one bug fixed", async () => {
    const untouched = await nodeExecutor(config.starterCode, config.functionName, tests);
    const none = gradeCode({ config, outcomes: untouched, starterPassed: 0, code: config.starterCode, notes: "" });
    expect(none.baseScore).toBe(0);
    expect(none.attempted).toBe(false);

    const fixed = await nodeExecutor(config.referenceSolution, config.functionName, tests);
    const full = gradeCode({ config, outcomes: fixed, starterPassed: 0, code: config.referenceSolution, notes: "Two bugs." });
    expect(full.baseScore).toBe(5);
    expect(full.checks.filter((c) => c.label.startsWith("Hidden test")).length).toBe(2);

    const oneBugFixed = config.starterCode.replace("i <= orders.length", "i < orders.length");
    const halfway = await nodeExecutor(oneBugFixed, config.functionName, tests);
    const partial = gradeCode({ config, outcomes: halfway, starterPassed: 0, code: oneBugFixed, notes: "" });
    expect(partial.baseScore).toBeGreaterThan(0);
    expect(partial.baseScore).toBeLessThan(5);
    expect(partial.attempted).toBe(true);
  });

  it("uses a generated scenario when it is consistent", async () => {
    const prepared = await prepareCodeScenario(config, config, nodeExecutor);
    expect(prepared.usedFallback).toBe(false);
    expect(prepared.starterPassed).toBe(0);
  });

  it("falls back to the built-in scenario when the generated one is inconsistent", async () => {
    const wrongExpectation: CodeConfig = { ...config, tests: [{ ...config.tests[0]!, expectedJson: '{"oops":1}' }, ...config.tests.slice(1)] };
    expect((await prepareCodeScenario(wrongExpectation, config, nodeExecutor)).usedFallback).toBe(true);

    const starterAlreadyCorrect: CodeConfig = { ...config, starterCode: config.referenceSolution };
    expect((await prepareCodeScenario(starterAlreadyCorrect, config, nodeExecutor)).usedFallback).toBe(true);

    const badJson: CodeConfig = { ...config, tests: [{ ...config.tests[0]!, argsJson: "not json" }, ...config.tests.slice(1)] };
    expect(validateCodeConfig(badJson).join(" ")).toContain("not valid JSON");
    expect((await prepareCodeScenario(badJson, config, nodeExecutor)).config).toBe(config);
  });

  it("flags scenarios whose code does not define the function, or with no visible test", () => {
    expect(validateCodeConfig({ ...config, starterCode: "function other() {}" }).join(" ")).toContain("starterCode");
    expect(validateCodeConfig({ ...config, tests: config.tests.map((t) => ({ ...t, hidden: true })) }).join(" ")).toContain("visible");
    expect(validateCodeConfig({ ...config, tests: [{ ...config.tests[0]!, argsJson: "{}" }, ...config.tests.slice(1)] }).join(" ")).toContain("JSON array");
  });
});
