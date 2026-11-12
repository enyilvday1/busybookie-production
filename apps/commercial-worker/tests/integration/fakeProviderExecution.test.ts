import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../../commercial-api/src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type TransactionalPool } from "../../../commercial-api/src/database/runtimePool.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../../commercial-api/src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../../commercial-api/src/workerControl/workerControlApplication.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "../../../commercial-api/tests/db/support/testDatabase.js";
import { createTestWorkerAuthenticationAdapter } from "../../../commercial-api/tests/support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../../../commercial-api/tests/support/testWorkerSecurityEvents.js";
import type { RecoverySleep } from "../../src/acceptanceRecoveryPolicy.js";
import { runConfiguredFakeProviderAttemptOnce, type FakeProviderAttemptDependencies } from "../../src/attemptExecution.js";
import type { WorkerLogEvent } from "../../src/credentialOpeningRun.js";
import { createFakeProviderOperationFactory, FAKE_PROVIDER_ID, type FakeProviderBehavior } from "../../src/fakeProvider.js";
import { createHostFaultLatch } from "../../src/hostFaultLatch.js";
import type { DeadlineTimer } from "../../src/preProviderOrchestration.js";
import type { ProviderSubmissionOperationFactory, ProviderSubmissionRequest } from "../../src/providerExecutionContract.js";
import { createHttpWorkerControlClient } from "../../src/workerControlClient.js";
import type { WorkerConfig } from "../../src/workerConfig.js";
import { WorkerError } from "../../src/workerError.js";
import { createTestCredentialFingerprinter, createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "../support/testCredentialOpening.js";

// R44B9: the first production fake-provider execution (architecture section
// 36, "First fake-provider execution slice", R44B9A). Tier 3: the production
// composer runConfiguredFakeProviderAttemptOnce, with the production
// BUSYBOOKIE_FAKE operation, talks through the real WorkerControlClient over
// HTTP to the real commercial-api worker-control router, PostgreSQL 16 on
// 127.0.0.1:5433 and a real development state root bound by the production
// binding. No provider URL, SDK or credential leaves the process: every
// request is checked against the local control-plane origin.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;
let stateRoot: string;

const encryptionKey = generateTestKey("fake-execution-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("fake-execution-fingerprint/v1"), encryptionKey);
const testOpener = createTestCredentialOpener(encryptionKey);

beforeAll(async () => {
  clients = await openGuardedClients();
  const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: "6" }, "development");
  pool = await createRuntimePool(config!, () => {});
});
beforeEach(async () => {
  await prepareSchemaV1(clients);
  stateRoot = await mkdtemp(join(tmpdir(), "busybookie-fake-execution-"));
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(stateRoot, { recursive: true, force: true });
});
afterAll(async () => {
  await pool.end();
  await prepareSchemaV1(clients);
  await clients.close();
});

// ---------------------------------------------------------------------------
// Fixtures (committed by the commercial-api owner role)

const q = <T extends object>(sql: string, params: unknown[]) => clients.migrator.query<T>(sql, params).then((result) => result.rows[0]!);

type Work = Readonly<{ accountId: string; attemptId: string; jobId: string; plaintext: string }>;

