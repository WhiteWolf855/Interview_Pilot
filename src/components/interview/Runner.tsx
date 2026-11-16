"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, fetchDebrief, fetchFollowUp, fetchStageFeedback } from "@/lib/client/api";
import { useSession } from "@/lib/client/useSession";
import {
  advance, beginStage, completeStation, currentStage, endConversationEarly, expireConversation, isExpired, receiveFollowUp,
  setDebrief, setDraft, setFeedback, setStationState, stageRemainingMs, submitAnswer, totalRemainingMs, type Session,
} from "@/lib/interview/machine";
import { initialStationState, stationResult } from "@/lib/interview/stationState";
import type { Stage } from "@/lib/schemas/plan";
import { browserExecutor } from "@/lib/stations/code/runner";
import { Clock } from "./Clock";
import { Conversation } from "./Conversation";
import { StationHost } from "./StationHost";

const MODE_LABEL = { timed: "Timed", untimed: "Untimed", prep: "Prep" } as const;
const message = (error: unknown) => (error instanceof ApiClientError ? error.message : "Something went wrong. Please try again.");

function begin(session: Session): Session {
  const stage = currentStage(session);
  return beginStage(session, Date.now(), stage?.kind === "hands_on" ? initialStationState(stage) : null);
}

function Hints({ stage }: { stage: Stage }) {
  return (
    <details className="card">
      <summary>What the interviewer is looking for</summary>
      <p>{stage.intent}</p>
      <ul>
        {stage.rubric.criteria.map((criterion) => (
          <li key={criterion}>{criterion}</li>
        ))}
      </ul>
    </details>
  );
}

