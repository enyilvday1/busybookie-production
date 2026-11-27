import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Isolated from repository-root and commercial API database test collection.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    include: ["tests/**/*.f6.spec.ts"],
    exclude: ["dist/**", "node_modules/**"],
    passWithNoTests: false,
    fileParallelism: false,
    maxWorkers: 1,
    restoreMocks: true,
  },
});