// One queued USER_BYO attempt for `provider` with a sealed fixture credential.
async function work(provider: string = FAKE_PROVIDER_ID): Promise<Work> {
  const owner = await insertAccountWithFreeGrant(clients.migrator, `fake-execution-${randomUUID()}`);
  const production = await q<{ id: string }>(
    "INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id) VALUES ($1, 'Production', $2, $3) RETURNING id",
    [owner.accountId, owner.grantId, owner.userId],
  );
  const connection = await q<{ id: string }>(
    "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, $2, 'API_KEY', $3) RETURNING id",
    [owner.accountId, provider, owner.userId],
  );
  const plaintext = `fixture-credential-${randomBytes(18).toString("hex")}`;
  const envelope = await sealer.seal(plaintext, { accountId: owner.accountId, providerConnectionId: connection.id, provider, credentialVersion: 1, purpose: "provider-credential" });
  const fingerprint = await fingerprinter.fingerprint(plaintext);
  const version = await q<{ id: string }>(
    `INSERT INTO provider_credential_versions (account_id, provider_connection_id, credential_version, sealed_credential, fingerprint_algorithm,
                                               fingerprint_key_ref, fingerprint_value, created_by_user_id)
     VALUES ($1, $2, 1, $3::jsonb, $4, $5, $6, $7) RETURNING id`,
    [owner.accountId, connection.id, JSON.stringify(envelope), fingerprint.algorithm, fingerprint.keyRef, fingerprint.value, owner.userId],
  );
  const authorization = await q<{ id: string }>(
    `INSERT INTO generation_authorizations
       (account_id, production_id, entitlement_grant_id, billing_mode, provider, model, provider_connection_id,
        provider_credential_version_id, generation_request, generation_request_sha256, expected_cost_cap_unit,
        expected_cost_cap_amount, expires_at, created_by_user_id)
     VALUES ($1, $2, $3, 'USER_BYO', $4, 'example-model-1', $5, $6, '{"prompt":"fixture"}'::jsonb, repeat('c', 64),
             'MICRO_USD', 2000000, now() + interval '15 minutes', $7) RETURNING id`,
    [owner.accountId, production.id, owner.grantId, provider, connection.id, version.id, owner.userId],
  );
  await clients.migrator.query("UPDATE generation_authorizations SET status = 'CLAIMED', claimed_at = now() WHERE id = $1", [authorization.id]);
  const job = await q<{ id: string }>(
    "INSERT INTO execution_jobs (account_id, production_id, generation_authorization_id) VALUES ($1, $2, $3) RETURNING id",
    [owner.accountId, production.id, authorization.id],
  );
  const attempt = await q<{ id: string }>(
    `INSERT INTO execution_attempts (account_id, execution_job_id, generation_authorization_id, attempt_number, billing_mode, provider, provider_credential_version_id)
     VALUES ($1, $2, $3, 1, 'USER_BYO', $4, $5) RETURNING id`,
    [owner.accountId, job.id, authorization.id, provider, version.id],
  );
  return { accountId: owner.accountId, attemptId: attempt.id, jobId: job.id, plaintext };
}

type Machine = Readonly<{ id: string; credential: string }>;

async function machine(): Promise<Machine> {
  const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ('fake-execution-worker') RETURNING id")).rows[0]!.id;
  return { id, credential: `fixture-machine-${randomBytes(16).toString("hex")}` };
}

async function controlPlane(worker: Machine): Promise<string> {
  const recording = createRecordingWorkerSecurityEventSink();
  const application = createWorkerControlApplication({
    authentication: createTestWorkerAuthenticationAdapter([{ token: worker.credential, workerPrincipalId: worker.id }]),
    securityEvents: recording.sink,
    pool,
    reportFailure: () => {},
  });
  server = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
  return `http://127.0.0.1:${server.port}`;
}

const attemptRow = async (id: string) =>
  (
    await clients.migrator.query<{ state: string; failure_code: string | null; provider_execution_id: string | null; lease_worker_principal_id: string | null }>(
      "SELECT state, failure_code, provider_execution_id, lease_worker_principal_id FROM execution_attempts WHERE id = $1",
      [id],
    )
  ).rows[0]!;
const jobStatus = async (id: string) => (await clients.migrator.query<{ status: string }>("SELECT status FROM execution_jobs WHERE id = $1", [id])).rows[0]!.status;
const auditTypes = async (attemptId: string) =>
  (await clients.migrator.query<{ event_type: string }>("SELECT event_type FROM audit_events WHERE resource_id = $1 ORDER BY sequence", [attemptId])).rows.map(
    ({ event_type }) => event_type,
  );
const allAuditText = async () => (await clients.migrator.query<{ text: string | null }>("SELECT string_agg(audit_events::text, '\n') AS text FROM audit_events")).rows[0]!.text ?? "";

