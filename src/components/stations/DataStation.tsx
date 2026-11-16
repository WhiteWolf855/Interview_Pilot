"use client";

import { useMemo, useState } from "react";
import type { StationState } from "@/lib/interview/stationState";
import type { DataConfig } from "@/lib/schemas/stations";
import { aggregate, groupTotals, parseNumber } from "@/lib/stations/data/compute";

type State = Extract<StationState, { station: "data" }>;

const format = (value: number) => (Number.isInteger(value) ? value.toLocaleString("en") : value.toLocaleString("en", { maximumFractionDigits: 2 }));

export function DataStation({ config, state, onChange }: { config: DataConfig; state: State; onChange: (state: State) => void }) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ column: number; descending: boolean } | null>(null);
  const numeric = config.columns.map((c, i) => ({ ...c, index: i })).filter((c) => c.type === "number");
  const textual = config.columns.map((c, i) => ({ ...c, index: i })).filter((c) => c.type === "text");
  const [statColumn, setStatColumn] = useState(numeric[0]?.name ?? "");
  const [groupBy, setGroupBy] = useState(textual[0]?.name ?? "");
  const [groupAgg, setGroupAgg] = useState<"sum" | "avg" | "count">("sum");

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let visible = needle ? config.rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(needle))) : config.rows;
    if (sort) {
      const isNumber = config.columns[sort.column]?.type === "number";
      visible = [...visible].sort((a, b) => {
        const left = a[sort.column] ?? "";
        const right = b[sort.column] ?? "";
        const order = isNumber ? (parseNumber(left) ?? 0) - (parseNumber(right) ?? 0) : left.localeCompare(right);
        return sort.descending ? -order : order;
      });
    }
    return visible;
  }, [config, filter, sort]);

  const statIndex = config.columns.findIndex((c) => c.name === statColumn);
  const values = statIndex === -1 ? [] : rows.map((row) => parseNumber(row[statIndex] ?? "") ?? 0);
  const groups = groupBy ? groupTotals(config, rows, groupBy, statColumn, groupAgg).sort((a, b) => b.value - a.value) : [];

  return (
    <div className="stack">
      <div className="field">
        <label htmlFor="data-filter">Filter rows</label>
        <input id="data-filter" className="input" value={filter} placeholder="Type to show only matching rows" onChange={(e) => setFilter(e.target.value)} />
        <span className="hint" aria-live="polite">Showing {rows.length} of {config.rows.length} rows. Select a column heading to sort.</span>
      </div>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Data table">
        <table>
          <thead>
            <tr>
              {config.columns.map((column, index) => {
                const active = sort?.column === index;
                return (
                  <th key={column.name} className={column.type === "number" ? "num" : undefined} aria-sort={active ? (sort.descending ? "descending" : "ascending") : "none"}>
                    <button type="button" onClick={() => setSort({ column: index, descending: active ? !sort.descending : false })}>
                      {column.name}
                      <span aria-hidden="true">{active ? (sort.descending ? "▼" : "▲") : "↕"}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={config.columns[cellIndex]?.type === "number" ? "num" : undefined}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card stack">
        <h3>Totals for the rows shown</h3>
        <div className="row">
          <div className="field" style={{ flex: 1, minWidth: "8rem" }}>
            <label htmlFor="data-stat" className="small">Number column</label>
            <select id="data-stat" className="input" value={statColumn} onChange={(e) => setStatColumn(e.target.value)}>
              {numeric.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: "8rem" }}>
            <label htmlFor="data-group" className="small">Group by</label>
            <select id="data-group" className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="">No grouping</option>
              {textual.map((c) => (
                <option key={c.name}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: "8rem" }}>
            <label htmlFor="data-agg" className="small">Show per group</label>
            <select id="data-agg" className="input" value={groupAgg} onChange={(e) => setGroupAgg(e.target.value as "sum" | "avg" | "count")}>
              <option value="sum">Sum</option>
              <option value="avg">Average</option>
              <option value="count">Count of rows</option>
            </select>
          </div>
        </div>
        <p className="small" aria-live="polite">
          {statColumn}: sum <strong>{format(aggregate(values, "sum"))}</strong>, average <strong>{format(aggregate(values, "avg"))}</strong>, lowest{" "}
          <strong>{values.length ? format(aggregate(values, "min")) : 0}</strong>, highest <strong>{values.length ? format(aggregate(values, "max")) : 0}</strong>, rows <strong>{values.length}</strong>
        </p>
        {groups.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{groupBy}</th>
                  <th className="num">{groupAgg === "count" ? "Rows" : `${groupAgg === "sum" ? "Sum" : "Average"} of ${statColumn}`}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.group}>
                    <td>{group.group}</td>
                    <td className="num">{format(group.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {config.questions.map((question, index) => (
        <div className="field" key={index}>
          <label htmlFor={`data-q${index}`}>{index + 1}. {question.prompt}</label>
          <input
            id={`data-q${index}`}
            className="input"
            value={state.answers[index] ?? ""}
            maxLength={100}
            inputMode={question.op.endsWith("_group") ? "text" : "decimal"}
            onChange={(e) => onChange({ ...state, answers: state.answers.map((a, i) => (i === index ? e.target.value : a)) })}
          />
        </div>
      ))}
      <div className="field">
        <label htmlFor="data-insight">{config.insightPrompt}</label>
        <textarea id="data-insight" className="input" rows={4} value={state.insight} maxLength={1500} onChange={(e) => onChange({ ...state, insight: e.target.value })} />
      </div>
    </div>
  );
}
