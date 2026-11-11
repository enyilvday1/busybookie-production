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
import { createAcceptanceAdapter } from "../../src/acceptanceAdapter.js";
import type { WorkerProviderAcceptance } from "../../src/acceptanceHandler.js";
import { createAcceptanceJournal, nodeJournalFileSystem, type JournalFileSystem } from "../../src/acceptanceJournal.js";
import type { RecoverySleep } from "../../src/acceptanceRecoveryPolicy.js";
import { runCredentialOpeningOnce, type WorkerLogEvent } from "../../src/credentialOpeningRun.js";
import { createHostFaultLatch } from "../../src/hostFaultLatch.js";
import { runWithInFlightHeartbeat } from "../../src/inFlightHeartbeat.js";
import { obtainPreProviderPermit, type DeadlineTimer, type PreProviderPermit } from "../../src/preProviderOrchestration.js";
import { createHttpWorkerControlClient, type LeaseProof, type WorkerLease } from "../../src/workerControlClient.js";
import { WorkerError } from "../../src/workerError.js";
import { fakeRecoveryTime } from "../support/fakeRecoveryTime.js";
import { createTestCredentialFingerprinter, createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "../support/testCredentialOpening.js";

// R44B7: whole-chain crash-point tests (architecture section 36, "Whole-chain
// crash-point test contract", R44B7A). Tier 3: the worker's production
// components, composed here in test code (no production orchestrator exists
// or is implied), talk through the real WorkerControlClient over HTTP to the
// real commercial-api worker-control router, PostgreSQL 16 on 127.0.0.1:5433
// and a real temporary-directory acceptance journal.
//
// The provider side is a TEST-ONLY controlled operation thunk: a
// deterministic event source, never a fake or real provider, adapter or SDK.
// No provider URL is contacted. A simulated crash freezes every I/O of the
// abandoned "process" (its HTTP transport and journal filesystem never settle
// again), so no continuation can act after the restart; a restart builds a
// fresh object graph and keeps only the database and the journal state root.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;
let stateRoot: string;

const encryptionKey = generateTestKey("whole-chain-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("whole-chain-fingerprint/v1"), encryptionKey);
const testOpener = createTestCredentialOpener(encryptionKey);
const DIRECTORY_SYNC = process.platform === "win32" ? "DEVELOPMENT_BEST_EFFORT" : "REQUIRED";
const PROVIDER = "EXAMPLE_PROVIDER";

beforeAll(async () => {
  clients = await openGuardedClients();
  const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: "6" }, "development");
  pool = await createRuntimePool(config!, () => {});
});
beforeEach(async () => {
  await prepareSchemaV1(clients);
  stateRoot = await mkdtemp(join(tmpdir(), "busybookie-whole-chain-"));
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

// One queued USER_BYO attempt with a sealed fixture credential.
async function work(): Promise<Work> {
  const owner = await insertAccountWithFreeGrant(clients.migrator, `whole-chain-${randomUUID()}`);
  const production = await q<{ id: string }>(
    "INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id) VALUES ($1, 'Production', $2, $3) RETURNING id",
    [owner.accountId, owner.grantId, owner.userId],
  );
  const connection = await q<{ id: string }>(
    "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, $2, 'API_KEY', $3) RETURNING id",
    [owner.accountId, PROVIDER, owner.userId],
  );
  const plaintext = `fixture-credential-${randomBytes(18).toString("hex")}`;
  const envelope = await sealer.seal(plaintext, { accountId: owner.accountId, providerConnectionId: connection.id, provider: PROVIDER, credentialVersion: 1, purpose: "provider-credential" });
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
    [owner.accountId, production.id, owner.grantId, PROVIDER, connection.id, version.id, owner.userId],
  );
  await clients.migrator.query("UPDATE generation_authorizations SET status = 'CLAIMED', claimed_at = now() WHERE id = $1", [authorization.id]);
  const job = await q<{ id: string }>(
    "INSERT INTO execution_jobs (account_id, production_id, generation_authorization_id) VALUES ($1, $2, $3) RETURNING id",
    [owner.accountId, production.id, authorization.id],
  );
  const attempt = await q<{ id: string }>(
    `INSERT INTO execution_attempts (account_id, execution_job_id, generation_authorization_id, attempt_number, billing_mode, provider, provider_credential_version_id)
     VALUES ($1, $2, $3, 1, 'USER_BYO', $4, $5) RETURNING id`,
    [owner.accountId, job.id, authorization.id, PROVIDER, version.id],
  );
  return { accountId: owner.accountId, attemptId: attempt.id, jobId: job.id, plaintext };
}

type Machine = Readonly<{ id: string; credential: string }>;

async function machine(): Promise<Machine> {
  const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ('whole-chain-worker') RETURNING id")).rows[0]!.id;
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
const audits = async (attemptId: string) =>
  (
    await clients.migrator.query<{ event_type: string; metadata: Record<string, unknown> }>(
      "SELECT event_type, metadata FROM audit_events WHERE resource_id = $1 ORDER BY sequence",
      [attemptId],
    )
  ).rows;
const countOf = (rows: readonly { event_type: string }[], type: string) => rows.filter(({ event_type }) => event_type === type).length;
const allAuditText = async () => (await clients.migrator.query<{ text: string | null }>("SELECT string_agg(audit_events::text, '\n') AS text FROM audit_events")).rows[0]!.text ?? "";

// Authoritative server-side expiry; the worker clock is never consulted.
const expireLease = (attemptId: string) =>
  clients.migrator.query(
    "UPDATE execution_attempts SET leased_at = now() - interval '10 minutes', heartbeat_at = now() - interval '10 minutes', lease_expires_at = now() - interval '1 second' WHERE id = $1",
    [attemptId],
  );

const recordsDirectory = () => join(stateRoot, "acceptance-journal", "v1");
const recordPath = (attemptId: string) => join(recordsDirectory(), `${attemptId}.json`);
const recordFiles = async () => (await readdir(recordsDirectory())).sort();
const quarantined = async () => (await readdir(join(stateRoot, "acceptance-journal", "quarantine"))).sort();

async function workerFailure(promise: Promise<unknown>, secrets: readonly string[]): Promise<WorkerError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(WorkerError);
  const visible = `${(error as Error).message} ${JSON.stringify(error)} ${String((error as Error).stack)}`;
  for (const secret of secrets) expect(visible.includes(secret)).toBe(false);
  return error as WorkerError;
}

// Waits on real I/O (HTTP and filesystem) for a condition; never a lease wait.
async function until(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 2000; index += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("condition not reached");
}

const never = <T>() => new Promise<T>(() => {});

// ---------------------------------------------------------------------------
// One simulated worker process: its own HTTP transport, journal object and
// filesystem, latch and timing. Crashing it freezes all of its I/O forever.

type TransportAction = "FREEZE_BEFORE_SEND" | "FREEZE_AFTER_COMMIT" | "UNAVAILABLE";
type TransportRule = { suffix: string; action: TransportAction; remaining: number };
type JournalFault = "NONE" | "CRASH_AT_FINAL_LINK" | "CRASH_DURING_TEMPORARY_WRITE";

function workerProcess(baseUrl: string, worker: Machine, options: Readonly<{ rules?: TransportRule[]; journalFault?: JournalFault }> = {}) {
  let dead = false;
  const requests: { url: string; status?: number; action?: TransportAction }[] = [];
  const rules: TransportRule[] = [...(options.rules ?? [])];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    const entry: (typeof requests)[number] = { url };
    requests.push(entry);
    if (dead) return never<Response>();
    const rule = rules.find(({ suffix, remaining }) => remaining > 0 && url.endsWith(suffix));
    if (rule !== undefined) {
      rule.remaining -= 1;
      entry.action = rule.action;
      // The request never leaves the process: the server sees nothing.
      if (rule.action === "FREEZE_BEFORE_SEND") {
        dead = true;
        return never<Response>();
      }
      // An unavailable control plane, answered locally: nothing was sent.
      if (rule.action === "UNAVAILABLE") return new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } });
    }
    const response = await fetch(input, init);
    entry.status = response.status;
    if (rule?.action === "FREEZE_AFTER_COMMIT") {
      // The real server committed and answered; the process dies before it
      // can observe the response.
      await response.arrayBuffer();
      dead = true;
      return never<Response>();
    }
    return response;
  }) as typeof fetch;

  const written: Uint8Array[] = [];
  const fault = options.journalFault ?? "NONE";
  const fileSystem: JournalFileSystem = {
    ...nodeJournalFileSystem,
    openExclusive: async (path, mode) => {
      if (dead) return never();
      const handle = await nodeJournalFileSystem.openExclusive(path, mode);
      return {
        writeFile: async (data) => {
          if (dead) return never();
          if (fault === "CRASH_DURING_TEMPORARY_WRITE" && path.endsWith(".tmp")) {
            // A torn temporary: half the bytes reach the disk, then the process dies.
            await handle.writeFile(data.subarray(0, Math.floor(data.length / 2)));
            await handle.close();
            dead = true;
            return never();
          }
          written.push(data);
          return handle.writeFile(data);
        },
        sync: () => (dead ? never() : handle.sync()),
        close: () => (dead ? never() : handle.close()),
      };
    },
    link: async (existingPath, newPath) => {
      if (dead) return never();
      if (fault === "CRASH_AT_FINAL_LINK" && existingPath.endsWith(".tmp") && newPath.endsWith(".json")) {
        // The temporary is complete, synced and closed; the final link never happens.
        dead = true;
        return never();
      }
      return nodeJournalFileSystem.link(existingPath, newPath);
    },
    unlink: (path) => (dead ? never() : nodeJournalFileSystem.unlink(path)),
  };

  // Heartbeat cadence and request deadlines are test-controlled; nothing fires
  // unless a test says so.
  const deadlines: { fire: () => void; cancelled: boolean }[] = [];
  const deadlineTimer: DeadlineTimer = (_ms, onExpiry) => {
    const entry = { fire: onExpiry, cancelled: false };
    deadlines.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  const heartbeatSleeps: { ms: number; done: boolean; end: () => void }[] = [];
  const heartbeatSleep: RecoverySleep = (ms, signal) =>
    new Promise<void>((resolve) => {
      const entry = {
        ms,
        done: false,
        end: () => {
          entry.done = true;
          resolve();
        },
      };
      heartbeatSleeps.push(entry);
      if (signal?.aborted) entry.end();
      else signal?.addEventListener("abort", () => entry.end(), { once: true });
    });
  const elapseHeartbeatSleep = () => {
    const pending = heartbeatSleeps.find(({ done }) => !done);
    if (pending === undefined) throw new Error("no pending heartbeat sleep");
    pending.end();
  };

  const client = createHttpWorkerControlClient({ baseUrl, machineCredential: worker.credential, fetchImpl });
  const journal = createAcceptanceJournal({ stateRoot, directorySync: DIRECTORY_SYNC, fileSystem });
  const latch = createHostFaultLatch();
  const recoveryTime = fakeRecoveryTime();
  return {
    client,
    journal,
    latch,
    recoveryTime,
    deadlineTimer,
    deadlines,
    heartbeatSleep,
    heartbeatSleeps,
    elapseHeartbeatSleep,
    written,
    requests,
    isDead: () => dead,
    // Faults that must not touch the pre-provider phase are added after the permit.
    addRule: (rule: TransportRule) => {
      rules.push(rule);
    },
    // Process death: every later I/O of this graph stays pending forever.
    crash: () => {
      dead = true;
    },
  };
}
type WorkerProcess = ReturnType<typeof workerProcess>;

