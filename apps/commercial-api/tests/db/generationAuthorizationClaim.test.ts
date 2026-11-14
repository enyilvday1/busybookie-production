import { randomBytes, randomUUID } from "node:crypto";

import type pg from "pg";
import {
  GOOGLE_MODEL,
  GOOGLE_PROVIDER_ID,
  generationRequestSha256,
} from "commercial-worker-protocol";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import {
  createRuntimePool,
  type RuntimeClient,
  type TransactionalPool,
} from "../../src/database/runtimePool.js";
import { GenerationAuthorizationClaimError } from "../../src/generationAuthorizations/generationAuthorizationClaimError.js";
import {
  claimGenerationAuthorization,
  type ClaimGenerationAuthorizationResult,
} from "../../src/generationAuthorizations/generationAuthorizationClaimService.js";
import {
  connectAs,
  openGuardedClients,
  prepareSchemaV1,
  type GuardedClients,
} from "./support/testDatabase.js";
import {
  APPROVED_RUNTIME_ROLE,
} from "./support/testDatabaseGuard.js";

// R44B11D GenerationAuthorization claim against PostgreSQL 16 on the
// dedicated loopback test database.
//
// All application transactions run through the restricted runtime role.
// Fixtures and post-commit inspection use the migration role.
//
// Lock races are proved through PostgreSQL pg_blocking_pids(), never through
// elapsed-time guesses or process-local mutexes.

let clients: GuardedClients;
let pool: TransactionalPool;

const pools: TransactionalPool[] = [];

async function runtimePool(): Promise<TransactionalPool> {
  const config = loadRuntimeDatabaseConfig(
    {
      COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl,
    },
    "development",
  );

  const created = await createRuntimePool(config!, () => {});
  pools.push(created);

  return created;
}

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
  pool = await runtimePool();
});

afterAll(async () => {
  await Promise.all(
    pools.splice(0).map((created) => created.end()),
  );

  await prepareSchemaV1(clients);
  await clients.close();
});

const REQUEST = Object.freeze({
  prompt: "R44B11D claim database fixture",
  referenceImage: null,
  resolution: "720p",
});

const CLAIM_CORRELATION_1 =
  "12345678-1234-4234-8234-123456789012";

const CLAIM_CORRELATION_2 =
  "22345678-1234-4234-8234-123456789012";

type ExpiryKind = "FUTURE" | "NEAR_FUTURE" | "PAST";

type Fixture = Readonly<{
  userId: string;
  accountId: string;
  grantId: string;
  productionId: string;
  connectionId: string;
  versionId: string;
  authorizationId: string;
}>;

async function oneOn(
  client: pg.Client,
  sql: string,
  params: unknown[],
): Promise<string> {
  const result = await client.query<{ id: string }>(
    sql,
    params,
  );

  return result.rows[0]!.id;
}

async function one(
  sql: string,
  params: unknown[],
): Promise<string> {
  return oneOn(clients.migrator, sql, params);
}

function fingerprint(): string {
  return randomBytes(32).toString("base64url");
}

async function insertOwner(
  label: string,
  policyVersion = "free-byo-v1",
): Promise<
  Readonly<{
    userId: string;
    accountId: string;
    grantId: string;
  }>
> {
  const userId = await one(
    `INSERT INTO users
       (idp_issuer, idp_subject)
     VALUES
       ('https://issuer.test', $1)
     RETURNING id`,
    [`r44b11d-${label}-${randomUUID()}`],
  );

  const accountId = await one(
    `INSERT INTO accounts
       (kind, owner_user_id)
     VALUES
       ('PERSONAL', $1)
     RETURNING id`,
    [userId],
  );

  const grantId = await one(
    `INSERT INTO entitlement_grants
       (account_id,
        kind,
        state,
        source,
        issuance_key,
        policy_version)
     VALUES
       ($1,
        'FREE_BYO',
        'AVAILABLE',
        'ACCOUNT_PROVISIONING',
        $2,
        $3)
     RETURNING id`,
    [
      accountId,
      `r44b11d-${randomUUID()}`,
      policyVersion,
    ],
  );

  return {
    userId,
    accountId,
    grantId,
  };
}

async function insertConnection(
  accountId: string,
  userId: string,
): Promise<string> {
  return one(
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
        $2,
        'API_KEY',
        'ACTIVE',
        'VERIFIED',
        clock_timestamp(),
        clock_timestamp(),
        $3)
     RETURNING id`,
    [
      accountId,
      GOOGLE_PROVIDER_ID,
      userId,
    ],
  );
}

async function insertActiveVersion(
  client: pg.Client,
  f: Pick<Fixture, "accountId" | "userId" | "connectionId">,
  credentialVersion: number,
): Promise<string> {
  return oneOn(
    client,
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
        $3,
        'ACTIVE',
        '{"format":"fixture-envelope"}'::jsonb,
        'HMAC-SHA-256',
        'fixture/v1',
        $4,
        $5)
     RETURNING id`,
    [
      f.accountId,
      f.connectionId,
      credentialVersion,
      fingerprint(),
      f.userId,
    ],
  );
}

function expiryExpression(kind: ExpiryKind): string {
  switch (kind) {
    case "FUTURE":
      return "clock_timestamp() + interval '10 minutes'";
    case "NEAR_FUTURE":
      return "clock_timestamp() + interval '5 seconds'";
    case "PAST":
      return "clock_timestamp() - interval '1 minute'";
  }
}

