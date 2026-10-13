import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Local operator console. The dev server binds the IPv4 loopback only and
// proxies nothing: D2 makes no operator API calls. Production output is
// static and CSP-friendly (no inlined data: assets). Only index.html is a
// build input; reference.html is a development-only entry.
export default defineConfig({
  plugins: [react()],
  // No VITE_* variable can reach client code: nothing uses this prefix.
  envPrefix: "OPERATOR_CONSOLE_CLIENT_ENV_DISABLED_",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
    sourcemap: false,
    // Modern browsers support modulepreload natively; omitting the polyfill
    // keeps the shipped bundle free of any fetch() call.
    modulePreload: { polyfill: false },
  },
});
