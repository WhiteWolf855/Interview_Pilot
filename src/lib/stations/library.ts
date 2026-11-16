import type { StationType } from "@/lib/config";
import type { Rubric } from "@/lib/schemas/plan";
import type { StationConfigMap } from "@/lib/schemas/stations";

/**
 * Built-in scenarios. One is used when a generated scenario fails its checks
 * twice, so a single bad station never sinks a whole interview plan. They are
 * also the fixtures for tests and for the mock AI provider.
 */
export interface LibraryStation<T extends StationType> {
  title: string;
  brief: string;
  intent: string;
  rubric: Rubric;
  config: StationConfigMap[T];
}

const LOG = `2026-03-02T08:58:11Z INFO  checkout started pool=10 workers=4
2026-03-02T09:00:02Z INFO  GET /health 200 3ms
2026-03-02T09:01:40Z INFO  POST /checkout 200 182ms order=A-7731
2026-03-02T09:02:15Z WARN  pool usage high: 8/10 connections in use
2026-03-02T09:02:58Z INFO  POST /checkout 200 240ms order=A-7732
2026-03-02T09:03:31Z WARN  pool usage high: 9/10 connections in use
2026-03-02T09:04:07Z ERROR pool exhausted: 10/10 connections in use (MAX_CONNECTIONS=10, recommended 50)
2026-03-02T09:04:07Z ERROR POST /checkout 503 30001ms order=A-7733
2026-03-02T09:04:19Z INFO  GET /health 200 4ms
2026-03-02T09:04:52Z ERROR pool exhausted: 10/10 connections in use (MAX_CONNECTIONS=10, recommended 50)
2026-03-02T09:04:52Z ERROR POST /checkout 503 30002ms order=A-7734
2026-03-02T09:05:30Z WARN  retry queue length 12
2026-03-02T09:06:11Z ERROR POST /checkout 503 30001ms order=A-7735
2026-03-02T09:06:40Z INFO  GET /health 200 3ms
2026-03-02T09:07:02Z ERROR POST /checkout 503 30000ms order=A-7736
2026-03-02T09:07:45Z INFO  POST /checkout 200 911ms order=A-7737
`;

const terminal: LibraryStation<"terminal"> = {
  title: "Hands-on: find and fix a failing service",
  brief: "Checkout requests started failing this morning. Use the terminal to find out why and fix the setting that caused it.",
  intent: "Whether the candidate can read logs methodically, find the cause rather than a symptom, and make a careful config change.",
  rubric: {
    criteria: [
      "Reads the log before changing anything",
      "Identifies connection pool exhaustion as the cause, not the 503 responses",
      "Changes only the setting that needs changing",
      "Counts the failed requests correctly",
    ],
    strongAnswer:
      "Greps the log for errors, sees the pool exhausted message, raises MAX_CONNECTIONS to the recommended 50 in app.conf, and reports the number of failed checkouts.",
    redFlags: ["Edits the config before reading the log", "Changes unrelated settings", "Guesses the count"],
  },
  config: {
    scenario:
      "You are on call for a small checkout service. Customers report that payments started failing a few minutes ago. The service's files are in your home directory.",
    task: "Find out why checkout requests are failing, fix the setting responsible in config/app.conf, and tell us how many checkout requests returned 503.",
    cwd: "/home/candidate",
    files: [
      { path: "/home/candidate/README.txt", content: "checkout service\n\nlogs/    service logs\nconfig/  runtime settings (applied on save)\n" },
      { path: "/home/candidate/logs/app.log", content: LOG },
      { path: "/home/candidate/config/app.conf", content: "PORT=8080\nMAX_CONNECTIONS=10\nTIMEOUT_SECONDS=30\nLOG_LEVEL=info\n" },
    ],
    answerPrompt: "How many checkout requests returned 503?",
    checks: [
      { label: "Looked at the application log", type: "command_used", path: "", values: ["app.log", "logs/"] },
      { label: "MAX_CONNECTIONS raised to the recommended value", type: "file_contains", path: "/home/candidate/config/app.conf", values: ["MAX_CONNECTIONS=50"] },
      { label: "Other settings left unchanged", type: "file_contains", path: "/home/candidate/config/app.conf", values: ["TIMEOUT_SECONDS=30"] },
      { label: "Correct count of failed checkouts", type: "answer_contains", path: "", values: ["4", "four"] },
    ],
    solution: {
      commands: ["grep ERROR logs/app.log", "grep -c 503 logs/app.log", "sed -i 's/MAX_CONNECTIONS=10/MAX_CONNECTIONS=50/' config/app.conf"],
      answer: "4",
    },
  },
};