async function fixture(
  label: string,
  options: Readonly<{
    policyVersion?: string;
    expiry?: ExpiryKind;
  }> = {},
): Promise<Fixture> {
  const owner = await insertOwner(
    label,
    options.policyVersion ?? "free-byo-v1",
  );

  const productionId = await one(
    `INSERT INTO productions
       (account_id,
        title,
        creation_entitlement_grant_id,
        created_by_user_id)
     VALUES
       ($1, 'R44B11D Production', $2, $3)
     RETURNING id`,
    [
      owner.accountId,
      owner.grantId,
      owner.userId,
    ],
  );

  const connectionId = await insertConnection(
    owner.accountId,
    owner.userId,
  );

  const versionId = await insertActiveVersion(
    clients.migrator,
    {
      ...owner,
      connectionId,
    },
    1,
  );

  const expiry = expiryExpression(
    options.expiry ?? "FUTURE",
  );

  const authorizationId = await one(
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
        status,
        expires_at,
        created_by_user_id,
        created_at,
        updated_at)
     VALUES
       ($1,
        $2,
        $3,
        'USER_BYO',
        $4,
        $5,
        $6,
        $7,
        $8::jsonb,
        $9,
        'MICRO_USD',
        2500000,
        'ISSUED',
        ${expiry},
        $10,
        clock_timestamp() - interval '2 hours',
        clock_timestamp())
     RETURNING id`,
    [
      owner.accountId,
      productionId,
      owner.grantId,
      GOOGLE_PROVIDER_ID,
      GOOGLE_MODEL,
      connectionId,
      versionId,
      JSON.stringify(REQUEST),
      generationRequestSha256(REQUEST),
      owner.userId,
    ],
  );

  return {
    ...owner,
    productionId,
    connectionId,
    versionId,
    authorizationId,
  };
}

const principalOf = (f: Fixture) => ({
  userId: f.userId,
  accountId: f.accountId,
});

function claimAs(
  f: Fixture,
  options: Readonly<{
    pool?: TransactionalPool;
    principal?: {
      userId: string;
      accountId: string;
    };
    authorizationId?: string;
    correlationId?: string;
  }> = {},
): Promise<ClaimGenerationAuthorizationResult> {
  const claimOptions =
    options.correlationId === undefined
      ? {}
      : {
          correlationId: options.correlationId,
        };

  return claimGenerationAuthorization(
    {
      pool: options.pool ?? pool,
    },
    options.principal ?? principalOf(f),
    options.authorizationId ?? f.authorizationId,
    claimOptions,
  );
}

async function expectRefusal(
  promise: Promise<unknown>,
  code: string,
): Promise<GenerationAuthorizationClaimError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(
    GenerationAuthorizationClaimError,
  );

  expect(
    (error as GenerationAuthorizationClaimError).code,
  ).toBe(code);

  return error as GenerationAuthorizationClaimError;
}

async function claimSideEffects(
  f: Fixture,
): Promise<
  Readonly<{
    jobs: number;
    attempts: number;
    usage: number;
    audits: number;
  }>
> {
  const result = await clients.migrator.query<{
    jobs: number;
    attempts: number;
    usage: number;
    audits: number;
  }>(
    `SELECT
       (
         SELECT count(*)::int
           FROM execution_jobs
          WHERE account_id = $1
            AND generation_authorization_id = $2
       ) AS jobs,
       (
         SELECT count(*)::int
           FROM execution_attempts
          WHERE account_id = $1
            AND generation_authorization_id = $2
       ) AS attempts,
       (
         SELECT count(*)::int
           FROM generation_usage_ledger
          WHERE account_id = $1
            AND generation_authorization_id = $2
       ) AS usage,
       (
         SELECT count(*)::int
           FROM audit_events
          WHERE account_id = $1
            AND event_type = 'generation_authorization.claimed'
            AND resource_type = 'generation_authorization'
            AND resource_id = $2
       ) AS audits`,
    [
      f.accountId,
      f.authorizationId,
    ],
  );

  return result.rows[0]!;
}

const NO_CLAIM = Object.freeze({
  jobs: 0,
  attempts: 0,
  usage: 0,
  audits: 0,
});

const ONE_CLAIM = Object.freeze({
  jobs: 1,
  attempts: 1,
  usage: 1,
  audits: 1,
});

async function grantRow(grantId: string) {
  return (
    await clients.migrator.query(
      `SELECT
         state,
         reserved_at,
         consumed_at,
         revoked_at,
         expired_at,
         policy_version,
         updated_at
       FROM entitlement_grants
       WHERE id = $1`,
      [grantId],
    )
  ).rows[0];
}

async function authorizationLifecycle(
  authorizationId: string,
) {
  return (
    await clients.migrator.query<{
      status: string;
      claimed_at: Date | null;
      expires_at: Date;
    }>(
      `SELECT status, claimed_at, expires_at
         FROM generation_authorizations
        WHERE id = $1`,
      [authorizationId],
    )
  ).rows[0]!;
}

async function supersedeAndInsertActive(
  f: Fixture,
  client: pg.Client = clients.migrator,
): Promise<string> {
  await client.query(
    `UPDATE provider_credential_versions
        SET status = 'SUPERSEDED',
            superseded_at = clock_timestamp(),
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [f.versionId],
  );

  return insertActiveVersion(
    client,
    f,
    2,
  );
}

async function rotateToPending(
  f: Fixture,
): Promise<string> {
  const activeVersionId =
    await supersedeAndInsertActive(f);

  await clients.migrator.query(
    `UPDATE provider_connections
        SET status = 'PENDING_VERIFICATION',
            verification_status = 'UNVERIFIED',
            verified_at = NULL,
            last_verification_attempt_at = NULL,
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [f.connectionId],
  );

  return activeVersionId;
}

async function setConnectionStatus(
  f: Fixture,
  status: "INVALID" | "DISCONNECTED" | "DISABLED",
): Promise<void> {
  switch (status) {
    case "INVALID":
      await clients.migrator.query(
        `UPDATE provider_connections
            SET status = 'INVALID',
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [f.connectionId],
      );
      return;

    case "DISCONNECTED":
      await clients.migrator.query(
        `UPDATE provider_connections
            SET status = 'DISCONNECTED',
                disconnected_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [f.connectionId],
      );
      return;

    case "DISABLED":
      await clients.migrator.query(
        `UPDATE provider_connections
            SET status = 'DISABLED',
                disabled_at = clock_timestamp(),
                updated_at = clock_timestamp()
          WHERE id = $1`,
        [f.connectionId],
      );
      return;
  }
}

async function setBoundVersionUnavailable(
  f: Fixture,
  status: "RETAINED_FOR_RECOVERY" | "DESTROYED",
): Promise<void> {
  if (status === "RETAINED_FOR_RECOVERY") {
    await clients.migrator.query(
      `UPDATE provider_credential_versions
          SET status = 'RETAINED_FOR_RECOVERY',
              retained_for_recovery_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [f.versionId],
    );

    return;
  }

  await clients.migrator.query(
    `UPDATE provider_credential_versions
        SET status = 'DESTROYED',
            sealed_credential = NULL,
            fingerprint_algorithm = NULL,
            fingerprint_key_ref = NULL,
            fingerprint_value = NULL,
            destroyed_at = clock_timestamp(),
            updated_at = clock_timestamp()
      WHERE id = $1`,
    [f.versionId],
  );
}

