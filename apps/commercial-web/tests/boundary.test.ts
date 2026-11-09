import { describe, expect, it } from "vitest";

import packageJson from "../package.json";

// Source-boundary regression checks. The public commercial website must stay
// independent of the private operator console, the backend and any
// generation provider. Only application files are scanned (not this test).

const SOURCE_FILES = import.meta.glob<string>("../src/**/*.{ts,tsx,css}", {
  query: "?raw",
  import: "default",
  eager: true,
});

const ROOT_FILES = import.meta.glob<string>(["../index.html", "../vite.config.ts", "../vitest.config.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const ALL_FILES = { ...SOURCE_FILES, ...ROOT_FILES };

const FORBIDDEN: readonly { reason: string; pattern: RegExp }[] = [
  { reason: "operator-console reference", pattern: /operator-console/i },
  { reason: "operator API path", pattern: /\/api\/v1\/operator/i },
  { reason: "bearer-token handling", pattern: /\bbearer\b/i },
  { reason: "Authorization header", pattern: /["']authorization["']/i },
  { reason: "operator token", pattern: /operator[-_ ]?token/i },
  { reason: "operator API port", pattern: /\b4381\b/ },
  { reason: "creativetora.ai branding", pattern: /creativetora/i },
  { reason: "remote CSS asset", pattern: /url\(\s*["']?(?:https?:)?\/\//i },
  { reason: "remote image source", pattern: /\bsrc(?:Set)?\s*=\s*\{?\s*["'`](?:https?:)?\/\//i },
  { reason: "provider SDK or secret", pattern: /@google\/genai|runwayml|GEMINI_API_KEY|RUNWAYML_API_SECRET/i },
  { reason: "network call", pattern: /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource/ },
  { reason: "environment access", pattern: /process\.env|import\.meta\.env/ },
  { reason: "raw HTML injection", pattern: /dangerouslySetInnerHTML/ },
];

const ALLOWED_PACKAGES = new Set(["react", "react-dom", "react-dom/client", "react/jsx-runtime", "lucide-react"]);

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

/** Resolves a relative specifier from a "../src/..." file path. */
function resolveRelative(fromFile: string, specifier: string): string {
  const parts = fromFile.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "..") {
      parts.pop();
    } else if (segment !== ".") {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

describe("commercial-web source boundary", () => {
  it("scans the application source", () => {
    expect(Object.keys(SOURCE_FILES).length).toBeGreaterThan(10);
    expect(Object.keys(ROOT_FILES)).toHaveLength(3);
  });

  it.each(FORBIDDEN)("contains no $reason", ({ pattern }) => {
    const offenders = Object.entries(ALL_FILES)
      .filter(([, source]) => pattern.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("imports only allowed packages and files inside src", () => {
    const problems: string[] = [];

    for (const [path, source] of Object.entries(SOURCE_FILES)) {
      for (const specifier of importSpecifiers(source)) {
        if (specifier.startsWith(".")) {
          const resolved = resolveRelative(path, specifier);
          if (!resolved.startsWith("../src/")) {
            problems.push(`${path} -> ${specifier}`);
          }
        } else if (!ALLOWED_PACKAGES.has(specifier)) {
          problems.push(`${path} -> ${specifier}`);
        }
      }
    }

    expect(problems).toEqual([]);
  });

  it("references no remote resources", () => {
    const files = { ...SOURCE_FILES, "../index.html": ROOT_FILES["../index.html"] ?? "" };
    const offenders = Object.entries(files)
      .filter(([, source]) => /\bhttps?:\/\//.test(source) || /@import\s+url/i.test(source))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("hard-codes the provisional product name only in productIdentity", () => {
    const offenders = Object.entries(SOURCE_FILES)
      .filter(([path, source]) => !path.endsWith("/productIdentity.ts") && source.includes("[Product Name]"))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("is a private package with only public-frontend runtime dependencies", () => {
    expect(packageJson.private).toBe(true);
    expect(Object.keys(packageJson.dependencies).sort()).toEqual(["lucide-react", "react", "react-dom"]);
    expect(Object.keys(packageJson.scripts).sort()).toEqual(["build", "dev", "test", "typecheck"]);
  });
});
