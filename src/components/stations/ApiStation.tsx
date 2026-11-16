"use client";

import { useState } from "react";
import type { StationState } from "@/lib/interview/stationState";
import type { ApiConfig } from "@/lib/schemas/stations";
import { sendRequest } from "@/lib/stations/api/sim";

type State = Extract<StationState, { station: "api" }>;
const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"];

function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const index = line.indexOf(":");
    if (index > 0) headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return headers;
}

export function ApiStation({ config, state, onChange }: { config: ApiConfig; state: State; onChange: (state: State) => void }) {
  const [shown, setShown] = useState(state.exchanges.length - 1);
  const draft = state.draft;
  const setDraft = (change: Partial<State["draft"]>) => onChange({ ...state, draft: { ...draft, ...change } });
  const hasBody = ["POST", "PATCH", "PUT"].includes(draft.method);

  function send() {
    const { state: api, response } = sendRequest(config, state.api, {
      method: draft.method,
      path: draft.path,
      headers: parseHeaders(draft.headers),
      body: hasBody ? draft.body : "",
    });
    const exchanges = [...state.exchanges, { method: draft.method, path: draft.path, response }].slice(-30);
    onChange({ ...state, api, exchanges });
    setShown(exchanges.length - 1);
  }

  const current = state.exchanges[shown];

  return (
    <div className="stack">
      <details className="card" open>
        <summary>API reference</summary>
        <div className="stack small" style={{ gap: "0.5rem" }}>
          <p>Base URL: <span className="mono">{config.baseUrl}</span>. Enter paths such as <span className="mono">/{config.collections[0]?.name}</span>.</p>
          {config.authToken ? (
            <p>Every request needs this header: <span className="mono">Authorization: Bearer {config.authToken}</span></p>
          ) : (
            <p>No authentication is needed.</p>
          )}
          {config.collections.map((collection) => (
            <div key={collection.name}>
              <strong className="mono">/{collection.name}</strong> {collection.description}
              <div className="mono muted">
                {collection.fields.map((f) => `${f.name}: ${f.type}${f.required ? "" : "?"}`).join(", ")}
              </div>
            </div>
          ))}
          <p className="muted">
            For each collection: GET /name (filter with ?field=value, also limit and offset), GET /name/id, POST /name, PATCH /name/id,
            PUT /name/id, DELETE /name/id. Bodies are JSON.
          </p>
        </div>
      </details>

      <div className="card stack">
        <div className="prompt-row">
          <div className="field" style={{ flex: "none" }}>
            <label htmlFor="api-method" className="small">Method</label>
            <select id="api-method" className="input mono" value={draft.method} onChange={(e) => setDraft({ method: e.target.value })}>
              {METHODS.map((method) => (
                <option key={method}>{method}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 0 }}>
            <label htmlFor="api-path" className="small">Path</label>
            <input id="api-path" className="input mono" value={draft.path} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setDraft({ path: e.target.value })} onKeyDown={(e) => e.key === "Enter" && send()} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="api-headers" className="small">Headers, one per line</label>
          <textarea id="api-headers" className="input mono" rows={2} value={draft.headers} placeholder="Name: value" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setDraft({ headers: e.target.value })} />
        </div>
        {hasBody ? (
          <div className="field">
            <label htmlFor="api-body" className="small">JSON body</label>
            <textarea id="api-body" className="input mono" rows={4} value={draft.body} autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setDraft({ body: e.target.value })} />
          </div>
        ) : null}
        <button type="button" className="btn primary" onClick={send}>Send request</button>
      </div>

      <div aria-live="polite">
        {current ? (
          <div className="stack" style={{ gap: "0.5rem" }}>
            <div className="spread">
              <strong className="mono">
                {current.method} {current.path}
              </strong>
              <span className={current.response.status < 400 ? "pass" : "fail"}>
                {current.response.status} {current.response.statusText}
              </span>
            </div>
            <div className="screen" tabIndex={0} aria-label="Response body" style={{ height: "auto", maxHeight: "16rem" }}>
              {current.response.body === null ? "(no content)" : JSON.stringify(current.response.body, null, 2)}
            </div>
          </div>
        ) : (
          <p className="hint">Responses appear here.</p>
        )}
      </div>

      {state.exchanges.length > 1 ? (
        <details>
          <summary>Request history ({state.exchanges.length})</summary>
          <ul className="checklist">
            {state.exchanges.map((exchange, index) => (
              <li key={index}>
                <button type="button" className="btn quiet mono small" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => setShown(index)}>
                  {exchange.method} {exchange.path} → {exchange.response.status}
                </button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {config.answerPrompt ? (
        <div className="field">
          <label htmlFor="api-answer">{config.answerPrompt}</label>
          <input id="api-answer" className="input" value={state.answer} maxLength={300} onChange={(e) => onChange({ ...state, answer: e.target.value })} />
        </div>
      ) : null}
    </div>
  );
}