describe("R44B11D test database identity", () => {
  it("uses only PostgreSQL 16 on 127.0.0.1:5433 and the approved runtime role", async () => {
    const identity =
      await clients.migrator.query<{
        database: string;
        port: number;
        address: string;
        version: number;
      }>(
        `SELECT
           current_database() AS database,
           inet_server_port() AS port,
           host(inet_server_addr()) AS address,
           current_setting('server_version_num')::int AS version`,
      );

    expect(identity.rows[0]!.database).toBe(
      "busybookie_commercial_test",
    );

    expect(identity.rows[0]!.port).toBe(5433);
    expect(identity.rows[0]!.address).toBe("127.0.0.1");

    expect(identity.rows[0]!.version).toBeGreaterThanOrEqual(
      160000,
    );

    expect(identity.rows[0]!.version).toBeLessThan(
      170000,
    );

    const runtime = await pool.query<{
      user: string;
      port: number;
    }>(
      `SELECT
         current_user AS user,
         inet_server_port() AS port`,
    );

    expect(runtime.rows).toEqual([
      {
        user: APPROVED_RUNTIME_ROLE,
        port: 5433,
      },
    ]);
  });
});

describe("A. successful atomic claim", () => {
  it("commits one CLAIMED transition, one job, attempt 1, one usage row and one claim audit without consuming FREE_BYO", async () => {
    const f = await fixture("atomic-success");
    const grantBefore = await grantRow(f.grantId);

    const result = await claimAs(f, {
      correlationId: CLAIM_CORRELATION_1,
    });

    expect(result.created).toBe(true);
    expect(result.generationAuthorizationId).toBe(
      f.authorizationId,
    );

    expect(result.executionJob.status).toBe("QUEUED");

    expect(result.initialExecutionAttempt).toMatchObject({
      attemptNumber: 1,
      state: "QUEUED",
      leaseFencingCounter: 0,
    });

    const lifecycle =
      await authorizationLifecycle(f.authorizationId);

    expect(lifecycle.status).toBe("CLAIMED");
    expect(lifecycle.claimed_at).not.toBeNull();

    expect(
      lifecycle.claimed_at!.getTime(),
    ).toBeLessThan(
      lifecycle.expires_at.getTime(),
    );

    expect(
      result.claimedAt.getTime(),
    ).toBe(
      lifecycle.claimed_at!.getTime(),
    );

    const jobs = await clients.migrator.query(
      `SELECT
         id,
         account_id,
         production_id,
         generation_authorization_id,
         status,
         completed_at
       FROM execution_jobs
       WHERE generation_authorization_id = $1`,
      [f.authorizationId],
    );

    expect(jobs.rows).toEqual([
      {
        id: result.executionJob.id,
        account_id: f.accountId,
        production_id: f.productionId,
        generation_authorization_id:
          f.authorizationId,
        status: "QUEUED",
        completed_at: null,
      },
    ]);

    const attempts = await clients.migrator.query(
      `SELECT
         id,
         account_id,
         execution_job_id,
         generation_authorization_id,
         attempt_number,
         state,
         billing_mode,
         provider,
         provider_credential_version_id,
         lease_worker_principal_id,
         lease_token_sha256,
         lease_fencing_counter::text
           AS lease_fencing_counter,
         leased_at,
         credential_granted_at,
         submitting_at,
         provider_execution_id,
         completed_at
       FROM execution_attempts
       WHERE generation_authorization_id = $1`,
      [f.authorizationId],
    );

    expect(attempts.rows).toEqual([
      {
        id: result.initialExecutionAttempt.id,
        account_id: f.accountId,
        execution_job_id: result.executionJob.id,
        generation_authorization_id:
          f.authorizationId,
        attempt_number: 1,
        state: "QUEUED",
        billing_mode: "USER_BYO",
        provider: GOOGLE_PROVIDER_ID,
        provider_credential_version_id:
          f.versionId,
        lease_worker_principal_id: null,
        lease_token_sha256: null,
        lease_fencing_counter: "0",
        leased_at: null,
        credential_granted_at: null,
        submitting_at: null,
        provider_execution_id: null,
        completed_at: null,
      },
    ]);

    const usage = await clients.migrator.query(
      `SELECT
         generation_authorization_id,
         account_id,
         production_id,
         recorded_at IS NOT NULL AS recorded
       FROM generation_usage_ledger
       WHERE generation_authorization_id = $1`,
      [f.authorizationId],
    );

    expect(usage.rows).toEqual([
      {
        generation_authorization_id:
          f.authorizationId,
        account_id: f.accountId,
        production_id: f.productionId,
        recorded: true,
      },
    ]);

    const audits = await clients.migrator.query(
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
         AND event_type =
           'generation_authorization.claimed'
         AND resource_id = $2`,
      [
        f.accountId,
        f.authorizationId,
      ],
    );

    expect(audits.rows).toEqual([
      {
        actor_type: "USER",
        actor_user_id: f.userId,
        event_type:
          "generation_authorization.claimed",
        resource_type:
          "generation_authorization",
        resource_id: f.authorizationId,
        correlation_id: CLAIM_CORRELATION_1,
        metadata: {
          executionJobId:
            result.executionJob.id,
          initialExecutionAttemptId:
            result.initialExecutionAttempt.id,
          entitlementPolicyVersion:
            "free-byo-v1",
        },
      },
    ]);

    expect(await claimSideEffects(f)).toEqual(
      ONE_CLAIM,
    );

    expect(await grantRow(f.grantId)).toEqual(
      grantBefore,
    );
  });

  it("returns the same unavailable error for a missing or foreign authorization", async () => {
    const owner = await fixture(
      "unavailable-owner",
    );

    const foreign = await fixture(
      "unavailable-foreign",
    );

    await expectRefusal(
      claimAs(owner, {
        authorizationId: randomUUID(),
      }),
      "GENERATION_AUTHORIZATION_UNAVAILABLE",
    );

    await expectRefusal(
      claimAs(owner, {
        authorizationId:
          foreign.authorizationId,
      }),
      "GENERATION_AUTHORIZATION_UNAVAILABLE",
    );

    expect(await claimSideEffects(owner)).toEqual(
      NO_CLAIM,
    );

    expect(await claimSideEffects(foreign)).toEqual(
      NO_CLAIM,
    );
  });
});

describe("B. database-clock expiry", () => {
  it("admits a claim while the database claim instant is strictly before expires_at", async () => {
    const f = await fixture(
      "expiry-before",
      {
        expiry: "NEAR_FUTURE",
      },
    );

    const result = await claimAs(f);

    expect(result.created).toBe(true);

    const row =
      await authorizationLifecycle(
        f.authorizationId,
      );

    expect(row.status).toBe("CLAIMED");
    expect(row.claimed_at).not.toBeNull();

    expect(
      row.claimed_at!.getTime(),
    ).toBeLessThan(
      row.expires_at.getTime(),
    );

    expect(await claimSideEffects(f)).toEqual(
      ONE_CLAIM,
    );
  });

  it("refuses an ISSUED authorization whose database deadline is already at or behind the claim instant without expiry convergence", async () => {
    const f = await fixture(
      "expiry-after",
      {
        expiry: "PAST",
      },
    );

    await expectRefusal(
      claimAs(f),
      "GENERATION_AUTHORIZATION_CLAIM_EXPIRED",
    );

    expect(
      await authorizationLifecycle(
        f.authorizationId,
      ),
    ).toMatchObject({
      status: "ISSUED",
      claimed_at: null,
    });

    expect(await claimSideEffects(f)).toEqual(
      NO_CLAIM,
    );
  });
});

describe("C. credential lifecycle admission", () => {
  it("claims against the exact ACTIVE bound credential on an ACTIVE VERIFIED connection", async () => {
    const f = await fixture(
      "credential-active",
    );

    const result = await claimAs(f);

    expect(result.created).toBe(true);

    const attempts =
      await clients.migrator.query<{
        provider_credential_version_id: string;
      }>(
        `SELECT provider_credential_version_id
           FROM execution_attempts
          WHERE generation_authorization_id = $1`,
        [f.authorizationId],
      );

    expect(attempts.rows).toEqual([
      {
        provider_credential_version_id:
          f.versionId,
      },
    ]);
  });

  it("allows the exact SUPERSEDED bound version on an otherwise ACTIVE VERIFIED connection without rebinding to the new ACTIVE version", async () => {
    const f = await fixture(
      "credential-superseded-active",
    );

    const newVersionId =
      await supersedeAndInsertActive(f);

    const result = await claimAs(f);

    expect(result.created).toBe(true);

    const attempt =
      await clients.migrator.query<{
        provider_credential_version_id: string;
      }>(
        `SELECT provider_credential_version_id
           FROM execution_attempts
          WHERE generation_authorization_id = $1`,
        [f.authorizationId],
      );

    expect(
      attempt.rows[0]!
        .provider_credential_version_id,
    ).toBe(f.versionId);

    expect(
      attempt.rows[0]!
        .provider_credential_version_id,
    ).not.toBe(newVersionId);
  });

  it("allows only the locked PENDING_VERIFICATION / UNVERIFIED SUPERSEDED exception with a distinct ACTIVE version", async () => {
    const f = await fixture(
      "credential-pending-exception",
    );

    const newVersionId =
      await rotateToPending(f);

    const result = await claimAs(f);

    expect(result.created).toBe(true);

    const attempt =
      await clients.migrator.query<{
        provider_credential_version_id: string;
      }>(
        `SELECT provider_credential_version_id
           FROM execution_attempts
          WHERE generation_authorization_id = $1`,
        [f.authorizationId],
      );

    expect(
      attempt.rows[0]!
        .provider_credential_version_id,
    ).toBe(f.versionId);

    expect(
      attempt.rows[0]!
        .provider_credential_version_id,
    ).not.toBe(newVersionId);
  });

  it("refuses PENDING_VERIFICATION when the immutable bound version is still ACTIVE", async () => {
    const f = await fixture(
      "credential-pending-active",
    );

    await clients.migrator.query(
      `UPDATE provider_connections
          SET status =
                'PENDING_VERIFICATION',
              verification_status =
                'UNVERIFIED',
              verified_at = NULL,
              last_verification_attempt_at =
                NULL,
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      [f.connectionId],
    );

    await expectRefusal(
      claimAs(f),
      "PROVIDER_CONNECTION_UNAVAILABLE",
    );

    expect(await claimSideEffects(f)).toEqual(
      NO_CLAIM,
    );
  });

  it.each(
    [
      "INVALID",
      "DISCONNECTED",
      "DISABLED",
    ] as const,
  )(
    "refuses ProviderConnection status %s",
    async (status) => {
      const f = await fixture(
        `connection-${status.toLowerCase()}`,
      );

      await setConnectionStatus(f, status);

      await expectRefusal(
        claimAs(f),
        "PROVIDER_CONNECTION_UNAVAILABLE",
      );

      expect(
        await claimSideEffects(f),
      ).toEqual(NO_CLAIM);
    },
  );

  it.each(
    [
      "RETAINED_FOR_RECOVERY",
      "DESTROYED",
    ] as const,
  )(
    "refuses bound credential status %s",
    async (status) => {
      const f = await fixture(
        `credential-${status.toLowerCase()}`,
      );

      await setBoundVersionUnavailable(
        f,
        status,
      );

      await expectRefusal(
        claimAs(f),
        "CREDENTIAL_UNAVAILABLE",
      );

      expect(
        await claimSideEffects(f),
      ).toEqual(NO_CLAIM);
    },
  );
});

