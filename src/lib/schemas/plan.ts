import { z } from "zod";
import {
  INTERVIEW_LENGTHS,
  MODES,
  NON_TECHNICAL_STATIONS,
  STAGE_COUNTS,
  STATION_TYPES,
  type InterviewLength,
  type StationType,
} from "@/lib/config";
import { findUnsupportedNumbers } from "@/lib/guards/numbers";
import { quoteAppearsIn } from "@/lib/guards/quotes";
import {
  ApiConfigSchema,
  CodeConfigSchema,
  DataConfigSchema,
  TerminalConfigSchema,
  WrittenConfigSchema,
} from "./stations";

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);

export const CONVERSATION_CATEGORIES = [
  "opener",
  "resume_deep_dive",
  "role_tool",
  "failure",
  "proactive",
  "behavioural",
  "scenario",
  "motivation",
] as const;

export const RubricSchema = z.object({
  criteria: z.array(text(240)).min(2).max(6),
  strongAnswer: text(600),
  redFlags: z.array(text(240)).max(5),
});
export type Rubric = z.infer<typeof RubricSchema>;

export const SourceSchema = z.object({
  from: z.enum(["resume", "job_description", "both", "none"]),
  /** A short verbatim quote from the resume or posting that the question is built on. */
  quote: z.string().max(300),
  /** Set by the server: whether the quote was found in the source text. */
  verified: z.boolean(),
});

const stageBase = {
  id: z.string().regex(/^s\d{1,2}$/),
  title: text(100),
  intent: text(500),
  rubric: RubricSchema,
  /** Time budget in seconds, set by the server. */
  seconds: z.number().int().min(30).max(3600),
};

export const ConversationStageSchema = z.object({
  ...stageBase,
  kind: z.literal("conversation"),
  category: z.enum(CONVERSATION_CATEGORIES),
  openingQuestion: text(700),
  source: SourceSchema,
});
export type ConversationStage = z.infer<typeof ConversationStageSchema>;

const handsOnBase = { ...stageBase, kind: z.literal("hands_on"), brief: text(500) };

export const HandsOnStageSchema = z.discriminatedUnion("station", [
  z.object({ ...handsOnBase, station: z.literal("terminal"), config: TerminalConfigSchema }),
  z.object({ ...handsOnBase, station: z.literal("code"), config: CodeConfigSchema }),
  z.object({ ...handsOnBase, station: z.literal("api"), config: ApiConfigSchema }),
  z.object({ ...handsOnBase, station: z.literal("data"), config: DataConfigSchema }),
  z.object({ ...handsOnBase, station: z.literal("written"), config: WrittenConfigSchema }),
]);
export type HandsOnStage = z.infer<typeof HandsOnStageSchema>;

export const StageSchema = z.union([ConversationStageSchema, HandsOnStageSchema]);
export type Stage = z.infer<typeof StageSchema>;

export const RoleSchema = z.object({
  title: text(120),
  company: z.string().max(120),
  seniority: text(60),
  technical: z.boolean(),
});

export const PlanSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{16,64}$/),
  version: z.literal(1),
  createdAt: z.string(),
  role: RoleSchema,
  interviewerTitle: z.string().max(120),
  lengthMinutes: z.union(INTERVIEW_LENGTHS.map((n) => z.literal(n)) as [z.ZodLiteral<20>, z.ZodLiteral<30>, z.ZodLiteral<45>, z.ZodLiteral<60>]),
  doNotClaim: z.string().max(1500),
  stages: z.array(StageSchema).min(4).max(14),
});
export type Plan = z.infer<typeof PlanSchema>;

export const ModeSchema = z.enum(MODES);

/* ---------- what the model returns for the outline ---------- */

/**
 * The outline is deliberately flat: one object shape for every stage, with
 * enums instead of unions. Station details are generated in separate calls.
 */
export const OutlineStageSchema = z.object({
  kind: z.enum(["conversation", "hands_on"]),
  title: z.string(),
  /** Conversation stages only. Use "opener" for hands-on stages. */
  category: z.enum(CONVERSATION_CATEGORIES),
  /** Hands-on stages only. Use "none" for conversation stages. */
  station: z.enum([...STATION_TYPES, "none"]),
  /** Conversation: the opening question. Hands-on: a one or two sentence description of the exercise. */
  openingQuestion: z.string(),
  intent: z.string(),
  rubric: z.object({
    criteria: z.array(z.string()),
    strongAnswer: z.string(),
    redFlags: z.array(z.string()),
  }),
  sourceFrom: z.enum(["resume", "job_description", "both", "none"]),
  sourceQuote: z.string(),
});