// The TEST-ONLY controlled provider-operation thunk: an external-event source
// that counts dispatches across every simulated process of a scenario. It is
// not a provider, adapter or SDK and contacts nothing.
function controlledProvider() {
  let dispatches = 0;
  let decide!: (decision: Readonly<{ kind: "ACCEPT"; providerExecutionId: string }> | Readonly<{ kind: "FAIL"; error: Error }>) => void;
  const decision = new Promise<Readonly<{ kind: "ACCEPT"; providerExecutionId: string }> | Readonly<{ kind: "FAIL"; error: Error }>>((resolve) => {
    decide = resolve;
  });
  return {
    dispatches: () => dispatches,
    operation: (onAccepted: (acceptance: WorkerProviderAcceptance) => Promise<void>) => async () => {
      dispatches += 1;
      const outcome = await decision;
      if (outcome.kind === "FAIL") throw outcome.error;
      await onAccepted({ provider: PROVIDER, providerExecutionId: outcome.providerExecutionId });
      return "RECONCILED" as const;
    },
    accept: (providerExecutionId: string) => decide({ kind: "ACCEPT", providerExecutionId }),
    fail: (error: Error) => decide({ kind: "FAIL", error }),
  };
}

type Submitting = Readonly<{ lease: WorkerLease; proof: LeaseProof; permit: PreProviderPermit }>;

