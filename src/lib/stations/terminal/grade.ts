import type { CheckResult, StationResult, TerminalCheck, TerminalConfig } from "@/lib/schemas/stations";
import { containsAnyToken } from "@/lib/guards/quotes";
import { scoreFromChecks } from "../score";
import { createTerminal, isDir, isFile, normalizePath, runCommand, type TerminalState } from "./sim";

function includesAny(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.some((needle) => lower.includes(needle.trim().toLowerCase()));
}

function evaluateCheck(check: TerminalCheck, state: TerminalState, answer: string): boolean {
  const path = check.path ? normalizePath(check.path) : "";
  switch (check.type) {
    case "file_exists":
      return isFile(state, path) || isDir(state, path);
    case "file_absent":
      return !isFile(state, path) && !isDir(state, path);
    case "file_contains":
      return isFile(state, path) && includesAny(state.files[path]!, check.values);
    case "file_not_contains":
      return isFile(state, path) && !includesAny(state.files[path]!, check.values);
    case "command_used":
      return state.history.some((line) => includesAny(line, check.values));
    case "answer_contains":
      return containsAnyToken(answer, check.values);
  }
}

export function evaluateTerminalChecks(config: TerminalConfig, state: TerminalState, answer: string): CheckResult[] {
  return config.checks.map((check) => ({ label: check.label, passed: evaluateCheck(check, state, answer) }));
}

export function gradeTerminal(config: TerminalConfig, state: TerminalState, answer: string, notes: string): StationResult {
  const checks = evaluateTerminalChecks(config, state, answer);
  const attempted = state.history.length > 0 || answer.trim().length > 0;
  const commands = state.history.slice(-60).map((line) => `$ ${line}`).join("\n");
  return {
    station: "terminal",
    checks,
    baseScore: attempted ? scoreFromChecks(checks) : 0,
    maxAdjust: 1,
    summary: [`Commands run (${state.history.length}):`, commands || "(none)", `Answer given: ${answer.trim() || "(none)"}`]
      .join("\n")
      .slice(0, 8000),
    notes: notes.slice(0, 2000),
    attempted,
  };
}

/** Replays the model's own solution in the simulator. */
export function replayTerminalSolution(config: TerminalConfig): { state: TerminalState; outputs: string[] } {
  let state = createTerminal(config);
  const outputs: string[] = [];
  for (const command of config.solution.commands) {
    const outcome = runCommand(state, command);
    state = outcome.state;
    outputs.push(outcome.output);
  }
  return { state, outputs };
}

/** Problems that make a generated terminal scenario unusable. Empty means usable. */
export function validateTerminalConfig(config: TerminalConfig): string[] {
  const errors: string[] = [];
  if (!config.cwd.startsWith("/")) errors.push("cwd must be an absolute path");
  for (const file of config.files) {
    if (!file.path.startsWith("/")) errors.push(`file path ${file.path} must be absolute`);
  }
  for (const check of config.checks) {
    const needsPath = check.type.startsWith("file_");
    const needsValues = ["file_contains", "file_not_contains", "command_used", "answer_contains"].includes(check.type);
    if (needsPath && !check.path.startsWith("/")) errors.push(`check "${check.label}" needs an absolute path`);
    if (needsValues && check.values.length === 0) errors.push(`check "${check.label}" needs at least one value`);
    if (check.type === "answer_contains" && !config.answerPrompt.trim()) {
      errors.push(`check "${check.label}" expects an answer but answerPrompt is empty`);
    }
  }
  if (errors.length) return errors;

  const initial = evaluateTerminalChecks(config, createTerminal(config), "");
  if (initial.every((c) => c.passed)) errors.push("every check already passes before the candidate does anything");

  const { state, outputs } = replayTerminalSolution(config);
  if (outputs.some((o) => o.includes("command not found"))) {
    errors.push("the solution uses a command this terminal does not support");
  }
  const solved = evaluateTerminalChecks(config, state, config.solution.answer);
  for (const check of solved) {
    if (!check.passed) errors.push(`the solution does not satisfy check "${check.label}"`);
  }
  return errors;
}
