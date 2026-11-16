import "server-only";
import type { InterviewLength, StationType } from "@/lib/config";
import { hasCodingEvidence } from "@/lib/guards/coding";
import { newNonce } from "@/lib/guards/untrusted";
import {
  ConversationStageSchema,
  OutlineSchema,
  PlanSchema,
  allocateSeconds,
  validateOutline,
  verifySource,
  type HandsOnStage,
  type Outline,
  type OutlineStage,
  type Plan,
  type Stage,
} from "@/lib/schemas/plan";
import { STATION_CONFIG_SCHEMAS } from "@/lib/schemas/stations";
import { STATION_WIRE } from "@/lib/schemas/wire";
import { validateApiConfig } from "@/lib/stations/api/grade";
import { validateCodeConfig } from "@/lib/stations/code/grade";
import { validateDataConfig } from "@/lib/stations/data/grade";
import { LIBRARY } from "@/lib/stations/library";
import { validateTerminalConfig } from "@/lib/stations/terminal/grade";
import { validateWrittenConfig } from "@/lib/stations/written/grade";
import { outlinePrompt, stationPrompt } from "./ai/prompts";
import { generateValidated, type Validation } from "./ai/provider";
import { serverEnv } from "./env";
import { ApiError } from "./http";
import { newPlanId } from "./token";

export interface PlanInput {
  resumeText: string;
  jobText: string;
  interviewerTitle: string;
  doNotClaim: string;
  lengthMinutes: InterviewLength;
}

/** Shape and scenario checks for one generated station. */
export function validateStationConfig(station: StationType, data: unknown): Validation<HandsOnStage["config"]> {
  const candidate = station === "code" ? { ...(data as object), language: "javascript" } : data;
  const parsed = STATION_CONFIG_SCHEMAS[station].safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "config"}: ${i.message}`) };
  }
  const config = parsed.data;
  let errors: string[];
  switch (station) {
    case "terminal":
      errors = validateTerminalConfig(config as never);
      break;
    case "code":
      errors = validateCodeConfig(config as never);
      break;
    case "api":
      errors = validateApiConfig(config as never);
      break;
    case "data":
      errors = validateDataConfig(config as never);
      break;
    case "written":
      errors = validateWrittenConfig(config as never);
      break;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: config };
}

function firstSentence(text: string): string {
  const line = text.split(/\n|(?<=[.!?])\s/).map((l) => l.trim()).find((l) => l.length >= 20 && l.length <= 160);
  return line ?? text.slice(0, 80).trim();
}

function conversationStage(stage: OutlineStage, id: string, seconds: number, verified: boolean) {
  return {
    id,
    kind: "conversation" as const,
    title: stage.title,
    category: stage.category,
    openingQuestion: stage.openingQuestion,
    intent: stage.intent,
    rubric: { ...stage.rubric, redFlags: stage.rubric.redFlags.slice(0, 5) },
    source: { from: stage.sourceFrom, quote: verified ? stage.sourceQuote.slice(0, 300) : "", verified },
    seconds,
  };
}

async function buildStation(
  stage: OutlineStage,
  id: string,
  seconds: number,
  outline: Outline,
  input: PlanInput,
): Promise<{ stage: HandsOnStage; usedFallback: boolean }> {
  const station = stage.station as StationType;
  const env = serverEnv();
  const nonce = newNonce();
  try {
    const config = await generateValidated(
      {
        purpose: "station",
        tier: "strong",
        ...stationPrompt({
          nonce,
          station,
          roleTitle: outline.role.title,
          seniority: outline.role.seniority,
          jobText: input.jobText,
          title: stage.title,
          description: stage.openingQuestion,
          intent: stage.intent,
        }),
        schema: STATION_WIRE[station],
        maxTokens: 12_000,
        effort: env.effortPlan,
        mock: { station },
      },
      (data) => validateStationConfig(station, data),
    );
    const built = {
      id,
      kind: "hands_on",
      station,
      title: stage.title.slice(0, 100),
      brief: stage.openingQuestion.slice(0, 500),
      intent: stage.intent.slice(0, 500),
      rubric: { ...stage.rubric, redFlags: stage.rubric.redFlags.slice(0, 5) },
      seconds,
      config,
    } as HandsOnStage;
    return { stage: built, usedFallback: false };
  } catch (error) {
    // A station that fails its checks twice is replaced by the built-in scenario of the same type.
    if (!(error instanceof ApiError) || error.code !== "ai_invalid") throw error;
    const item = LIBRARY[station];
    const built = { id, kind: "hands_on", station, title: item.title, brief: item.brief, intent: item.intent, rubric: item.rubric, seconds, config: item.config } as HandsOnStage;
    return { stage: built, usedFallback: true };
  }
}

export async function generatePlan(input: PlanInput): Promise<{ plan: Plan; fallbackStations: number }> {
  const env = serverEnv();
  const codingEvidence = hasCodingEvidence(input.resumeText);
  const context = { lengthMinutes: input.lengthMinutes, resumeText: input.resumeText, jobText: input.jobText, codingEvidence };
  const nonce = newNonce();

  const outline = await generateValidated<Outline>(
    {
      purpose: "outline",
      tier: "strong",
      ...outlinePrompt({ nonce, ...input, codingEvidence }),
      schema: OutlineSchema,
      maxTokens: 16_000,
      effort: env.effortPlan,
      mock: {
        lengthMinutes: input.lengthMinutes,
        codingEvidence,
        technical: /\b(engineer|developer|devops|sre|kubernetes|backend|frontend|infrastructure|programmer|sysadmin)\b/i.test(input.jobText),
        resumeQuote: firstSentence(input.resumeText),
        jobQuote: firstSentence(input.jobText),
        roleTitle: firstSentence(input.jobText).slice(0, 60),
      },
    },
    (data) => {
      const candidate = data as Outline;
      const errors = validateOutline(candidate, context);
      candidate.stages.forEach((stage, index) => {
        if (stage.kind !== "conversation") return;
        const shaped = ConversationStageSchema.safeParse(conversationStage(stage, `s${index + 1}`, 60, false));
        if (!shaped.success) {
          errors.push(...shaped.error.issues.slice(0, 3).map((i) => `stage ${index + 1} ${i.path.join(".")}: ${i.message}`));
        }
      });
      return errors.length ? { ok: false, errors } : { ok: true, value: candidate };
    },
  );

  const seconds = allocateSeconds(outline.stages.map((s) => s.kind), input.lengthMinutes);
  let fallbackStations = 0;
  const stages: Stage[] = await Promise.all(
    outline.stages.map(async (stage, index): Promise<Stage> => {
      const id = `s${index + 1}`;
      if (stage.kind === "conversation") return conversationStage(stage, id, seconds[index]!, verifySource(stage, context));
      const built = await buildStation(stage, id, seconds[index]!, outline, input);
      if (built.usedFallback) fallbackStations++;
      return built.stage;
    }),
  );

  const plan = PlanSchema.safeParse({
    id: newPlanId(),
    version: 1,
    createdAt: new Date().toISOString(),
    role: {
      title: outline.role.title.trim().slice(0, 120) || "This role",
      company: outline.role.company.trim().slice(0, 120),
      seniority: outline.role.seniority.trim().slice(0, 60) || "Not stated",
      technical: outline.role.technical,
    },
    interviewerTitle: input.interviewerTitle,
    lengthMinutes: input.lengthMinutes,
    doNotClaim: input.doNotClaim,
    stages,
  });
  if (!plan.success) throw new ApiError("ai_invalid", "The interviewer produced a plan we could not use. Please try again.");
  return { plan: plan.data, fallbackStations };
}
