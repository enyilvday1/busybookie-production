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
  // R44B8: the state-root binding inspects (lstat) the configured root and
  // its managed directories; it writes nothing itself (checked below).
  "src/workerStateRoot.ts": ["local persistence"],
  // R44B6Y: the acceptance handler validates and records the provider
  // execution ID; the adapter passes the record's own ID through unchanged.
  "src/acceptanceHandler.ts": ["provider execution identity"],
  "src/acceptanceAdapter.ts": ["provider execution identity"],
  // R44B9: the production fake mints its attempt-bound execution ID and hands
  // it to the acceptance callback (checked below).
  "src/fakeProvider.ts": ["provider execution identity"],
};
// R44B6S: the exact acceptance-recovery vocabulary a file may name. Only these
// tokens are removed before the rules run, so /submitting, submission-failed,
// outcome-unknown or any other SUBMITTING text still fails in these files.
// R44B6U adds the client's own SUBMITTING acknowledgement vocabulary: the exact
// route path, the single named state constant and its identifiers. A bare
// "SUBMITTING" literal or any other route still fails.
const ALLOWED_TOKENS: Readonly<Record<string, readonly string[]>> = {
  "src/workerControlClient.ts": [
    "/acceptance-recovery`",
    "ATTEMPT_STILL_SUBMITTING",
    "/submitting`",
    'const SUBMITTING_STATE = "SUBMITTING" as const;',
    "SUBMITTING_STATE",
    "SUBMITTING_REJECTED",
    "WorkerSubmittingAcknowledgement",
    "parseSubmittingResponse",
    "acknowledgeSubmitting",
    "submittingAt",
    // R44B6Y: the exact submission-failed route path of its client.
    "/submission-failed`",
  ],
  "src/acceptanceRecoveryPolicy.ts": ["ATTEMPT_STILL_SUBMITTING", "STILL_SUBMITTING"],
  "src/workerError.ts": ["SUBMITTING_REJECTED", '"The worker-control API rejected the SUBMITTING acknowledgement."'],
  // R44B6V: the orchestration names only the client method it calls.
  "src/preProviderOrchestration.ts": ["acknowledgeSubmitting", "submittingAt"],
  // R44B6Y: the record member copied from the permit.
  "src/acceptanceHandler.ts": ["submittingAt"],
  // R44B9A: the one dedicated fake provider identifier, declared once. Any
  // other BUSYBOOKIE_ text (an environment key, a mode switch) still fails.
  "src/fakeProvider.ts": ['export const FAKE_PROVIDER_ID = "BUSYBOOKIE_FAKE";'],
};
const withoutAllowedTokens = (path: string, text: string) =>
  (ALLOWED_TOKENS[path] ?? []).reduce((remaining, token) => remaining.split(token).join(""), text);
// The two worker files that import the shared protocol package.
const PROTOCOL_IMPORTERS = new Set(["src/credentialContracts.ts", "src/providerExecutionContract.ts"]);