export const OutlineSchema = z.object({
  role: z.object({
    title: z.string(),
    company: z.string(),
    seniority: z.string(),
    technical: z.boolean(),
  }),
  stages: z.array(OutlineStageSchema),
});
export type Outline = z.infer<typeof OutlineSchema>;
export type OutlineStage = z.infer<typeof OutlineStageSchema>;

/* ---------- outline validation ---------- */

export interface OutlineContext {
  lengthMinutes: InterviewLength;
  resumeText: string;
  jobText: string;
  codingEvidence: boolean;
}

export function allowedStations(technical: boolean, codingEvidence: boolean): StationType[] {
  if (!technical) return [...NON_TECHNICAL_STATIONS];
  return STATION_TYPES.filter((station) => station !== "code" || codingEvidence);
}

/**
 * Rules the outline must satisfy beyond its shape. Returns human-readable
 * problems; these are sent back to the model on the single retry.
 */
export function validateOutline(outline: Outline, context: OutlineContext): string[] {
  const errors: string[] = [];
  const counts = STAGE_COUNTS[context.lengthMinutes];
  const conversation = outline.stages.filter((s) => s.kind === "conversation");
  const handsOn = outline.stages.filter((s) => s.kind === "hands_on");

  if (Math.abs(conversation.length - counts.conversation) > 1) {
    errors.push(`expected about ${counts.conversation} conversation stages, got ${conversation.length}`);
  }
  if (handsOn.length < Math.max(1, counts.handsOn - 1) || handsOn.length > counts.handsOn + 1) {
    errors.push(`expected about ${counts.handsOn} hands-on stages, got ${handsOn.length}`);
  }
  if (outline.stages[0]?.kind !== "conversation") errors.push("the first stage must be a conversation stage");
  if (!conversation.some((s) => s.category === "failure")) errors.push("there must be at least one failure question (category failure)");
  if (!conversation.some((s) => s.category === "proactive")) errors.push("there must be at least one proactive question (category proactive)");

  const allowed = allowedStations(outline.role.technical, context.codingEvidence);
  for (const stage of handsOn) {
    if (stage.station === "none") errors.push(`hands-on stage "${stage.title}" has no station type`);
    else if (!allowed.includes(stage.station)) {
      errors.push(
        stage.station === "code" && !context.codingEvidence
          ? `hands-on stage "${stage.title}" uses the code station, but the resume shows no coding experience`
          : `hands-on stage "${stage.title}" uses station "${stage.station}", which is not allowed for this role (allowed: ${allowed.join(", ")})`,
      );
    }
  }

  const sources = [context.resumeText, context.jobText];
  outline.stages.forEach((stage, index) => {
    const label = `stage ${index + 1}`;
    if (!stage.title.trim() || !stage.openingQuestion.trim() || !stage.intent.trim()) errors.push(`${label} has an empty title, question or intent`);
    if (stage.rubric.criteria.filter((c) => c.trim()).length < 2) errors.push(`${label} needs at least two rubric criteria`);
    if (!stage.rubric.strongAnswer.trim()) errors.push(`${label} has no description of a strong answer`);
    const invented = findUnsupportedNumbers(stage.openingQuestion, sources);
    if (invented.length) {
      errors.push(`${label} mentions figures that are in neither the resume nor the job description: ${invented.join(", ")}`);
    }
  });

  const grounded = conversation.filter((s) => s.sourceFrom !== "none" && s.sourceQuote.trim()).length;
  if (grounded < Math.ceil(conversation.length * 0.6)) {
    errors.push("most conversation questions must be tied to a specific resume line or job description requirement, with a quote");
  }
  return errors;
}

/** Whether a quote the model attributes to the resume or posting really appears there. */
export function verifySource(stage: OutlineStage, context: Pick<OutlineContext, "resumeText" | "jobText">): boolean {
  if (stage.sourceFrom === "none" || !stage.sourceQuote.trim()) return false;
  const inResume = quoteAppearsIn(stage.sourceQuote, context.resumeText);
  const inJob = quoteAppearsIn(stage.sourceQuote, context.jobText);
  if (stage.sourceFrom === "resume") return inResume;
  if (stage.sourceFrom === "job_description") return inJob;
  return inResume || inJob;
}

/** Splits the interview length across stages. Hands-on stages get more time. */
export function allocateSeconds(kinds: ("conversation" | "hands_on")[], lengthMinutes: number): number[] {
  const weights = kinds.map((kind) => (kind === "hands_on" ? 1.6 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.max(60, Math.round(((w / total) * lengthMinutes * 60) / 15) * 15));
}
