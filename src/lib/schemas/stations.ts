import { z } from "zod";

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
const values = z.array(text(200)).min(1).max(8);

/* ---------- terminal ---------- */

export const TERMINAL_CHECK_TYPES = [
  "file_contains",
  "file_not_contains",
  "file_exists",
  "file_absent",
  "command_used",
  "answer_contains",
] as const;

export const TerminalCheckSchema = z.object({
  label: text(160),
  type: z.enum(TERMINAL_CHECK_TYPES),
  /** Absolute path, for the file_* checks. Empty otherwise. */
  path: z.string().max(200),
  /** The check passes when any of these strings matches. Empty for file_exists / file_absent. */
  values: z.array(text(200)).max(8),
});

export const TerminalConfigSchema = z.object({
  scenario: text(1200),
  task: text(800),
  cwd: text(120),
  files: z
    .array(z.object({ path: text(200), content: z.string().max(6000) }))
    .min(1)
    .max(12),
  /** Empty when no typed answer is needed. */
  answerPrompt: z.string().max(300),
  checks: z.array(TerminalCheckSchema).min(2).max(6),
  solution: z.object({
    commands: z.array(text(300)).max(12),
    answer: z.string().max(300),
  }),
});
export type TerminalConfig = z.infer<typeof TerminalConfigSchema>;
export type TerminalCheck = z.infer<typeof TerminalCheckSchema>;

/* ---------- code ---------- */

export const CodeTestSchema = z.object({
  name: text(120),
  /** JSON array of arguments, as a string. */
  argsJson: text(1000),
  /** JSON value the function must return, as a string. */
  expectedJson: text(1000),
  hidden: z.boolean(),
});

export const CodeConfigSchema = z.object({
  scenario: text(1200),
  task: text(800),
  language: z.literal("javascript"),
  functionName: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,60}$/),
  starterCode: text(4000),
  tests: z.array(CodeTestSchema).min(3).max(8),
  referenceSolution: text(4000),
});
export type CodeConfig = z.infer<typeof CodeConfigSchema>;
export type CodeTest = z.infer<typeof CodeTestSchema>;

/* ---------- api ---------- */

export const API_CHECK_TYPES = [
  "request_made",
  "record_field_equals",
  "record_exists",
  "record_absent",
  "answer_contains",
] as const;

export const ApiCheckSchema = z.object({
  label: text(160),
  type: z.enum(API_CHECK_TYPES),
  /** request_made: HTTP method. */
  method: z.string().max(10),
  /** request_made: the request path must start with this, e.g. /orders. */
  pathPrefix: z.string().max(200),
  /** record_* checks: collection name. */
  collection: z.string().max(60),
  /** record_field_equals / record_absent: record id. */
  recordId: z.string().max(60),
  /** record_field_equals / record_exists: field name. */
  field: z.string().max(60),
  /** record_field_equals / record_exists: expected value, as text. */
  value: z.string().max(200),
  /** answer_contains: accepted answers. */
  values: z.array(text(200)).max(8),
});

export const ApiFieldSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,40}$/),
  type: z.enum(["string", "number", "boolean"]),
  required: z.boolean(),
});

export const ApiCollectionSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_-]{1,40}$/),
  description: z.string().max(200),
  fields: z.array(ApiFieldSchema).min(2).max(10),
  /** JSON array of flat records, as a string. Every record has an "id". */
  recordsJson: text(8000),
});

export const ApiConfigSchema = z.object({
  scenario: text(1200),
  task: text(800),
  baseUrl: text(120),
  authToken: z.string().max(80),
  collections: z.array(ApiCollectionSchema).min(1).max(4),
  answerPrompt: z.string().max(300),
  checks: z.array(ApiCheckSchema).min(2).max(6),
  solution: z.object({
    requests: z
      .array(z.object({ method: text(10), path: text(300), bodyJson: z.string().max(2000) }))
      .max(10),
    answer: z.string().max(300),
  }),
});
export type ApiConfig = z.infer<typeof ApiConfigSchema>;
export type ApiCheck = z.infer<typeof ApiCheckSchema>;

/* ---------- data ---------- */

export const DATA_OPS = ["sum", "avg", "min", "max", "count", "top_group", "bottom_group"] as const;
export const DATA_FILTER_OPS = ["none", "eq", "neq", "gt", "gte", "lt", "lte", "contains"] as const;
export const DATA_GROUP_AGGS = ["sum", "avg", "count"] as const;

export const DataQuestionSchema = z.object({
  prompt: text(300),
  op: z.enum(DATA_OPS),
  /** Column the operation runs on. For count it may be empty. */
  column: z.string().max(60),
  /** top_group / bottom_group: the column to group by. Empty otherwise. */
  groupBy: z.string().max(60),
  /** top_group / bottom_group: how each group is totalled. */
  groupAgg: z.enum(DATA_GROUP_AGGS),
  filterColumn: z.string().max(60),
  filterOp: z.enum(DATA_FILTER_OPS),
  filterValue: z.string().max(100),
});

export const DataConfigSchema = z.object({
  scenario: text(1200),
  columns: z
    .array(z.object({ name: text(60), type: z.enum(["text", "number"]) }))
    .min(3)
    .max(8),
  rows: z.array(z.array(z.string().max(100)).min(3).max(8)).min(6).max(40),
  questions: z.array(DataQuestionSchema).min(2).max(4),
  insightPrompt: text(300),
});
export type DataConfig = z.infer<typeof DataConfigSchema>;
export type DataQuestion = z.infer<typeof DataQuestionSchema>;

/* ---------- written ---------- */

export const WrittenConfigSchema = z.object({
  scenario: text(1500),
  materials: z.array(z.object({ title: text(100), content: text(2000) })).max(4),
  deliverable: text(300),
  audience: text(200),
  minWords: z.number().int().min(20).max(400),
  maxWords: z.number().int().min(60).max(600),
  mustInclude: z.array(z.object({ label: text(160), anyOf: values })).min(2).max(6),
  mustAvoid: z.array(z.object({ label: text(160), anyOf: values })).max(4),
});
export type WrittenConfig = z.infer<typeof WrittenConfigSchema>;

/* ---------- union ---------- */

export const STATION_CONFIG_SCHEMAS = {
  terminal: TerminalConfigSchema,
  code: CodeConfigSchema,
  api: ApiConfigSchema,
  data: DataConfigSchema,
  written: WrittenConfigSchema,
} as const;

export type StationConfigMap = {
  terminal: TerminalConfig;
  code: CodeConfig;
  api: ApiConfig;
  data: DataConfig;
  written: WrittenConfig;
};

/* ---------- results sent to the grader ---------- */

export const CheckResultSchema = z.object({
  label: z.string().max(200),
  passed: z.boolean(),
  detail: z.string().max(300).optional(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const StationResultSchema = z.object({
  station: z.enum(["terminal", "code", "api", "data", "written"]),
  checks: z.array(CheckResultSchema).max(12),
  /** Score from the deterministic checks, 0 to 5. */
  baseScore: z.number().int().min(0).max(5),
  /** How far the model's judgement may move the base score. */
  maxAdjust: z.number().int().min(0).max(2),
  /** What the candidate did: commands, requests, code, answers or text. */
  summary: z.string().max(8000),
  /** The candidate's explanation of their approach. */
  notes: z.string().max(2000),
  attempted: z.boolean(),
});
export type StationResult = z.infer<typeof StationResultSchema>;