export function Runner() {
  const router = useRouter();
  const { session, loaded, update, latest } = useSession();
  const [now, setNow] = useState(() => Date.now());
  const [followUpError, setFollowUpError] = useState("");
  const [followUpAttempt, setFollowUpAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [gradeError, setGradeError] = useState("");
  const [gradeAttempt, setGradeAttempt] = useState(0);
  const [feedbackError, setFeedbackError] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(new Set<string>());

  const stage = session ? currentStage(session) : null;
  const phase = session?.phase;
  const index = session?.index ?? 0;
  const current = session?.current ?? null;

  useEffect(() => {
    if (loaded && !session) router.replace("/");
  }, [loaded, session, router]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  // After the first stage, each new stage starts by itself.
  useEffect(() => {
    if (phase === "ready" && index > 0) update(begin, { immediate: true });
  }, [phase, index, update]);

  // Move focus to the stage heading when the stage changes.
  useEffect(() => {
    if (phase === "active" || phase === "feedback") headingRef.current?.focus({ preventScroll: false });
  }, [phase, index]);

  // Ask for the follow-up whenever the session is waiting for one.
  const waitingKey = current && current.waitingSince !== null ? `${current.stageId}:${current.turns.length}:${followUpAttempt}` : "";
  useEffect(() => {
    const live = latest.current;
    const liveStage = live ? currentStage(live) : null;
    if (!waitingKey || !live?.current || !liveStage || liveStage.kind !== "conversation" || inFlight.current.has(waitingKey)) return;
    inFlight.current.add(waitingKey);
    setFollowUpError("");
    const stageId = live.current.stageId;
    fetchFollowUp({ token: live.token, plan: live.plan, stage: liveStage, turns: live.current.turns })
      .then((question) => update((s) => (s.current?.stageId === stageId ? receiveFollowUp(s, question, Date.now()) : s), { immediate: true }))
      .catch((error) => setFollowUpError(message(error)));
  }, [waitingKey, latest, update]);

  const finishStation = useCallback(
    async (timedOut: boolean) => {
      const live = latest.current;
      const liveStage = live ? currentStage(live) : null;
      if (!live?.current?.stationState || !liveStage || liveStage.kind !== "hands_on") return;
      const key = `station:${liveStage.id}`;
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      setSubmitting(true);
      try {
        const result = await stationResult(liveStage, live.current.stationState, browserExecutor);
        update((s) => (s.current?.stageId === liveStage.id ? completeStation(s, result, timedOut) : s), { immediate: true });
      } finally {
        setSubmitting(false);
      }
    },
    [latest, update],
  );

  // Time is up: keep what is there and move on.
  const expired = session ? isExpired(session, now) : false;
  useEffect(() => {
    if (!expired) return;
    const live = latest.current;
    const liveStage = live ? currentStage(live) : null;
    if (!live || !liveStage) return;
    if (liveStage.kind === "conversation") update(expireConversation, { immediate: true });
    else void finishStation(true);
  }, [expired, latest, update, finishStation]);

  // Prep mode: fetch feedback for the stage just completed.
  const lastRecord = session?.records[session.records.length - 1];
  const feedbackKey = phase === "feedback" && lastRecord && !session?.feedback[lastRecord.stageId] ? `feedback:${lastRecord.stageId}:${gradeAttempt}` : "";
  useEffect(() => {
    const live = latest.current;
    const record = live?.records[live.records.length - 1];
    if (!feedbackKey || !live || !record || inFlight.current.has(feedbackKey)) return;
    inFlight.current.add(feedbackKey);
    setFeedbackError("");
    fetchStageFeedback(live.token, live.plan, record)
      .then((grade) => update((s) => setFeedback(s, grade), { immediate: true }))
      .catch((error) => setFeedbackError(message(error)));
  }, [feedbackKey, latest, update]);

  // The interview is over: grade it, then show the debrief.
  const hasDebrief = Boolean(session?.debrief);
  useEffect(() => {
    if (phase !== "finished") return;
    if (hasDebrief) {
      router.replace("/debrief");
      return;
    }
    const live = latest.current;
    const key = `grade:${gradeAttempt}`;
    if (!live || inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setGradeError("");
    fetchDebrief(live.token, live.plan, live.records)
      .then((debrief) => update((s) => setDebrief(s, debrief), { immediate: true }))
      .catch((error) => setGradeError(message(error)));
  }, [phase, hasDebrief, gradeAttempt, latest, update, router]);

  if (!loaded || !session) {
    return (
      <main id="main">
        <div className="row" role="status"><span className="spinner" aria-hidden="true" /> Loading your interview</div>
      </main>
    );
  }

  const { plan } = session;
  const total = plan.stages.length;
  const interviewer = plan.interviewerTitle || "Interviewer";

  if (phase === "finished") {
    return (
      <main id="main">
        {gradeError ? (
          <div className="notice bad stack" role="alert">
            <h1>We could not grade your interview</h1>
            <p>{gradeError}</p>
            <p className="muted">Your answers are saved on this device. Nothing has been lost.</p>
            <button type="button" className="btn primary" onClick={() => setGradeAttempt((n) => n + 1)}>Try grading again</button>
          </div>
        ) : (
          <div className="card stack" role="status" aria-live="polite">
            <h1>Grading your interview</h1>
            <div className="row"><span className="spinner" aria-hidden="true" /> Reading every answer against its rubric</div>
            <p className="muted">This usually takes up to a minute. Keep this page open.</p>
          </div>
        )}
      </main>
    );
  }

  if (phase === "ready" && index === 0) {
    const minutes = Math.round(plan.stages.reduce((sum, s) => sum + s.seconds, 0) / 60);
    return (
      <main id="main">
        <div className="card stack">
          <h1>{plan.role.title}{plan.role.company ? ` at ${plan.role.company}` : ""}</h1>
          <p className="muted">
            {total} stages: {plan.stages.filter((s) => s.kind === "conversation").length} conversation and {plan.stages.filter((s) => s.kind === "hands_on").length} hands-on. Mode: {MODE_LABEL[session.mode]}.
          </p>
          <h2>Before you start</h2>
          <ul>
            <li>The stages come in a fixed order and you cannot go back to an earlier one.</li>
            <li>In a conversation stage you answer one question, then two follow-ups about what you said.</li>
            {session.mode === "timed" ? (
              <li>About {minutes} minutes in total. Each stage has its own clock. When it reaches zero, your answer is taken as it stands.</li>
            ) : (
              <li>There is no clock in this mode.</li>
            )}
            {session.mode === "prep" ? <li>You can see what the interviewer is looking for, and you get feedback after each stage.</li> : null}
            <li>You are never expected to claim experience you do not have. An honest gap with a sound approach is a good answer.</li>
          </ul>
          <button type="button" className="btn primary block" onClick={() => update(begin, { immediate: true })}>Start the interview</button>
        </div>
      </main>
    );
  }

  const shownStage = phase === "feedback" ? plan.stages.find((s) => s.id === lastRecord?.stageId) ?? null : stage;
  const stageNumber = shownStage ? plan.stages.indexOf(shownStage) + 1 : index + 1;
  const stageMs = stageRemainingMs(session, now);
  const header = (
    <div className="statusbar">
      <div className="statusbar-inner">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="small muted">Stage {stageNumber} of {total} · {MODE_LABEL[session.mode]}</div>
          <div className="progress" role="progressbar" aria-label="Interview progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={stageNumber}>
            <div style={{ width: `${(stageNumber / total) * 100}%` }} />
          </div>
        </div>
        {stageMs !== null ? <Clock stageMs={stageMs} totalMs={totalRemainingMs(session, now)} paused={current?.waitingSince != null} /> : null}
      </div>
    </div>
  );

  if (phase === "feedback" && shownStage && lastRecord) {
    const grade = session.feedback[lastRecord.stageId];
    const isLast = index + 1 >= total;
    return (
      <>
        {header}
        <main id="main">
          <div className="stack">
            <h1 ref={headingRef} tabIndex={-1}>Feedback: {shownStage.title}</h1>
            {grade ? (
              <div className="card stack" data-testid="stage-feedback">
                <div className="spread">
                  <strong>{grade.verdict}</strong>
                  <span className="score" data-band={grade.score >= 4 ? "high" : grade.score >= 3 ? "mid" : "low"}>{grade.score}<small>/5</small></span>
                </div>
                {grade.strong.length ? (<div><h3>What was strong</h3><ul>{grade.strong.map((item) => <li key={item}>{item}</li>)}</ul></div>) : null}
                {grade.missing.length ? (<div><h3>What was missing</h3><ul>{grade.missing.map((item) => <li key={item}>{item}</li>)}</ul></div>) : null}
              </div>
            ) : feedbackError ? (
              <div className="notice bad stack" role="alert">
                <p>{feedbackError}</p>
                <button type="button" className="btn" onClick={() => setGradeAttempt((n) => n + 1)}>Try again</button>
              </div>
            ) : (
              <div className="row" role="status"><span className="spinner" aria-hidden="true" /> Getting feedback on this stage</div>
            )}
            <button type="button" className="btn primary block" onClick={() => update(advance, { immediate: true })}>
              {isLast ? "Finish and see the full debrief" : "Next stage"}
            </button>
          </div>
        </main>
      </>
    );
  }

  if (!stage || !current) {
    return (
      <main id="main">
        <div className="row" role="status"><span className="spinner" aria-hidden="true" /> Loading the next stage</div>
      </main>
    );
  }

  return (
    <>
      {header}
      <main id="main" className={stage.kind === "hands_on" ? "wide" : undefined}>
        <div className="stack">
          <div>
            <span className="tag">{stage.kind === "hands_on" ? "Hands-on exercise" : "Conversation"}</span>
            <h1 ref={headingRef} tabIndex={-1} style={{ marginTop: "0.35rem" }} data-testid="stage-title">{stage.title}</h1>
            {stage.kind === "hands_on" ? <p className="muted">{stage.brief}</p> : null}
          </div>
          {session.mode === "prep" ? <Hints stage={stage} /> : null}
          {stage.kind === "conversation" ? (
            <Conversation
              current={current}
              interviewer={interviewer}
              followUpError={followUpError}
              onDraft={(draft) => update((s) => setDraft(s, draft))}
              onSubmit={() => update((s) => submitAnswer(s, s.current?.draft ?? "", Date.now()).session, { immediate: true })}
              onRetryFollowUp={() => setFollowUpAttempt((n) => n + 1)}
              onMoveOn={() => {
                setFollowUpError("");
                update(endConversationEarly, { immediate: true });
              }}
            />
          ) : current.stationState ? (
            <StationHost
              stage={stage}
              state={current.stationState}
              submitting={submitting}
              onChange={(state) => update((s) => (s.current?.stageId === stage.id ? setStationState(s, state) : s))}
              onSubmit={() => void finishStation(false)}
            />
          ) : null}
        </div>
      </main>
    </>
  );
}
