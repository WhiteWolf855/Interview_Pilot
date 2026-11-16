import "server-only";
import { serverEnv } from "./env";

/** Fixed-window counters. `incr` returns the count after incrementing. */
export interface RateLimitStore {
  incr(key: string, windowSeconds: number): Promise<{ count: number; resetInSeconds: number }>;
  decr(key: string): Promise<void>;
}

/** Counters held in this process. Right for one long-running server, and for local use. */
export class MemoryStore implements RateLimitStore {
  private counters = new Map<string, { count: number; expiresAt: number }>();
  constructor(private now: () => number = Date.now) {}

  async incr(key: string, windowSeconds: number) {
    const now = this.now();
    if (this.counters.size > 50_000) this.sweep(now);
    let entry = this.counters.get(key);
    if (!entry || entry.expiresAt <= now) {
      entry = { count: 0, expiresAt: now + windowSeconds * 1000 };
      this.counters.set(key, entry);
    }
    entry.count++;
    return { count: entry.count, resetInSeconds: Math.max(1, Math.ceil((entry.expiresAt - now) / 1000)) };
  }

  async decr(key: string) {
    const entry = this.counters.get(key);
    if (entry && entry.count > 0) entry.count--;
  }

  private sweep(now: number) {
    for (const [key, entry] of this.counters) if (entry.expiresAt <= now) this.counters.delete(key);
  }
}

/** Counters in Upstash Redis over its REST API, for serverless hosts where memory is not shared. */
export class UpstashStore implements RateLimitStore {
  constructor(
    private url: string,
    private token: string,
    private fetcher: typeof fetch = fetch,
  ) {}

  private async pipeline(commands: (string | number)[][]): Promise<{ result?: unknown; error?: string }[]> {
    const response = await this.fetcher(`${this.url.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!response.ok) throw new Error(`rate limit store returned ${response.status}`);
    return (await response.json()) as { result?: unknown; error?: string }[];
  }

  async incr(key: string, windowSeconds: number) {
    const [incremented, , ttl] = await this.pipeline([
      ["INCR", key],
      ["EXPIRE", key, windowSeconds, "NX"],
      ["TTL", key],
    ]);
    const count = Number(incremented?.result);
    if (!Number.isFinite(count)) throw new Error("rate limit store returned an unexpected reply");
    const remaining = Number(ttl?.result);
    return { count, resetInSeconds: remaining > 0 ? remaining : windowSeconds };
  }

  async decr(key: string) {
    await this.pipeline([["DECR", key]]);
  }
}

let sharedStore: RateLimitStore | null = null;

export function getRateLimitStore(): RateLimitStore {
  if (sharedStore) return sharedStore;
  const env = serverEnv();
  sharedStore = env.upstashUrl && env.upstashToken ? new UpstashStore(env.upstashUrl, env.upstashToken) : new MemoryStore();
  return sharedStore;
}

/** Tests replace the store to start from zero. */
export function setRateLimitStore(store: RateLimitStore | null): void {
  sharedStore = store;
}

export interface LimitRule {
  key: string;
  limit: number;
  windowSeconds: number;
  /** Shown to the user when this rule blocks them. */
  message: string;
  /** True for the per-day caps, so the client can tell "slow down" from "come back tomorrow". */
  daily?: boolean;
}

export type LimitOutcome = { ok: true; consumed: string[] } | { ok: false; message: string; retryAfterSeconds: number; daily: boolean };

/**
 * Applies every rule. If one blocks, the counters already taken for this
 * request are handed back, so a blocked request costs nothing.
 */
export async function applyLimits(rules: LimitRule[], store: RateLimitStore = getRateLimitStore()): Promise<LimitOutcome> {
  const consumed: string[] = [];
  for (const rule of rules) {
    const { count, resetInSeconds } = await store.incr(rule.key, rule.windowSeconds);
    consumed.push(rule.key);
    if (count > rule.limit) {
      await Promise.all(consumed.map((key) => store.decr(key)));
      return { ok: false, message: rule.message, retryAfterSeconds: resetInSeconds, daily: Boolean(rule.daily) };
    }
  }
  return { ok: true, consumed };
}

/** Hands counters back, for example when plan generation fails after the daily cap was charged. */
export async function refundLimits(keys: string[], store: RateLimitStore = getRateLimitStore()): Promise<void> {
  await Promise.all(keys.map((key) => store.decr(key).catch(() => undefined)));
}

export const DAY = 24 * 60 * 60;
export const WEEK = 7 * DAY;

/** UTC date, so daily counters roll over at the same moment everywhere. */
export function dayStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
