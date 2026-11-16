import "server-only";

/**
 * The only logging function the API routes use. It accepts a fixed set of
 * metadata fields, all short primitives, so resume text, job descriptions and
 * answers cannot end up in a log line by accident.
 */
export interface LogFields {
  route?: string;
  status?: number;
  ms?: number;
  code?: string;
  model?: string;
  attempt?: number;
  inputTokens?: number;
  outputTokens?: number;
  stations?: number;
  fallbackStations?: number;
  fileKind?: string;
}

export function logEvent(event: string, fields: LogFields = {}): void {
  const safe: Record<string, string | number> = { event, at: new Date().toISOString() };
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
    else if (typeof value === "string") safe[key] = value.replace(/[^\w.:\-/ ]/g, "").slice(0, 60);
  }
  console.log(JSON.stringify(safe));
}
