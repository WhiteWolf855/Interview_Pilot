"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { MODES, type InterviewMode } from "@/lib/config";
import { exportDebrief, signalLabel } from "@/lib/interview/export";
import { rerun, type Session } from "@/lib/interview/machine";
import { clearSession, loadHistory, loadSession, removeSavedDebrief, saveDebrief, saveSession, type SavedDebrief } from "@/lib/interview/storage";

const band = (score: number) => (score >= 4 ? "high" : score >= 3 ? "mid" : "low");
const MODE_LABEL: Record<InterviewMode, string> = { timed: "Timed", untimed: "Untimed", prep: "Prep" };

function fromSession(session: Session): SavedDebrief | null {
  if (!session.debrief) return null;
  return {
    id: `${session.plan.id}-${session.debrief.gradedAt}`,
    savedAt: session.debrief.gradedAt,
    roleTitle: session.plan.role.title,
    company: session.plan.role.company,
    mode: session.mode,
    debrief: session.debrief,
    stages: session.plan.stages.map((s) => ({ id: s.id, title: s.title, question: s.kind === "conversation" ? s.openingQuestion : s.brief })),
    records: session.records,
  };
}

export function DebriefView() {
  const router = useRouter();
  const savedId = useSearchParams().get("saved");
  const [loaded, setLoaded] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<SavedDebrief | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [status, setStatus] = useState("");
  const [mode, setMode] = useState<InterviewMode>("timed");

  useEffect(() => {
    const stored = loadSession();
    const history = loadHistory();
    setSession(stored);
    if (savedId) {
      setView(history.find((h) => h.id === savedId) ?? null);
      setIsSaved(true);
    } else if (stored) {
      const current = fromSession(stored);
      setView(current);
      setIsSaved(Boolean(current && history.some((h) => h.id === current.id)));
      setMode(stored.mode);
    }
    setLoaded(true);
  }, [savedId]);

  if (!loaded) return <div className="row" role="status"><span className="spinner" aria-hidden="true" /> Loading your debrief</div>;

  if (!view) {
    return (
      <div className="card stack">
        <h1>No debrief to show</h1>
        <p className="muted">{session && !session.debrief ? "Your interview is not finished yet." : "Finish an interview to get a debrief."}</p>
        <Link className="btn primary" href={session && !session.debrief ? "/interview" : "/"}>{session && !session.debrief ? "Continue interview" : "Set up an interview"}</Link>
      </div>
    );
  }

  const { debrief } = view;
  const ownsSession = !savedId && session?.debrief;

  return (
    <div className="stack">
      <div>
        <h1>Your debrief</h1>
        <p className="muted">
          {view.roleTitle}{view.company ? ` at ${view.company}` : ""} · {MODE_LABEL[view.mode as InterviewMode] ?? view.mode} · {new Date(debrief.gradedAt).toLocaleDateString()}
        </p>
      </div>

      <section className="card stack" aria-labelledby="overall-heading">
        <h2 id="overall-heading" className="sr-only">Overall result</h2>
        <div className="spread">
          <div>
            <div className="big-score" data-testid="average">{debrief.average.toFixed(1)}<span className="muted" style={{ fontSize: "1rem", fontWeight: 600 }}> out of 5</span></div>
            <div className="muted small">Average across {debrief.stages.length} stages</div>
          </div>
          <span className="tag" style={{ fontSize: "0.9rem" }}>Signal: {signalLabel(debrief.hireSignal)}</span>
        </div>
        <p>{debrief.overallSummary}</p>
      </section>

      {debrief.tighterAnswer ? (
        <section className="card stack" aria-labelledby="tighter-heading">
          <h2 id="tighter-heading">A tighter version of your weakest answer</h2>
          <p className="muted">{debrief.tighterAnswer.question}</p>
          <p className="quote" data-testid="tighter">{debrief.tighterAnswer.answer}</p>
          <p className="hint">
            Built only from what you said in the interview. Text in [brackets] marks a detail you did not give and should add yourself. Nothing has been invented for you.
          </p>
        </section>
      ) : null}

      <section className="stack" aria-labelledby="stages-heading">
        <h2 id="stages-heading">Stage by stage</h2>
        {debrief.stages.map((grade, index) => {
          const record = view.records.find((r) => r.stageId === grade.stageId);
          const stage = view.stages.find((s) => s.id === grade.stageId);
          return (
            <article className="card stack" key={grade.stageId} data-testid="stage-grade" style={{ gap: "0.6rem" }}>
              <div className="spread" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
                <div>
                  <span className="tag">{index + 1}. {grade.kind === "hands_on" ? "Hands-on" : "Conversation"}{record?.timedOut ? " · time ran out" : ""}</span>
                  <h3 style={{ marginTop: "0.35rem" }}>{grade.title}</h3>
                </div>
                <span className="score" data-band={band(grade.score)} aria-label={`Score ${grade.score} out of 5`}>{grade.score}<small>/5</small></span>
              </div>
              {grade.verdict ? <p>{grade.verdict}</p> : null}
              {grade.strong.length ? (<div><h4 className="small" style={{ margin: 0 }}>What was strong</h4><ul>{grade.strong.map((item) => <li key={item}>{item}</li>)}</ul></div>) : null}
              {grade.missing.length ? (<div><h4 className="small" style={{ margin: 0 }}>What was missing</h4><ul>{grade.missing.map((item) => <li key={item}>{item}</li>)}</ul></div>) : null}
              {record?.station?.checks.length ? (
                <details>
                  <summary>Automatic checks ({record.station.checks.filter((c) => c.passed).length} of {record.station.checks.length} passed)</summary>
                  <ul className="checklist">
                    {record.station.checks.map((check, i) => (
                      <li key={i}><span className={check.passed ? "pass" : "fail"} aria-hidden="true">{check.passed ? "✓" : "✗"}</span><span><span className="sr-only">{check.passed ? "Passed: " : "Failed: "}</span>{check.label}</span></li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {record?.turns.length ? (
                <details>
                  <summary>Your answers</summary>
                  <div className="stack" style={{ gap: "0.5rem" }}>
                    {record.turns.map((turn, i) => (
                      <div key={i}><p className="muted small" style={{ marginBottom: "0.15rem" }}>{turn.question}</p><p style={{ whiteSpace: "pre-wrap" }}>{turn.answer || "(no answer)"}</p></div>
                    ))}
                  </div>
                </details>
              ) : !record && stage ? (<p className="muted small">Not reached.</p>) : null}
            </article>
          );
        })}
      </section>

      <section className="card stack no-print" aria-labelledby="keep-heading">
        <h2 id="keep-heading">Keep this debrief</h2>
        <div className="row">
          {ownsSession ? (
            <button
              type="button"
              className="btn primary"
              disabled={isSaved}
              onClick={() => {
                const saved = session && saveDebrief(session);
                setIsSaved(Boolean(saved));
                setStatus(saved ? "Saved on this device. You can open it again from the start page." : "It could not be saved. This device's storage may be full.");
              }}
            >
              {isSaved ? "Saved on this device" : "Save on this device"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            onClick={async () => {
              try {
                const result = await exportDebrief(view);
                setStatus(result === "shared" ? "Opened the share sheet." : "Downloaded as a Markdown file.");
              } catch {
                setStatus("The export did not finish. Please try again.");
              }
            }}
          >
            Export as a file
          </button>
          <button type="button" className="btn" onClick={() => window.print()}>Print or save as PDF</button>
          {savedId ? (
            <button type="button" className="btn danger" onClick={() => { removeSavedDebrief(view.id); router.push("/"); }}>Delete this saved debrief</button>
          ) : null}
        </div>
        <p className="hint" role="status" aria-live="polite">{status}</p>
      </section>

      <section className="card stack no-print" aria-labelledby="again-heading">
        <h2 id="again-heading">Go again</h2>
        {ownsSession ? (
          <>
            <div className="field">
              <label htmlFor="rerun-mode">Rerun the same interview in this mode</label>
              <select id="rerun-mode" className="input" value={mode} onChange={(e) => setMode(e.target.value as InterviewMode)}>
                {MODES.map((value) => <option key={value} value={value}>{MODE_LABEL[value]}</option>)}
              </select>
              <span className="hint">Same questions and exercises, fresh answers. Save this debrief first if you want to keep it.</span>
            </div>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                if (!session) return;
                saveSession(rerun(session, mode, Date.now()));
                router.push("/interview");
              }}
            >
              Rerun this interview
            </button>
          </>
        ) : null}
        <button type="button" className="btn" onClick={() => { if (ownsSession) clearSession(); router.push("/"); }}>
          Set up a new interview
        </button>
      </section>

      <p className="hint">Scores and feedback are an AI&apos;s assessment of a practice interview. They are not a hiring decision and can be wrong.</p>
    </div>
  );
}
