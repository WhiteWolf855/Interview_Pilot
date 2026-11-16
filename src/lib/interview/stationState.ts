import type { HandsOnStage } from "@/lib/schemas/plan";
import type { CodeConfig, StationResult } from "@/lib/schemas/stations";
import { gradeApi } from "@/lib/stations/api/grade";
import { createApi, type ApiResponse, type ApiState } from "@/lib/stations/api/sim";
import { gradeCode } from "@/lib/stations/code/grade";
import { testsOf, type CodeExecutor, type TestOutcome } from "@/lib/stations/code/runner";
import { gradeData } from "@/lib/stations/data/grade";
import { gradeTerminal } from "@/lib/stations/terminal/grade";
import { createTerminal, type TerminalState } from "@/lib/stations/terminal/sim";
import { gradeWritten } from "@/lib/stations/written/grade";

/** Everything a station needs to survive a page reload. All plain JSON. */
export type StationState =
  | { station: "terminal"; term: TerminalState; screen: { kind: "in" | "out"; text: string }[]; answer: string; notes: string }
  | {
      station: "code";
      code: string;
      notes: string;
      /** The scenario after it has been verified by running it (may be the built-in one). */
      prepared: { config: CodeConfig; starterPassed: number; usedFallback: boolean } | null;
      outcomes: TestOutcome[] | null;
    }
  | {
      station: "api";
      api: ApiState;
      exchanges: { method: string; path: string; response: ApiResponse }[];
      draft: { method: string; path: string; headers: string; body: string };
      answer: string;
      notes: string;
    }
  | { station: "data"; answers: string[]; insight: string; notes: string }
  | { station: "written"; text: string; notes: string };

export function initialStationState(stage: HandsOnStage): StationState {
  switch (stage.station) {
    case "terminal":
      return { station: "terminal", term: createTerminal(stage.config), screen: [], answer: "", notes: "" };
    case "code":
      return { station: "code", code: stage.config.starterCode, notes: "", prepared: null, outcomes: null };
    case "api":
      return { station: "api", api: createApi(stage.config), exchanges: [], draft: { method: "GET", path: "/", headers: "", body: "" }, answer: "", notes: "" };
    case "data":
      return { station: "data", answers: stage.config.questions.map(() => ""), insight: "", notes: "" };
    case "written":
      return { station: "written", text: "", notes: "" };
  }
}

/** Grades a station from its current state. The code station runs its tests one last time. */
export async function stationResult(stage: HandsOnStage, state: StationState, execute: CodeExecutor): Promise<StationResult> {
  if (stage.station === "terminal" && state.station === "terminal") return gradeTerminal(stage.config, state.term, state.answer, state.notes);
  if (stage.station === "api" && state.station === "api") return gradeApi(stage.config, state.api, state.answer, state.notes);
  if (stage.station === "data" && state.station === "data") return gradeData(stage.config, state.answers, state.insight, state.notes);
  if (stage.station === "written" && state.station === "written") return gradeWritten(stage.config, state.text, state.notes);
  if (stage.station === "code" && state.station === "code") {
    const config = state.prepared?.config ?? stage.config;
    const outcomes = await execute(state.code, config.functionName, testsOf(config));
    return gradeCode({ config, outcomes, starterPassed: state.prepared?.starterPassed ?? 0, code: state.code, notes: state.notes });
  }
  throw new Error("station state does not match the stage");
}
