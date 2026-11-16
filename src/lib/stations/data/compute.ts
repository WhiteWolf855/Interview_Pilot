import type { DataConfig, DataQuestion } from "@/lib/schemas/stations";

/** Parses a spreadsheet cell or a typed answer: "$1,250.50", "12%", " 40 ". */
export function parseNumber(cell: string): number | null {
  const cleaned = cell.replace(/[$£€₹,%\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

export type Aggregate = "sum" | "avg" | "min" | "max" | "count";

export function aggregate(values: number[], op: Aggregate): number {
  if (op === "count") return values.length;
  if (values.length === 0) return 0;
  switch (op) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
  }
}

export function columnIndex(config: DataConfig, name: string): number {
  return config.columns.findIndex((c) => c.name.toLowerCase() === name.trim().toLowerCase());
}

export function filterRows(config: DataConfig, question: Pick<DataQuestion, "filterColumn" | "filterOp" | "filterValue">): string[][] {
  if (question.filterOp === "none") return config.rows;
  const index = columnIndex(config, question.filterColumn);
  if (index === -1) return [];
  const target = question.filterValue.trim().toLowerCase();
  const targetNumber = parseNumber(question.filterValue);
  return config.rows.filter((row) => {
    const cell = (row[index] ?? "").trim();
    const cellNumber = parseNumber(cell);
    switch (question.filterOp) {
      case "eq":
        return cellNumber !== null && targetNumber !== null ? cellNumber === targetNumber : cell.toLowerCase() === target;
      case "neq":
        return cellNumber !== null && targetNumber !== null ? cellNumber !== targetNumber : cell.toLowerCase() !== target;
      case "contains":
        return cell.toLowerCase().includes(target);
      case "gt":
        return cellNumber !== null && targetNumber !== null && cellNumber > targetNumber;
      case "gte":
        return cellNumber !== null && targetNumber !== null && cellNumber >= targetNumber;
      case "lt":
        return cellNumber !== null && targetNumber !== null && cellNumber < targetNumber;
      case "lte":
        return cellNumber !== null && targetNumber !== null && cellNumber <= targetNumber;
      default:
        return true;
    }
  });
}

export function groupTotals(
  config: DataConfig,
  rows: string[][],
  groupBy: string,
  column: string,
  agg: "sum" | "avg" | "count",
): { group: string; value: number }[] {
  const groupIndex = columnIndex(config, groupBy);
  const valueIndex = columnIndex(config, column);
  if (groupIndex === -1) return [];
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const key = (row[groupIndex] ?? "").trim();
    const value = valueIndex === -1 ? 0 : parseNumber(row[valueIndex] ?? "") ?? 0;
    groups.set(key, [...(groups.get(key) ?? []), value]);
  }
  return Array.from(groups, ([group, values]) => ({ group, value: aggregate(values, agg) }));
}

export type Expected =
  | { kind: "number"; value: number }
  | { kind: "text"; value: string }
  | { kind: "error"; message: string };

/** The expected answer is always computed from the data, never taken from the model. */
export function computeExpected(config: DataConfig, question: DataQuestion): Expected {
  const rows = filterRows(config, question);
  if (rows.length === 0) return { kind: "error", message: "the filter matches no rows" };

  if (question.op === "top_group" || question.op === "bottom_group") {
    if (columnIndex(config, question.groupBy) === -1) return { kind: "error", message: `unknown group column "${question.groupBy}"` };
    if (question.groupAgg !== "count" && columnIndex(config, question.column) === -1) {
      return { kind: "error", message: `unknown column "${question.column}"` };
    }
    const totals = groupTotals(config, rows, question.groupBy, question.column, question.groupAgg).sort((a, b) =>
      question.op === "top_group" ? b.value - a.value : a.value - b.value,
    );
    if (totals.length < 2) return { kind: "error", message: "grouping gives fewer than two groups" };
    if (totals[0]!.value === totals[1]!.value) return { kind: "error", message: "two groups tie, so there is no single answer" };
    return { kind: "text", value: totals[0]!.group };
  }

  if (question.op === "count") return { kind: "number", value: rows.length };

  const index = columnIndex(config, question.column);
  if (index === -1) return { kind: "error", message: `unknown column "${question.column}"` };
  if (config.columns[index]!.type !== "number") return { kind: "error", message: `column "${question.column}" is not numeric` };
  const values = rows.map((row) => parseNumber(row[index] ?? ""));
  if (values.some((v) => v === null)) return { kind: "error", message: `column "${question.column}" has a non-numeric cell` };
  return { kind: "number", value: aggregate(values as number[], question.op) };
}

/** Accepts exact answers, answers within 0.5%, and sensible roundings. */
export function answerMatches(expected: Expected, answer: string): boolean {
  const trimmed = answer.trim();
  if (!trimmed || expected.kind === "error") return false;
  if (expected.kind === "text") return trimmed.toLowerCase() === expected.value.trim().toLowerCase();
  const given = parseNumber(trimmed);
  if (given === null) return false;
  const e = expected.value;
  if (Math.abs(given - e) <= Math.max(Math.abs(e) * 0.005, 0.005)) return true;
  return [0, 1, 2].some((places) => Number(e.toFixed(places)) === given);
}

export function formatExpected(expected: Expected): string {
  if (expected.kind === "error") return "";
  if (expected.kind === "text") return expected.value;
  return Number.isInteger(expected.value) ? String(expected.value) : expected.value.toFixed(2);
}
