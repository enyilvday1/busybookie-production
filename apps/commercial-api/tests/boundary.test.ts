import { existsSync, readdirSync, readFileSync } from "node:fs";
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
// The only approved external runtime imports: pg (R44B2D) and the shared,
// pure commercial-worker protocol package (R44B6I1). Everything else must be a
// node: built-in or a module inside src.
const APPROVED_EXTERNAL_IMPORTS = new Set(["pg", "commercial-worker-protocol"]);
const PROTOCOL_REFERENCE = "file:../../packages/commercial-worker-protocol";
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
  // The only path out of the app is the shared protocol package (R44B6I1).
  { label: "repository escape", pattern: /\.\.\/\.\.\/(?!packages\/commercial-worker-protocol\b)/ },
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
  // R44B6F: worker authentication is a vendor-neutral seam. The test adapter
  // never reaches production; no machine-identity vendor, mTLS peer
  // inspection, proxy-asserted identity header, worker credential variable or
  // hard-coded bearer secret exists. (rejectUnauthorized stays allowed: it is
  // the PostgreSQL TLS setting.)
  { label: "test worker authentication", pattern: /testWorkerAuthentication|createTestWorkerAuthenticationAdapter/ },
  { label: "worker identity header", pattern: /x-worker|worker-id|x-forwarded-client-cert|x-client-cert|x-ssl-client/i },
  {
    label: "machine identity vendor or mTLS",
    pattern: /spiffe|spire-agent|@aws-sdk|@google-cloud|@azure\/identity|metadata\.google\.internal|169\.254\.169\.254|getPeerCertificate|requestCert/i,
  },
  { label: "worker credential variable", pattern: /COMMERCIAL_API_WORKER|WORKER_(TOKEN|SECRET|SHARED|BEARER|API_KEY)/ },
  { label: "hard-coded bearer credential", pattern: /["'`]Bearer [A-Za-z0-9\-._~+/]{8,}/ },
  // R44B6G: the recording security sink is a test fixture.
  { label: "test worker security sink", pattern: /testWorkerSecurityEvents|createRecordingWorkerSecurityEventSink/ },
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
      "migrations/0004_worker_bridge_persistence.sql",
      "migrations/0005_submission_authority_provenance.sql",
      "migrations/0006_submission_lease_epoch_provenance.sql",
      "migrations/0007_input_failure_provenance.sql",
      "migrations/0008_generation_usage_ledger.sql",
      "migrations/0009_provider_connection_disconnect_convergence.sql",
      "migrations/0010_provider_connection_verification_workflow.sql",
      "migrations/0011_provider_verification_unsupported_deferral.sql",
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
    ['import { createTestWorkerAuthenticationAdapter } from "../tests/support/testWorkerAuthentication.js";', "test worker authentication"],
    ['const workerId = request.headers["x-worker-id"];', "worker identity header"],
    ['const cert = request.headers["X-Forwarded-Client-Cert"];', "worker identity header"],
    ["const peer = socket.getPeerCertificate(true);", "machine identity vendor or mTLS"],
    ["https.createServer({ requestCert: true }, handler);", "machine identity vendor or mTLS"],
    ['import { SPIFFEID } from "spiffe";', "machine identity vendor or mTLS"],
    ['import { STSClient } from "@aws-sdk/client-sts";', "machine identity vendor or mTLS"],
    ['fetch("http://169.254.169.254/latest/meta-data/");', "machine identity vendor or mTLS"],
    ["const secret = environment.COMMERCIAL_API_WORKER_TOKEN;", "worker credential variable"],
    ["const token = env.WORKER_SHARED_SECRET;", "worker credential variable"],
    ['const header = "Bearer worker-static-secret-123";', "hard-coded bearer credential"],
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

// R44B11C: issuance dispatches to the shared R44B11A request contract, whose
// exported provider/model identities and parsers carry the provider's name.
// Only this one policy module may name them, and only that one label is
// exempt. Its only external import is the shared protocol package; local
// relative imports remain subject to the ordinary commercial-api src boundary.
const GENERATION_POLICY_MODULE = "src/generationAuthorizations/generationAuthorityPolicy.ts";
const GENERATION_POLICY_LABEL_EXEMPTIONS: readonly string[] = ["Runway provider"];

describe("commercial-api source boundary", () => {
  it.each(scannedFiles.map((path) => [label(path), path] as const))("%s references no forbidden surface", (name, path) => {
    const exempt = name === GENERATION_POLICY_MODULE ? GENERATION_POLICY_LABEL_EXEMPTIONS : [];
    expect(findViolations(read(path)).filter((violation) => !exempt.includes(violation))).toEqual([]);
  });

  it("confines provider/model names to the generation policy module, whose only external import is the shared protocol", () => {
    const named = sourceFiles.filter((path) => findViolations(read(path)).includes("Runway provider")).map(label);
    expect(named).toEqual([GENERATION_POLICY_MODULE]);
    const policy = read(join(APP_ROOT, GENERATION_POLICY_MODULE));
    expect(importSpecifiers(policy).filter((specifier) => !specifier.startsWith("./"))).toEqual(["commercial-worker-protocol"]);
    // Every other forbidden surface stays forbidden in that module.
    expect(findViolations(policy).filter((violation) => !GENERATION_POLICY_LABEL_EXEMPTIONS.includes(violation))).toEqual([]);
  });

  // R44B11D: claim remains an internal service. No customer/application,
  // process or worker-control source may compose it before a later reviewed
  // route/production-enablement slice changes this boundary deliberately.
  it("keeps the R44B11D generation-authorization claim service internal and uncomposed", () => {
    const claimService = "src/generationAuthorizations/generationAuthorizationClaimService.ts";
    const importers = sourceFiles
      .filter((path) => label(path) !== claimService)
      .filter((path) =>
        importSpecifiers(read(path)).some((specifier) =>
          /generationAuthorizationClaimService\.js$/.test(specifier),
        ),
      )
      .map(label);

    expect(importers).toEqual([]);

    const claim = read(join(APP_ROOT, claimService));
    expect(
      importSpecifiers(claim).filter(
        (specifier) =>
          !specifier.startsWith(".") &&
          !specifier.startsWith("node:"),
      ),
    ).toEqual([]);
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

  it("has exactly the approved runtime dependencies", () => {
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(["commercial-worker-protocol", "pg"]);
    expect(manifest.dependencies?.["commercial-worker-protocol"]).toBe(PROTOCOL_REFERENCE);
  });

  it("has only the approved development dependencies", () => {
    expect(Object.keys(manifest.devDependencies ?? {}).sort()).toEqual(["@types/node", "@types/pg", "typescript", "vitest"]);
  });

  it("pins every registry dependency to an exact version (the protocol package is the one local reference)", () => {
    for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      if (name === "commercial-worker-protocol") continue;
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

// R44B6D: the worker bridge exists only as persistence. The worker process,
// its protocol package, worker routes and any credential opener are later,
// separately authorised steps.
describe("worker bridge boundary (persistence only)", () => {
  const sources = sourceFiles.map((path) => ({ path: label(path), text: read(path) }));
  const WORKER_ROUTE = /["'`]\/worker(s)?(\/|["'`])/;
  const OPENER_IMPLEMENTATION = /\bopen\s*\(\s*sealed|create\w*CredentialOpener|:\s*CredentialOpener\s*=/;

  it("never imports the separate commercial worker (R44B6I); shares only the protocol package (R44B6I1)", () => {
    expect(existsSync(join(REPO_ROOT, "apps", "commercial-worker", "package.json"))).toBe(true);
    const WORKER_APP = /commercial-worker(?!-protocol)/;
    expect(sources.filter(({ text }) => WORKER_APP.test(text)).map(({ path }) => path)).toEqual([]);
    expect(read(join(APP_ROOT, "package.json"))).not.toMatch(WORKER_APP);
    expect(existsSync(join(REPO_ROOT, "packages", "commercial-worker-protocol", "package.json"))).toBe(true);
  });

  it("exposes no worker route and implements no credential opener", () => {
    expect(sources.filter(({ text }) => WORKER_ROUTE.test(text)).map(({ path }) => path)).toEqual([]);
    expect(sources.filter(({ text }) => OPENER_IMPLEMENTATION.test(text)).map(({ path }) => path)).toEqual([]);
    // Guard the guards.
    expect('if (pathname === "/worker/leases")').toMatch(WORKER_ROUTE);
    expect("const opener: CredentialOpener = createKmsCredentialOpener(key);").toMatch(OPENER_IMPLEMENTATION);
    expect("export type CredentialOpener = Readonly<{").not.toMatch(OPENER_IMPLEMENTATION);
  });
});

// R44B6F: worker authentication is a contract and service only. Nothing in
// production composition imports it, so no default process can reach it.
describe("worker authentication boundary (seam only)", () => {
  const sources = sourceFiles.map((path) => ({ path: label(path), text: read(path) }));

  it("is composed only into the private worker-control router, never the default process", () => {
    // R44B6G: the worker-control router is the only consumer.
    const importers = sources
      .filter(({ path, text }) => !path.startsWith("src/workerAuthentication/") && /workerAuthentication\//.test(text))
      .map(({ path }) => path);
    expect(importers.sort()).toEqual(["src/workerControl/workerControlApplication.ts", "src/workerControl/workerSecurityEvents.ts"]);
    // The shared protocol package's name is the only "worker" text allowed here.
    const withoutProtocol = (text: string) => text.replaceAll('"commercial-worker-protocol"', '""');
    expect(withoutProtocol(read(join(SRC_ROOT, "runCommercialApiProcess.ts")))).not.toMatch(/worker/i);
    expect(withoutProtocol(read(join(SRC_ROOT, "main.ts")))).not.toMatch(/worker/i);
  });

  it("reads no worker identity from a query string, cookie or custom header", () => {
    const workerAuth = sources.filter(({ path }) => path.startsWith("src/workerAuthentication/"));
    expect(workerAuth.map(({ path }) => path).sort()).toEqual([
      "src/workerAuthentication/workerAuthentication.ts",
      "src/workerAuthentication/workerAuthenticationAdapter.ts",
      "src/workerAuthentication/workerAuthenticationError.ts",
    ]);
    // Code only: comments may name what is deliberately absent.
    const code = (text: string) => text.replace(/^\s*\/\/.*$/gm, "");
    for (const { text } of workerAuth) {
      expect(code(text)).not.toMatch(/searchParams|request\.url|cookie|request\.headers\[|process\.env|remoteAddress|localhost|127\.0\.0\.1/i);
    }
    expect(code("// no cookie here\nconst x = 1;")).not.toMatch(/cookie/i);
    // Guard the guard.
    expect('const id = url.searchParams.get("worker");').toMatch(/searchParams|request\.url|cookie|request\.headers\[|process\.env|remoteAddress|localhost|127\.0\.0\.1/i);
  });
});

// R44B6G: worker-control leases only. The router lives in src/workerControl,
// is never composed by the default process, and nothing in it can decrypt,
// read fingerprints, enter SUBMITTED or reach a provider. R44B6H confines the
// credential grant and R44B6J confines entering SUBMITTING to one service each.
describe("worker-control boundary (lease foundation only)", () => {
  const sources = sourceFiles.map((path) => ({ path: label(path), text: read(path) }));
  const code = (text: string) => text.replace(/^\s*\/\/.*$/gm, "");
  const workerControl = sources.filter(({ path }) => path.startsWith("src/workerControl/"));
  // Never anywhere in worker-control (R44B6G, narrowed by R44B6J and R44B6O):
  // fingerprints, decryption or an opener.
  const FORBIDDEN_IN_WORKER_CONTROL =
    /fingerprint_|CredentialOpener\s*=|:\s*CredentialOpener|\.open\s*\(|createDecipheriv/i;
  // R44B6O/R44B6R: only the live acknowledgement and tokenless recovery
  // services may enter SUBMITTED and record a provider execution identity.
  const SUBMITTED_ONLY = /'SUBMITTED'|provider_execution_id\s*=|submitted_at\s*=/i;
  const SUBMITTED_SERVICE = "src/workerControl/workerSubmittedService.ts";
  const RECOVERY_SERVICE = "src/workerControl/workerAcceptanceRecoveryService.ts";
  // R44B6H: writing the grant timestamp and reading the sealed envelope are
  // confined to the credential-grant service.
  const GRANT_ONLY = /SET\s[^;`]*credential_granted_at\s*=|sealed_credential/i;
  const GRANT_SERVICE = "src/workerControl/workerCredentialGrantService.ts";
  // R44B11F Phase 3: the one verification credential grant, which writes the
  // grant timestamp of provider_verification_jobs only.
  const VERIFICATION_GRANT_SERVICE = "src/workerControl/workerProviderVerificationCredentialGrantService.ts";
  // R44B6J: entering SUBMITTING is confined to the fenced acknowledgement service.
  // R44B6M narrows this to writes: the expired-SUBMITTING sweep may select
  // SUBMITTING rows, but never sets the state or the barrier timestamp.
  const SUBMITTING_ONLY = /(\bSET|,)\s*state\s*=\s*'SUBMITTING'|submitting_at\s*=(?!=)/i;
  const SUBMITTING_SERVICE = "src/workerControl/workerSubmittingService.ts";
  // R44B6M: OUTCOME_UNKNOWN is entered only by the control-plane sweep in the
  // lease service; R44B6T adds the submission-failed report.
  const OUTCOME_UNKNOWN_ONLY = /(\bSET|,)\s*state\s*=\s*'OUTCOME_UNKNOWN'/i;
  const SWEEP_SERVICE = "src/workerControl/workerLeaseService.ts";
  // R44B6T: FAILED_BEFORE_SUBMISSION is entered only by the submission-failed report.
  // R44B10P2 adds the pre-provider input-failed report.
  const FAILED_BEFORE_SUBMISSION_ONLY = /(\bSET|,)\s*state\s*=\s*'FAILED_BEFORE_SUBMISSION'/i;
  const SUBMISSION_FAILED_SERVICE = "src/workerControl/workerSubmissionFailedService.ts";
  const INPUT_FAILED_SERVICE = "src/workerControl/workerInputFailedService.ts";

  it("keeps worker-control routes inside src/workerControl and out of the default process", () => {
    expect(workerControl.map(({ path }) => path).sort()).toEqual([
      "src/workerControl/workerAcceptanceRecoveryService.ts",
      "src/workerControl/workerControlApplication.ts",
      "src/workerControl/workerCredentialGrantService.ts",
      "src/workerControl/workerInputFailedService.ts",
      "src/workerControl/workerLeasePolicy.ts",
      "src/workerControl/workerLeaseService.ts",
      "src/workerControl/workerProviderVerificationCredentialGrantService.ts",
      "src/workerControl/workerProviderVerificationDeferralService.ts",
      "src/workerControl/workerProviderVerificationLeaseService.ts",
      "src/workerControl/workerProviderVerificationResultService.ts",
      "src/workerControl/workerProviderVerificationVerifyingService.ts",
      "src/workerControl/workerSecurityEvents.ts",
      "src/workerControl/workerSubmissionFailedService.ts",
      "src/workerControl/workerSubmittedService.ts",
      "src/workerControl/workerSubmittingService.ts",
    ]);
    const routeOwners = sources.filter(({ text }) => /worker-control/.test(code(text))).map(({ path }) => path);
    expect(routeOwners).toEqual(["src/workerControl/workerControlApplication.ts"]);
    const importers = sources.filter(({ path, text }) => !path.startsWith("src/workerControl/") && /workerControl\//.test(text)).map(({ path }) => path);
    expect(importers).toEqual([]);
  });

  it("cannot decrypt or read fingerprints anywhere in worker-control", () => {
    for (const { path, text } of workerControl) {
      expect({ path, violates: FORBIDDEN_IN_WORKER_CONTROL.test(code(text)) }).toEqual({ path, violates: false });
    }
    // Guard the guards.
    expect("SELECT fingerprint_value FROM provider_credential_versions").toMatch(FORBIDDEN_IN_WORKER_CONTROL);
    expect("const plaintext = await opener.open(envelope, context);").toMatch(FORBIDDEN_IN_WORKER_CONTROL);
    expect("type CredentialSealingContext").not.toMatch(FORBIDDEN_IN_WORKER_CONTROL);
  });

  it("confines entering SUBMITTED to the live acknowledgement and acceptance-recovery services", () => {
    const offenders = workerControl.filter(({ path, text }) => ![SUBMITTED_SERVICE, RECOVERY_SERVICE].includes(path) && SUBMITTED_ONLY.test(code(text))).map(({ path }) => path);
    expect(offenders).toEqual([]);
    const service = code(read(join(APP_ROOT, SUBMITTED_SERVICE)));
    expect(SUBMITTED_ONLY.test(service)).toBe(true);
    expect(GRANT_ONLY.test(service)).toBe(false);
    const statements = service.replace(/\/\/.*$/gm, "");
    // No secret material, no recovery horizon, no job status change, no provider client.
    expect(/sealed|envelope|recovery_expires_at\s*=|credential_granted_at\s*=|submitting_at\s*=|UPDATE\s+execution_jobs|fetch\s*\(|https?:/i.test(statements)).toBe(false);
    // Guard the guards.
    expect("SET state = 'SUBMITTED'").toMatch(SUBMITTED_ONLY);
    expect("SET submitted_at = now()").toMatch(SUBMITTED_ONLY);
    expect("SET provider_execution_id = $2").toMatch(SUBMITTED_ONLY);
    expect('const HEARTBEAT_STATES = ["LEASED", "SUBMITTING", "SUBMITTED"] as const;').not.toMatch(SUBMITTED_ONLY);
    expect("epoch.provider_execution_id !== providerExecutionId").not.toMatch(SUBMITTED_ONLY);
    const recovery = code(read(join(APP_ROOT, RECOVERY_SERVICE))).replace(/\/\/.*$/gm, "");
    expect(SUBMITTED_ONLY.test(recovery)).toBe(true);
    expect(GRANT_ONLY.test(recovery)).toBe(false);
    expect(/sealed|envelope|fetch\s*\(|https?:|recovery_expires_at\s*=(?!=)|submitting_at\s*=(?!=)|submitting_worker_principal_id\s*=(?!=)|submitting_fencing_counter\s*=(?!=)|lease_token_sha256\s*=(?!=)|lease_worker_principal_id\s*=(?!=)|lease_fencing_counter\s*=(?!=)/i.test(recovery)).toBe(false);
  });

  it("confines entering SUBMITTING to the fenced acknowledgement service, which reads no secret material", () => {
    const offenders = workerControl.filter(({ path, text }) => path !== SUBMITTING_SERVICE && SUBMITTING_ONLY.test(code(text))).map(({ path }) => path);
    expect(offenders).toEqual([]);
    const service = code(read(join(APP_ROOT, SUBMITTING_SERVICE)));
    expect(SUBMITTING_ONLY.test(service)).toBe(true);
    expect(GRANT_ONLY.test(service)).toBe(false);
    expect(/sealed|envelope|recovery_expires_at\s*=|credential_granted_at\s*=/i.test(service.replace(/\/\/.*$/gm, ""))).toBe(false);
    // Guard the guards.
    expect("SET state = 'SUBMITTING'").toMatch(SUBMITTING_ONLY);
    expect("UPDATE execution_attempts SET heartbeat_at = now(), state = 'SUBMITTING'").toMatch(SUBMITTING_ONLY);
    expect('acceptedStates = ["LEASED"]').not.toMatch(SUBMITTING_ONLY);
    expect("SELECT id FROM execution_attempts WHERE state = 'SUBMITTING' AND lease_expires_at <= now()").not.toMatch(SUBMITTING_ONLY);
    expect("attempt.submitting_at === null").not.toMatch(SUBMITTING_ONLY);
    expect("SET submitting_at = now()").toMatch(SUBMITTING_ONLY);
    expect("SET state = 'OUTCOME_UNKNOWN', failure_code = 'X' FROM expired WHERE a.id = expired.id AND a.state = 'SUBMITTING'").not.toMatch(SUBMITTING_ONLY);
  });

  it("confines entering OUTCOME_UNKNOWN to the control-plane sweep and the submission-failed report", () => {
    const offenders = workerControl
      .filter(({ path, text }) => ![SWEEP_SERVICE, SUBMISSION_FAILED_SERVICE].includes(path) && OUTCOME_UNKNOWN_ONLY.test(code(text)))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
    expect(OUTCOME_UNKNOWN_ONLY.test(code(read(join(APP_ROOT, SWEEP_SERVICE))))).toBe(true);
    expect(OUTCOME_UNKNOWN_ONLY.test(code(read(join(APP_ROOT, SUBMISSION_FAILED_SERVICE))))).toBe(true);
    // Guard the guard.
    expect("SET state = 'OUTCOME_UNKNOWN', failure_code = 'X'").toMatch(OUTCOME_UNKNOWN_ONLY);
  });

  it("confines entering FAILED_BEFORE_SUBMISSION to the submission-failed report, which is token-free on replay and reads no secret", () => {
    const offenders = workerControl
      .filter(({ path, text }) => ![SUBMISSION_FAILED_SERVICE, INPUT_FAILED_SERVICE].includes(path) && FAILED_BEFORE_SUBMISSION_ONLY.test(code(text)))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
    const service = code(read(join(APP_ROOT, SUBMISSION_FAILED_SERVICE))).replace(/\/\/.*$/gm, "");
    expect(FAILED_BEFORE_SUBMISSION_ONLY.test(service)).toBe(true);
    // Never SUBMITTED, a provider identity, SUBMITTING, a grant, secret material, the
    // sweep-only code, a lease (re)creation or a provider client.
    expect(SUBMITTED_ONLY.test(service)).toBe(false);
    expect(SUBMITTING_ONLY.test(service)).toBe(false);
    expect(GRANT_ONLY.test(service)).toBe(false);
    const FORBIDDEN_IN_SUBMISSION_FAILED =
      /sealed|envelope|WORKER_LEASE_EXPIRED_DURING_SUBMISSION|lease_token_sha256\s*=(?!\s*NULL\b)|lease_fencing_counter\s*=(?!=)|submitting_worker_principal_id\s*=(?!=)|submitting_fencing_counter\s*=(?!=)|recovery_expires_at\s*=|fetch\s*\(|https?:/i;
    expect(FORBIDDEN_IN_SUBMISSION_FAILED.test(service)).toBe(false);
    // Guard the guards.
    expect("lease_token_sha256 = NULL, leased_at = NULL").not.toMatch(FORBIDDEN_IN_SUBMISSION_FAILED);
    expect("lease_token_sha256 = $3").toMatch(FORBIDDEN_IN_SUBMISSION_FAILED);
    expect("SET lease_fencing_counter = lease_fencing_counter + 1").toMatch(FORBIDDEN_IN_SUBMISSION_FAILED);
    expect("Number(row.lease_fencing_counter) !== proof.fencingCounter").not.toMatch(FORBIDDEN_IN_SUBMISSION_FAILED);
    expect("SET state = 'FAILED_BEFORE_SUBMISSION', failure_code = $2").toMatch(FAILED_BEFORE_SUBMISSION_ONLY);
    expect("WHERE state = 'FAILED_BEFORE_SUBMISSION'").not.toMatch(FAILED_BEFORE_SUBMISSION_ONLY);
  });

  // R44B10P2: the pre-provider input-failed report enters FAILED_BEFORE_SUBMISSION
  // only from a granted LEASED attempt, never names its guard-stamped
  // provenance, keeps no lease-token verifier and has no provider semantics.
  it("confines the input-failed report to granted LEASED -> FAILED_BEFORE_SUBMISSION, with guard-stamped provenance only", () => {
    const service = code(read(join(APP_ROOT, INPUT_FAILED_SERVICE))).replace(/\/\/.*$/gm, "");
    expect(FAILED_BEFORE_SUBMISSION_ONLY.test(service)).toBe(true);
    expect(service).toMatch(/WHERE id = \$1 AND state = 'LEASED' AND credential_granted_at IS NOT NULL AND submitting_at IS NULL/);
    expect(service).toMatch(/await requireActiveWorker\(client, context\.workerPrincipalId\);/);
    expect(service).toMatch(/await lockCurrentLease\(client, context, attemptId, proof, \["LEASED"\]\);/);
    expect(service).toMatch(/UPDATE execution_jobs SET status = 'FAILED', completed_at = now\(\), updated_at = now\(\) WHERE id = \$1 AND status = 'RUNNING'/);
    expect(service).toMatch(/"execution_attempt\.input_failed"/);
    expect(service.match(/await audit\(/g)).toHaveLength(1);
    // Never SUBMITTING, SUBMITTED, OUTCOME_UNKNOWN, a grant write, secret material,
    // a provider identity or call, a written provenance or a kept token verifier.
    expect(SUBMITTED_ONLY.test(service)).toBe(false);
    expect(SUBMITTING_ONLY.test(service)).toBe(false);
    expect(OUTCOME_UNKNOWN_ONLY.test(service)).toBe(false);
    expect(GRANT_ONLY.test(service)).toBe(false);
    const FORBIDDEN_IN_INPUT_FAILED =
      /sealed|envelope|fingerprint|provider_execution_id|providerExecutionId|NEEDS_ATTENTION|'QUEUED'|lease_token_sha256\s*=(?!\s*NULL\b)|lease_fencing_counter\s*=(?!=)|input_failed_\w+\s*=(?!=)|submitting_worker_principal_id\s*=(?!=)|submitting_fencing_counter\s*=(?!=)|recovery_expires_at|credential_granted_at\s*=(?!=)|INSERT INTO execution_attempts|FOR SHARE|fetch\s*\(|https?:|object_key|objectKey|\bsha256\b|signedUrl/i;
    expect(FORBIDDEN_IN_INPUT_FAILED.test(service)).toBe(false);
    // Replay is authorised by the stamped reporter and epoch, never the token.
    expect(service).toMatch(/row\.input_failed_worker_principal_id !== context\.workerPrincipalId/);
    expect(service).toMatch(/Number\(row\.input_failed_fencing_counter\) !== proof\.fencingCounter/);
    const replay = service.slice(service.indexOf('if (row.state !== "LEASED") {'), service.indexOf("const lease = await lockCurrentLease("));
    expect(replay.length).toBeGreaterThan(0);
    expect(/leaseToken|lease_token|UPDATE|INSERT|audit\(/.test(replay)).toBe(false);
    // Reporter, then epoch, then the failure code.
    expect(replay.indexOf("INPUT_FAILURE_PRINCIPAL_MISMATCH")).toBeLessThan(replay.indexOf("FENCING_MISMATCH"));
    expect(replay.indexOf("FENCING_MISMATCH")).toBeLessThan(replay.indexOf("row.failure_code !== failureCode"));
    // Exactly the five closed codes.
    expect(service).toMatch(
      /export const INPUT_FAILURE_CODES = Object\.freeze\(\[\s*"INPUT_REFERENCE_INVALID",\s*"INPUT_OBJECT_NOT_FOUND",\s*"INPUT_OBJECT_TOO_LARGE",\s*"INPUT_OBJECT_INTEGRITY_MISMATCH",\s*"INPUT_MEDIA_TYPE_INVALID",\s*\] as const\);/,
    );
    // Guard the guards.
    expect("SET input_failed_worker_principal_id = $3").toMatch(FORBIDDEN_IN_INPUT_FAILED);
    expect("row.input_failed_worker_principal_id !== context.workerPrincipalId").not.toMatch(FORBIDDEN_IN_INPUT_FAILED);
    expect("lease_token_sha256 = NULL, leased_at = NULL").not.toMatch(FORBIDDEN_IN_INPUT_FAILED);
  });

  it("routes input-failed only through the worker-control wrapper with a closed body and its own security event", () => {
    const application = code(read(join(SRC_ROOT, "workerControl", "workerControlApplication.ts")));
    expect(application).toMatch(/\|submission-failed\|input-failed\)\$\/;/);
    expect(application).toMatch(/const INPUT_FAILED_MEMBERS: ReadonlySet<string> = new Set\(\["fencingCounter", "leaseToken", "failureCode"\]\);/);
    expect(application).toMatch(/if \(!isInputFailureCode\(failureCode\)\) throw new RequestBodyError\("INVALID_REQUEST"\);/);
    const handler = application.slice(application.indexOf("const inputFailed = (attemptId: string) =>"), application.indexOf("return Object.freeze({\n    route:"));
    expect(handler.length).toBeGreaterThan(0);
    expect(handler).toMatch(/route\(/);
    expect(handler).toMatch(/"WORKER_INPUT_FAILURE_REJECTED"/);
    expect(handler).toMatch(/readJsonObjectBody\(request, INPUT_FAILED_MEMBERS\)/);
    expect(handler.match(/sendJson\(/g)).toHaveLength(1);
    // Exactly the four acknowledgement members.
    expect(handler).toMatch(/sendJson\(response, 200, \{\s*executionAttemptId: result\.executionAttemptId,\s*fencingCounter: result\.fencingCounter,\s*state: result\.state,\s*failureCode: result\.failureCode,\s*\}\);/);
    const events = code(read(join(SRC_ROOT, "workerControl", "workerSecurityEvents.ts")));
    expect(events).toMatch(/\| "WORKER_INPUT_FAILURE_REJECTED";/);
  });

  it("confines the grant timestamp write and the sealed-envelope read to the credential-grant service", () => {
    // R44B6X0: the lease service may only clear the grant marker, when it
    // requeues an expired LEASED attempt; it never sets or reads a grant.
    const CLEAR_GRANT = "credential_granted_at = NULL";
    const withoutAllowedClear = (path: string, text: string) => (path === SWEEP_SERVICE ? text.split(CLEAR_GRANT).join("") : text);
    const offenders = workerControl
      .filter(({ path, text }) => ![GRANT_SERVICE, VERIFICATION_GRANT_SERVICE].includes(path) && GRANT_ONLY.test(withoutAllowedClear(path, code(text))))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
    expect(GRANT_ONLY.test(code(read(join(APP_ROOT, GRANT_SERVICE))))).toBe(true);
    // R44B11F: the verification grant writes only the verification job's
    // grant timestamp, never a generation attempt's.
    const verificationGrant = code(read(join(APP_ROOT, VERIFICATION_GRANT_SERVICE)));
    expect(GRANT_ONLY.test(verificationGrant)).toBe(true);
    expect(verificationGrant).toMatch(/UPDATE provider_verification_jobs SET credential_granted_at = now\(\), updated_at = now\(\)/);
    expect(/execution_attempts|execution_jobs|generation_authorizations/.test(verificationGrant)).toBe(false);
    const leaseService = code(read(join(APP_ROOT, SWEEP_SERVICE)));
    expect(leaseService.split(CLEAR_GRANT).length - 1).toBe(1);
    expect(/SET state = 'QUEUED', credential_granted_at = NULL,/.test(leaseService)).toBe(true);
    expect(/provider_credential_versions/.test(leaseService.slice(leaseService.indexOf("async function reclaimExpiredLeases"), leaseService.indexOf("export async function sweepExpiredSubmittingAttempts")))).toBe(false);
    // Guard the guards.
    expect("SET state = 'LEASED', credential_granted_at = now()").toMatch(GRANT_ONLY);
    expect("credential_granted_at IS NULL").not.toMatch(GRANT_ONLY);
    expect(withoutAllowedClear(SWEEP_SERVICE, "SET state = 'QUEUED', credential_granted_at = now()")).toMatch(GRANT_ONLY);
    expect(withoutAllowedClear(GRANT_SERVICE, "SET state = 'QUEUED', credential_granted_at = NULL")).toMatch(GRANT_ONLY);
  });

  it("enables no CORS and reads no cookie or session", () => {
    for (const { text } of workerControl) {
      expect(code(text)).not.toMatch(/Access-Control-Allow|cookie|Set-Cookie|session/i);
    }
  });
});

// R44B11F Phase 3: provider-verification worker-control services. They are
// independent of generation execution, never call a provider or open a
// credential, and each lifecycle write is confined to its one service.
describe("R44B11F provider-verification worker-control boundary", () => {
  const code = (text: string) => text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\/.*$/gm, "");
  const service = (name: string) => code(read(join(SRC_ROOT, "workerControl", name)));
  const LEASE = "workerProviderVerificationLeaseService.ts";
  const GRANT = "workerProviderVerificationCredentialGrantService.ts";
  const VERIFYING = "workerProviderVerificationVerifyingService.ts";
  const RESULT = "workerProviderVerificationResultService.ts";
  // R44B11G (B8): the unsupported-lease deferral service is held to the same
  // no-provider-call, no-generation and state-write confinement rules.
  const DEFERRAL = "workerProviderVerificationDeferralService.ts";
  const ALL = [LEASE, GRANT, VERIFYING, RESULT, DEFERRAL];
  const NO_PROVIDER_CALL = /fetch\s*\(|https?:|node:https?|node:net|node:tls|undici|\.open\s*\(|createDecipheriv|CredentialOpener/;
  const NO_GENERATION = /execution_attempts|execution_jobs|generation_authorizations/;

  it("touches no generation execution and performs no provider call or credential opening", () => {
    for (const name of ALL) {
      const text = service(name);
      expect({ name, provider: NO_PROVIDER_CALL.test(text), generation: NO_GENERATION.test(text) }).toEqual({ name, provider: false, generation: false });
    }
    // Guard the guards.
    expect(NO_PROVIDER_CALL.test('await fetch("https://example.invalid")')).toBe(true);
    expect(NO_GENERATION.test("UPDATE execution_attempts SET")).toBe(true);
  });

  it("confines each verification state write to its one service", () => {
    const writes: Readonly<Record<string, RegExp>> = {
      [LEASE]: /SET state = 'LEASED', lease_worker_principal_id = \$2, lease_token_sha256 = \$3,\s*lease_fencing_counter = lease_fencing_counter \+ 1/,
      [VERIFYING]: /SET state = 'VERIFYING', verifying_at = now\(\), verifying_worker_principal_id = \$2,\s*verifying_fencing_counter = lease_fencing_counter/,
      [RESULT]: /SET state = 'COMPLETED', lease_worker_principal_id = NULL, lease_token_sha256 = NULL,/,
      [DEFERRAL]: /SET state = 'QUEUED', lease_worker_principal_id = NULL, lease_token_sha256 = NULL,\s*leased_at = NULL, lease_expires_at = NULL,\s*unsupported_deferral_count = unsupported_deferral_count \+ 1/,
    };
    const STATE_WRITE = /\bSET\s+state\s*=|verifying_at\s*=\s*now|result_outcome\s*=|last_verification_attempt_at\s*=|verification_status\s*=/;
    for (const name of ALL) {
      const text = service(name);
      if (name in writes) expect(text, name).toMatch(writes[name]!);
      else expect(STATE_WRITE.test(text), name).toBe(false);
    }
    // Only the barrier stamps the aggregate attempt; only the result applies it.
    expect(service(VERIFYING)).toMatch(/UPDATE provider_connections SET last_verification_attempt_at = now\(\), updated_at = now\(\)/);
    expect(/verification_status\s*=|verified_at\s*=/.test(service(VERIFYING))).toBe(false);
    expect(/last_verification_attempt_at\s*=/.test(service(RESULT))).toBe(false);
    // The lease stores only the token verifier, for exactly 30 seconds of database time.
    expect(service(LEASE)).toMatch(/export const PROVIDER_VERIFICATION_LEASE_SECONDS = 30;/);
    expect(service(LEASE)).toMatch(/FOR UPDATE OF j SKIP LOCKED/);
    expect(service(LEASE)).toMatch(/sha256Hex\(leaseToken\)/);
  });

  it("accepts exactly the published worker-reportable result vocabulary", () => {
    const result = service(RESULT);
    expect(/WORKER_LOST_AFTER_CREDENTIAL_GRANT"|WORKER_LOST_DURING_VERIFYING"|CREDENTIAL_ACCEPTED/.test(result)).toBe(false);
    expect(result).toMatch(/VERIFIED: Object\.freeze\(\["VERIFICATION_SUCCEEDED"\]\)/);
    expect(result).toMatch(/DEFINITIVE_FAILURE: Object\.freeze\(\["CREDENTIAL_REJECTED", "CREDENTIAL_NOT_AUTHORIZED"\]\)/);
    const application = code(read(join(SRC_ROOT, "workerControl", "workerControlApplication.ts")));
    expect(application).toMatch(/const VERIFICATION_RESULT_MEMBERS: ReadonlySet<string> = new Set\(\["fencingCounter", "leaseToken", "outcome", "reasonCode"\]\);/);
    expect(application).toMatch(/if \(!isProviderVerificationOutcome\(outcome\) \|\| !isWorkerReportableVerificationReason\(reasonCode\)\) throw new RequestBodyError\("INVALID_REQUEST"\);/);
  });

  // R44B11G B8: the deferral columns are written only by the deferral service,
  // anywhere in commercial-api source. Comparisons such as the lease query's
  // COALESCE(j.deferred_until, j.created_at) <= now() are reads, not writes.
  const DEFERRAL_COLUMN_WRITE = /\b(deferred_until|unsupported_deferral_count|last_unsupported_refusal)\s*=(?!=)/;

  it("confines writes of the R44B11G deferral columns to the deferral service (B8)", () => {
    const writers = sourceFiles.filter((path) => DEFERRAL_COLUMN_WRITE.test(code(read(path)))).map(label);
    expect(writers).toEqual([`src/workerControl/${DEFERRAL}`]);
    const deferral = service(DEFERRAL);
    // The three SET assignments, then the guarded UPDATE's optimistic count check
    // (WHERE ... unsupported_deferral_count = $4), which the pattern cannot tell apart.
    expect(deferral.match(new RegExp(DEFERRAL_COLUMN_WRITE.source, "g"))).toEqual([
      "unsupported_deferral_count =",
      "last_unsupported_refusal =",
      "deferred_until =",
      "unsupported_deferral_count =",
    ]);
    // Guard the guard.
    expect(DEFERRAL_COLUMN_WRITE.test("SET deferred_until = now() + make_interval(secs => $6)")).toBe(true);
    expect(DEFERRAL_COLUMN_WRITE.test("unsupported_deferral_count = unsupported_deferral_count + 1")).toBe(true);
    expect(DEFERRAL_COLUMN_WRITE.test("AND COALESCE(j.deferred_until, j.created_at) <= now()")).toBe(false);
    expect(DEFERRAL_COLUMN_WRITE.test("deferred_until <= now() + d")).toBe(false);
    expect(DEFERRAL_COLUMN_WRITE.test("deferred_until == x")).toBe(false);
  });

  it("keeps the deferral service non-terminal, audit-free and lifecycle-lock-free, with the published lock order and checks (N5, section 4.3)", () => {
    const deferral = service(DEFERRAL);
    // N5: no terminal state, terminal reason, completion time or result field.
    expect(/CANCELLED|COMPLETED|terminal_reason_code|completed_at|result_/.test(deferral)).toBe(false);
    // No audit row, and no Account, connection or credential-version read or lock.
    expect(/audit|INSERT\s+INTO|accounts|users|provider_connections|provider_credential_versions|lockVerificationLifecycle|requireEligibleForVerification|isCurrentForAggregate/.test(deferral)).toBe(false);
    // No credential grant, VERIFYING barrier or provider surface.
    expect(/credential_granted_at\s*=(?!=)|'VERIFYING'|verifying_|sealed|envelope|fingerprint|DELETE\s+FROM/i.test(deferral)).toBe(false);
    // Lock order: principal FOR SHARE, then the job FOR UPDATE; then LEASED, the live proof and no grant.
    const order = [
      "await requireActiveWorker(client, context.workerPrincipalId);",
      "const job = await lockVerificationJob(client, jobId);",
      'if (job.state !== "LEASED") throw rejectVerification("NOT_LEASED");',
      "requireLiveVerificationLease(job, context, proof);",
      'if (job.credentialGrantedAt !== null) throw rejectVerification("CREDENTIAL_GRANTED");',
      "UPDATE provider_verification_jobs",
    ].map((step) => deferral.indexOf(step));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(deferral.match(/UPDATE provider_verification_jobs/g)).toHaveLength(1);
    expect(deferral.match(/FOR (UPDATE|SHARE)/g)).toBeNull();
    // The guarded UPDATE: same live lease, no grant, one increment, database-clock deferral.
    expect(deferral).toMatch(
      /WHERE id = \$1 AND state = 'LEASED' AND credential_granted_at IS NULL\s+AND lease_worker_principal_id = \$2 AND lease_fencing_counter = \$3 AND unsupported_deferral_count = \$4/,
    );
    expect(deferral).toMatch(/deferred_until = now\(\) \+ make_interval\(secs => \$6\)/);
    expect(deferral).not.toMatch(/lease_fencing_counter\s*=\s*lease_fencing_counter|clock_timestamp|Date\.now|new Date\(/);
    // The exact production schedule d(n) is the default.
    expect(deferral).toMatch(/return deferralCount >= 5 \? 3600 : 300 \* 2 \*\* \(deferralCount - 1\);/);
    expect(deferral).toMatch(/schedule: UnsupportedDeferralSchedule = unsupportedDeferralSeconds,/);
    expect(deferral).toMatch(
      /export const PROVIDER_VERIFICATION_REFUSALS = Object\.freeze\(\["UNSUPPORTED_PROVIDER", "UNSUPPORTED_POLICY", "PROVIDER_POLICY_MISMATCH"\] as const\);/,
    );
  });

  it("routes the deferral only through the worker-control wrapper, with three members and no schedule (B1-B3)", () => {
    const application = code(read(join(SRC_ROOT, "workerControl", "workerControlApplication.ts")));
    expect(application).toMatch(/\\\/\(credential-grant\|verifying\|result\|unsupported\)\$\/;/);
    expect(application).toMatch(/const UNSUPPORTED_MEMBERS: ReadonlySet<string> = new Set\(\["fencingCounter", "leaseToken", "refusal"\]\);/);
    expect(application).toMatch(/if \(!isProviderVerificationRefusal\(refusal\)\) throw new RequestBodyError\("INVALID_REQUEST"\);/);
    // B1: exactly (pool, context, jobId, proof, refusal), once, with no schedule argument.
    expect(application.match(/deferUnsupportedProviderVerification\(/g)).toHaveLength(1);
    expect(application).toMatch(/await deferUnsupportedProviderVerification\(pool, context, jobId, proof, refusal\);/);
    const handler = application.slice(application.indexOf("const verificationUnsupported = (jobId: string) =>"), application.indexOf("const verificationLeaseRoute"));
    expect(handler.length).toBeGreaterThan(0);
    expect(handler).toMatch(/"WORKER_PROVIDER_VERIFICATION_DEFERRAL_REJECTED"/);
    expect(handler).toMatch(/readJsonObjectBody\(request, UNSUPPORTED_MEMBERS\)/);
    expect(handler.match(/sendJson\(/g)).toHaveLength(1);
    expect(handler).toMatch(
      /sendJson\(response, 200, \{\s*providerVerificationJobId: deferral\.providerVerificationJobId,\s*fencingCounter: deferral\.fencingCounter,\s*state: deferral\.state,\s*deferredUntil: deferral\.deferredUntil\.toISOString\(\),\s*\}\);/,
    );
    // B2: only the deferral service names the schedule seam; no source calls the service elsewhere.
    const seamUsers = sourceFiles
      .filter((path) => /UnsupportedDeferralSchedule|unsupportedDeferralSeconds/.test(code(read(path))))
      .map(label);
    expect(seamUsers).toEqual([`src/workerControl/${DEFERRAL}`]);
    const callers = sourceFiles.filter((path) => /deferUnsupportedProviderVerification\(/.test(code(read(path)))).map(label);
    expect(callers.sort()).toEqual(["src/workerControl/workerControlApplication.ts", `src/workerControl/${DEFERRAL}`]);
    // No verification release route (/release stays 404).
    const verificationAction = application.slice(application.indexOf("const VERIFICATION_ACTION ="), application.indexOf("const VERIFICATION_RESULT_MEMBERS"));
    expect(verificationAction).toMatch(/\(credential-grant\|verifying\|result\|unsupported\)\$\/;/);
    expect(verificationAction).not.toMatch(/release/);
    const events = code(read(join(SRC_ROOT, "workerControl", "workerSecurityEvents.ts")));
    expect(events.match(/"WORKER_PROVIDER_VERIFICATION_DEFERRAL_REJECTED"/g)).toHaveLength(1);
  });

  it("has no terminal unsupported vocabulary and compares the deferral count with no constant anywhere in source (N5)", () => {
    const COUNT_COMPARED_WITH_CONSTANT = /unsupported_deferral_count\s*(<>|!=|<=|>=|<|>|=)\s*\d/;
    for (const path of sourceFiles) {
      const text = code(read(path));
      expect({ path: label(path), unschedulable: /VERIFICATION_UNSCHEDULABLE/.test(read(path)), compared: COUNT_COMPARED_WITH_CONSTANT.test(text) }).toEqual({
        path: label(path),
        unschedulable: false,
        compared: false,
      });
    }
    // Guard the guard.
    expect(COUNT_COMPARED_WITH_CONSTANT.test("WHERE unsupported_deferral_count >= 5")).toBe(true);
    expect(COUNT_COMPARED_WITH_CONSTANT.test("unsupported_deferral_count = $4")).toBe(false);
  });

  it("selects only eligible jobs in (COALESCE(deferred_until, created_at), id) order with the predicate in WHERE (F8.3, section 3)", () => {
    const lease = service(LEASE);
    const start = lease.indexOf("const SELECT_NEXT = `");
    expect(start).toBeGreaterThanOrEqual(0);
    const selectNext = lease.slice(start, lease.indexOf("`;", start) + 2);
    const where = selectNext.slice(selectNext.indexOf(" WHERE "), selectNext.indexOf(" ORDER BY "));
    expect(where).toMatch(/\n   AND COALESCE\(j\.deferred_until, j\.created_at\) <= now\(\)\n/);
    expect(where).toMatch(/j\.state = 'QUEUED'/);
    expect(where).toMatch(/j\.lease_fencing_counter < \$\{MAX_FENCING_COUNTER\}/);
    expect(selectNext).toMatch(/\n ORDER BY COALESCE\(j\.deferred_until, j\.created_at\), j\.id\n LIMIT 1\n   FOR UPDATE OF j SKIP LOCKED`;$/);
    expect(selectNext).not.toMatch(/ORDER BY j\.created_at/);
    // SELECT_NEXT stays a module-private constant (m4).
    expect(lease).not.toMatch(/export\s+(const|let|var)\s+SELECT_NEXT|export\s*\{[^}]*SELECT_NEXT/);
    // The lease UPDATE itself is unchanged and writes no deferral column.
    expect(lease).toMatch(/WHERE id = \$1 AND state = 'QUEUED'\s+RETURNING lease_fencing_counter, lease_expires_at/);
  });
});

// R44B6I1: the provider-credential contract lives in one shared, pure package
// that both commercial-api and commercial-worker import; neither app imports
// the other.
describe("shared commercial-worker protocol package", () => {
  const PROTOCOL_SRC = join(REPO_ROOT, "packages", "commercial-worker-protocol", "src");
  const protocolFiles = listFiles(PROTOCOL_SRC);
  const ESCAPE = FORBIDDEN.find(({ label: name }) => name === "repository escape")!.pattern;

  it("is the only path out of the app, and the escape rule still catches anything else", () => {
    expect(ESCAPE.test('"file:../../packages/commercial-worker-protocol"')).toBe(false);
    expect(ESCAPE.test('import "../../commercial-worker/src/workerControlClient.js";')).toBe(true);
    expect(ESCAPE.test('import "../../packages/other-package/index.js";')).toBe(true);
  });

  // R44B11A: the shared generation-request authority, the one protocol module
  // that may import node:crypto (for createHash) and name the locked
  // provider/model identities.
  const GENERATION_MODULE = "generationRequestContract.ts";
  const GENERATION_MODULE_LABEL_EXEMPTIONS: readonly string[] = ["Runway provider", "Google GenAI provider"];

  it("contains exactly the pure credential and generation-request contracts, importing only itself and node:crypto", () => {
    expect(protocolFiles.map((path) => relative(PROTOCOL_SRC, path).split(sep).join("/")).sort()).toEqual([
      "credentialContext.ts",
      "credentialCrypto.ts",
      "credentialCryptoError.ts",
      "credentialInput.ts",
      GENERATION_MODULE,
      "index.ts",
      // R44B6P: the provider execution ID rule shared by the submitted route and the worker journal.
      "providerExecutionId.ts",
      "sealedEnvelope.ts",
    ]);
    for (const path of protocolFiles) {
      const text = read(path);
      const isGenerationModule = relative(PROTOCOL_SRC, path) === GENERATION_MODULE;
      for (const specifier of importSpecifiers(text)) {
        if (specifier.startsWith("./")) {
          expect(resolve(dirname(path), specifier).startsWith(PROTOCOL_SRC + sep)).toBe(true);
        } else if (isGenerationModule && specifier === "node:crypto") {
          continue;
        } else {
          expect(specifier, path).toBe("node:never-imported");
        }
      }
      const violations = findViolations(text).filter((label) => !(isGenerationModule && GENERATION_MODULE_LABEL_EXEMPTIONS.includes(label)));
      expect(violations, path).toEqual([]);
      expect(/process\.env|node:fs|node:http|node:net|createServer|createDecipheriv|setAuthTag|pg\b|kms/i.test(text.replace(/^\s*\/\/.*$/gm, "")), path).toBe(false);
    }
    const manifest = JSON.parse(read(join(REPO_ROOT, "packages", "commercial-worker-protocol", "package.json"))) as Record<string, unknown>;
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.private).toBe(true);
  });

  it("is the single authority for the envelope and context formats", () => {
    const literal = /["']sealed-credential-v1["']|["']provider-credential-context-v1["']|function parseSealedEnvelope|function validateSealingContext/;
    expect(existsSync(join(SRC_ROOT, "providerCredentials"))).toBe(false);
    expect(sourceFiles.filter((path) => literal.test(read(path))).map(label)).toEqual([]);
    const workerSrc = join(REPO_ROOT, "apps", "commercial-worker", "src");
    expect(listFiles(workerSrc).filter((path) => literal.test(read(path))).map((path) => relative(REPO_ROOT, path))).toEqual([]);
    expect(protocolFiles.filter((path) => literal.test(read(path))).map((path) => relative(PROTOCOL_SRC, path).split(sep).join("/")).sort()).toEqual([
      "credentialContext.ts",
      "sealedEnvelope.ts",
    ]);
  });

  it("is imported by commercial-api source without any import of commercial-worker", () => {
    expect(sourceFiles.filter((path) => importSpecifiers(read(path)).includes("commercial-worker-protocol")).length).toBeGreaterThan(0);
    expect(sourceFiles.filter((path) => importSpecifiers(read(path)).some((specifier) => /commercial-worker(?!-protocol)/.test(specifier))).map(label)).toEqual([]);
  });
});
