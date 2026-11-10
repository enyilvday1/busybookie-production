import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests run the shared protocol package from source (the "source" export
    // condition); compiled builds use its built dist.
    alias: { "commercial-worker-protocol": fileURLToPath(new URL("../../packages/commercial-worker-protocol/src/index.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Real-PostgreSQL suites run only through vitest.db.config.ts (npm run test:db).
    exclude: ["tests/db/**"],
    restoreMocks: true,
  },
});
