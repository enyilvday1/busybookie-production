import { describe, expect, it } from "vitest";

import indexHtml from "../index.html?raw";
import packageJson from "../package.json";
import referenceHtml from "../reference.html?raw";
import viteConfig from "../vite.config.ts?raw";

const SOURCES = import.meta.glob("../src/**/*.{ts,tsx,css}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

function sourcesMatching(pattern: RegExp): Array<[string, string]> {
  return Object.entries(SOURCES).filter(([path]) => pattern.test(path));
}

const CODE = sourcesMatching(/\.(ts|tsx)$/).map(([path, source]) => [path, stripComments(source)] as const);
const ALL = Object.entries(SOURCES).map(([path, source]) => [path, stripComments(source)] as const);

function sourceOf(suffix: string): string {
  const entry = Object.entries(SOURCES).find(([path]) => path.endsWith(suffix));

  if (entry === undefined) {
    throw new Error(`Source ${suffix} not found.`);
  }

  return entry[1];
}

// The only module allowed to reach the operator API (Step 1018 section 7).
const OPERATOR_CLIENT_PATH = "src/api/operatorClient.ts";
const isOperatorClient = (path: string) => path.endsWith(OPERATOR_CLIENT_PATH);

describe("frontend security boundary (D3B: one read-only API module)", () => {
  it("scans the whole source tree", () => {
    expect(CODE.length).toBeGreaterThan(20);
  });

  // `["'\`]\/api\/` matches API URL strings; module paths such as
  // "./api/operatorClient" are relative imports, not requests.
  it("contains no network, API or auth code outside the operator client", () => {
    for (const [path, code] of CODE.filter(([path]) => !isOperatorClient(path))) {
      expect(code, path).not.toMatch(
        /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|axios|["'`]\/api\/|Authorization|Bearer/,
      );
    }
  });

  it("lets the operator client make exactly one read-only request to the episode list", () => {
    const client = stripComments(sourceOf(OPERATOR_CLIENT_PATH));
    expect(client.match(/\bfetch\s*\(/g)).toHaveLength(1);
    expect(client.match(/"\/api\/[^"]*"/g)).toEqual(['"/api/v1/operator/episodes"']);
    expect(client).toMatch(/credentials:\s*"omit"/);
    expect(client).toMatch(/cache:\s*"no-store"/);
    expect(client).toMatch(/mode:\s*"same-origin"/);
    expect(client).toMatch(/method:\s*"GET"/);
    expect(client).not.toMatch(/XMLHttpRequest|WebSocket|EventSource|sendBeacon|axios|"(POST|PUT|PATCH|DELETE)"/);
    expect(client).not.toMatch(/\/health|\/episodes\/|setTimeout\([^)]*fetch/);
  });

  it("never touches browser storage or cookies", () => {
    for (const [path, code] of CODE) {
      expect(code, path).not.toMatch(/localStorage|sessionStorage|indexedDB|\bcaches\b|document\.cookie/);
    }
  });

  it("never persists through history or the URL, logs, polls or uses a service worker", () => {
    for (const [path, code] of CODE) {
      expect(code, path).not.toMatch(
        /history\.(pushState|replaceState)|location\.(hash|search|href)\s*=|location\.(assign|replace)\s*\(|\bconsole\.|setInterval|serviceWorker/,
      );
    }
  });

  it("never requests the health or episode-detail endpoints and embeds no token", () => {
    for (const [path, code] of CODE) {
      expect(code, path).not.toMatch(/\/operator\/health|\/episodes\/|\b[0-9a-f]{64}\b/);
    }
  });

  it("never imports backend or Node modules", () => {
    for (const [path, code] of CODE) {
      for (const match of code.matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
        const specifier = match[1] as string;
        expect(specifier.startsWith("../../") || specifier.startsWith("node:"), `${path} -> ${specifier}`).toBe(false);
      }
      expect(code, path).not.toMatch(/\bprocess\.|\brequire\s*\(/);
    }
  });

  it("has no raw HTML injection, eval or inline style props", () => {
    for (const [path, code] of CODE) {
      expect(code, path).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML|\beval\s*\(|new Function\s*\(|\bstyle=\{/);
    }
  });

  it("loads no remote script, font, stylesheet or analytics", () => {
    for (const [path, code] of ALL) {
      expect(code, path).not.toMatch(/https?:\/\/|@import|@font-face|url\(/);
    }
    for (const html of [indexHtml, referenceHtml]) {
      expect(html).not.toMatch(/https?:\/\/|<link[^>]+stylesheet|<script(?![^>]*type="module"[^>]*src="\/src\/)/);
    }
  });

  it("imports only React, React DOM, lucide-react and relative modules", () => {
    const allowed = new Set(["react", "react-dom/client", "lucide-react"]);
    for (const [path, code] of CODE) {
      for (const match of code.matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
        const specifier = match[1] as string;
        expect(specifier.startsWith(".") || allowed.has(specifier), `${path} -> ${specifier}`).toBe(true);
      }
    }
  });

  it("keeps the design system independent of shell, pages, reference and app code", () => {
    for (const [path, code] of sourcesMatching(/\/design-system\//)) {
      expect(stripComments(code), path).not.toMatch(/from\s+"\.\.\/(shell|pages|reference|App|productIdentity)/);
    }
  });

  it("keeps StatusIndicator free of accent and focus tokens", () => {
    for (const suffix of ["design-system/StatusIndicator.tsx", "design-system/StatusIndicator.module.css"]) {
      expect(stripComments(sourceOf(suffix)), suffix).not.toMatch(/accent|--color-focus/);
    }
    expect(sourceOf("design-system/StatusIndicator.tsx")).toMatch(
      /\["neutral", "info", "success", "warning", "danger"\] as const/,
    );
  });
});

describe("navigation drawer implementation contract", () => {
  const drawer = stripComments(sourceOf("shell/NavigationDrawer.tsx"));
  const drawerCss = sourceOf("shell/NavigationDrawer.module.css");

  it("opens with showModal and never with show()", () => {
    expect(drawer).toMatch(/\.showModal\(\)/);
    expect(drawer).not.toMatch(/\.show\(\)/);
  });

  it("has no hand-written focus trap and no global aria-hidden or inert management", () => {
    for (const [path, code] of sourcesMatching(/\/shell\//)) {
      const stripped = stripComments(code);
      expect(stripped, path).not.toMatch(/["']Tab["']|keydown|onKeyDown/);
      expect(stripped, path).not.toMatch(/setAttribute\(\s*["'](aria-hidden|inert)["']|\binert\b/);
    }
  });

  it("is left-anchored, 15rem wide, viewport-bounded, full height and motion-reducible", () => {
    expect(drawerCss).toMatch(/left:\s*0;/);
    expect(drawerCss).toMatch(/width:\s*15rem;/);
    expect(drawerCss).toMatch(/max-width:\s*100%;/);
    expect(drawerCss).toMatch(/height:\s*100dvh;/);
    expect(drawerCss).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*animation:\s*none;/);
  });
});

describe("development server, build and dependency contract", () => {
  it("binds the dev server to 127.0.0.1 with a strict port and no proxy", () => {
    const config = stripComments(viteConfig);
    expect(config).toMatch(/host:\s*"127\.0\.0\.1"/);
    expect(config).toMatch(/strictPort:\s*true/);
    expect(config).not.toMatch(/proxy|0\.0\.0\.0|host:\s*true/);
  });

  it("keeps the production build CSP-friendly and limited to index.html", () => {
    expect(viteConfig).toMatch(/assetsInlineLimit:\s*0/);
    expect(viteConfig).toMatch(/modulePreload:\s*\{\s*polyfill:\s*false\s*\}/);
    expect(viteConfig).toMatch(/envPrefix:\s*"OPERATOR_CONSOLE_CLIENT_ENV_DISABLED_"/);
    expect(stripComments(viteConfig)).not.toMatch(/reference\.html|rollupOptions/);
    expect(indexHtml).toMatch(/<script type="module" src="\/src\/main\.tsx"><\/script>/);
    expect(indexHtml).not.toMatch(/reference/);
  });

  it("keeps the development reference out of production navigation and data", () => {
    const navigation = stripComments(sourceOf("shell/navigation.ts"));
    expect(navigation).not.toMatch(/reference/i);
    const reference = stripComments(sourceOf("reference/ReferencePage.tsx"));
    expect(reference).not.toMatch(/from\s+"\.\.\/(shell|pages)/);
  });

  it("declares exactly the frozen 3 runtime and 11 development dependencies", () => {
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["lucide-react", "react", "react-dom"]);
    expect(Object.keys(packageJson.devDependencies).sort()).toEqual([
      "@testing-library/dom",
      "@testing-library/react",
      "@testing-library/user-event",
      "@types/react",
      "@types/react-dom",
      "@vitejs/plugin-react",
      "axe-core",
      "jsdom",
      "typescript",
      "vite",
      "vitest",
    ]);
    expect(packageJson.devDependencies.vite).toBe("^8.3.0");
    expect(packageJson.devDependencies.vitest).toBe("^5.0.1");
    expect(packageJson.devDependencies.typescript).toBe("^7.0.2");
    expect(packageJson.private).toBe(true);
    expect(JSON.stringify(packageJson)).not.toMatch(/workspaces|tailwind|radix|router|tanstack|storybook|playwright/i);
  });
});
