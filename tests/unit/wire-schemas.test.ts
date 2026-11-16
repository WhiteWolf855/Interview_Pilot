import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { describe, expect, it } from "vitest";
import { FollowUpSchema, GradeWireSchema, StageGradeWireSchema } from "@/lib/schemas/debrief";
import { OutlineSchema } from "@/lib/schemas/plan";
import { STATION_WIRE } from "@/lib/schemas/wire";
import { mockProvider } from "@/lib/server/ai/mock";
import { LIBRARY } from "@/lib/stations/library";

/**
 * The Claude API's structured output accepts a limited JSON Schema: every
 * object must forbid extra properties and list all of its properties as
 * required, and length, range and pattern limits are not supported. These
 * checks run offline, so a schema the API would reject is caught before a
 * real (billed) call is made.
 */
const SCHEMAS = {
  outline: OutlineSchema,
  followUp: FollowUpSchema,
  grade: GradeWireSchema,
  stageFeedback: StageGradeWireSchema,
  ...Object.fromEntries(Object.entries(STATION_WIRE).map(([name, schema]) => [`station:${name}`, schema])),
};

const UNSUPPORTED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "minItems", "maxItems", "uniqueItems"];

function problems(node: unknown, path: string): string[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child, i) => problems(child, `${path}[${i}]`));
  const schema = node as Record<string, unknown>;
  const found: string[] = [];
  for (const key of UNSUPPORTED) if (key in schema) found.push(`${path}: unsupported keyword ${key}`);
  if (schema.type === "object") {
    if (schema.additionalProperties !== false) found.push(`${path}: additionalProperties must be false`);
    const properties = Object.keys((schema.properties as object) ?? {});
    const required = (schema.required as string[]) ?? [];
    for (const property of properties) if (!required.includes(property)) found.push(`${path}.${property}: must be required`);
  }
  for (const [key, child] of Object.entries(schema)) found.push(...problems(child, `${path}.${key}`));
  return found;
}

describe("schemas sent to the Claude API", () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    it(`${name} converts to a schema structured output accepts`, () => {
      const format = zodOutputFormat(schema) as { type: string; schema: Record<string, unknown> };
      expect(format.type).toBe("json_schema");
      expect(format.schema.type).toBe("object");
      expect(problems(format.schema, name)).toEqual([]);
      // No recursion and nothing left unresolved.
      expect(JSON.stringify(format.schema)).not.toContain('"$ref"');
    });
  }

  it("every built-in scenario fits the shape the model is asked to fill in", () => {
    for (const station of ["terminal", "code", "api", "data", "written"] as const) {
      const { language: _language, ...config } = LIBRARY[station].config as Record<string, unknown>;
      expect(STATION_WIRE[station].safeParse(config).success, station).toBe(true);
    }
  });

  it("the mock provider's responses fit the same shapes, so tests exercise the real validation path", async () => {
    const outline = await mockProvider.generate({ purpose: "outline", tier: "strong", system: "", user: "", schema: OutlineSchema, maxTokens: 1, effort: "low", mock: { lengthMinutes: 45, technical: true, codingEvidence: true, resumeQuote: "a quote from the resume", jobQuote: "a quote from the job" } });
    expect(OutlineSchema.safeParse(outline.data).success).toBe(true);
    const followUp = await mockProvider.generate({ purpose: "followup", tier: "fast", system: "", user: "", schema: FollowUpSchema, maxTokens: 1, effort: "low", mock: { lastAnswer: "I did the thing", followUpNumber: 1 } });
    expect(FollowUpSchema.safeParse(followUp.data).success).toBe(true);
  });
});
