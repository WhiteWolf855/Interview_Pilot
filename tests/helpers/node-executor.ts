import { Worker } from "node:worker_threads";
import { CODE_TIMEOUT_MS, RUNNER_SOURCE, timedOutOutcomes, type CodeExecutor } from "@/lib/stations/code/runner";

/** Runs the same runner source the browser worker uses, in a Node worker thread with the same timeout. */
export const nodeExecutor: CodeExecutor = (code, functionName, tests) =>
  new Promise((resolve) => {
    const worker = new Worker(
      `${RUNNER_SOURCE}\nconst { parentPort, workerData } = require("node:worker_threads");\nparentPort.postMessage(__runTests(workerData.code, workerData.functionName, workerData.tests));`,
      { eval: true, workerData: { code, functionName, tests } },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve(timedOutOutcomes(tests));
    }, CODE_TIMEOUT_MS);
    worker.on("message", (outcomes) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(outcomes);
    });
  });
