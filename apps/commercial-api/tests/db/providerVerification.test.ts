import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type TransactionalPool } from "../../src/database/runtimePool.js";
import { reconcileProviderVerificationJobs } from "../../src/providerConnections/providerVerificationReconciliationService.js";

import {
  expectSqlError,
  inRolledBackTransaction,
  insertAccountWithFreeGrant,
  openGuardedClients,
  prepareSchemaV1,
  type GuardedClients,
} from "./support/testDatabase.js";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

let clients: GuardedClients;
let pool: TransactionalPool;

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
  const config = loadRuntimeDatabaseConfig(
    {
      COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl,
      COMMERCIAL_API_DATABASE_POOL_MAX: "4",
    },
    "development",
  );
  pool = await createRuntimePool(config!, () => {});
});

afterAll(async () => {
  await pool.end();
  await prepareSchemaV1(clients);
  await clients.close();
});

type Fixture = Readonly<{
  userId: string;
  accountId: string;
  connectionId: string;
  credentialId: string;
  workerId: string;
  jobId: string;
}>;

async function fixture(subject: string): Promise<Fixture> {
  const owner = await insertAccountWithFreeGrant(clients.migrator, subject);

  const connection = await clients.migrator.query<{ id: string }>(
    `INSERT INTO provider_connections
       (account_id, provider, credential_kind, created_by_user_id)
     VALUES ($1, 'EXAMPLE_PROVIDER', 'API_KEY', $2)
     RETURNING id`,
    [owner.accountId, owner.userId],
  );
  const connectionId = connection.rows[0]!.id;

  const credential = await clients.migrator.query<{ id: string }>(
    `INSERT INTO provider_credential_versions
       (account_id, provider_connection_id, credential_version, status,
        sealed_credential, fingerprint_algorithm, fingerprint_key_ref,
        fingerprint_value, created_by_user_id)
     VALUES ($1, $2, 1, 'ACTIVE',
             '{"format":"fixture-envelope"}'::jsonb,
             'HMAC-SHA-256', 'fixture/v1', repeat('a', 43), $3)
     RETURNING id`,
    [owner.accountId, connectionId, owner.userId],
  );
  const credentialId = credential.rows[0]!.id;

  const worker = await clients.migrator.query<{ id: string }>(
    "INSERT INTO worker_principals (label) VALUES ($1) RETURNING id",
    [subject + "-worker"],
  );
  const workerId = worker.rows[0]!.id;

  const job = await clients.migrator.query<{ id: string }>(
    `INSERT INTO provider_verification_jobs
       (account_id, provider_connection_id, provider_credential_version_id,
        verification_policy_id, requested_by_user_id)
     VALUES ($1, $2, $3, 'EXAMPLE_METADATA_V1', $4)
     RETURNING id`,
    [owner.accountId, connectionId, credentialId, owner.userId],
  );

  return {
    userId: owner.userId,
    accountId: owner.accountId,
    connectionId,
    credentialId,
    workerId,
    jobId: job.rows[0]!.id,
  };
}

async function lease(jobId: string, workerId: string): Promise<void> {
  await clients.migrator.query(
    `UPDATE provider_verification_jobs
        SET state = 'LEASED',
            lease_worker_principal_id = $2,
            lease_token_sha256 = repeat('a', 64),
            lease_fencing_counter = 1,
            leased_at = clock_timestamp(),
            lease_expires_at = clock_timestamp() + interval '30 seconds',
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [jobId, workerId],
  );
}

async function shortLease(jobId: string, workerId: string): Promise<void> {
  await clients.migrator.query(
    `UPDATE provider_verification_jobs
        SET state = 'LEASED',
            lease_worker_principal_id = $2,
            lease_token_sha256 = repeat('b', 64),
            lease_fencing_counter = 1,
            leased_at = clock_timestamp(),
            lease_expires_at = clock_timestamp() + interval '750 milliseconds',
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [jobId, workerId],
  );
}

async function waitForShortLeaseExpiry(): Promise<void> {
  await clients.migrator.query("SELECT pg_sleep(0.9)");
}