describe("commercial-worker source boundary", () => {
  it("scans the worker source", () => {
    expect(sources.map(({ path }) => path).sort()).toEqual([
      "src/acceptanceAdapter.ts",
      "src/acceptanceHandler.ts",
      "src/acceptanceJournal.ts",
      "src/acceptanceRecoveryPolicy.ts",
      "src/attemptExecution.ts",
      "src/credentialContracts.ts",
      "src/credentialOpeningRun.ts",
      "src/failureReportPolicy.ts",
      "src/fakeProvider.ts",
      "src/hostFaultLatch.ts",
      "src/inFlightHeartbeat.ts",
      "src/inputMediaRetrieval.ts",
      "src/objectStorageContract.ts",
      "src/preProviderOrchestration.ts",
      "src/providerEnvironment.ts",
      "src/providerExecutionContract.ts",
      "src/startupJournalReconciliation.ts",
      "src/workerConfig.ts",
      "src/workerControlClient.ts",
      "src/workerError.ts",
      "src/workerStateRoot.ts",
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
    expect(allowed("src/workerControlClient.ts", "`/worker-control/v1/attempts/${id}/submitting`")).toEqual([]);
    expect(allowed("src/workerControlClient.ts", "`/worker-control/v1/attempts/${id}/submitting/replay`")).toContain("SUBMITTING acknowledgement or recovery routes");
    // R44B6Y: only the client's own exact submission-failed route is allowed.
    expect(allowed("src/workerControlClient.ts", "`/worker-control/v1/attempts/${id}/submission-failed`")).toEqual([]);
    expect(allowed("src/workerControlClient.ts", "`/worker-control/v1/attempts/${id}/submission-failed/replay`")).toContain(
      "SUBMITTING acknowledgement or recovery routes",
    );
    expect(allowed("src/acceptanceAdapter.ts", "`/worker-control/v1/attempts/${id}/submission-failed`")).toContain("SUBMITTING acknowledgement or recovery routes");
    expect(allowed("src/acceptanceHandler.ts", "acknowledgeSubmitting()")).toContain("SUBMITTING vocabulary");
    expect(allowed("src/workerControlClient.ts", 'state === "SUBMITTING"')).toContain("SUBMITTING vocabulary");
    expect(allowed("src/workerControlClient.ts", "submittingDeadlineMs")).toContain("SUBMITTING vocabulary");
    expect(allowed("src/workerError.ts", '"SUBMITTING"')).toContain("SUBMITTING vocabulary");
    expect(allowed("src/acceptanceRecoveryPolicy.ts", "acknowledgeSubmitting()")).toContain("SUBMITTING vocabulary");
    expect(allowed("src/acceptanceRecoveryPolicy.ts", "/acceptance-recovery")).toContain("SUBMITTING acknowledgement or recovery routes");
    // R44B9: only the fake's own declaration is allowed; no environment key or mode.
    expect(allowed("src/fakeProvider.ts", 'export const FAKE_PROVIDER_ID = "BUSYBOOKIE_FAKE";')).toEqual([]);
    expect(allowed("src/fakeProvider.ts", "BUSYBOOKIE_FAKE_BEHAVIOR")).toContain("engine environment loader");
    expect(allowed("src/fakeProvider.ts", 'const id = "BUSYBOOKIE_FAKE";')).toContain("engine environment loader");
    expect(allowed("src/attemptExecution.ts", 'export const FAKE_PROVIDER_ID = "BUSYBOOKIE_FAKE";')).toContain("engine environment loader");
  });
});

// R44B6U0: the SUBMITTING acknowledgement client is a single-shot, client-only
// transport primitive. Nothing in worker source calls it (a call followed by
// no provider request would manufacture OUTCOME_UNKNOWN evidence).
// One client method's source, up to the next method of the returned client.
const clientSource = code(read(join(SRC_ROOT, "workerControlClient.ts")));
const methodSource = (name: string) => {
  const start = clientSource.indexOf(`${name}: async`);
  if (start < 0) return "";
  const next = clientSource.slice(start + name.length).search(/\n {4}[A-Za-z]+: async/);
  return next < 0 ? clientSource.slice(start) : clientSource.slice(start, start + name.length + next);
};
// Shared single-shot transport-primitive guard (R44B6U0, R44B6W0).
const FORBIDDEN_IN_PRIMITIVE =
  /retry|attempt\s*\+\+|\bfor\s*\(|\bwhile\s*\(|setTimeout|setInterval|sleep|AbortController|AbortSignal\.timeout|Date\.now|new Date|performance\.now|leaseExpiresAt|LEASE_EXPIRED|submission-failed|reportSubmitted\(|console\.|log\(/i;

describe("SUBMITTING acknowledgement client boundary", () => {
  const client = clientSource;
  const method = methodSource("acknowledgeSubmitting");

  it("is called only by the pre-provider orchestration and stays outside the credential-opening client", () => {
    // R44B6V: the orchestration is the only caller; R44B9: only the
    // fake-provider composer calls the orchestration (below).
    const callers = sources.filter(({ text }) => /\.acknowledgeSubmitting\s*\(/.test(code(text))).map(({ path }) => path);
    expect(callers).toEqual(["src/preProviderOrchestration.ts"]);
    expect(sources.filter(({ path, text }) => path !== "src/workerControlClient.ts" && /acknowledgeSubmitting/.test(code(text))).map(({ path }) => path)).toEqual([
      "src/preProviderOrchestration.ts",
    ]);
  });

  it("sends one request with no retry, timer, lease clock, lifecycle repair or secret logging", () => {
    expect(method.length).toBeGreaterThan(0);
    expect(method).toMatch(/await post\(\s*`\/worker-control\/v1\/attempts\/\$\{executionAttemptId\}\/submitting`/);
    expect(method.match(/\bpost\(/g)).toHaveLength(1);
    const FORBIDDEN_IN_METHOD = FORBIDDEN_IN_PRIMITIVE;
    expect(FORBIDDEN_IN_METHOD.test(method)).toBe(false);
    // Nothing in the client file creates its own timer or deadline.
    expect(/setTimeout|setInterval|AbortSignal\.timeout|new AbortController/.test(client)).toBe(false);
    // Guard the guards.
    expect(FORBIDDEN_IN_METHOD.test("for (let attempt = 1; ; attempt += 1) {")).toBe(true);
    expect(FORBIDDEN_IN_METHOD.test("if (lease.leaseExpiresAt.getTime() <= Date.now()) throw")).toBe(true);
    expect(FORBIDDEN_IN_METHOD.test("const timer = setTimeout(() => controller.abort(), 30000);")).toBe(true);
  });
});

// R44B6W0: the heartbeat client is a neutral, single-shot, client-only lease
// renewal primitive. Nothing calls it yet; it knows nothing of providers,
// permits, cadence or lifecycle repair.
describe("heartbeat client boundary", () => {
  const method = methodSource("heartbeat");

  it("is called only by the pre-provider orchestration and the in-flight keeper", () => {
    // R44B6V: the orchestration calls it. R44B6Z: the in-flight keeper calls it.
    // R44B9: the composer reaches both only through their own entry points.
    expect(sources.filter(({ text }) => /\.heartbeat\s*\(/.test(code(text))).map(({ path }) => path)).toEqual([
      "src/inFlightHeartbeat.ts",
      "src/preProviderOrchestration.ts",
    ]);
    expect(code(read(join(SRC_ROOT, "credentialOpeningRun.ts")))).not.toMatch(/heartbeat/i);
    expect(sources.filter(({ path, text }) => path !== "src/workerControlClient.ts" && /\bheartbeat\b|HEARTBEAT_REJECTED/.test(code(text))).map(({ path }) => path)).toEqual(
      ["src/inFlightHeartbeat.ts", "src/preProviderOrchestration.ts", "src/workerError.ts"],
    );
  });

  it("sends one request with no retry, timer, cadence, lease clock, lifecycle or provider coupling", () => {
    expect(method.length).toBeGreaterThan(0);
    expect(method).toMatch(/await post\(\s*`\/worker-control\/v1\/attempts\/\$\{executionAttemptId\}\/heartbeat`/);
    expect(method.match(/\bpost\(/g)).toHaveLength(1);
    expect(method).toMatch(/"HEARTBEAT_REJECTED"/);
    expect(FORBIDDEN_IN_PRIMITIVE.test(method)).toBe(false);
    expect(/retryUnavailable|interval|cadence|permit|provider|acknowledgeSubmitting|recoverAcceptance|OUTCOME_UNKNOWN|submitting`|\/submitted`/i.test(method)).toBe(
      false,
    );
    // The parser returns the server expiry as data: no clock, no threshold.
    const parser = clientSource.slice(clientSource.indexOf("export function parseHeartbeatResponse"), clientSource.indexOf("const RECOVERY_STATES"));
    expect(parser.length).toBeGreaterThan(0);
    expect(/Date\.now|performance\.now|getTime\(\)|new Date\(\)|LEASE_EXPIRED|executionAttemptId|state/.test(parser)).toBe(false);
  });
});

// R44B6V0/R44B6V: the pre-provider orchestration stops at the permit. Nothing
// calls it yet, and it holds no provider abstraction, lifecycle repair,
// in-flight cadence or local lease-time authority.
describe("pre-provider orchestration boundary", () => {
  const ORCHESTRATION = "src/preProviderOrchestration.ts";
  const orchestration = code(read(join(SRC_ROOT, "preProviderOrchestration.ts")));

  it("is called only by the fake-provider composer, never by credential opening", () => {
    // R44B9: the composer is the only caller.
    expect(sources.filter(({ path, text }) => path !== ORCHESTRATION && /obtainPreProviderPermit\(/.test(code(text))).map(({ path }) => path)).toEqual([
      "src/attemptExecution.ts",
    ]);
    expect(sources.filter(({ path, text }) => path !== ORCHESTRATION && /obtainPreProviderPermit|PreProviderPermit/.test(code(text))).map(({ path }) => path)).toEqual([
      "src/attemptExecution.ts",
    ]);
    // R44B6Y: the acceptance adapter reuses only the injectable deadline-timer seam.
    // R44B6Z: so does the in-flight keeper. R44B9: the shared failure-report
    // policy takes only the timer type. R44B10P1: input-media retrieval reuses
    // the same deadline-timer seam.
    expect(sources.filter(({ path, text }) => path !== ORCHESTRATION && /preProviderOrchestration/.test(code(text))).map(({ path }) => path)).toEqual([
      "src/acceptanceAdapter.ts",
      "src/attemptExecution.ts",
      "src/failureReportPolicy.ts",
      "src/inFlightHeartbeat.ts",
      "src/inputMediaRetrieval.ts",
    ]);
    for (const path of ["acceptanceAdapter.ts", "inFlightHeartbeat.ts", "inputMediaRetrieval.ts"]) {
      expect(code(read(join(SRC_ROOT, path)))).toMatch(/import \{ realDeadlineTimer, type DeadlineTimer \} from "\.\/preProviderOrchestration\.js";/);
    }
    expect(code(read(join(SRC_ROOT, "failureReportPolicy.ts")))).toMatch(/import type \{ DeadlineTimer \} from "\.\/preProviderOrchestration\.js";/);
    expect(code(read(join(SRC_ROOT, "credentialOpeningRun.ts")))).not.toMatch(/PreProvider|permit/i);
  });

  it("locks exactly two attempts and a 10000 ms request deadline owned by the orchestration", () => {
    expect(orchestration).toMatch(/export const PRE_PROVIDER_MAX_ATTEMPTS = 2;/);
    expect(orchestration).toMatch(/export const PRE_PROVIDER_REQUEST_DEADLINE_MS = 10000;/);
    // One controller per request, created only by the deadline helper.
    expect(orchestration.match(/new AbortController\(\)/g)).toHaveLength(1);
    // Exactly two guarded call sites, and only CONTROL_API_UNAVAILABLE earns a retry.
    expect(orchestration.match(/atMostTwoAttempts\(timer,/g)).toHaveLength(2);
    expect(orchestration.match(/\.acknowledgeSubmitting\(/g)).toHaveLength(1);
    expect(orchestration.match(/\.heartbeat\(/g)).toHaveLength(1);
    expect(orchestration).toMatch(/error\.code !== "CONTROL_API_UNAVAILABLE"/);
    expect(/\bfor\s*\(|\bwhile\s*\(|setInterval|sleep|backoff|jitter|retryUnavailable/i.test(orchestration)).toBe(false);
  });

  it("makes no provider, lifecycle-repair, in-flight or local-lease decision", () => {
    expect(
      /submission-failed|reportSubmitted|recoverAcceptance|leaseNextAttempt|requestCredentialGrant|OUTCOME_UNKNOWN|providerCreate|ProviderPort|createGeneration|imageToVideo|generateVideos|interactions\.create|fake|opener|\.open\(/i.test(orchestration),
    ).toBe(false);
    expect(/Date\.now|new Date|performance\.now|getTime\(\)|leaseExpiresAt|LEASE_EXPIRED|interval|cadence/i.test(orchestration)).toBe(false);
    // The permit carries no secret.
    const permitType = orchestration.slice(orchestration.indexOf("export type PreProviderPermit"), orchestration.indexOf("export type PreProviderOrchestrationDependencies"));
    expect(permitType.length).toBeGreaterThan(0);
    expect(/leaseToken|credential|machine|token|leaseExpiresAt|callback|providerExecution|ProviderPort|=>/i.test(permitType)).toBe(false);
    // R44B6Y0: the permit carries the acknowledged submittingAt, copied unchanged.
    expect(permitType).toMatch(/submittingAt: Date;/);
    expect(orchestration).toMatch(/submittingAt: acknowledgement\.submittingAt,/);
    // Only the type member and the copy: no second source of the value.
    expect(orchestration.match(/submittingAt/g)).toHaveLength(3);
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

  it("is used only for startup checks and the unused acceptance components, and only the adapter reports submitted", () => {
    const importers = sources.filter(({ path, text }) => path !== JOURNAL && /acceptanceJournal/.test(text)).map(({ path }) => path);
    // R44B6V: the orchestration needs only the journal's prepare() type.
    expect(importers.sort()).toEqual([
      "src/acceptanceAdapter.ts",
      "src/acceptanceHandler.ts",
      "src/credentialOpeningRun.ts",
      "src/preProviderOrchestration.ts",
      "src/startupJournalReconciliation.ts",
      // R44B8: the state-root binding constructs the journal at the configured root.
      "src/workerStateRoot.ts",
    ]);
    expect(read(join(SRC_ROOT, "preProviderOrchestration.ts"))).toMatch(/import type \{ AcceptanceJournal \} from "\.\/acceptanceJournal\.js";/);
    // R44B6Y: the outer acceptance adapter, itself unused, is the only caller.
    const callers = sources.filter(({ text }) => /\.reportSubmitted\s*\(/.test(code(text))).map(({ path }) => path);
    expect(callers).toEqual(["src/acceptanceAdapter.ts"]);
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

// R44B6Y0/R44B6Y: the inner durable acceptance handler, the outer acceptance
// adapter and the host-fault latch. Only the fake-provider composer (R44B9)
// uses them; they hold no provider abstraction, polling, journal preparation
// or local lease clock.
describe("acceptance handler, adapter and host-fault latch boundary", () => {
  const HANDLER = "src/acceptanceHandler.ts";
  const ADAPTER = "src/acceptanceAdapter.ts";
  const LATCH = "src/hostFaultLatch.ts";
  const handler = code(read(join(SRC_ROOT, "acceptanceHandler.ts")));
  const adapter = code(read(join(SRC_ROOT, "acceptanceAdapter.ts")));
  const latch = code(read(join(SRC_ROOT, "hostFaultLatch.ts")));
  const users = (pattern: RegExp, except: readonly string[]) =>
    sources.filter(({ path, text }) => !except.includes(path) && pattern.test(code(text))).map(({ path }) => path).sort();

  it("is composed only by the fake-provider composer: only the adapter builds the handler, only the composer builds the adapter", () => {
    expect(users(/acceptanceAdapter|createAcceptanceAdapter|AcceptanceAdapter\b/, [ADAPTER])).toEqual(["src/attemptExecution.ts"]);
    expect(users(/createDurableAcceptanceHandler|AcceptanceNotDurableError/, [HANDLER])).toEqual([ADAPTER]);
    // R44B9: the composer and the provider contract import only the acceptance type.
    expect(users(/acceptanceHandler/, [HANDLER])).toEqual([ADAPTER, "src/attemptExecution.ts", "src/providerExecutionContract.ts"]);
    for (const path of ["attemptExecution.ts", "providerExecutionContract.ts"]) {
      expect(code(read(join(SRC_ROOT, path)))).toMatch(/import type \{ WorkerProviderAcceptance \} from "\.\/acceptanceHandler\.js";/);
    }
    // R44B6Z: the in-flight keeper also takes the injected latch; R44B9: the
    // composer holds it.
    // R44B10P1: the unwired input-media retrieval takes the injected latch.
    expect(users(/hostFaultLatch|HostFaultLatch/, [LATCH])).toEqual([ADAPTER, HANDLER, "src/attemptExecution.ts", "src/inFlightHeartbeat.ts", "src/inputMediaRetrieval.ts"]);
    for (const path of ["credentialOpeningRun.ts", "startupJournalReconciliation.ts", "preProviderOrchestration.ts"]) {
      expect(code(read(join(SRC_ROOT, path)))).not.toMatch(/acceptanceAdapter|acceptanceHandler|hostFaultLatch|AcceptanceAdapter|DurableAcceptance/);
    }
  });

  it("imports no engine, provider or provider-handler type and builds no provider abstraction or poller", () => {
    for (const text of [handler, adapter, latch]) {
      expect(importsOf(text).every((specifier) => specifier.startsWith("./"))).toBe(true);
      expect(
        /src\/execution|SingleShotSubmissionAcceptedHandler|GoogleGenAiSubmissionAcceptedHandler|recoveryMetadata|providerEstimatedCredits|ProviderPort|providerFactory|providerSelector|sdk|\bpoll|fake/i.test(text),
      ).toBe(false);
    }
    expect(importsOf(latch)).toEqual([]);
  });

  it("never prepares the journal", () => {
    expect(/\.prepare\s*\(/.test(handler) || /\.prepare\s*\(/.test(adapter)).toBe(false);
  });

  it("keeps the inner handler free of every control-plane request, retry and deletion", () => {
    expect(/reportSubmitted|reportSubmissionFailed|recoverAcceptance|runAcceptanceRecoveryWithRetry|removeAcknowledgedRecord|\.write\s*\(|fetch\s*\(|\bfor\s*\(|\bwhile\s*\(/.test(handler)).toBe(false);
    expect(handler.match(/buildAcceptanceRecord\(/g)).toHaveLength(1);
    expect(handler.match(/\.publish\(/g)).toHaveLength(1);
    expect(handler).toMatch(/await journal\.publish\(record\);/);
    // Single use is claimed synchronously, before the first await.
    const claim = handler.indexOf("claimed = true;");
    expect(claim).toBeGreaterThan(0);
    expect(handler.slice(handler.indexOf("return async (acceptance) => {"), claim)).not.toMatch(/await/);
    // No normalisation of the provider execution ID.
    expect(/\.trim\(|toLowerCase|toUpperCase|normali[sz]e\(|replace\(/.test(handler)).toBe(false);
  });

  it("makes the failure report impossible once the record is durable", () => {
    // The shared failure-report policy (R44B9) appears only in reportNotDurable,
    // which runs only in the catch around the inner handler, before reconcile.
    expect(adapter.match(/\.reportSubmissionFailed\(/g)).toBeNull();
    expect(adapter.match(/reportSubmissionFailureWithPolicy\(/g)).toHaveLength(1);
    const notDurable = adapter.slice(adapter.indexOf("async function reportNotDurable"), adapter.indexOf("async function reconcile"));
    expect(notDurable).toMatch(/await reportSubmissionFailureWithPolicy\(\{ client, deadlineTimer: timer \}, executionAttemptId, fixedProof, report\);/);
    expect(adapter.match(/reportNotDurable\(/g)).toHaveLength(2);
    const reconcile = adapter.slice(adapter.indexOf("async function reconcile"), adapter.indexOf("return async (acceptance) => {"));
    expect(reconcile.length).toBeGreaterThan(0);
    expect(/reportSubmissionFailed|reportSubmissionFailureWithPolicy|reportNotDurable/.test(reconcile)).toBe(false);
    const callback = adapter.slice(adapter.indexOf("return async (acceptance) => {"));
    expect(callback.indexOf("await reportNotDurable(")).toBeLessThan(callback.indexOf("await reconcile(record);"));
    expect(callback.match(/reconcile\(/g)).toHaveLength(1);
  });

  it("locks two attempts, 10000 ms deadlines and retry only on CONTROL_API_UNAVAILABLE for both loops", () => {
    expect(adapter).toMatch(/export const LIVE_SUBMITTED_MAX_ATTEMPTS = 2;/);
    expect(adapter).toMatch(/export const LIVE_SUBMITTED_REQUEST_DEADLINE_MS = 10000;/);
    // R44B9: the failure-report constants and the attempt helper moved,
    // unchanged, to the shared policy; the adapter re-exports the names.
    const policy = code(read(join(SRC_ROOT, "failureReportPolicy.ts")));
    expect(policy).toMatch(/export const SUBMISSION_FAILURE_REPORT_MAX_ATTEMPTS = 2;/);
    expect(policy).toMatch(/export const SUBMISSION_FAILURE_REPORT_REQUEST_DEADLINE_MS = 10000;/);
    expect(adapter).toMatch(/SUBMISSION_FAILURE_REPORT_MAX_ATTEMPTS as ACCEPTANCE_FAILURE_REPORT_MAX_ATTEMPTS,/);
    expect(adapter).toMatch(/SUBMISSION_FAILURE_REPORT_REQUEST_DEADLINE_MS as ACCEPTANCE_FAILURE_REPORT_REQUEST_DEADLINE_MS,/);
    expect(adapter).toMatch(/import \{ atMostTwoAttempts, reportSubmissionFailureWithPolicy \} from "\.\/failureReportPolicy\.js";/);
    expect(adapter.match(/atMostTwoAttempts\(timer, LIVE_SUBMITTED_REQUEST_DEADLINE_MS,/g)).toHaveLength(1);
    expect(adapter.match(/atMostTwoAttempts\(/g)).toHaveLength(1);
    expect(policy.match(/atMostTwoAttempts\(dependencies\.deadlineTimer, SUBMISSION_FAILURE_REPORT_REQUEST_DEADLINE_MS,/g)).toHaveLength(1);
    expect(adapter.match(/new AbortController\(\)/g)).toBeNull();
    expect(policy.match(/new AbortController\(\)/g)).toHaveLength(1);
    expect(policy).toMatch(/error\.code !== "CONTROL_API_UNAVAILABLE"/);
    for (const text of [adapter, policy]) {
      expect(/\bfor\s*\(|\bwhile\s*\(|setInterval|setTimeout|backoff|jitter/i.test(text)).toBe(false);
    }
    // The policy is a reporting policy only: no provider, journal, latch or lease clock.
    expect(importsOf(policy).sort()).toEqual(["./preProviderOrchestration.js", "./workerControlClient.js", "./workerError.js"]);
    expect(/provider|journal|latch|reportSubmitted\(|recoverAcceptance|heartbeat|Date\.now|new Date|leaseExpiresAt|console\.|log\(/i.test(policy.split("./preProviderOrchestration.js").join(""))).toBe(false);
    expect(policy.match(/\.reportSubmissionFailed\(/g)).toHaveLength(1);
  });

  it("uses no local lease clock and reuses the shared acceptance-recovery step without copying it", () => {
    expect(/Date\.now|new Date|performance\.now|getTime\(\)|leaseExpiresAt|LEASE_EXPIRED|\.heartbeat\(/.test(adapter)).toBe(false);
    expect(adapter).toMatch(/import \{ recoverAcceptanceRecord \} from "\.\/startupJournalReconciliation\.js";/);
    expect(adapter.match(/recoverAcceptanceRecord\(/g)).toHaveLength(1);
    expect(/runAcceptanceRecoveryWithRetry|ACCEPTANCE_RECOVERY_RETRY|\.recoverAcceptance\(/.test(adapter)).toBe(false);
    // Only a refusal or exhausted unavailability hands over to recovery.
    expect(adapter).toMatch(/error\.code === "SUBMITTED_REPORT_REJECTED" \|\| error\.code === "CONTROL_API_UNAVAILABLE"/);
  });

  it("never deletes the record on a SUBMITTED acknowledgement", () => {
    expect(/removeAcknowledgedRecord\s*\(/.test(adapter)).toBe(false);
    const startup = code(read(join(SRC_ROOT, "startupJournalReconciliation.ts")));
    const shared = startup.slice(startup.indexOf("export async function recoverAcceptanceRecord"));
    expect(shared.indexOf('if (acknowledgement.state === "SUBMITTED") return;')).toBeGreaterThan(0);
    expect(shared.indexOf('if (acknowledgement.state === "SUBMITTED") return;')).toBeLessThan(shared.indexOf("removeAcknowledgedRecord("));
  });

  it("gives the latch no way back to clear and no stored reason", () => {
    expect(/reset|clear|untrip|restore|tripped\s*=\s*false\s*;[\s\S]*tripped\s*=\s*false/i.test(latch)).toBe(false);
    expect(latch.match(/tripped = false;/g)).toHaveLength(1);
    expect(latch.match(/tripped = true;/g)).toHaveLength(1);
    expect(/reason|message|string|token|credential/i.test(latch)).toBe(false);
  });

  it("names no secret in the handler or adapter beyond passing the fixed proof", () => {
    expect(/leaseToken|machineCredential|apiKey|plaintext|console\.|log\(/i.test(handler)).toBe(false);
    expect(/machineCredential|apiKey|plaintext|console\.|log\(/i.test(adapter)).toBe(false);
    expect(adapter.match(/leaseToken/g)).toHaveLength(2);
    expect(adapter).toMatch(/Object\.freeze\(\{ fencingCounter: proof\.fencingCounter, leaseToken: proof\.leaseToken \}\)/);
  });
});

// R44B6Y: the submission-failed client and the submitted client's optional
// signal stay single-shot transport primitives.
describe("submission-failed and submitted client boundary", () => {
  it("sends one request each, with no retry, timer, lease clock or secret logging", () => {
    const failed = methodSource("reportSubmissionFailed");
    const submitted = methodSource("reportSubmitted");
    expect(failed.length).toBeGreaterThan(0);
    expect(submitted.length).toBeGreaterThan(0);
    expect(failed).toMatch(/await post\(\s*`\/worker-control\/v1\/attempts\/\$\{executionAttemptId\}\/submission-failed`/);
    expect(failed).toMatch(/"SUBMISSION_FAILED_REJECTED"/);
    for (const method of [failed, submitted]) {
      expect(method.match(/\bpost\(/g)).toHaveLength(1);
      expect(FORBIDDEN_IN_PRIMITIVE.test(method.split("/submission-failed`").join(""))).toBe(false);
    }
    // R44B9: only the shared failure-report policy calls the failure report;
    // the adapter and the composer reach it only through that policy.
    expect(sources.filter(({ text }) => /\.reportSubmissionFailed\s*\(/.test(code(text))).map(({ path }) => path)).toEqual(["src/failureReportPolicy.ts"]);
    expect(sources.filter(({ text }) => /reportSubmissionFailureWithPolicy\(/.test(code(text))).map(({ path }) => path)).toEqual([
      "src/acceptanceAdapter.ts",
      "src/attemptExecution.ts",
      "src/failureReportPolicy.ts",
    ]);
  });
});

// R44B6Z0/R44B6Z: the generic in-flight lease keeper. Only the fake-provider
// composer (R44B9) calls it. It owns the operation promise and its own
// heartbeat signals, knows no provider, acceptance record or journal, and
// makes no local lease-expiry decision.
describe("in-flight heartbeat keeper boundary", () => {
  const KEEPER = "src/inFlightHeartbeat.ts";
  const keeper = code(read(join(SRC_ROOT, "inFlightHeartbeat.ts")));

  it("is called only by the fake-provider composer", () => {
    expect(sources.filter(({ path, text }) => path !== KEEPER && /inFlightHeartbeat|runWithInFlightHeartbeat|InFlightHeartbeat/.test(code(text))).map(({ path }) => path)).toEqual([
      "src/attemptExecution.ts",
    ]);
  });

  it("imports only the timing seams, client types, latch type and worker errors", () => {
    expect(importsOf(keeper).sort()).toEqual([
      "./acceptanceRecoveryPolicy.js",
      "./hostFaultLatch.js",
      "./preProviderOrchestration.js",
      "./workerControlClient.js",
      "./workerError.js",
    ]);
    expect(keeper).toMatch(/import \{ defaultRecoverySleep, type RecoverySleep \} from "\.\/acceptanceRecoveryPolicy\.js";/);
    expect(keeper).toMatch(/import type \{ LeaseProof, WorkerControlClient \} from "\.\/workerControlClient\.js";/);
  });

  it("knows no provider, acceptance, journal, recovery or failure report", () => {
    expect(
      /src\/execution|runway|veo\b|google|genai|gemini|sdk|ProviderPort|providerFactory|providerSelector|providerExecutionId|\bpoll|credential|apiKey|acceptanceJournal|AcceptanceRecord|createAcceptanceAdapter|createDurableAcceptanceHandler|recoverAcceptance|runAcceptanceRecoveryWithRetry|reportSubmissionFailed|submission-failed|reportSubmitted|\.prepare\(|fake/i.test(keeper),
    ).toBe(false);
  });

  it("locks the constants and the attempt policy, with no backoff, jitter or interval timer", () => {
    expect(keeper).toMatch(/export const IN_FLIGHT_HEARTBEAT_FIRST_TICK_DELAY_MS = 30000;/);
    expect(keeper).toMatch(/export const IN_FLIGHT_HEARTBEAT_QUIET_INTERVAL_MS = 30000;/);
    expect(keeper).toMatch(/export const IN_FLIGHT_HEARTBEAT_REQUEST_DEADLINE_MS = 10000;/);
    expect(keeper).toMatch(/export const IN_FLIGHT_HEARTBEAT_MAX_ATTEMPTS_PER_TICK = 2;/);
    expect(keeper.match(/\.heartbeat\(/g)).toHaveLength(1);
    expect(keeper).toMatch(/code === "CONTROL_API_UNAVAILABLE"/);
    expect(keeper).toMatch(/code === "HEARTBEAT_REJECTED"\) return "STOP";/);
    expect(/setInterval|setTimeout|backoff|jitter|Math\.random/i.test(keeper)).toBe(false);
  });

  it("makes no local lease-expiry decision", () => {
    expect(/leaseExpiresAt|Date\.now|new Date|performance\.now|getTime\(\)|LEASE_EXPIRED|monotonic/i.test(keeper)).toBe(false);
  });

  it("starts the operation once with no argument, owns its promise, and never races it away", () => {
    expect(keeper.match(/operation\(/g)).toHaveLength(1);
    expect(keeper).toMatch(/Promise\.resolve\(operation\(\)\)/);
    expect(/Promise\.race|Promise\.any/.test(keeper)).toBe(false);
    expect(keeper).toMatch(/operation: \(\) => Promise<T>/);
    // Both outcomes are observed before anything else is awaited.
    expect(keeper.indexOf("outcome.then(")).toBeLessThan(keeper.indexOf("await "));
    expect(keeper).toMatch(/await settled;\s*await keeper;\s*return outcome;/);
  });

  it("keeps heartbeat signals heartbeat-local and trips the latch only for faults", () => {
    // Only two controllers: the keeper's own stop and one per request.
    expect(keeper.match(/new AbortController\(\)/g)).toHaveLength(2);
    expect(keeper).toMatch(/client\.heartbeat\(executionAttemptId, proof, controller\.signal\)/);
    expect(/operation\([^)]/.test(keeper)).toBe(false);
    // Two trip sites: closed faults in a tick, and an unexpected keeper failure.
    expect(keeper.match(/latch\.trip\(\)/g)).toHaveLength(2);
    const unavailable = keeper.slice(keeper.indexOf('if (code === "CONTROL_API_UNAVAILABLE")'), keeper.indexOf('if (code === "HEARTBEAT_REJECTED")'));
    expect(unavailable.length).toBeGreaterThan(0);
    expect(/latch|throw/.test(unavailable)).toBe(false);
  });
});

// R44B8A/R44B8: the state-root binding. Configuration is parsed from an
// injected object; no worker production module reads the process
// environment, falls back to a temporary or working directory, creates or
// rewrites the root, or logs it.
describe("state-root binding boundary", () => {
  const config = code(read(join(SRC_ROOT, "workerConfig.ts")));
  const binding = code(read(join(SRC_ROOT, "workerStateRoot.ts")));

  it("reads no process environment anywhere in worker production source", () => {
    expect(sources.filter(({ text }) => /process\.env|process\[["']env["']\]/.test(text)).map(({ path }) => path)).toEqual([]);
    expect(/process\./.test(config)).toBe(false);
    // The binding reads only the platform and the effective UID, as host facts.
    expect(binding.match(/process\.[A-Za-z]+/g)?.sort()).toEqual(["process.geteuid", "process.geteuid", "process.platform"]);
  });

  it("has no temporary, working-directory, home or realpath fallback and never creates or rewrites the root", () => {
    for (const text of [config, binding]) {
      expect(/tmpdir|mkdtemp|process\.cwd|homedir|realpath|resolve\(|BUSYBOOKIE_MEDIA_ROOT/.test(text)).toBe(false);
    }
    expect(importsOf(binding).sort()).toEqual(["./acceptanceJournal.js", "./credentialOpeningRun.js", "./workerConfig.js", "./workerError.js", "node:fs/promises", "node:path"]);
    expect(binding).toMatch(/import \{ lstat \} from "node:fs\/promises";/);
    expect(/\bmkdir|writeFile|chmod\(|chown|rename|unlink|symlink|\.write\(|open\(/.test(binding)).toBe(false);
    expect(importsOf(config)).toEqual([]);
  });

  it("locks the keys, the production root and the sync policy", () => {
    expect(config).toMatch(/mode: "COMMERCIAL_WORKER_ENV",/);
    expect(config).toMatch(/stateRoot: "COMMERCIAL_WORKER_STATE_ROOT",/);
    expect(config).toMatch(/export const PRODUCTION_WORKER_STATE_ROOT = "\/var\/lib\/busybookie\/commercial-worker";/);
    expect(sources.filter(({ text }) => text.includes("/var/lib/busybookie")).map(({ path }) => path)).toEqual(["src/workerConfig.ts"]);
    expect(binding).toMatch(/if \(mode === "production"\) return "REQUIRED";/);
    expect(binding).toMatch(/\(root\.mode & 0o077\) !== 0/);
    expect(binding).toMatch(/host\.platform !== "linux" \|\| stateRoot !== PRODUCTION_WORKER_STATE_ROOT/);
  });

  it("logs nothing but the closed startup failure, and calls the existing startup path", () => {
    expect(binding.match(/log\?\.\(/g)).toHaveLength(1);
    expect(binding).toMatch(/run\.log\?\.\(\{ stage: "STARTUP", outcome: "FAILED", code: "STATE_ROOT_UNSUITABLE" \}\);/);
    expect(binding).toMatch(/return runCredentialOpeningOnce\(\{ \.\.\.run, journal \}\);/);
    expect(/console\.|stateRoot\s*[,}]\s*\)/.test(binding)).toBe(false);
    // No provider, polling, lock file or root metadata.
    expect(/provider|lock|marker|metadata|poll/i.test(binding.replace(/CredentialOpening/g, ""))).toBe(false);
  });

  it("is bound only by the fake-provider composer and has no process entry point", () => {
    // R44B9: the composer binds the state root; nothing calls the credential-only entry.
    expect(sources.filter(({ path, text }) => path !== "src/workerStateRoot.ts" && /workerStateRoot|runConfiguredCredentialOpeningOnce|bindWorkerStateRoot/.test(code(text))).map(({ path }) => path)).toEqual([
      "src/attemptExecution.ts",
    ]);
    expect(sources.filter(({ path, text }) => path !== "src/workerStateRoot.ts" && /runConfiguredCredentialOpeningOnce/.test(code(text))).map(({ path }) => path)).toEqual([]);
    // The composer takes the parsed configuration as a type; nothing loads it.
    expect(sources.filter(({ path, text }) => !["src/workerConfig.ts", "src/workerStateRoot.ts"].includes(path) && /workerConfig|loadWorkerConfig/.test(code(text))).map(({ path }) => path)).toEqual([
      "src/attemptExecution.ts",
    ]);
    expect(sources.filter(({ path, text }) => path !== "src/workerConfig.ts" && /loadWorkerConfig/.test(code(text))).map(({ path }) => path)).toEqual([]);
    expect(code(read(join(SRC_ROOT, "attemptExecution.ts")))).toMatch(/import type \{ WorkerConfig \} from "\.\/workerConfig\.js";/);
  });
});

// R44B9A/R44B9: the production fake provider and the one-attempt composer.
// Fake-only by construction, development-only, library-only: no real provider,
// SDK, network, environment mode, loop, retry, daemon or entry point.
describe("fake-provider execution boundary", () => {
  const COMPOSER = "src/attemptExecution.ts";
  const FAKE = "src/fakeProvider.ts";
  const composer = code(read(join(SRC_ROOT, "attemptExecution.ts")));
  const fake = code(read(join(SRC_ROOT, "fakeProvider.ts")));
  const contract = code(read(join(SRC_ROOT, "providerExecutionContract.ts")));
  const opening = code(read(join(SRC_ROOT, "credentialOpeningRun.ts")));

  it("has no caller and no process entry point; only the composer uses the fake", () => {
    expect(sources.filter(({ path, text }) => path !== COMPOSER && /attemptExecution|runConfiguredFakeProviderAttemptOnce/.test(code(text))).map(({ path }) => path)).toEqual([]);
    expect(sources.filter(({ path, text }) => path !== FAKE && /fakeProvider|createFakeProviderOperationFactory|FAKE_PROVIDER_ID/.test(code(text))).map(({ path }) => path)).toEqual([COMPOSER]);
    // The identifier exists once, in the fake, and no source names it as text elsewhere.
    expect(sources.filter(({ text }) => /BUSYBOOKIE_FAKE/.test(code(text))).map(({ path }) => path)).toEqual([FAKE]);
    expect(fake.match(/"BUSYBOOKIE_FAKE"/g)).toHaveLength(1);
  });

  it("keeps the fake local: no network, SDK, timer, environment, credential or retry", () => {
    expect(importsOf(fake).sort()).toEqual(["./providerExecutionContract.js", "./workerError.js"]);
    expect(
      /fetch|https?:|node:|require\(|process\.|setTimeout|setInterval|sleep|Math\.random|Date\.now|new Date|credential|leaseToken|apiKey|secret|retry|\bfor\s*\(|\bwhile\s*\(|console\.|log\(|poll|download|output/i.test(fake),
    ).toBe(false);
    // The ID is attempt-bound, validated by the shared rule, and handed only to the callback.
    expect(fake).toMatch(/const id = `\$\{FAKE_PROVIDER_ID\}-\$\{executionAttemptId\}`;/);
    expect(fake).toMatch(/if \(!isProviderExecutionId\(id\)\) throw new WorkerError\("PROVIDER_CONTRACT_VIOLATION"\);/);
    expect(fake.match(/providerExecutionId/g)).toHaveLength(1);
    expect(fake).toMatch(/await onAccepted\(\{ provider: FAKE_PROVIDER_ID, providerExecutionId: fakeProviderExecutionId\(executionAttemptId\) \}\);\s*return Object\.freeze\(\{ kind: "ACCEPTED" \}\);/);
    // Default ACCEPT, failure behaviours only through the explicit seam, one dispatch.
    expect(fake).toMatch(/const behavior = options\.behavior \?\? "ACCEPT";/);
    expect(fake).toMatch(/if \(request\.provider !== FAKE_PROVIDER_ID\) throw new WorkerError\("LEASED_PROVIDER_INCOMPATIBLE"\);/);
    expect(fake.match(/dispatched = true;/g)).toHaveLength(1);
  });

  it("keeps the submission contract provider-neutral and secret-free", () => {
    expect(importsOf(contract).sort()).toEqual(["./acceptanceHandler.js", "commercial-worker-protocol"]);
    const request = contract.slice(contract.indexOf("export type ProviderSubmissionRequest"), contract.indexOf("export type ProviderSubmissionOperationFactory"));
    expect(request.length).toBeGreaterThan(0);
    expect(/credential|leaseToken|token|apiKey|secret|proof|envelope|accountId/i.test(request)).toBe(false);
    const outcome = contract.slice(contract.indexOf("export type ProviderSubmissionOutcome"), contract.indexOf("export type ProviderAcceptanceCallback"));
    expect(/providerExecution|id:|Id\b/.test(outcome)).toBe(false);
    expect(/poll|download|output|complet|retry/i.test(contract)).toBe(false);
  });

  it("composes in the locked order, with the operation constructed only after the permit", () => {
    const at = (needle: string) => {
      const index = composer.indexOf(needle);
      expect({ needle, found: index >= 0 }).toEqual({ needle, found: true });
      return index;
    };
    const order = [
      'if (config.mode !== "development") throw new WorkerError("WORKER_CONFIGURATION_INVALID");',
      "await bindWorkerStateRoot(config,",
      "await openLeasedCredentialOnce({ ...opening, journal, client }, (lease) => {",
      "if (lease.provider !== FAKE_PROVIDER_ID) {",
      "await obtainPreProviderPermit({ journal, client, deadlineTimer: timer }, executionAttemptId, proof);",
      "(operationFactory ?? createFakeProviderOperationFactory())({ executionAttemptId, provider: context.lease.provider });",
      "createAcceptanceAdapter({ lease: context.lease, accountId: context.accountId, permit }, proof,",
      "await runWithInFlightHeartbeat(",
      "() => operation.execute(onAccepted),",
    ].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Exactly one of each: one binding, one lease path, one permit, one
    // construction, one adapter, one keeper, one dispatch.
    for (const pattern of [/bindWorkerStateRoot\(/g, /openLeasedCredentialOnce\(/g, /obtainPreProviderPermit\(/g, /createFakeProviderOperationFactory\(\)/g, /createAcceptanceAdapter\(/g, /runWithInFlightHeartbeat\(/g, /\.execute\(/g]) {
      expect(composer.match(pattern)).toHaveLength(1);
    }
    // The admission runs on the lease before the grant inside the shared path.
    expect(opening.indexOf("admitLease(lease);")).toBeGreaterThan(opening.indexOf('log({ stage: "LEASE", outcome: "OK", ...safe });'));
    expect(opening.indexOf("admitLease(lease);")).toBeLessThan(opening.indexOf("requestCredentialGrant("));
    expect(opening).toMatch(/opened = await openAndDiscard\(dependencies\.opener, envelope, context, \(credential\) => credential\.length > 0\);/);
  });

  it("is a library-only, single-attempt composer with no direct control-plane request, environment, loop or retry", () => {
    expect(/process\.|\bfor\s*\(|\bwhile\s*\(|setInterval|setTimeout|retry|backoff|jitter|Math\.random|console\.|fetch\s*\(|https?:/i.test(composer)).toBe(false);
    // Every control-plane request goes through an existing policy module.
    expect(/client\.[A-Za-z]+\(/.test(composer)).toBe(false);
    // The operation factory sees no secret: only the attempt ID and provider.
    expect(/credential|leaseToken|apiKey|plaintext|envelope|openingContext/i.test(composer.replace(/openLeasedCredentialOnce|[Cc]redentialOpening[A-Za-z]*/g, ""))).toBe(false);
    // Two failure reports through the shared policy, never a direct one.
    expect(composer.match(/reportSubmissionFailureWithPolicy\(/g)).toHaveLength(2);
    expect(composer).toMatch(/outcome: "DEFINITIVELY_REJECTED", failureCode: "PROVIDER_REJECTED_DEFINITIVELY"/);
    expect(composer).toMatch(/outcome: "OUTCOME_UNKNOWN", failureCode: "PROVIDER_SUBMISSION_AMBIGUOUS"/);
    // Host-fault trips: incompatible lease, contract violation, ACCEPTED without acceptance.
    expect(composer.match(/latch\.trip\(\)/g)).toHaveLength(3);
    expect(composer.match(/new WorkerError\("PROVIDER_CONTRACT_VIOLATION"\)/g)).toHaveLength(3);
  });
});

// R44B10P1: the unwired object-storage and reference-image library. The key
// is an opaque object-store key resolved only by the injected store: no
// filesystem, network, environment, provider or test-store reach, and no
// production caller yet.
describe("object-storage input boundary", () => {
  const CONTRACT = "src/objectStorageContract.ts";
  const RETRIEVAL = "src/inputMediaRetrieval.ts";
  const contract = code(read(join(SRC_ROOT, "objectStorageContract.ts")));
  const retrieval = code(read(join(SRC_ROOT, "inputMediaRetrieval.ts")));
  const raw = (path: string) => read(join(APP_ROOT, path));

  it("is unwired: no source module imports it except retrieval importing the contract", () => {
    expect(sources.filter(({ path, text }) => path !== RETRIEVAL && /inputMediaRetrieval|retrieveVerifiedReferenceImage|parseReferenceImage/.test(code(text))).map(({ path }) => path)).toEqual([]);
    expect(sources.filter(({ path, text }) => path !== CONTRACT && /objectStorageContract/.test(code(text))).map(({ path }) => path)).toEqual([RETRIEVAL]);
    // The fake composer, credential opening and the provider contract stay untouched by it.
    for (const path of ["attemptExecution.ts", "fakeProvider.ts", "credentialOpeningRun.ts", "providerExecutionContract.ts"]) {
      expect(code(read(join(SRC_ROOT, path)))).not.toMatch(/objectStorage|ObjectStore|referenceImage|ReferenceImage|inputMedia/i);
    }
  });

  it("imports only the timer seam, latch type, contract, worker errors and node:crypto", () => {
    expect(importsOf(contract)).toEqual([]);
    expect(importsOf(retrieval).sort()).toEqual(["./hostFaultLatch.js", "./objectStorageContract.js", "./preProviderOrchestration.js", "./workerError.js", "node:crypto"]);
    expect(retrieval).toMatch(/import \{ createHash \} from "node:crypto";/);
  });

  it("has no filesystem, path, environment, network, vendor, provider or engine reach", () => {
    const FORBIDDEN_REACH =
      /process\.|BUSYBOOKIE_MEDIA_ROOT|node:fs|readFile|createReadStream|node:path|path\.resolve|resolve\(|cwd|tmpdir|homedir|file:|https?:|fetch\s*\(|axios|undici|node:https?\b|amazonaws|storage\.googleapis|\bs3\b|\bgcs\b|\br2\b|supabase|minio|runway|\bveo\b|google|gemini|genai|src\/execution|\.\.\/\.\.\/|tests\/|inMemoryObjectStore|console\.|log\(/i;
    for (const text of [contract, retrieval]) expect(FORBIDDEN_REACH.test(text)).toBe(false);
    // Guard the guards.
    expect(FORBIDDEN_REACH.test('await readFile(join(mediaRoot, key))')).toBe(true);
    expect(FORBIDDEN_REACH.test("await fetch(`https://${host}/${key}`)")).toBe(true);
    expect(FORBIDDEN_REACH.test('import { createInMemoryObjectStore } from "../tests/support/inMemoryObjectStore.js";')).toBe(true);
    expect(FORBIDDEN_REACH.test("const root = process.env.BUSYBOOKIE_MEDIA_ROOT;")).toBe(true);
  });

  it("has no provider, permit, keeper, acceptance or failure-report semantics", () => {
    expect(
      /reportSubmissionFailed|reportSubmissionFailureWithPolicy|createAcceptanceAdapter|obtainPreProviderPermit|runWithInFlightHeartbeat|reportSubmitted|recoverAcceptance|ProviderSubmission|PROVIDER_REJECTED_DEFINITIVELY|DEFINITIVELY_REJECTED|OUTCOME_UNKNOWN|\.execute\(/.test(
        retrieval,
      ),
    ).toBe(false);
  });

  it("keeps the contract read-only and vendor-neutral, and the store single-shot", () => {
    expect(contract).toMatch(/getObject: \(request: ObjectStoreGetRequest\) => Promise<ObjectStoreGetResult>;/);
    expect(/put|write|delete|copy|upload|bucket|url|signed|credential|provider|retry|path\b|mediaRoot/i.test(contract)).toBe(false);
    const request = contract.slice(contract.indexOf("export type ObjectStoreGetRequest"), contract.indexOf("export type ObjectStoreFailure"));
    expect(request.match(/^\s+[a-zA-Z]+:/gm)?.map((member) => member.trim()).sort()).toEqual(["accountId:", "key:", "maxBytes:", "signal:"]);
    // One store call site, reached at most twice through two explicit calls.
    expect(retrieval.match(/\.getObject\(/g)).toHaveLength(1);
    expect(retrieval.match(/await readOnce\(\)/g)).toHaveLength(2);
    expect(retrieval).toMatch(/if \(attempt\.status === "UNAVAILABLE"\) attempt = await readOnce\(\);/);
    expect(/\bfor\s*\(|\bwhile\s*\(|setTimeout|setInterval|backoff|jitter|Math\.random/i.test(retrieval)).toBe(false);
  });

  it("locks two attempts, a fresh 10000 ms deadline per attempt and the 0004 key grammar", () => {
    expect(retrieval).toMatch(/export const OBJECT_STORAGE_INPUT_MAX_READ_ATTEMPTS = 2;/);
    expect(retrieval).toMatch(/export const OBJECT_STORAGE_INPUT_READ_DEADLINE_MS = 10000;/);
    expect(retrieval.match(/new AbortController\(\)/g)).toHaveLength(1);
    expect(retrieval).toMatch(/const KEY_PATTERN = \/\^\[A-Za-z0-9\]\[A-Za-z0-9\._\\\/-\]\*\$\/;/);
    expect(retrieval).toMatch(/const DOT_SEGMENT = \/\(\^\|\\\/\)\\\.\\\.\?\(\\\/\|\$\)\/;/);
    expect(retrieval).toMatch(/value\.length <= 512/);
    expect(retrieval).toMatch(/const SHA256_PATTERN = \/\^\[0-9a-f\]\{64\}\$\/;/);
    // The source grammar it mirrors.
    const migration = read(join(API_ROOT, "migrations", "0004_worker_bridge_persistence.sql"));
    expect(migration).toMatch(/output_object_key ~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._\/-\]\*\$'/);
    expect(migration).toMatch(/char_length\(output_object_key\) BETWEEN 1 AND 512/);
  });

  it("keeps the in-memory store test-only and gives production no default store", () => {
    expect(existsSync(join(APP_ROOT, "tests", "support", "inMemoryObjectStore.ts"))).toBe(true);
    expect(existsSync(join(SRC_ROOT, "inMemoryObjectStore.ts"))).toBe(false);
    expect(sources.filter(({ text }) => /inMemoryObjectStore|createInMemoryObjectStore/.test(text)).map(({ path }) => path)).toEqual([]);
    // The store is required, with no default or fallback.
    expect(retrieval).toMatch(/store: ObjectStore;/);
    expect(/store\s*\?\?|store\s*\|\||defaultStore|store\?:/.test(retrieval)).toBe(false);
    expect(retrieval).toMatch(/return fail\("WORKER_CONFIGURATION_INVALID", true\);/);
    // The test store reaches nothing beyond memory.
    expect(/node:fs|node:path|node:https?|fetch\s*\(|setTimeout|process\./.test(code(raw("tests/support/inMemoryObjectStore.ts")))).toBe(false);
  });

  it("trips the latch for every failure except a transient outage", () => {
    expect(retrieval.match(/fail\("[A-Z_]+", false\)/g)).toEqual(['fail("OBJECT_STORAGE_UNAVAILABLE", false)']);
    expect(retrieval.match(/latch\.trip\(\)/g)).toHaveLength(1);
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
