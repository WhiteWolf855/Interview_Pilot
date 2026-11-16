import { z } from "zod";
import { INTERVIEW_LENGTHS, LIMITS, type InterviewLength } from "@/lib/config";
import { sanitizeText } from "@/lib/guards/untrusted";
import { serverEnv } from "@/lib/server/env";
import { handle } from "@/lib/server/handler";
import { ApiError, clientIp, json, preflight } from "@/lib/server/http";
import { logEvent } from "@/lib/server/log";
import { generatePlan } from "@/lib/server/plan";
import { DAY, WEEK, applyLimits, dayStamp, refundLimits } from "@/lib/server/ratelimit";
import { extractResumeText } from "@/lib/server/resume/parse";
import { hashClient, issueToken } from "@/lib/server/token";

export const runtime = "nodejs";
export const maxDuration = 300;

const FieldsSchema = z.object({
  jobDescription: z.string(),
  resumeText: z.string(),
  interviewerTitle: z.string().max(LIMITS.shortFieldMaxChars),
  doNotClaim: z.string().max(LIMITS.doNotClaimMaxChars),
  lengthMinutes: z.coerce.number().refine((n): n is InterviewLength => (INTERVIEW_LENGTHS as readonly number[]).includes(n)),
});

export function OPTIONS(request: Request) {
  return preflight(request);
}

export function POST(request: Request) {
  return handle(request, "plan", async () => {
    const env = serverEnv();
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > LIMITS.resumeMaxBytes + 200_000) throw new ApiError("too_large", "That upload is too large.");

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiError("bad_request", "The form could not be read. Please try again.");
    }
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    const parsed = FieldsSchema.safeParse({
      jobDescription: field("jobDescription"),
      resumeText: field("resumeText"),
      interviewerTitle: field("interviewerTitle").trim(),
      doNotClaim: field("doNotClaim").trim(),
      lengthMinutes: field("lengthMinutes") || "45",
    });
    if (!parsed.success) throw new ApiError("bad_request", "Some of the setup details are missing or too long. Check the form and try again.");

    const jobText = sanitizeText(parsed.data.jobDescription);
    if (jobText.length < LIMITS.jobMinChars) {
      throw new ApiError("bad_request", "Paste the full job description. The interview is built from it, so a line or two is not enough.");
    }
    if (jobText.length > LIMITS.jobMaxChars) {
      throw new ApiError("too_large", `That job description is over the ${LIMITS.jobMaxChars.toLocaleString("en")} character limit. Remove the boilerplate and try again.`);
    }
    const file = form.get("resumeFile");
    const hasFile = file instanceof File && file.size > 0;
    if (!hasFile && !parsed.data.resumeText.trim()) throw new ApiError("bad_request", "Upload your resume or paste its text.");

    // Limits are charged before any expensive work, and handed back if the request fails.
    const client = hashClient(clientIp(request));
    const day = dayStamp();
    const dailyKey = `rl:plan:day:${day}:${client}`;
    const globalKey = `rl:plan:global:${day}`;
    const limits = await applyLimits([
      { key: `rl:plan:min:${client}`, limit: env.planPerMinute, windowSeconds: 60, message: "You are starting interviews too quickly. Wait a minute and try again." },
      { key: dailyKey, limit: env.maxInterviewsPerDay, windowSeconds: DAY, daily: true, message: `You have reached today's limit of ${env.maxInterviewsPerDay} new interviews. You can still rerun an interview you already have, or come back tomorrow.` },
      { key: globalKey, limit: env.globalMaxInterviewsPerDay, windowSeconds: DAY, daily: true, message: "The service has reached its daily capacity. Please come back tomorrow." },
    ]);
    if (!limits.ok) {
      throw new ApiError(limits.daily ? "daily_limit" : "rate_limited", limits.message, limits.retryAfterSeconds);
    }

    try {
      const resume = await extractResumeText(
        hasFile ? { kind: "file", bytes: new Uint8Array(await (file as File).arrayBuffer()) } : { kind: "text", text: parsed.data.resumeText },
      );
      const { plan, fallbackStations } = await generatePlan({
        resumeText: resume.text,
        jobText,
        interviewerTitle: sanitizeText(parsed.data.interviewerTitle),
        doNotClaim: sanitizeText(parsed.data.doNotClaim),
        lengthMinutes: parsed.data.lengthMinutes,
      });
      logEvent("plan_created", { fileKind: resume.source, stations: plan.stages.filter((s) => s.kind === "hands_on").length, fallbackStations });
      return json(request, { plan, token: issueToken(plan, WEEK) });
    } catch (error) {
      await refundLimits([dailyKey, globalKey]);
      throw error;
    }
  });
}
