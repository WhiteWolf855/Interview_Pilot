import { describe, expect, it } from "vitest";
import { DataConfigSchema, type DataConfig, type DataQuestion } from "@/lib/schemas/stations";
import { aggregate, answerMatches, computeExpected, filterRows, groupTotals, parseNumber } from "@/lib/stations/data/compute";
import { evaluateDataAnswers, gradeData, validateDataConfig } from "@/lib/stations/data/grade";
import { LIBRARY } from "@/lib/stations/library";

const config = LIBRARY.data.config;
const question = (overrides: Partial<DataQuestion>): DataQuestion => ({
  prompt: "q", op: "sum", column: "Revenue", groupBy: "", groupAgg: "sum", filterColumn: "", filterOp: "none", filterValue: "", ...overrides,
});

describe("data computations", () => {
  it("parses numbers written in common ways", () => {
    expect(parseNumber("1,250.50")).toBe(1250.5);
    expect(parseNumber("$40")).toBe(40);
    expect(parseNumber(" 12% ")).toBe(12);
    expect(parseNumber("-3")).toBe(-3);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });

  it("aggregates", () => {
    expect(aggregate([1, 2, 3], "sum")).toBe(6);
    expect(aggregate([1, 2, 3], "avg")).toBe(2);
    expect(aggregate([4, 9, 2], "min")).toBe(2);
    expect(aggregate([4, 9, 2], "max")).toBe(9);
    expect(aggregate([4, 9, 2], "count")).toBe(3);
    expect(aggregate([], "sum")).toBe(0);
  });

  it("filters rows by text and by number", () => {
    expect(filterRows(config, question({ filterColumn: "Region", filterOp: "eq", filterValue: "north" })).length).toBe(3);
    expect(filterRows(config, question({ filterColumn: "Region", filterOp: "neq", filterValue: "North" })).length).toBe(9);
    expect(filterRows(config, question({ filterColumn: "Revenue", filterOp: "gt", filterValue: "29500" })).length).toBe(2);
    expect(filterRows(config, question({ filterColumn: "Revenue", filterOp: "gte", filterValue: "29500" })).length).toBe(3);
    expect(filterRows(config, question({ filterColumn: "Deals", filterOp: "lt", filterValue: "3" })).length).toBe(3);
    expect(filterRows(config, question({ filterColumn: "Deals", filterOp: "lte", filterValue: "3" })).length).toBe(5);
    expect(filterRows(config, question({ filterColumn: "Rep", filterOp: "contains", filterValue: "es" })).length).toBe(2);
    expect(filterRows(config, question({ filterColumn: "Nope", filterOp: "eq", filterValue: "x" })).length).toBe(0);
  });

  it("totals by group", () => {
    const totals = Object.fromEntries(groupTotals(config, config.rows, "Region", "Revenue", "sum").map((g) => [g.group, g.value]));
    expect(totals).toEqual({ North: 66500, South: 29000, East: 96500, West: 21500 });
  });

  it("computes expected answers from the table, never from the model", () => {
    expect(computeExpected(config, config.questions[0]!)).toEqual({ kind: "number", value: 213500 });
    expect(computeExpected(config, config.questions[1]!)).toEqual({ kind: "text", value: "East" });
    expect(computeExpected(config, config.questions[2]!)).toEqual({ kind: "number", value: 16 });
    expect(computeExpected(config, question({ op: "avg", column: "Deals" }))).toEqual({ kind: "number", value: 51 / 12 });
    expect(computeExpected(config, question({ op: "count", column: "", filterColumn: "Region", filterOp: "eq", filterValue: "West" }))).toEqual({ kind: "number", value: 3 });
    expect(computeExpected(config, question({ op: "bottom_group", groupBy: "Region" }))).toEqual({ kind: "text", value: "West" });
    expect(computeExpected(config, question({ op: "top_group", groupBy: "Rep", groupAgg: "avg", column: "Deals" }))).toEqual({ kind: "text", value: "Esi" });
  });

  it("reports questions that have no single answer", () => {
    expect(computeExpected(config, question({ column: "Rep" })).kind).toBe("error");
    expect(computeExpected(config, question({ column: "Missing" })).kind).toBe("error");
    expect(computeExpected(config, question({ filterColumn: "Region", filterOp: "eq", filterValue: "Mars" })).kind).toBe("error");
    expect(computeExpected(config, question({ op: "top_group", groupBy: "Region", groupAgg: "count" }))).toMatchObject({ kind: "error", message: expect.stringContaining("tie") });
  });

  it("accepts exact, formatted, near and rounded answers, and rejects wrong ones", () => {
    const total = computeExpected(config, config.questions[0]!);
    expect(answerMatches(total, "213500")).toBe(true);
    expect(answerMatches(total, "$213,500")).toBe(true);
    expect(answerMatches(total, "213000")).toBe(true); // within 0.5%
    expect(answerMatches(total, "200000")).toBe(false);
    expect(answerMatches(total, "")).toBe(false);
    expect(answerMatches(total, "lots")).toBe(false);
    const average = computeExpected(config, question({ op: "avg", column: "Deals" })); // 4.25
    expect(answerMatches(average, "4.25")).toBe(true);
    expect(answerMatches(average, "4.3")).toBe(true);
    expect(answerMatches(average, "4")).toBe(true);
    expect(answerMatches(average, "5")).toBe(false);
    const region = computeExpected(config, config.questions[1]!);
    expect(answerMatches(region, " east ")).toBe(true);
    expect(answerMatches(region, "North")).toBe(false);
  });
});

