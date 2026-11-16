import type { Debrief, StageRecord } from "@/lib/schemas/debrief";
import type { Session } from "./machine";

/**
 * Everything the app remembers lives in this browser's local storage, under
 * keys that start with "intas.". Nothing here is sent anywhere except as part
 * of the interview requests themselves.
 */
const PREFIX = "intas.";
const SESSION_KEY = `${PREFIX}session.v1`;
const HISTORY_KEY = `${PREFIX}history.v1`;
export const THEME_KEY = `${PREFIX}theme`;
const MAX_HISTORY = 20;

export interface SavedDebrief {
  id: string;
  savedAt: string;
  roleTitle: string;
  company: string;
  mode: string;
  debrief: Debrief;
  /** Questions and the candidate's answers, so a saved debrief can be re-read and exported. */
  stages: { id: string; title: string; question: string }[];
  records: StageRecord[];
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadSession(): Session | null {
  const session = read<Session>(SESSION_KEY);
  return session && session.version === 1 && session.plan?.stages?.length ? session : null;
}

export function saveSession(session: Session): boolean {
  return write(SESSION_KEY, session);
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function loadHistory(): SavedDebrief[] {
  return read<SavedDebrief[]>(HISTORY_KEY) ?? [];
}

export function saveDebrief(session: Session): SavedDebrief | null {
  if (!session.debrief) return null;
  const entry: SavedDebrief = {
    id: `${session.plan.id}-${session.debrief.gradedAt}`,
    savedAt: new Date().toISOString(),
    roleTitle: session.plan.role.title,
    company: session.plan.role.company,
    mode: session.mode,
    debrief: session.debrief,
    stages: session.plan.stages.map((s) => ({ id: s.id, title: s.title, question: s.kind === "conversation" ? s.openingQuestion : s.brief })),
    records: session.records,
  };
  const history = [entry, ...loadHistory().filter((h) => h.id !== entry.id)].slice(0, MAX_HISTORY);
  return write(HISTORY_KEY, history) ? entry : null;
}

export function removeSavedDebrief(id: string): void {
  write(HISTORY_KEY, loadHistory().filter((h) => h.id !== id));
}

/** Delete my data: removes every key this app has written on this device. */
export function deleteAllData(): number {
  let removed = 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      window.localStorage.removeItem(key);
      removed++;
    }
  } catch {
    /* storage unavailable */
  }
  return removed;
}
