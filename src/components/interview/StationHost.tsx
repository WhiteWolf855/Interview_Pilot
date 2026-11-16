"use client";

import { ApiStation } from "@/components/stations/ApiStation";
import { CodeStation } from "@/components/stations/CodeStation";
import { DataStation } from "@/components/stations/DataStation";
import { TerminalStation } from "@/components/stations/TerminalStation";
import { WrittenStation } from "@/components/stations/WrittenStation";
import { LIMITS } from "@/lib/config";
import type { StationState } from "@/lib/interview/stationState";
import type { HandsOnStage } from "@/lib/schemas/plan";

function Brief({ stage, state }: { stage: HandsOnStage; state: StationState }) {
  // The code station may have swapped in the built-in scenario, which shows its own brief.
  if (stage.station === "code" && state.station === "code" && state.prepared?.usedFallback) return null;
  const config = stage.config;
  return (
    <div className="card stack" style={{ gap: "0.5rem" }}>
      <p style={{ whiteSpace: "pre-wrap" }}>{config.scenario}</p>
      {"task" in config ? <p><strong>Your task:</strong> {config.task}</p> : null}
    </div>
  );
}

export function StationHost({
  stage,
  state,
  submitting,
  onChange,
  onSubmit,
}: {
  stage: HandsOnStage;
  state: StationState;
  submitting: boolean;
  onChange: (state: StationState) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="split">
      <div className="stack">
        <Brief stage={stage} state={state} />
      </div>
      <div className="stack">
        {stage.station === "terminal" && state.station === "terminal" ? <TerminalStation config={stage.config} state={state} onChange={onChange} /> : null}
        {stage.station === "code" && state.station === "code" ? <CodeStation config={stage.config} state={state} onChange={onChange} /> : null}
        {stage.station === "api" && state.station === "api" ? <ApiStation config={stage.config} state={state} onChange={onChange} /> : null}
        {stage.station === "data" && state.station === "data" ? <DataStation config={stage.config} state={state} onChange={onChange} /> : null}
        {stage.station === "written" && state.station === "written" ? <WrittenStation config={stage.config} state={state} onChange={onChange} /> : null}

        <div className="field">
          <label htmlFor="station-notes">Explain your approach (optional)</label>
          <span className="hint" id="notes-hint">
            What you did and why, or what you would do with more time. If this is new to you, say so and describe how you would tackle it.
          </span>
          <textarea
            id="station-notes"
            className="input"
            rows={3}
            value={state.notes}
            maxLength={LIMITS.notesMaxChars}
            aria-describedby="notes-hint"
            onChange={(e) => onChange({ ...state, notes: e.target.value })}
          />
        </div>
        <button type="button" className="btn primary block" onClick={onSubmit} disabled={submitting}>
          {submitting ? <span className="spinner" aria-hidden="true" /> : null}
          {submitting ? "Checking your work" : "Submit exercise"}
        </button>
        <p className="hint">You cannot come back to this exercise after you submit it.</p>
      </div>
    </div>
  );
}
