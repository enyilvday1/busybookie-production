import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Public commercial website. Static output only: no proxy, no backend
// integration, no environment variables exposed to client code. The default
// SPA fallback lets the dev server answer /solutions and /pricing with
// index.html; the app resolves the page from window.location.pathname.
export default defineConfig({
  plugins: [react()],
  // No VITE_* variable can reach client code: nothing uses this prefix.
  envPrefix: "COMMERCIAL_WEB_CLIENT_ENV_DISABLED_",
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4180,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    assetsInlineLimit: 0,
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
});