// Real lease and grant, then the real pre-provider orchestration to the permit.
async function toPermit(processOne: WorkerProcess): Promise<Submitting> {
  const lease = (await processOne.client.leaseNextAttempt())!;
  const proof: LeaseProof = { fencingCounter: lease.fencingCounter, leaseToken: lease.leaseToken };
  await processOne.client.requestCredentialGrant(lease.executionAttemptId, proof);
  const permit = await obtainPreProviderPermit({ journal: processOne.journal, client: processOne.client, deadlineTimer: processOne.deadlineTimer }, lease.executionAttemptId, proof);
  return { lease, proof, permit };
}

// The test-only composition (R44B7A): the keeper wraps the controlled
// provider-submission operation, whose acceptance callback is the real
// acceptance adapter. The returned promise is observed so an abandoned
// process can never raise an unhandled rejection.
function submitInProcess(processOne: WorkerProcess, item: Work, submitting: Submitting, provider: ReturnType<typeof controlledProvider>) {
  const adapter = createAcceptanceAdapter({ lease: submitting.lease, accountId: item.accountId, permit: submitting.permit }, submitting.proof, {
    journal: processOne.journal,
    client: processOne.client,
    latch: processOne.latch,
    deadlineTimer: processOne.deadlineTimer,
    monotonicNow: processOne.recoveryTime.monotonicNow,
    sleep: processOne.recoveryTime.sleep,
  });
  const outcome = runWithInFlightHeartbeat(
    {
      executionAttemptId: submitting.lease.executionAttemptId,
      proof: submitting.proof,
      client: processOne.client,
      latch: processOne.latch,
      deadlineTimer: processOne.deadlineTimer,
      sleep: processOne.heartbeatSleep,
    },
    provider.operation(adapter),
  );
  let settled: Readonly<{ value?: string; error?: unknown }> | undefined;
  outcome.then(
    (value) => {
      settled = { value };
    },
    (error: unknown) => {
      settled = { error };
    },
  );
  return { outcome, settled: () => settled };
}

// A restart: a fresh process through the real startup entry point.
function restart(baseUrl: string, worker: Machine, options: Readonly<{ sleep?: RecoverySleep }> = {}) {
  const fresh = workerProcess(baseUrl, worker);
  const events: WorkerLogEvent[] = [];
  const run = runCredentialOpeningOnce({
    journal: fresh.journal,
    environment: {},
    client: fresh.client,
    opener: testOpener,
    monotonicNow: fresh.recoveryTime.monotonicNow,
    sleep: options.sleep ?? fresh.recoveryTime.sleep,
    log: (event) => events.push(event),
  });
  run.catch(() => undefined);
  return { fresh, run, events };
}

async function scenario() {
  const worker = await machine();
  const item = await work();
  const baseUrl = await controlPlane(worker);
  return { worker, item, baseUrl };
}

const controlUrlsOnly = (baseUrl: string, ...processes: WorkerProcess[]) => {
  for (const each of processes) expect(each.requests.every(({ url }) => url.startsWith(`${baseUrl}/worker-control/v1/`))).toBe(true);
};
const recoveryUrl = (baseUrl: string, attemptId: string) => `${baseUrl}/worker-control/v1/attempts/${attemptId}/acceptance-recovery`;

