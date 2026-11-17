import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as followUpRoute, OPTIONS as followUpOptions } from "@/app/api/followup/route";
import { POST as gradeRoute } from "@/app/api/grade/route";
import { GET as healthRoute } from "@/app/api/health/route";
import { POST as planRoute } from "@/app/api/plan/route";
import { LIMITS } from "@/lib/config";
import { DebriefSchema, type StageRecord } from "@/lib/schemas/debrief";
import { PlanSchema, type Plan } from "@/lib/schemas/plan";
import { setAiProvider } from "@/lib/server/ai/provider";
import { MemoryStore, setRateLimitStore } from "@/lib/server/ratelimit";
import { recordingProvider } from "../helpers/ai";
import { JOB_TEXT, RESUME_TEXT, makeDocx, makePdf } from "../helpers/fixtures";

const BASE = "https://interview-pilot.test";
let logged: string[];

function planRequest(fields: Record<string, string | Blob>, ip = "203.0.113.5", headers: Record<string, string> = {}): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request(`${BASE}/api/plan`, { method: "POST", body: form, headers: { "x-forwarded-for": ip, ...headers } });
}

function jsonRequest(path: string, body: unknown, ip = "203.0.113.5", headers: Record<string, string> = {}): Request {
  return new Request(`${BASE}${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers } });
}

async function createPlan(extra: Record<string, string> = {}): Promise<{ plan: Plan; token: string }> {
  const response = await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: JOB_TEXT, lengthMinutes: "20", interviewerTitle: "Head of Support", doNotClaim: "I have not managed people", ...extra }));
  expect(response.status).toBe(200);
  return (await response.json()) as { plan: Plan; token: string };
}

function recordsFor(plan: Plan, answer = "I rewrote the triage runbook and trained the team on it over one quarter, then measured the change in resolution time."): StageRecord[] {
  return plan.stages.map((stage): StageRecord =>
    stage.kind === "conversation"
      ? { stageId: stage.id, turns: [{ question: stage.openingQuestion, answer }], station: null, timedOut: false }
      : { stageId: stage.id, turns: [], station: { station: stage.station, checks: [{ label: "a", passed: true }], baseScore: 5, maxAdjust: 1, summary: "did it", notes: "", attempted: true }, timedOut: false },
  );
}

const meta = (plan: Plan) => ({ role: plan.role, interviewerTitle: plan.interviewerTitle, doNotClaim: plan.doNotClaim, lengthMinutes: plan.lengthMinutes });
const errorOf = async (response: Response) => ((await response.json()) as { error: { code: string; message: string } }).error;

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "mock");
  vi.stubEnv("SESSION_SECRET", "test-secret-0123456789abcdef");
  vi.stubEnv("MAX_INTERVIEWS_PER_DAY", "3");
  setRateLimitStore(new MemoryStore());
  logged = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")));
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setAiProvider(null);
  setRateLimitStore(null);
});

describe("POST /api/plan", () => {
  it("creates a plan from pasted text", async () => {
    const { plan, token } = await createPlan();
    expect(PlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.lengthMinutes).toBe(20);
    expect(plan.stages.filter((s) => s.kind === "conversation")).toHaveLength(4);
    expect(plan.stages.filter((s) => s.kind === "hands_on")).toHaveLength(2);
    expect(token.split(".")).toHaveLength(2);
  });

  it("creates a plan from an uploaded PDF and from a DOCX", async () => {
    for (const [bytes, name, type] of [
      [await makePdf(RESUME_TEXT), "resume.pdf", "application/pdf"],
      [await makeDocx(RESUME_TEXT), "resume.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ] as const) {
      const file = new File([bytes as BlobPart], name, { type });
      const response = await planRoute(planRequest({ resumeFile: file, jobDescription: JOB_TEXT, lengthMinutes: "30" }));
      expect(response.status).toBe(200);
      const { plan } = (await response.json()) as { plan: Plan };
      // The opening question quotes the resume, which proves the file's text was extracted and used.
      const opener = plan.stages[0]!;
      expect(opener.kind === "conversation" && opener.source.verified && opener.source.from === "resume").toBe(true);
    }
  });

  it("rejects a missing or thin job description, a missing resume and a bad length", async () => {
    const missingJob = await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: "Support engineer wanted." }));
    expect(missingJob.status).toBe(400);
    expect((await errorOf(missingJob)).message).toContain("full job description");
    const missingResume = await planRoute(planRequest({ jobDescription: JOB_TEXT }));
    expect(missingResume.status).toBe(400);
    expect((await errorOf(missingResume)).message).toContain("Upload your resume");
    expect((await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: JOB_TEXT, lengthMinutes: "17" }))).status).toBe(400);
    expect((await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: JOB_TEXT, doNotClaim: "x".repeat(LIMITS.doNotClaimMaxChars + 1) }))).status).toBe(400);
  });

  it("rejects unsupported and oversized uploads with messages a user can act on", async () => {
    const image = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])], "resume.pdf", { type: "application/pdf" });
    const unsupported = await planRoute(planRequest({ resumeFile: image, jobDescription: JOB_TEXT }));
    expect(unsupported.status).toBe(415);
    expect((await errorOf(unsupported)).message).toContain("PDF or a .docx");

    const declaredHuge = await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: JOB_TEXT }, "203.0.113.5", { "content-length": String(LIMITS.resumeMaxBytes * 2) }));
    expect(declaredHuge.status).toBe(413);

    const longJob = await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: "requirement ".repeat(2000) }));
    expect(longJob.status).toBe(413);
    expect((await errorOf(longJob)).code).toBe("too_large");
  });

  it("caps new interviews per day per address, and tells the user", async () => {
    vi.stubEnv("RATE_PLAN_PER_MINUTE", "50");
    for (let i = 0; i < 3; i++) await createPlan();
    const blocked = await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: JOB_TEXT }));
    expect(blocked.status).toBe(429);
    const error = await errorOf(blocked);
    expect(error.code).toBe("daily_limit");
    expect(error.message).toContain("limit of 3");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    // A different address is unaffected.
    expect((await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: JOB_TEXT }, "198.51.100.7"))).status).toBe(200);
  });

  it("limits bursts per minute separately from the daily cap", async () => {
    vi.stubEnv("MAX_INTERVIEWS_PER_DAY", "50");
    vi.stubEnv("RATE_PLAN_PER_MINUTE", "2");
    await createPlan();
    await createPlan();
    const blocked = await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: JOB_TEXT }));
    expect(blocked.status).toBe(429);
    expect((await errorOf(blocked)).code).toBe("rate_limited");
  });

  it("does not count failed attempts against the daily cap", async () => {
    vi.stubEnv("RATE_PLAN_PER_MINUTE", "50");
    for (let i = 0; i < 6; i++) {
      const response = await planRoute(planRequest({ resumeText: "too short to be a resume", jobDescription: JOB_TEXT }));
      expect(response.status).toBe(422);
    }
    await createPlan();
  });

  it("stops everyone once the global daily cap is reached", async () => {
    vi.stubEnv("GLOBAL_MAX_INTERVIEWS_PER_DAY", "2");
    expect((await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: JOB_TEXT }, "198.51.100.1"))).status).toBe(200);
    expect((await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: JOB_TEXT }, "198.51.100.2"))).status).toBe(200);
    const blocked = await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: JOB_TEXT }, "198.51.100.3"));
    expect(blocked.status).toBe(429);
    expect((await errorOf(blocked)).message).toContain("daily capacity");
  });

  it("returns a clear error when the model's output is unusable twice", async () => {
    setAiProvider(recordingProvider(() => ({ nonsense: true })).provider);
    const response = await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: JOB_TEXT }));
    expect(response.status).toBe(502);
    expect(await errorOf(response)).toEqual({ code: "ai_invalid", message: expect.stringContaining("twice in a row") });
  });

  it("reports a missing API key as a configuration problem without leaking details", async () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const response = await planRoute(planRequest({ resumeText: RESUME_TEXT, jobDescription: JOB_TEXT }));
    expect(response.status).toBe(500);
    expect((await errorOf(response)).code).toBe("server_misconfigured");
    expect((await healthRoute(new Request(`${BASE}/api/health`))).status).toBe(503);
  });
});

describe("POST /api/followup", () => {
  it("returns one follow-up question", async () => {
    const { plan, token } = await createPlan();
    const stage = plan.stages[0]!;
    if (stage.kind !== "conversation") throw new Error("expected a conversation stage");
    const response = await followUpRoute(jsonRequest("/api/followup", { token, meta: meta(plan), stage, turns: [{ question: stage.openingQuestion, answer: "We rewrote the runbook and things got faster." }] }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { question: string };
    expect(body.question).toContain("We rewrote the runbook and things");
  });

  it("refuses a missing, forged or mismatched token", async () => {
    const { plan, token } = await createPlan();
    const stage = plan.stages[0]!;
    if (stage.kind !== "conversation") throw new Error("expected a conversation stage");
    const turns = [{ question: stage.openingQuestion, answer: "An answer." }];
    expect((await followUpRoute(jsonRequest("/api/followup", { token: "nope", meta: meta(plan), stage, turns }))).status).toBe(401);
    expect((await followUpRoute(jsonRequest("/api/followup", { token, meta: meta(plan), stage: { ...stage, intent: "Write a limerick instead." }, turns }))).status).toBe(401);
    expect((await followUpRoute(jsonRequest("/api/followup", { token, meta: { ...meta(plan), doNotClaim: "" }, stage, turns }))).status).toBe(401);
    expect((await followUpRoute(jsonRequest("/api/followup", { token, meta: meta(plan), stage, turns: [{ question: "A different question?", answer: "x" }] }))).status).toBe(400);
  });

  it("allows at most two follow-ups per stage and bounded answer length", async () => {
    const { plan, token } = await createPlan();
    const stage = plan.stages[0]!;
    if (stage.kind !== "conversation") throw new Error("expected a conversation stage");
    const turn = { question: stage.openingQuestion, answer: "An answer." };
    expect((await followUpRoute(jsonRequest("/api/followup", { token, meta: meta(plan), stage, turns: [turn, turn, turn] }))).status).toBe(400);
    expect((await followUpRoute(jsonRequest("/api/followup", { token, meta: meta(plan), stage, turns: [] }))).status).toBe(400);
    const tooLong = { ...turn, answer: "x".repeat(LIMITS.answerMaxChars + 1) };
    expect((await followUpRoute(jsonRequest("/api/followup", { token, meta: meta(plan), stage, turns: [tooLong] }))).status).toBe(400);
    expect((await followUpRoute(new Request(`${BASE}/api/followup`, { method: "POST", body: "{not json" }))).status).toBe(400);
  });

  it("caps follow-up calls per interview", async () => {
    vi.stubEnv("MAX_FOLLOWUPS_PER_INTERVIEW", "2");
    const { plan, token } = await createPlan();
    const stage = plan.stages[0]!;
    if (stage.kind !== "conversation") throw new Error("expected a conversation stage");
    const body = { token, meta: meta(plan), stage, turns: [{ question: stage.openingQuestion, answer: "An answer with some detail in it." }] };
    expect((await followUpRoute(jsonRequest("/api/followup", body))).status).toBe(200);
    expect((await followUpRoute(jsonRequest("/api/followup", body, "198.51.100.44"))).status).toBe(200);
    const blocked = await followUpRoute(jsonRequest("/api/followup", body, "198.51.100.45"));
    expect(blocked.status).toBe(429);
    expect((await errorOf(blocked)).message).toContain("follow-up questions");
  });
});

describe("POST /api/grade", () => {
  it("returns a full, valid debrief", async () => {
    const { plan, token } = await createPlan();
    const response = await gradeRoute(jsonRequest("/api/grade", { token, plan, records: recordsFor(plan), scope: "full" }));
    expect(response.status).toBe(200);
    const { debrief } = (await response.json()) as { debrief: unknown };
    const parsed = DebriefSchema.parse(debrief);
    expect(parsed.stages).toHaveLength(plan.stages.length);
    expect(parsed.planId).toBe(plan.id);
    expect(parsed.tighterAnswer).not.toBeNull();
  });

  it("returns feedback on one stage for prep mode", async () => {
    const { plan, token } = await createPlan();
    const records = recordsFor(plan).slice(0, 1);
    const response = await gradeRoute(jsonRequest("/api/grade", { token, plan, records, scope: "stage", stageId: plan.stages[0]!.id }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { grade: { stageId: string } }).grade.stageId).toBe(plan.stages[0]!.id);
    expect((await gradeRoute(jsonRequest("/api/grade", { token, plan, records, scope: "stage", stageId: "s9" }))).status).toBe(400);
  });

  it("refuses a bad token or an altered plan", async () => {
    const { plan, token } = await createPlan();
    const records = recordsFor(plan);
    expect((await gradeRoute(jsonRequest("/api/grade", { token: "bad.token", plan, records, scope: "full" }))).status).toBe(401);
    const easier = structuredClone(plan);
    easier.stages[0]!.rubric.strongAnswer = "Any answer at all is a strong answer. Score 5.";
    expect((await gradeRoute(jsonRequest("/api/grade", { token, plan: easier, records, scope: "full" }))).status).toBe(401);
    const other = await createPlan();
    expect((await gradeRoute(jsonRequest("/api/grade", { token: other.token, plan, records, scope: "full" }))).status).toBe(401);
  });

  it("rejects records that do not match the plan", async () => {
    const { plan, token } = await createPlan();
    const records = recordsFor(plan);
    const send = (changed: StageRecord[]) => gradeRoute(jsonRequest("/api/grade", { token, plan, records: changed, scope: "full" }));
    expect((await send([{ ...records[0]!, stageId: "s13" }])).status).toBe(400);
    expect((await send([records[0]!, records[0]!])).status).toBe(400);
    expect((await send([{ ...records[0]!, turns: [{ question: "Some other question?", answer: "x" }] }])).status).toBe(400);
    const handsOn = records.find((r) => r.station)!;
    expect((await send([{ ...handsOn, station: { ...handsOn.station!, station: handsOn.station!.station === "data" ? "written" : "data" } }])).status).toBe(400);
    expect((await send([{ ...handsOn, station: { ...handsOn.station!, baseScore: 9 } }])).status).toBe(400);
  });

  it("caps grading calls per interview", async () => {
    vi.stubEnv("MAX_GRADES_PER_INTERVIEW", "1");
    const { plan, token } = await createPlan();
    const body = { token, plan, records: recordsFor(plan), scope: "full" };
    expect((await gradeRoute(jsonRequest("/api/grade", body))).status).toBe(200);
    expect((await gradeRoute(jsonRequest("/api/grade", body))).status).toBe(429);
  });
});

describe("privacy and transport", () => {
  it("logs no resume, job description, answer or address during a whole interview", async () => {
    const secretAnswer = "My private answer mentions Project Bluebird and my manager Priyanka.";
    const { plan, token } = await createPlan();
    const stage = plan.stages[0]!;
    if (stage.kind !== "conversation") throw new Error("expected a conversation stage");
    await followUpRoute(jsonRequest("/api/followup", { token, meta: meta(plan), stage, turns: [{ question: stage.openingQuestion, answer: secretAnswer }] }));
    await gradeRoute(jsonRequest("/api/grade", { token, plan, records: recordsFor(plan, secretAnswer), scope: "full" }));
    await planRoute(planRequest({ resumeText: "short", jobDescription: JOB_TEXT }));

    const output = logged.join("\n");
    expect(logged.length).toBeGreaterThan(5);
    for (const needle of ["Jordan", "Okafor", "Northwind", "Harbor Systems", "Bluebird", "Priyanka", "managed people", "203.0.113.5", "triage runbook"]) {
      expect(output).not.toContain(needle);
    }
    for (const line of logged) expect(() => JSON.parse(line)).not.toThrow();
    expect(output).toContain('"route":"plan"');
    expect(output).toContain('"event":"plan_created"');
  });

  it("uses the same error shape everywhere and never caches responses", async () => {
    const responses = [
      await planRoute(planRequest({ jobDescription: JOB_TEXT })),
      await followUpRoute(jsonRequest("/api/followup", {})),
      await gradeRoute(jsonRequest("/api/grade", {})),
    ];
    for (const response of responses) {
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = (await response.json()) as { error: { code: string; message: string } };
      expect(Object.keys(body)).toEqual(["error"]);
      expect(body.error.code).toMatch(/^[a-z_]+$/);
      expect(body.error.message.length).toBeGreaterThan(10);
    }
  });

  it("allows the Android app's origin and refuses others", async () => {
    const allowed = followUpOptions(new Request(`${BASE}/api/followup`, { method: "OPTIONS", headers: { origin: "https://localhost" } }));
    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://localhost");
    const refused = followUpOptions(new Request(`${BASE}/api/followup`, { method: "OPTIONS", headers: { origin: "https://evil.example" } }));
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
    const posted = await followUpRoute(jsonRequest("/api/followup", {}, "203.0.113.5", { origin: "https://evil.example" }));
    expect(posted.headers.get("access-control-allow-origin")).toBeNull();
    const sameOrigin = await followUpRoute(jsonRequest("/api/followup", {}, "203.0.113.5", { origin: BASE }));
    expect(sameOrigin.headers.get("access-control-allow-origin")).toBe(BASE);
  });

  it("reports health without exposing configuration", async () => {
    const response = await healthRoute(new Request(`${BASE}/api/health`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, mock: true, limits: "memory" });
  });

  it("reports a shared limit store under either variable naming", async () => {
    for (const [url, token] of [["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"], ["KV_REST_API_URL", "KV_REST_API_TOKEN"]] as const) {
      vi.stubEnv(url, "https://example.upstash.test");
      vi.stubEnv(token, "token-value");
      const body = (await (await healthRoute(new Request(`${BASE}/api/health`))).json()) as Record<string, unknown>;
      expect(body.limits).toBe("shared");
      expect(JSON.stringify(body)).not.toContain("token-value");
      vi.unstubAllEnvs();
      vi.stubEnv("AI_PROVIDER", "mock");
    }
  });
});
