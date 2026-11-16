import { serverEnv } from "@/lib/server/env";
import { json, preflight } from "@/lib/server/http";

export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return preflight(request);
}

/** Lets the app tell the user early when the backend is unreachable or not configured. Reveals no secrets. */
export function GET(request: Request) {
  const env = serverEnv();
  const ready = env.aiProvider === "mock" || env.hasApiKey;
  return json(request, { ok: ready, mock: env.aiProvider === "mock" }, ready ? 200 : 503);
}
