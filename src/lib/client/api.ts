import type { Debrief, StageGrade, StageRecord } from "@/lib/schemas/debrief";
import type { ConversationStage, Plan } from "@/lib/schemas/plan";

/**
 * Empty on the website (same origin). In the Android build it is the address
 * of the deployed backend. This is a public URL, not a secret.
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function send<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiClientError("network", "We could not reach the server. Check your connection and try again.");
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiClientError(error?.code ?? "unknown", error?.message ?? "Something went wrong. Please try again.");
  }
  return body as T;
}

const postJson = <T,>(path: string, payload: unknown) =>
  send<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });

export function createPlan(form: FormData): Promise<{ plan: Plan; token: string }> {
  return send("/api/plan", { method: "POST", body: form });
}

export async function fetchFollowUp(input: {
  token: string;
  plan: Plan;
  stage: ConversationStage;
  turns: { question: string; answer: string }[];
}): Promise<string> {
  const { plan } = input;
  const result = await postJson<{ question: string }>("/api/followup", {
    token: input.token,
    meta: { role: plan.role, interviewerTitle: plan.interviewerTitle, doNotClaim: plan.doNotClaim, lengthMinutes: plan.lengthMinutes },
    stage: input.stage,
    turns: input.turns,
  });
  return result.question;
}

export async function fetchDebrief(token: string, plan: Plan, records: StageRecord[]): Promise<Debrief> {
  return (await postJson<{ debrief: Debrief }>("/api/grade", { token, plan, records, scope: "full" })).debrief;
}

export async function fetchStageFeedback(token: string, plan: Plan, record: StageRecord): Promise<StageGrade> {
  return (await postJson<{ grade: StageGrade }>("/api/grade", { token, plan, records: [record], scope: "stage", stageId: record.stageId })).grade;
}
