"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@/lib/interview/machine";
import { clearSession, loadSession, saveSession } from "@/lib/interview/storage";

/**
 * The interview session, mirrored to local storage. Writes are batched a few
 * hundred milliseconds apart and flushed when the page is hidden or closed.
 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<Session | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (latest.current) saveSession(latest.current);
  }, []);

  useEffect(() => {
    const stored = loadSession();
    latest.current = stored;
    setSession(stored);
    setLoaded(true);
    const onHide = () => flush();
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  const update = useCallback(
    (change: Session | ((current: Session) => Session), options: { immediate?: boolean } = {}) => {
      const current = latest.current;
      const next = typeof change === "function" ? (current ? change(current) : null) : change;
      if (!next || next === current) return;
      latest.current = next;
      setSession(next);
      if (options.immediate) flush();
      else if (!timer.current) timer.current = setTimeout(flush, 300);
    },
    [flush],
  );

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    latest.current = null;
    clearSession();
    setSession(null);
  }, []);

  return { session, loaded, update, clear, latest };
}