const code: LibraryStation<"code"> = {
  title: "Hands-on: fix a buggy function",
  brief: "A small function that totals orders per customer is returning wrong results. Find and fix the bugs.",
  intent: "Whether the candidate can read unfamiliar code, reproduce a failure, and fix the cause without rewriting everything.",
  rubric: {
    criteria: [
      "Finds both bugs (loop bound and overwritten totals)",
      "Handles the empty list",
      "Keeps the fix small and readable",
      "Explains what was wrong",
    ],
    strongAnswer: "Fixes the off-by-one loop and accumulates amounts instead of overwriting them, runs the tests, and explains both bugs in a sentence each.",
    redFlags: ["Hard-codes expected outputs", "Fixes one test at a time without understanding the cause"],
  },
  config: {
    scenario: "A teammate wrote a helper for the finance report and went on leave. The report totals are wrong and the page crashes for some customers.",
    task: "Fix totalsByCustomer so it returns the total amount per customer. Refunds are negative amounts. An empty list returns an empty object.",
    language: "javascript",
    functionName: "totalsByCustomer",
    starterCode: `// Returns the total amount per customer, e.g. { alice: 30, bob: 5 }
function totalsByCustomer(orders) {
  const totals = {};
  for (let i = 0; i <= orders.length; i++) {
    const order = orders[i];
    totals[order.customer] = order.amount;
  }
  return totals;
}
`,
    tests: [
      { name: "empty list", argsJson: "[[]]", expectedJson: "{}", hidden: false },
      { name: "one order", argsJson: '[[{"customer":"alice","amount":30}]]', expectedJson: '{"alice":30}', hidden: false },
      {
        name: "two orders for the same customer",
        argsJson: '[[{"customer":"alice","amount":30},{"customer":"alice","amount":12}]]',
        expectedJson: '{"alice":42}',
        hidden: false,
      },
      {
        name: "several customers",
        argsJson: '[[{"customer":"alice","amount":30},{"customer":"bob","amount":5},{"customer":"alice","amount":1}]]',
        expectedJson: '{"alice":31,"bob":5}',
        hidden: true,
      },
      {
        name: "refund",
        argsJson: '[[{"customer":"bob","amount":20},{"customer":"bob","amount":-20}]]',
        expectedJson: '{"bob":0}',
        hidden: true,
      },
    ],
    referenceSolution: `function totalsByCustomer(orders) {
  const totals = {};
  for (const order of orders) {
    totals[order.customer] = (totals[order.customer] || 0) + order.amount;
  }
  return totals;
}
`,
  },
};

