import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
    // Process CSS so CSS Modules resolve and `?raw` imports return file
    // contents for the token and boundary tests.
    css: true,
  },
});
