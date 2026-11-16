import { LIMITS, type InterviewMode } from "@/lib/config";
import type { Debrief, StageGrade, StageRecord } from "@/lib/schemas/debrief";
import type { Plan, Stage } from "@/lib/schemas/plan";
import type { StationResult } from "@/lib/schemas/stations";
import type { StationState } from "./stationState";

/**
 * The interview as a state machine. Every function is pure: it takes a session
 * and returns a new one. Stages run in a fixed order and there is no function
 * that moves backwards.
 */

export type Phase = "ready" | "active" | "feedback" | "finished";

export interface CurrentStage {
  stageId: string;
  /** When this stage's time runs out, in epoch milliseconds. Null when untimed. */
  deadline: number | null;
  /** Completed question and answer pairs. */
  turns: { question: string; answer: string }[];
  /** The question waiting for an answer. */
  question: string;
  /** What the candidate has typed so far. */
  draft: string;
  /** Set while waiting for the interviewer's follow-up. The clock is paused. */
  waitingSince: number | null;
  stationState: StationState | null;
}

export interface Session {
  version: 1;
  plan: Plan;
  token: string;
  mode: InterviewMode;
  startedAt: string;
  phase: Phase;
  index: number;
  current: CurrentStage | null;
  records: StageRecord[];
  /** Prep mode: feedback already given, by stage id. */
  feedback: Record<string, StageGrade>;
  debrief: Debrief | null;
}

export function createSession(plan: Plan, token: string, mode: InterviewMode, now: number): Session {
  return { version: 1, plan, token, mode, startedAt: new Date(now).toISOString(), phase: "ready", index: 0, current: null, records: [], feedback: {}, debrief: null };
}

export function currentStage(session: Session): Stage | null {
  return session.plan.stages[session.index] ?? null;
}

/** Starts the stage at the current index and, in timed mode, its clock. */
export function beginStage(session: Session, now: number, stationState: StationState | null): Session {
  const stage = currentStage(session);
  if (!stage) return { ...session, phase: "finished", current: null };
  return {
    ...session,
    phase: "active",
    current: {
      stageId: stage.id,
      deadline: session.mode === "timed" ? now + stage.seconds * 1000 : null,
      turns: [],
      question: stage.kind === "conversation" ? stage.openingQuestion : "",
      draft: "",
      waitingSince: null,
      stationState,
    },
  };
}

export function setDraft(session: Session, draft: string): Session {
  if (!session.current) return session;
  return { ...session, current: { ...session.current, draft: draft.slice(0, LIMITS.answerMaxChars) } };
}

export function setStationState(session: Session, stationState: StationState): Session {
  if (!session.current) return session;
  return { ...session, current: { ...session.current, stationState } };
}

export type AnswerOutcome = { session: Session; next: "follow_up" | "stage_complete" };

/**
 * Records the answer to the current question. A non-empty answer earns a
 * follow-up until two have been asked; then the stage is complete.
 */
export function submitAnswer(session: Session, answer: string, now: number): AnswerOutcome {
  const current = session.current;
  if (!current || session.phase !== "active") return { session, next: "stage_complete" };
  const turns = [...current.turns, { question: current.question, answer: answer.trim().slice(0, LIMITS.answerMaxChars) }];
  const followUpsAsked = turns.length - 1;
  if (answer.trim() && followUpsAsked < LIMITS.followUpsPerStage) {
    return { session: { ...session, current: { ...current, turns, draft: "", question: "", waitingSince: now } }, next: "follow_up" };
  }
  return { session: completeStage({ ...session, current: { ...current, turns, draft: "" } }, { timedOut: false }), next: "stage_complete" };
}

/** The interviewer's follow-up has arrived. Time spent waiting is given back. */
export function receiveFollowUp(session: Session, question: string, now: number): Session {
  const current = session.current;
  if (!current || current.waitingSince === null) return session;
  const waited = Math.max(0, now - current.waitingSince);
  return {
    ...session,
    current: { ...current, question, waitingSince: null, deadline: current.deadline === null ? null : current.deadline + waited },
  };
}

/** Ends the stage with what has been said so far, for example when a follow-up cannot be fetched. */
export function endConversationEarly(session: Session): Session {
  return completeStage(session, { timedOut: false });
}

export function completeStation(session: Session, result: StationResult, timedOut = false): Session {
  return completeStage(session, { timedOut, station: result });
}

/** Time is up: whatever has been typed is kept and the stage closes. */
export function expireConversation(session: Session): Session {
  const current = session.current;
  if (!current) return session;
  const turns = current.question ? [...current.turns, { question: current.question, answer: current.draft.trim() }] : current.turns;
  return completeStage({ ...session, current: { ...current, turns, draft: "" } }, { timedOut: true });
}

function completeStage(session: Session, options: { timedOut: boolean; station?: StationResult }): Session {
  const current = session.current;
  if (!current) return session;
  if (session.records.some((r) => r.stageId === current.stageId)) return session;
  const record: StageRecord = {
    stageId: current.stageId,
    turns: options.station ? [] : current.turns.slice(0, 1 + LIMITS.followUpsPerStage),
    station: options.station ?? null,
    timedOut: options.timedOut,
  };
  const withRecord = { ...session, records: [...session.records, record], current: null };
  // Prep mode pauses on a feedback screen. The other modes move straight on.
  return session.mode === "prep" ? { ...withRecord, phase: "feedback" } : advance(withRecord);
}

export function setFeedback(session: Session, grade: StageGrade): Session {
  return { ...session, feedback: { ...session.feedback, [grade.stageId]: grade } };
}

/** Moves to the next stage. The index only ever increases. */
export function advance(session: Session): Session {
  const index = session.index + 1;
  if (index >= session.plan.stages.length) return { ...session, index: session.plan.stages.length, phase: "finished", current: null };
  return { ...session, index, phase: "ready", current: null };
}

export function setDebrief(session: Session, debrief: Debrief): Session {
  return { ...session, debrief };
}

/** A fresh attempt at the same plan. */
export function rerun(session: Session, mode: InterviewMode, now: number): Session {
  return createSession(session.plan, session.token, mode, now);
}

/* ---------- clock ---------- */

/** Milliseconds left on the current stage. Null when there is no clock. Frozen while waiting for the interviewer. */
export function stageRemainingMs(session: Session, now: number): number | null {
  const current = session.current;
  if (!current || current.deadline === null) return null;
  return Math.max(0, current.deadline - (current.waitingSince ?? now));
}

/** Milliseconds left in the whole interview: this stage plus the budgets of the stages still to come. */
export function totalRemainingMs(session: Session, now: number): number | null {
  if (session.mode !== "timed") return null;
  const upcomingFrom = session.phase === "active" || session.phase === "feedback" ? session.index + 1 : session.index;
  const upcoming = session.plan.stages.slice(upcomingFrom).reduce((sum, stage) => sum + stage.seconds * 1000, 0);
  return (stageRemainingMs(session, now) ?? 0) + upcoming;
}

export function isExpired(session: Session, now: number): boolean {
  return session.phase === "active" && stageRemainingMs(session, now) === 0;
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
