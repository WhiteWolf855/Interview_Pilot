"use client";

import { useEffect, useRef } from "react";
import { useDictation } from "@/lib/client/useDictation";
import { LIMITS } from "@/lib/config";
import type { CurrentStage } from "@/lib/interview/machine";

export function Conversation({
  current,
  interviewer,
  followUpError,
  onDraft,
  onSubmit,
  onRetryFollowUp,
  onMoveOn,
}: {
  current: CurrentStage;
  interviewer: string;
  followUpError: string;
  onDraft: (draft: string) => void;
  onSubmit: () => void;
  onRetryFollowUp: () => void;
  onMoveOn: () => void;
}) {
  const waiting = current.waitingSince !== null;
  const questionRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(current.draft);
  draftRef.current = current.draft;
  const dictation = useDictation((text) => onDraft(`${draftRef.current}${draftRef.current && !draftRef.current.endsWith(" ") ? " " : ""}${text}`));

  // When a follow-up arrives, put the cursor back in the answer box. On a new stage the
  // stage heading takes focus instead, so its title is announced.
  useEffect(() => {
    if (!waiting && current.turns.length > 0) {
      inputRef.current?.focus({ preventScroll: true });
      // Show the new question at the top, with the answer box right below it.
      questionRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [current.turns.length, current.question, waiting]);

  return (
    <div className="stack">
      <div className="stack" style={{ gap: "0.6rem" }} aria-live="polite" aria-relevant="additions">
        {current.turns.map((turn, index) => (
          <div key={index} className="stack" style={{ gap: "0.6rem" }}>
            <div className="bubble them"><span className="who">{interviewer}</span>{turn.question}</div>
            <div className="bubble me"><span className="who">You</span>{turn.answer || "(no answer)"}</div>
          </div>
        ))}
        {current.question ? (
          <div className="bubble them" data-testid="question" ref={questionRef}><span className="who">{interviewer}</span>{current.question}</div>
        ) : null}
        {waiting && !followUpError ? (
          <div className="bubble them" role="status">
            <span className="who">{interviewer}</span>
            <span className="dots" aria-hidden="true"><span /><span /><span /></span>
            <span className="sr-only">The interviewer is thinking</span>
          </div>
        ) : null}
      </div>

      {followUpError ? (
        <div className="notice bad stack" role="alert" style={{ gap: "0.5rem" }}>
          <p>{followUpError}</p>
          <div className="row">
            <button type="button" className="btn primary" onClick={onRetryFollowUp}>Try again</button>
            <button type="button" className="btn" onClick={onMoveOn}>Move on to the next stage</button>
          </div>
        </div>
      ) : null}

      {!waiting ? (
        <form
          className="composer stack"
          style={{ gap: "0.5rem" }}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="field">
            <label htmlFor="answer">Your answer</label>
            <textarea
              id="answer"
              ref={inputRef}
              className="input"
              rows={5}
              value={current.draft}
              maxLength={LIMITS.answerMaxChars}
              aria-describedby="answer-hint"
              onChange={(e) => onDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  onSubmit();
                }
              }}
            />
            <span id="answer-hint" className="hint">
              Answer as you would out loud. If you have not done something, say so and explain how you would approach it.
            </span>
          </div>
          {dictation.error ? <p className="hint" role="alert">{dictation.error}</p> : null}
          <div className="row">
            <button type="submit" className="btn primary" style={{ flex: 1 }}>
              {current.draft.trim() ? "Send answer" : "Skip this question"}
            </button>
            {dictation.supported ? (
              <button type="button" className="btn" aria-pressed={dictation.listening} onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}>
                {dictation.listening ? "Stop dictating" : "Dictate"}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
