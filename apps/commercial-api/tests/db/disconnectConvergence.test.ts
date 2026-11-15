import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import {
  createRuntimePool,
  type TransactionalPool,
} from "../../src/database/runtimePool.js";
import {
  convergeDisconnectedProviderConnectionPreSubmission,
  DISCONNECT_CANCELLED_USAGE_EVENT,
  PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE,
} from "../../src/providerConnections/disconnectConvergenceService.js";
import { readCredentialObligations } from "../../src/providerConnections/credentialObligations.js";
import {
  disconnectProviderConnection,
  type TrustedPrincipal,
} from "../../src/providerConnections/providerConnectionService.js";
import {
  insertAccountWithFreeGrant,
  openGuardedClients,
  prepareSchemaV1,
  type GuardedClients,
} from "./support/testDatabase.js";

// R44B11E Phase A/B disconnect convergence against the real PostgreSQL 16
// test database. Customer disconnect commits first. Convergence then runs as
// an internal SYSTEM operation through the restricted runtime role.

let clients: GuardedClients;
let pool: TransactionalPool;
let workerPrincipalId: string;

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

  workerPrincipalId = (
    await clients.migrator.query<{ id: string }>(
      "INSERT INTO worker_principals (label) VALUES ('r44b11e-fixture-worker') RETURNING id",
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  await pool.end();
  await prepareSchemaV1(clients);
  await clients.close();
});

type Fixture = Readonly<{
  principal: TrustedPrincipal;
  accountId: string;
  productionId: string;
  grantId: string;
  connectionId: string;
  versionId: string;
  authorizationId: string;
}>;

type ClaimedFixture = Fixture &
  Readonly<{
    jobId: string;
    attemptId: string;
  }>;

let counter = 0;

async function fixture(label: string): Promise<Fixture> {
  counter += 1;

  const owner = await insertAccountWithFreeGrant(
    clients.migrator,
    `r44b11e-${label}-${counter}-${randomUUID()}`,
  );

  const production = await clients.migrator.query<{ id: string }>(
    `INSERT INTO productions
       (account_id, title, creation_entitlement_grant_id, created_by_user_id)
     VALUES
       ($1, 'R44B11E fixture', $2, $3)
     RETURNING id`,
    [owner.accountId, owner.grantId, owner.userId],
  );

  const productionId = production.rows[0]!.id;

  const connection = await clients.migrator.query<{ id: string }>(
    `INSERT INTO provider_connections
       (account_id,
        provider,
        credential_kind,
        status,
        verification_status,
        last_verification_attempt_at,
        verified_at,
        created_by_user_id)
     VALUES
       ($1,
        'EXAMPLE_PROVIDER',
        'API_KEY',
        'ACTIVE',
        'VERIFIED',
        clock_timestamp(),
        clock_timestamp(),
        $2)
     RETURNING id`,
    [owner.accountId, owner.userId],
  );

  const connectionId = connection.rows[0]!.id;

  const version = await clients.migrator.query<{ id: string }>(
    `INSERT INTO provider_credential_versions
       (account_id,
        provider_connection_id,
        credential_version,
        status,
        sealed_credential,
        fingerprint_algorithm,
        fingerprint_key_ref,
        fingerprint_value,
        created_by_user_id)
     VALUES
       ($1,
        $2,
        1,
        'ACTIVE',
        '{"format":"fixture-envelope"}'::jsonb,
        'HMAC-SHA-256',
        'fixture/v1',
        repeat('a', 43),
        $3)
     RETURNING id`,
    [owner.accountId, connectionId, owner.userId],
  );

  const versionId = version.rows[0]!.id;

  const authorization = await clients.migrator.query<{ id: string }>(
    `INSERT INTO generation_authorizations
       (account_id,
        production_id,
        entitlement_grant_id,
        billing_mode,
        provider,
        model,
        provider_connection_id,
        provider_credential_version_id,
        generation_request,
        generation_request_sha256,
        expected_cost_cap_unit,
        expected_cost_cap_amount,
        expires_at,
        created_by_user_id)
     VALUES
       ($1,
        $2,
        $3,
        'USER_BYO',
        'EXAMPLE_PROVIDER',
        'example-model-1',
        $4,
        $5,
        '{"prompt":"r44b11e"}'::jsonb,
        repeat('b', 64),
        'MICRO_USD',
        1000,
        clock_timestamp() + interval '1 hour',
        $6)
     RETURNING id`,
    [
      owner.accountId,
      productionId,
      owner.grantId,
      connectionId,
      versionId,
      owner.userId,
    ],
  );

  return Object.freeze({
    principal: {
      userId: owner.userId,
      accountId: owner.accountId,
    },
    accountId: owner.accountId,
    productionId,
    grantId: owner.grantId,
    connectionId,
    versionId,
    authorizationId: authorization.rows[0]!.id,
  });
}

async function claim(base: Fixture): Promise<ClaimedFixture> {
  await clients.migrator.query(
    `UPDATE generation_authorizations
        SET status = 'CLAIMED',
            claimed_at = clock_timestamp(),
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [base.authorizationId],
  );

  await clients.migrator.query(
    `INSERT INTO generation_usage_ledger
       (generation_authorization_id, account_id, production_id)
     VALUES ($1, $2, $3)`,
    [
      base.authorizationId,
      base.accountId,
      base.productionId,
    ],
  );

  const job = await clients.migrator.query<{ id: string }>(
    `INSERT INTO execution_jobs
       (account_id, production_id, generation_authorization_id)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [
      base.accountId,
      base.productionId,
      base.authorizationId,
    ],
  );

  const jobId = job.rows[0]!.id;

  const attempt = await clients.migrator.query<{ id: string }>(
    `INSERT INTO execution_attempts
       (account_id,
        execution_job_id,
        generation_authorization_id,
        attempt_number,
        billing_mode,
        provider,
        provider_credential_version_id)
     VALUES
       ($1,
        $2,
        $3,
        1,
        'USER_BYO',
        'EXAMPLE_PROVIDER',
        $4)
     RETURNING id`,
    [
      base.accountId,
      jobId,
      base.authorizationId,
      base.versionId,
    ],
  );

  return Object.freeze({
    ...base,
    jobId,
    attemptId: attempt.rows[0]!.id,
  });
}

