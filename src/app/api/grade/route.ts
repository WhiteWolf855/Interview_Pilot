import { z } from "zod";
import { sanitizeText } from "@/lib/guards/untrusted";
import { StageRecordSchema, type StageRecord } from "@/lib/schemas/debrief";
import { PlanSchema, type Plan } from "@/lib/schemas/plan";
import { serverEnv } from "@/lib/server/env";
import { handle } from "@/lib/server/handler";
import { ApiError, clientIp, json, preflight, readJson } from "@/lib/server/http";
import { gradeInterview, gradeStage } from "@/lib/server/interview";
import { WEEK, applyLimits } from "@/lib/server/ratelimit";
import { hashClient, planMatchesToken, verifyToken } from "@/lib/server/token";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z.object({
  token: z.string().max(4000),
  plan: PlanSchema,
  records: z.array(StageRecordSchema).max(14),
  /** "full" for the debrief. "stage" for prep-mode feedback on one stage. */
  scope: z.enum(["full", "stage"]),
  stageId: z.string().max(4).optional(),
});

/** Records must describe this plan: known stages, no duplicates, the right kind of content. */
function checkRecords(plan: Plan, records: StageRecord[]): StageRecord[] {
  const seen = new Set<string>();
  return records.map((record) => {
    const stage = plan.stages.find((s) => s.id === record.stageId);
    if (!stage || seen.has(record.stageId)) throw new ApiError("bad_request", "The interview record does not match the interview plan.");
    seen.add(record.stageId);
    if (stage.kind === "conversation") {
      if (record.station || (record.turns[0] && record.turns[0].question !== stage.openingQuestion)) {
        throw new ApiError("bad_request", "The interview record does not match the interview plan.");
      }
      return { ...record, turns: record.turns.map((t) => ({ question: sanitizeText(t.question), answer: sanitizeText(t.answer) })) };
    }
    if (record.turns.length > 0 || (record.station && record.station.station !== stage.station)) {
      throw new ApiError("bad_request", "The interview record does not match the interview plan.");
    }
    return record.station
      ? { ...record, station: { ...record.station, summary: sanitizeText(record.station.summary), notes: sanitizeText(record.station.notes) } }
      : record;
  });
}

export function OPTIONS(request: Request) {
  return preflight(request);
}

export function POST(request: Request) {
  return handle(request, "grade", async () => {
    const env = serverEnv();
    const parsed = BodySchema.safeParse(await readJson(request, 600_000));
    if (!parsed.success) throw new ApiError("bad_request", "The interview record could not be read.");
    const { token, plan, scope, stageId } = parsed.data;

    const payload = verifyToken(token);
    if (!payload || !planMatchesToken(payload, plan)) {
      throw new ApiError("unauthorized", "This interview session is no longer valid. Start a new interview.");
    }
    const records = checkRecords(plan, parsed.data.records);

    const client = hashClient(clientIp(request));
    const limits = await applyLimits([
      { key: `rl:gr:min:${client}`, limit: env.gradePerMinute, windowSeconds: 60, message: "You are going too fast. Wait a few seconds and try again." },
      { key: `rl:gr:iv:${payload.id}`, limit: env.gradesPerInterview, windowSeconds: WEEK, message: "This interview has been graded as many times as allowed. Start a new interview to continue practising." },
    ]);
    if (!limits.ok) throw new ApiError("rate_limited", limits.message, limits.retryAfterSeconds);

    if (scope === "stage") {
      const record = records.find((r) => r.stageId === stageId);
      if (!record) throw new ApiError("bad_request", "That stage has no record to give feedback on.");
      return json(request, { grade: await gradeStage(plan, record) });
    }
    return json(request, { debrief: await gradeInterview(plan, records) });
  });
}
