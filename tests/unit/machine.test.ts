import { beforeAll, describe, expect, it } from "vitest";
import type { InterviewMode } from "@/lib/config";
import {
  advance, beginStage, completeStation, createSession, currentStage, endConversationEarly, expireConversation, formatClock,
  isExpired, receiveFollowUp, rerun, setDraft, stageRemainingMs, submitAnswer, totalRemainingMs, type Session,
} from "@/lib/interview/machine";
import { initialStationState, stationResult } from "@/lib/interview/stationState";
import { debriefToMarkdown, exportFileName } from "@/lib/interview/export";
import type { Plan } from "@/lib/schemas/plan";
import { setAiProvider } from "@/lib/server/ai/provider";
import { gradeInterview } from "@/lib/server/interview";
import { generatePlan } from "@/lib/server/plan";
import { runCommand } from "@/lib/stations/terminal/sim";
import { recordingProvider } from "../helpers/ai";
import { JOB_TEXT, RESUME_TEXT } from "../helpers/fixtures";
import { nodeExecutor } from "../helpers/node-executor";

let plan: Plan;
const T0 = 1_750_000_000_000;

beforeAll(async () => {
  setAiProvider(recordingProvider().provider);
  plan = (await generatePlan({ resumeText: RESUME_TEXT, jobText: JOB_TEXT, interviewerTitle: "", doNotClaim: "", lengthMinutes: 45 })).plan;
});

const start = (mode: InterviewMode = "timed") => beginStage(createSession(plan, "token", mode, T0), T0, null);

/** Answers the current conversation stage through both follow-ups. */
function answerFully(session: Session, now = T0): Session {
  let outcome = submitAnswer(session, "First answer.", now);
  expect(outcome.next).toBe("follow_up");
  outcome = submitAnswer(receiveFollowUp(outcome.session, "Follow-up one?", now), "Second answer.", now);
  expect(outcome.next).toBe("follow_up");
  outcome = submitAnswer(receiveFollowUp(outcome.session, "Follow-up two?", now), "Third answer.", now);
  expect(outcome.next).toBe("stage_complete");
  return outcome.session;
}

describe("interview state machine", () => {
  it("starts on the first stage with its opening question", () => {
    const session = start();
    expect(session.phase).toBe("active");
    expect(session.index).toBe(0);
    const stage = plan.stages[0]!;
    expect(session.current!.question).toBe(stage.kind === "conversation" ? stage.openingQuestion : "");
    expect(session.current!.deadline).toBe(T0 + stage.seconds * 1000);
  });

  it("asks exactly two follow-ups, then closes the stage and moves on", () => {
    const session = answerFully(start());
    expect(session.records).toHaveLength(1);
    expect(session.records[0]!.turns.map((t) => t.question)).toEqual([
      (plan.stages[0] as { openingQuestion: string }).openingQuestion, "Follow-up one?", "Follow-up two?",
    ]);
    expect(session.records[0]!.turns.map((t) => t.answer)).toEqual(["First answer.", "Second answer.", "Third answer."]);
    expect(session.index).toBe(1);
    expect(session.phase).toBe("ready");
  });

  it("skips follow-ups after an empty answer", () => {
    const outcome = submitAnswer(start(), "   ", T0);
    expect(outcome.next).toBe("stage_complete");
    expect(outcome.session.records[0]!.turns).toEqual([{ question: expect.any(String), answer: "" }]);
  });

  it("can close a stage early when a follow-up cannot be fetched", () => {
    const waiting = submitAnswer(start(), "An answer.", T0).session;
    const closed = endConversationEarly(waiting);
    expect(closed.records[0]!.turns).toHaveLength(1);
    expect(closed.index).toBe(1);
  });

  it("runs every stage in the fixed order and finishes", () => {
    let session = createSession(plan, "token", "untimed", T0);
    const visited: string[] = [];
    while (session.phase !== "finished") {
      const stage = currentStage(session)!;
      visited.push(stage.id);
      session = beginStage(session, T0, stage.kind === "hands_on" ? initialStationState(stage) : null);
      session = stage.kind === "conversation"
        ? answerFully(session)
        : completeStation(session, { station: stage.station, checks: [], baseScore: 0, maxAdjust: 1, summary: "", notes: "", attempted: false });
    }
    expect(visited).toEqual(plan.stages.map((s) => s.id));
    expect(session.records.map((r) => r.stageId)).toEqual(visited);
    expect(session.current).toBeNull();
    expect(advance(session).index).toBe(plan.stages.length);
  });

  it("never moves backwards and never records a stage twice", () => {
    const done = answerFully(start());
    expect(submitAnswer(done, "late answer", T0).session).toBe(done);
    expect(expireConversation(done)).toBe(done);
    let session = done;
    for (let i = 0; i < 30; i++) {
      const before = session.index;
      session = advance(session);
      expect(session.index).toBeGreaterThanOrEqual(before);
    }
    expect(session.phase).toBe("finished");
    expect(session.records).toHaveLength(1);
  });

  it("auto-advances when time runs out, keeping what was typed", () => {
    const stage = plan.stages[0]!;
    let session = setDraft(start(), "Half an answer when the clock ran");
    const justBefore = T0 + stage.seconds * 1000 - 1;
    expect(isExpired(session, justBefore)).toBe(false);
    expect(isExpired(session, justBefore + 1)).toBe(true);
    session = expireConversation(session);
    expect(session.records[0]).toMatchObject({ timedOut: true, turns: [{ answer: "Half an answer when the clock ran" }] });
    expect(session.index).toBe(1);
  });

  it("keeps earlier turns when time runs out during a follow-up", () => {
    let session = submitAnswer(start(), "First answer.", T0).session;
    session = setDraft(receiveFollowUp(session, "Follow-up one?", T0), "partial");
    session = expireConversation(session);
    expect(session.records[0]!.turns).toEqual([
      { question: expect.any(String), answer: "First answer." },
      { question: "Follow-up one?", answer: "partial" },
    ]);
  });

  it("pauses the clock while the interviewer is thinking, and gives that time back", () => {
    const stage = plan.stages[0]!;
    const budget = stage.seconds * 1000;
    const waiting = submitAnswer(start(), "An answer.", T0 + 10_000).session;
    expect(stageRemainingMs(waiting, T0 + 10_000)).toBe(budget - 10_000);
    expect(stageRemainingMs(waiting, T0 + 25_000)).toBe(budget - 10_000);
    expect(isExpired(waiting, T0 + budget + 60_000)).toBe(false);
    const resumed = receiveFollowUp(waiting, "Follow-up?", T0 + 25_000);
    expect(stageRemainingMs(resumed, T0 + 25_000)).toBe(budget - 10_000);
    expect(stageRemainingMs(resumed, T0 + 26_000)).toBe(budget - 11_000);
  });

  it("computes the clock from a stored deadline, so a reload does not reset it", () => {
    const reloaded = JSON.parse(JSON.stringify(start())) as Session;
    const stage = plan.stages[0]!;
    expect(stageRemainingMs(reloaded, T0 + 30_000)).toBe(stage.seconds * 1000 - 30_000);
    expect(totalRemainingMs(reloaded, T0)).toBe(plan.stages.reduce((sum, s) => sum + s.seconds * 1000, 0));
  });

  it("has no clock in untimed and prep modes", () => {
    for (const mode of ["untimed", "prep"] as const) {
      const session = start(mode);
      expect(session.current!.deadline).toBeNull();
      expect(stageRemainingMs(session, T0 + 10 ** 9)).toBeNull();
      expect(totalRemainingMs(session, T0)).toBeNull();
      expect(isExpired(session, T0 + 10 ** 9)).toBe(false);
    }
  });

  it("stops on a feedback screen after each stage in prep mode", () => {
    const session = answerFully(start("prep"));
    expect(session.phase).toBe("feedback");
    expect(session.index).toBe(0);
    expect(advance(session)).toMatchObject({ phase: "ready", index: 1 });
  });

  it("reruns the same plan from the start with a clean record", () => {
    const again = rerun(answerFully(start()), "untimed", T0 + 5);
    expect(again).toMatchObject({ index: 0, phase: "ready", records: [], debrief: null, mode: "untimed" });
    expect(again.plan).toBe(plan);
  });

  it("formats the clock", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(59_001)).toBe("1:00");
    expect(formatClock(61_000)).toBe("1:01");
    expect(formatClock(600_000)).toBe("10:00");
  });
});

