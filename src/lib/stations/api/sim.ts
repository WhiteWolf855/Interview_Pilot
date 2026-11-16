import type { ApiConfig } from "@/lib/schemas/stations";

/** A simulated REST API over in-memory collections. No network is involved. */

export type ApiRecord = Record<string, string | number | boolean | null>;

export interface ApiRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  body: unknown;
}

export interface ApiLogEntry {
  method: string;
  path: string;
  status: number;
}

export interface ApiState {
  collections: Record<string, ApiRecord[]>;
  log: ApiLogEntry[];
  nextId: number;
}

const STATUS_TEXT: Record<number, string> = {
  200: "OK", 201: "Created", 204: "No Content", 400: "Bad Request", 401: "Unauthorized",
  404: "Not Found", 405: "Method Not Allowed", 422: "Unprocessable Entity",
};

export function parseRecords(recordsJson: string): ApiRecord[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(recordsJson);
  } catch {
    return "records are not valid JSON";
  }
  if (!Array.isArray(parsed)) return "records must be a JSON array";
  const records: ApiRecord[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "every record must be an object";
    const record: ApiRecord = {};
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
        return `record field "${key}" must be a string, number, boolean or null`;
      }
      record[key] = value as ApiRecord[string];
    }
    if (record.id === undefined || record.id === null) return 'every record needs an "id"';
    records.push(record);
  }
  return records;
}

export function createApi(config: ApiConfig): ApiState {
  const collections: Record<string, ApiRecord[]> = {};
  for (const collection of config.collections) {
    const records = parseRecords(collection.recordsJson);
    collections[collection.name] = typeof records === "string" ? [] : records;
  }
  return { collections, log: [], nextId: 1001 };
}

function respond(status: number, body: unknown): ApiResponse {
  return { status, statusText: STATUS_TEXT[status] ?? "", body };
}

const error = (status: number, message: string) => respond(status, { error: message });

function header(headers: Record<string, string>, name: string): string {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key]!.trim() : "";
}

function validateBody(
  config: ApiConfig,
  collectionName: string,
  body: Record<string, unknown>,
  partial: boolean,
): string | null {
  const fields = config.collections.find((c) => c.name === collectionName)?.fields ?? [];
  for (const field of fields) {
    const value = body[field.name];
    if (value === undefined || value === null) {
      if (field.required && !partial && field.name !== "id") return `"${field.name}" is required`;
      continue;
    }
    if (typeof value !== field.type) return `"${field.name}" must be a ${field.type}`;
  }
  for (const key of Object.keys(body)) {
    if (key !== "id" && !fields.some((f) => f.name === key)) return `unknown field "${key}"`;
  }
  return null;
}

export function sendRequest(config: ApiConfig, previous: ApiState, request: ApiRequest): { state: ApiState; response: ApiResponse } {
  const state: ApiState = {
    collections: Object.fromEntries(Object.entries(previous.collections).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
    log: [...previous.log],
    nextId: previous.nextId,
  };
  const method = request.method.trim().toUpperCase();
  const rawPath = request.path.trim().replace(/^https?:\/\/[^/]+/i, "");
  const basePath = (() => {
    try {
      return new URL(config.baseUrl).pathname.replace(/\/$/, "");
    } catch {
      return "";
    }
  })();
  let [pathname = "", query = ""] = rawPath.split("?") as [string, string?];
  if (basePath && pathname.startsWith(basePath + "/")) pathname = pathname.slice(basePath.length);
  if (!pathname.startsWith("/")) pathname = "/" + pathname;
  const displayPath = pathname + (query ? "?" + query : "");

  const finish = (response: ApiResponse) => {
    state.log.push({ method, path: displayPath, status: response.status });
    return { state, response };
  };

  if (config.authToken) {
    const auth = header(request.headers, "authorization");
    if (!auth) return finish(error(401, "Missing Authorization header. Send: Authorization: Bearer <token>"));
    if (auth !== `Bearer ${config.authToken}`) return finish(error(401, "Invalid token"));
  }

  const segments = pathname.split("/").filter(Boolean);
  const [collectionName, id, ...extra] = segments;
  if (!collectionName) return finish(respond(200, { collections: Object.keys(state.collections) }));
  const records = state.collections[collectionName];
  if (!records || extra.length > 0) return finish(error(404, `No route for ${pathname}`));

  let body: Record<string, unknown> = {};
  if (["POST", "PUT", "PATCH"].includes(method)) {
    try {
      const parsed: unknown = JSON.parse(request.body || "");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      body = parsed as Record<string, unknown>;
    } catch {
      return finish(error(400, "Request body must be a JSON object"));
    }
  }

  if (id === undefined) {
    if (method === "GET") {
      let result = records;
      let limit = Infinity;
      let offset = 0;
      for (const [key, value] of new URLSearchParams(query)) {
        if (key === "limit") limit = Math.max(0, parseInt(value, 10) || 0);
        else if (key === "offset") offset = Math.max(0, parseInt(value, 10) || 0);
        else result = result.filter((r) => String(r[key] ?? "").toLowerCase() === value.toLowerCase());
      }
      return finish(respond(200, result.slice(offset, offset + limit)));
    }
    if (method === "POST") {
      const problem = validateBody(config, collectionName, body, false);
      if (problem) return finish(error(422, problem));
      const numericIds = records.every((r) => typeof r.id === "number");
      const newId = numericIds ? Math.max(0, ...records.map((r) => Number(r.id))) + 1 : String(state.nextId++);
      const record = { ...(body as ApiRecord), id: newId };
      records.push(record);
      return finish(respond(201, record));
    }
    return finish(error(405, `${method} is not allowed on /${collectionName}`));
  }

  const index = records.findIndex((r) => String(r.id) === id);
  if (index === -1) return finish(error(404, `${collectionName} ${id} not found`));
  const existing = records[index]!;
  if (method === "GET") return finish(respond(200, existing));
  if (method === "DELETE") {
    records.splice(index, 1);
    return finish(respond(204, null));
  }
  if (method === "PATCH" || method === "PUT") {
    const problem = validateBody(config, collectionName, body, method === "PATCH");
    if (problem) return finish(error(422, problem));
    const keepId = existing.id ?? null;
    const updated: ApiRecord = method === "PATCH" ? { ...existing, ...(body as ApiRecord), id: keepId } : { ...(body as ApiRecord), id: keepId };
    records[index] = updated;
    return finish(respond(200, updated));
  }
  return finish(error(405, `${method} is not allowed on /${collectionName}/${id}`));
}
