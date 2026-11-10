import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Architectural boundary of the commercial control plane
// (docs/commercial/COMMERCIAL_CONTROL_PLANE_ARCHITECTURE.md sections 2-3, 12).
// Only production source and the app's own configuration are scanned; this
// test directory is excluded because its test data necessarily contains the
// forbidden strings.

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_ROOT = join(APP_ROOT, "src");
const REPO_ROOT = resolve(APP_ROOT, "..", "..");
const MIGRATIONS_ROOT = join(APP_ROOT, "migrations");
const APP_CONFIG_FILES = ["package.json", "tsconfig.json", "tsconfig.build.json", "vitest.config.ts", "vitest.db.config.ts"] as const;
// The only approved external runtime import (R44B2D). Everything else must be
// a node: built-in or a module inside src.
const APPROVED_EXTERNAL_IMPORTS = new Set(["pg"]);
// The only modules that may read process.env: the HTTP process entry point and
// the two explicit database command entry points.
const PROCESS_ENTRY_POINTS = ["src/database/grantRuntimeProcess.ts", "src/database/migrateProcess.ts", "src/main.ts"];

const FORBIDDEN: readonly Readonly<{ label: string; pattern: RegExp }>[] = [
  { label: "private operator server", pattern: /operatorServer|operator-server|operatorRequestSecurity/i },
  { label: "operator console", pattern: /operator-console|operatorConsole/i },
  // "unlock" is forbidden except as part of PostgreSQL's pg_advisory_unlock(),
  // which the migration runner's session lock requires (R44B2D2).
  { label: "operator unlock/session/token", pattern: /launchToken|launch-token|LAUNCH_TOKEN|(?<!pg_advisory_)unlock|OperatorRequestContext/i },
  { label: "private operator port", pattern: /4381/ },
  { label: "commercial web app", pattern: /commercial-web|commercialWeb/i },
  { label: "Runway provider", pattern: /runway/i },
  { label: "Veo provider", pattern: /veo/i },
  { label: "Google GenAI provider", pattern: /genai|gemini/i },
  { label: "provider SDK package", pattern: /@runwayml|@google\// },
  { label: "media root", pattern: /BUSYBOOKIE_MEDIA_ROOT|MEDIA_ROOT|mediaRoot/i },
  // R44B5D: the bare token API_KEY is allowed as credential-kind vocabulary
  // (provider_connections.credential_kind). Environment-variable-style names
  // (any prefix_API_KEY / prefix_API_SECRET) and API_SECRET stay forbidden.
  { label: "provider secret variable", pattern: /RUNWAYML_API_SECRET|GEMINI_API_KEY|API_SECRET|[A-Z0-9]_API_KEY/ },
  { label: "engine environment namespace", pattern: /BUSYBOOKIE_/ },
  { label: "engine execution/CLI modules", pattern: /src\/execution|src\/dialogue|src\/composition|\/providers\/|scripts\/|dist\/execution|executeSingleShot|confirm-paid-generation/i },
  { label: "process spawning", pattern: /child_process|node:worker_threads/ },
  { label: ".env loading", pattern: /dotenv|loadEnvFile/ },
  { label: "repository escape", pattern: /\.\.\/\.\.\// },
  // R44B4A: authentication stays vendor-neutral, identity never comes from
  // client headers, and the test identity provider never reaches production.
  {
    label: "identity-provider vendor SDK",
    pattern: /firebase|auth0|@clerk|clerk\/|supabase|cognito|next-auth|@auth\/|passport|jsonwebtoken|\bjose\b|openid-client|oidc-client/i,
  },
  { label: "client identity header", pattern: /x-user-id|x-account-id|x-email|x-role|x-plan|x-tier|x-entitlement/i },
  { label: "test identity provider", pattern: /testIdentityProvider|createTestIdentityProvider|tests\/support/ },
  // R44B5C: credential crypto. Production source holds contracts only; the
  // decrypt-capable implementation lives in the test tree, and no production
  // source may contain decryption primitives until a reviewed execution-side
  // opener is added.
  { label: "test credential crypto", pattern: /testCredentialCrypto|createTestCredential|generateTestKey/ },
  { label: "credential decryption primitive", pattern: /createDecipheriv|setAuthTag/ },
  // R44B5E: the fictitious-provider registry is a test fixture; production
  // source enables no provider and may not reference the test ones.
  { label: "test provider registry", pattern: /testProviderRegistry|createTestProviderRegistry|TEST_PROVIDER/ },
];

const BUILTINS = new Set(builtinModules);
const IMPORT_PATTERN = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;

export function findViolations(text: string): string[] {
  return FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

export function importSpecifiers(text: string): string[] {
  return [...text.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? "");
}

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

const sourceFiles = listFiles(SRC_ROOT);
const migrationFiles = listFiles(MIGRATIONS_ROOT);
const scannedFiles = [...sourceFiles, ...migrationFiles, ...APP_CONFIG_FILES.map((file) => join(APP_ROOT, file))];
const label = (path: string) => relative(APP_ROOT, path).split(sep).join("/");
const read = (path: string) => readFileSync(path, "utf8");

describe("boundary scanner", () => {
  it("scans every production source file and no test file", () => {
    const labels = sourceFiles.map(label);

    expect(labels).toEqual(
      expect.arrayContaining([
        "src/config.ts",
        "src/createCommercialApiServer.ts",
        "src/main.ts",
        "src/runCommercialApiProcess.ts",
        "src/startCommercialApiServer.ts",
        "src/database/databaseConfig.ts",
        "src/database/migrationFiles.ts",
        "src/database/runMigrations.ts",
        "src/database/runtimeGrants.ts",
      ]),
    );
    expect(migrationFiles.map(label)).toEqual([
      "migrations/0001_commercial_schema_v1.sql",
      "migrations/0002_provider_connections.sql",
      "migrations/0003_generation_authorizations.sql",
    ]);
    expect(scannedFiles.map(label).some((path) => path.startsWith("tests/"))).toBe(false);
  });

  it.each([
    ['import { startOperatorServer } from "../../../src/operatorServer/startOperatorServer.js";', "private operator server"],
    ['fetch("http://127.0.0.1:4381/api/v1/operator/health")', "private operator port"],
    ["const key = process.env.GEMINI_API_KEY;", "provider secret variable"],
    ["const key = process.env.OTHER_PROVIDER_API_KEY;", "provider secret variable"],
    ["const secret = env.API_SECRET;", "provider secret variable"],
    ["const secret = process.env.RUNWAYML_API_SECRET;", "provider secret variable"],
    ["const root = process.env.BUSYBOOKIE_MEDIA_ROOT;", "media root"],
    ['import RunwayML from "@runwayml/sdk";', "provider SDK package"],
    ['import { GoogleGenAI } from "@google/genai";', "Google GenAI provider"],
    ['import "../../commercial-web/src/routes";', "commercial web app"],
    ['import "../../operator-console/src/api/operatorClient";', "operator console"],
    ['import { execFile } from "node:child_process";', "process spawning"],
    ['import { initializeApp } from "firebase/app";', "identity-provider vendor SDK"],
    ['import jwt from "jsonwebtoken";', "identity-provider vendor SDK"],
    ['import { jwtVerify } from "jose";', "identity-provider vendor SDK"],
    ['import passport from "passport";', "identity-provider vendor SDK"],
    ['const userId = request.headers["x-user-id"];', "client identity header"],
    ['const plan = request.headers["X-Plan"];', "client identity header"],
    ['import { createTestIdentityProvider } from "../tests/support/testIdentityProvider.js";', "test identity provider"],
    ['import { createTestCredentialOpener } from "../tests/support/testCredentialCrypto.js";', "test credential crypto"],
    ["const key = generateTestKey('k');", "test credential crypto"],
    ["const decipher = createDecipheriv('aes-256-gcm', key, nonce);", "credential decryption primitive"],
    ["decipher.setAuthTag(tag);", "credential decryption primitive"],
    ['import { createTestProviderRegistry } from "../tests/support/testProviderRegistry.js";', "test provider registry"],
    ["const registry = createTestProviderRegistry();", "test provider registry"],
    ['registry.resolve("TEST_PROVIDER");', "test provider registry"],
    ['import "dotenv/config";', ".env loading"],
    ["executeVeoSingleShot()", "Veo provider"],
  ])("detects a planted violation: %s", (text, expectedLabel) => {
    expect(findViolations(text)).toContain(expectedLabel);
  });

  it("does not flag the scaffold's own vocabulary", () => {
    expect(findViolations('const HEALTH_PATH = "/__health"; const DEFAULT_PORT = 4480;')).toEqual([]);
    expect(findViolations('client.query("SELECT pg_advisory_unlock($1::bigint) AS released")')).toEqual([]);
    expect(findViolations("CHECK (credential_kind IN ('API_KEY'))")).toEqual([]);
  });

  it.each(["unlockOperatorConsole()", "const UNLOCK_TOKEN = 1;", "// unlock the console", "pg_unlock_everything()"])(
    "still flags operator-style unlock usage: %s",
    (text) => {
      expect(findViolations(text)).toContain("operator unlock/session/token");
    },
  );
});

describe("commercial-api source boundary", () => {
  it.each(scannedFiles.map((path) => [label(path), path] as const))("%s references no forbidden surface", (_name, path) => {
    expect(findViolations(read(path))).toEqual([]);
  });

  it.each(sourceFiles.map((path) => [label(path), path] as const))(
    "%s imports only Node built-ins, approved packages and modules inside src",
    (_name, path) => {
      for (const specifier of importSpecifiers(read(path))) {
        if (specifier.startsWith(".")) {
          const target = resolve(dirname(path), specifier);
          expect(target.startsWith(SRC_ROOT + sep), `${specifier} escapes src`).toBe(true);
        } else if (APPROVED_EXTERNAL_IMPORTS.has(specifier)) {
          continue;
        } else {
          expect(specifier.startsWith("node:") && BUILTINS.has(specifier.slice(5)), `${specifier} is not a node: built-in`).toBe(
            true,
          );
        }
      }
    },
  );

  it("reads process.env only in the process entry points", () => {
    const readers = sourceFiles.filter((path) => /process\.env/.test(read(path))).map(label).sort();
    expect(readers).toEqual(PROCESS_ENTRY_POINTS);
  });

  it.each([
    ["src/config.ts", ["DEFAULT_HOST", "DEFAULT_PORT", "CONFIG_KEYS", "HOST_PATTERN", "PORT_PATTERN"]],
    ["src/database/databaseConfig.ts", ["DATABASE_CONFIG_KEYS", "DATABASE_CONFIG_INVALID"]],
    ["src/database/runtimeDatabaseConfig.ts", ["RUNTIME_DATABASE_KEYS", "BOUNDED_SETTINGS", "LOOPBACK_HOSTS", "INTEGER_PATTERN"]],
  ])("%s names only COMMERCIAL_API_* configuration keys", (file, constants) => {
    const keys = read(join(APP_ROOT, file)).match(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g) ?? [];
    const environmentKeys = keys.filter((key) => !constants.includes(key));

    expect(environmentKeys.length).toBeGreaterThan(0);
    for (const key of environmentKeys) {
      expect(key).toMatch(/^COMMERCIAL_API_/);
    }
  });
});

describe("package boundary", () => {
  const manifest = JSON.parse(read(join(APP_ROOT, "package.json"))) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts: Record<string, string>;
  };

  it("has exactly the approved runtime dependency", () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(["pg"]);
  });

  it("has only the approved development dependencies", () => {
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toEqual(["@types/node", "@types/pg", "typescript", "vitest"]);
  });

  it("pins every dependency to an exact version", () => {
    for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      expect(version, name).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
    }
  });

  it("starts compiled JavaScript, not TypeScript through a loader", () => {
    expect(manifest.scripts.start).toBe("node dist/main.js");
  });

  it("compiles into its own dist directory", () => {
    const buildConfig = JSON.parse(read(join(APP_ROOT, "tsconfig.build.json"))) as {
      compilerOptions: { outDir: string; rootDir: string };
    };
    expect(buildConfig.compilerOptions.outDir).toBe("./dist");
    expect(buildConfig.compilerOptions.rootDir).toBe("./src");
  });
});

describe("private engine release boundary", () => {
  // Read-only checks that the engine's compilation, test and release inputs do
  // not include this application.
  const rootTsconfig = JSON.parse(read(join(REPO_ROOT, "tsconfig.json"))) as { include: string[] };
  const rootBuildTsconfig = JSON.parse(read(join(REPO_ROOT, "tsconfig.build.json"))) as { include: string[] };

  it("is outside the engine TypeScript include set", () => {
    for (const pattern of [...rootTsconfig.include, ...rootBuildTsconfig.include]) {
      expect(pattern.startsWith("apps")).toBe(false);
      expect(pattern.startsWith("**")).toBe(false);
    }
    expect(rootBuildTsconfig.include).toEqual(["src/**/*.ts"]);
  });

  it("is outside the engine test suite", () => {
    expect(read(join(REPO_ROOT, "vitest.config.ts"))).not.toMatch(/apps\//);
  });

  it("is not referenced by the engine package scripts", () => {
    expect(read(join(REPO_ROOT, "package.json"))).not.toMatch(/commercial-api/);
  });
});