async function expectNoSecrets(worker: Machine, submitting: Submitting, item: Work): Promise<void> {
  const files = await recordFiles().catch(() => [] as string[]);
  for (const name of files) {
    const text = await readFile(join(recordsDirectory(), name), "latin1");
    expect(text.includes(submitting.lease.leaseToken) || text.includes(worker.credential) || text.includes(item.plaintext)).toBe(false);
  }
  const auditText = await allAuditText();
  expect(auditText.includes(submitting.lease.leaseToken) || auditText.includes(worker.credential) || auditText.includes(item.plaintext)).toBe(false);
}

const EXECUTION = "synthetic/operations/whole-chain-1";

// ---------------------------------------------------------------------------

describe("whole-chain crash recovery: before durable acceptance (accepted residuals)", () => {
  it("case 1: pre-durable dispatch crash converges to OUTCOME_UNKNOWN without resubmission", async () => {
    const { worker, item, baseUrl } = await scenario();
    const processOne = workerProcess(baseUrl, worker);
    const submitting = await toPermit(processOne);
    const provider = controlledProvider();
    const submission = submitInProcess(processOne, item, submitting, provider);
    await until(() => provider.dispatches() === 1);
    // The provider may have accepted; nothing durable exists. The process dies.
    processOne.crash();
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "SUBMITTING" });
    expect(await recordFiles()).toEqual([]);

    await expireLease(item.attemptId);
    const second = restart(baseUrl, worker);
    // The real startup entry point is CLEAR, and its lease request runs the authoritative sweep.
    expect(await second.run).toEqual({ status: "NO_WORK" });
    expect(second.fresh.requests.map(({ url }) => url)).toEqual([`${baseUrl}/worker-control/v1/leases`]);
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "OUTCOME_UNKNOWN", failure_code: "WORKER_LEASE_EXPIRED_DURING_SUBMISSION", provider_execution_id: null });
    expect(await jobStatus(item.jobId)).toBe("NEEDS_ATTENTION");
    expect(await recordFiles()).toEqual([]);
    expect(countOf(await audits(item.attemptId), "execution_attempt.outcome_unknown")).toBe(1);
    expect(countOf(await audits(item.attemptId), "execution_attempt.submitted")).toBe(0);
    // Exactly one dispatch across both processes; the restart never resubmits.
    expect(provider.dispatches()).toBe(1);
    expect(submission.settled()).toBeUndefined();
    controlUrlsOnly(baseUrl, processOne, second.fresh);
    await expectNoSecrets(worker, submitting, item);
  });

  it("optional: HARNESS-LEVEL CONTROL-PLANE ASSERTION — NOT PRODUCTION PROVIDER-FAILURE COMPOSITION: a late definitive failure cannot replace the authoritative unknown", async () => {
    const { worker, item, baseUrl } = await scenario();
    const processOne = workerProcess(baseUrl, worker);
    const submitting = await toPermit(processOne);
    const provider = controlledProvider();
    submitInProcess(processOne, item, submitting, provider);
    await until(() => provider.dispatches() === 1);
    processOne.crash();
    await expireLease(item.attemptId);
    expect(await restart(baseUrl, worker).run).toEqual({ status: "NO_WORK" });
    // The harness itself calls the existing client; production composes no such path.
    const harness = workerProcess(baseUrl, worker);
    const refused = await workerFailure(
      harness.client.reportSubmissionFailed(item.attemptId, submitting.proof, { outcome: "DEFINITIVELY_REJECTED", failureCode: "PROVIDER_REJECTED_DEFINITIVELY" }),
      [submitting.lease.leaseToken, worker.credential],
    );
    expect(refused.code).toBe("SUBMISSION_FAILED_REJECTED");
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "OUTCOME_UNKNOWN", failure_code: "WORKER_LEASE_EXPIRED_DURING_SUBMISSION" });
    expect(await jobStatus(item.jobId)).toBe("NEEDS_ATTENTION");
    expect(provider.dispatches()).toBe(1);
  });

  it("case 3: an invalid (torn) temporary journal file is quarantined, never becomes acceptance, and the attempt ends OUTCOME_UNKNOWN", async () => {
    const { worker, item, baseUrl } = await scenario();
    const processOne = workerProcess(baseUrl, worker, { journalFault: "CRASH_DURING_TEMPORARY_WRITE" });
    const submitting = await toPermit(processOne);
    const provider = controlledProvider();
    submitInProcess(processOne, item, submitting, provider);
    await until(() => provider.dispatches() === 1);
    provider.accept(EXECUTION);
    await until(() => processOne.isDead());
    const torn = await recordFiles();
    expect(torn).toHaveLength(1);
    expect(torn[0]).toMatch(new RegExp(`^${item.attemptId}\\.[0-9a-f]{32}\\.tmp$`));

    await expireLease(item.attemptId);
    const second = restart(baseUrl, worker);
    expect(await second.run).toEqual({ status: "NO_WORK" });
    // Quarantined exactly, not repaired; no acceptance was fabricated or reported.
    expect(await recordFiles()).toEqual([]);
    expect(await quarantined()).toEqual(torn);
    expect(second.events).toContainEqual({ stage: "STARTUP", outcome: "OK", code: "ACCEPTANCE_JOURNAL_CORRUPT" });
    expect(second.fresh.requests.map(({ url }) => url)).toEqual([`${baseUrl}/worker-control/v1/leases`]);
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "OUTCOME_UNKNOWN", provider_execution_id: null });
    expect(await jobStatus(item.jobId)).toBe("NEEDS_ATTENTION");
    expect(provider.dispatches()).toBe(1);
    controlUrlsOnly(baseUrl, processOne, second.fresh);
  });
});