describe("D. entitlement and Production revalidation", () => {
  it("refuses an archived Production", async () => {
    const f = await fixture(
      "production-archived",
    );

    await clients.migrator.query(
      `UPDATE productions
          SET archived_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      [f.productionId],
    );

    await expectRefusal(
      claimAs(f),
      "PRODUCTION_UNAVAILABLE",
    );

    expect(await claimSideEffects(f)).toEqual(
      NO_CLAIM,
    );
  });

  it("refuses a non-AVAILABLE FREE_BYO grant", async () => {
    const f = await fixture(
      "grant-revoked",
    );

    await clients.migrator.query(
      `UPDATE entitlement_grants
          SET state = 'REVOKED',
              revoked_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      [f.grantId],
    );

    await expectRefusal(
      claimAs(f),
      "ENTITLEMENT_NOT_AVAILABLE",
    );

    expect(await claimSideEffects(f)).toEqual(
      NO_CLAIM,
    );
  });

  it("refuses an unsupported FREE_BYO policy version", async () => {
    const f = await fixture(
      "grant-policy",
      {
        policyVersion:
          "unsupported-policy-v99",
      },
    );

    await expectRefusal(
      claimAs(f),
      "ENTITLEMENT_POLICY_UNSUPPORTED",
    );

    expect(await claimSideEffects(f)).toEqual(
      NO_CLAIM,
    );
  });
});

