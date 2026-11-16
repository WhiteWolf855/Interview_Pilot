import "server-only";
import type { z } from "zod";
import { serverEnv, type Effort } from "../env";
import { ApiError } from "../http";
import { logEvent } from "../log";

export type Purpose = "outline" | "station" | "followup" | "grade" | "stage_feedback";

export interface StructuredRequest {
  purpose: Purpose;
  /** "strong" for setup and grading, "fast" for live follow-ups. */
  tier: "strong" | "fast";
  system: string;
  user: string;
  /** The JSON shape the model must return. */
  schema: z.ZodType;
  maxTokens: number;
  effort: Effort;
  /** Read only by the mock provider, to build a plausible canned response. */
  mock?: Record<string, unknown>;
}

export interface StructuredResponse {
  data: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  generate(request: StructuredRequest): Promise<StructuredResponse>;
}

/** Thrown by a provider when the model's output is unusable but another attempt might work. */
export class InvalidOutputError extends Error {}

let override: AiProvider | null = null;

/** Tests inject a fake provider here. */
export function setAiProvider(provider: AiProvider | null): void {
  override = provider;
}

export async function getAiProvider(): Promise<AiProvider> {
  if (override) return override;
  const env = serverEnv();
  if (env.aiProvider === "mock") return (await import("./mock")).mockProvider;
  if (!env.hasApiKey) {
    throw new ApiError("server_misconfigured", "The interview service is not configured yet. Please try again later.");
  }
  return (await import("./anthropic")).anthropicProvider;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/**
 * Calls the model, checks the response against the wire schema and then the
 * caller's own rules. An invalid response is retried exactly once, with the
 * reasons given to the model. A second invalid response is an error.
 */
export async function generateValidated<T>(
  request: StructuredRequest,
  validate: (data: unknown) => Validation<T>,
): Promise<T> {
  const provider = await getAiProvider();
  let problems: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const user =
      attempt === 1
        ? request.user
        : `${request.user}\n\nYour previous response was rejected by an automatic check for these reasons:\n${problems
            .slice(0, 12)
            .map((p) => `- ${p.slice(0, 300)}`)
            .join("\n")}\nReturn a corrected response that fixes every one of them.`;
    const started = Date.now();
    try {
      const response = await provider.generate({ ...request, user });
      const shaped = request.schema.safeParse(response.data);
      const result: Validation<T> = shaped.success
        ? validate(shaped.data)
        : { ok: false, errors: shaped.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "response"}: ${i.message}`) };
      logEvent("ai_call", {
        code: result.ok ? "ok" : "invalid",
        route: request.purpose,
        model: response.model,
        attempt,
        ms: Date.now() - started,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
      });
      if (result.ok) return result.value;
      problems = result.errors;
    } catch (error) {
      if (error instanceof InvalidOutputError) {
        logEvent("ai_call", { code: "unparseable", route: request.purpose, attempt, ms: Date.now() - started });
        problems = [error.message];
        continue;
      }
      throw error;
    }
  }
  throw new ApiError("ai_invalid", "The interviewer produced a response we could not use, twice in a row. Please try again.");
}
