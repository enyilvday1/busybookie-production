import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../../commercial-api/src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type TransactionalPool } from "../../../commercial-api/src/database/runtimePool.js";
import { disconnectProviderConnection } from "../../../commercial-api/src/providerConnections/providerConnectionService.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../../commercial-api/src/startCommercialApiServer.js";
import { createWorkerControlApplication } from "../../../commercial-api/src/workerControl/workerControlApplication.js";
import { insertAccountWithFreeGrant, openGuardedClients, prepareSchemaV1, type GuardedClients } from "../../../commercial-api/tests/db/support/testDatabase.js";
import { createTestWorkerAuthenticationAdapter } from "../../../commercial-api/tests/support/testWorkerAuthentication.js";
import { createRecordingWorkerSecurityEventSink } from "../../../commercial-api/tests/support/testWorkerSecurityEvents.js";
import { createAcceptanceJournal } from "../../src/acceptanceJournal.js";
import type { CredentialOpener } from "../../src/credentialContracts.js";
import { runCredentialOpeningOnce, type CredentialOpeningClient, type WorkerLogEvent } from "../../src/credentialOpeningRun.js";
import { createHttpWorkerControlClient } from "../../src/workerControlClient.js";
import { WorkerError } from "../../src/workerError.js";
import { createTestCredentialFingerprinter, createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "../support/testCredentialOpening.js";

// End to end: the private worker's real HTTP client and opening run against
// the real commercial-api worker-control router (explicitly composed here,
// never by default), PostgreSQL 16 on 127.0.0.1:5433, the test worker
// authentication adapter, a recording security sink and the test credential
// crypto. Credentials are generated fixtures; checks on them are booleans.

let clients: GuardedClients;
let pool: TransactionalPool;
let server: RunningCommercialApiServer | undefined;

const encryptionKey = generateTestKey("worker-e2e-encryption/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("worker-e2e-fingerprint/v1"), encryptionKey);
const testOpener = createTestCredentialOpener(encryptionKey);

beforeAll(async () => {
  clients = await openGuardedClients();
  const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: "6" }, "development");
  pool = await createRuntimePool(config!, () => {});
});
beforeEach(async () => {
  await prepareSchemaV1(clients);
});
afterEach(async () => {
  await server?.close();
  server = undefined;
});
afterAll(async () => {
  await pool.end();
  await prepareSchemaV1(clients);
  await clients.close();
});

// ---------------------------------------------------------------------------
// Fixtures (committed by the commercial-api owner role)

type Work = Readonly<{ userId: string; accountId: string; connectionId: string; versionId: string; attemptId: string; jobId: string; plaintext: string }>;

const q = <T extends object>(sql: string, params: unknown[]) => clients.migrator.query<T>(sql, params).then((result) => result.rows[0]!);

