"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { StationState } from "@/lib/interview/stationState";
import type { TerminalConfig } from "@/lib/schemas/stations";
import { runCommand, writeFile } from "@/lib/stations/terminal/sim";

type State = Extract<StationState, { station: "terminal" }>;
const KEYS = ["|", "/", "-", ">", "~", "*", '"', "'", "."];
const MAX_SCREEN = 400;

export function TerminalStation({ config, state, onChange }: { config: TerminalConfig; state: State; onChange: (state: State) => void }) {
  const [line, setLine] = useState("");
  const [cursor, setCursor] = useState(-1);
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const screen = screenRef.current;
    if (screen) screen.scrollTop = screen.scrollHeight;
  }, [state.screen.length]);

  const prompt = `${state.term.cwd.replace(state.term.home, "~")} $`;

  function run() {
    const command = line.trim();
    if (!command) return;
    const outcome = runCommand(state.term, command);
    let screen = outcome.clear ? [] : [...state.screen, { kind: "in" as const, text: `${prompt} ${command}` }];
    if (outcome.output) screen.push({ kind: "out", text: outcome.output.replace(/\n$/, "") });
    if (screen.length > MAX_SCREEN) screen = screen.slice(-MAX_SCREEN);
    onChange({ ...state, term: outcome.state, screen });
    setLine("");
    setCursor(-1);
    if (outcome.editPath) setEditing({ path: outcome.editPath, content: outcome.state.files[outcome.editPath] ?? "" });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const history = state.term.history;
    if (event.key === "Enter") {
      event.preventDefault();
      run();
    } else if (event.key === "ArrowUp" && history.length) {
      event.preventDefault();
      const next = cursor === -1 ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(next);
      setLine(history[next] ?? "");
    } else if (event.key === "ArrowDown" && cursor !== -1) {
      event.preventDefault();
      const next = cursor + 1;
      setCursor(next >= history.length ? -1 : next);
      setLine(next >= history.length ? "" : history[next] ?? "");
    }
  }

  function insert(key: string) {
    const input = inputRef.current;
    const at = input?.selectionStart ?? line.length;
    setLine(line.slice(0, at) + key + line.slice(input?.selectionEnd ?? at));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(at + key.length, at + key.length);
    });
  }

  const files = Object.keys(state.term.files).sort();

  return (
    <div className="stack">
      <div className="screen" ref={screenRef} role="log" aria-label="Terminal output" tabIndex={0}>
        {state.screen.length === 0 ? <div style={{ opacity: 0.7 }}>Simulated terminal. Type help to see the available commands.</div> : null}
        {state.screen.map((entry, index) => (
          <div key={index} className={entry.kind}>{entry.text}</div>
        ))}
      </div>
      <div className="field">
        <label htmlFor="terminal-input">Command <span className="hint mono">{prompt}</span></label>
        <div className="prompt-row">
          <input
            id="terminal-input"
            ref={inputRef}
            className="input mono"
            value={line}
            onChange={(e) => setLine(e.target.value)}
            onKeyDown={onKeyDown}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="send"
          />
          <button type="button" className="btn primary" onClick={run}>Run</button>
        </div>
        <div className="keys" aria-label="Symbol keys">
          {KEYS.map((key) => (
            <button type="button" key={key} className="btn mono" onClick={() => insert(key)} aria-label={`Insert ${key}`}>{key}</button>
          ))}
        </div>
      </div>
      <div className="row">
        <label htmlFor="terminal-file" className="small">Edit a file</label>
        <select
          id="terminal-file"
          className="input"
          style={{ width: "auto", flex: 1, minWidth: 0 }}
          value=""
          onChange={(e) => e.target.value && setEditing({ path: e.target.value, content: state.term.files[e.target.value] ?? "" })}
        >
          <option value="">Choose a file to open in the editor</option>
          {files.map((path) => (
            <option key={path} value={path}>{path}</option>
          ))}
        </select>
      </div>

      {config.answerPrompt ? (
        <div className="field">
          <label htmlFor="terminal-answer">{config.answerPrompt}</label>
          <input id="terminal-answer" className="input" value={state.answer} maxLength={300} onChange={(e) => onChange({ ...state, answer: e.target.value })} />
        </div>
      ) : null}

      {editing ? (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="editor-title">
          <div className="dialog stack">
            <h3 id="editor-title" className="mono">{editing.path}</h3>
            <label htmlFor="editor-text" className="sr-only">File contents</label>
            <textarea id="editor-text" className="input mono editor" rows={12} value={editing.content} spellCheck={false} autoCapitalize="none" autoCorrect="off" autoFocus onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
            <div className="row">
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  onChange({ ...state, term: writeFile(state.term, editing.path, editing.content), screen: [...state.screen, { kind: "out", text: `saved ${editing.path}` }] });
                  setEditing(null);
                }}
              >
                Save file
              </button>
              <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