async function grant(jobId: string): Promise<void> {
  await clients.migrator.query(
    `UPDATE provider_verification_jobs
        SET credential_granted_at = clock_timestamp(),
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [jobId],
  );
}

async function verifying(
  jobId: string,
  workerId: string,
): Promise<void> {
  await clients.migrator.query(
    `UPDATE provider_verification_jobs
        SET state = 'VERIFYING',
            verifying_at = clock_timestamp(),
            verifying_worker_principal_id = $2,
            verifying_fencing_counter = 1,
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [jobId, workerId],
  );
}

type ReconciliationJobRow = Readonly<{
  state: string;
  lease_worker_principal_id: string | null;
  lease_token_sha256: string | null;
  lease_fencing_counter: string | number;
  leased_at: Date | null;
  lease_expires_at: Date | null;
  credential_granted_at: Date | null;
  verifying_at: Date | null;
  verifying_worker_principal_id: string | null;
  verifying_fencing_counter: string | number | null;
  result_outcome: string | null;
  terminal_reason_code: string | null;
  result_worker_principal_id: string | null;
  result_fencing_counter: string | number | null;
  completed_at: Date | null;
}>;

async function reconciliationJob(jobId: string): Promise<ReconciliationJobRow> {
  const result = await clients.migrator.query<ReconciliationJobRow>(
    `SELECT state,
            lease_worker_principal_id,
            lease_token_sha256,
            lease_fencing_counter,
            leased_at,
            lease_expires_at,
            credential_granted_at,
            verifying_at,
            verifying_worker_principal_id,
            verifying_fencing_counter,
            result_outcome,
            terminal_reason_code,
            result_worker_principal_id,
            result_fencing_counter,
            completed_at
       FROM provider_verification_jobs
      WHERE id = $1`,
    [jobId],
  );
  return result.rows[0]!;
}