const api: LibraryStation<"api"> = {
  title: "Hands-on: resolve a customer issue through an API",
  brief: "A customer says an order should have been cancelled. Use the API client to find it and fix it.",
  intent: "Whether the candidate can explore an unfamiliar API from its documentation, authenticate, filter, and make a precise change.",
  rubric: {
    criteria: [
      "Authenticates correctly",
      "Finds the customer and the right order by filtering rather than guessing ids",
      "Changes only the affected order",
      "Reports the correct order total",
    ],
    strongAnswer: "Looks up the customer, filters their orders by status, patches only the pending order to cancelled, confirms with a GET, and reports the total.",
    redFlags: ["Cancels the wrong order", "Deletes the order instead of cancelling it", "Never verifies the change"],
  },
  config: {
    scenario:
      "You support an online shop. Customer Dana Okafor wrote in: she cancelled an order yesterday, but it still shows as pending and she is worried about being charged.",
    task: "Find Dana Okafor's pending order, set its status to cancelled, and tell us the order's total.",
    baseUrl: "https://api.shop.test/v1",
    authToken: "demo-token-41c7",
    collections: [
      {
        name: "customers",
        description: "People who have ordered from the shop.",
        fields: [
          { name: "id", type: "number", required: true },
          { name: "name", type: "string", required: true },
          { name: "email", type: "string", required: true },
        ],
        recordsJson: JSON.stringify([
          { id: 1, name: "Sam Reyes", email: "sam@example.test" },
          { id: 2, name: "Priya Nair", email: "priya@example.test" },
          { id: 3, name: "Dana Okafor", email: "dana@example.test" },
        ]),
      },
      {
        name: "orders",
        description: "Orders. status is one of pending, shipped, cancelled.",
        fields: [
          { name: "id", type: "number", required: true },
          { name: "customerId", type: "number", required: true },
          { name: "status", type: "string", required: true },
          { name: "total", type: "number", required: true },
        ],
        recordsJson: JSON.stringify([
          { id: 101, customerId: 1, status: "shipped", total: 59 },
          { id: 102, customerId: 3, status: "shipped", total: 18.25 },
          { id: 103, customerId: 2, status: "pending", total: 120 },
          { id: 104, customerId: 3, status: "pending", total: 249.5 },
          { id: 105, customerId: 1, status: "cancelled", total: 12 },
        ]),
      },
    ],
    answerPrompt: "What is the total of the order you cancelled?",
    checks: [
      { label: "Looked up the customer", type: "request_made", method: "GET", pathPrefix: "/customers", collection: "", recordId: "", field: "", value: "", values: [] },
      { label: "Dana's pending order is now cancelled", type: "record_field_equals", method: "", pathPrefix: "", collection: "orders", recordId: "104", field: "status", value: "cancelled", values: [] },
      { label: "Another customer's pending order was left alone", type: "record_field_equals", method: "", pathPrefix: "", collection: "orders", recordId: "103", field: "status", value: "pending", values: [] },
      { label: "Correct order total reported", type: "answer_contains", method: "", pathPrefix: "", collection: "", recordId: "", field: "", value: "", values: ["249.5", "249.50"] },
    ],
    solution: {
      requests: [
        { method: "GET", path: "/customers?name=Dana Okafor", bodyJson: "" },
        { method: "GET", path: "/orders?customerId=3&status=pending", bodyJson: "" },
        { method: "PATCH", path: "/orders/104", bodyJson: '{"status":"cancelled"}' },
      ],
      answer: "249.50",
    },
  },
};

