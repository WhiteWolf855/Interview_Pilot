import "server-only";
import { serverEnv } from "./env";

export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "too_large"
  | "unsupported_file"
  | "unreadable_file"
  | "rate_limited"
  | "daily_limit"
  | "ai_unavailable"
  | "ai_invalid"
  | "ai_declined"
  | "server_misconfigured"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  too_large: 413,
  unsupported_file: 415,
  unreadable_file: 422,
  rate_limited: 429,
  daily_limit: 429,
  ai_unavailable: 503,
  ai_invalid: 502,
  ai_declined: 422,
  server_misconfigured: 500,
  internal: 500,
};

/** An error whose message is safe and useful to show to the user. */
export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
  get status(): number {
    return STATUS[this.code];
  }
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  const env = serverEnv();
  let sameOrigin = false;
  try {
    sameOrigin = new URL(request.url).origin === origin;
  } catch {
    sameOrigin = false;
  }
  if (!sameOrigin && !env.allowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function json(request: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders(request), ...extra },
  });
}

export function errorResponse(request: Request, error: ApiError): Response {
  const extra: Record<string, string> = error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {};
  return json(request, { error: { code: error.code, message: error.message } }, error.status, extra);
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

/** The caller's address as reported by the hosting platform's proxy. */
export function clientIp(request: Request): string {
  const env = serverEnv();
  const forwarded = request.headers.get(env.clientIpHeader) ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || "unknown";
}

/** Reads a JSON body with a hard size limit. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new ApiError("too_large", "That request is too large.");
  const raw = await request.text();
  if (raw.length > maxBytes) throw new ApiError("too_large", "That request is too large.");
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError("bad_request", "The request was not valid JSON.");
  }
}