describe("whole-chain crash recovery: durable acceptance converges to SUBMITTED", () => {
  // Process one reaches a durable record, then dies as it starts the live report.
  async function durableThenCrash(options: Readonly<{ rules?: TransportRule[]; journalFault?: JournalFault; expireBeforeAcceptance?: boolean }> = {}) {
    const setup = await scenario();
    const processOne = workerProcess(setup.baseUrl, setup.worker, {
      rules: options.rules ?? [{ suffix: "/submitted", action: "FREEZE_BEFORE_SEND", remaining: 1 }],
      journalFault: options.journalFault ?? "NONE",
    });
    const submitting = await toPermit(processOne);
    const provider = controlledProvider();
    const submission = submitInProcess(processOne, setup.item, submitting, provider);
    await until(() => provider.dispatches() === 1);
    if (options.expireBeforeAcceptance === true) await expireLease(setup.item.attemptId);
    provider.accept(EXECUTION);
    await until(() => processOne.isDead());
    return { ...setup, processOne, submitting, provider, submission };
  }

  it("case 2: a valid temporary left by a crash before the final link is published at restart and recovered to SUBMITTED", async () => {
    const s = await durableThenCrash({ journalFault: "CRASH_AT_FINAL_LINK", rules: [] });
    const temporaries = await recordFiles();
    expect(temporaries).toHaveLength(1);
    expect(temporaries[0]).toMatch(/\.tmp$/);
    const temporaryBytes = await readFile(join(recordsDirectory(), temporaries[0]!));
    expect(Buffer.from(s.processOne.written.at(-1)!).equals(temporaryBytes)).toBe(true);
    // No submitted report was ever sent: the record never became durable in process one.
    expect(s.processOne.requests.some(({ url }) => url.endsWith("/submitted"))).toBe(false);

    await expireLease(s.item.attemptId);
    const second = restart(s.baseUrl, s.worker);
    expect(await second.run).toEqual({ status: "NO_WORK" });
    // Exactly the bytes process one built, published from the temporary; the temporary is gone.
    expect(await recordFiles()).toEqual([`${s.item.attemptId}.json`]);
    expect((await readFile(recordPath(s.item.attemptId))).equals(temporaryBytes)).toBe(true);
    expect(await attemptRow(s.item.attemptId)).toMatchObject({ state: "SUBMITTED", provider_execution_id: EXECUTION, lease_worker_principal_id: null });
    expect(await jobStatus(s.item.jobId)).toBe("RUNNING");
    const trail = await audits(s.item.attemptId);
    expect(countOf(trail, "execution_attempt.outcome_unknown")).toBe(1);
    expect(trail.filter(({ event_type }) => event_type === "execution_attempt.submitted").map(({ metadata }) => metadata.recoveredFromJournal)).toEqual([true]);
    expect(s.provider.dispatches()).toBe(1);
    controlUrlsOnly(s.baseUrl, s.processOne, second.fresh);
    await expectNoSecrets(s.worker, s.submitting, s.item);
  });

  it("case 4A + case 7: durable acceptance with a live lease stays blocked; a crash during the recovery wait restarts with a fresh budget and fails closed", async () => {
    const s = await durableThenCrash();
    const recordBytes = await readFile(recordPath(s.item.attemptId));
    expect(await attemptRow(s.item.attemptId)).toMatchObject({ state: "SUBMITTING" });

    // Restart one observes ATTEMPT_STILL_SUBMITTING, then dies during its first backoff (case 7).
    const restartOne = workerProcess(s.baseUrl, s.worker);
    const crashingSleep: RecoverySleep = (ms, signal) => (signal === undefined ? never<void>() : restartOne.recoveryTime.sleep(ms, signal));
    const runOne = runCredentialOpeningOnce({
      journal: restartOne.journal,
      environment: {},
      client: restartOne.client,
      opener: testOpener,
      monotonicNow: restartOne.recoveryTime.monotonicNow,
      sleep: crashingSleep,
    });
    runOne.catch(() => undefined);
    await until(() => restartOne.requests.length === 1 && restartOne.requests[0]!.status === 409);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    restartOne.crash();
    expect(restartOne.requests.map(({ url }) => url)).toEqual([recoveryUrl(s.baseUrl, s.item.attemptId)]);

    // Restart two: no retry count survived, so the whole bounded budget runs again.
    const restartTwo = restart(s.baseUrl, s.worker);
    const error = await workerFailure(restartTwo.run, [s.submitting.lease.leaseToken, s.worker.credential, EXECUTION]);
    expect(error.code).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(restartTwo.fresh.requests.map(({ url }) => url)).toEqual(Array(18).fill(recoveryUrl(s.baseUrl, s.item.attemptId)));
    expect(restartTwo.fresh.recoveryTime.backoffs).toEqual([1000, 2000, 4000, 8000, ...Array(13).fill(10000)]);
    expect(restartTwo.fresh.recoveryTime.now()).toBe(145000);
    // Worker time declared nothing: still SUBMITTING, the record unchanged, no provider call.
    expect(await attemptRow(s.item.attemptId)).toMatchObject({ state: "SUBMITTING", provider_execution_id: null });
    expect((await readFile(recordPath(s.item.attemptId))).equals(recordBytes)).toBe(true);
    expect(await recordFiles()).toEqual([`${s.item.attemptId}.json`]);
    expect(s.provider.dispatches()).toBe(1);
    expect(countOf(await audits(s.item.attemptId), "execution_attempt.submitted")).toBe(0);
    controlUrlsOnly(s.baseUrl, s.processOne, restartOne, restartTwo.fresh);
  });

  it("case 4B: durable acceptance with an expired lease recovers to SUBMITTED after restart (TX1 sweep, then TX2)", async () => {
    const s = await durableThenCrash();
    const recordBytes = await readFile(recordPath(s.item.attemptId));
    await expireLease(s.item.attemptId);
    const second = restart(s.baseUrl, s.worker);
    expect(await second.run).toEqual({ status: "NO_WORK" });
    expect(second.fresh.requests.map(({ url }) => url)).toEqual([recoveryUrl(s.baseUrl, s.item.attemptId), `${s.baseUrl}/worker-control/v1/leases`]);
    expect(await attemptRow(s.item.attemptId)).toMatchObject({ state: "SUBMITTED", provider_execution_id: EXECUTION, failure_code: null });
    expect(await jobStatus(s.item.jobId)).toBe("RUNNING");
    const trail = await audits(s.item.attemptId);
    expect(countOf(trail, "execution_attempt.outcome_unknown")).toBe(1);
    expect(trail.filter(({ event_type }) => event_type === "execution_attempt.submitted").map(({ metadata }) => metadata.recoveredFromJournal)).toEqual([true]);
    expect((await readFile(recordPath(s.item.attemptId))).equals(recordBytes)).toBe(true);
    expect(s.provider.dispatches()).toBe(1);
    controlUrlsOnly(s.baseUrl, s.processOne, second.fresh);
  });

  it("case 5: a reportSubmitted commit whose response is lost replays the live-epoch SUBMITTED on restart", async () => {
    const s = await durableThenCrash({ rules: [{ suffix: "/submitted", action: "FREEZE_AFTER_COMMIT", remaining: 1 }] });
    // The real server committed: proven from the database, not assumed.
    expect(s.processOne.requests.find(({ url }) => url.endsWith("/submitted"))).toMatchObject({ status: 200, action: "FREEZE_AFTER_COMMIT" });
    expect(await attemptRow(s.item.attemptId)).toMatchObject({ state: "SUBMITTED", provider_execution_id: EXECUTION, lease_worker_principal_id: s.worker.id });
    const recordBytes = await readFile(recordPath(s.item.attemptId));

    const second = restart(s.baseUrl, s.worker);
    // Startup recovery replays the live-epoch SUBMITTED (200); the kept live lease then holds the
    // worker's only slot, so the following lease request is refused at capacity (existing behaviour).
    const error = await workerFailure(second.run, [s.submitting.lease.leaseToken, s.worker.credential]);
    expect(error.code).toBe("LEASE_REJECTED");
    expect(second.fresh.requests.map(({ url, status }) => ({ url, status }))).toEqual([
      { url: recoveryUrl(s.baseUrl, s.item.attemptId), status: 200 },
      { url: `${s.baseUrl}/worker-control/v1/leases`, status: 409 },
    ]);
    expect(second.events.at(-1)).toEqual({ stage: "LEASE", outcome: "FAILED", code: "LEASE_REJECTED" });
    expect(await attemptRow(s.item.attemptId)).toMatchObject({ state: "SUBMITTED", provider_execution_id: EXECUTION });
    // One live-route transition audit; the replay wrote none.
    const trail = await audits(s.item.attemptId);
    expect(trail.filter(({ event_type }) => event_type === "execution_attempt.submitted").map(({ metadata }) => metadata.recoveredFromJournal)).toEqual([undefined]);
    expect(countOf(trail, "execution_attempt.outcome_unknown")).toBe(0);
    expect((await readFile(recordPath(s.item.attemptId))).equals(recordBytes)).toBe(true);
    expect(s.provider.dispatches()).toBe(1);
    controlUrlsOnly(s.baseUrl, s.processOne, second.fresh);
  });

  it.each([
    ["live report unavailable twice", false, [{ suffix: "/submitted", action: "UNAVAILABLE", remaining: 2 }]],
    ["live report refused (409) after authoritative expiry", true, []],
  ] as const)("case 6: %s hands over to recovery; a crash before recovery completes recovers to SUBMITTED at restart", async (_label, expireBeforeAcceptance, liveRules) => {
    const s = await durableThenCrash({
      expireBeforeAcceptance,
      rules: [...liveRules.map((rule) => ({ ...rule })), { suffix: "/acceptance-recovery", action: "FREEZE_BEFORE_SEND", remaining: 1 }],
    });
    const live = s.processOne.requests.filter(({ url }) => url.endsWith("/submitted"));
    if (expireBeforeAcceptance) expect(live.map(({ status }) => status)).toEqual([409]);
    else expect(live.map(({ action }) => action)).toEqual(["UNAVAILABLE", "UNAVAILABLE"]);
    expect(s.processOne.requests.at(-1)).toMatchObject({ url: recoveryUrl(s.baseUrl, s.item.attemptId), action: "FREEZE_BEFORE_SEND" });
    // A 409 is never read as a provider outcome: no submission-failed was sent.
    expect(s.processOne.requests.some(({ url }) => url.endsWith("/submission-failed"))).toBe(false);
    const recordBytes = await readFile(recordPath(s.item.attemptId));

    if (!expireBeforeAcceptance) await expireLease(s.item.attemptId);
    const second = restart(s.baseUrl, s.worker);
    expect(await second.run).toEqual({ status: "NO_WORK" });
    expect(await attemptRow(s.item.attemptId)).toMatchObject({ state: "SUBMITTED", provider_execution_id: EXECUTION });
    expect(await jobStatus(s.item.jobId)).toBe("RUNNING");
    const trail = await audits(s.item.attemptId);
    expect(trail.filter(({ event_type }) => event_type === "execution_attempt.submitted").map(({ metadata }) => metadata.recoveredFromJournal)).toEqual([true]);
    expect((await readFile(recordPath(s.item.attemptId))).equals(recordBytes)).toBe(true);
    expect(s.provider.dispatches()).toBe(1);
    controlUrlsOnly(s.baseUrl, s.processOne, second.fresh);
  });

  it("case 8: an acceptance-recovery commit whose response is lost replays SUBMITTED on restart with one transition", async () => {
    const s = await durableThenCrash({
      expireBeforeAcceptance: true,
      rules: [{ suffix: "/acceptance-recovery", action: "FREEZE_AFTER_COMMIT", remaining: 1 }],
    });
    // The live report was refused by the real control plane, then recovery committed before the crash.
    expect(s.processOne.requests.find(({ url }) => url.endsWith("/submitted"))?.status).toBe(409);
    expect(s.processOne.requests.at(-1)).toMatchObject({ url: recoveryUrl(s.baseUrl, s.item.attemptId), status: 200, action: "FREEZE_AFTER_COMMIT" });
    expect(await attemptRow(s.item.attemptId)).toMatchObject({ state: "SUBMITTED", provider_execution_id: EXECUTION });
    const recordBytes = await readFile(recordPath(s.item.attemptId));

    const second = restart(s.baseUrl, s.worker);
    expect(await second.run).toEqual({ status: "NO_WORK" });
    expect(second.fresh.requests.map(({ url, status }) => ({ url, status }))).toEqual([
      { url: recoveryUrl(s.baseUrl, s.item.attemptId), status: 200 },
      { url: `${s.baseUrl}/worker-control/v1/leases`, status: 200 },
    ]);
    const trail = await audits(s.item.attemptId);
    // Exactly one recovered transition and one expiry, despite the replay.
    expect(countOf(trail, "execution_attempt.submitted")).toBe(1);
    expect(countOf(trail, "execution_attempt.outcome_unknown")).toBe(1);
    expect((await readFile(recordPath(s.item.attemptId))).equals(recordBytes)).toBe(true);
    expect(s.provider.dispatches()).toBe(1);
    controlUrlsOnly(s.baseUrl, s.processOne, second.fresh);
  });
});

