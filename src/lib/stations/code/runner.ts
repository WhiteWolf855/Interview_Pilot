import type { CodeConfig } from "@/lib/schemas/stations";

export interface RunnableTest {
  name: string;
  argsJson: string;
  expectedJson: string;
  hidden: boolean;
}

export interface TestOutcome {
  name: string;
  hidden: boolean;
  passed: boolean;
  error?: string;
  actual?: string;
}

/** Runs the candidate's code against the tests and resolves with one outcome per test. */
export type CodeExecutor = (code: string, functionName: string, tests: RunnableTest[]) => Promise<TestOutcome[]>;

/**
 * The test runner, as plain JavaScript source. It is kept as text so the exact
 * same code runs inside the browser's sandboxed worker and in the unit tests.
 */
export const RUNNER_SOURCE = `
function __canonical(value) {
  if (value === undefined) return '"__undefined__"';
  if (typeof value === 'number' && !isFinite(value)) return '"__' + String(value) + '__"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(__canonical).join(',') + ']';
  var keys = Object.keys(value).sort();
  return '{' + keys.map(function (k) { return JSON.stringify(k) + ':' + __canonical(value[k]); }).join(',') + '}';
}
function __equal(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a === b || Math.abs(a - b) < 1e-9;
  return __canonical(a) === __canonical(b);
}
function __runTests(code, functionName, tests) {
  var fn;
  try {
    fn = new Function('"use strict";\\n' + code + '\\n;return (typeof ' + functionName + ' === "function") ? ' + functionName + ' : undefined;')();
  } catch (error) {
    return tests.map(function (t) {
      return { name: t.name, hidden: t.hidden, passed: false, error: 'Your code did not load: ' + String(error && error.message || error) };
    });
  }
  if (typeof fn !== 'function') {
    return tests.map(function (t) {
      return { name: t.name, hidden: t.hidden, passed: false, error: 'Function ' + functionName + ' is not defined' };
    });
  }
  return tests.map(function (t) {
    try {
      var args = JSON.parse(t.argsJson);
      var expected = JSON.parse(t.expectedJson);
      var actual = fn.apply(null, args);
      var passed = __equal(actual, expected);
      var shown = __canonical(actual);
      return { name: t.name, hidden: t.hidden, passed: passed, actual: shown.length > 300 ? shown.slice(0, 300) + '...' : shown };
    } catch (error) {
      return { name: t.name, hidden: t.hidden, passed: false, error: String(error && error.message || error) };
    }
  });
}
`;

/** Worker body: removes network and storage access, then runs the tests. */
export const WORKER_SOURCE = `
${RUNNER_SOURCE}
['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker'].forEach(function (name) {
  try { Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false }); } catch (e) { try { self[name] = undefined; } catch (e2) {} }
});
self.onmessage = function (event) {
  var d = event.data;
  self.postMessage(__runTests(d.code, d.functionName, d.tests));
};
`;

export const CODE_TIMEOUT_MS = 3000;

export function timedOutOutcomes(tests: RunnableTest[]): TestOutcome[] {
  return tests.map((t) => ({
    name: t.name,
    hidden: t.hidden,
    passed: false,
    error: `Timed out after ${CODE_TIMEOUT_MS / 1000} seconds. Check for an infinite loop.`,
  }));
}

/** Browser executor: a throwaway Web Worker that is killed on timeout. */
export const browserExecutor: CodeExecutor = (code, functionName, tests) =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
    const worker = new Worker(url);
    const finish = (outcomes: TestOutcome[]) => {
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
      resolve(outcomes);
    };
    const timer = setTimeout(() => finish(timedOutOutcomes(tests)), CODE_TIMEOUT_MS);
    worker.onmessage = (event: MessageEvent<TestOutcome[]>) => finish(event.data);
    worker.onerror = () =>
      finish(tests.map((t) => ({ name: t.name, hidden: t.hidden, passed: false, error: "Your code could not be run" })));
    worker.postMessage({ code, functionName, tests });
  });

export function testsOf(config: CodeConfig): RunnableTest[] {
  return config.tests.map((t) => ({ name: t.name, argsJson: t.argsJson, expectedJson: t.expectedJson, hidden: t.hidden }));
}
