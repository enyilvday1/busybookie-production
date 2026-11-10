import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Real PostgreSQL integration suite. Every file shares one guarded test
// database, so files and tests run sequentially.
export default defineConfig({
  resolve: {
    // The shared protocol package from source, as in vitest.config.ts.
    alias: { "commercial-worker-protocol": fileURLToPath(new URL("../../packages/commercial-worker-protocol/src/index.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    restoreMocks: true,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
