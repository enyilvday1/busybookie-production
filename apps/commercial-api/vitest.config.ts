import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Real-PostgreSQL suites run only through vitest.db.config.ts (npm run test:db).
    exclude: ["tests/db/**"],
    restoreMocks: true,
  },
});