async function lease(
  fixture: ClaimedFixture,
  grantCredential: boolean,
): Promise<void> {
  await clients.migrator.query(
    `UPDATE execution_attempts
        SET state = 'LEASED',
            lease_worker_principal_id = $2,
            lease_token_sha256 = repeat('c', 64),
            lease_fencing_counter = 1,
            leased_at = clock_timestamp(),
            lease_expires_at = clock_timestamp() + interval '1 hour',
            heartbeat_at = clock_timestamp(),
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [fixture.attemptId, workerPrincipalId],
  );

  await clients.migrator.query(
    `UPDATE execution_jobs
        SET status = 'RUNNING',
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [fixture.jobId],
  );

  if (grantCredential) {
    await clients.migrator.query(
      `UPDATE execution_attempts
          SET credential_granted_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [fixture.attemptId],
    );
  }
}

async function enterSubmitting(
  fixture: ClaimedFixture,
): Promise<void> {
  await lease(fixture, true);

  await clients.migrator.query(
    `UPDATE execution_attempts
        SET state = 'SUBMITTING',
            submitting_at = clock_timestamp(),
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [fixture.attemptId],
  );
}

async function disconnect(
  fixture: Fixture,
): Promise<void> {
  await disconnectProviderConnection(
    { pool },
    fixture.principal,
    fixture.connectionId,
    { correlationId: randomUUID() },
  );
}

async function converge(
  fixture: Fixture,
) {
  return convergeDisconnectedProviderConnectionPreSubmission(
    pool,
    fixture.connectionId,
    {
      correlationId: randomUUID(),
      mode: "TARGETED",
      childBatchSize: 10,
    },
  );
}

async function cancellationAudits(
  resourceType: "generation_authorization" | "execution_attempt",
  resourceId: string,
) {
  return (
    await clients.migrator.query<{
      actor_type: string;
      actor_user_id: string | null;
      event_type: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT actor_type, actor_user_id, event_type, metadata
         FROM audit_events
        WHERE resource_type = $1
          AND resource_id = $2
          AND event_type IN (
            'generation_authorization.cancelled',
            'execution_attempt.cancelled'
          )
        ORDER BY sequence`,
      [resourceType, resourceId],
    )
  ).rows;
}

describe("R44B11E disconnect convergence Phase A/B", () => {
  it("cancels an ISSUED authorization after disconnect, with one SYSTEM audit and no usage identity", async () => {
    const f = await fixture("issued");

    await disconnect(f);

    const first = await converge(f);

    expect(first).toEqual({
      cancelledAuthorizations: 1,
      cancelledAttempts: 0,
    });

    const authorization = await clients.migrator.query<{
      status: string;
      claimed_at: Date | null;
      cancelled_at: Date | null;
    }>(
      `SELECT status, claimed_at, cancelled_at
         FROM generation_authorizations
        WHERE id = $1`,
      [f.authorizationId],
    );

    expect(authorization.rows).toHaveLength(1);
    expect(authorization.rows[0]!.status).toBe("CANCELLED");
    expect(authorization.rows[0]!.claimed_at).toBeNull();
    expect(authorization.rows[0]!.cancelled_at).not.toBeNull();

    expect(
      (
        await clients.migrator.query(
          `SELECT 1
             FROM generation_usage_ledger
            WHERE generation_authorization_id = $1`,
          [f.authorizationId],
        )
      ).rowCount,
    ).toBe(0);

    expect(
      (
        await clients.migrator.query(
          `SELECT 1
             FROM generation_usage_events
            WHERE generation_authorization_id = $1`,
          [f.authorizationId],
        )
      ).rowCount,
    ).toBe(0);

    expect(
      (
        await clients.migrator.query(
          `SELECT 1
             FROM execution_jobs
            WHERE generation_authorization_id = $1`,
          [f.authorizationId],
        )
      ).rowCount,
    ).toBe(0);

    expect(
      await cancellationAudits(
        "generation_authorization",
        f.authorizationId,
      ),
    ).toEqual([
      {
        actor_type: "SYSTEM",
        actor_user_id: null,
        event_type: "generation_authorization.cancelled",
        metadata: {
          reasonCode: PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE,
        },
      },
    ]);

    const replay = await converge(f);

    expect(replay).toEqual({
      cancelledAuthorizations: 0,
      cancelledAttempts: 0,
    });

    expect(
      await cancellationAudits(
        "generation_authorization",
        f.authorizationId,
      ),
    ).toHaveLength(1);
  });

  it("cancels a claimed QUEUED attempt and atomically records terminal usage and audit evidence", async () => {
    const f = await claim(await fixture("queued"));

    await disconnect(f);

    const first = await converge(f);

    expect(first).toEqual({
      cancelledAuthorizations: 0,
      cancelledAttempts: 1,
    });

    const attempt = await clients.migrator.query<{
      state: string;
      failure_code: string | null;
      lease_fencing_counter: string;
      lease_worker_principal_id: string | null;
      lease_token_sha256: string | null;
      leased_at: Date | null;
      lease_expires_at: Date | null;
      heartbeat_at: Date | null;
      credential_granted_at: Date | null;
      completed_at: Date | null;
      submitting_at: Date | null;
      provider_execution_id: string | null;
      submitted_at: Date | null;
      recovery_expires_at: Date | null;
    }>(
      `SELECT
         state,
         failure_code,
         lease_fencing_counter,
         lease_worker_principal_id,
         lease_token_sha256,
         leased_at,
         lease_expires_at,
         heartbeat_at,
         credential_granted_at,
         completed_at,
         submitting_at,
         provider_execution_id,
         submitted_at,
         recovery_expires_at
       FROM execution_attempts
       WHERE id = $1`,
      [f.attemptId],
    );

    expect(attempt.rows[0]).toMatchObject({
      state: "CANCELLED",
      failure_code: PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE,
      lease_fencing_counter: "0",
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      heartbeat_at: null,
      credential_granted_at: null,
      submitting_at: null,
      provider_execution_id: null,
      submitted_at: null,
      recovery_expires_at: null,
    });
    expect(attempt.rows[0]!.completed_at).not.toBeNull();

    const job = await clients.migrator.query<{
      status: string;
      completed_at: Date | null;
    }>(
      `SELECT status, completed_at
         FROM execution_jobs
        WHERE id = $1`,
      [f.jobId],
    );

    expect(job.rows[0]!.status).toBe("CANCELLED");
    expect(job.rows[0]!.completed_at).not.toBeNull();

    expect(
      (
        await clients.migrator.query(
          `SELECT event_type, reason_code
             FROM generation_usage_events
            WHERE generation_authorization_id = $1`,
          [f.authorizationId],
        )
      ).rows,
    ).toEqual([
      {
        event_type: DISCONNECT_CANCELLED_USAGE_EVENT,
        reason_code: PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE,
      },
    ]);

    expect(
      await cancellationAudits(
        "execution_attempt",
        f.attemptId,
      ),
    ).toEqual([
      {
        actor_type: "SYSTEM",
        actor_user_id: null,
        event_type: "execution_attempt.cancelled",
        metadata: {
          attemptNumber: 1,
          fencingCounter: 0,
          failureCode: PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE,
        },
      },
    ]);

    const replay = await converge(f);

    expect(replay).toEqual({
      cancelledAuthorizations: 0,
      cancelledAttempts: 0,
    });

    expect(
      (
        await clients.migrator.query(
          `SELECT count(*)::int AS count
             FROM generation_usage_events
            WHERE generation_authorization_id = $1`,
          [f.authorizationId],
        )
      ).rows,
    ).toEqual([{ count: 1 }]);

    expect(
      await cancellationAudits(
        "execution_attempt",
        f.attemptId,
      ),
    ).toHaveLength(1);
  });

  it("cancels a granted LEASED attempt while preserving the credential grant and fencing generation", async () => {
    const f = await claim(await fixture("leased-granted"));

    await lease(f, true);

    const before = await clients.migrator.query<{
      credential_granted_at: Date;
      lease_fencing_counter: string;
    }>(
      `SELECT credential_granted_at, lease_fencing_counter
         FROM execution_attempts
        WHERE id = $1`,
      [f.attemptId],
    );

    await disconnect(f);

    const versionBefore = await clients.migrator.query<{
      status: string;
    }>(
      `SELECT status
         FROM provider_credential_versions
        WHERE id = $1`,
      [f.versionId],
    );

    expect(versionBefore.rows).toEqual([
      { status: "RETAINED_FOR_RECOVERY" },
    ]);

    const result = await converge(f);

    expect(result).toEqual({
      cancelledAuthorizations: 0,
      cancelledAttempts: 1,
    });

    const after = await clients.migrator.query<{
      state: string;
      failure_code: string;
      credential_granted_at: Date;
      lease_fencing_counter: string;
      lease_worker_principal_id: string | null;
      lease_token_sha256: string | null;
      leased_at: Date | null;
      lease_expires_at: Date | null;
      heartbeat_at: Date | null;
    }>(
      `SELECT
         state,
         failure_code,
         credential_granted_at,
         lease_fencing_counter,
         lease_worker_principal_id,
         lease_token_sha256,
         leased_at,
         lease_expires_at,
         heartbeat_at
       FROM execution_attempts
       WHERE id = $1`,
      [f.attemptId],
    );

    expect(after.rows[0]).toMatchObject({
      state: "CANCELLED",
      failure_code: PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE,
      lease_fencing_counter: before.rows[0]!.lease_fencing_counter,
      lease_worker_principal_id: null,
      lease_token_sha256: null,
      leased_at: null,
      lease_expires_at: null,
      heartbeat_at: null,
    });

    expect(after.rows[0]!.credential_granted_at.getTime()).toBe(
      before.rows[0]!.credential_granted_at.getTime(),
    );

    const client = await pool.connect();
    try {
      const obligations = await readCredentialObligations(
        client,
        f.accountId,
        [f.versionId],
      );

      expect(obligations.get(f.versionId)).toEqual({
        hasOpenCredentialRetentionObligation: false,
        hasOpenProviderRecoveryObligation: false,
        blocksDestruction: false,
      });
    } finally {
      client.release();
    }

    expect(
      await cancellationAudits(
        "execution_attempt",
        f.attemptId,
      ),
    ).toEqual([
      {
        actor_type: "SYSTEM",
        actor_user_id: null,
        event_type: "execution_attempt.cancelled",
        metadata: {
          attemptNumber: 1,
          fencingCounter: 1,
          failureCode: PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE,
        },
      },
    ]);
  });

  it("does not cancel SUBMITTING work after the durable provider-call barrier", async () => {
    const f = await claim(await fixture("submitting"));

    await enterSubmitting(f);
    await disconnect(f);

    const result = await converge(f);

    expect(result).toEqual({
      cancelledAuthorizations: 0,
      cancelledAttempts: 0,
    });

    const attempt = await clients.migrator.query<{
      state: string;
      submitting_at: Date | null;
      failure_code: string | null;
      completed_at: Date | null;
    }>(
      `SELECT state, submitting_at, failure_code, completed_at
         FROM execution_attempts
        WHERE id = $1`,
      [f.attemptId],
    );

    expect(attempt.rows[0]!.state).toBe("SUBMITTING");
    expect(attempt.rows[0]!.submitting_at).not.toBeNull();
    expect(attempt.rows[0]!.failure_code).toBeNull();
    expect(attempt.rows[0]!.completed_at).toBeNull();

    expect(
      (
        await clients.migrator.query(
          `SELECT 1
             FROM generation_usage_events
            WHERE generation_authorization_id = $1`,
          [f.authorizationId],
        )
      ).rowCount,
    ).toBe(0);

    expect(
      await cancellationAudits(
        "execution_attempt",
        f.attemptId,
      ),
    ).toEqual([]);
  });
});

function failFirstMatchingStatement(
  base: TransactionalPool,
  matches: (sql: string, params: readonly unknown[] | undefined) => boolean,
): TransactionalPool {
  return Object.freeze({
    query: base.query,
    end: base.end,
    connect: async () => {
      const inner = await base.connect();
      let injected = false;

      return Object.freeze({
        query: async <Row extends object>(
          sql: string,
          params?: unknown[],
        ): Promise<{ rows: Row[] }> => {
          if (!injected && matches(sql, params)) {
            injected = true;
            throw new Error("R44B11E injected database statement failure");
          }

          return inner.query<Row>(sql, params);
        },
        release: (destroyWithError?: Error) =>
          inner.release(destroyWithError),
      });
    },
  });
}

async function phaseBState(
  fixture: ClaimedFixture,
) {
  const attempt = await clients.migrator.query<{
    state: string;
    failure_code: string | null;
    completed_at: Date | null;
  }>(
    `SELECT state, failure_code, completed_at
       FROM execution_attempts
      WHERE id = $1`,
    [fixture.attemptId],
  );

  const job = await clients.migrator.query<{
    status: string;
    completed_at: Date | null;
  }>(
    `SELECT status, completed_at
       FROM execution_jobs
      WHERE id = $1`,
    [fixture.jobId],
  );

  const usageEvents = await clients.migrator.query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM generation_usage_events
      WHERE generation_authorization_id = $1`,
    [fixture.authorizationId],
  );

  const audits = await cancellationAudits(
    "execution_attempt",
    fixture.attemptId,
  );

  return Object.freeze({
    attempt: attempt.rows[0]!,
    job: job.rows[0]!,
    usageEventCount: usageEvents.rows[0]!.count,
    auditCount: audits.length,
  });
}

describe("R44B11E Phase B atomic rollback", () => {
  it("rolls back attempt and job cancellation when terminal usage evidence insertion fails", async () => {
    const f = await claim(await fixture("usage-event-rollback"));

    await disconnect(f);

    const failingPool = failFirstMatchingStatement(
      pool,
      (sql) =>
        sql.includes("INSERT INTO generation_usage_events"),
    );

    await expect(
      convergeDisconnectedProviderConnectionPreSubmission(
        failingPool,
        f.connectionId,
        {
          correlationId: randomUUID(),
          mode: "TARGETED",
          childBatchSize: 10,
        },
      ),
    ).rejects.toMatchObject({
      code: "DISCONNECT_CONVERGENCE_DATABASE_FAILURE",
    });

    expect(await phaseBState(f)).toEqual({
      attempt: {
        state: "QUEUED",
        failure_code: null,
        completed_at: null,
      },
      job: {
        status: "QUEUED",
        completed_at: null,
      },
      usageEventCount: 0,
      auditCount: 0,
    });

    const retry = await converge(f);

    expect(retry).toEqual({
      cancelledAuthorizations: 0,
      cancelledAttempts: 1,
    });

    const afterRetry = await phaseBState(f);

    expect(afterRetry.attempt.state).toBe("CANCELLED");
    expect(afterRetry.job.status).toBe("CANCELLED");
    expect(afterRetry.usageEventCount).toBe(1);
    expect(afterRetry.auditCount).toBe(1);
  });

  it("rolls back lifecycle transitions and terminal usage evidence when the cancellation audit insertion fails", async () => {
    const f = await claim(await fixture("audit-rollback"));

    await disconnect(f);

    const failingPool = failFirstMatchingStatement(
      pool,
      (sql) =>
        sql.includes("INSERT INTO audit_events") &&
        sql.includes("'execution_attempt.cancelled'"),
    );

    await expect(
      convergeDisconnectedProviderConnectionPreSubmission(
        failingPool,
        f.connectionId,
        {
          correlationId: randomUUID(),
          mode: "TARGETED",
          childBatchSize: 10,
        },
      ),
    ).rejects.toMatchObject({
      code: "DISCONNECT_CONVERGENCE_DATABASE_FAILURE",
    });

    expect(await phaseBState(f)).toEqual({
      attempt: {
        state: "QUEUED",
        failure_code: null,
        completed_at: null,
      },
      job: {
        status: "QUEUED",
        completed_at: null,
      },
      usageEventCount: 0,
      auditCount: 0,
    });

    const retry = await converge(f);

    expect(retry).toEqual({
      cancelledAuthorizations: 0,
      cancelledAttempts: 1,
    });

    const afterRetry = await phaseBState(f);

    expect(afterRetry.attempt.state).toBe("CANCELLED");
    expect(afterRetry.job.status).toBe("CANCELLED");
    expect(afterRetry.usageEventCount).toBe(1);
    expect(afterRetry.auditCount).toBe(1);
  });
});

type ConvergencePauseProbe = Readonly<{
  pool: TransactionalPool;
  reached: Promise<number>;
  resume: () => void;
}>;

function pauseConvergenceAfter(
  base: TransactionalPool,
  matches: (sql: string) => boolean,
): ConvergencePauseProbe {
  let resolveReached!: (pid: number) => void;
  const reached = new Promise<number>((resolve) => {
    resolveReached = resolve;
  });

  let resume!: () => void;
  const resumed = new Promise<void>((resolve) => {
    resume = resolve;
  });

  let paused = false;

  return Object.freeze({
    reached,
    resume,
    pool: Object.freeze({
      query: base.query,
      end: base.end,
      connect: async () => {
        const client = await base.connect();

        return Object.freeze({
          query: async <Row extends object>(
            sql: string,
            params?: unknown[],
          ): Promise<{ rows: Row[] }> => {
            const result = await client.query<Row>(sql, params);

            if (!paused && matches(sql)) {
              paused = true;

              const pid = (
                await client.query<{ pid: number }>(
                  "SELECT pg_backend_pid() AS pid",
                )
              ).rows[0]!.pid;

              resolveReached(pid);
              await resumed;
            }

            return result;
          },
          release: (destroyWithError?: Error) =>
            client.release(destroyWithError),
        });
      },
    }),
  });
}

type PidPool = Readonly<{
  pool: TransactionalPool;
  pid: Promise<number>;
}>;

function capturePoolPid(
  base: TransactionalPool,
): PidPool {
  let resolvePid!: (pid: number) => void;

  const pid = new Promise<number>((resolve) => {
    resolvePid = resolve;
  });

  let captured = false;

  return Object.freeze({
    pid,
    pool: Object.freeze({
      query: base.query,
      end: base.end,
      connect: async () => {
        const client = await base.connect();

        if (!captured) {
          captured = true;

          resolvePid(
            (
              await client.query<{ pid: number }>(
                "SELECT pg_backend_pid() AS pid",
              )
            ).rows[0]!.pid,
          );
        }

        return client;
      },
    }),
  });
}

async function waitUntilBlockedBy(
  waiterPid: number,
  holderPid: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;

  for (;;) {
    const blocking = await clients.migrator.query<{
      blocked: boolean;
    }>(
      `SELECT
         $2::int = ANY(pg_blocking_pids($1::int)) AS blocked`,
      [waiterPid, holderPid],
    );

    if (blocking.rows[0]!.blocked) {
      return;
    }

    if (Date.now() > deadline) {
      throw new Error(
        `session ${waiterPid} never blocked on ${holderPid}`,
      );
    }

    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

const ATTEMPT_CONVERGENCE_SELECTION = (sql: string): boolean =>
  sql.includes("FROM execution_attempts a") &&
  sql.includes("a.state IN ('QUEUED', 'LEASED')") &&
  sql.includes("FOR UPDATE OF a");

async function convergeWithMode(
  fixture: Fixture,
  mode: "TARGETED" | "BACKGROUND",
  convergencePool: TransactionalPool = pool,
) {
  return convergeDisconnectedProviderConnectionPreSubmission(
    convergencePool,
    fixture.connectionId,
    {
      correlationId: randomUUID(),
      mode,
      childBatchSize: 1,
    },
  );
}

async function leaseWithKnownToken(
  fixture: ClaimedFixture,
  leaseToken: string,
): Promise<void> {
  await clients.migrator.query(
    `UPDATE execution_attempts
        SET state = 'LEASED',
            lease_worker_principal_id = $2,
            lease_token_sha256 =
              encode(
                sha256(convert_to($3::text, 'UTF8')),
                'hex'
              ),
            lease_fencing_counter = 1,
            leased_at = clock_timestamp(),
            lease_expires_at =
              clock_timestamp() + interval '1 hour',
            heartbeat_at = clock_timestamp(),
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [
      fixture.attemptId,
      workerPrincipalId,
      leaseToken,
    ],
  );

  await clients.migrator.query(
    `UPDATE execution_jobs
        SET status = 'RUNNING',
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [fixture.jobId],
  );

  await clients.migrator.query(
    `UPDATE execution_attempts
        SET credential_granted_at = clock_timestamp(),
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [fixture.attemptId],
  );
}

async function exactCancellationEvidence(
  fixture: ClaimedFixture,
) {
  const usage = await clients.migrator.query<{
    count: number;
  }>(
    `SELECT count(*)::int AS count
       FROM generation_usage_events
      WHERE generation_authorization_id = $1
        AND event_type = 'CANCELLED_BEFORE_SUBMISSION'`,
    [fixture.authorizationId],
  );

  const audit = await clients.migrator.query<{
    count: number;
  }>(
    `SELECT count(*)::int AS count
       FROM audit_events
      WHERE resource_type = 'execution_attempt'
        AND resource_id = $1
        AND event_type = 'execution_attempt.cancelled'`,
    [fixture.attemptId],
  );

  return Object.freeze({
    usageEvents: usage.rows[0]!.count,
    cancellationAudits: audit.rows[0]!.count,
  });
}

describe("R44B11E PostgreSQL cancellation lock races", () => {
  it("lets background convergence SKIP LOCKED while targeted convergence owns the exact attempt", async () => {
    const f = await claim(
      await fixture("targeted-background-overlap"),
    );

    await disconnect(f);

    const targetedProbe = pauseConvergenceAfter(
      pool,
      ATTEMPT_CONVERGENCE_SELECTION,
    );

    const targetedPending = convergeWithMode(
      f,
      "TARGETED",
      targetedProbe.pool,
    );

    await targetedProbe.reached;

    try {
      const background = await convergeWithMode(
        f,
        "BACKGROUND",
      );

      expect(background).toEqual({
        cancelledAuthorizations: 0,
        cancelledAttempts: 0,
      });
    } finally {
      targetedProbe.resume();
    }

    expect(await targetedPending).toEqual({
      cancelledAuthorizations: 0,
      cancelledAttempts: 1,
    });

    expect(await exactCancellationEvidence(f)).toEqual({
      usageEvents: 1,
      cancellationAudits: 1,
    });

    expect(await convergeWithMode(f, "BACKGROUND")).toEqual({
      cancelledAuthorizations: 0,
      cancelledAttempts: 0,
    });
  });

  it("prevents two background processes from selecting the same locked attempt", async () => {
    const f = await claim(
      await fixture("background-background-overlap"),
    );

    await disconnect(f);

    const firstProbe = pauseConvergenceAfter(
      pool,
      ATTEMPT_CONVERGENCE_SELECTION,
    );

    const firstPending = convergeWithMode(
      f,
      "BACKGROUND",
      firstProbe.pool,
    );

    await firstProbe.reached;

    try {
      const second = await convergeWithMode(
        f,
        "BACKGROUND",
      );

      expect(second).toEqual({
        cancelledAuthorizations: 0,
        cancelledAttempts: 0,
      });
    } finally {
      firstProbe.resume();
    }

    expect(await firstPending).toEqual({
      cancelledAuthorizations: 0,
      cancelledAttempts: 1,
    });

    expect(await exactCancellationEvidence(f)).toEqual({
      usageEvents: 1,
      cancellationAudits: 1,
    });
  });

  it("cancellation that locks a granted LEASED attempt first blocks and then fences the real SUBMITTING barrier", async () => {
    const f = await claim(
      await fixture("cancel-before-submitting"),
    );

    const leaseToken =
      `r44b11e-race-token-${randomUUID()}`;

    await leaseWithKnownToken(
      f,
      leaseToken,
    );

    await disconnect(f);

    const cancellationProbe = pauseConvergenceAfter(
      pool,
      ATTEMPT_CONVERGENCE_SELECTION,
    );

    const cancellationPending = convergeWithMode(
      f,
      "TARGETED",
      cancellationProbe.pool,
    );

    const cancellationPid =
      await cancellationProbe.reached;

    const workerProbe = capturePoolPid(pool);

    const {
      acknowledgeWorkerSubmitting,
    } = await import(
      "../../src/workerControl/workerSubmittingService.js"
    );

    const submittingPending =
      acknowledgeWorkerSubmitting(
        workerProbe.pool,
        {
          workerPrincipalId,
          correlationId: randomUUID(),
        },
        f.attemptId,
        {
          fencingCounter: 1,
          leaseToken,
        },
      ).then(
        (value) => ({
          ok: true as const,
          value,
        }),
        (error: unknown) => ({
          ok: false as const,
          error,
        }),
      );

    await waitUntilBlockedBy(
      await workerProbe.pid,
      cancellationPid,
    );

    cancellationProbe.resume();

    expect(await cancellationPending).toEqual({
      cancelledAuthorizations: 0,
      cancelledAttempts: 1,
    });

    const submittingOutcome =
      await submittingPending;

    expect(submittingOutcome.ok).toBe(false);

    if (submittingOutcome.ok) {
      throw new Error(
        "SUBMITTING unexpectedly crossed the cancellation barrier",
      );
    }

    expect(submittingOutcome.error).toMatchObject({
      code: "LEASE_REJECTED",
      reason: "NOT_LEASED",
    });

    const attempt = await clients.migrator.query<{
      state: string;
      submitting_at: Date | null;
      failure_code: string | null;
      lease_fencing_counter: string;
      credential_granted_at: Date | null;
    }>(
      `SELECT
         state,
         submitting_at,
         failure_code,
         lease_fencing_counter,
         credential_granted_at
       FROM execution_attempts
       WHERE id = $1`,
      [f.attemptId],
    );

    expect(attempt.rows[0]!.state).toBe("CANCELLED");
    expect(attempt.rows[0]!.submitting_at).toBeNull();
    expect(attempt.rows[0]!.failure_code).toBe(
      PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE,
    );
    expect(
      attempt.rows[0]!.lease_fencing_counter,
    ).toBe("1");
    expect(
      attempt.rows[0]!.credential_granted_at,
    ).not.toBeNull();

    expect(await exactCancellationEvidence(f)).toEqual({
      usageEvents: 1,
      cancellationAudits: 1,
    });
  });
});

describe("R44B11E PostgreSQL SUBMITTING-wins race", () => {
  it("lets SUBMITTING commit first, then disconnect retains recovery authority and convergence does not cancel", async () => {
    const f = await claim(
      await fixture("submitting-before-disconnect"),
    );

    const leaseToken =
      `r44b11e-submitting-wins-${randomUUID()}`;

    await leaseWithKnownToken(
      f,
      leaseToken,
    );

    const submittingProbe = pauseConvergenceAfter(
      pool,
      (sql) =>
        sql.includes(
          "UPDATE execution_attempts SET state = 'SUBMITTING'",
        ),
    );

    const {
      acknowledgeWorkerSubmitting,
    } = await import(
      "../../src/workerControl/workerSubmittingService.js"
    );

    const submittingPending =
      acknowledgeWorkerSubmitting(
        submittingProbe.pool,
        {
          workerPrincipalId,
          correlationId: randomUUID(),
        },
        f.attemptId,
        {
          fencingCounter: 1,
          leaseToken,
        },
      );

    const submittingPid =
      await submittingProbe.reached;

    const disconnectProbe =
      capturePoolPid(pool);

    const disconnectPending =
      disconnectProviderConnection(
        {
          pool: disconnectProbe.pool,
        },
        f.principal,
        f.connectionId,
        {
          correlationId: randomUUID(),
        },
      );

    await waitUntilBlockedBy(
      await disconnectProbe.pid,
      submittingPid,
    );

    submittingProbe.resume();

    const acknowledgement =
      await submittingPending;

    expect(acknowledgement).toMatchObject({
      executionAttemptId: f.attemptId,
      fencingCounter: 1,
      state: "SUBMITTING",
      firstTransition: true,
    });

    expect(
      acknowledgement.submittingAt,
    ).toBeInstanceOf(Date);

    const disconnected =
      await disconnectPending;

    expect(
      disconnected.providerConnection.status,
    ).toBe("DISCONNECTED");

    const version =
      await clients.migrator.query<{
        status: string;
        sealed_credential: unknown;
        destroyed_at: Date | null;
      }>(
        `SELECT
           status,
           sealed_credential,
           destroyed_at
         FROM provider_credential_versions
         WHERE id = $1`,
        [f.versionId],
      );

    expect(version.rows[0]!.status).toBe(
      "RETAINED_FOR_RECOVERY",
    );

    expect(
      version.rows[0]!.sealed_credential,
    ).not.toBeNull();

    expect(
      version.rows[0]!.destroyed_at,
    ).toBeNull();

    const convergence =
      await convergeWithMode(
        f,
        "TARGETED",
      );

    expect(convergence).toEqual({
      cancelledAuthorizations: 0,
      cancelledAttempts: 0,
    });

    const attempt =
      await clients.migrator.query<{
        state: string;
        submitting_at: Date | null;
        failure_code: string | null;
        completed_at: Date | null;
        lease_fencing_counter: string;
        credential_granted_at: Date | null;
        lease_worker_principal_id: string | null;
      }>(
        `SELECT
           state,
           submitting_at,
           failure_code,
           completed_at,
           lease_fencing_counter,
           credential_granted_at,
           lease_worker_principal_id
         FROM execution_attempts
         WHERE id = $1`,
        [f.attemptId],
      );

    expect(attempt.rows[0]!.state).toBe(
      "SUBMITTING",
    );

    expect(
      attempt.rows[0]!.submitting_at,
    ).not.toBeNull();

    expect(
      attempt.rows[0]!.failure_code,
    ).toBeNull();

    expect(
      attempt.rows[0]!.completed_at,
    ).toBeNull();

    expect(
      attempt.rows[0]!.lease_fencing_counter,
    ).toBe("1");

    expect(
      attempt.rows[0]!.credential_granted_at,
    ).not.toBeNull();

    expect(
      attempt.rows[0]!.lease_worker_principal_id,
    ).toBe(workerPrincipalId);

    expect(
      await exactCancellationEvidence(f),
    ).toEqual({
      usageEvents: 0,
      cancellationAudits: 0,
    });

    const client = await pool.connect();

    try {
      const obligations =
        await readCredentialObligations(
          client,
          f.accountId,
          [f.versionId],
        );

      expect(
        obligations.get(f.versionId)
          ?.blocksDestruction,
      ).toBe(true);
    } finally {
      client.release();
    }
  });
});

type PhaseCCredentialFixture = Readonly<{
  connectionId: string;
  versionId: string;
  principal: Readonly<{
    accountId: string;
    userId: string;
  }>;
}>;

async function phaseCCleanup(
  fixture: Readonly<{ connectionId: string }>,
  cleanupPool: TransactionalPool = pool,
  correlationId: string = randomUUID(),
) {
  const {
    convergeDisconnectedProviderConnectionCredentials,
  } = await import(
    "../../src/providerConnections/disconnectConvergenceService.js"
  );

  return convergeDisconnectedProviderConnectionCredentials(
    cleanupPool,
    fixture.connectionId,
    correlationId,
  );
}

async function credentialState(
  fixture: Readonly<{ versionId: string }>,
) {
  return (
    await clients.migrator.query<{
      status: string;
      sealed_credential: unknown | null;
      fingerprint_algorithm: string | null;
      fingerprint_key_ref: string | null;
      fingerprint_value: string | null;
      retained_for_recovery_at: Date | null;
      destroyed_at: Date | null;
    }>(
      `SELECT
         status,
         sealed_credential,
         fingerprint_algorithm,
         fingerprint_key_ref,
         fingerprint_value,
         retained_for_recovery_at,
         destroyed_at
       FROM provider_credential_versions
       WHERE id = $1`,
      [fixture.versionId],
    )
  ).rows[0]!;
}

async function systemDestructionAudits(
  fixture: PhaseCCredentialFixture,
) {
  return (
    await clients.migrator.query<{
      actor_type: string;
      actor_user_id: string | null;
      event_type: string;
      resource_type: string;
      resource_id: string;
      correlation_id: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT
         actor_type,
         actor_user_id,
         event_type,
         resource_type,
         resource_id,
         correlation_id,
         metadata
       FROM audit_events
       WHERE account_id = $1
         AND actor_type = 'SYSTEM'
         AND event_type =
           'provider_connection.secret_destroyed'
         AND resource_type =
           'provider_connection'
         AND resource_id = $2`,
      [
        fixture.principal.accountId,
        fixture.connectionId,
      ],
    )
  ).rows;
}

async function prepareRetainedThenClosed(
  label: string,
) {
  const f = await claim(
    await fixture(label),
  );

  await leaseWithKnownToken(
    f,
    `r44b11e-phase-c-${randomUUID()}`,
  );

  await disconnect(f);

  expect(
    (await credentialState(f)).status,
  ).toBe("RETAINED_FOR_RECOVERY");

  expect(
    await convergeWithMode(
      f,
      "TARGETED",
    ),
  ).toEqual({
    cancelledAuthorizations: 0,
    cancelledAttempts: 1,
  });

  expect(
    await exactCancellationEvidence(f),
  ).toEqual({
    usageEvents: 1,
    cancellationAudits: 1,
  });

  return f;
}

describe("R44B11E Phase C deterministic credential cleanup", () => {
  it("destroys a retained credential after Phase B closes its granted LEASED obligation and replays without duplicate writes", async () => {
    const f =
      await prepareRetainedThenClosed(
        "phase-c-destroy",
      );

    const before =
      await credentialState(f);

    expect(before.status).toBe(
      "RETAINED_FOR_RECOVERY",
    );
    expect(before.sealed_credential).not.toBeNull();
    expect(
      before.retained_for_recovery_at,
    ).not.toBeNull();
    expect(before.destroyed_at).toBeNull();

    const correlationId = randomUUID();

    expect(
      await phaseCCleanup(
        f,
        pool,
        correlationId,
      ),
    ).toEqual({
      destroyedCredentialVersions: 1,
    });

    const destroyed =
      await credentialState(f);

    expect(destroyed.status).toBe(
      "DESTROYED",
    );
    expect(
      destroyed.sealed_credential,
    ).toBeNull();
    expect(
      destroyed.fingerprint_algorithm,
    ).toBeNull();
    expect(
      destroyed.fingerprint_key_ref,
    ).toBeNull();
    expect(
      destroyed.fingerprint_value,
    ).toBeNull();
    expect(
      destroyed.destroyed_at,
    ).not.toBeNull();

    const firstAudits =
      await systemDestructionAudits(f);

    expect(firstAudits).toHaveLength(1);

    expect(firstAudits[0]).toMatchObject({
      actor_type: "SYSTEM",
      actor_user_id: null,
      event_type:
        "provider_connection.secret_destroyed",
      resource_type:
        "provider_connection",
      resource_id: f.connectionId,
      correlation_id: correlationId,
    });

    expect(
      Object.keys(
        firstAudits[0]!.metadata,
      ).sort(),
    ).toEqual([
      "credentialVersion",
      "provider",
    ]);

    expect(
      firstAudits[0]!.metadata
        .credentialVersion,
    ).toBe(1);

    expect(
      await phaseCCleanup(f),
    ).toEqual({
      destroyedCredentialVersions: 0,
    });

    expect(
      await credentialState(f),
    ).toEqual(destroyed);

    expect(
      await systemDestructionAudits(f),
    ).toEqual(firstAudits);
  });

  it("keeps a retained credential sealed while a SUBMITTING recovery obligation remains open", async () => {
    const f = await claim(
      await fixture(
        "phase-c-submitting-obligation",
      ),
    );

    const leaseToken =
      `r44b11e-phase-c-submitting-${randomUUID()}`;

    await leaseWithKnownToken(
      f,
      leaseToken,
    );

    const {
      acknowledgeWorkerSubmitting,
    } = await import(
      "../../src/workerControl/workerSubmittingService.js"
    );

    await acknowledgeWorkerSubmitting(
      pool,
      {
        workerPrincipalId,
        correlationId: randomUUID(),
      },
      f.attemptId,
      {
        fencingCounter: 1,
        leaseToken,
      },
    );

    await disconnect(f);

    const retainedBefore =
      await credentialState(f);

    expect(
      retainedBefore.status,
    ).toBe(
      "RETAINED_FOR_RECOVERY",
    );

    expect(
      retainedBefore.sealed_credential,
    ).not.toBeNull();

    expect(
      await phaseCCleanup(f),
    ).toEqual({
      destroyedCredentialVersions: 0,
    });

    const retainedAfter =
      await credentialState(f);

    expect(
      retainedAfter.status,
    ).toBe(
      "RETAINED_FOR_RECOVERY",
    );

    expect(
      retainedAfter.sealed_credential,
    ).not.toBeNull();

    expect(
      retainedAfter.destroyed_at,
    ).toBeNull();

    expect(
      await systemDestructionAudits(f),
    ).toEqual([]);
  });

  it("cleans up after the obligation closes even when the owning Account and User are disabled", async () => {
    const f =
      await prepareRetainedThenClosed(
        "phase-c-disabled-owner",
      );

    await clients.migrator.query(
      `UPDATE users
          SET status = 'DISABLED',
              disabled_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      [f.principal.userId],
    );

    await clients.migrator.query(
      `UPDATE accounts
          SET status = 'DISABLED',
              disabled_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      [f.principal.accountId],
    );

    expect(
      await phaseCCleanup(f),
    ).toEqual({
      destroyedCredentialVersions: 1,
    });

    expect(
      (await credentialState(f)).status,
    ).toBe("DESTROYED");

    expect(
      await systemDestructionAudits(f),
    ).toHaveLength(1);
  });

  it("fails closed on a disconnected connection with a non-retained residual credential and does not repair it", async () => {
    const f = await fixture(
      "phase-c-malformed-residual",
    );

    const before =
      await credentialState(f);

    expect(before.status).toBe("ACTIVE");

    await clients.migrator.query(
      `UPDATE provider_connections
          SET status = 'DISCONNECTED',
              disconnected_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      [f.connectionId],
    );

    await expect(
      phaseCCleanup(f),
    ).rejects.toMatchObject({
      code:
        "DISCONNECT_CONVERGENCE_INVARIANT_VIOLATION",
    });

    const after =
      await credentialState(f);

    expect(after).toEqual(before);

    expect(
      await systemDestructionAudits(f),
    ).toEqual([]);
  });

  it("rolls credential destruction back when the SYSTEM destruction audit insertion fails", async () => {
    const f =
      await prepareRetainedThenClosed(
        "phase-c-audit-rollback",
      );

    const before =
      await credentialState(f);

    const failingPool =
      failFirstMatchingStatement(
        pool,
        (sql) =>
          sql.includes(
            "INSERT INTO audit_events",
          ) &&
          sql.includes(
            "VALUES ($1, 'SYSTEM', NULL",
          ),
      );

    await expect(
      phaseCCleanup(
        f,
        failingPool,
      ),
    ).rejects.toMatchObject({
      code:
        "DISCONNECT_CONVERGENCE_DATABASE_FAILURE",
    });

    expect(
      await credentialState(f),
    ).toEqual(before);

    expect(
      await systemDestructionAudits(f),
    ).toEqual([]);

    expect(
      await phaseCCleanup(f),
    ).toEqual({
      destroyedCredentialVersions: 1,
    });

    expect(
      (await credentialState(f)).status,
    ).toBe("DESTROYED");

    expect(
      await systemDestructionAudits(f),
    ).toHaveLength(1);
  });
});

async function forceTerminalDisconnectAttemptCancellation(
  f: Readonly<{
    attemptId: string;
    jobId: string;
  }>,
): Promise<void> {
  await clients.migrator.query("BEGIN");

  try {
    const attempt =
      await clients.migrator.query(
        `UPDATE execution_attempts
            SET state = 'CANCELLED',
                failure_code =
                  'PROVIDER_CONNECTION_DISCONNECTED',
                completed_at =
                  clock_timestamp(),
                updated_at =
                  clock_timestamp(),
                lease_worker_principal_id = NULL,
                lease_token_sha256 = NULL,
                leased_at = NULL,
                lease_expires_at = NULL,
                heartbeat_at = NULL
          WHERE id = $1
            AND state = 'QUEUED'
        RETURNING id`,
        [f.attemptId],
      );

    expect(attempt.rows).toHaveLength(1);

    const job =
      await clients.migrator.query(
        `UPDATE execution_jobs
            SET status = 'CANCELLED',
                completed_at =
                  clock_timestamp(),
                updated_at =
                  clock_timestamp()
          WHERE id = $1
            AND status = 'QUEUED'
        RETURNING id`,
        [f.jobId],
      );

    expect(job.rows).toHaveLength(1);

    await clients.migrator.query("COMMIT");
  } catch (error) {
    await clients.migrator
      .query("ROLLBACK")
      .catch(() => undefined);

    throw error;
  }
}

async function terminalAttemptEvidenceCounts(
  f: Readonly<{
    authorizationId: string;
    attemptId: string;
  }>,
) {
  const result =
    await clients.migrator.query<{
      usage_events: number;
      cancellation_audits: number;
    }>(
      `SELECT
         (
           SELECT count(*)::int
             FROM generation_usage_events
            WHERE generation_authorization_id = $1
              AND event_type =
                'CANCELLED_BEFORE_SUBMISSION'
         ) AS usage_events,
         (
           SELECT count(*)::int
             FROM audit_events
            WHERE resource_type =
                    'execution_attempt'
              AND resource_id = $2
              AND event_type =
                    'execution_attempt.cancelled'
         ) AS cancellation_audits`,
      [
        f.authorizationId,
        f.attemptId,
      ],
    );

  return result.rows[0]!;
}

describe("R44B11E malformed terminal replay", () => {
  it("fails closed when a terminal authorization cancellation is missing its canonical audit", async () => {
    const f = await fixture(
      "terminal-auth-missing-audit",
    );

    await disconnect(f);

    const transitioned =
      await clients.migrator.query(
        `UPDATE generation_authorizations
            SET status = 'CANCELLED',
                cancelled_at =
                  clock_timestamp(),
                updated_at =
                  clock_timestamp()
          WHERE id = $1
            AND status = 'ISSUED'
        RETURNING id`,
        [f.authorizationId],
      );

    expect(transitioned.rows).toHaveLength(1);

    await expect(
      convergeDisconnectedProviderConnectionPreSubmission(
        pool,
        f.connectionId,
        {
          correlationId: randomUUID(),
          mode: "TARGETED",
          childBatchSize: 10,
        },
      ),
    ).rejects.toMatchObject({
      code:
        "DISCONNECT_CONVERGENCE_INVARIANT_VIOLATION",
    });

    const authorization =
      await clients.migrator.query<{
        status: string;
        cancelled_at: Date | null;
      }>(
        `SELECT status, cancelled_at
           FROM generation_authorizations
          WHERE id = $1`,
        [f.authorizationId],
      );

    expect(
      authorization.rows[0]!.status,
    ).toBe("CANCELLED");

    expect(
      authorization.rows[0]!.cancelled_at,
    ).not.toBeNull();

    const audits =
      await clients.migrator.query<{
        count: number;
      }>(
        `SELECT count(*)::int AS count
           FROM audit_events
          WHERE resource_type =
                  'generation_authorization'
            AND resource_id = $1
            AND event_type =
                  'generation_authorization.cancelled'`,
        [f.authorizationId],
      );

    expect(audits.rows[0]!.count).toBe(0);
  });

  it("fails closed when a terminal pre-submission cancellation is missing both terminal evidence records", async () => {
    const f = await claim(
      await fixture(
        "terminal-attempt-no-evidence",
      ),
    );

    await disconnect(f);

    await forceTerminalDisconnectAttemptCancellation(
      f,
    );

    expect(
      await terminalAttemptEvidenceCounts(f),
    ).toEqual({
      usage_events: 0,
      cancellation_audits: 0,
    });

    await expect(
      convergeDisconnectedProviderConnectionPreSubmission(
        pool,
        f.connectionId,
        {
          correlationId: randomUUID(),
          mode: "TARGETED",
          childBatchSize: 10,
        },
      ),
    ).rejects.toMatchObject({
      code:
        "DISCONNECT_CONVERGENCE_INVARIANT_VIOLATION",
    });

    expect(
      await terminalAttemptEvidenceCounts(f),
    ).toEqual({
      usage_events: 0,
      cancellation_audits: 0,
    });

    const lifecycle =
      await clients.migrator.query<{
        attempt_state: string;
        failure_code: string | null;
        job_status: string;
      }>(
        `SELECT
           a.state AS attempt_state,
           a.failure_code,
           j.status AS job_status
         FROM execution_attempts a
         JOIN execution_jobs j
           ON j.id = a.execution_job_id
        WHERE a.id = $1`,
        [f.attemptId],
      );

    expect(lifecycle.rows[0]).toEqual({
      attempt_state: "CANCELLED",
      failure_code:
        "PROVIDER_CONNECTION_DISCONNECTED",
      job_status: "CANCELLED",
    });
  });

  it("fails closed when terminal usage evidence exists but the cancellation audit is missing", async () => {
    const f = await claim(
      await fixture(
        "terminal-attempt-missing-audit",
      ),
    );

    await disconnect(f);

    await forceTerminalDisconnectAttemptCancellation(
      f,
    );

    await clients.migrator.query(
      `INSERT INTO generation_usage_events
         (
           generation_authorization_id,
           event_type,
           reason_code
         )
       VALUES
         (
           $1,
           'CANCELLED_BEFORE_SUBMISSION',
           'PROVIDER_CONNECTION_DISCONNECTED'
         )`,
      [f.authorizationId],
    );

    expect(
      await terminalAttemptEvidenceCounts(f),
    ).toEqual({
      usage_events: 1,
      cancellation_audits: 0,
    });

    await expect(
      convergeDisconnectedProviderConnectionPreSubmission(
        pool,
        f.connectionId,
        {
          correlationId: randomUUID(),
          mode: "TARGETED",
          childBatchSize: 10,
        },
      ),
    ).rejects.toMatchObject({
      code:
        "DISCONNECT_CONVERGENCE_INVARIANT_VIOLATION",
    });

    expect(
      await terminalAttemptEvidenceCounts(f),
    ).toEqual({
      usage_events: 1,
      cancellation_audits: 0,
    });
  });
});
