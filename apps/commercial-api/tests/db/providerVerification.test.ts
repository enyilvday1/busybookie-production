import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
});

afterAll(async () => {
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
});
