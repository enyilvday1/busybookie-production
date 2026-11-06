import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    maxWorkers: 2,
    fileParallelism: true,
    include: [
      "tests/**/*.test.ts"
    ],
    exclude: [
      "node_modules/**",
      "dist/**",
      "coverage/**"
    ]
  }
});
