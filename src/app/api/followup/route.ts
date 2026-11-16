import { z } from "zod";
import { LIMITS } from "@/lib/config";
import { sanitizeText } from "@/lib/guards/untrusted";
import { TurnSchema } from "@/lib/schemas/debrief";
import { ConversationStageSchema, PlanSchema } from "@/lib/schemas/plan";
import { serverEnv } from "@/lib/server/env";
import { handle } from "@/lib/server/handler";
import { ApiError, clientIp, json, preflight, readJson } from "@/lib/server/http";
import { generateFollowUp } from "@/lib/server/interview";
import { WEEK, applyLimits } from "@/lib/server/ratelimit";
import { hashClient, metaFingerprint, stageMatchesToken, verifyToken } from "@/lib/server/token";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  token: z.string().max(4000),
  meta: PlanSchema.pick({ role: true, interviewerTitle: true, doNotClaim: true, lengthMinutes: true }),
  stage: ConversationStageSchema,
  turns: z.array(TurnSchema).min(1).max(LIMITS.followUpsPerStage),
});

export function OPTIONS(request: Request) {
  return preflight(request);
}

export function POST(request: Request) {
  return handle(request, "followup", async () => {
    const env = serverEnv();
    const parsed = BodySchema.safeParse(await readJson(request, 60_000));
    if (!parsed.success) throw new ApiError("bad_request", "That answer could not be sent. It may be too long.");
    const { token, meta, stage, turns } = parsed.data;

    const payload = verifyToken(token);
    if (!payload || payload.meta !== metaFingerprint(meta) || !stageMatchesToken(payload, stage)) {
      throw new ApiError("unauthorized", "This interview session is no longer valid. Start a new interview.");
    }
    if (turns[0]!.question !== stage.openingQuestion) throw new ApiError("bad_request", "That answer does not belong to this question.");

    const client = hashClient(clientIp(request));
    const limits = await applyLimits([
      { key: `rl:fu:min:${client}`, limit: env.followUpPerMinute, windowSeconds: 60, message: "You are going too fast. Wait a few seconds and try again." },
      { key: `rl:fu:iv:${payload.id}`, limit: env.followUpsPerInterview, windowSeconds: WEEK, message: "This interview has used all of its follow-up questions. Start a new interview to continue practising." },
    ]);
    if (!limits.ok) throw new ApiError("rate_limited", limits.message, limits.retryAfterSeconds);

    const followUp = await generateFollowUp({
      roleTitle: meta.role.title,
      interviewerTitle: meta.interviewerTitle,
      doNotClaim: meta.doNotClaim,
      stage,
      turns: turns.map((t) => ({ question: t.question, answer: sanitizeText(t.answer) })),
      followUpNumber: turns.length,
    });
    return json(request, { question: followUp.question });
  });
}
