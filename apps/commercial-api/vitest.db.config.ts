import { defineConfig } from "vitest/config";

// Real PostgreSQL integration suite. Every file shares one guarded test
// database, so files and tests run sequentially.
export default defineConfig({
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