describe("E. replay and composition integrity", () => {
  it("replays the existing composition without new writes after later Production, entitlement and connection lifecycle changes", async () => {
    const f = await fixture(
      "replay-dynamic",
    );

    const created = await claimAs(f, {
      correlationId: CLAIM_CORRELATION_1,
    });

    const before =
      await claimSideEffects(f);

    await setConnectionStatus(
      f,
      "DISCONNECTED",
    );

    await clients.migrator.query(
      `UPDATE productions
          SET archived_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      [f.productionId],
    );

    await clients.migrator.query(
      `UPDATE entitlement_grants
          SET state = 'REVOKED',
              revoked_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      [f.grantId],
    );

    const replay = await claimAs(f, {
      correlationId: CLAIM_CORRELATION_2,
    });

    expect(replay.created).toBe(false);

    expect(
      replay.executionJob.id,
    ).toBe(
      created.executionJob.id,
    );

    expect(
      replay.initialExecutionAttempt.id,
    ).toBe(
      created.initialExecutionAttempt.id,
    );

    expect(
      replay.claimedAt.getTime(),
    ).toBe(
      created.claimedAt.getTime(),
    );

    expect(
      replay.correlationId,
    ).toBe(CLAIM_CORRELATION_2);

    expect(await claimSideEffects(f)).toEqual(
      before,
    );

    expect(before).toEqual(ONE_CLAIM);
  });

  it("fails closed on a malformed CLAIMED authorization with no canonical composition and does not repair it", async () => {
    const f = await fixture(
      "replay-malformed",
    );

    await clients.migrator.query(
      `UPDATE generation_authorizations
          SET status = 'CLAIMED',
              claimed_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      [f.authorizationId],
    );

    await expectRefusal(
      claimAs(f),
      "GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION",
    );

    expect(
      await authorizationLifecycle(
        f.authorizationId,
      ),
    ).toMatchObject({
      status: "CLAIMED",
    });

    expect(await claimSideEffects(f)).toEqual(
      NO_CLAIM,
    );
  });
});

describe("F. concurrent claim idempotency", () => {
  it("commits one logical claim for concurrent callers and makes every loser an exact replay", async () => {
    const f = await fixture(
      "concurrent",
    );

    const parties = 4;

    const racePools =
      await Promise.all(
        Array.from(
          {
            length: parties,
          },
          () => runtimePool(),
        ),
      );

    let arrived = 0;

    let open!: () => void;

    const gate =
      new Promise<void>((resolve) => {
        open = resolve;
      });

    const barrierPool = (
      base: TransactionalPool,
    ): TransactionalPool => ({
      ...base,

      connect: async () => {
        const client =
          await base.connect();

        arrived += 1;

        if (arrived === parties) {
          open();
        }

        await gate;

        return client;
      },
    });

    const outcomes =
      await Promise.all(
        racePools.map(
          (racePool) =>
            claimAs(f, {
              pool:
                barrierPool(racePool),
            }),
        ),
      );

    expect(
      outcomes.filter(
        (outcome) => outcome.created,
      ),
    ).toHaveLength(1);

    expect(
      new Set(
        outcomes.map(
          (outcome) =>
            outcome.executionJob.id,
        ),
      ).size,
    ).toBe(1);

    expect(
      new Set(
        outcomes.map(
          (outcome) =>
            outcome
              .initialExecutionAttempt
              .id,
        ),
      ).size,
    ).toBe(1);

    expect(await claimSideEffects(f)).toEqual(
      ONE_CLAIM,
    );
  });
});

describe("G. real PostgreSQL total rollback", () => {
  it("rolls back CLAIMED, job, attempt and usage when the final audit operation fails", async () => {
    const f = await fixture(
      "audit-rollback",
    );

    let sawClaimTransition = false;
    let insertedJobId:
      | string
      | undefined;
    let insertedAttemptId:
      | string
      | undefined;
    let usageInserted = false;
    let auditAttempted = false;

    const failingAudit: TransactionalPool = {
      ...pool,

      connect: async () => {
        const client =
          await pool.connect();

        const wrapped: RuntimeClient = {
          query: async <Row extends object>(
            sql: string,
            params?: unknown[],
          ) => {
            if (
              /INSERT INTO audit_events/.test(
                sql,
              )
            ) {
              auditAttempted = true;

              throw Object.assign(
                new Error(
                  "synthetic claim audit failure secret-marker",
                ),
                {
                  code: "XX000",
                },
              );
            }

            const result =
              await client.query<Row>(
                sql,
                params,
              );

            if (
              /UPDATE generation_authorizations AS g/.test(
                sql,
              )
            ) {
              sawClaimTransition =
                result.rows.length === 1;
            }

            if (
              /INSERT INTO execution_jobs/.test(
                sql,
              )
            ) {
              insertedJobId =
                (
                  result.rows[0] as
                    | {
                        id?: string;
                      }
                    | undefined
                )?.id;
            }

            if (
              /INSERT INTO execution_attempts/.test(
                sql,
              )
            ) {
              insertedAttemptId =
                (
                  result.rows[0] as
                    | {
                        id?: string;
                      }
                    | undefined
                )?.id;
            }

            if (
              /INSERT INTO generation_usage_ledger/.test(
                sql,
              )
            ) {
              usageInserted = true;
            }

            return result;
          },

          release: (error?: Error) =>
            client.release(error),
        };

        return wrapped;
      },
    };

    const error = await expectRefusal(
      claimAs(f, {
        pool: failingAudit,
      }),
      "GENERATION_AUTHORIZATION_CLAIM_DATABASE_FAILURE",
    );

    expect(error.databaseCode).toBe("XX000");

    expect(error.message).toBe(
      "The generation authorization claim could not be completed.",
    );

    expect(error.message).not.toContain(
      "secret-marker",
    );

    expect(sawClaimTransition).toBe(true);
    expect(insertedJobId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(insertedAttemptId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(usageInserted).toBe(true);
    expect(auditAttempted).toBe(true);

    expect(
      await authorizationLifecycle(
        f.authorizationId,
      ),
    ).toMatchObject({
      status: "ISSUED",
      claimed_at: null,
    });

    expect(await claimSideEffects(f)).toEqual(
      NO_CLAIM,
    );

    expect(
      (
        await clients.migrator.query(
          `SELECT id
             FROM execution_jobs
            WHERE id = $1`,
          [insertedJobId],
        )
      ).rows,
    ).toEqual([]);

    expect(
      (
        await clients.migrator.query(
          `SELECT id
             FROM execution_attempts
            WHERE id = $1`,
          [insertedAttemptId],
        )
      ).rows,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Real lock-race harness.
// ---------------------------------------------------------------------------

type Instrumented = Readonly<{
  pool: TransactionalPool;
  pid: Promise<number>;
  reached: Promise<void>;
  resume: () => void;
}>;

function instrumented(
  base: TransactionalPool,
  pauseAfter?: RegExp,
): Instrumented {
  let resolvePid!: (
    pid: number,
  ) => void;

  const pid =
    new Promise<number>((resolve) => {
      resolvePid = resolve;
    });

  let signal!: () => void;

  const reached =
    new Promise<void>((resolve) => {
      signal = resolve;
    });

  let resume!: () => void;

  const resumed =
    new Promise<void>((resolve) => {
      resume = resolve;
    });

  let paused = false;

  return {
    pid,
    reached,
    resume,

    pool: {
      ...base,

      connect: async () => {
        const client =
          await base.connect();

        resolvePid(
          (
            await client.query<{
              pid: number;
            }>(
              "SELECT pg_backend_pid() AS pid",
            )
          ).rows[0]!.pid,
        );

        const wrapped: RuntimeClient = {
          query: async <Row extends object>(
            sql: string,
            params?: unknown[],
          ) => {
            const result =
              await client.query<Row>(
                sql,
                params,
              );

            if (
              pauseAfter !== undefined &&
              !paused &&
              pauseAfter.test(sql)
            ) {
              paused = true;
              signal();
              await resumed;
            }

            return result;
          },

          release: (error?: Error) =>
            client.release(error),
        };

        return wrapped;
      },
    },
  };
}

async function backendPid(
  client: pg.Client,
): Promise<number> {
  return (
    await client.query<{
      pid: number;
    }>(
      "SELECT pg_backend_pid() AS pid",
    )
  ).rows[0]!.pid;
}

async function blockedBy(
  waiter: number,
  holder: number,
): Promise<void> {
  const deadline =
    Date.now() + 10_000;

  for (;;) {
    const result =
      await clients.migrator.query<{
        blocked: boolean;
      }>(
        `SELECT
           $2::int =
             ANY (
               pg_blocking_pids(
                 $1::int
               )
             ) AS blocked`,
        [
          waiter,
          holder,
        ],
      );

    if (
      result.rows[0]!.blocked
    ) {
      return;
    }

    if (
      Date.now() > deadline
    ) {
      throw new Error(
        `session ${waiter} never blocked on ${holder}`,
      );
    }

    await new Promise(
      (resolve) =>
        setImmediate(resolve),
    );
  }
}

type Mutation = Readonly<{
  statements: readonly (
    readonly [
      string,
      (f: Fixture) => unknown[],
    ]
  )[];
}>;

const USER_DISABLE: Mutation = {
  statements: [
    [
      `UPDATE users
          SET status = 'DISABLED',
              disabled_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      (f) => [f.userId],
    ],
  ],
};

const ACCOUNT_DISABLE: Mutation = {
  statements: [
    [
      `UPDATE accounts
          SET status = 'DISABLED',
              disabled_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      (f) => [f.accountId],
    ],
  ],
};

const CONNECTION_DISCONNECT: Mutation = {
  statements: [
    [
      `UPDATE provider_connections
          SET status = 'DISCONNECTED',
              disconnected_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      (f) => [f.connectionId],
    ],
  ],
};

const CONNECTION_ROTATE: Mutation = {
  statements: [
    [
      `SELECT id
         FROM provider_connections
        WHERE id = $1
        FOR UPDATE`,
      (f) => [f.connectionId],
    ],
    [
      `UPDATE provider_credential_versions
          SET status = 'SUPERSEDED',
              superseded_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      (f) => [f.versionId],
    ],
    [
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
          2,
          'ACTIVE',
          '{"format":"fixture-envelope"}'::jsonb,
          'HMAC-SHA-256',
          'fixture/v1',
          $3,
          $4)`,
      (f) => [
        f.accountId,
        f.connectionId,
        fingerprint(),
        f.userId,
      ],
    ],
    [
      `UPDATE provider_connections
          SET status =
                'PENDING_VERIFICATION',
              verification_status =
                'UNVERIFIED',
              verified_at = NULL,
              last_verification_attempt_at =
                NULL,
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      (f) => [f.connectionId],
    ],
  ],
};

const PRODUCTION_ARCHIVE: Mutation = {
  statements: [
    [
      `UPDATE productions
          SET archived_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      (f) => [f.productionId],
    ],
  ],
};

const GRANT_REVOKE: Mutation = {
  statements: [
    [
      `UPDATE entitlement_grants
          SET state = 'REVOKED',
              revoked_at =
                clock_timestamp(),
              updated_at =
                clock_timestamp()
        WHERE id = $1`,
      (f) => [f.grantId],
    ],
  ],
};

async function mutationWinsRefusal(
  f: Fixture,
  mutation: Mutation,
  code: string,
): Promise<void> {
  const holder =
    await connectAs(
      clients.config.runtimeUrl,
      APPROVED_RUNTIME_ROLE,
    );

  try {
    const holderPid =
      await backendPid(holder);

    await holder.query("BEGIN");

    for (
      const [
        sql,
        params,
      ] of mutation.statements
    ) {
      await holder.query(
        sql,
        params(f),
      );
    }

    const probe =
      instrumented(pool);

    const pending =
      claimAs(f, {
        pool: probe.pool,
      }).then(
        () => undefined,
        (error: unknown) =>
          error,
      );

    await blockedBy(
      await probe.pid,
      holderPid,
    );

    await holder.query("COMMIT");

    const error = await pending;

    expect(error).toBeInstanceOf(
      GenerationAuthorizationClaimError,
    );

    expect(
      (
        error as
          GenerationAuthorizationClaimError
      ).code,
    ).toBe(code);

    expect(
      await claimSideEffects(f),
    ).toEqual(NO_CLAIM);
  } finally {
    await holder
      .query("ROLLBACK")
      .catch(() => undefined);

    await holder.end();
  }
}

async function claimHoldsThenMutation(
  f: Fixture,
  pauseAfter: RegExp,
  mutation: Mutation,
): Promise<ClaimGenerationAuthorizationResult> {
  const probe =
    instrumented(
      pool,
      pauseAfter,
    );

  const pending =
    claimAs(f, {
      pool: probe.pool,
    });

  await probe.reached;

  const claimPid =
    await probe.pid;

  const mutator =
    await connectAs(
      clients.config.runtimeUrl,
      APPROVED_RUNTIME_ROLE,
    );

  try {
    const mutatorPid =
      await backendPid(mutator);

    await mutator.query("BEGIN");

    const [
      firstSql,
      firstParams,
    ] =
      mutation.statements[0]!;

    const rest =
      mutation.statements.slice(1);

    let mutationSettled = false;

    const blocked =
      mutator
        .query(
          firstSql,
          firstParams(f),
        )
        .finally(() => {
          mutationSettled = true;
        });

    await blockedBy(
      mutatorPid,
      claimPid,
    );

    expect(
      mutationSettled,
    ).toBe(false);

    expect(
      await claimSideEffects(f),
    ).toEqual(NO_CLAIM);

    probe.resume();

    const claimed =
      await pending;

    expect(claimed.created).toBe(true);

    await blocked;

    for (
      const [
        sql,
        params,
      ] of rest
    ) {
      await mutator.query(
        sql,
        params(f),
      );
    }

    await mutator.query("COMMIT");

    expect(
      await claimSideEffects(f),
    ).toEqual(ONE_CLAIM);

    return claimed;
  } finally {
    probe.resume();

    await mutator
      .query("ROLLBACK")
      .catch(() => undefined);

    await mutator.end();
  }
}

async function rotationWins(
  f: Fixture,
): Promise<ClaimGenerationAuthorizationResult> {
  const holder =
    await connectAs(
      clients.config.runtimeUrl,
      APPROVED_RUNTIME_ROLE,
    );

  try {
    const holderPid =
      await backendPid(holder);

    await holder.query("BEGIN");

    for (
      const [
        sql,
        params,
      ] of CONNECTION_ROTATE.statements
    ) {
      await holder.query(
        sql,
        params(f),
      );
    }

    const probe =
      instrumented(pool);

    const pending =
      claimAs(f, {
        pool: probe.pool,
      });

    await blockedBy(
      await probe.pid,
      holderPid,
    );

    await holder.query("COMMIT");

    const claimed =
      await pending;

    expect(claimed.created).toBe(true);

    expect(
      await claimSideEffects(f),
    ).toEqual(ONE_CLAIM);

    return claimed;
  } finally {
    await holder
      .query("ROLLBACK")
      .catch(() => undefined);

    await holder.end();
  }
}

const AFTER_USER_LOCK =
  /FROM users WHERE id = \$1 FOR SHARE$/;

const AFTER_ACCOUNT_LOCK =
  /FROM accounts WHERE id = \$1 FOR NO KEY UPDATE$/;

const AFTER_CONNECTION_LOCK =
  /FROM provider_connections[\s\S]*WHERE account_id = \$1[\s\S]*AND id = \$2[\s\S]*FOR UPDATE$/;

const AFTER_PRODUCTION_LOCK =
  /FROM productions[\s\S]*WHERE account_id = \$1[\s\S]*AND id = \$2[\s\S]*FOR SHARE$/;

const AFTER_GRANT_LOCK =
  /FROM entitlement_grants[\s\S]*WHERE account_id = \$1[\s\S]*AND id = \$2[\s\S]*FOR SHARE$/;

describe("H. real PostgreSQL lifecycle lock races", () => {
  it("1. User disablement that wins first makes claim refuse", async () => {
    await mutationWinsRefusal(
      await fixture(
        "race-user-first",
      ),
      USER_DISABLE,
      "PRINCIPAL_UNAVAILABLE",
    );
  });

  it("2. claim holding the User eligibility lock prevents disablement from committing ahead of the claim", async () => {
    const f = await fixture(
      "race-user-held",
    );

    await claimHoldsThenMutation(
      f,
      AFTER_USER_LOCK,
      USER_DISABLE,
    );

    expect(
      (
        await clients.migrator.query<{
          status: string;
        }>(
          `SELECT status
             FROM users
            WHERE id = $1`,
          [f.userId],
        )
      ).rows,
    ).toEqual([
      {
        status: "DISABLED",
      },
    ]);
  });

  it("3. Account disablement that wins first makes claim refuse", async () => {
    await mutationWinsRefusal(
      await fixture(
        "race-account-first",
      ),
      ACCOUNT_DISABLE,
      "PRINCIPAL_UNAVAILABLE",
    );
  });

  it("4. claim holding the Account lifecycle lock prevents disablement from committing ahead of the claim", async () => {
    const f = await fixture(
      "race-account-held",
    );

    await claimHoldsThenMutation(
      f,
      AFTER_ACCOUNT_LOCK,
      ACCOUNT_DISABLE,
    );

    expect(
      (
        await clients.migrator.query<{
          status: string;
        }>(
          `SELECT status
             FROM accounts
            WHERE id = $1`,
          [f.accountId],
        )
      ).rows,
    ).toEqual([
      {
        status: "DISABLED",
      },
    ]);
  });

  it("5. disconnect that owns the ProviderConnection lifecycle lock first makes claim refuse", async () => {
    await mutationWinsRefusal(
      await fixture(
        "race-disconnect-first",
      ),
      CONNECTION_DISCONNECT,
      "PROVIDER_CONNECTION_UNAVAILABLE",
    );
  });

  it("6. claim holding the ProviderConnection lifecycle lock commits before a waiting disconnect", async () => {
    const f = await fixture(
      "race-disconnect-held",
    );

    await claimHoldsThenMutation(
      f,
      AFTER_CONNECTION_LOCK,
      CONNECTION_DISCONNECT,
    );

    expect(
      (
        await clients.migrator.query<{
          status: string;
        }>(
          `SELECT status
             FROM provider_connections
            WHERE id = $1`,
          [f.connectionId],
        )
      ).rows,
    ).toEqual([
      {
        status: "DISCONNECTED",
      },
    ]);

    expect(
      await authorizationLifecycle(
        f.authorizationId,
      ),
    ).toMatchObject({
      status: "CLAIMED",
    });
  });

  it("7. rotation that owns the ProviderConnection lifecycle lock first is admitted only through the locked SUPERSEDED exception", async () => {
    const f = await fixture(
      "race-rotation-first",
    );

    await rotationWins(f);

    const attempt =
      await clients.migrator.query<{
        provider_credential_version_id: string;
      }>(
        `SELECT provider_credential_version_id
           FROM execution_attempts
          WHERE generation_authorization_id = $1`,
        [f.authorizationId],
      );

    expect(
      attempt.rows[0]!
        .provider_credential_version_id,
    ).toBe(f.versionId);

    expect(
      (
        await clients.migrator.query<{
          status: string;
        }>(
          `SELECT status
             FROM provider_credential_versions
            WHERE id = $1`,
          [f.versionId],
        )
      ).rows,
    ).toEqual([
      {
        status: "SUPERSEDED",
      },
    ]);
  });

  it("8. claim holding the ProviderConnection lifecycle lock commits before rotation and never rebinds the authorization", async () => {
    const f = await fixture(
      "race-rotation-held",
    );

    await claimHoldsThenMutation(
      f,
      AFTER_CONNECTION_LOCK,
      CONNECTION_ROTATE,
    );

    const authorization =
      await clients.migrator.query<{
        provider_credential_version_id: string;
      }>(
        `SELECT provider_credential_version_id
           FROM generation_authorizations
          WHERE id = $1`,
        [f.authorizationId],
      );

    expect(
      authorization.rows[0]!
        .provider_credential_version_id,
    ).toBe(f.versionId);

    const attempt =
      await clients.migrator.query<{
        provider_credential_version_id: string;
      }>(
        `SELECT provider_credential_version_id
           FROM execution_attempts
          WHERE generation_authorization_id = $1`,
        [f.authorizationId],
      );

    expect(
      attempt.rows[0]!
        .provider_credential_version_id,
    ).toBe(f.versionId);
  });

  it("9. Production archival that wins first makes claim refuse", async () => {
    await mutationWinsRefusal(
      await fixture(
        "race-production-first",
      ),
      PRODUCTION_ARCHIVE,
      "PRODUCTION_UNAVAILABLE",
    );
  });

  it("10. claim holding the Production eligibility lock commits before waiting archival", async () => {
    const f = await fixture(
      "race-production-held",
    );

    await claimHoldsThenMutation(
      f,
      AFTER_PRODUCTION_LOCK,
      PRODUCTION_ARCHIVE,
    );

    expect(
      (
        await clients.migrator.query<{
          archived: boolean;
        }>(
          `SELECT
             archived_at IS NOT NULL
               AS archived
           FROM productions
           WHERE id = $1`,
          [f.productionId],
        )
      ).rows,
    ).toEqual([
      {
        archived: true,
      },
    ]);
  });

  it("11. entitlement revocation that wins first makes claim refuse", async () => {
    await mutationWinsRefusal(
      await fixture(
        "race-grant-first",
      ),
      GRANT_REVOKE,
      "ENTITLEMENT_NOT_AVAILABLE",
    );
  });

  it("12. claim holding the entitlement eligibility lock commits before waiting revocation", async () => {
    const f = await fixture(
      "race-grant-held",
    );

    await claimHoldsThenMutation(
      f,
      AFTER_GRANT_LOCK,
      GRANT_REVOKE,
    );

    expect(
      (
        await clients.migrator.query<{
          state: string;
        }>(
          `SELECT state
             FROM entitlement_grants
            WHERE id = $1`,
          [f.grantId],
        )
      ).rows,
    ).toEqual([
      {
        state: "REVOKED",
      },
    ]);
  });
});
