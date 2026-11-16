import { defineConfig } from "vitest/config";
import path from "node:path";

/** Live smoke test against the real Claude API. Costs money. Run with: npm run smoke:live */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/helpers/server-only.ts"),
    },
  },
  test: { environment: "node", include: ["tests/live/**/*.test.ts"], testTimeout: 600_000, hookTimeout: 600_000, fileParallelism: false },
});
