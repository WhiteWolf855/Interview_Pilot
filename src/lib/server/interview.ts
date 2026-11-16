import "server-only";
import { newNonce } from "@/lib/guards/untrusted";
import {
  FollowUpSchema,
  GradeWireSchema,
  StageGradeWireSchema,
  buildDebrief,
  buildStageFeedback,
  validateFollowUp,
  type Debrief,
  type StageGrade,
  type StageRecord,
} from "@/lib/schemas/debrief";
import type { ConversationStage, Plan } from "@/lib/schemas/plan";
import { followUpPrompt, gradePrompt, stageFeedbackPrompt } from "./ai/prompts";
import { generateValidated } from "./ai/provider";
import { serverEnv } from "./env";

export async function generateFollowUp(input: {
  roleTitle: string;
  interviewerTitle: string;
  doNotClaim: string;
  stage: ConversationStage;
  turns: { question: string; answer: string }[];
  followUpNumber: number;
}): Promise<{ question: string; probing: string }> {
  const transcript = input.turns.flatMap((t) => [t.question, t.answer]);
  return generateValidated(
    {
      purpose: "followup",
      tier: "fast",
      ...followUpPrompt({ nonce: newNonce(), ...input }),
      schema: FollowUpSchema,
      maxTokens: 2_000,
      effort: serverEnv().effortFollowUp,
      mock: { lastAnswer: input.turns[input.turns.length - 1]?.answer ?? "", followUpNumber: input.followUpNumber },
    },
    (data) => {
      const followUp = data as { question: string; probing: string };
      const errors = validateFollowUp(followUp, transcript);
      return errors.length
        ? { ok: false, errors }
        : { ok: true, value: { question: followUp.question.trim(), probing: followUp.probing.trim().slice(0, 120) } };
    },
  );
}

export async function gradeInterview(plan: Plan, records: StageRecord[]): Promise<Debrief> {
  return generateValidated(
    {
      purpose: "grade",
      tier: "strong",
      ...gradePrompt({ nonce: newNonce(), plan, records }),
      schema: GradeWireSchema,
      maxTokens: 16_000,
      effort: serverEnv().effortGrade,
      mock: { plan, records },
    },
    (data) => {
      const built = buildDebrief(data as never, plan, records);
      return built.ok ? { ok: true, value: built.debrief } : { ok: false, errors: built.errors };
    },
  );
}

export async function gradeStage(plan: Plan, record: StageRecord): Promise<StageGrade> {
  const stage = plan.stages.find((s) => s.id === record.stageId)!;
  return generateValidated(
    {
      purpose: "stage_feedback",
      tier: "strong",
      ...stageFeedbackPrompt({ nonce: newNonce(), plan, stage, record }),
      schema: StageGradeWireSchema,
      maxTokens: 6_000,
      effort: serverEnv().effortGrade,
      mock: { stage, record },
    },
    (data) => {
      const built = buildStageFeedback(data as never, plan, record);
      return built.ok ? { ok: true, value: built.grade } : { ok: false, errors: built.errors };
    },
  );
}