describe("whole-chain: heartbeat authority loss and late acceptance (no crash)", () => {
  it.each([
    ["an authoritative heartbeat 409 after database expiry", "REJECTED"],
    ["a control-plane partition followed by database expiry", "PARTITION"],
  ] as const)("case 9: %s does not abandon the late provider acceptance, which recovers to SUBMITTED", async (_label, variant) => {
    const { worker, item, baseUrl } = await scenario();
    const processOne = workerProcess(baseUrl, worker);
    const submitting = await toPermit(processOne);
    // The partition begins only after the mandatory pre-provider heartbeat succeeded.
    if (variant === "PARTITION") processOne.addRule({ suffix: "/heartbeat", action: "UNAVAILABLE", remaining: 2 });
    const heartbeatsBefore = processOne.requests.filter(({ url }) => url.endsWith("/heartbeat")).length;
    const provider = controlledProvider();
    const submission = submitInProcess(processOne, item, submitting, provider);
    await until(() => provider.dispatches() === 1);
    const inFlight = () => processOne.requests.filter(({ url }) => url.endsWith("/heartbeat")).slice(heartbeatsBefore);

    if (variant === "REJECTED") {
      // One real renewal, then the database expires the lease and the next heartbeat is refused.
      processOne.elapseHeartbeatSleep();
      await until(() => inFlight().length === 1 && inFlight()[0]!.status !== undefined);
      expect(inFlight()[0]!.status).toBe(200);
      await until(() => processOne.heartbeatSleeps.length === 2);
      await expireLease(item.attemptId);
      processOne.elapseHeartbeatSleep();
      await until(() => inFlight().length === 2 && inFlight()[1]!.status !== undefined);
      expect(inFlight()[1]!.status).toBe(409);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      // The keeper stopped: no further sleep was scheduled.
      expect(processOne.heartbeatSleeps).toHaveLength(2);
    } else {
      // Both attempts of the tick are unavailable; the keeper keeps its cadence.
      processOne.elapseHeartbeatSleep();
      await until(() => processOne.heartbeatSleeps.length === 2);
      expect(inFlight().map(({ action }) => action)).toEqual(["UNAVAILABLE", "UNAVAILABLE"]);
      await expireLease(item.attemptId);
    }
    expect(processOne.latch.isTripped()).toBe(false);
    expect(submission.settled()).toBeUndefined();

    // The late acceptance: journal, live report refused, recovery (TX1 sweep, TX2).
    provider.accept(EXECUTION);
    await until(() => submission.settled() !== undefined);
    expect(submission.settled()).toEqual({ value: "RECONCILED" });
    expect(processOne.requests.find(({ url }) => url.endsWith("/submitted"))?.status).toBe(409);
    expect(processOne.requests.at(-1)).toMatchObject({ url: recoveryUrl(baseUrl, item.attemptId), status: 200 });
    expect(await attemptRow(item.attemptId)).toMatchObject({ state: "SUBMITTED", provider_execution_id: EXECUTION });
    expect(await recordFiles()).toEqual([`${item.attemptId}.json`]);
    const trail = await audits(item.attemptId);
    expect(countOf(trail, "execution_attempt.outcome_unknown")).toBe(1);
    expect(trail.filter(({ event_type }) => event_type === "execution_attempt.submitted").map(({ metadata }) => metadata.recoveredFromJournal)).toEqual([true]);
    expect(processOne.latch.isTripped()).toBe(false);
    // The keeper joined: no sleep left pending and no request after recovery.
    expect(processOne.heartbeatSleeps.every(({ done }) => done)).toBe(true);
    expect(provider.dispatches()).toBe(1);
    controlUrlsOnly(baseUrl, processOne);
    await expectNoSecrets(worker, submitting, item);
  });
});