const recordsDirectory = () => join(stateRoot, "acceptance-journal", "v1");
const recordFiles = async () => (await readdir(recordsDirectory())).sort();

// Waits on real I/O for a condition; never a lease wait.
async function until(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 2000; index += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not reached");
}

// ---------------------------------------------------------------------------
// One worker run: the real HTTP client with a recording, origin-checked
// transport, a latch, test-controlled deadlines and keeper cadence.

function workerRun(baseUrl: string, worker: Machine) {
  const origin = new URL(baseUrl).origin;
  const requests: { url: string; status: number }[] = [];
  const offOrigin: string[] = [];
  const leaseTokens: string[] = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    // No real network: only the local control-plane origin is ever contacted.
    if (new URL(url).origin !== origin) {
      offOrigin.push(url);
      throw new Error("off-origin request refused by the test transport");
    }
    const response = await fetch(input, init);
    requests.push({ url: url.slice(origin.length), status: response.status });
    if (url.endsWith("/worker-control/v1/leases") && response.status === 200) {
      const body = (await response.clone().json()) as { lease?: { leaseToken?: unknown } | null };
      if (typeof body.lease?.leaseToken === "string") leaseTokens.push(body.lease.leaseToken);
    }
    return response;
  }) as typeof fetch;

  // Request deadlines never fire on their own.
  const deadlineTimer: DeadlineTimer = () => () => {};
  const keeperSleeps: { ms: number; done: boolean; end: () => void }[] = [];
  const keeperSleep: RecoverySleep = (ms, signal) =>
    new Promise<void>((resolve) => {
      const entry = {
        ms,
        done: false,
        end: () => {
          entry.done = true;
          resolve();
        },
      };
      keeperSleeps.push(entry);
      if (signal?.aborted) entry.end();
      else signal?.addEventListener("abort", () => entry.end(), { once: true });
    });

  const latch = createHostFaultLatch();
  const events: WorkerLogEvent[] = [];
  const opened = { count: 0 };
  const dependencies: FakeProviderAttemptDependencies = {
    environment: {},
    client: createHttpWorkerControlClient({ baseUrl, machineCredential: worker.credential, fetchImpl }),
    opener: {
      open: async (sealed, context) => {
        opened.count += 1;
        return testOpener.open(sealed, context);
      },
    },
    latch,
    deadlineTimer,
    keeperSleep,
    log: (event) => events.push(event),
  };
  return { dependencies, requests, offOrigin, leaseTokens, keeperSleeps, latch, events, opened, routes: () => requests.map(({ url }) => url.replace(/[0-9a-f-]{36}/g, ":id")) };
}

const development = (): WorkerConfig => Object.freeze({ mode: "development", stateRoot });

function countingFactory(inner: ProviderSubmissionOperationFactory) {
  const counts = { constructed: 0, executed: 0 };
  const requests: ProviderSubmissionRequest[] = [];
  const factory: ProviderSubmissionOperationFactory = (request) => {
    counts.constructed += 1;
    requests.push(request);
    const operation = inner(request);
    return Object.freeze({
      execute: (onAccepted) => {
        counts.executed += 1;
        return operation.execute(onAccepted);
      },
    });
  };
  return { factory, counts, requests };
}

async function expectNoSecretAnywhere(run: ReturnType<typeof workerRun>, item: Work, worker: Machine, ...values: unknown[]) {
  expect(run.leaseTokens.length).toBeGreaterThan(0);
  const secrets = [item.plaintext, worker.credential, ...run.leaseTokens];
  const visible = [
    JSON.stringify(run.events),
    ...values.map((value) => (value instanceof Error ? `${value.message} ${String(value.stack)} ${JSON.stringify(value)}` : JSON.stringify(value))),
    await allAuditText(),
  ];
  try {
    for (const name of await recordFiles()) visible.push(await readFile(join(recordsDirectory(), name), "utf8"));
  } catch {
    // No record directory content: nothing to scan.
  }
  for (const text of visible) for (const secret of secrets) expect(text.includes(secret)).toBe(false);
}