const data: LibraryStation<"data"> = {
  title: "Hands-on: answer questions from a sales table",
  brief: "Your manager needs three numbers from last quarter's sales table before a meeting, and your read on what they mean.",
  intent: "Whether the candidate can get correct numbers out of a table quickly and say something useful about them.",
  rubric: {
    criteria: [
      "Numbers are correct",
      "Uses sorting, filtering or grouping rather than adding by eye",
      "The written insight follows from the data",
      "Flags a caveat or a next question",
    ],
    strongAnswer: "All three answers correct, plus a short note that one region carries most of the revenue and what to check next.",
    redFlags: ["Answers given without looking at the table", "Insight contradicts the numbers"],
  },
  config: {
    scenario: "Last quarter's closed deals by region and sales rep. Your manager is walking into a review in ten minutes.",
    columns: [
      { name: "Region", type: "text" },
      { name: "Rep", type: "text" },
      { name: "Month", type: "text" },
      { name: "Deals", type: "number" },
      { name: "Revenue", type: "number" },
    ],
    rows: [
      ["North", "Avery", "Jan", "4", "18000"],
      ["North", "Avery", "Feb", "6", "27500"],
      ["North", "Bianca", "Mar", "5", "21000"],
      ["South", "Chen", "Jan", "3", "9000"],
      ["South", "Chen", "Feb", "2", "7500"],
      ["South", "Dmitri", "Mar", "4", "12500"],
      ["East", "Esi", "Jan", "7", "31000"],
      ["East", "Esi", "Feb", "8", "36000"],
      ["East", "Farid", "Mar", "6", "29500"],
      ["West", "Gwen", "Jan", "2", "6000"],
      ["West", "Gwen", "Feb", "3", "11000"],
      ["West", "Hugo", "Mar", "1", "4500"],
    ],
    questions: [
      { prompt: "What was total revenue for the quarter?", op: "sum", column: "Revenue", groupBy: "", groupAgg: "sum", filterColumn: "", filterOp: "none", filterValue: "" },
      { prompt: "Which region had the highest total revenue?", op: "top_group", column: "Revenue", groupBy: "Region", groupAgg: "sum", filterColumn: "", filterOp: "none", filterValue: "" },
      { prompt: "How many deals closed in March?", op: "sum", column: "Deals", groupBy: "", groupAgg: "sum", filterColumn: "Month", filterOp: "eq", filterValue: "Mar" },
    ],
    insightPrompt: "In two or three sentences, what would you tell your manager about these numbers?",
  },
};

const written: LibraryStation<"written"> = {
  title: "Hands-on: write the customer update",
  brief: "Something you were responsible for went wrong and customers were affected. Write the message that goes out to them.",
  intent: "Whether the candidate can write a clear, honest message under pressure: what happened, the impact, what is being done, without blame or guesswork.",
  rubric: {
    criteria: [
      "States plainly what customers experienced and for how long",
      "Takes responsibility and apologises without grovelling",
      "Says what happens next and when customers will hear more",
      "No blame, no speculation, no jargon",
    ],
    strongAnswer: "A short message that names the impact and duration, apologises once, says the issue is fixed, and commits to a specific follow-up.",
    redFlags: ["Blames a person or another team", "Speculates about the cause", "Buries the impact", "Promises it will never happen again"],
  },
  config: {
    scenario:
      "This morning a scheduled change you were responsible for went wrong. Customers could not sign in to their accounts for 47 minutes, from 09:12 to 09:59. The change has been rolled back and sign-in is working. The cause is still being investigated. Support has received about 300 complaints.",
    materials: [
      {
        title: "Timeline",
        content: "09:10 change started\n09:12 sign-in errors begin\n09:31 problem confirmed, rollback started\n09:59 sign-in restored\n10:20 monitoring normal",
      },
      {
        title: "Message from your manager",
        content: "Please draft the customer update now. Keep it short. We do not know the root cause yet, so do not guess. A full review will be shared by Friday.",
      },
    ],
    deliverable: "Write the update that will be emailed to affected customers.",
    audience: "Customers who could not sign in this morning. Most are not technical.",
    minWords: 60,
    maxWords: 180,
    mustInclude: [
      { label: "what customers experienced", anyOf: ["sign in", "sign-in", "log in", "login", "access your account", "access their account"] },
      { label: "how long it lasted", anyOf: ["47 minutes", "09:12", "9:12", "about 45 minutes", "under an hour"] },
      { label: "an apology", anyOf: ["sorry", "apologise", "apologize", "apologies"] },
      { label: "current status", anyOf: ["restored", "resolved", "working again", "back to normal", "rolled back", "fixed"] },
      { label: "what happens next", anyOf: ["friday", "review", "follow up", "follow-up", "update you", "investigat"] },
    ],
    mustAvoid: [
      { label: "guessing at the cause", anyOf: ["probably", "we think", "we believe it was", "might have been", "most likely"] },
      { label: "blaming a person or team", anyOf: ["engineer's mistake", "human error", "a colleague", "the vendor's fault", "another team"] },
    ],
  },
};

export const LIBRARY: { [K in StationType]: LibraryStation<K> } = { terminal, code, api, data, written };