describe("whole-chain: retained SUBMITTED record and terminal cleanup", () => {
  // A full in-process run to a recovered SUBMITTED with the record retained.
  async function submittedWithRecord() {
    const setup = await scenario();
    const processOne = workerProcess(setup.baseUrl, setup.worker);
    const submitting = await toPermit(processOne);
    const provider = controlledProvider();
    const submission = submitInProcess(processOne, setup.item, submitting, provider);
    await until(() => provider.dispatches() === 1);
    await expireLease(setup.item.attemptId);
    provider.accept(EXECUTION);
    await until(() => submission.settled() !== undefined);
    expect(submission.settled()).toEqual({ value: "RECONCILED" });
    processOne.crash();
    return { ...setup, provider };
  }

  it("case 10: a SUBMITTED attempt with its retained record replays harmlessly on restart", async () => {
    const s = await submittedWithRecord();
    const recordBytes = await readFile(recordPath(s.item.attemptId));
    const before = await audits(s.item.attemptId);
    for (let restartIndex = 0; restartIndex < 2; restartIndex += 1) {
      const next = restart(s.baseUrl, s.worker);
      expect(await next.run).toEqual({ status: "NO_WORK" });
      expect(next.fresh.requests.map(({ url, status }) => ({ url, status }))).toEqual([
        { url: recoveryUrl(s.baseUrl, s.item.attemptId), status: 200 },
        { url: `${s.baseUrl}/worker-control/v1/leases`, status: 200 },
      ]);
      // A new process starts with a clear latch; nothing of the old one survives.
      expect(next.fresh.latch.isTripped()).toBe(false);
    }
    expect(await attemptRow(s.item.attemptId)).toMatchObject({ state: "SUBMITTED", provider_execution_id: EXECUTION });
    expect((await readFile(recordPath(s.item.attemptId))).equals(recordBytes)).toBe(true);
    expect(await recordFiles()).toEqual([`${s.item.attemptId}.json`]);
    expect(await audits(s.item.attemptId)).toEqual(before);
    expect(s.provider.dispatches()).toBe(1);
  });

  it("case 11: TEST TERMINAL FIXTURE — NOT PROVIDER POLLING removes retained journal at restart", async () => {
    const s = await submittedWithRecord();
    expect(await recordFiles()).toEqual([`${s.item.attemptId}.json`]);
    // TEST TERMINAL FIXTURE — NOT PROVIDER POLLING: a legal SUBMITTED -> ABANDONED
    // operator decision written by the owner role. This proves journal cleanup only.
    await clients.migrator.query("UPDATE execution_attempts SET state = 'ABANDONED', failure_code = 'RECOVERY_ABANDONED', completed_at = now() WHERE id = $1", [
      s.item.attemptId,
    ]);
    const next = restart(s.baseUrl, s.worker);
    expect(await next.run).toEqual({ status: "NO_WORK" });
    expect(next.fresh.requests.map(({ url, status }) => ({ url, status }))).toEqual([
      { url: recoveryUrl(s.baseUrl, s.item.attemptId), status: 200 },
      { url: `${s.baseUrl}/worker-control/v1/leases`, status: 200 },
    ]);
    // The exact record is removed; the terminal state is untouched by recovery.
    expect(await recordFiles()).toEqual([]);
    expect(await attemptRow(s.item.attemptId)).toMatchObject({ state: "ABANDONED", provider_execution_id: EXECUTION });
    expect(s.provider.dispatches()).toBe(1);
  });
});

// The scenario harness imports only node, vitest, worker source, worker test
// support and the commercial-api composition; never a provider module.
describe("whole-chain harness boundary", () => {
  it("imports no provider SDK, engine execution module or provider environment", async () => {
    const source = await readFile(new URL(import.meta.url), "utf8");
    const specifiers = [...source.matchAll(/^import [\s\S]*? from "([^"]+)";$/gm)].map((match) => match[1]!);
    expect(specifiers.length).toBeGreaterThan(10);
    const allowed = (specifier: string) =>
      specifier.startsWith("node:") || specifier === "vitest" || specifier.startsWith("../../src/") || specifier.startsWith("../support/") || specifier.startsWith("../../../commercial-api/");
    expect(specifiers.filter((specifier) => !allowed(specifier))).toEqual([]);
    expect(specifiers.filter((specifier) => specifier.includes("/execution/") || specifier.includes("@"))).toEqual([]);
    expect(source.split(["process", "env"].join(".")).length).toBe(1);
  });
});
