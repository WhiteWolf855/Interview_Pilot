"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiClientError, createPlan } from "@/lib/client/api";
import { INTERVIEW_LENGTHS, LIMITS, STAGE_COUNTS, type InterviewLength, type InterviewMode } from "@/lib/config";
import { createSession, type Session } from "@/lib/interview/machine";
import { clearSession, loadHistory, loadSession, saveSession, type SavedDebrief } from "@/lib/interview/storage";

const MODES: { value: InterviewMode; title: string; text: string }[] = [
  { value: "timed", title: "Timed", text: "A clock on every stage. When time is up, your answer is taken as it stands and the interview moves on." },
  { value: "untimed", title: "Untimed", text: "The same interview with no clock." },
  { value: "prep", title: "Prep", text: "No clock. See what the interviewer is looking for and get feedback after every stage." },
];

const STEPS = ["Reading your resume", "Matching it to the job description", "Writing your questions", "Building the hands-on exercises"];

export function Setup() {
  const router = useRouter();
  const [existing, setExisting] = useState<Session | null>(null);
  const [history, setHistory] = useState<SavedDebrief[]>([]);
  const [resumeMode, setResumeMode] = useState<"file" | "text">("file");
  const [file, setFile] = useState<File | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [job, setJob] = useState("");
  const [mode, setMode] = useState<InterviewMode>("timed");
  const [length, setLength] = useState<InterviewLength>(45);
  const [interviewerTitle, setInterviewerTitle] = useState("");
  const [doNotClaim, setDoNotClaim] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExisting(loadSession());
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const timer = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 9000);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function validate(): string {
    if (resumeMode === "file") {
      if (!file) return "Choose your resume file, or switch to pasting the text.";
      if (file.size > LIMITS.resumeMaxBytes) return "That file is larger than 5 MB. Try a smaller export, or paste the text.";
    } else if (resumeText.trim().length < LIMITS.resumeMinChars) {
      return "Paste the full text of your resume. A few lines is not enough to build an interview from.";
    }
    if (job.trim().length < LIMITS.jobMinChars) return "Paste the full job description. The interview is built from it.";
    return "";
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setError("");
    setBusy(true);
    const form = new FormData();
    if (resumeMode === "file" && file) form.append("resumeFile", file);
    else form.append("resumeText", resumeText);
    form.append("jobDescription", job);
    form.append("lengthMinutes", String(length));
    form.append("interviewerTitle", interviewerTitle);
    form.append("doNotClaim", doNotClaim);
    try {
      const { plan, token } = await createPlan(form);
      saveSession(createSession(plan, token, mode, Date.now()));
      router.push("/interview");
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <div className="card stack" role="status" aria-live="polite">
        <h1>Building your interview</h1>
        <p className="muted">This usually takes up to a minute. Keep this page open.</p>
        <ol className="steps">
          {STEPS.map((label, index) => (
            <li key={label} data-state={index < step ? "done" : index === step ? "now" : "todo"}>
              {index < step ? <span className="tick" aria-hidden="true">✓</span> : index === step ? <span className="spinner" aria-hidden="true" /> : <span className="tick" aria-hidden="true">·</span>}
              <span>{label}{index < step ? <span className="sr-only"> (done)</span> : null}</span>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const counts = STAGE_COUNTS[length];
  const inProgress = existing && !existing.debrief;

  return (
    <div className="stack">
      <div>
        <h1>Practise the interview for the job you want</h1>
        <p className="muted">
          Give us your resume and the job description. You get a mock interview built from both: questions about your own
          experience, hands-on exercises for the role, and a strict, graded debrief at the end.
        </p>
      </div>

      {existing ? (
        <div className="notice stack" style={{ gap: "0.5rem" }}>
          <p>
            <strong>{inProgress ? "You have an interview in progress" : "Your last interview has a debrief"}</strong>
            <br />
            <span className="muted">{existing.plan.role.title}{existing.plan.role.company ? ` at ${existing.plan.role.company}` : ""}</span>
          </p>
          <div className="row">
            <Link className="btn primary" href={inProgress ? "/interview" : "/debrief"}>
              {inProgress ? "Continue interview" : "View debrief"}
            </Link>
            <button type="button" className="btn" onClick={() => { clearSession(); setExisting(null); }}>
              Discard it
            </button>
          </div>
        </div>
      ) : null}

      <form className="card stack" onSubmit={onSubmit} noValidate aria-describedby={error ? "form-error" : undefined}>
        <h2>Set up a new interview</h2>

        <fieldset className="stack" style={{ gap: "0.5rem" }}>
          <legend className="legend">Your resume</legend>
          <div className="choices two">
            <label className="choice">
              <input type="radio" name="resumeMode" checked={resumeMode === "file"} onChange={() => setResumeMode("file")} />
              <span><strong>Upload a file</strong><span className="hint">PDF or Word (.docx), up to 5 MB</span></span>
            </label>
            <label className="choice">
              <input type="radio" name="resumeMode" checked={resumeMode === "text"} onChange={() => setResumeMode("text")} />
              <span><strong>Paste the text</strong><span className="hint">Use this for scanned or image-only resumes</span></span>
            </label>
          </div>
          {resumeMode === "file" ? (
            <div className="field">
              <label htmlFor="resumeFile">Resume file</label>
              <input
                id="resumeFile"
                className="input"
                type="file"
                accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file ? <span className="hint">Selected: {file.name}</span> : null}
            </div>
          ) : (
            <div className="field">
              <label htmlFor="resumeText">Resume text</label>
              <textarea id="resumeText" className="input" rows={8} value={resumeText} maxLength={LIMITS.resumeMaxChars} onChange={(e) => setResumeText(e.target.value)} />
            </div>
          )}
        </fieldset>

        <div className="field">
          <label htmlFor="job">Job description</label>
          <span className="hint" id="job-hint">Paste the whole posting, including the requirements and the tools it names.</span>
          <textarea id="job" className="input" rows={8} value={job} maxLength={LIMITS.jobMaxChars} aria-describedby="job-hint" onChange={(e) => setJob(e.target.value)} />
        </div>

        <fieldset className="stack" style={{ gap: "0.5rem" }}>
          <legend className="legend">Mode</legend>
          <div className="choices three">
            {MODES.map((option) => (
              <label className="choice" key={option.value}>
                <input type="radio" name="mode" checked={mode === option.value} onChange={() => setMode(option.value)} />
                <span><strong>{option.title}</strong><span className="hint">{option.text}</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor="length">Interview length</label>
          <select id="length" className="input" value={length} aria-describedby="length-hint" onChange={(e) => setLength(Number(e.target.value) as InterviewLength)}>
            {INTERVIEW_LENGTHS.map((minutes) => (
              <option key={minutes} value={minutes}>{minutes} minutes</option>
            ))}
          </select>
          <span className="hint" id="length-hint">
            {counts.conversation} conversation stages and {counts.handsOn} hands-on exercises{mode === "timed" ? "" : ". The length sets the number of stages; there is no clock in this mode"}.
          </span>
        </div>

        <details>
          <summary>Optional details</summary>
          <div className="stack" style={{ paddingTop: "0.5rem" }}>
            <div className="field">
              <label htmlFor="interviewer">Interviewer&apos;s job title</label>
              <span className="hint" id="interviewer-hint">For example: Engineering Manager, Head of Marketing. Questions are asked from this person&apos;s point of view.</span>
              <input id="interviewer" className="input" type="text" value={interviewerTitle} maxLength={LIMITS.shortFieldMaxChars} aria-describedby="interviewer-hint" onChange={(e) => setInterviewerTitle(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="doNotClaim">Things I have not done and should not claim</label>
              <span className="hint" id="dnc-hint">For example: I have not managed people. I have not used Kubernetes in production. The interviewer will never credit you with these.</span>
              <textarea id="doNotClaim" className="input" rows={3} value={doNotClaim} maxLength={LIMITS.doNotClaimMaxChars} aria-describedby="dnc-hint" onChange={(e) => setDoNotClaim(e.target.value)} />
            </div>
          </div>
        </details>

        {error ? (
          <div id="form-error" className="notice bad" role="alert" tabIndex={-1} ref={errorRef}>
            {error}
          </div>
        ) : null}

        <button type="submit" className="btn primary block">Build my interview</button>
        <p className="hint">
          Your resume is sent to our server to build the interview and is not stored there. The interview itself is kept
          only on this device. <Link href="/privacy">How your data is handled</Link>
        </p>
      </form>

      {history.length ? (
        <section className="card stack" aria-labelledby="saved-heading">
          <h2 id="saved-heading">Saved debriefs</h2>
          <ul className="checklist">
            {history.map((item) => (
              <li key={item.id} className="spread">
                <span>
                  {item.roleTitle}
                  <span className="muted small"> · {new Date(item.savedAt).toLocaleDateString()} · {item.debrief.average.toFixed(1)}/5</span>
                </span>
                <Link className="btn" href={`/debrief?saved=${encodeURIComponent(item.id)}`}>Open</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
