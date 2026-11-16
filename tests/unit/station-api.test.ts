import { describe, expect, it } from "vitest";
import { ApiConfigSchema, type ApiConfig } from "@/lib/schemas/stations";
import { evaluateApiChecks, gradeApi, replayApiSolution, validateApiConfig } from "@/lib/stations/api/grade";
import { createApi, parseRecords, sendRequest, type ApiState } from "@/lib/stations/api/sim";
import { LIBRARY } from "@/lib/stations/library";

const config = LIBRARY.api.config;
const auth = { Authorization: `Bearer ${config.authToken}` };

function call(state: ApiState, method: string, path: string, body = "", headers: Record<string, string> = auth) {
  return sendRequest(config, state, { method, path, headers, body });
}

describe("simulated REST API", () => {
  it("requires the bearer token", () => {
    expect(call(createApi(config), "GET", "/orders", "", {}).response.status).toBe(401);
    expect(call(createApi(config), "GET", "/orders", "", { Authorization: "Bearer wrong" }).response.status).toBe(401);
    expect(call(createApi(config), "GET", "/orders", "", { authorization: `Bearer ${config.authToken}` }).response.status).toBe(200);
  });

  it("lists, filters, pages and fetches by id", () => {
    const state = createApi(config);
    expect((call(state, "GET", "/orders").response.body as unknown[]).length).toBe(5);
    expect(call(state, "GET", "/orders?customerId=3&status=pending").response.body).toEqual([{ id: 104, customerId: 3, status: "pending", total: 249.5 }]);
    expect(call(state, "GET", "/customers?name=dana%20okafor").response.body).toEqual([{ id: 3, name: "Dana Okafor", email: "dana@example.test" }]);
    expect((call(state, "GET", "/orders?limit=2&offset=1").response.body as { id: number }[]).map((o) => o.id)).toEqual([102, 103]);
    expect(call(state, "GET", "/orders/104").response.body).toMatchObject({ total: 249.5 });
    expect(call(state, "GET", "https://api.shop.test/v1/orders/104").response.status).toBe(200);
    expect(call(state, "GET", "/").response.body).toEqual({ collections: ["customers", "orders"] });
  });

  it("returns 404, 405, 400 and 422 for bad requests", () => {
    const state = createApi(config);
    expect(call(state, "GET", "/orders/999").response.status).toBe(404);
    expect(call(state, "GET", "/invoices").response.status).toBe(404);
    expect(call(state, "GET", "/orders/104/items").response.status).toBe(404);
    expect(call(state, "DELETE", "/orders").response.status).toBe(405);
    expect(call(state, "POST", "/orders/104", "{}").response.status).toBe(405);
    expect(call(state, "PATCH", "/orders/104", "{not json").response.status).toBe(400);
    expect(call(state, "POST", "/orders", '{"customerId":1}').response.status).toBe(422);
    expect(call(state, "PATCH", "/orders/104", '{"status":5}').response.status).toBe(422);
    expect(call(state, "PATCH", "/orders/104", '{"colour":"red"}').response.status).toBe(422);
  });

  it("creates, updates and deletes without changing earlier states", () => {
    const start = createApi(config);
    const created = call(start, "POST", "/orders", '{"customerId":2,"status":"pending","total":10}');
    expect(created.response.status).toBe(201);
    expect(created.response.body).toMatchObject({ id: 106, total: 10 });
    expect(start.collections.orders!.length).toBe(5);

    const patched = call(created.state, "PATCH", "/orders/104", '{"status":"cancelled"}');
    expect(patched.response.body).toMatchObject({ id: 104, status: "cancelled", total: 249.5 });

    const replaced = call(patched.state, "PUT", "/orders/101", '{"customerId":1,"status":"cancelled","total":0}');
    expect(replaced.response.body).toEqual({ id: 101, customerId: 1, status: "cancelled", total: 0 });
    expect(call(patched.state, "PUT", "/orders/101", '{"status":"cancelled"}').response.status).toBe(422);

    const deleted = call(replaced.state, "DELETE", "/orders/105");
    expect(deleted.response.status).toBe(204);
    expect(deleted.state.collections.orders!.some((o) => o.id === 105)).toBe(false);
    expect(deleted.state.log.map((l) => `${l.method} ${l.status}`)).toEqual(["POST 201", "PATCH 200", "PUT 200", "DELETE 204"]);
  });

  it("validates seed records", () => {
    expect(parseRecords("nope")).toContain("not valid JSON");
    expect(parseRecords("{}")).toContain("JSON array");
    expect(parseRecords('[{"name":"x"}]')).toContain('"id"');
    expect(parseRecords('[{"id":1,"tags":["a"]}]')).toContain("must be a string");
  });
});

