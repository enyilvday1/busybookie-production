import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Architectural boundary of the private commercial worker
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md sections 2-8).
// Only worker production source is scanned; tests may compose commercial-api.

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_ROOT = join(APP_ROOT, "src");
const REPO_ROOT = resolve(APP_ROOT, "..", "..");
const API_ROOT = join(REPO_ROOT, "apps", "commercial-api");

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}
const read = (path: string) => readFileSync(path, "utf8");
const label = (path: string) => relative(APP_ROOT, path).split(sep).join("/");
const code = (text: string) => text.replace(/^\s*\/\/.*$/gm, "");
const sources = listFiles(SRC_ROOT).map((path) => ({ path: label(path), text: read(path) }));

const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["']([^"']+)["']/g;
const importsOf = (text: string) => [...text.matchAll(IMPORT)].map((match) => match[1] ?? "");
const BUILTINS = new Set(builtinModules);

// R44B6I1: the worker reaches the credential contract only through the shared,
// pure protocol package, imported in exactly one place. No commercial-api
// module (runtime or type) is imported by worker source.
const PROTOCOL_PACKAGE = "commercial-worker-protocol";
const PROTOCOL_ROOT = join(REPO_ROOT, "packages", "commercial-worker-protocol");

const FORBIDDEN: readonly Readonly<{ label: string; pattern: RegExp }>[] = [
  { label: "commercial-api module", pattern: /commercial-api/ },
  { label: "PostgreSQL client or database module", pattern: /["']pg["']|\/database\/|DATABASE_URL|runtimePool|migrations\//i },
  { label: "commercial-api worker or connection services", pattern: /workerLeaseService|workerCredentialGrantService|workerControlApplication|providerConnectionService|credentialObligations/ },
  { label: "engine execution or CLI", pattern: /src\/execution|src\/dialogue|src\/composition|executeSingleShot|scripts\//i },
  { label: "operator server", pattern: /operatorServer|operator-server|operatorConsole|4381/i },
  { label: "provider SDK or brand", pattern: /@runwayml|@google\/|runway|gemini|genai|\bveo\b/i },
  { label: "engine environment loader", pattern: /loadEnvironment|dotenv|loadEnvFile|BUSYBOOKIE_/ },
  { label: "process environment read", pattern: /process\.env/ },
  { label: "listener", pattern: /createServer|\.listen\s*\(/ },
  { label: "local persistence", pattern: /node:fs|writeFile|appendFile|createWriteStream|mkdir/ },
  { label: "decryption primitive", pattern: /createDecipheriv|setAuthTag|kms/i },
  { label: "test fixture", pattern: /tests\/|testCredentialCrypto|createTest/ },
  // R44B6P narrows the former single submission rule into three, each exempting only named files.
  { label: "SUBMITTING acknowledgement or recovery routes", pattern: /\/submitting\b|outcome-unknown|\/submission|acceptance-recovery|submission-failed/i },
  { label: "SUBMITTING vocabulary", pattern: /submitting/i },
  { label: "provider execution identity", pattern: /providerExecutionId/ },
  { label: "provider create or polling", pattern: /providerCreate|createGeneration|imageToVideo|generateVideos|interactions\.create|pollOperation/i },
];

// R44B6P: the acceptance journal is the only local persistence, and the only
// worker module (with the submitted client and the shared-rule re-export) that
// names a provider execution identity. Its record member submittingAt is the
// only SUBMITTING vocabulary allowed in worker source.
const JOURNAL = "src/acceptanceJournal.ts";
const EXEMPTIONS: Readonly<Record<string, readonly string[]>> = {
  [JOURNAL]: ["local persistence", "SUBMITTING vocabulary", "provider execution identity"],
  "src/workerControlClient.ts": ["provider execution identity"],
  "src/providerExecutionContract.ts": ["provider execution identity"],
  // R44B6S: startup recovery passes the record's own identity (checked below).
  "src/startupJournalReconciliation.ts": ["provider execution identity"],
};
// R44B6S: the exact acceptance-recovery vocabulary a file may name. Only these
// tokens are removed before the rules run, so /submitting, submission-failed,
// outcome-unknown or any other SUBMITTING text still fails in these files.
const ALLOWED_TOKENS: Readonly<Record<string, readonly string[]>> = {
  "src/workerControlClient.ts": ["/acceptance-recovery`", "ATTEMPT_STILL_SUBMITTING"],
  "src/acceptanceRecoveryPolicy.ts": ["ATTEMPT_STILL_SUBMITTING", "STILL_SUBMITTING"],
};
const withoutAllowedTokens = (path: string, text: string) =>
  (ALLOWED_TOKENS[path] ?? []).reduce((remaining, token) => remaining.split(token).join(""), text);
// The two worker files that import the shared protocol package.
const PROTOCOL_IMPORTERS = new Set(["src/credentialContracts.ts", "src/providerExecutionContract.ts"]);

describe("commercial-worker source boundary", () => {
  it("scans the worker source", () => {
    expect(sources.map(({ path }) => path).sort()).toEqual([
      "src/acceptanceJournal.ts",
      "src/acceptanceRecoveryPolicy.ts",
      "src/credentialContracts.ts",
      "src/credentialOpeningRun.ts",
      "src/providerEnvironment.ts",
      "src/providerExecutionContract.ts",
      "src/startupJournalReconciliation.ts",
      "src/workerControlClient.ts",
      "src/workerError.ts",
    ]);
  });

  it.each(sources.map(({ path, text }) => [path, text] as const))("%s imports only node built-ins, worker modules and the shared protocol package", (path, text) => {
    for (const specifier of importsOf(text)) {
      if (specifier.startsWith("node:") || BUILTINS.has(specifier)) continue;
      if (specifier.startsWith("./")) {
        expect(resolve(dirname(join(APP_ROOT, path)), specifier).startsWith(SRC_ROOT + sep)).toBe(true);
        continue;
      }
      expect({ path, specifier, shared: PROTOCOL_IMPORTERS.has(path) && specifier === PROTOCOL_PACKAGE }).toEqual({ path, specifier, shared: true });
    }
  });

  it("imports no path under apps/commercial-api from production source", () => {
    expect(sources.filter(({ text }) => importsOf(text).some((specifier) => /commercial-api|\.\.\//.test(specifier))).map(({ path }) => path)).toEqual([]);
  });

  it.each(sources.map(({ path, text }) => [path, text] as const))("%s contains no forbidden dependency", (path, text) => {
    // The forbidden-environment module must name the provider variables it
    // refuses; it is exempt from the brand pattern only (checked below).
    const exempt = new Set([...(EXEMPTIONS[path] ?? []), ...(path === "src/providerEnvironment.ts" ? ["provider SDK or brand"] : [])]);
    const rules = FORBIDDEN.filter(({ label: name }) => !exempt.has(name));
    const violations = rules.filter(({ pattern }) => pattern.test(withoutAllowedTokens(path, code(text)))).map(({ label: name }) => name);
    expect({ path, violations }).toEqual({ path, violations: [] });
  });

  it("names provider-global variables only in the forbidden-environment module", () => {
    const PROVIDER_VARIABLE = /RUNWAYML_[A-Z_]+|GEMINI_API_KEY|GOOGLE_[A-Z_]+|GCLOUD_[A-Z_]+/;
    expect(sources.filter(({ text }) => PROVIDER_VARIABLE.test(text)).map(({ path }) => path)).toEqual(["src/providerEnvironment.ts"]);
  });

  it("depends through the protocol package only on pure modules with no further dependency", () => {
    const visited = new Set<string>();
    const queue = [join(PROTOCOL_ROOT, "src", "index.ts")];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      for (const specifier of importsOf(read(file))) {
        if (specifier.startsWith("node:") || BUILTINS.has(specifier)) {
          expect(["node:crypto"].includes(specifier) || specifier === "node:buffer").toBe(true);
          continue;
        }
        expect(specifier.startsWith("./")).toBe(true);
        queue.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      }
    }
    expect([...visited].map((file) => relative(PROTOCOL_ROOT, file).split(sep).join("/")).sort()).toEqual([
      "src/credentialContext.ts",
      "src/credentialCrypto.ts",
      "src/credentialCryptoError.ts",
      "src/credentialInput.ts",
      "src/index.ts",
      "src/providerExecutionId.ts",
      "src/sealedEnvelope.ts",
    ]);
    for (const file of visited) {
      const body = code(read(file));
      const rules = FORBIDDEN.filter(
        ({ label: name }) => !["SUBMITTING acknowledgement or recovery routes", "SUBMITTING vocabulary", "provider execution identity"].includes(name),
      );
      expect({ file: relative(PROTOCOL_ROOT, file), violations: rules.filter(({ pattern }) => pattern.test(body)).map(({ label: name }) => name) }).toEqual({
        file: relative(PROTOCOL_ROOT, file),
        violations: [],
      });
    }
    const manifest = JSON.parse(read(join(PROTOCOL_ROOT, "package.json"))) as Record<string, unknown>;
    expect(manifest.dependencies).toBeUndefined();
  });

  it("keeps no copy of the envelope or context format in worker source", () => {
    const FORMAT = /["']sealed-credential-v1["']|["']provider-credential-context-v1["']|AES-256-GCM|function parseSealedEnvelope|function validateSealingContext/;
    expect(sources.filter(({ text }) => FORMAT.test(text)).map(({ path }) => path)).toEqual([]);
  });

  it("guards the guards", () => {
    const hit = (text: string) => FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(({ label: name }) => name);
    expect(hit('import pg from "pg";')).toContain("PostgreSQL client or database module");
    expect(hit('import { RunwayML } from "@runwayml/sdk";')).toContain("provider SDK or brand");
    expect(hit("const key = process.env.X;")).toContain("process environment read");
    expect(hit('await writeFile("journal.json", token);')).toContain("local persistence");
    expect(hit('fetch(`${base}/worker-control/v1/attempts/${id}/submitting`)')).toContain("SUBMITTING acknowledgement or recovery routes");
    expect(hit("`/worker-control/v1/attempts/${id}/acceptance-recovery`")).toContain("SUBMITTING acknowledgement or recovery routes");
    expect(hit("`/worker-control/v1/attempts/${id}/submitted`")).not.toContain("SUBMITTING acknowledgement or recovery routes");
    expect(hit("const providerExecutionId = acceptance.id;")).toContain("provider execution identity");
    expect(hit("await client.imageToVideo.create(request);")).toContain("provider create or polling");
    expect(hit('import "../../commercial-api/src/workerControl/workerLeaseService.js";')).toContain("commercial-api worker or connection services");
    expect(hit('import { parseSealedEnvelope } from "../../commercial-api/src/providerCredentials/sealedEnvelope.js";')).toContain("commercial-api module");
    // The allowed recovery tokens hide nothing else.
    const allowed = (path: string, text: string) => FORBIDDEN.filter(({ pattern }) => pattern.test(withoutAllowedTokens(path, text))).map(({ label: name }) => name);
    expect(allowed("src/workerControlClient.ts", "`/worker-control/v1/attempts/${id}/acceptance-recovery`")).toEqual([]);
    expect(allowed("src/workerControlClient.ts", "`/worker-control/v1/attempts/${id}/submitting`")).toContain("SUBMITTING acknowledgement or recovery routes");
    expect(allowed("src/workerControlClient.ts", "`/worker-control/v1/attempts/${id}/submission-failed`")).toContain("SUBMITTING acknowledgement or recovery routes");
    expect(allowed("src/workerControlClient.ts", 'state === "SUBMITTING"')).toContain("SUBMITTING vocabulary");
    expect(allowed("src/acceptanceRecoveryPolicy.ts", "acknowledgeSubmitting()")).toContain("SUBMITTING vocabulary");
    expect(allowed("src/acceptanceRecoveryPolicy.ts", "/acceptance-recovery")).toContain("SUBMITTING acknowledgement or recovery routes");
  });
});

// R44B6P: the acceptance journal persists only the closed acceptance record.
describe("acceptance journal boundary", () => {
  const journal = code(read(join(APP_ROOT, JOURNAL)));

  it("names no secret-bearing, payload or path field, and never renames, copies or writes the final record directly", () => {
    const SECRET = /leaseToken|lease_token|machineCredential|sealedEnvelope|sealed_credential|openingContext|fingerprint|apiKey|api_key|bearer|Authorization|password|plaintext|prompt|responseBody|outputUrl|outputPath/i;
    expect(SECRET.test(journal)).toBe(false);
    const FALLBACK = /\brename\s*\(|copyFile|\bcp\s*\(|writeFile\s*\(\s*target|appendFile/;
    expect(FALLBACK.test(journal)).toBe(false);
    // Guard the guards.
    expect(SECRET.test("leaseToken: lease.leaseToken")).toBe(true);
    expect(FALLBACK.test("await rename(temporary, target);")).toBe(true);
  });

  it("is used only for startup checks, and the submitted report is called by nothing in worker source", () => {
    const importers = sources.filter(({ path, text }) => path !== JOURNAL && /acceptanceJournal/.test(text)).map(({ path }) => path);
    expect(importers.sort()).toEqual(["src/credentialOpeningRun.ts", "src/startupJournalReconciliation.ts"]);
    const callers = sources.filter(({ text }) => /\.reportSubmitted\s*\(/.test(code(text))).map(({ path }) => path);
    expect(callers).toEqual([]);
    // R44B6S: startup reaches the control plane only through the injected
    // client's recoverAcceptance, never by direct HTTP, and never constructs,
    // re-hashes or rewrites a record.
    const startup = code(read(join(SRC_ROOT, "startupJournalReconciliation.ts")));
    expect(startup).not.toMatch(/\.write\s*\(|\.reportSubmitted\s*\(|\bfetch\s*\(|recordedAt\s*:|recordSha256\s*:|buildAcceptanceRecord|acceptanceRecordDigest|createHttpWorkerControlClient|leaseNextAttempt|leaseToken/);
    expect(startup).toMatch(/await journal\.publish\(record\)/);
    expect(startup).toMatch(/import type \{ WorkerControlClient \} from "\.\/workerControlClient\.js";/);
    // The provider execution ID is only ever the record's own, passed through unchanged.
    expect(startup.match(/providerExecutionId/g)).toHaveLength(2);
    expect(startup).toMatch(/const \{ executionAttemptId, fencingCounter, providerExecutionId \} = record;/);
    expect(startup).toMatch(/recovery\.client\.recoverAcceptance\(executionAttemptId, fencingCounter, providerExecutionId, signal\)/);
  });

  it("keeps the acceptance-recovery policy pure: injected time, no I/O, no lease", () => {
    const policy = code(read(join(SRC_ROOT, "acceptanceRecoveryPolicy.ts")));
    expect(importsOf(policy).sort()).toEqual(["./workerError.js", "node:timers/promises"]);
    expect(policy).not.toMatch(/\bfetch\s*\(|Date\.now|new Date|leaseToken|leaseNextAttempt|journal|providerExecutionId/);
    expect(policy).toMatch(/time\.monotonicNow\(\)/);
    expect(policy).toMatch(/time\.sleep\(/);
  });
});

describe("process and package boundary", () => {
  it("is not started by default and is not imported by commercial-api", () => {
    const WORKER_APP = /commercial-worker(?!-protocol)/;
    const apiSources = listFiles(join(API_ROOT, "src")).map(read);
    expect(apiSources.some((text) => WORKER_APP.test(text))).toBe(false);
    for (const manifest of [join(REPO_ROOT, "package.json"), join(API_ROOT, "package.json")]) {
      expect(read(manifest)).not.toMatch(WORKER_APP);
    }
    const scripts = (JSON.parse(read(join(APP_ROOT, "package.json"))) as { scripts: Record<string, string> }).scripts;
    expect(Object.keys(scripts).sort()).toEqual(["test", "test:integration", "typecheck"]);
    expect(Object.values(scripts).some((command) => /\bnode\b|start|dist\//.test(command))).toBe(false);
  });

  it("depends at runtime only on the local protocol package, and on the commercial-api toolchain for development", () => {
    const manifest = JSON.parse(read(join(APP_ROOT, "package.json"))) as Record<string, unknown>;
    expect(manifest.dependencies).toEqual({ [PROTOCOL_PACKAGE]: "file:../../packages/commercial-worker-protocol" });
    const api = JSON.parse(read(join(API_ROOT, "package.json"))) as { devDependencies: Record<string, string> };
    expect(manifest.devDependencies).toEqual({ "@types/node": api.devDependencies["@types/node"], typescript: api.devDependencies.typescript, vitest: api.devDependencies.vitest });
  });

  it("has exactly one shared package, and it and the worker are outside the engine build and test set", () => {
    expect(readdirSync(join(REPO_ROOT, "packages"))).toEqual(["commercial-worker-protocol"]);
    const rootTsconfig = JSON.parse(read(join(REPO_ROOT, "tsconfig.json"))) as { include: string[] };
    expect(rootTsconfig.include.some((pattern) => pattern.startsWith("apps") || pattern.startsWith("packages") || pattern.startsWith("**"))).toBe(false);
    expect(read(join(REPO_ROOT, "vitest.config.ts"))).not.toMatch(/apps\/|packages\//);
    expect(read(join(REPO_ROOT, "package.json"))).not.toMatch(/commercial-worker-protocol/);
  });
});
