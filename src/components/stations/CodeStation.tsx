"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import type { StationState } from "@/lib/interview/stationState";
import type { CodeConfig } from "@/lib/schemas/stations";
import { prepareCodeScenario } from "@/lib/stations/code/grade";
import { browserExecutor, testsOf } from "@/lib/stations/code/runner";
import { LIBRARY } from "@/lib/stations/library";

type State = Extract<StationState, { station: "code" }>;

export function CodeStation({ config, state, onChange }: { config: CodeConfig; state: State; onChange: (state: State) => void }) {
  const [running, setRunning] = useState(false);

  // Check the generated scenario by running it once. If it is inconsistent, the built-in one is used.
  useEffect(() => {
    if (state.prepared) return;
    let cancelled = false;
    prepareCodeScenario(config, LIBRARY.code.config, browserExecutor).then((prepared) => {
      if (!cancelled) onChange({ ...state, prepared, code: prepared.usedFallback ? prepared.config.starterCode : state.code });
    });
    return () => {
      cancelled = true;
    };
    // Runs once per station.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.prepared]);

  if (!state.prepared) {
    return (
      <div className="row" role="status">
        <span className="spinner" aria-hidden="true" /> Preparing the exercise
      </div>
    );
  }
  const active = state.prepared.config;

  async function runTests() {
    setRunning(true);
    const outcomes = await browserExecutor(state.code, active.functionName, testsOf(active));
    onChange({ ...state, outcomes });
    setRunning(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const target = event.currentTarget;
    const { selectionStart, selectionEnd } = target;
    onChange({ ...state, code: state.code.slice(0, selectionStart) + "  " + state.code.slice(selectionEnd) });
    requestAnimationFrame(() => target.setSelectionRange(selectionStart + 2, selectionStart + 2));
  }

  const passed = state.outcomes?.filter((o) => o.passed).length ?? 0;

  return (
    <div className="stack">
      {state.prepared.usedFallback ? (
        <div className="card">
          <p><strong>{LIBRARY.code.config.scenario}</strong></p>
          <p>{active.task}</p>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="code-editor">Code (JavaScript)</label>
        <span className="hint" id="code-hint">Press Escape, then Tab, to move out of the editor with the keyboard.</span>
        <textarea
          id="code-editor"
          className="input mono editor"
          rows={14}
          value={state.code}
          aria-describedby="code-hint"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          onChange={(e) => onChange({ ...state, code: e.target.value.slice(0, 8000) })}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.blur();
            else onKeyDown(e);
          }}
        />
      </div>
      <div className="row">
        <button type="button" className="btn primary" onClick={runTests} disabled={running}>
          {running ? <span className="spinner" aria-hidden="true" /> : null}
          {running ? "Running tests" : "Run tests"}
        </button>
        <button type="button" className="btn" onClick={() => onChange({ ...state, code: active.starterCode, outcomes: null })}>Reset code</button>
      </div>
      <div aria-live="polite">
        {state.outcomes ? (
          <div className="card stack" style={{ gap: "0.5rem" }}>
            <strong>{passed} of {state.outcomes.length} tests pass</strong>
            <ul className="checklist">
              {state.outcomes.map((outcome, index) => {
                const test = active.tests[index];
                return (
                  <li key={index}>
                    <span className={outcome.passed ? "pass" : "fail"} aria-hidden="true">{outcome.passed ? "✓" : "✗"}</span>
                    <span>
                      <span className="sr-only">{outcome.passed ? "Passed: " : "Failed: "}</span>
                      {outcome.hidden ? `Hidden test ${index + 1}` : outcome.name}
                      {!outcome.passed && !outcome.hidden ? (
                        <span className="hint mono" style={{ display: "block" }}>
                          {outcome.error ? outcome.error : `expected ${test?.expectedJson} but got ${outcome.actual}`}
                          {test ? ` (input: ${test.argsJson})` : ""}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="hint">Run the tests to see what fails. Two of the tests are hidden: you see whether they pass, not their inputs.</p>
        )}
      </div>
    </div>
  );
}