describe("API station grading", () => {
  it("the built-in scenario is valid: unsolved fails, the solution passes every check", () => {
    expect(ApiConfigSchema.safeParse(config).success).toBe(true);
    expect(validateApiConfig(config)).toEqual([]);
    expect(evaluateApiChecks(config, createApi(config), "").some((c) => !c.passed)).toBe(true);
    expect(evaluateApiChecks(config, replayApiSolution(config), config.solution.answer).every((c) => c.passed)).toBe(true);
  });

  it("scores 0 for no attempt and 5 for the full solution", () => {
    const none = gradeApi(config, createApi(config), "", "");
    expect(none.baseScore).toBe(0);
    expect(none.attempted).toBe(false);
    const full = gradeApi(config, replayApiSolution(config), "249.50", "Filtered by customer.");
    expect(full.baseScore).toBe(5);
    expect(full.summary).toContain("PATCH /orders/104 -> 200");
  });

  it("penalises cancelling the wrong order", () => {
    let state = createApi(config);
    state = call(state, "GET", "/customers").state;
    state = call(state, "PATCH", "/orders/103", '{"status":"cancelled"}').state;
    const result = gradeApi(config, state, "120", "");
    const byLabel = Object.fromEntries(result.checks.map((c) => [c.label, c.passed]));
    expect(byLabel["Dana's pending order is now cancelled"]).toBe(false);
    expect(byLabel["Another customer's pending order was left alone"]).toBe(false);
    expect(byLabel["Correct order total reported"]).toBe(false);
    expect(result.baseScore).toBeLessThanOrEqual(2);
  });

  it("does not count failed requests, and accepts either form of the answer", () => {
    const unauthorised = call(createApi(config), "GET", "/customers", "", {}).state;
    expect(evaluateApiChecks(config, unauthorised, "")[0]!.passed).toBe(false);
    const solved = replayApiSolution(config);
    const total = (answer: string) => evaluateApiChecks(config, solved, answer).at(-1)!.passed;
    expect(total("249.5")).toBe(true);
    expect(total("The total was $249.50")).toBe(true);
    expect(total("1249.50")).toBe(false);
  });

  it("supports record_exists and record_absent checks", () => {
    const custom: ApiConfig = {
      ...config,
      checks: [
        { label: "refund created", type: "record_exists", method: "", pathPrefix: "", collection: "orders", recordId: "", field: "status", value: "refunded", values: [] },
        { label: "old order removed", type: "record_absent", method: "", pathPrefix: "", collection: "orders", recordId: "105", field: "", value: "", values: [] },
      ],
      solution: { requests: [{ method: "POST", path: "/orders", bodyJson: '{"customerId":1,"status":"refunded","total":12}' }, { method: "DELETE", path: "/orders/105", bodyJson: "" }], answer: "" },
    };
    expect(validateApiConfig(custom)).toEqual([]);
    expect(evaluateApiChecks(custom, createApi(custom), "").map((c) => c.passed)).toEqual([false, false]);
  });

  it("rejects generated scenarios that are broken", () => {
    const unsolved: ApiConfig = { ...config, solution: { requests: [], answer: "" } };
    expect(validateApiConfig(unsolved).join(" ")).toContain("does not satisfy check");

    const failing: ApiConfig = { ...config, solution: { ...config.solution, requests: [...config.solution.requests, { method: "GET", path: "/orders/999", bodyJson: "" }] } };
    expect(validateApiConfig(failing).join(" ")).toContain("fails against the simulated API");

    const badRecords: ApiConfig = { ...config, collections: [{ ...config.collections[0]!, recordsJson: "[oops" }, config.collections[1]!] };
    expect(validateApiConfig(badRecords).join(" ")).toContain("not valid JSON");

    const unknownCollection: ApiConfig = { ...config, checks: [{ ...config.checks[1]!, collection: "invoices" }, ...config.checks.slice(2)] };
    expect(validateApiConfig(unknownCollection).join(" ")).toContain("unknown collection");
  });
});
