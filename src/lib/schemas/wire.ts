import { z } from "zod";
import { API_CHECK_TYPES, DATA_FILTER_OPS, DATA_GROUP_AGGS, DATA_OPS, TERMINAL_CHECK_TYPES } from "./stations";

/**
 * The shapes the model is asked to fill in for each station. They carry no
 * length or range limits because the model API's structured output does not
 * support them; the strict schemas in stations.ts are applied afterwards.
 */

export const TerminalWire = z.object({
  scenario: z.string(),
  task: z.string(),
  cwd: z.string(),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  answerPrompt: z.string(),
  checks: z.array(z.object({ label: z.string(), type: z.enum(TERMINAL_CHECK_TYPES), path: z.string(), values: z.array(z.string()) })),
  solution: z.object({ commands: z.array(z.string()), answer: z.string() }),
});

export const CodeWire = z.object({
  scenario: z.string(),
  task: z.string(),
  functionName: z.string(),
  starterCode: z.string(),
  tests: z.array(z.object({ name: z.string(), argsJson: z.string(), expectedJson: z.string(), hidden: z.boolean() })),
  referenceSolution: z.string(),
});

export const ApiWire = z.object({
  scenario: z.string(),
  task: z.string(),
  baseUrl: z.string(),
  authToken: z.string(),
  collections: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      fields: z.array(z.object({ name: z.string(), type: z.enum(["string", "number", "boolean"]), required: z.boolean() })),
      recordsJson: z.string(),
    }),
  ),
  answerPrompt: z.string(),
  checks: z.array(
    z.object({
      label: z.string(),
      type: z.enum(API_CHECK_TYPES),
      method: z.string(),
      pathPrefix: z.string(),
      collection: z.string(),
      recordId: z.string(),
      field: z.string(),
      value: z.string(),
      values: z.array(z.string()),
    }),
  ),
  solution: z.object({
    requests: z.array(z.object({ method: z.string(), path: z.string(), bodyJson: z.string() })),
    answer: z.string(),
  }),
});

export const DataWire = z.object({
  scenario: z.string(),
  columns: z.array(z.object({ name: z.string(), type: z.enum(["text", "number"]) })),
  rows: z.array(z.array(z.string())),
  questions: z.array(
    z.object({
      prompt: z.string(),
      op: z.enum(DATA_OPS),
      column: z.string(),
      groupBy: z.string(),
      groupAgg: z.enum(DATA_GROUP_AGGS),
      filterColumn: z.string(),
      filterOp: z.enum(DATA_FILTER_OPS),
      filterValue: z.string(),
    }),
  ),
  insightPrompt: z.string(),
});

export const WrittenWire = z.object({
  scenario: z.string(),
  materials: z.array(z.object({ title: z.string(), content: z.string() })),
  deliverable: z.string(),
  audience: z.string(),
  minWords: z.number(),
  maxWords: z.number(),
  mustInclude: z.array(z.object({ label: z.string(), anyOf: z.array(z.string()) })),
  mustAvoid: z.array(z.object({ label: z.string(), anyOf: z.array(z.string()) })),
});

export const STATION_WIRE = {
  terminal: TerminalWire,
  code: CodeWire,
  api: ApiWire,
  data: DataWire,
  written: WrittenWire,
} as const;