const SUBMITTED_ROUTES = [
  "/worker-control/v1/leases",
  "/worker-control/v1/attempts/:id/credential-grant",
  "/worker-control/v1/attempts/:id/submitting",
  "/worker-control/v1/attempts/:id/heartbeat",
  "/worker-control/v1/attempts/:id/submitted",
];

describe("production fake-provider execution over the real control plane", () => {
  it("runs one attempt to SUBMITTED with the attempt-bound fake execution ID", async () => {
    const item = await work();
    const worker = await machine();
    const run = workerRun(await controlPlane(worker), worker);
    const counted = countingFactory(createFakeProviderOperationFactory());
    const result = await runConfiguredFakeProviderAttemptOnce(development(), { ...run.dependencies, operationFactory: counted.factory });

    expect(result).toEqual({ status: "SUBMITTED", executionAttemptId: item.attemptId });
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "SUBMITTED", provider_execution_id: `BUSYBOOKIE_FAKE-${item.attemptId}`, failure_code: null });
    expect(await jobStatus(item.jobId)).toBe("RUNNING");
    const types = await auditTypes(item.attemptId);
    expect(types.filter((type) => type === "execution_attempt.submitting")).toHaveLength(1);
    expect(types.filter((type) => type === "execution_attempt.submitted")).toHaveLength(1);
    expect(types.some((type) => /failed_before_submission|outcome_unknown|lease_expired/.test(type))).toBe(false);
    expect(run.routes()).toEqual(SUBMITTED_ROUTES);
    expect(run.requests.every(({ status }) => status === 200)).toBe(true);
    expect(run.offOrigin).toEqual([]);
    expect(counted.counts).toEqual({ constructed: 1, executed: 1 });
    expect(counted.requests).toEqual([{ executionAttemptId: item.attemptId, provider: FAKE_PROVIDER_ID }]);
    expect(run.opened.count).toBe(1);
    expect(run.latch.isTripped()).toBe(false);
    // The durable acceptance record stays on SUBMITTED (deletion belongs to later recovery).
    expect(await recordFiles()).toEqual([`${item.attemptId}.json`]);
    await expectNoSecretAnywhere(run, item, worker, result, counted.requests);
  });

  it.each([
    ["DEFINITIVE_FAILURE", "FAILED_BEFORE_SUBMISSION", "PROVIDER_REJECTED_DEFINITIVELY", "FAILED", "execution_attempt.failed_before_submission"],
    ["AMBIGUOUS_FAILURE", "OUTCOME_UNKNOWN", "PROVIDER_SUBMISSION_AMBIGUOUS", "NEEDS_ATTENTION", "execution_attempt.outcome_unknown"],
  ] as const)("reports %s once and records it authoritatively", async (behavior: FakeProviderBehavior, state, failureCode, job, audit) => {
    const item = await work();
    const worker = await machine();
    const run = workerRun(await controlPlane(worker), worker);
    const result = await runConfiguredFakeProviderAttemptOnce(development(), {
      ...run.dependencies,
      operationFactory: createFakeProviderOperationFactory({ behavior }),
    });

    expect(result).toEqual({ status: "PROVIDER_FAILURE_REPORTED", executionAttemptId: item.attemptId, outcome: behavior, state });
    expect(await attemptRow(item.attemptId)).toMatchObject({ state, failure_code: failureCode, provider_execution_id: null });
    expect(await jobStatus(item.jobId)).toBe(job);
    const types = await auditTypes(item.attemptId);
    expect(types.filter((type) => type === audit)).toHaveLength(1);
    expect(types).not.toContain("execution_attempt.submitted");
    expect(run.routes()).toEqual([...SUBMITTED_ROUTES.slice(0, 4), "/worker-control/v1/attempts/:id/submission-failed"]);
    expect(run.offOrigin).toEqual([]);
    expect(run.latch.isTripped()).toBe(false);
    expect(await recordFiles()).toEqual([]);
    await expectNoSecretAnywhere(run, item, worker, result);
  });

  it("keeps the lease alive through the in-flight keeper while the dispatch is pending", async () => {
    const item = await work();
    const worker = await machine();
    const run = workerRun(await controlPlane(worker), worker);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const production = createFakeProviderOperationFactory();
    const attempt = runConfiguredFakeProviderAttemptOnce(development(), {
      ...run.dependencies,
      // The production fake, dispatched only after a test-held gate opens.
      operationFactory: (request) => {
        const operation = production(request);
        return Object.freeze({
          execute: async (onAccepted) => {
            await gate;
            return operation.execute(onAccepted);
          },
        });
      },
    });
    await until(() => run.keeperSleeps.length === 1);
    expect(run.keeperSleeps[0]!.ms).toBe(30000);
    run.keeperSleeps[0]!.end();
    await until(() => run.routes().filter((route) => route.endsWith("/heartbeat")).length === 2);
    await until(() => run.keeperSleeps.length === 2);
    expect(run.requests.filter(({ url }) => url.endsWith("/heartbeat")).every(({ status }) => status === 200)).toBe(true);
    expect((await attemptRow(item.attemptId)).state).toBe("SUBMITTING");
    release();
    await expect(attempt).resolves.toEqual({ status: "SUBMITTED", executionAttemptId: item.attemptId });
    expect(run.routes()).toEqual([...SUBMITTED_ROUTES.slice(0, 4), "/worker-control/v1/attempts/:id/heartbeat", "/worker-control/v1/attempts/:id/submitted"]);
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "SUBMITTED", provider_execution_id: `BUSYBOOKIE_FAKE-${item.attemptId}` });
    expect(run.latch.isTripped()).toBe(false);
  });

  it("stops a non-fake lease before the grant: no opening, no report, the lease left to expiry", async () => {
    const item = await work("EXAMPLE_PROVIDER");
    const worker = await machine();
    const run = workerRun(await controlPlane(worker), worker);
    const counted = countingFactory(createFakeProviderOperationFactory());
    const error = await runConfiguredFakeProviderAttemptOnce(development(), { ...run.dependencies, operationFactory: counted.factory }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(WorkerError);
    expect((error as WorkerError).code).toBe("LEASED_PROVIDER_INCOMPATIBLE");
    expect(run.routes()).toEqual(["/worker-control/v1/leases"]);
    expect(run.opened.count).toBe(0);
    expect(counted.counts).toEqual({ constructed: 0, executed: 0 });
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "LEASED", lease_worker_principal_id: worker.id, provider_execution_id: null });
    expect(await auditTypes(item.attemptId)).not.toContain("execution_attempt.submitting");
    expect(run.latch.isTripped()).toBe(true);
    expect(run.events.at(-1)).toEqual({ stage: "LEASE", outcome: "FAILED", code: "LEASED_PROVIDER_INCOMPATIBLE", executionAttemptId: item.attemptId, provider: "EXAMPLE_PROVIDER" });
    await expectNoSecretAnywhere(run, item, worker, error);
  });

  it("refuses production configuration before any request or state-root access", async () => {
    const item = await work();
    const worker = await machine();
    const run = workerRun(await controlPlane(worker), worker);
    const counted = countingFactory(createFakeProviderOperationFactory());
    const error = await runConfiguredFakeProviderAttemptOnce(Object.freeze({ mode: "production", stateRoot: "/var/lib/busybookie/commercial-worker" }), {
      ...run.dependencies,
      operationFactory: counted.factory,
    }).then(
      () => undefined,
      (caught: unknown) => caught,
    );

    expect((error as WorkerError).code).toBe("WORKER_CONFIGURATION_INVALID");
    expect(run.requests).toEqual([]);
    expect(run.events).toEqual([]);
    expect(counted.counts).toEqual({ constructed: 0, executed: 0 });
    expect((await attemptRow(item.attemptId)).state).toBe("QUEUED");
  });
});
