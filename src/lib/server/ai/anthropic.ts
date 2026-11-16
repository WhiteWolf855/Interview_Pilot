import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { serverEnv } from "../env";
import { ApiError } from "../http";
import { logEvent } from "../log";
import { InvalidOutputError, type AiProvider, type StructuredRequest, type StructuredResponse } from "./provider";

let client: Anthropic | null = null;

/** The API key is read from ANTHROPIC_API_KEY on the server. It is never sent to the browser. */
function getClient(): Anthropic {
  client ??= new Anthropic({ maxRetries: 2, timeout: 240_000 });
  return client;
}

function toApiError(error: unknown): ApiError {
  // Only the status class is logged. Error messages can echo request content.
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    logEvent("ai_error", { code: "auth" });
    return new ApiError("server_misconfigured", "The interview service is not configured correctly. Please try again later.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    logEvent("ai_error", { code: "rate_limited" });
    return new ApiError("ai_unavailable", "The interviewer is busy right now. Please try again in a minute.", 60);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    logEvent("ai_error", { code: "connection" });
    return new ApiError("ai_unavailable", "We could not reach the interviewer. Check your connection and try again.");
  }
  if (error instanceof Anthropic.APIError) {
    logEvent("ai_error", { code: "api", status: typeof error.status === "number" ? error.status : 0 });
    return new ApiError("ai_unavailable", "The interviewer is unavailable right now. Please try again shortly.");
  }
  logEvent("ai_error", { code: "unknown" });
  return new ApiError("internal", "Something went wrong. Please try again.");
}

export const anthropicProvider: AiProvider = {
  async generate(request: StructuredRequest): Promise<StructuredResponse> {
    const env = serverEnv();
    const model = request.tier === "strong" ? env.modelStrong : env.modelFast;
    const base = {
      model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: "user" as const, content: request.user }],
      output_config: { effort: request.effort, format: zodOutputFormat(request.schema) },
    };

    let message: Anthropic.Message | Anthropic.Beta.BetaMessage;
    try {
      // Streaming avoids HTTP timeouts on the longer setup and grading responses.
      message =
        request.tier === "strong" && env.refusalFallback
          ? await getClient()
              .beta.messages.stream({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
              .finalMessage()
          : await getClient().messages.stream(base).finalMessage();
    } catch (error) {
      throw toApiError(error);
    }

    if (message.stop_reason === "refusal") {
      logEvent("ai_error", { code: "refusal", route: request.purpose });
      throw new ApiError("ai_declined", "The interviewer could not work with that content. Check the resume and job description and try again.");
    }
    if (message.stop_reason === "max_tokens") throw new InvalidOutputError("the response was cut off before it finished; be more concise");

    let text = "";
    for (const block of message.content) if (block.type === "text") text += block.text;
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new InvalidOutputError("the response was not valid JSON");
    }
    return {
      data,
      model: message.model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
  },
};
