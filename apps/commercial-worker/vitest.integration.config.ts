import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// End-to-end suites against the real commercial-api worker-control router and
// the guarded PostgreSQL 16 test database. They share that database with the
// commercial-api DB suite, so files and tests run sequentially.
export default defineConfig({
  resolve: {
    // The shared protocol package from source (its "source" export condition).
    alias: { "commercial-worker-protocol": fileURLToPath(new URL("../../packages/commercial-worker-protocol/src/index.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    restoreMocks: true,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
