import type { ApiCheck, ApiConfig, CheckResult, StationResult } from "@/lib/schemas/stations";
import { containsAnyToken } from "@/lib/guards/quotes";
import { scoreFromChecks } from "../score";
import { createApi, parseRecords, sendRequest, type ApiState } from "./sim";

const same = (a: unknown, b: string) => String(a ?? "").trim().toLowerCase() === b.trim().toLowerCase();

function evaluateCheck(check: ApiCheck, state: ApiState, answer: string): boolean {
  const records = state.collections[check.collection] ?? [];
  switch (check.type) {
    case "request_made":
      return state.log.some(
        (entry) =>
          entry.method === check.method.toUpperCase() &&
          entry.path.toLowerCase().startsWith(check.pathPrefix.toLowerCase()) &&
          entry.status >= 200 &&
          entry.status < 300,
      );
    case "record_field_equals": {
      const record = records.find((r) => String(r.id) === check.recordId);
      return Boolean(record) && same(record![check.field], check.value);
    }
    case "record_exists":
      return records.some((r) => same(r[check.field], check.value));
    case "record_absent":
      return !records.some((r) => String(r.id) === check.recordId);
    case "answer_contains":
      return containsAnyToken(answer, check.values);
  }
}

export function evaluateApiChecks(config: ApiConfig, state: ApiState, answer: string): CheckResult[] {
  return config.checks.map((check) => ({ label: check.label, passed: evaluateCheck(check, state, answer) }));
}

export function gradeApi(config: ApiConfig, state: ApiState, answer: string, notes: string): StationResult {
  const checks = evaluateApiChecks(config, state, answer);
  const attempted = state.log.length > 0 || answer.trim().length > 0;
  const requests = state.log.slice(-60).map((e) => `${e.method} ${e.path} -> ${e.status}`).join("\n");
  return {
    station: "api",
    checks,
    baseScore: attempted ? scoreFromChecks(checks) : 0,
    maxAdjust: 1,
    summary: [`Requests sent (${state.log.length}):`, requests || "(none)", `Answer given: ${answer.trim() || "(none)"}`]
      .join("\n")
      .slice(0, 8000),
    notes: notes.slice(0, 2000),
    attempted,
  };
}

export function replayApiSolution(config: ApiConfig): ApiState {
  let state = createApi(config);
  const headers: Record<string, string> = config.authToken ? { Authorization: `Bearer ${config.authToken}` } : {};
  for (const request of config.solution.requests) {
    state = sendRequest(config, state, { method: request.method, path: request.path, headers, body: request.bodyJson }).state;
  }
  return state;
}

export function validateApiConfig(config: ApiConfig): string[] {
  const errors: string[] = [];
  const names = new Set<string>();
  for (const collection of config.collections) {
    if (names.has(collection.name)) errors.push(`duplicate collection ${collection.name}`);
    names.add(collection.name);
    const records = parseRecords(collection.recordsJson);
    if (typeof records === "string") errors.push(`collection ${collection.name}: ${records}`);
    else if (records.length === 0) errors.push(`collection ${collection.name} has no records`);
  }
  for (const check of config.checks) {
    if (check.type.startsWith("record_") && !names.has(check.collection)) {
      errors.push(`check "${check.label}" refers to an unknown collection`);
    }
    if (check.type === "request_made" && (!check.method || !check.pathPrefix.startsWith("/"))) {
      errors.push(`check "${check.label}" needs a method and a path starting with /`);
    }
    if (check.type === "answer_contains") {
      if (check.values.length === 0) errors.push(`check "${check.label}" needs at least one accepted answer`);
      if (!config.answerPrompt.trim()) errors.push(`check "${check.label}" expects an answer but answerPrompt is empty`);
    }
  }
  if (errors.length) return errors;

  if (evaluateApiChecks(config, createApi(config), "").every((c) => c.passed)) {
    errors.push("every check already passes before the candidate does anything");
  }
  const solved = replayApiSolution(config);
  if (solved.log.some((entry) => entry.status >= 400)) errors.push("a solution request fails against the simulated API");
  for (const check of evaluateApiChecks(config, solved, config.solution.answer)) {
    if (!check.passed) errors.push(`the solution does not satisfy check "${check.label}"`);
  }
  return errors;
}
