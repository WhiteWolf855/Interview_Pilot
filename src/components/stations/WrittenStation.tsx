"use client";

import type { StationState } from "@/lib/interview/stationState";
import type { WrittenConfig } from "@/lib/schemas/stations";
import { countWords } from "@/lib/stations/written/grade";

type State = Extract<StationState, { station: "written" }>;

export function WrittenStation({ config, state, onChange }: { config: WrittenConfig; state: State; onChange: (state: State) => void }) {
  const words = countWords(state.text);
  const inRange = words >= config.minWords && words <= config.maxWords;
  return (
    <div className="stack">
      {config.materials.map((material) => (
        <details className="card" key={material.title} open>
          <summary>{material.title}</summary>
          <p style={{ whiteSpace: "pre-wrap" }}>{material.content}</p>
        </details>
      ))}
      <div className="field">
        <label htmlFor="written-text">{config.deliverable}</label>
        <span className="hint" id="written-hint">Audience: {config.audience} Aim for {config.minWords} to {config.maxWords} words.</span>
        <textarea id="written-text" className="input" rows={12} value={state.text} maxLength={6000} aria-describedby="written-hint written-count" onChange={(e) => onChange({ ...state, text: e.target.value })} />
        <span id="written-count" className="hint" style={inRange || words === 0 ? undefined : { color: "var(--warn)" }}>
          {words} {words === 1 ? "word" : "words"}
          {words > 0 && !inRange ? (words < config.minWords ? " (below the range)" : " (above the range)") : ""}
        </span>
      </div>
    </div>
  );
}
