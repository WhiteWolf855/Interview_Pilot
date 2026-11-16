"use client";

import { formatClock } from "@/lib/interview/machine";

/** The countdown. It is not read out every second; two warnings are announced instead. */
export function Clock({ stageMs, totalMs, paused }: { stageMs: number; totalMs: number | null; paused: boolean }) {
  const seconds = Math.ceil(stageMs / 1000);
  const warning = seconds === 60 ? "One minute left on this stage." : seconds === 10 ? "Ten seconds left on this stage." : "";
  return (
    <>
      <span className="clock" role="timer" aria-live="off" aria-label={`Time left on this stage: ${formatClock(stageMs)}`} data-low={seconds <= 30} data-testid="clock">
        {formatClock(stageMs)}
        {paused ? <small>paused</small> : totalMs !== null ? <small>{formatClock(totalMs)} total</small> : null}
      </span>
      <span className="sr-only" aria-live="assertive">{warning}</span>
    </>
  );
}