describe("station state and export", () => {
  it("grades each station type from its saved state", async () => {
    for (const stage of plan.stages) {
      if (stage.kind !== "hands_on") continue;
      const fresh = initialStationState(stage);
      const roundTripped = JSON.parse(JSON.stringify(fresh)) as typeof fresh;
      const untouched = await stationResult(stage, roundTripped, nodeExecutor);
      expect(untouched).toMatchObject({ station: stage.station, attempted: false, baseScore: 0 });
    }
    const terminal = plan.stages.find((s) => s.kind === "hands_on" && s.station === "terminal")!;
    if (terminal.kind !== "hands_on" || terminal.station !== "terminal") throw new Error("no terminal stage");
    const state = initialStationState(terminal);
    if (state.station !== "terminal") throw new Error("wrong state");
    for (const command of terminal.config.solution.commands) state.term = runCommand(state.term, command).state;
    state.answer = terminal.config.solution.answer;
    expect((await stationResult(terminal, JSON.parse(JSON.stringify(state)), nodeExecutor)).baseScore).toBe(5);
  });

  it("exports a debrief as Markdown with scores, feedback and the tighter answer", async () => {
    const records = plan.stages.map((stage) =>
      stage.kind === "conversation"
        ? { stageId: stage.id, turns: [{ question: stage.openingQuestion, answer: "I rewrote the triage runbook and trained the team." }], station: null, timedOut: false }
        : { stageId: stage.id, turns: [], station: { station: stage.station, checks: [{ label: "A check", passed: true }], baseScore: 5, maxAdjust: 1, summary: "x", notes: "", attempted: true }, timedOut: false },
    );
    const debrief = await gradeInterview(plan, records);
    const saved = {
      id: "x", savedAt: debrief.gradedAt, roleTitle: "Senior Support Engineer", company: "Harbor Systems", mode: "timed", debrief,
      stages: plan.stages.map((s) => ({ id: s.id, title: s.title, question: s.kind === "conversation" ? s.openingQuestion : s.brief })), records,
    };
    const markdown = debriefToMarkdown(saved);
    expect(markdown).toContain("# Interview debrief: Senior Support Engineer at Harbor Systems");
    expect(markdown).toContain("out of 5");
    expect(markdown).toContain("What was missing:");
    expect(markdown).toContain("- Passed: A check");
    expect(markdown).toContain("A tighter version of your weakest answer");
    expect(markdown).toContain("A: I rewrote the triage runbook and trained the team.");
    for (const stage of plan.stages) expect(markdown).toContain(`### ${stage.title}: `);
    expect(exportFileName(saved)).toMatch(/^interview-pilot-debrief-senior-support-engineer-\d{4}-\d{2}-\d{2}\.md$/);
  });
});