async function work(options: Readonly<{ rotateToV2?: boolean }> = {}): Promise<Work & { v2Plaintext?: string }> {
  const provider = "EXAMPLE_PROVIDER";
  const owner = await insertAccountWithFreeGrant(clients.migrator, `worker-e2e-${randomUUID()}`);
  const production = await q<{ id: string }>(
    "INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id) VALUES ($1, 'Production', $2, $3) RETURNING id",
    [owner.accountId, owner.grantId, owner.userId],
  );
  const connection = await q<{ id: string }>(
    "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, $2, 'API_KEY', $3) RETURNING id",
    [owner.accountId, provider, owner.userId],
  );
  const version = async (credentialVersion: number) => {
    const plaintext = `fixture-credential-${randomBytes(18).toString("hex")}`;
    const envelope = await sealer.seal(plaintext, { accountId: owner.accountId, providerConnectionId: connection.id, provider, credentialVersion, purpose: "provider-credential" });
    const fingerprint = await fingerprinter.fingerprint(plaintext);
    const row = await q<{ id: string }>(
      `INSERT INTO provider_credential_versions (account_id, provider_connection_id, credential_version, sealed_credential, fingerprint_algorithm,
                                                 fingerprint_key_ref, fingerprint_value, created_by_user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) RETURNING id`,
      [owner.accountId, connection.id, credentialVersion, JSON.stringify(envelope), fingerprint.algorithm, fingerprint.keyRef, fingerprint.value, owner.userId],
    );
    return { id: row.id, plaintext };
  };
  const v1 = await version(1);
  const authorization = await q<{ id: string }>(
    `INSERT INTO generation_authorizations
       (account_id, production_id, entitlement_grant_id, billing_mode, provider, model, provider_connection_id,
        provider_credential_version_id, generation_request, generation_request_sha256, expected_cost_cap_unit,
        expected_cost_cap_amount, expires_at, created_by_user_id)
     VALUES ($1, $2, $3, 'USER_BYO', $4, 'example-model-1', $5, $6, '{"prompt":"fixture"}'::jsonb, repeat('c', 64),
             'MICRO_USD', 2000000, now() + interval '15 minutes', $7) RETURNING id`,
    [owner.accountId, production.id, owner.grantId, provider, connection.id, v1.id, owner.userId],
  );
  await clients.migrator.query("UPDATE generation_authorizations SET status = 'CLAIMED', claimed_at = now() WHERE id = $1", [authorization.id]);
  const job = await q<{ id: string }>(
    "INSERT INTO execution_jobs (account_id, production_id, generation_authorization_id) VALUES ($1, $2, $3) RETURNING id",
    [owner.accountId, production.id, authorization.id],
  );
  const attempt = await q<{ id: string }>(
    `INSERT INTO execution_attempts (account_id, execution_job_id, generation_authorization_id, attempt_number, billing_mode, provider, provider_credential_version_id)
     VALUES ($1, $2, $3, 1, 'USER_BYO', $4, $5) RETURNING id`,
    [owner.accountId, job.id, authorization.id, provider, v1.id],
  );
  let v2Plaintext: string | undefined;
  if (options.rotateToV2 === true) {
    await clients.migrator.query("UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now() WHERE id = $1", [v1.id]);
    v2Plaintext = (await version(2)).plaintext;
  }
  return {
    userId: owner.userId,
    accountId: owner.accountId,
    connectionId: connection.id,
    versionId: v1.id,
    attemptId: attempt.id,
    jobId: job.id,
    plaintext: v1.plaintext,
    ...(v2Plaintext === undefined ? {} : { v2Plaintext }),
  };
}

type Machine = Readonly<{ id: string; credential: string }>;

async function machine(): Promise<Machine> {
  const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ('e2e-worker') RETURNING id")).rows[0]!.id;
  return { id, credential: `fixture-machine-${randomBytes(16).toString("hex")}` };
}

async function controlPlane(workers: readonly Machine[]) {
  const recording = createRecordingWorkerSecurityEventSink();
  const application = createWorkerControlApplication({
    authentication: createTestWorkerAuthenticationAdapter(workers.map((worker) => ({ token: worker.credential, workerPrincipalId: worker.id }))),
    securityEvents: recording.sink,
    pool,
    reportFailure: () => {},
  });
  server = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
  return { baseUrl: `http://127.0.0.1:${server.port}`, recording };
}

// The real HTTP client, with every outbound URL recorded.
function workerClient(baseUrl: string, worker: Machine) {
  const urls: string[] = [];
  const client = createHttpWorkerControlClient({
    baseUrl,
    machineCredential: worker.credential,
    fetchImpl: (async (input: URL | string, init?: RequestInit) => {
      urls.push(String(input));
      return fetch(input, init);
    }) as typeof fetch,
  });
  return { client, urls };
}

function recordingOpener(expectedPlaintext: string) {
  const seen = { opened: 0, matched: false };
  const opener: CredentialOpener = {
    open: async (envelope, context) => {
      seen.opened += 1;
      const plaintext = await testOpener.open(envelope, context);
      seen.matched = plaintext === expectedPlaintext;
      return plaintext;
    },
  };
  return { opener, seen };
}

