import type { CheckResult, DataConfig, StationResult } from "@/lib/schemas/stations";
import { scoreFromChecks } from "../score";
import { answerMatches, columnIndex, computeExpected, parseNumber } from "./compute";

export function evaluateDataAnswers(config: DataConfig, answers: string[]): CheckResult[] {
  return config.questions.map((question, index) => ({
    label: question.prompt,
    passed: answerMatches(computeExpected(config, question), answers[index] ?? ""),
  }));
}

export function gradeData(config: DataConfig, answers: string[], insight: string, notes: string): StationResult {
  const checks = evaluateDataAnswers(config, answers);
  const attempted = answers.some((a) => a.trim().length > 0) || insight.trim().length > 0;
  const lines = config.questions.map((q, i) => `Q${i + 1}: ${q.prompt}\nAnswer: ${(answers[i] ?? "").trim() || "(blank)"}`);
  return {
    station: "data",
    checks,
    baseScore: attempted ? scoreFromChecks(checks) : 0,
    maxAdjust: 1,
    summary: [...lines, `Written insight: ${insight.trim() || "(blank)"}`].join("\n").slice(0, 8000),
    notes: notes.slice(0, 2000),
    attempted,
  };
}

export function validateDataConfig(config: DataConfig): string[] {
  const errors: string[] = [];
  const names = config.columns.map((c) => c.name.toLowerCase());
  if (new Set(names).size !== names.length) errors.push("column names must be unique");
  config.rows.forEach((row, rowIndex) => {
    if (row.length !== config.columns.length) errors.push(`row ${rowIndex + 1} has ${row.length} cells, expected ${config.columns.length}`);
  });
  config.columns.forEach((column, index) => {
    if (column.type === "number" && config.rows.some((row) => parseNumber(row[index] ?? "") === null)) {
      errors.push(`numeric column "${column.name}" has a non-numeric cell`);
    }
  });
  if (errors.length) return errors;
  config.questions.forEach((question, index) => {
    if (question.filterOp !== "none" && columnIndex(config, question.filterColumn) === -1) {
      errors.push(`question ${index + 1}: unknown filter column "${question.filterColumn}"`);
      return;
    }
    const expected = computeExpected(config, question);
    if (expected.kind === "error") errors.push(`question ${index + 1}: ${expected.message}`);
  });
  return errors;
}
