import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Plan, Stage } from "@/lib/schemas/plan";
import { serverEnv } from "./env";

/**
 * The server keeps no interview state. Instead, when it creates a plan it
 * signs a token that fingerprints every stage. The follow-up and grading
 * routes only work with a stage or plan that matches a token this server
 * signed, so they cannot be used as a general-purpose proxy to the model.
 */

export interface TokenPayload {
  /** Plan id. */
  id: string;
  /** Expiry, seconds since epoch. */
  exp: number;
  /** Fingerprint of role, interviewer title and the do-not-claim text. */
  meta: string;
  /** Fingerprint per stage id. */
  stages: Record<string, string>;
}

let devSecret: string | null = null;

export class ConfigError extends Error {}

function secret(): string {
  const env = serverEnv();
  if (env.sessionSecret.length >= 16) return env.sessionSecret;
  if (env.isProduction) throw new ConfigError("SESSION_SECRET is not set (needs at least 16 characters)");
  devSecret ??= randomBytes(32).toString("hex");
  return devSecret;
}

/** JSON with sorted keys, so the same object always hashes the same way. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("base64url").slice(0, 22);
}

export function stageFingerprint(stage: Stage): string {
  return fingerprint(stage);
}

export function metaFingerprint(plan: Pick<Plan, "role" | "interviewerTitle" | "doNotClaim" | "lengthMinutes">): string {
  return fingerprint({ role: plan.role, interviewerTitle: plan.interviewerTitle, doNotClaim: plan.doNotClaim, lengthMinutes: plan.lengthMinutes });
}

function sign(body: string): string {
  return createHmac("sha256", secret()).update(body).digest("base64url");
}

export function issueToken(plan: Plan, ttlSeconds: number, now: Date = new Date()): string {
  const payload: TokenPayload = {
    id: plan.id,
    exp: Math.floor(now.getTime() / 1000) + ttlSeconds,
    meta: metaFingerprint(plan),
    stages: Object.fromEntries(plan.stages.map((stage) => [stage.id, stageFingerprint(stage)])),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyToken(token: string, now: Date = new Date()): TokenPayload | null {
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length > 0) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
    if (typeof payload.id !== "string" || typeof payload.exp !== "number" || typeof payload.stages !== "object") return null;
    if (payload.exp * 1000 < now.getTime()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function stageMatchesToken(payload: TokenPayload, stage: Stage): boolean {
  return payload.stages[stage.id] === stageFingerprint(stage);
}

export function planMatchesToken(payload: TokenPayload, plan: Plan): boolean {
  if (payload.id !== plan.id || payload.meta !== metaFingerprint(plan)) return false;
  if (Object.keys(payload.stages).length !== plan.stages.length) return false;
  return plan.stages.every((stage) => stageMatchesToken(payload, stage));
}

export function newPlanId(): string {
  return randomBytes(12).toString("hex");
}

/** Client addresses are only ever used as a keyed hash. */
export function hashClient(ip: string): string {
  return createHmac("sha256", secret()).update(`ip:${ip}`).digest("base64url").slice(0, 24);
}