const attemptRow = async (id: string) =>
  (
    await clients.migrator.query<{ state: string; credential_granted_at: Date | null; submitting_at: Date | null; provider_execution_id: string | null }>(
      "SELECT state, credential_granted_at, submitting_at, provider_execution_id FROM execution_attempts WHERE id = $1",
      [id],
    )
  ).rows[0]!;
const disconnect = (item: Work) => disconnectProviderConnection({ pool }, { userId: item.userId, accountId: item.accountId }, item.connectionId);

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

// ---------------------------------------------------------------------------

describe("private worker credential opening, end to end", () => {
  it("leases, obtains the exact grant, opens it in memory, and stops at LEASED", async () => {
    const worker = await machine();
    const item = await work();
    const { baseUrl, recording } = await controlPlane([worker]);
    const { client, urls } = workerClient(baseUrl, worker);
    const { opener, seen } = recordingOpener(item.plaintext);
    const events: WorkerLogEvent[] = [];

    const result = await runCredentialOpeningOnce({ environment: { PATH: "/usr/bin" }, client, opener, log: (event) => events.push(event) });

    expect(result).toEqual({
      status: "CREDENTIAL_OPENED",
      executionJobId: item.jobId,
      executionAttemptId: item.attemptId,
      provider: "EXAMPLE_PROVIDER",
      fencingCounter: 1,
      credentialOpened: true,
    });
    expect(seen).toEqual({ opened: 1, matched: true });
    const row = await attemptRow(item.attemptId);
    expect(row.state).toBe("LEASED");
    expect(row.credential_granted_at).not.toBeNull();
    expect(row.submitting_at).toBeNull();
    expect(row.provider_execution_id).toBeNull();
    // Only the two worker-control calls left the worker; nothing reached a provider.
    expect(urls).toEqual([`${baseUrl}/worker-control/v1/leases`, `${baseUrl}/worker-control/v1/attempts/${item.attemptId}/credential-grant`]);
    const visible = JSON.stringify(result) + JSON.stringify(events) + JSON.stringify(recording.events);
    expect(visible.includes(item.plaintext) || visible.includes(worker.credential)).toBe(false);
  });

  it("opens the authorization's exact v1 after the connection rotated to v2", async () => {
    const worker = await machine();
    const item = await work({ rotateToV2: true });
    const { baseUrl } = await controlPlane([worker]);
    const { opener, seen } = recordingOpener(item.plaintext);
    let openedV2 = false;
    const watchingOpener: CredentialOpener = {
      open: async (envelope, context) => {
        const plaintext = await opener.open(envelope, context);
        openedV2 = plaintext === item.v2Plaintext;
        return plaintext;
      },
    };
    const result = await runCredentialOpeningOnce({ environment: {}, client: workerClient(baseUrl, worker).client, opener: watchingOpener });
    expect(result.status).toBe("CREDENTIAL_OPENED");
    expect(seen.matched).toBe(true);
    expect(openedV2).toBe(false);
  });

  it("refuses a granted envelope whose context or ciphertext was altered in transit", async () => {
    for (const tamper of ["context", "ciphertext"] as const) {
      await prepareSchemaV1(clients);
      const worker = await machine();
      const item = await work();
      const { baseUrl } = await controlPlane([worker]);
      const real = workerClient(baseUrl, worker).client;
      const client: CredentialOpeningClient = {
        leaseNextAttempt: real.leaseNextAttempt,
        requestCredentialGrant: async (attemptId, proof) => {
          const grant = await real.requestCredentialGrant(attemptId, proof);
          const envelope = grant.sealedEnvelope as Record<string, string>;
          return tamper === "context"
            ? { ...grant, openingContext: { ...(grant.openingContext as object), credentialVersion: 2 } }
            : { ...grant, sealedEnvelope: { ...envelope, tag: envelope.tag!.startsWith("A") ? `B${envelope.tag!.slice(1)}` : `A${envelope.tag!.slice(1)}` } };
        },
      };
      const error = await workerFailure(runCredentialOpeningOnce({ environment: {}, client, opener: testOpener }), [item.plaintext]);
      expect(error.code).toBe("CREDENTIAL_OPEN_FAILED");
      await server!.close();
      server = undefined;
    }
  });

  it("can open a grant replayed after a disconnect, and still performs no provider action", async () => {
    const worker = await machine();
    const item = await work();
    const { baseUrl } = await controlPlane([worker]);
    const real = workerClient(baseUrl, worker);
    let grants = 0;
    const client: CredentialOpeningClient = {
      leaseNextAttempt: real.client.leaseNextAttempt,
      requestCredentialGrant: async (attemptId, proof) => {
        grants += 1;
        await real.client.requestCredentialGrant(attemptId, proof); // committed; response "lost"
        await disconnect(item);
        return real.client.requestCredentialGrant(attemptId, proof); // replay of the committed grant
      },
    };
    const { opener, seen } = recordingOpener(item.plaintext);
    const result = await runCredentialOpeningOnce({ environment: {}, client, opener });
    expect(result.status).toBe("CREDENTIAL_OPENED");
    expect(grants).toBe(1);
    expect(seen).toEqual({ opened: 1, matched: true });
    const version = await clients.migrator.query("SELECT status FROM provider_credential_versions WHERE id = $1", [item.versionId]);
    expect(version.rows).toEqual([{ status: "RETAINED_FOR_RECOVERY" }]);
    const row = await attemptRow(item.attemptId);
    expect(row.state).toBe("LEASED");
    expect(row.submitting_at).toBeNull();
    expect(real.urls.every((url) => url.startsWith(`${baseUrl}/worker-control/v1/`))).toBe(true);
    expect(real.urls.some((url) => /submitting|submission/.test(url))).toBe(false);
  });

  it("receives no envelope when the connection was disconnected before the first grant", async () => {
    const worker = await machine();
    const item = await work();
    const { baseUrl } = await controlPlane([worker]);
    const real = workerClient(baseUrl, worker).client;
    const client: CredentialOpeningClient = {
      leaseNextAttempt: real.leaseNextAttempt,
      requestCredentialGrant: async (attemptId, proof) => {
        await disconnect(item);
        return real.requestCredentialGrant(attemptId, proof);
      },
    };
    const { opener, seen } = recordingOpener(item.plaintext);
    const error = await workerFailure(runCredentialOpeningOnce({ environment: {}, client, opener }), [item.plaintext]);
    expect(error.code).toBe("CREDENTIAL_GRANT_REJECTED");
    expect(seen.opened).toBe(0);
    expect((await attemptRow(item.attemptId)).credential_granted_at).toBeNull();
  });

  it("receives no credential when the worker is disabled after leasing", async () => {
    const worker = await machine();
    const item = await work();
    const { baseUrl } = await controlPlane([worker]);
    const real = workerClient(baseUrl, worker).client;
    const client: CredentialOpeningClient = {
      leaseNextAttempt: real.leaseNextAttempt,
      requestCredentialGrant: async (attemptId, proof) => {
        await clients.migrator.query("UPDATE worker_principals SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [worker.id]);
        return real.requestCredentialGrant(attemptId, proof);
      },
    };
    const { opener, seen } = recordingOpener(item.plaintext);
    const error = await workerFailure(runCredentialOpeningOnce({ environment: {}, client, opener }), [worker.credential]);
    expect(error.code).toBe("WORKER_AUTHENTICATION_REJECTED");
    expect(seen.opened).toBe(0);
    expect((await attemptRow(item.attemptId)).credential_granted_at).toBeNull();
  });

  it("does not continue when the lease expires before the grant", async () => {
    const worker = await machine();
    const item = await work();
    const { baseUrl } = await controlPlane([worker]);
    const real = workerClient(baseUrl, worker).client;
    const client: CredentialOpeningClient = {
      leaseNextAttempt: real.leaseNextAttempt,
      requestCredentialGrant: async (attemptId, proof) => {
        await clients.migrator.query(
          "UPDATE execution_attempts SET leased_at = now() - interval '10 minutes', heartbeat_at = now() - interval '10 minutes', lease_expires_at = now() - interval '1 second' WHERE id = $1",
          [attemptId],
        );
        return real.requestCredentialGrant(attemptId, proof);
      },
    };
    const { opener, seen } = recordingOpener(item.plaintext);
    expect((await workerFailure(runCredentialOpeningOnce({ environment: {}, client, opener }), [])).code).toBe("CREDENTIAL_GRANT_REJECTED");
    expect(seen.opened).toBe(0);
    expect((await attemptRow(item.attemptId)).credential_granted_at).toBeNull();
  });

  it("classifies a failing control-plane security log as unavailable, bounded, with no lease", async () => {
    const worker = await machine();
    const item = await work();
    const { baseUrl, recording } = await controlPlane([worker]);
    recording.setFailing(true);
    // An unrecognised machine credential forces a security event the sink cannot record.
    const stranger = workerClient(baseUrl, { id: worker.id, credential: `fixture-unknown-${randomBytes(8).toString("hex")}` });
    const { opener, seen } = recordingOpener(item.plaintext);
    const error = await workerFailure(runCredentialOpeningOnce({ environment: {}, client: stranger.client, opener }), []);
    expect(error.code).toBe("CONTROL_API_UNAVAILABLE");
    expect(stranger.urls).toEqual([`${baseUrl}/worker-control/v1/leases`, `${baseUrl}/worker-control/v1/leases`]);
    expect(seen.opened).toBe(0);
    expect((await attemptRow(item.attemptId)).state).toBe("QUEUED");
  });

  it("returns NO_WORK when nothing is eligible", async () => {
    const worker = await machine();
    const { baseUrl } = await controlPlane([worker]);
    expect(await runCredentialOpeningOnce({ environment: {}, client: workerClient(baseUrl, worker).client, opener: testOpener })).toEqual({ status: "NO_WORK" });
  });

  it("refuses to start with a provider-global variable present, before contacting the control plane", async () => {
    const worker = await machine();
    await work();
    const { baseUrl } = await controlPlane([worker]);
    const { client, urls } = workerClient(baseUrl, worker);
    for (const name of ["RUNWAYML_API_SECRET", "GEMINI_API_KEY", "GOOGLE_API_KEY"]) {
      const error = await workerFailure(runCredentialOpeningOnce({ environment: { [name]: "sentinel-secret" }, client, opener: testOpener }), ["sentinel-secret"]);
      expect(error.code).toBe("FORBIDDEN_PROVIDER_ENVIRONMENT");
    }
    expect(urls).toEqual([]);
  });
});

// R44B6P: the section 18 ordering, end to end against the real control plane.
// The acceptance is synthetic (no provider exists); the test itself performs
// the steps no worker execution path performs yet: SUBMITTING, then the
// durable journal record, then the submitted report.
describe("durable acceptance journal, then the submitted report, end to end", () => {
  let stateRoot: string;
  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "busybookie-worker-state-"));
  });
  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  // The SUBMITTING barrier, called directly: the worker has no client for it yet.
  async function enterSubmitting(baseUrl: string, worker: Machine, attemptId: string, proof: Readonly<{ fencingCounter: number; leaseToken: string }>) {
    const response = await fetch(`${baseUrl}/worker-control/v1/attempts/${attemptId}/submitting`, {
      method: "POST",
      headers: { Authorization: `Bearer ${worker.credential}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken }),
    });
    expect(response.status).toBe(200);
    return new Date(((await response.json()) as { submittingAt: string }).submittingAt);
  }

  it("journals the acceptance durably before reporting the same provider execution ID, which the control plane records", async () => {
    const worker = await machine();
    const item = await work();
    const { baseUrl, recording } = await controlPlane([worker]);
    const { client, urls } = workerClient(baseUrl, worker);
    const lease = (await client.leaseNextAttempt())!;
    const proof = { fencingCounter: lease.fencingCounter, leaseToken: lease.leaseToken };
    await client.requestCredentialGrant(lease.executionAttemptId, proof);
    const submittingAt = await enterSubmitting(baseUrl, worker, lease.executionAttemptId, proof);

    // 1. Durable journal record first (section 17).
    const journal = createAcceptanceJournal({
      stateRoot,
      directorySync: process.platform === "win32" ? "DEVELOPMENT_BEST_EFFORT" : "REQUIRED",
    });
    await journal.prepare();
    const written = await journal.write({
      executionAttemptId: lease.executionAttemptId,
      executionJobId: lease.executionJobId,
      accountId: item.accountId,
      attemptNumber: lease.attemptNumber,
      fencingCounter: lease.fencingCounter,
      provider: lease.provider,
      generationRequestSha256: lease.generationRequestSha256,
      submittingAt,
      providerExecutionId: "synthetic/operations/op-1",
      providerAcceptedAt: new Date(),
    });
    expect(written.outcome).toBe("PUBLISHED");
    const stored = await journal.read(lease.executionAttemptId, { provider: lease.provider, fencingCounter: lease.fencingCounter });
    expect(stored.status).toBe("VALID_RECORD");

    // 2. Only then the report, with exactly the journalled ID.
    const acknowledgement = await client.reportSubmitted(lease.executionAttemptId, proof, written.record.providerExecutionId);
    expect(acknowledgement).toMatchObject({ executionAttemptId: lease.executionAttemptId, state: "SUBMITTED", providerExecutionId: "synthetic/operations/op-1" });
    const row = await attemptRow(lease.executionAttemptId);
    expect(row).toMatchObject({ state: "SUBMITTED", provider_execution_id: "synthetic/operations/op-1" });

    // Idempotent replay of the same report; a different ID is refused and nothing changes.
    expect(await client.reportSubmitted(lease.executionAttemptId, proof, "synthetic/operations/op-1")).toEqual(acknowledgement);
    const refused = await workerFailure(client.reportSubmitted(lease.executionAttemptId, proof, "synthetic/operations/op-2"), [lease.leaseToken, worker.credential]);
    expect(refused.code).toBe("SUBMITTED_REPORT_REJECTED");
    expect((await attemptRow(lease.executionAttemptId)).provider_execution_id).toBe("synthetic/operations/op-1");
    expect(recording.events.at(-1)).toMatchObject({ type: "WORKER_SUBMITTED_REJECTED", reason: "PROVIDER_EXECUTION_CONFLICT" });

    // Only worker-control calls left the worker (SUBMITTING was sent directly by the test); no provider was reached.
    expect(urls.every((url) => url.startsWith(`${baseUrl}/worker-control/v1/`))).toBe(true);
    // The journal file holds no lease token, machine credential or plaintext.
    const file = await readFile(join(stateRoot, "acceptance-journal", "v1", `${lease.executionAttemptId}.json`), "latin1");
    expect(file.includes(lease.leaseToken) || file.includes(worker.credential) || file.includes(item.plaintext)).toBe(false);
  });

  it("is refused by the control plane when reported before SUBMITTING, so the journal never stands in for the barrier", async () => {
    const worker = await machine();
    await work();
    const { baseUrl } = await controlPlane([worker]);
    const { client } = workerClient(baseUrl, worker);
    const lease = (await client.leaseNextAttempt())!;
    const proof = { fencingCounter: lease.fencingCounter, leaseToken: lease.leaseToken };
    const refused = await workerFailure(client.reportSubmitted(lease.executionAttemptId, proof, "synthetic/operations/op-early"), [lease.leaseToken]);
    expect(refused.code).toBe("SUBMITTED_REPORT_REJECTED");
    expect((await attemptRow(lease.executionAttemptId)).state).toBe("LEASED");
  });
});
