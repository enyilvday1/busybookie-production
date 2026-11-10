import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The shared protocol package from source (its "source" export condition).
    alias: { "commercial-worker-protocol": fileURLToPath(new URL("../../packages/commercial-worker-protocol/src/index.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Real-PostgreSQL end-to-end suites run only through vitest.integration.config.ts.
    exclude: ["tests/integration/**"],
    restoreMocks: true,
  },
});