async function verificationAudits(connectionId: string) {
  const result = await clients.migrator.query<{
    event_type: string;
    actor_type: string;
    correlation_id: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT event_type, actor_type, correlation_id, metadata
       FROM audit_events
      WHERE resource_type = 'provider_connection'
        AND resource_id = $1
        AND event_type IN (
          'provider_connection.verification_inconclusive',
          'provider_connection.verification_result_stale'
        )
      ORDER BY sequence`,
    [connectionId],
  );
  return result.rows;
}

const CLEAR_LEASE = `
  lease_worker_principal_id = NULL,
  lease_token_sha256 = NULL,
  leased_at = NULL,
  lease_expires_at = NULL
`;

describe("provider verification persistence (migration 0010)", () => {
  it("binds the exact credential version to the same account and connection", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const left = await fixture("verification-fk-left");
      const right = await fixture("verification-fk-right");

      await expectSqlError(
        clients.migrator,
        `INSERT INTO provider_verification_jobs
           (account_id, provider_connection_id, provider_credential_version_id,
            verification_policy_id, requested_by_user_id)
         VALUES ($1, $2, $3, 'EXAMPLE_METADATA_V1', $4)`,
        [left.accountId, left.connectionId, right.credentialId, left.userId],
        {
          code: FOREIGN_KEY_VIOLATION,
          constraint:
            "provider_verification_jobs_credential_same_connection_fk",
        },
      );
    });
  });

  it("enforces one open job per exact connection/version and allows a later retry after terminal state", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const value = await fixture("verification-open-unique");

      await expectSqlError(
        clients.migrator,
        `INSERT INTO provider_verification_jobs
           (account_id, provider_connection_id, provider_credential_version_id,
            verification_policy_id, requested_by_user_id)
         VALUES ($1, $2, $3, 'EXAMPLE_METADATA_V1', $4)`,
        [
          value.accountId,
          value.connectionId,
          value.credentialId,
          value.userId,
        ],
        {
          code: UNIQUE_VIOLATION,
          constraint: "provider_verification_jobs_one_open_per_version_uq",
        },
      );

      await clients.migrator.query(
        `UPDATE provider_verification_jobs
            SET state = 'CANCELLED',
                terminal_reason_code = 'LIFECYCLE_NO_LONGER_ELIGIBLE',
                completed_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [value.jobId],
      );

      const retry = await clients.migrator.query<{ id: string }>(
        `INSERT INTO provider_verification_jobs
           (account_id, provider_connection_id, provider_credential_version_id,
            verification_policy_id, requested_by_user_id)
         VALUES ($1, $2, $3, 'EXAMPLE_METADATA_V1', $4)
         RETURNING id`,
        [
          value.accountId,
          value.connectionId,
          value.credentialId,
          value.userId,
        ],
      );

      expect(retry.rowCount).toBe(1);
      expect(retry.rows[0]!.id).not.toBe(value.jobId);
    });
  });

  it("persists VERIFIED terminal history after clearing the current lease", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const value = await fixture("verification-completed");
      await lease(value.jobId, value.workerId);
      await grant(value.jobId);
      await verifying(value.jobId, value.workerId);

      await clients.migrator.query(
        `UPDATE provider_verification_jobs
            SET state = 'COMPLETED',
                ${CLEAR_LEASE},
                result_outcome = 'VERIFIED',
                terminal_reason_code = 'CREDENTIAL_ACCEPTED',
                result_worker_principal_id = $2,
                result_fencing_counter = 1,
                completed_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [value.jobId, value.workerId],
      );

      const result = await clients.migrator.query<{
        state: string;
        credential_granted_at: Date | null;
        leased_at: Date | null;
        verifying_at: Date | null;
        verifying_worker_principal_id: string | null;
        verifying_fencing_counter: string | number | null;
        result_outcome: string | null;
        result_worker_principal_id: string | null;
        result_fencing_counter: string | number | null;
      }>(
        `SELECT state, credential_granted_at, leased_at, verifying_at,
                verifying_worker_principal_id, verifying_fencing_counter,
                result_outcome, result_worker_principal_id,
                result_fencing_counter
           FROM provider_verification_jobs
          WHERE id = $1`,
        [value.jobId],
      );

      expect(result.rows[0]).toMatchObject({
        state: "COMPLETED",
        leased_at: null,
        verifying_worker_principal_id: value.workerId,
        result_outcome: "VERIFIED",
        result_worker_principal_id: value.workerId,
      });
      expect(result.rows[0]!.credential_granted_at).not.toBeNull();
      expect(result.rows[0]!.verifying_at).not.toBeNull();
      expect(Number(result.rows[0]!.verifying_fencing_counter)).toBe(1);
      expect(Number(result.rows[0]!.result_fencing_counter)).toBe(1);
    });
  });

  it("permits only the locked LEASED -> COMPLETED worker-loss convergence after credential grant", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const value = await fixture("verification-worker-loss");
      await lease(value.jobId, value.workerId);
      await grant(value.jobId);

      await clients.migrator.query(
        `UPDATE provider_verification_jobs
            SET state = 'COMPLETED',
                ${CLEAR_LEASE},
                result_outcome = 'INCONCLUSIVE',
                terminal_reason_code = 'WORKER_LOST_AFTER_CREDENTIAL_GRANT',
                result_worker_principal_id = $2,
                result_fencing_counter = 1,
                completed_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [value.jobId, value.workerId],
      );

      const result = await clients.migrator.query<{
        state: string;
        result_outcome: string;
        terminal_reason_code: string;
        verifying_at: Date | null;
      }>(
        `SELECT state, result_outcome, terminal_reason_code, verifying_at
           FROM provider_verification_jobs
          WHERE id = $1`,
        [value.jobId],
      );

      expect(result.rows).toEqual([
        {
          state: "COMPLETED",
          result_outcome: "INCONCLUSIVE",
          terminal_reason_code: "WORKER_LOST_AFTER_CREDENTIAL_GRANT",
          verifying_at: null,
        },
      ]);
    });
  });

  it("rejects a provider-derived VERIFIED completion before the VERIFYING barrier", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const value = await fixture("verification-no-barrier");
      await lease(value.jobId, value.workerId);
      await grant(value.jobId);

      await expectSqlError(
        clients.migrator,
        `UPDATE provider_verification_jobs
            SET state = 'COMPLETED',
                ${CLEAR_LEASE},
                result_outcome = 'VERIFIED',
                terminal_reason_code = 'CREDENTIAL_ACCEPTED',
                result_worker_principal_id = $2,
                result_fencing_counter = 1,
                completed_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [value.jobId, value.workerId],
        { code: CHECK_VIOLATION },
      );
    });
  });

  it("makes terminal lifecycle and immutable provenance write-once", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const value = await fixture("verification-immutability");

      await clients.migrator.query(
        `UPDATE provider_verification_jobs
            SET state = 'CANCELLED',
                terminal_reason_code = 'LIFECYCLE_NO_LONGER_ELIGIBLE',
                completed_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [value.jobId],
      );

      await expectSqlError(
        clients.migrator,
        "UPDATE provider_verification_jobs SET verification_policy_id = 'OTHER_POLICY' WHERE id = $1",
        [value.jobId],
        { code: CHECK_VIOLATION },
      );

      await expectSqlError(
        clients.migrator,
        "UPDATE provider_verification_jobs SET updated_at = clock_timestamp() WHERE id = $1",
        [value.jobId],
        { code: CHECK_VIOLATION },
      );
    });
  });

  it("requeues an eligible expired LEASED job before credential grant without audit", async () => {
    await prepareSchemaV1(clients);

    const value = await fixture(
      `verification-reconcile-pregrant-${randomUUID()}`,
    );
    await shortLease(value.jobId, value.workerId);
    await waitForShortLeaseExpiry();

    const correlationId = randomUUID();
    const pass = await reconcileProviderVerificationJobs(pool, {
      correlationId,
    });

    expect(pass).toEqual({
      cancelledJobs: 0,
      requeuedJobs: 1,
      completedJobs: 0,
    });

    const job = await reconciliationJob(value.jobId);
    expect(job).toMatchObject({
      state: "QUEUED",
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      credential_granted_at: null,
      verifying_at: null,
      verifying_worker_principal_id: null,
      verifying_fencing_counter: null,
      result_outcome: null,
      terminal_reason_code: null,
      result_worker_principal_id: null,
      result_fencing_counter: null,
      completed_at: null,
    });
    expect(Number(job.lease_fencing_counter)).toBe(1);
    expect(await verificationAudits(value.connectionId)).toEqual([]);

    const replay = await reconcileProviderVerificationJobs(pool, {
      correlationId: randomUUID(),
    });
    expect(replay).toEqual({
      cancelledJobs: 0,
      requeuedJobs: 0,
      completedJobs: 0,
    });
  });

  it("completes an eligible expired LEASED job after credential grant with exact provenance and one audit", async () => {
    await prepareSchemaV1(clients);

    const value = await fixture(
      `verification-reconcile-postgrant-${randomUUID()}`,
    );
    await shortLease(value.jobId, value.workerId);
    await grant(value.jobId);

    const connectionBefore = await clients.migrator.query<{
      status: string;
      verification_status: string;
      last_verification_attempt_at: Date | null;
      verified_at: Date | null;
    }>(
      `SELECT status, verification_status,
              last_verification_attempt_at, verified_at
         FROM provider_connections
        WHERE id = $1`,
      [value.connectionId],
    );

    await waitForShortLeaseExpiry();

    const correlationId = randomUUID();
    const pass = await reconcileProviderVerificationJobs(pool, {
      correlationId,
    });

    expect(pass).toEqual({
      cancelledJobs: 0,
      requeuedJobs: 0,
      completedJobs: 1,
    });

    const job = await reconciliationJob(value.jobId);
    expect(job).toMatchObject({
      state: "COMPLETED",
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      verifying_at: null,
      verifying_worker_principal_id: null,
      verifying_fencing_counter: null,
      result_outcome: "INCONCLUSIVE",
      terminal_reason_code: "WORKER_LOST_AFTER_CREDENTIAL_GRANT",
      result_worker_principal_id: value.workerId,
    });
    expect(job.credential_granted_at).not.toBeNull();
    expect(job.completed_at).not.toBeNull();
    expect(Number(job.lease_fencing_counter)).toBe(1);
    expect(Number(job.result_fencing_counter)).toBe(1);

    const connectionAfter = await clients.migrator.query<{
      status: string;
      verification_status: string;
      last_verification_attempt_at: Date | null;
      verified_at: Date | null;
    }>(
      `SELECT status, verification_status,
              last_verification_attempt_at, verified_at
         FROM provider_connections
        WHERE id = $1`,
      [value.connectionId],
    );
    expect(connectionAfter.rows).toEqual(connectionBefore.rows);

    const audits = await verificationAudits(value.connectionId);
    expect(audits).toEqual([
      {
        event_type: "provider_connection.verification_inconclusive",
        actor_type: "SYSTEM",
        correlation_id: correlationId,
        metadata: {
          provider: "EXAMPLE_PROVIDER",
          credentialVersion: 1,
          verificationJobId: value.jobId,
          verificationPolicyId: "EXAMPLE_METADATA_V1",
          outcome: "INCONCLUSIVE",
          reasonCode: "WORKER_LOST_AFTER_CREDENTIAL_GRANT",
        },
      },
    ]);

    const replay = await reconcileProviderVerificationJobs(pool, {
      correlationId: randomUUID(),
    });
    expect(replay).toEqual({
      cancelledJobs: 0,
      requeuedJobs: 0,
      completedJobs: 0,
    });
    expect(await verificationAudits(value.connectionId)).toEqual(audits);
  });

  it("completes an expired VERIFYING job as current even if the account becomes disabled after the barrier", async () => {
    await prepareSchemaV1(clients);

    const value = await fixture(
      `verification-reconcile-verifying-current-${randomUUID()}`,
    );
    await shortLease(value.jobId, value.workerId);
    await grant(value.jobId);
    await verifying(value.jobId, value.workerId);

    await clients.migrator.query(
      `UPDATE accounts
          SET status = 'DISABLED',
              disabled_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [value.accountId],
    );

    const connectionBefore = await clients.migrator.query<{
      status: string;
      verification_status: string;
      last_verification_attempt_at: Date | null;
      verified_at: Date | null;
    }>(
      `SELECT status, verification_status,
              last_verification_attempt_at, verified_at
         FROM provider_connections
        WHERE id = $1`,
      [value.connectionId],
    );

    await waitForShortLeaseExpiry();

    const correlationId = randomUUID();
    const pass = await reconcileProviderVerificationJobs(pool, {
      correlationId,
    });

    expect(pass).toEqual({
      cancelledJobs: 0,
      requeuedJobs: 0,
      completedJobs: 1,
    });

    const job = await reconciliationJob(value.jobId);
    expect(job).toMatchObject({
      state: "COMPLETED",
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      result_outcome: "INCONCLUSIVE",
      terminal_reason_code: "WORKER_LOST_DURING_VERIFYING",
      result_worker_principal_id: value.workerId,
    });
    expect(job.credential_granted_at).not.toBeNull();
    expect(job.verifying_at).not.toBeNull();
    expect(job.verifying_worker_principal_id).toBe(value.workerId);
    expect(Number(job.lease_fencing_counter)).toBe(1);
    expect(Number(job.verifying_fencing_counter)).toBe(1);
    expect(Number(job.result_fencing_counter)).toBe(1);
    expect(job.completed_at).not.toBeNull();

    const connectionAfter = await clients.migrator.query<{
      status: string;
      verification_status: string;
      last_verification_attempt_at: Date | null;
      verified_at: Date | null;
    }>(
      `SELECT status, verification_status,
              last_verification_attempt_at, verified_at
         FROM provider_connections
        WHERE id = $1`,
      [value.connectionId],
    );
    expect(connectionAfter.rows).toEqual(connectionBefore.rows);

    const audits = await verificationAudits(value.connectionId);
    expect(audits).toEqual([
      {
        event_type: "provider_connection.verification_inconclusive",
        actor_type: "SYSTEM",
        correlation_id: correlationId,
        metadata: {
          provider: "EXAMPLE_PROVIDER",
          credentialVersion: 1,
          verificationJobId: value.jobId,
          verificationPolicyId: "EXAMPLE_METADATA_V1",
          outcome: "INCONCLUSIVE",
          reasonCode: "WORKER_LOST_DURING_VERIFYING",
        },
      },
    ]);

    const replay = await reconcileProviderVerificationJobs(pool, {
      correlationId: randomUUID(),
    });
    expect(replay).toEqual({
      cancelledJobs: 0,
      requeuedJobs: 0,
      completedJobs: 0,
    });
    expect(await verificationAudits(value.connectionId)).toEqual(audits);
  });

  it("completes an expired VERIFYING job as stale when its credential version is superseded after the barrier", async () => {
    await prepareSchemaV1(clients);

    const value = await fixture(
      `verification-reconcile-verifying-stale-${randomUUID()}`,
    );
    await shortLease(value.jobId, value.workerId);
    await grant(value.jobId);
    await verifying(value.jobId, value.workerId);

    await clients.migrator.query(
      `UPDATE provider_credential_versions
          SET status = 'SUPERSEDED',
              superseded_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [value.credentialId],
    );

    await clients.migrator.query(
      `INSERT INTO provider_credential_versions (
         account_id,
         provider_connection_id,
         credential_version,
         status,
         sealed_credential,
         fingerprint_algorithm,
         fingerprint_key_ref,
         fingerprint_value,
         created_by_user_id
       ) VALUES (
         $1,
         $2,
         2,
         'ACTIVE',
         '{"format":"fixture-envelope"}'::jsonb,
         'HMAC-SHA-256',
         'fixture/v2',
         repeat('c', 43),
         $3
       )`,
      [value.accountId, value.connectionId, value.userId],
    );

    const connectionBefore = await clients.migrator.query<{
      status: string;
      verification_status: string;
      last_verification_attempt_at: Date | null;
      verified_at: Date | null;
    }>(
      `SELECT status, verification_status,
              last_verification_attempt_at, verified_at
         FROM provider_connections
        WHERE id = $1`,
      [value.connectionId],
    );

    await waitForShortLeaseExpiry();

    const correlationId = randomUUID();
    const pass = await reconcileProviderVerificationJobs(pool, {
      correlationId,
    });

    expect(pass).toEqual({
      cancelledJobs: 0,
      requeuedJobs: 0,
      completedJobs: 1,
    });

    const job = await reconciliationJob(value.jobId);
    expect(job).toMatchObject({
      state: "COMPLETED",
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      result_outcome: "INCONCLUSIVE",
      terminal_reason_code: "WORKER_LOST_DURING_VERIFYING",
      result_worker_principal_id: value.workerId,
    });
    expect(job.credential_granted_at).not.toBeNull();
    expect(job.verifying_at).not.toBeNull();
    expect(job.verifying_worker_principal_id).toBe(value.workerId);
    expect(Number(job.lease_fencing_counter)).toBe(1);
    expect(Number(job.verifying_fencing_counter)).toBe(1);
    expect(Number(job.result_fencing_counter)).toBe(1);
    expect(job.completed_at).not.toBeNull();

    const connectionAfter = await clients.migrator.query<{
      status: string;
      verification_status: string;
      last_verification_attempt_at: Date | null;
      verified_at: Date | null;
    }>(
      `SELECT status, verification_status,
              last_verification_attempt_at, verified_at
         FROM provider_connections
        WHERE id = $1`,
      [value.connectionId],
    );
    expect(connectionAfter.rows).toEqual(connectionBefore.rows);

    const audits = await verificationAudits(value.connectionId);
    expect(audits).toEqual([
      {
        event_type: "provider_connection.verification_result_stale",
        actor_type: "SYSTEM",
        correlation_id: correlationId,
        metadata: {
          provider: "EXAMPLE_PROVIDER",
          credentialVersion: 1,
          verificationJobId: value.jobId,
          verificationPolicyId: "EXAMPLE_METADATA_V1",
          outcome: "INCONCLUSIVE",
          reasonCode: "WORKER_LOST_DURING_VERIFYING",
        },
      },
    ]);

    const replay = await reconcileProviderVerificationJobs(pool, {
      correlationId: randomUUID(),
    });
    expect(replay).toEqual({
      cancelledJobs: 0,
      requeuedJobs: 0,
      completedJobs: 0,
    });
    expect(await verificationAudits(value.connectionId)).toEqual(audits);
  });

  it("cancels an expired LEASED job after credential grant when lifecycle becomes ineligible before VERIFYING", async () => {
    await prepareSchemaV1(clients);

    const value = await fixture(
      `verification-reconcile-cancel-precedence-${randomUUID()}`,
    );
    await shortLease(value.jobId, value.workerId);
    await grant(value.jobId);

    await clients.migrator.query(
      `UPDATE accounts
          SET status = 'DISABLED',
              disabled_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [value.accountId],
    );

    await waitForShortLeaseExpiry();

    const pass = await reconcileProviderVerificationJobs(pool, {
      correlationId: randomUUID(),
    });

    expect(pass).toEqual({
      cancelledJobs: 1,
      requeuedJobs: 0,
      completedJobs: 0,
    });

    const job = await reconciliationJob(value.jobId);
    expect(job).toMatchObject({
      state: "CANCELLED",
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      verifying_at: null,
      verifying_worker_principal_id: null,
      verifying_fencing_counter: null,
      result_outcome: null,
      terminal_reason_code: "LIFECYCLE_NO_LONGER_ELIGIBLE",
      result_worker_principal_id: null,
      result_fencing_counter: null,
    });
    expect(job.credential_granted_at).not.toBeNull();
    expect(job.completed_at).not.toBeNull();
    expect(Number(job.lease_fencing_counter)).toBe(1);
    expect(await verificationAudits(value.connectionId)).toEqual([]);

    const replay = await reconcileProviderVerificationJobs(pool, {
      correlationId: randomUUID(),
    });
    expect(replay).toEqual({
      cancelledJobs: 0,
      requeuedJobs: 0,
      completedJobs: 0,
    });
    expect(await verificationAudits(value.connectionId)).toEqual([]);
  });

  it("cancels a QUEUED job whose account becomes ineligible, without lease, grant, result or audit", async () => {
    await prepareSchemaV1(clients);

    const value = await fixture(
      `verification-reconcile-queued-cancel-${randomUUID()}`,
    );
    await disableAccount(value.accountId);

    const pass = await reconcileProviderVerificationJobs(pool, {
      correlationId: randomUUID(),
    });

    expect(pass).toEqual({
      cancelledJobs: 1,
      requeuedJobs: 0,
      completedJobs: 0,
    });

    const job = await reconciliationJob(value.jobId);
    expect(job).toMatchObject({
      state: "CANCELLED",
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      credential_granted_at: null,
      verifying_at: null,
      verifying_worker_principal_id: null,
      verifying_fencing_counter: null,
      result_outcome: null,
      terminal_reason_code: "LIFECYCLE_NO_LONGER_ELIGIBLE",
      result_worker_principal_id: null,
      result_fencing_counter: null,
    });
    expect(Number(job.lease_fencing_counter)).toBe(0);
    expect(job.completed_at).not.toBeNull();
    expect(await verificationAudits(value.connectionId)).toEqual([]);

    const replay = await reconcileProviderVerificationJobs(pool, {
      correlationId: randomUUID(),
    });
    expect(replay).toEqual({
      cancelledJobs: 0,
      requeuedJobs: 0,
      completedJobs: 0,
    });
    expect(await reconciliationJob(value.jobId)).toEqual(job);
    expect(await verificationAudits(value.connectionId)).toEqual([]);
  });

  it("transitions at most batchSize actionable jobs per service pass", async () => {
    await prepareSchemaV1(clients);

    const first = await fixture(
      `verification-reconcile-batch-a-${randomUUID()}`,
    );
    const second = await fixture(
      `verification-reconcile-batch-b-${randomUUID()}`,
    );
    await disableAccount(first.accountId);
    await disableAccount(second.accountId);

    const jobIds = [first.jobId, second.jobId];

    const firstPass = await reconcileProviderVerificationJobs(pool, {
      correlationId: randomUUID(),
      batchSize: 1,
    });
    expect(firstPass).toEqual({
      cancelledJobs: 1,
      requeuedJobs: 0,
      completedJobs: 0,
    });
    // Aggregate only: which of the two is chosen first is not part of the contract.
    expect(await jobStateCounts(jobIds)).toEqual({ CANCELLED: 1, QUEUED: 1 });

    const secondPass = await reconcileProviderVerificationJobs(pool, {
      correlationId: randomUUID(),
      batchSize: 1,
    });
    expect(secondPass).toEqual({
      cancelledJobs: 1,
      requeuedJobs: 0,
      completedJobs: 0,
    });
    expect(await jobStateCounts(jobIds)).toEqual({ CANCELLED: 2 });

    const replay = await reconcileProviderVerificationJobs(pool, {
      correlationId: randomUUID(),
      batchSize: 1,
    });
    expect(replay).toEqual({
      cancelledJobs: 0,
      requeuedJobs: 0,
      completedJobs: 0,
    });
  });

  it("terminalizes a worker-lost job exactly once under concurrent reconciliation passes", async () => {
    await prepareSchemaV1(clients);

    const value = await fixture(
      `verification-reconcile-concurrent-${randomUUID()}`,
    );
    await shortLease(value.jobId, value.workerId);
    await grant(value.jobId);
    await waitForShortLeaseExpiry();

    const correlationIds = [randomUUID(), randomUUID()] as const;
    const passes = await Promise.all(
      correlationIds.map((correlationId) =>
        reconcileProviderVerificationJobs(pool, { correlationId }),
      ),
    );

    expect(passes.reduce((sum, pass) => sum + pass.cancelledJobs, 0)).toBe(0);
    expect(passes.reduce((sum, pass) => sum + pass.requeuedJobs, 0)).toBe(0);
    expect(passes.reduce((sum, pass) => sum + pass.completedJobs, 0)).toBe(1);

    const winner = passes.findIndex((pass) => pass.completedJobs === 1);

    const job = await reconciliationJob(value.jobId);
    expect(job).toMatchObject({
      state: "COMPLETED",
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      verifying_at: null,
      verifying_worker_principal_id: null,
      verifying_fencing_counter: null,
      result_outcome: "INCONCLUSIVE",
      terminal_reason_code: "WORKER_LOST_AFTER_CREDENTIAL_GRANT",
      result_worker_principal_id: value.workerId,
    });
    expect(job.credential_granted_at).not.toBeNull();
    expect(job.completed_at).not.toBeNull();
    expect(Number(job.lease_fencing_counter)).toBe(1);
    expect(Number(job.result_fencing_counter)).toBe(1);

    const audits = await verificationAudits(value.connectionId);
    expect(audits).toEqual([
      {
        event_type: "provider_connection.verification_inconclusive",
        actor_type: "SYSTEM",
        correlation_id: correlationIds[winner],
        metadata: {
          provider: "EXAMPLE_PROVIDER",
          credentialVersion: 1,
          verificationJobId: value.jobId,
          verificationPolicyId: "EXAMPLE_METADATA_V1",
          outcome: "INCONCLUSIVE",
          reasonCode: "WORKER_LOST_AFTER_CREDENTIAL_GRANT",
        },
      },
    ]);

    const replay = await reconcileProviderVerificationJobs(pool, {
      correlationId: randomUUID(),
    });
    expect(replay).toEqual({
      cancelledJobs: 0,
      requeuedJobs: 0,
      completedJobs: 0,
    });
    expect(await reconciliationJob(value.jobId)).toEqual(job);
    expect(await verificationAudits(value.connectionId)).toEqual(audits);
  });
});

async function disableAccount(accountId: string): Promise<void> {
  await clients.migrator.query(
    `UPDATE accounts
        SET status = 'DISABLED',
            disabled_at = clock_timestamp(),
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [accountId],
  );
}

async function jobStateCounts(jobIds: readonly string[]): Promise<Record<string, number>> {
  const result = await clients.migrator.query<{ state: string; count: number }>(
    `SELECT state, count(*)::int AS count
       FROM provider_verification_jobs
      WHERE id = ANY($1::uuid[])
      GROUP BY state`,
    [jobIds],
  );
  return Object.fromEntries(result.rows.map((row) => [row.state, row.count]));
}
