import { defineConfig, devices } from "@playwright/test";

const PORT = 3210;

/**
 * End-to-end tests run against the production build with the mock AI provider,
 * so they need no API key and cost nothing. They prove the app's flow, not the
 * quality of the model's questions or grading.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, ...devices["Pixel 7"] },
  webServer: {
    command: `PORT=${PORT} bash scripts/e2e-server.sh`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 240_000,
    // Always start a fresh server, so tests never run against a stale build.
    reuseExistingServer: false,
  },
});
