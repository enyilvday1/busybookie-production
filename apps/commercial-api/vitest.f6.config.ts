import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// R44B11G F6 heavyweight default-planner assessment ONLY. This is the sole
// configuration that collects tests/db/f6 and provides the selection literal.
// Selection is not admission: the module's resource-admission gate is
// unconditionally blocked and throws before any database connection.
// Deliberately no npm script; vitest.db.config.ts excludes tests/db/f6.
export default defineConfig({
  resolve: {
    // The shared protocol package from source, as in vitest.config.ts.
    alias: { "commercial-worker-protocol": fileURLToPath(new URL("../../packages/commercial-worker-protocol/src/index.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/db/f6/**/*.heavyweight.ts"],
    provide: { r44b11gF6Selection: "EXPLICIT_HEAVYWEIGHT_F6_ONLY" },
    fileParallelism: false,
    maxWorkers: 1,
    restoreMocks: true,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
