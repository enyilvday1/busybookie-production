import { createHash, randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../../commercial-api/src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type TransactionalPool } from "../../../commercial-api/src/database/runtimePool.js";
import {
  reconcileProviderVerificationJobs,
  type ProviderVerificationReconciliationPassResult,
} from "../../../commercial-api/src/providerConnections/providerVerificationReconciliationService.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../../commercial-api/src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../../commercial-api/src/workerControl/workerControlApplication.js";
import { WORKER_LEASE_TOKEN_PATTERN } from "../../../commercial-api/src/workerControl/workerLeasePolicy.js";
import type { WorkerSecurityEvent } from "../../../commercial-api/src/workerControl/workerSecurityEvents.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "../../../commercial-api/tests/db/support/testDatabase.js";
import { createTestWorkerAuthenticationAdapter } from "../../../commercial-api/tests/support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../../../commercial-api/tests/support/testWorkerSecurityEvents.js";
import { loadProviderVerificationConfig } from "../../src/providerVerificationConfig.js";
import { SUPPORTED_PROVIDER_VERIFICATION_PAIRS } from "../../src/providerVerificationContract.js";
import { runProviderVerification, type ProviderVerificationRunResult } from "../../src/providerVerificationRun.js";
import { createHttpProviderVerificationControlClient } from "../../src/workerControlClient.js";
import { WorkerError } from "../../src/workerError.js";
import { createTestCredentialFingerprinter, createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "../support/testCredentialOpening.js";

// R44B11G (architecture R44B11G sections 4, 5, 8 and 11: W, SD8, SD9, M1, M2,
// Z1-Z4). The worker's unsupported-lease deferral end to end: the real worker
// control client and run, the published commercial-api worker-control router
// and services on loopback, and real PostgreSQL 16 transactions on the guarded
// test database. No commercial-api service is mocked, no provider is
// contacted and no real credential exists: fixture credentials are sealed by
// the test sealer and a counting fake provider fetch must never be called.
// Only an "older API" shim (M1) answers the deferral route itself, with 404,
// without forwarding.
//
// PostgreSQL is the only time authority: expiry is decided by
// SELECT clock_timestamp() > $1::timestamptz against an exact ::text capture.
// Secret assertions are booleans, so a failure never prints a secret.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;
let events: WorkerSecurityEvent[] = [];
let serverFailures: string[] = [];
let fixtureSecrets: string[] = [];
let capturedExchanges: Exchange[] = [];
let capturedResults: ProviderVerificationRunResult[] = [];

const POLL_DELAY_MS = 25;
const REAL_EXPIRY_MAX_POLLS = 2400;
const REAL_WAIT_TEST_TIMEOUT_MS = 120000;
// The worker's control deadline is 3000 ms; the shim holds a request past it.
const PAST_CONTROL_DEADLINE_MS = 3500;
const REJECTED_BODY = '{"status":"error","code":"LEASE_REJECTED"}\n';
const ZERO_PASS: ProviderVerificationReconciliationPassResult = Object.freeze({ cancelledJobs: 0, requeuedJobs: 0, completedJobs: 0 });
// A provider and policy outside every supported pair, and a supported
// provider with a policy it does not support.
const UNSUPPORTED_PROVIDER = "EXAMPLE_PROVIDER";
const UNSUPPORTED_POLICY = "EXAMPLE_METADATA_V1";

const encryptionKey = generateTestKey("r44b11g-deferral-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("r44b11g-deferral-fingerprint/v1"), encryptionKey);

beforeAll(async () => {
  clients = await openGuardedClients();
  const loaded = loadRuntimeDatabaseConfig(
    {
      COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl,
      COMMERCIAL_API_DATABASE_POOL_MAX: "6",
      COMMERCIAL_API_DATABASE_LOCK_TIMEOUT_MS: "60000",
      COMMERCIAL_API_DATABASE_STATEMENT_TIMEOUT_MS: "90000",
    },
    "development",
  );
  if (loaded === null) throw new Error("the R44B11G runtime pool configuration did not load");
  pool = await createRuntimePool(loaded, () => {});
});
beforeEach(async () => {
  await prepareSchemaV1(clients);
  events = [];
  serverFailures = [];
  fixtureSecrets = [];
  capturedExchanges = [];
  capturedResults = [];
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  // Z2: no fixture secret in any captured control body, run result or security event.
  const visible = JSON.stringify(capturedExchanges) + JSON.stringify(capturedResults) + JSON.stringify(events);
  expect(fixtureSecrets.some((secret) => visible.includes(secret))).toBe(false);
});
afterAll(async () => {
  await pool.end();
  await prepareSchemaV1(clients);
  await clients.close();
});

// ---------------------------------------------------------------------------
// Fixtures, committed by the migration owner

type Machine = Readonly<{ id: string; credential: string }>;

async function machine(): Promise<Machine> {
  const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ('r44b11g-deferral-worker') RETURNING id")).rows[0]!.id;
  const credential = `fixture-machine-${randomBytes(16).toString("hex")}`;
  fixtureSecrets.push(credential);
  return { id, credential };
}

async function controlPlane(machines: readonly Machine[]): Promise<string> {
  const recording = createRecordingWorkerSecurityEventSink();
  events = recording.events;
  const application = createWorkerControlApplication({
    authentication: createTestWorkerAuthenticationAdapter(machines.map((each) => ({ token: each.credential, workerPrincipalId: each.id }))),
    securityEvents: recording.sink,
    pool,
    reportFailure: (text) => {
      serverFailures.push(text);
    },
  });
  server = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
  return `http://127.0.0.1:${server.port}`;
}

type Job = Readonly<{ accountId: string; connectionId: string; jobId: string }>;

// One Account, one connection with an ACTIVE sealed v1, and one QUEUED job.
async function seedJob(provider: string, verificationPolicyId: string): Promise<Job> {
  const owner = await insertAccountWithFreeGrant(clients.migrator, `r44b11g-deferral-${randomUUID()}`);
  const connectionId = (
    await clients.migrator.query<{ id: string }>(
      "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, $2, 'API_KEY', $3) RETURNING id",
      [owner.accountId, provider, owner.userId],
    )
  ).rows[0]!.id;
  const plaintext = `fixture-credential-${randomBytes(18).toString("hex")}`;
  fixtureSecrets.push(plaintext);
  const envelope = await sealer.seal(plaintext, { accountId: owner.accountId, providerConnectionId: connectionId, provider, credentialVersion: 1, purpose: "provider-credential" });
  const fingerprint = await fingerprinter.fingerprint(plaintext);
  const versionId = (
    await clients.migrator.query<{ id: string }>(
      `INSERT INTO provider_credential_versions (account_id, provider_connection_id, credential_version, sealed_credential, fingerprint_algorithm,
                                                 fingerprint_key_ref, fingerprint_value, created_by_user_id)
       VALUES ($1, $2, 1, $3::jsonb, $4, $5, $6, $7) RETURNING id`,
      [owner.accountId, connectionId, JSON.stringify(envelope), fingerprint.algorithm, fingerprint.keyRef, fingerprint.value, owner.userId],
    )
  ).rows[0]!.id;
  const jobId = (
    await clients.migrator.query<{ id: string }>(
      `INSERT INTO provider_verification_jobs (account_id, provider_connection_id, provider_credential_version_id, verification_policy_id, requested_by_user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [owner.accountId, connectionId, versionId, verificationPolicyId, owner.userId],
    )
  ).rows[0]!.id;
  return Object.freeze({ accountId: owner.accountId, connectionId, jobId });
}

const unsupportedProviderJob = () => seedJob(UNSUPPORTED_PROVIDER, UNSUPPORTED_POLICY);
// A supported provider (from the canonical pairs) leased with a policy it does not support.
const unsupportedPolicyJob = () => seedJob(SUPPORTED_PROVIDER_VERIFICATION_PAIRS[0]!.provider, UNSUPPORTED_POLICY);

// ---------------------------------------------------------------------------
// Reads (the fixture runtime connection)

const one = <T extends object>(sql: string, params: unknown[] = []) => clients.runtime.query<T>(sql, params).then((result) => result.rows[0]!);

type DeferralState = Readonly<{
  state: string;
  fence: number;
  count: number;
  refusal: string | null;
  deferred: boolean;
  exact_d1: boolean | null;
  live_lease_cleared: boolean;
  granted: boolean;
  verifying: boolean;
  result_outcome: string | null;
  terminal_reason_code: string | null;
  completed: boolean;
}>;
const deferralState = (jobId: string) =>
  one<DeferralState>(
    `SELECT state, lease_fencing_counter::integer AS fence, unsupported_deferral_count AS count, last_unsupported_refusal AS refusal,
            deferred_until IS NOT NULL AS deferred, deferred_until = updated_at + interval '300 seconds' AS exact_d1,
            (lease_worker_principal_id IS NULL AND lease_token_sha256 IS NULL AND leased_at IS NULL AND lease_expires_at IS NULL) AS live_lease_cleared,
            credential_granted_at IS NOT NULL AS granted, verifying_at IS NOT NULL AS verifying,
            result_outcome, terminal_reason_code, completed_at IS NOT NULL AS completed
       FROM provider_verification_jobs WHERE id = $1`,
    [jobId],
  );
const connectionSnapshot = (connectionId: string) =>
  one<{ text: string }>("SELECT row_to_json(c)::text AS text FROM provider_connections c WHERE id = $1", [connectionId]).then((row) => row.text);
const auditCount = () => one<{ total: number }>("SELECT count(*)::integer AS total FROM audit_events").then((row) => row.total);
const leaseExpiryText = (jobId: string) =>
  one<{ expires: string }>("SELECT lease_expires_at::text AS expires FROM provider_verification_jobs WHERE id = $1", [jobId]).then((row) => row.expires);
// The worker's millisecond deferredUntil against the stored microsecond instant.
const matchesStored = (jobId: string, deferredUntil: Date) =>
  one<{ matches: boolean }>(
    "SELECT abs(extract(epoch FROM deferred_until - $2::timestamptz)) < 0.001 AS matches FROM provider_verification_jobs WHERE id = $1",
    [jobId, deferredUntil.toISOString()],
  ).then((row) => row.matches);

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function untilExpired(expiresText: string): Promise<void> {
  for (let poll = 0; poll < REAL_EXPIRY_MAX_POLLS; poll += 1) {
    if ((await one<{ expired: boolean }>("SELECT clock_timestamp() > $1::timestamptz AS expired", [expiresText])).expired) return;
    await pause(POLL_DELAY_MS);
  }
  throw new Error("the PostgreSQL clock did not cross the captured lease expiry");
}

const reconcile = () => reconcileProviderVerificationJobs(pool, { correlationId: randomUUID() });

// ---------------------------------------------------------------------------
// Worker side

type Exchange = { url: string; status: number; body: string; shim?: true; lost?: true };

// R1: what happened to each deferral request the worker's client handed to
// the control fetch. "forwarded" means the request was given to the loopback
// fetch; dispatch is proven only by a response ("response") or, for an
// already-aborted signal, refuted by fetch rejecting before sending
// ("rejected" with AbortError) together with the server-side state.
type DeferralTrace = {
  signalAbortedAtForward: boolean | null;
  outcome: "pending" | "response" | "rejected";
  status: number | null;
  rejectionName: string | null;
};

// R1-B: holds the worker's deferral response after the published API has
// answered (and committed), until the test releases it. Reading a body and
// successfully parsing it are distinct observable outcomes.
type LateBodyOutcome = Readonly<{ status: "parsed" } | { status: "rejected"; rejectionName: string }>;
type ResponseGate = Readonly<{ answered: (status: number) => void; release: Promise<void>; consumed: (outcome: LateBodyOutcome) => void }>;

type GraphOptions = Readonly<{
  // Harness work before the deferral request is forwarded.
  beforeDeferral?: (url: string, init: RequestInit | undefined) => Promise<void>;
  // The committed deferral response is lost in transport.
  loseDeferralResponse?: boolean;
  // The committed deferral response is replaced by a malformed 200.
  malformDeferralResponse?: boolean;
  // A loopback shim standing in for a pre-R44B11G router: the deferral route
  // is answered 404 and never forwarded. It does not run an older API binary
  // or a migration-0010 runtime.
  olderApi?: boolean;
  // The API's deferral response is withheld from the worker until released.
  holdDeferralResponse?: ResponseGate;
  shutdownSignal?: AbortSignal;
}>;

// A test-controlled promise.
function gate<T = void>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve;
  });
  return { promise, resolve };
}

const passGate = (): void => undefined;
const isDeferral = (url: string) => new URL(url).pathname.endsWith("/unsupported");

// One worker object graph: its own recorded control fetch, client, opener,
// counting fake provider and run.
function graph(baseUrl: string, worker: Machine, options: GraphOptions = {}) {
  const exchanges: Exchange[] = [];
  // R1: every deferral request the client handed over, and its forwarding
  // operation as an observed promise that never rejects, so a test can await
  // it before finishing.
  const deferralTraces: DeferralTrace[] = [];
  const deferralOperations: Promise<void>[] = [];
  const forward = async (url: string, input: URL | string, init: RequestInit | undefined, trace: DeferralTrace | null): Promise<Response> => {
    if (trace !== null) {
      if (options.olderApi === true) {
        const body = '{"status":"error","code":"NOT_FOUND"}\n';
        const entry: Exchange = { url, status: 404, body, shim: true };
        exchanges.push(entry);
        capturedExchanges.push(entry);
        trace.outcome = "response";
        trace.status = 404;
        return new Response(body, { status: 404, headers: { "Content-Type": "application/json" } });
      }
      if (options.beforeDeferral !== undefined) await options.beforeDeferral(url, init);
      trace.signalAbortedAtForward = init?.signal?.aborted === true;
    }
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      if (trace !== null) {
        trace.outcome = "rejected";
        // fetch rejects an already-aborted signal with its reason, an AbortError DOMException.
        const name: unknown = (error as { name?: unknown } | null)?.name;
        trace.rejectionName = typeof name === "string" ? name : "unknown";
      }
      throw error;
    }
    const body = await response.text();
    const entry: Exchange = { url, status: response.status, body };
    exchanges.push(entry);
    capturedExchanges.push(entry);
    if (trace !== null) {
      trace.outcome = "response";
      trace.status = response.status;
      if (options.holdDeferralResponse !== undefined) {
        // The API has answered (and, for a 200, committed); the worker does not see it yet.
        options.holdDeferralResponse.answered(response.status);
        await options.holdDeferralResponse.release;
        // The late response is handed over; report whether the real client's
        // response.json() parsed or rejected. Merely entering finally is not
        // proof of successful body consumption.
        const consumed = options.holdDeferralResponse.consumed;
        const late = new Response(body, { status: response.status, headers: response.headers });
        const read = late.json.bind(late);
        Object.defineProperty(late, "json", {
          value: async (): Promise<unknown> => {
            try {
              const parsed = await read();
              consumed(Object.freeze({ status: "parsed" }));
              return parsed;
            } catch (error) {
              const name: unknown = (error as { name?: unknown } | null)?.name;
              consumed(Object.freeze({ status: "rejected", rejectionName: typeof name === "string" ? name : "unknown" }));
              throw error;
            }
          },
        });
        return late;
      }
    }
    if (trace !== null && options.loseDeferralResponse === true) {
      entry.lost = true;
      throw new TypeError("simulated response loss after the server committed");
    }
    if (trace !== null && options.malformDeferralResponse === true && response.status === 200) {
      const malformed = JSON.stringify({ ...(JSON.parse(body) as object), deferralSeconds: 300 });
      return new Response(malformed, { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(body, { status: response.status, headers: response.headers });
  };
  const control = ((input: URL | string, init?: RequestInit) => {
    const url = String(input);
    if (!isDeferral(url)) return forward(url, input, init, null);
    const trace: DeferralTrace = { signalAbortedAtForward: null, outcome: "pending", status: null, rejectionName: null };
    deferralTraces.push(trace);
    const operation = forward(url, input, init, trace);
    deferralOperations.push(
      operation.then(
        () => undefined,
        () => undefined,
      ),
    );
    return operation;
  }) as typeof fetch;
  let providerCalls = 0;
  const provider = (async () => {
    providerCalls += 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const realClient = createHttpProviderVerificationControlClient({ baseUrl, machineCredential: worker.credential, fetchImpl: control });
  // R2-2: hold-response tests observe the real client's promise, not just
  // the fetch wrapper's forwarding promise. This test-only decorator forwards
  // to the same real method, unchanged, and records its terminal settlement.
  let deferralClientOutcome: Promise<"ACKNOWLEDGED" | "REJECTED"> | null = null;
  const client =
    options.holdDeferralResponse === undefined
      ? realClient
      : Object.freeze({
          ...realClient,
          deferUnsupportedProviderVerification: (...args: Parameters<typeof realClient.deferUnsupportedProviderVerification>) => {
            const pending = realClient.deferUnsupportedProviderVerification(...args);
            deferralClientOutcome = pending.then(
              () => "ACKNOWLEDGED" as const,
              () => "REJECTED" as const,
            );
            return pending;
          },
        });
  const run = async () => {
    const result = await runProviderVerification(
      { config: loadProviderVerificationConfig({}), environment: {}, ...(options.shutdownSignal === undefined ? {} : { shutdownSignal: options.shutdownSignal }) },
      { client, opener: createTestCredentialOpener(encryptionKey), fetchImpl: provider, liveGate: passGate },
    );
    capturedResults.push(result);
    return result;
  };
  return {
    run,
    client,
    exchanges,
    paths: () => exchanges.map(({ url }) => new URL(url).pathname.replace(/^\/worker-control\/v1\/provider-verifications\//, "")),
    providerCalls: () => providerCalls,
    deferralTraces,
    // Every deferral forwarding operation, settled (they never reject).
    deferralsSettled: () => Promise.all(deferralOperations),
    // Only the hold-response test uses this. It fails immediately if the
    // expected client operation never began, and exposes its actual terminal
    // outcome so a missing json() callback cannot hang until Vitest timeout.
    deferralClientSettlement: () => {
      if (deferralClientOutcome === null) throw new Error("R1-B: deferral client operation was never invoked");
      return deferralClientOutcome;
    },
  };
}

const expectNoProviderOrAuthority = async (job: Job, providerCalls: number) => {
  // Z1: no provider fetch and no grant, VERIFYING or result on the unsupported path.
  expect(providerCalls).toBe(0);
  const state = await deferralState(job.jobId);
  expect({ granted: state.granted, verifying: state.verifying, result: state.result_outcome, terminal: state.terminal_reason_code, completed: state.completed }).toEqual({
    granted: false,
    verifying: false,
    result: null,
    terminal: null,
    completed: false,
  });
};

// ---------------------------------------------------------------------------

describe("R44B11G deferral: real client -> published API -> PostgreSQL", () => {
  it("defers a refused lease LEASED -> QUEUED with the fence preserved, exactly d(1), no grant, VERIFYING, provider call, audit or customer-visible change", async () => {
    const worker = await machine();
    const job = await unsupportedProviderJob();
    const baseUrl = await controlPlane([worker]);
    const connectionBefore = await connectionSnapshot(job.connectionId);
    const auditsBefore = await auditCount();
    const g = graph(baseUrl, worker);

    const result = await g.run();

    expect(result).toMatchObject({ status: "UNSUPPORTED_LEASE", providerVerificationJobId: job.jobId, reason: "UNSUPPORTED_PROVIDER", disposition: "DEFERRED", cause: null });
    expect(Object.keys(result).sort()).toEqual(["cause", "deferredUntil", "disposition", "providerVerificationJobId", "reason", "status"]);
    expect(g.paths()).toEqual(["lease", `${job.jobId}/unsupported`]);
    expect(g.exchanges.map(({ status }) => status)).toEqual([200, 200]);
    const state = await deferralState(job.jobId);
    expect(state).toMatchObject({ state: "QUEUED", fence: 1, count: 1, refusal: "UNSUPPORTED_PROVIDER", deferred: true, exact_d1: true, live_lease_cleared: true });
    if (result.status === "UNSUPPORTED_LEASE" && result.disposition === "DEFERRED") expect(await matchesStored(job.jobId, result.deferredUntil)).toBe(true);
    await expectNoProviderOrAuthority(job, g.providerCalls());
    expect(await connectionSnapshot(job.connectionId)).toBe(connectionBefore);
    expect(await auditCount()).toBe(auditsBefore);
    // A successful deferral is not a security event.
    expect(events).toEqual([]);
    expect(serverFailures).toEqual([]);
    // The deferred job is not leasable, and the reconciler has nothing to do with it.
    expect(await g.client.leaseProviderVerification()).toBeNull();
    expect(await reconcile()).toEqual(ZERO_PASS);
  });

  it("reports UNSUPPORTED_POLICY for a supported provider with an unsupported policy, deferring it the same way", async () => {
    const worker = await machine();
    const job = await unsupportedPolicyJob();
    const g = graph(await controlPlane([worker]), worker);
    expect(await g.run()).toMatchObject({ reason: "UNSUPPORTED_POLICY", disposition: "DEFERRED", cause: null });
    expect(await deferralState(job.jobId)).toMatchObject({ state: "QUEUED", count: 1, refusal: "UNSUPPORTED_POLICY" });
    await expectNoProviderOrAuthority(job, g.providerCalls());
  });

  it("is REJECTED by HTTP 409 when the deferral was already committed (no exact replay), with one worker request and one increment", async () => {
    const worker = await machine();
    const job = await unsupportedProviderJob();
    const baseUrl = await controlPlane([worker]);
    // The harness commits the identical request first, so the worker's own request finds the job no longer LEASED.
    const g = graph(baseUrl, worker, {
      beforeDeferral: async (url, init) => {
        const first = await fetch(url, init);
        await first.text();
        expect(first.status).toBe(200);
      },
    });
    const result = await g.run();
    expect(result).toMatchObject({ disposition: "REJECTED", detail: "PROVIDER_VERIFICATION_DEFERRAL_REJECTED", cause: null });
    expect(g.exchanges.filter(({ url }) => isDeferral(url))).toHaveLength(1);
    expect(g.exchanges.at(-1)).toMatchObject({ status: 409, body: REJECTED_BODY });
    expect(events.map(({ type, reason }) => [type, reason])).toEqual([["WORKER_PROVIDER_VERIFICATION_DEFERRAL_REJECTED", "NOT_LEASED"]]);
    expect(await deferralState(job.jobId)).toMatchObject({ state: "QUEUED", count: 1 });
    await expectNoProviderOrAuthority(job, g.providerCalls());
  });

  it("SD8: a lost response after the server committed is UNCONFIRMED / CONTROL_API_UNAVAILABLE, never DEFERRED, and the row shows the deferral", async () => {
    const worker = await machine();
    const job = await unsupportedProviderJob();
    const g = graph(await controlPlane([worker]), worker, { loseDeferralResponse: true });
    expect(await g.run()).toMatchObject({ disposition: "UNCONFIRMED", detail: "CONTROL_API_UNAVAILABLE", cause: null });
    expect(g.exchanges.filter(({ url }) => isDeferral(url))).toHaveLength(1);
    expect(await deferralState(job.jobId)).toMatchObject({ state: "QUEUED", fence: 1, count: 1, exact_d1: true });
    await expectNoProviderOrAuthority(job, g.providerCalls());
  });

  it("SD9: a malformed 200 after the server committed is UNCONFIRMED / MALFORMED_CONTROL_RESPONSE, and the row shows the deferral", async () => {
    const worker = await machine();
    const job = await unsupportedProviderJob();
    const g = graph(await controlPlane([worker]), worker, { malformDeferralResponse: true });
    expect(await g.run()).toMatchObject({ disposition: "UNCONFIRMED", detail: "MALFORMED_CONTROL_RESPONSE", cause: null });
    expect(g.exchanges.filter(({ url }) => isDeferral(url))).toHaveLength(1);
    expect(await deferralState(job.jobId)).toMatchObject({ state: "QUEUED", count: 1 });
    await expectNoProviderOrAuthority(job, g.providerCalls());
  });

  it(
    // M1 is simulated: a loopback shim answers the deferral route 404 as a
    // pre-R44B11G router would; no older API binary or 0010 runtime is run.
    "M1/M2: against a simulated older API (loopback 404 shim) the run is UNCONFIRMED / MALFORMED_CONTROL_RESPONSE with one request; natural expiry then requeues with the columns unchanged",
    async () => {
      const worker = await machine();
      const job = await unsupportedProviderJob();
      const g = graph(await controlPlane([worker]), worker, { olderApi: true });
      expect(await g.run()).toMatchObject({ disposition: "UNCONFIRMED", detail: "MALFORMED_CONTROL_RESPONSE", cause: null });
      expect(g.exchanges.filter(({ url }) => isDeferral(url))).toEqual([expect.objectContaining({ status: 404, shim: true })]);
      // Nothing reached the API: the job is still LEASED to the worker, never deferred.
      expect(await deferralState(job.jobId)).toMatchObject({ state: "LEASED", fence: 1, count: 0, refusal: null, deferred: false });
      await untilExpired(await leaseExpiryText(job.jobId));
      expect(await reconcile()).toEqual({ cancelledJobs: 0, requeuedJobs: 1, completedJobs: 0 });
      expect(await deferralState(job.jobId)).toMatchObject({ state: "QUEUED", fence: 1, count: 0, refusal: null, deferred: false, live_lease_cleared: true });
      await expectNoProviderOrAuthority(job, g.providerCalls());
    },
    REAL_WAIT_TEST_TIMEOUT_MS,
  );

  // R1-A, supplementary (it does not replace SD3): the run's send closure ran
  // and the client handed its request to the control fetch, but the shutdown
  // recorded first had already aborted the attempt signal, so fetch rejected
  // before sending anything. Invoking the closure is not network dispatch.
  it("R1-A: shutdown after the deferral closure ran, before network dispatch, is UNCONFIRMED / SHUTDOWN, cause SHUTDOWN, and the job is untouched", async () => {
    const worker = await machine();
    const job = await unsupportedProviderJob();
    const shutdown = new AbortController();
    const g = graph(await controlPlane([worker]), worker, {
      shutdownSignal: shutdown.signal,
      beforeDeferral: async () => {
        shutdown.abort();
      },
    });
    const result = await g.run();
    // The pending forwarding operation has settled before anything is judged.
    await g.deferralsSettled();

    expect(result).toEqual({
      status: "UNSUPPORTED_LEASE",
      providerVerificationJobId: job.jobId,
      reason: "UNSUPPORTED_PROVIDER",
      disposition: "UNCONFIRMED",
      detail: "SHUTDOWN",
      cause: "SHUTDOWN",
    });
    expect(Object.isFrozen(result)).toBe(true);
    // The closure ran: the client handed exactly one deferral request to the
    // control fetch (reachable only through the run's send closure), whose
    // signal was already aborted, and fetch rejected without sending.
    expect(g.deferralTraces).toEqual([{ signalAbortedAtForward: true, outcome: "rejected", status: null, rejectionName: "AbortError" }]);
    // Zero dispatch: no deferral response, no server-side security event, and the job is exactly as leased.
    expect(g.exchanges.filter(({ url }) => isDeferral(url))).toEqual([]);
    expect(g.paths()).toEqual(["lease"]);
    expect(events).toEqual([]);
    expect(await deferralState(job.jobId)).toEqual({
      state: "LEASED",
      fence: 1,
      count: 0,
      refusal: null,
      deferred: false,
      exact_d1: null,
      live_lease_cleared: false,
      granted: false,
      verifying: false,
      result_outcome: null,
      terminal_reason_code: null,
      completed: false,
    });
    await expectNoProviderOrAuthority(job, g.providerCalls());
  });

  // R1-B: the locked SD3. Exactly one deferral request reaches the published
  // API, which commits and answers 200; the response is withheld from the
  // worker behind a test-controlled gate while the shutdown is recorded. The
  // worker can only report UNCONFIRMED, although the server committed. The
  // late response is then released and absorbed without changing the result.
  it("SD3: shutdown while the deferral is in flight is UNCONFIRMED / SHUTDOWN, cause SHUTDOWN, after exactly one committed request, and the late response is absorbed", async () => {
    const worker = await machine();
    const job = await unsupportedProviderJob();
    const auditsBefore = await auditCount();
    const shutdown = new AbortController();
    const answered = gate<number>();
    const release = gate();
    const consumed = gate<LateBodyOutcome>();
    const g = graph(await controlPlane([worker]), worker, {
      shutdownSignal: shutdown.signal,
      holdDeferralResponse: { answered: answered.resolve, release: release.promise, consumed: consumed.resolve },
    });
    let settled: ProviderVerificationRunResult | undefined;
    const running = g.run().then((value) => {
      settled = value;
      return value;
    });
    try {
      // A failed fetch/body read can settle the worker without ever calling
      // answered(). Race that terminal fact; do not wait for the Vitest timeout.
      const arrival = await Promise.race([
        answered.promise.then((status) => ({ kind: "ANSWERED" as const, status })),
        running.then(
          () => ({ kind: "RUN_SETTLED_FIRST" as const }),
          () => ({ kind: "RUN_REJECTED_FIRST" as const }),
        ),
      ]);
      if (arrival.kind !== "ANSWERED") throw new Error(`R1-B: ${arrival.kind} before the API answer`);
      expect(arrival.status).toBe(200);
      expect(g.deferralTraces).toEqual([{ signalAbortedAtForward: false, outcome: "response", status: 200, rejectionName: null }]);
      // The server committed while the worker has not seen the acknowledgement.
      expect(settled).toBeUndefined();
      expect(await deferralState(job.jobId)).toMatchObject({ state: "QUEUED", fence: 1, count: 1, refusal: "UNSUPPORTED_PROVIDER", deferred: true, exact_d1: true, live_lease_cleared: true });
      expect(settled).toBeUndefined();

      shutdown.abort();
      const result = await running;
      expect(result).toEqual({
        status: "UNSUPPORTED_LEASE",
        providerVerificationJobId: job.jobId,
        reason: "UNSUPPORTED_PROVIDER",
        disposition: "UNCONFIRMED",
        detail: "SHUTDOWN",
        cause: "SHUTDOWN",
      });
      expect(Object.isFrozen(result)).toBe(true);
      const snapshot = JSON.stringify(result);

      // After shutdown the run is already settled; racing consumed() against
      // running would fail spuriously. Instead race the body's outcome against
      // the real deferral client's terminal settlement. Both are observed.
      release.resolve();
      await g.deferralsSettled();
      const lateRead = await Promise.race([
        consumed.promise.then((outcome) => ({ kind: "BODY_READ" as const, outcome })),
        g.deferralClientSettlement().then((outcome) => ({ kind: "CLIENT_SETTLED_FIRST" as const, outcome })),
      ]);
      if (lateRead.kind !== "BODY_READ") throw new Error(`R1-B: ${lateRead.kind} without an observed body outcome`);
      expect(lateRead.outcome).toEqual({ status: "parsed" });
      expect(await g.deferralClientSettlement()).toBe("ACKNOWLEDGED");
      await Promise.resolve();
      expect(JSON.stringify(result)).toBe(snapshot);
      expect(settled).toBe(result);

      // Exactly one request and no retry; one committed deferral, no
      // security event and no audit insertion.
      expect(g.deferralTraces).toHaveLength(1);
      expect(g.exchanges.filter(({ url }) => isDeferral(url)).map(({ status }) => status)).toEqual([200]);
      expect(events).toEqual([]);
      expect(await auditCount()).toBe(auditsBefore);
      expect(await deferralState(job.jobId)).toEqual({
        state: "QUEUED",
        fence: 1,
        count: 1,
        refusal: "UNSUPPORTED_PROVIDER",
        deferred: true,
        exact_d1: true,
        live_lease_cleared: true,
        granted: false,
        verifying: false,
        result_outcome: null,
        terminal_reason_code: null,
        completed: false,
      });
      await expectNoProviderOrAuthority(job, g.providerCalls());
    } finally {
      // Release and abort even if a pre-answered fetch failure won the gate
      // race. The abort is harmless after the run already returned.
      release.resolve();
      shutdown.abort();
      await g.deferralsSettled();
      await running.then(
        () => undefined,
        () => undefined,
      );
      // A failed assertion must not leave the real client's late promise
      // running into the next test. The wrapper has a nonrejecting observer.
      if (g.deferralTraces.length > 0) await g.deferralClientSettlement();
    }
  });

  it("the 3000 ms control deadline is UNCONFIRMED / CONTROL_API_UNAVAILABLE with no retry; the delayed forward settles unsent and the lease is untouched", async () => {
    const worker = await machine();
    const job = await unsupportedProviderJob();
    const g = graph(await controlPlane([worker]), worker, { beforeDeferral: () => pause(PAST_CONTROL_DEADLINE_MS) });
    const result = await g.run();
    expect(result).toEqual({
      status: "UNSUPPORTED_LEASE",
      providerVerificationJobId: job.jobId,
      reason: "UNSUPPORTED_PROVIDER",
      disposition: "UNCONFIRMED",
      detail: "CONTROL_API_UNAVAILABLE",
      cause: null,
    });
    // The delayed forwarding operation outlives the deadline; await its
    // settlement (its pause timer has then fired) before judging anything.
    await g.deferralsSettled();
    // The deadline aborted the attempt signal before forwarding, so fetch rejected without sending.
    expect(g.deferralTraces).toEqual([{ signalAbortedAtForward: true, outcome: "rejected", status: null, rejectionName: "AbortError" }]);
    expect(g.exchanges.filter(({ url }) => isDeferral(url))).toEqual([]);
    expect(events).toEqual([]);
    // Zero server-side deferrals: the job is exactly as leased, left to the reconciler.
    expect(await deferralState(job.jobId)).toMatchObject({ state: "LEASED", fence: 1, count: 0, refusal: null, deferred: false, live_lease_cleared: false });
    await expectNoProviderOrAuthority(job, g.providerCalls());
  });

  it("W/Z: the client alone defers once, refuses a second identical request with 409, and puts no token or credential in any response or event", async () => {
    const worker = await machine();
    const job = await unsupportedProviderJob();
    const baseUrl = await controlPlane([worker]);
    const g = graph(baseUrl, worker);
    const lease = await g.client.leaseProviderVerification();
    expect(lease?.providerVerificationJobId).toBe(job.jobId);
    expect(WORKER_LEASE_TOKEN_PATTERN.test(lease!.leaseToken)).toBe(true);
    const proof = { fencingCounter: lease!.fencingCounter, leaseToken: lease!.leaseToken };
    const acknowledgement = await g.client.deferUnsupportedProviderVerification(job.jobId, proof, "PROVIDER_POLICY_MISMATCH");
    expect(acknowledgement).toMatchObject({ providerVerificationJobId: job.jobId, fencingCounter: 1, state: "QUEUED" });
    expect(await matchesStored(job.jobId, acknowledgement.deferredUntil)).toBe(true);
    const second = await g.client.deferUnsupportedProviderVerification(job.jobId, proof, "PROVIDER_POLICY_MISMATCH").then(
      () => "OK",
      (error: unknown) => (error instanceof WorkerError ? error.code : "UNEXPECTED"),
    );
    expect(second).toBe("PROVIDER_VERIFICATION_DEFERRAL_REJECTED");
    expect(await deferralState(job.jobId)).toMatchObject({ state: "QUEUED", count: 1, refusal: "PROVIDER_POLICY_MISMATCH" });
    // The deferral responses and events carry no lease token, token hash or credential.
    const sha = createHash("sha256").update(lease!.leaseToken, "utf8").digest("hex");
    const deferralBodies = g.exchanges.filter(({ url }) => isDeferral(url)).map(({ body }) => body).join("");
    expect(deferralBodies.includes(lease!.leaseToken) || deferralBodies.includes(sha) || JSON.stringify(events).includes(lease!.leaseToken)).toBe(false);
    expect((await one<{ hits: number }>("SELECT count(*)::integer AS hits FROM provider_verification_jobs t WHERE strpos(t::text, $1) > 0", [lease!.leaseToken])).hits).toBe(0);
  });
});