describe("data station grading", () => {
  it("the built-in scenario is valid", () => {
    expect(DataConfigSchema.safeParse(config).success).toBe(true);
    expect(validateDataConfig(config)).toEqual([]);
  });

  it("scores 0 for blanks, 5 for all correct, partial in between", () => {
    const none = gradeData(config, ["", "", ""], "", "");
    expect(none.baseScore).toBe(0);
    expect(none.attempted).toBe(false);
    const full = gradeData(config, ["213500", "East", "16"], "East carries the quarter.", "Grouped by region.");
    expect(full.baseScore).toBe(5);
    expect(full.summary).toContain("Written insight: East carries the quarter.");
    const partial = gradeData(config, ["213500", "North", ""], "", "");
    expect(evaluateDataAnswers(config, ["213500", "North", ""]).map((c) => c.passed)).toEqual([true, false, false]);
    expect(partial.baseScore).toBe(2);
    expect(partial.attempted).toBe(true);
  });

  it("rejects generated tables that are inconsistent", () => {
    const ragged: DataConfig = { ...config, rows: [...config.rows.slice(0, -1), ["West", "Hugo", "Mar"]] };
    expect(validateDataConfig(ragged).join(" ")).toContain("cells");
    const notNumeric: DataConfig = { ...config, rows: [["North", "Avery", "Jan", "four", "18000"], ...config.rows.slice(1)] };
    expect(validateDataConfig(notNumeric).join(" ")).toContain("non-numeric");
    const duplicate: DataConfig = { ...config, columns: [...config.columns.slice(0, 4), { name: "region", type: "number" }] };
    expect(validateDataConfig(duplicate).join(" ")).toContain("unique");
    const tie: DataConfig = { ...config, questions: [question({ op: "top_group", groupBy: "Region", groupAgg: "count" }), config.questions[0]!] };
    expect(validateDataConfig(tie).join(" ")).toContain("tie");
    const badFilter: DataConfig = { ...config, questions: [question({ filterColumn: "Quarter", filterOp: "eq", filterValue: "Q1" }), config.questions[0]!] };
    expect(validateDataConfig(badFilter).join(" ")).toContain("unknown filter column");
  });
});
