import { z } from "zod";
import { LIMITS } from "@/lib/config";
import { findUnsupportedNumbers } from "@/lib/guards/numbers";
import { quoteAppearsIn } from "@/lib/guards/quotes";
import { finalConversationScore, finalStationScore } from "@/lib/stations/score";
import type { Plan, Stage } from "./plan";
import { StationResultSchema, type StationResult } from "./stations";

/* ---------- what the candidate did ---------- */

export const TurnSchema = z.object({
  question: z.string().max(1000),
  answer: z.string().max(LIMITS.answerMaxChars),
});

export const StageRecordSchema = z.object({
  stageId: z.string().regex(/^s\d{1,2}$/),
  /** Conversation stages: the opening question and each follow-up, with answers. */
  turns: z.array(TurnSchema).max(1 + LIMITS.followUpsPerStage),
  /** Hands-on stages: the outcome of the station. */
  station: StationResultSchema.nullable(),
  timedOut: z.boolean(),
});
export type StageRecord = z.infer<typeof StageRecordSchema>;

/* ---------- follow-up ---------- */

export const FollowUpSchema = z.object({
  /** The part of the answer being probed, in a few words. */
  probing: z.string(),
  question: z.string(),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

export function validateFollowUp(followUp: FollowUp, transcriptTexts: string[]): string[] {
  const errors: string[] = [];
  const question = followUp.question.trim();
  if (question.length < 10) errors.push("the follow-up question is empty or too short");
  if (question.length > 500) errors.push("the follow-up question is longer than 500 characters");
  const invented = findUnsupportedNumbers(question, transcriptTexts);
  if (invented.length) errors.push(`the follow-up mentions figures the candidate never gave: ${invented.join(", ")}`);
  return errors;
}

/* ---------- what the model returns for grading ---------- */

export const StageGradeWireSchema = z.object({
  stageId: z.string(),
  score: z.number(),
  verdict: z.string(),
  strong: z.array(z.string()),
  missing: z.array(z.string()),
  /** True only when the candidate openly said they had not done this and then gave a sound approach. */
  honestGapWithSoundApproach: z.boolean(),
});

export const GradeWireSchema = z.object({
  stages: z.array(StageGradeWireSchema),
  overallSummary: z.string(),
  hireSignal: z.enum(["strong_no", "no", "lean_no", "lean_yes", "yes", "strong_yes"]),
  tighterAnswer: z.object({
    /** Empty string when no conversation stage was answered. */
    stageId: z.string(),
    answer: z.string(),
    /** Verbatim phrases from the candidate's own answers that the rewrite relies on. */
    factsUsed: z.array(z.string()),
  }),
});
export type GradeWire = z.infer<typeof GradeWireSchema>;

/* ---------- the debrief shown to the user ---------- */

export const StageGradeSchema = z.object({
  stageId: z.string(),
  title: z.string(),
  kind: z.enum(["conversation", "hands_on"]),
  score: z.number().int().min(0).max(5),
  verdict: z.string().max(400),
  strong: z.array(z.string().max(400)).max(5),
  missing: z.array(z.string().max(400)).max(5),
  answered: z.boolean(),
});
export type StageGrade = z.infer<typeof StageGradeSchema>;

export const DebriefSchema = z.object({
  planId: z.string(),
  gradedAt: z.string(),
  average: z.number().min(0).max(5),
  hireSignal: GradeWireSchema.shape.hireSignal,
  overallSummary: z.string().max(1500),
  stages: z.array(StageGradeSchema),
  tighterAnswer: z
    .object({
      stageId: z.string(),
      question: z.string(),
      answer: z.string().max(3000),
      factsUsed: z.array(z.string().max(400)).max(10),
    })
    .nullable(),
});
export type Debrief = z.infer<typeof DebriefSchema>;

function answered(record: StageRecord | undefined): boolean {
  if (!record) return false;
  if (record.station) return record.station.attempted || record.station.notes.trim().length > 0;
  return record.turns.some((t) => t.answer.trim().length > 0);
}

type StageGradeWire = z.infer<typeof StageGradeWireSchema>;

/** Applies the score rules that are enforced in code and trims the feedback. */
function finaliseGrade(stage: Stage, grade: StageGradeWire, record: StageRecord | undefined): StageGrade {
  const wasAnswered = answered(record);
  const station: StationResult | null = record?.station ?? null;
  const score =
    stage.kind === "hands_on"
      ? finalStationScore({
          baseScore: station?.baseScore ?? 0,
          maxAdjust: station?.maxAdjust ?? 0,
          modelScore: grade.score,
          honestSoundApproach: grade.honestGapWithSoundApproach && (station?.notes.trim().length ?? 0) > 0,
          attempted: station?.attempted ?? false,
        })
      : finalConversationScore({
          modelScore: grade.score,
          honestSoundApproach: grade.honestGapWithSoundApproach,
          answered: wasAnswered,
        });
  const clean = (items: string[]) => items.map((s) => s.trim().slice(0, 400)).filter(Boolean).slice(0, 5);
  return {
    stageId: stage.id,
    title: stage.title,
    kind: stage.kind,
    score,
    verdict: grade.verdict.trim().slice(0, 400),
    strong: clean(grade.strong),
    missing: clean(grade.missing),
    answered: wasAnswered,
  };
}

/**
 * Checks the model's grading against the transcript and applies the scoring
 * rules that must not depend on the model. Returns either a finished debrief
 * or a list of problems (used for the single retry).
 */
export function buildDebrief(
  wire: GradeWire,
  plan: Plan,
  records: StageRecord[],
  now: Date = new Date(),
): { ok: true; debrief: Debrief } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const recordById = new Map(records.map((r) => [r.stageId, r]));
  const stages: StageGrade[] = [];

  for (const stage of plan.stages) {
    const grade = wire.stages.find((g) => g.stageId === stage.id);
    const record = recordById.get(stage.id);
    if (!grade) {
      errors.push(`stage ${stage.id} was not graded`);
      continue;
    }
    if (!Number.isFinite(grade.score) || grade.score < 0 || grade.score > 5) {
      errors.push(`stage ${stage.id} has a score outside 0 to 5`);
      continue;
    }
    stages.push(finaliseGrade(stage, grade, record));
  }
  if (errors.length) return { ok: false, errors };

  // The tighter answer: only for an answered conversation stage, only from the candidate's own facts.
  const candidates = stages.filter((s) => s.kind === "conversation" && s.answered);
  let tighterAnswer: Debrief["tighterAnswer"] = null;
  if (candidates.length > 0) {
    const lowest = Math.min(...candidates.map((s) => s.score));
    const target = candidates.find((s) => s.stageId === wire.tighterAnswer.stageId);
    if (!target) {
      errors.push("tighterAnswer.stageId must be an answered conversation stage");
    } else if (target.score > lowest) {
      errors.push(`tighterAnswer must rewrite the weakest answered conversation stage (one of: ${candidates.filter((s) => s.score === lowest).map((s) => s.stageId).join(", ")})`);
    } else {
      const record = recordById.get(target.stageId)!;
      const said = record.turns.map((t) => t.answer).join("\n");
      const asked = record.turns.map((t) => t.question).join("\n");
      const rewrite = wire.tighterAnswer.answer.trim();
      if (rewrite.length < 40) errors.push("tighterAnswer.answer is empty or too short");
      const invented = findUnsupportedNumbers(rewrite, [said, asked], { minDigits: 2 });
      if (invented.length) errors.push(`tighterAnswer contains figures the candidate never stated: ${invented.join(", ")}`);
      const facts = wire.tighterAnswer.factsUsed.map((f) => f.trim()).filter(Boolean);
      if (facts.length === 0) errors.push("tighterAnswer.factsUsed must quote the candidate's own words");
      for (const fact of facts) {
        if (!quoteAppearsIn(fact, said)) errors.push(`tighterAnswer.factsUsed contains a phrase the candidate did not say: "${fact.slice(0, 80)}"`);
      }
      if (errors.length === 0) {
        const stage = plan.stages.find((s) => s.id === target.stageId)!;
        tighterAnswer = {
          stageId: target.stageId,
          question: stage.kind === "conversation" ? stage.openingQuestion : stage.title,
          answer: rewrite.slice(0, 3000),
          factsUsed: facts.slice(0, 10).map((f) => f.slice(0, 400)),
        };
      }
    }
  }
  if (errors.length) return { ok: false, errors };

  const average = stages.length ? stages.reduce((sum, s) => sum + s.score, 0) / stages.length : 0;
  return {
    ok: true,
    debrief: {
      planId: plan.id,
      gradedAt: now.toISOString(),
      average: Math.round(average * 10) / 10,
      hireSignal: wire.hireSignal,
      overallSummary: wire.overallSummary.trim().slice(0, 1500),
      stages,
      tighterAnswer,
    },
  };
}

/** Prep mode: feedback on one stage, with the same score rules. */
export function buildStageFeedback(
  grade: StageGradeWire,
  plan: Plan,
  record: StageRecord,
): { ok: true; grade: StageGrade } | { ok: false; errors: string[] } {
  const stage = plan.stages.find((s) => s.id === record.stageId);
  if (!stage) return { ok: false, errors: ["unknown stage"] };
  if (!Number.isFinite(grade.score) || grade.score < 0 || grade.score > 5) {
    return { ok: false, errors: ["the score is outside 0 to 5"] };
  }
  return { ok: true, grade: finaliseGrade(stage, grade, record) };
}
