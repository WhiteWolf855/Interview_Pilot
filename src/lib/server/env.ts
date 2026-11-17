import "server-only";

/** Server configuration, read from environment variables at request time. */

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
function effort(name: string, fallback: Effort): Effort {
  const raw = process.env[name];
  return raw && ["low", "medium", "high", "xhigh", "max"].includes(raw) ? (raw as Effort) : fallback;
}

export function serverEnv() {
  return {
    /** "anthropic" in production. "mock" returns canned responses and is for tests and UI work only. */
    aiProvider: process.env.AI_PROVIDER === "mock" ? ("mock" as const) : ("anthropic" as const),
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    modelStrong: process.env.CLAUDE_MODEL_STRONG || "claude-opus-5-5",
    modelFast: process.env.CLAUDE_MODEL_FAST || "claude-haiku-5-5",
    effortPlan: effort("CLAUDE_EFFORT_PLAN", "medium"),
    effortGrade: effort("CLAUDE_EFFORT_GRADE", "high"),
    effortFollowUp: effort("CLAUDE_EFFORT_FOLLOWUP", "low"),
    /** Server-side refusal fallback for the strong model. Set to "off" to disable. */
    refusalFallback: process.env.CLAUDE_REFUSAL_FALLBACK !== "off",
    sessionSecret: process.env.SESSION_SECRET || "",
    maxInterviewsPerDay: int("MAX_INTERVIEWS_PER_DAY", 5),
    globalMaxInterviewsPerDay: int("GLOBAL_MAX_INTERVIEWS_PER_DAY", 300),
    planPerMinute: int("RATE_PLAN_PER_MINUTE", 3),
    followUpPerMinute: int("RATE_FOLLOWUP_PER_MINUTE", 30),
    gradePerMinute: int("RATE_GRADE_PER_MINUTE", 10),
    followUpsPerInterview: int("MAX_FOLLOWUPS_PER_INTERVIEW", 60),
    gradesPerInterview: int("MAX_GRADES_PER_INTERVIEW", 40),
    // Vercel's Upstash integration may name these KV_REST_API_URL and KV_REST_API_TOKEN, so both are accepted.
    upstashUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "",
    upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "",
    allowedOrigins: (process.env.ALLOWED_ORIGINS || "https://localhost,capacitor://localhost")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    clientIpHeader: (process.env.CLIENT_IP_HEADER || "x-forwarded-for").toLowerCase(),
    isProduction: process.env.NODE_ENV === "production",
  };
}
export type ServerEnv = ReturnType<typeof serverEnv>;
