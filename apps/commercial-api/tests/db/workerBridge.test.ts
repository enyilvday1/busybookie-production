import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  expectSqlError,
  inRolledBackTransaction,
  insertAccountWithFreeGrant,
  openGuardedClients,
  prepareSchemaV1,
  type GuardedClients,
} from "./support/testDatabase.js";

// Migration 0004 invariants against PostgreSQL 16. Application writes run as
// the restricted runtime role inside rolled-back transactions. Worker
// principals are provisioned by the owner (the runtime role cannot insert
// them), committed in beforeAll and removed by the schema reset in afterAll.
// Sealed envelopes and fingerprints are inert fixture values: no credential
// plaintext exists anywhere in this suite.

const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const DENIED = "42501";

const STATES = [
  "QUEUED",
  "LEASED",
  "SUBMITTING",
  "SUBMITTED",
  "SUCCEEDED",
  "FAILED_BEFORE_SUBMISSION",
  "OUTCOME_UNKNOWN",
  "SUBMITTED_FAILED",
  "ABANDONED",
  "CANCELLED",
] as const;
type State = (typeof STATES)[number];

const ALLOWED: Readonly<Record<State, readonly State[]>> = {
  QUEUED: ["LEASED", "CANCELLED"],
  LEASED: ["QUEUED", "SUBMITTING", "FAILED_BEFORE_SUBMISSION", "CANCELLED"],
  SUBMITTING: ["SUBMITTED", "OUTCOME_UNKNOWN", "FAILED_BEFORE_SUBMISSION"],
  SUBMITTED: ["SUCCEEDED", "SUBMITTED_FAILED", "ABANDONED"],
  OUTCOME_UNKNOWN: ["SUBMITTED", "ABANDONED"],
  SUCCEEDED: [],
  FAILED_BEFORE_SUBMISSION: [],
  SUBMITTED_FAILED: [],
  ABANDONED: [],
  CANCELLED: [],
};

// A path from QUEUED to each state through allowed transitions only.
const PATH_TO: Readonly<Record<State, readonly State[]>> = {
  QUEUED: [],
  LEASED: ["LEASED"],
  SUBMITTING: ["LEASED", "SUBMITTING"],
  SUBMITTED: ["LEASED", "SUBMITTING", "SUBMITTED"],
  OUTCOME_UNKNOWN: ["LEASED", "SUBMITTING", "OUTCOME_UNKNOWN"],
  SUCCEEDED: ["LEASED", "SUBMITTING", "SUBMITTED", "SUCCEEDED"],
  FAILED_BEFORE_SUBMISSION: ["LEASED", "FAILED_BEFORE_SUBMISSION"],
  SUBMITTED_FAILED: ["LEASED", "SUBMITTING", "SUBMITTED", "SUBMITTED_FAILED"],
  ABANDONED: ["LEASED", "SUBMITTING", "SUBMITTED", "ABANDONED"],
  CANCELLED: ["CANCELLED"],
};

let clients: GuardedClients;
let workerA: string;
let workerB: string;

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
  const inserted = await clients.migrator.query<{ id: string }>(
    "INSERT INTO worker_principals (label) VALUES ('fixture-worker-a'), ('fixture-worker-b') RETURNING id",
  );
  [workerA, workerB] = inserted.rows.map((row) => row.id) as [string, string];
});

afterAll(async () => {
  // Leave the database at the latest schema with runtime grants and no rows.
  await prepareSchemaV1(clients);
  await clients.close();
});

// ---------------------------------------------------------------------------
// Fixtures

type Owner = Readonly<{ userId: string; accountId: string; grantId: string }>;
type Fixture = Owner &
  Readonly<{ productionId: string; connectionId: string; versionId: string; authorizationId: string; jobId: string; provider: string }>;

let fixtureCounter = 0;

async function insertConnection(client: pg.Client, owner: Owner, provider: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    "INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id) VALUES ($1, $2, 'API_KEY', $3) RETURNING id",
    [owner.accountId, provider, owner.userId],
  );
  return result.rows[0]!.id;
}

async function insertVersion(client: pg.Client, owner: Owner, connectionId: string, version = 1): Promise<string> {
  fixtureCounter += 1;
  const result = await client.query<{ id: string }>(
    `INSERT INTO provider_credential_versions
       (account_id, provider_connection_id, credential_version, status, sealed_credential,
        fingerprint_algorithm, fingerprint_key_ref, fingerprint_value, created_by_user_id)
     VALUES ($1, $2, $3, 'ACTIVE', '{"format":"fixture-envelope"}'::jsonb, 'HMAC-SHA-256', 'fixture/v1', $4, $5) RETURNING id`,
    [owner.accountId, connectionId, version, String(fixtureCounter).padStart(43, "B"), owner.userId],
  );
  return result.rows[0]!.id;
}

async function insertAuthorization(
  client: pg.Client,
  owner: Owner & Readonly<{ productionId: string }>,
  binding: Readonly<{ provider: string; connectionId: string; versionId: string }>,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO generation_authorizations
       (account_id, production_id, entitlement_grant_id, billing_mode, provider, model, provider_connection_id,
        provider_credential_version_id, generation_request, generation_request_sha256, expected_cost_cap_unit,
        expected_cost_cap_amount, expires_at, created_by_user_id)
     VALUES ($1, $2, $3, 'USER_BYO', $4, 'example-model-1', $5, $6, '{"prompt":"fixture"}'::jsonb, repeat('c', 64),
             'MICRO_USD', 1000000, now() + interval '15 minutes', $7)
     RETURNING id`,
    [owner.accountId, owner.productionId, owner.grantId, binding.provider, binding.connectionId, binding.versionId, owner.userId],
  );
  return result.rows[0]!.id;
}

async function insertJob(client: pg.Client, f: Readonly<{ accountId: string; productionId: string; authorizationId: string }>): Promise<string> {
  const result = await client.query<{ id: string }>(
    "INSERT INTO execution_jobs (account_id, production_id, generation_authorization_id) VALUES ($1, $2, $3) RETURNING id",
    [f.accountId, f.productionId, f.authorizationId],
  );
  return result.rows[0]!.id;
}

async function fixture(client: pg.Client, subject: string, provider = "EXAMPLE_PROVIDER"): Promise<Fixture> {
  const owner = await insertAccountWithFreeGrant(client, subject);
  const production = await client.query<{ id: string }>(
    "INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id) VALUES ($1, 'Production', $2, $3) RETURNING id",
    [owner.accountId, owner.grantId, owner.userId],
  );
  const productionId = production.rows[0]!.id;
  const connectionId = await insertConnection(client, owner, provider);
  const versionId = await insertVersion(client, owner, connectionId);
  const authorizationId = await insertAuthorization(client, { ...owner, productionId }, { provider, connectionId, versionId });
  const jobId = await insertJob(client, { accountId: owner.accountId, productionId, authorizationId });
  return { ...owner, productionId, connectionId, versionId, authorizationId, jobId, provider };
}

// Another authorization and job sharing the fixture's exact credential version.
async function siblingJob(client: pg.Client, f: Fixture): Promise<Fixture> {
  const authorizationId = await insertAuthorization(client, f, f);
  const jobId = await insertJob(client, { ...f, authorizationId });
  return { ...f, authorizationId, jobId };
}

type AttemptInput = Readonly<{
  accountId: string;
  jobId: string;
  authorizationId: string;
  attemptNumber?: number;
  billingMode?: string;
  provider: string;
  versionId: string | null;
  state?: string;
  fencing?: number;
}>;

const INSERT_ATTEMPT = `
INSERT INTO execution_attempts
  (account_id, execution_job_id, generation_authorization_id, attempt_number, billing_mode, provider,
   provider_credential_version_id, state, lease_fencing_counter)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`;

function attemptParams(input: AttemptInput): unknown[] {
  return [
    input.accountId,
    input.jobId,
    input.authorizationId,
    input.attemptNumber ?? 1,
    input.billingMode ?? "USER_BYO",
    input.provider,
    input.versionId,
    input.state ?? "QUEUED",
    input.fencing ?? 0,
  ];
}

function attemptFor(f: Fixture, overrides: Partial<AttemptInput> = {}): AttemptInput {
  return { accountId: f.accountId, jobId: f.jobId, authorizationId: f.authorizationId, provider: f.provider, versionId: f.versionId, ...overrides };
}

async function insertAttempt(client: pg.Client, input: AttemptInput): Promise<string> {
  const result = await client.query<{ id: string }>(INSERT_ATTEMPT, attemptParams(input));
  return result.rows[0]!.id;
}

// Canonical, otherwise-valid updates into each state.
const CLEAR_LEASE = "lease_worker_principal_id = NULL, lease_token_sha256 = NULL, leased_at = NULL, lease_expires_at = NULL, heartbeat_at = NULL";
const INTO: Readonly<Record<State, string>> = {
  QUEUED: `state = 'QUEUED', ${CLEAR_LEASE}, credential_granted_at = NULL`,
  LEASED: `state = 'LEASED', lease_worker_principal_id = $2, lease_token_sha256 = encode(sha256(gen_random_uuid()::text::bytea), 'hex'),
           lease_fencing_counter = lease_fencing_counter + 1, leased_at = now(), lease_expires_at = now() + interval '5 minutes', heartbeat_at = NULL`,
  SUBMITTING: "state = 'SUBMITTING', credential_granted_at = COALESCE(credential_granted_at, now()), submitting_at = now()",
  SUBMITTED: `state = 'SUBMITTED', provider_execution_id = COALESCE(provider_execution_id, 'provider-exec-' || id::text),
              submitted_at = COALESCE(submitted_at, now()), failure_code = NULL`,
  OUTCOME_UNKNOWN: `state = 'OUTCOME_UNKNOWN', ${CLEAR_LEASE}, failure_code = 'PROVIDER_CREATE_TIMEOUT'`,
  SUCCEEDED: `state = 'SUCCEEDED', ${CLEAR_LEASE}, output_object_key = 'accounts/' || account_id || '/attempts/' || id || '/output.mp4',
              output_sha256 = repeat('a', 64), output_byte_count = 1048576, output_content_type = 'video/mp4', completed_at = now()`,
  FAILED_BEFORE_SUBMISSION: `state = 'FAILED_BEFORE_SUBMISSION', ${CLEAR_LEASE}, failure_code = 'CREDENTIAL_UNAVAILABLE', completed_at = now()`,
  SUBMITTED_FAILED: `state = 'SUBMITTED_FAILED', ${CLEAR_LEASE}, failure_code = 'PROVIDER_GENERATION_FAILED', completed_at = now()`,
  ABANDONED: `state = 'ABANDONED', ${CLEAR_LEASE}, failure_code = 'RECOVERY_ABANDONED', completed_at = now()`,
  CANCELLED: `state = 'CANCELLED', ${CLEAR_LEASE}, completed_at = now()`,
};

async function move(client: pg.Client, attemptId: string, to: State, worker = workerA): Promise<void> {
  const params = to === "LEASED" ? [attemptId, worker] : [attemptId];
  await client.query(`UPDATE execution_attempts SET ${INTO[to]}, updated_at = now() WHERE id = $1`, params);
}

async function walk(client: pg.Client, attemptId: string, path: readonly State[]): Promise<void> {
  for (const state of path) await move(client, attemptId, state);
}

async function expectTriggerError(client: pg.Client, sql: string, params: readonly unknown[], fragment: string): Promise<void> {
  await client.query("SAVEPOINT trigger_probe");
  let caught: unknown;
  try {
    await client.query(sql, params as unknown[]);
  } catch (error) {
    caught = error;
  }
  await client.query("ROLLBACK TO SAVEPOINT trigger_probe");
  expect(caught, `expected rejection: ${sql}`).toBeInstanceOf(Error);
  expect((caught as { code?: string }).code).toBe(CHECK);
  expect((caught as Error).message).toContain(fragment);
}

async function stateOf(client: pg.Client, attemptId: string): Promise<string> {
  const result = await client.query<{ state: string }>("SELECT state FROM execution_attempts WHERE id = $1", [attemptId]);
  return result.rows[0]!.state;
}

// ---------------------------------------------------------------------------

describe("worker_principals", () => {
  it("stores machine principals, disabled consistently and never re-enabled", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const inserted = await clients.migrator.query<{ id: string; status: string }>(
        "INSERT INTO worker_principals (label) VALUES ('private-worker-1') RETURNING id, status",
      );
      expect(inserted.rows[0]!.status).toBe("ACTIVE");
      const id = inserted.rows[0]!.id;

      await expectSqlError(clients.migrator, "INSERT INTO worker_principals (label, status) VALUES ('w', 'SUSPENDED')", [], {
        code: CHECK,
        constraint: "worker_principals_status_ck",
      });
      await expectSqlError(clients.migrator, "INSERT INTO worker_principals (label, status) VALUES ('w', 'DISABLED')", [], {
        code: CHECK,
        constraint: "worker_principals_disabled_ck",
      });
      for (const label of ["", " padded", "padded ", "x".repeat(101)]) {
        await expectSqlError(clients.migrator, "INSERT INTO worker_principals (label) VALUES ($1)", [label], { code: CHECK, constraint: "worker_principals_label_ck" });
      }

      await clients.migrator.query("UPDATE worker_principals SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [id]);
      await expectTriggerError(
        clients.migrator,
        "UPDATE worker_principals SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1",
        [id],
        "cannot be re-enabled",
      );
      await expectTriggerError(clients.migrator, "UPDATE worker_principals SET label = 'renamed' WHERE id = $1", [id], "identity is immutable");
    });
  });

  it("lets the runtime role read and disable principals but never create them", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      await expectSqlError(clients.runtime, "INSERT INTO worker_principals (label) VALUES ('rogue-worker')", [], { code: DENIED });
      await expectSqlError(clients.runtime, "UPDATE worker_principals SET label = 'renamed' WHERE id = $1", [workerB], { code: DENIED });
      await expectSqlError(clients.runtime, "DELETE FROM worker_principals WHERE id = $1", [workerB], { code: DENIED });
      await clients.runtime.query("UPDATE worker_principals SET status = 'DISABLED', disabled_at = now(), updated_at = now() WHERE id = $1", [workerB]);
      expect((await clients.runtime.query("SELECT status FROM worker_principals WHERE id = $1", [workerB])).rows).toEqual([{ status: "DISABLED" }]);
    });
  });
});

describe("execution_jobs", () => {
  it("binds one job to exactly one same-account, same-production authorization", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const a = await fixture(clients.runtime, "wb-job-a");
      const b = await fixture(clients.runtime, "wb-job-b");
      const job = await clients.runtime.query("SELECT status, completed_at FROM execution_jobs WHERE id = $1", [a.jobId]);
      expect(job.rows).toEqual([{ status: "QUEUED", completed_at: null }]);

      const INSERT_JOB = "INSERT INTO execution_jobs (account_id, production_id, generation_authorization_id) VALUES ($1, $2, $3)";
      await expectSqlError(clients.runtime, INSERT_JOB, [a.accountId, a.productionId, a.authorizationId], {
        code: UNIQUE,
        constraint: "execution_jobs_authorization_uq",
      });
      const fresh = await insertAuthorization(clients.runtime, a, a);
      const freshB = await insertAuthorization(clients.runtime, b, b);
      // Another account's authorization, or a different production of the same account.
      await expectSqlError(clients.runtime, INSERT_JOB, [a.accountId, a.productionId, freshB], {
        code: FOREIGN_KEY,
        constraint: "execution_jobs_authorization_same_production_fk",
      });
      await expectSqlError(clients.runtime, INSERT_JOB, [b.accountId, b.productionId, fresh], {
        code: FOREIGN_KEY,
        constraint: "execution_jobs_authorization_same_production_fk",
      });
      const otherProduction = await clients.runtime.query<{ id: string }>(
        "INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id) VALUES ($1, 'Other', $2, $3) RETURNING id",
        [a.accountId, a.grantId, a.userId],
      );
      await expectSqlError(clients.runtime, INSERT_JOB, [a.accountId, otherProduction.rows[0]!.id, fresh], {
        code: FOREIGN_KEY,
        constraint: "execution_jobs_authorization_same_production_fk",
      });
      await expectTriggerError(
        clients.runtime,
        "INSERT INTO execution_jobs (account_id, production_id, generation_authorization_id, status, completed_at) VALUES ($1, $2, $3, 'SUCCEEDED', now())",
        [a.accountId, a.productionId, fresh],
        "created QUEUED",
      );
    });
  });

  it("keeps coarse status, terminal completion and immutable provenance", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-job-status");
      await expectSqlError(clients.runtime, "UPDATE execution_jobs SET status = 'SUBMITTING' WHERE id = $1", [f.jobId], {
        code: CHECK,
        constraint: "execution_jobs_status_ck",
      });
      await expectSqlError(clients.runtime, "UPDATE execution_jobs SET status = 'SUCCEEDED' WHERE id = $1", [f.jobId], {
        code: CHECK,
        constraint: "execution_jobs_completed_at_ck",
      });
      for (const status of ["RUNNING", "NEEDS_ATTENTION", "RUNNING"]) {
        await clients.runtime.query("UPDATE execution_jobs SET status = $2 WHERE id = $1", [f.jobId, status]);
      }
      await clients.runtime.query("UPDATE execution_jobs SET status = 'SUCCEEDED', completed_at = now() WHERE id = $1", [f.jobId]);
      await expectTriggerError(clients.runtime, "UPDATE execution_jobs SET status = 'RUNNING', completed_at = NULL WHERE id = $1", [f.jobId], "terminal");
      for (const column of ["account_id", "production_id", "generation_authorization_id"]) {
        await expectSqlError(clients.runtime, `UPDATE execution_jobs SET ${column} = gen_random_uuid() WHERE id = $1`, [f.jobId], { code: DENIED });
      }
    });
    await inRolledBackTransaction(clients.migrator, async () => {
      const f = await fixture(clients.migrator, "wb-job-owner");
      const other = await insertAuthorization(clients.migrator, f, f);
      await expectTriggerError(clients.migrator, "UPDATE execution_jobs SET generation_authorization_id = $2 WHERE id = $1", [f.jobId, other], "provenance is immutable");
    });
  });

  it("supports the future claim transaction: claim the authorization, create the job and its first attempt", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-claim");
      const authorizationId = await insertAuthorization(clients.runtime, f, f);
      const locked = await clients.runtime.query(
        "SELECT id FROM generation_authorizations WHERE id = $1 AND status = 'ISSUED' AND expires_at > now() FOR UPDATE",
        [authorizationId],
      );
      expect(locked.rowCount).toBe(1);
      await clients.runtime.query("UPDATE generation_authorizations SET status = 'CLAIMED', claimed_at = now() WHERE id = $1", [authorizationId]);
      const jobId = await insertJob(clients.runtime, { ...f, authorizationId });
      const attemptId = await insertAttempt(clients.runtime, attemptFor({ ...f, authorizationId, jobId }));
      expect(await stateOf(clients.runtime, attemptId)).toBe("QUEUED");
    });
  });
});

describe("execution_attempts provenance", () => {
  it("binds the attempt to the authorization's billing mode, provider and exact credential version", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const a = await fixture(clients.runtime, "wb-attempt-a");
      const b = await fixture(clients.runtime, "wb-attempt-b");
      const id = await insertAttempt(clients.runtime, attemptFor(a));
      const row = await clients.runtime.query(
        "SELECT state, attempt_number, billing_mode, provider, provider_credential_version_id, lease_fencing_counter FROM execution_attempts WHERE id = $1",
        [id],
      );
      expect(row.rows).toEqual([
        { state: "QUEUED", attempt_number: 1, billing_mode: "USER_BYO", provider: a.provider, provider_credential_version_id: a.versionId, lease_fencing_counter: "0" },
      ]);
      await move(clients.runtime, id, "CANCELLED");

      // A rotated v2 of the same connection, another connection's version, and another account's version.
      await clients.runtime.query("UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now() WHERE id = $1", [a.versionId]);
      const rotated = await insertVersion(clients.runtime, a, a.connectionId, 2);
      const otherConnection = await insertConnection(clients.runtime, a, a.provider);
      const otherConnectionVersion = await insertVersion(clients.runtime, a, otherConnection);
      for (const versionId of [rotated, otherConnectionVersion, b.versionId]) {
        await expectSqlError(clients.runtime, INSERT_ATTEMPT, attemptParams(attemptFor(a, { attemptNumber: 2, versionId })), {
          code: FOREIGN_KEY,
          constraint: "execution_attempts_authorization_credential_fk",
        });
      }

      await expectSqlError(clients.runtime, INSERT_ATTEMPT, attemptParams(attemptFor(a, { attemptNumber: 2, provider: "OTHER_PROVIDER" })), {
        code: FOREIGN_KEY,
        constraint: "execution_attempts_authorization_provider_fk",
      });
      await expectSqlError(
        clients.runtime,
        INSERT_ATTEMPT,
        attemptParams(attemptFor(a, { attemptNumber: 2, billingMode: "PLATFORM_HOSTED", versionId: null })),
        { code: FOREIGN_KEY, constraint: "execution_attempts_authorization_provider_fk" },
      );
      await expectSqlError(clients.runtime, INSERT_ATTEMPT, attemptParams(attemptFor(a, { attemptNumber: 2, versionId: null })), {
        code: CHECK,
        constraint: "execution_attempts_credential_binding_ck",
      });
      // Another account's job, and this account's job with a different authorization.
      await expectSqlError(clients.runtime, INSERT_ATTEMPT, attemptParams(attemptFor(a, { attemptNumber: 2, jobId: b.jobId })), {
        code: FOREIGN_KEY,
        constraint: "execution_attempts_job_same_authorization_fk",
      });
      const sibling = await siblingJob(clients.runtime, b);
      await expectSqlError(clients.runtime, INSERT_ATTEMPT, attemptParams(attemptFor(b, { jobId: sibling.jobId })), {
        code: FOREIGN_KEY,
        constraint: "execution_attempts_job_same_authorization_fk",
      });
      await expectSqlError(clients.runtime, INSERT_ATTEMPT, attemptParams(attemptFor(b, { accountId: a.accountId })), {
        code: FOREIGN_KEY,
        constraint: "execution_attempts_job_same_authorization_fk",
      });
    });
  });

  it("numbers attempts from 1, uniquely per job, with at most one open attempt", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-numbering");
      await expectSqlError(clients.runtime, INSERT_ATTEMPT, attemptParams(attemptFor(f, { attemptNumber: 0 })), {
        code: CHECK,
        constraint: "execution_attempts_number_ck",
      });
      const first = await insertAttempt(clients.runtime, attemptFor(f));
      await expectSqlError(clients.runtime, INSERT_ATTEMPT, attemptParams(attemptFor(f, { attemptNumber: 2 })), {
        code: UNIQUE,
        constraint: "execution_attempts_one_open_per_job_uq",
      });
      await walk(clients.runtime, first, PATH_TO.FAILED_BEFORE_SUBMISSION);
      await expectSqlError(clients.runtime, INSERT_ATTEMPT, attemptParams(attemptFor(f, { attemptNumber: 1 })), {
        code: UNIQUE,
        constraint: "execution_attempts_number_uq",
      });
      const second = await insertAttempt(clients.runtime, attemptFor(f, { attemptNumber: 2 }));
      expect(await stateOf(clients.runtime, second)).toBe("QUEUED");
    });
  });

  it("creates attempts only as QUEUED at fencing generation 0", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-insert-state");
      for (const state of ["LEASED", "SUBMITTED", "SUCCEEDED", "OUTCOME_UNKNOWN"]) {
        await expectTriggerError(clients.runtime, INSERT_ATTEMPT, attemptParams(attemptFor(f, { state })), "created QUEUED");
      }
      await expectTriggerError(clients.runtime, INSERT_ATTEMPT, attemptParams(attemptFor(f, { fencing: 7 })), "fencing generation 0");
      await expectSqlError(clients.runtime, INSERT_ATTEMPT, attemptParams(attemptFor(f, { state: "RECOVERING" })), { code: CHECK });
    });
  });
});

describe("attempt state machine", () => {
  it.each([
    ["QUEUED -> LEASED -> SUBMITTING -> SUBMITTED -> SUCCEEDED", ["LEASED", "SUBMITTING", "SUBMITTED", "SUCCEEDED"]],
    ["QUEUED -> CANCELLED", ["CANCELLED"]],
    ["LEASED -> QUEUED (lease ended pre-submit) -> LEASED -> CANCELLED", ["LEASED", "QUEUED", "LEASED", "CANCELLED"]],
    ["LEASED -> FAILED_BEFORE_SUBMISSION", ["LEASED", "FAILED_BEFORE_SUBMISSION"]],
    ["SUBMITTING -> FAILED_BEFORE_SUBMISSION (definitive rejection)", ["LEASED", "SUBMITTING", "FAILED_BEFORE_SUBMISSION"]],
    ["SUBMITTING -> OUTCOME_UNKNOWN -> SUBMITTED -> SUBMITTED_FAILED", ["LEASED", "SUBMITTING", "OUTCOME_UNKNOWN", "SUBMITTED", "SUBMITTED_FAILED"]],
    ["OUTCOME_UNKNOWN -> ABANDONED", ["LEASED", "SUBMITTING", "OUTCOME_UNKNOWN", "ABANDONED"]],
    ["SUBMITTED -> ABANDONED", ["LEASED", "SUBMITTING", "SUBMITTED", "ABANDONED"]],
  ] as const)("allows %s", async (_label, path) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-allowed");
      const id = await insertAttempt(clients.runtime, attemptFor(f));
      await walk(clients.runtime, id, path);
      expect(await stateOf(clients.runtime, id)).toBe(path.at(-1));
    });
  });

  it("covers every allowed transition across the allowed paths", () => {
    const covered = new Set<string>();
    const paths: State[][] = [
      ["LEASED", "SUBMITTING", "SUBMITTED", "SUCCEEDED"],
      ["CANCELLED"],
      ["LEASED", "QUEUED", "LEASED", "CANCELLED"],
      ["LEASED", "FAILED_BEFORE_SUBMISSION"],
      ["LEASED", "SUBMITTING", "FAILED_BEFORE_SUBMISSION"],
      ["LEASED", "SUBMITTING", "OUTCOME_UNKNOWN", "SUBMITTED", "SUBMITTED_FAILED"],
      ["LEASED", "SUBMITTING", "OUTCOME_UNKNOWN", "ABANDONED"],
      ["LEASED", "SUBMITTING", "SUBMITTED", "ABANDONED"],
    ];
    for (const path of paths) {
      let from: State = "QUEUED";
      for (const to of path) {
        covered.add(`${from}->${to}`);
        from = to;
      }
    }
    const allowed = Object.entries(ALLOWED).flatMap(([from, targets]) => targets.map((to) => `${from}->${to}`));
    expect([...covered].sort()).toEqual(allowed.sort());
  });

  it.each(STATES)("rejects every transition out of %s that the architecture does not allow", async (from) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, `wb-forbidden-${from}`);
      const id = await insertAttempt(clients.runtime, attemptFor(f));
      await walk(clients.runtime, id, PATH_TO[from]);
      for (const to of STATES.filter((state) => state !== from && !ALLOWED[from].includes(state))) {
        await expectTriggerError(clients.runtime, "UPDATE execution_attempts SET state = $2 WHERE id = $1", [id, to], `transition ${from} -> ${to} is not allowed`);
      }
      expect(await stateOf(clients.runtime, id)).toBe(from);
    });
  });

  it("never lets a SUBMITTING attempt be taken over by a new lease", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-takeover");
      const id = await insertAttempt(clients.runtime, attemptFor(f));
      await walk(clients.runtime, id, PATH_TO.SUBMITTING);
      await expectTriggerError(
        clients.runtime,
        `UPDATE execution_attempts SET lease_worker_principal_id = $2, lease_token_sha256 = repeat('d', 64),
                lease_fencing_counter = lease_fencing_counter + 1 WHERE id = $1`,
        [id, workerB],
        "cannot be leased again",
      );
    });
  });
});

describe("lease and fencing", () => {
  it("rejects partial, inconsistent or out-of-range lease rows", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-lease");
      const id = await insertAttempt(clients.runtime, attemptFor(f));
      const lease = (set: string) => `UPDATE execution_attempts SET state = 'LEASED', ${set} WHERE id = $1`;
      const full = "lease_worker_principal_id = $2, lease_token_sha256 = repeat('e', 64), leased_at = now(), lease_expires_at = now() + interval '1 minute'";

      await expectSqlError(clients.runtime, lease("lease_worker_principal_id = $2, lease_fencing_counter = 1"), [id, workerA], {
        code: CHECK,
        constraint: "execution_attempts_lease_complete_ck",
      });
      // A new lease at generation 0 is refused by the guard before any check runs.
      await expectTriggerError(clients.runtime, lease(full), [id, workerA], "fencing generation must increase");
      await expectSqlError(clients.runtime, lease(`${full}, lease_fencing_counter = 9007199254740992`), [id, workerA], {
        code: CHECK,
        constraint: "execution_attempts_fencing_counter_ck",
      });
      for (const token of ["E".repeat(64), "e".repeat(63), "plaintext-lease-token"]) {
        await expectSqlError(
          clients.runtime,
          lease(`${full.replace("repeat('e', 64)", "$3")}, lease_fencing_counter = 1`),
          [id, workerA, token],
          { code: CHECK, constraint: "execution_attempts_lease_token_sha256_ck" },
        );
      }
      await expectSqlError(clients.runtime, lease(`${full.replace("now() + interval '1 minute'", "now()")}, lease_fencing_counter = 1`), [id, workerA], {
        code: CHECK,
        constraint: "execution_attempts_lease_times_ck",
      });
      await expectSqlError(
        clients.runtime,
        lease(`${full}, lease_fencing_counter = 1, heartbeat_at = now() - interval '1 minute'`),
        [id, workerA],
        { code: CHECK, constraint: "execution_attempts_heartbeat_ck" },
      );
      // A QUEUED attempt holds no lease.
      await expectSqlError(clients.runtime, `UPDATE execution_attempts SET ${full}, lease_fencing_counter = 1 WHERE id = $1`, [id, workerA], {
        code: CHECK,
        constraint: "execution_attempts_lease_state_ck",
      });
      // An unknown worker principal.
      await expectSqlError(clients.runtime, lease(`${full}, lease_fencing_counter = 1`), [id, "00000000-0000-4000-8000-000000000000"], {
        code: FOREIGN_KEY,
        constraint: "execution_attempts_lease_worker_fk",
      });
    });
  });

  it("increases the fencing generation for every new lease and never lowers it", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-fencing");
      const id = await insertAttempt(clients.runtime, attemptFor(f));
      await move(clients.runtime, id, "LEASED");
      // Heartbeat and renewal keep the same token and generation.
      await clients.runtime.query("UPDATE execution_attempts SET heartbeat_at = now(), lease_expires_at = now() + interval '10 minutes' WHERE id = $1", [id]);

      await expectTriggerError(clients.runtime, "UPDATE execution_attempts SET lease_fencing_counter = 0 WHERE id = $1", [id], "fencing generation");
      await expectTriggerError(
        clients.runtime,
        "UPDATE execution_attempts SET lease_worker_principal_id = $2, lease_token_sha256 = repeat('f', 64) WHERE id = $1",
        [id, workerB],
        "fencing generation",
      );
      // A takeover with a higher generation is allowed before SUBMITTING.
      await clients.runtime.query(
        "UPDATE execution_attempts SET lease_worker_principal_id = $2, lease_token_sha256 = repeat('f', 64), lease_fencing_counter = 2 WHERE id = $1",
        [id, workerB],
      );
      // Lease ends pre-submit, then a fresh lease takes generation 3.
      await move(clients.runtime, id, "QUEUED");
      await move(clients.runtime, id, "LEASED");
      const row = await clients.runtime.query("SELECT lease_fencing_counter, lease_worker_principal_id FROM execution_attempts WHERE id = $1", [id]);
      expect(row.rows).toEqual([{ lease_fencing_counter: "3", lease_worker_principal_id: workerA }]);
    });
  });

  it("clears the current lease at terminal and unknown states, and keeps it optional for SUBMITTED recovery", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-lease-states");
      const id = await insertAttempt(clients.runtime, attemptFor(f));
      await walk(clients.runtime, id, PATH_TO.SUBMITTING);
      // Entering OUTCOME_UNKNOWN while still holding the lease is refused.
      await expectSqlError(
        clients.runtime,
        "UPDATE execution_attempts SET state = 'OUTCOME_UNKNOWN', failure_code = 'PROVIDER_CREATE_TIMEOUT' WHERE id = $1",
        [id],
        { code: CHECK, constraint: "execution_attempts_lease_state_ck" },
      );
      await move(clients.runtime, id, "SUBMITTED");
      // Recovery leases come and go on SUBMITTED, each with a higher generation.
      await clients.runtime.query(`UPDATE execution_attempts SET ${CLEAR_LEASE} WHERE id = $1`, [id]);
      await clients.runtime.query(
        `UPDATE execution_attempts SET lease_worker_principal_id = $2, lease_token_sha256 = repeat('9', 64),
                lease_fencing_counter = lease_fencing_counter + 1, leased_at = now(), lease_expires_at = now() + interval '5 minutes' WHERE id = $1`,
        [id, workerB],
      );
      expect(await stateOf(clients.runtime, id)).toBe("SUBMITTED");
    });
  });
});

describe("submission identity, recovery horizon, failure codes and output", () => {
  it("requires the barrier and provider identity where the state needs them, and never rewrites them", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-submission");
      const id = await insertAttempt(clients.runtime, attemptFor(f));
      await move(clients.runtime, id, "LEASED");
      await expectSqlError(clients.runtime, "UPDATE execution_attempts SET state = 'SUBMITTING', submitting_at = now() WHERE id = $1", [id], {
        code: CHECK,
        constraint: "execution_attempts_credential_granted_ck",
      });
      await expectSqlError(clients.runtime, "UPDATE execution_attempts SET state = 'SUBMITTING', credential_granted_at = now() WHERE id = $1", [id], {
        code: CHECK,
        constraint: "execution_attempts_submitting_at_ck",
      });
      await move(clients.runtime, id, "SUBMITTING");
      await expectSqlError(clients.runtime, "UPDATE execution_attempts SET state = 'SUBMITTED' WHERE id = $1", [id], {
        code: CHECK,
        constraint: "execution_attempts_provider_execution_state_ck",
      });
      for (const executionId of ["https://provider.example/tasks/1", "has space", "x".repeat(257), ""]) {
        await expectSqlError(
          clients.runtime,
          "UPDATE execution_attempts SET state = 'SUBMITTED', provider_execution_id = $2, submitted_at = now() WHERE id = $1",
          [id, executionId],
          { code: CHECK, constraint: "execution_attempts_provider_execution_id_ck" },
        );
      }
      await clients.runtime.query(
        "UPDATE execution_attempts SET state = 'SUBMITTED', provider_execution_id = 'models/example/operations/op-123', submitted_at = now() WHERE id = $1",
        [id],
      );
      for (const set of [
        "provider_execution_id = 'other-execution'",
        "provider_execution_id = NULL, submitted_at = NULL",
        "submitting_at = now() + interval '1 second'",
        "submitted_at = now() + interval '1 second'",
      ]) {
        await expectTriggerError(clients.runtime, `UPDATE execution_attempts SET ${set} WHERE id = $1`, [id], "identity are immutable");
      }
      await expectTriggerError(clients.runtime, "UPDATE execution_attempts SET credential_granted_at = now() + interval '1 second' WHERE id = $1", [id], "cannot be replaced");
    });
  });

  it("keeps OUTCOME_UNKNOWN without a provider identity and with a closed reason code", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-unknown");
      const id = await insertAttempt(clients.runtime, attemptFor(f));
      await walk(clients.runtime, id, PATH_TO.SUBMITTING);
      await expectSqlError(clients.runtime, `UPDATE execution_attempts SET state = 'OUTCOME_UNKNOWN', ${CLEAR_LEASE} WHERE id = $1`, [id], {
        code: CHECK,
        constraint: "execution_attempts_failure_state_ck",
      });
      await expectSqlError(
        clients.runtime,
        `UPDATE execution_attempts SET state = 'OUTCOME_UNKNOWN', ${CLEAR_LEASE}, failure_code = 'timeout: socket hang up' WHERE id = $1`,
        [id],
        { code: CHECK, constraint: "execution_attempts_failure_code_ck" },
      );
      await move(clients.runtime, id, "OUTCOME_UNKNOWN");
      const row = await clients.runtime.query("SELECT provider_execution_id, submitted_at, submitting_at IS NOT NULL AS barrier FROM execution_attempts WHERE id = $1", [id]);
      expect(row.rows).toEqual([{ provider_execution_id: null, submitted_at: null, barrier: true }]);
      await expectTriggerError(clients.runtime, "UPDATE execution_attempts SET failure_code = 'OTHER_REASON' WHERE id = $1", [id], "changes only with its state");
    });
  });

  describe("provider execution ID uniqueness (Account + provider scope)", () => {
    const SUBMIT = "UPDATE execution_attempts SET state = 'SUBMITTED', provider_execution_id = 'shared-execution', submitted_at = now() WHERE id = $1";

    async function submittedAttempt(client: pg.Client, job: Fixture): Promise<string> {
      const id = await insertAttempt(client, attemptFor(job));
      await walk(client, id, PATH_TO.SUBMITTING);
      return id;
    }

    // A second connection, authorization and job in the same Account, for another provider.
    async function sameAccountOtherProvider(client: pg.Client, f: Fixture): Promise<Fixture> {
      const provider = "OTHER_PROVIDER";
      const connectionId = await insertConnection(client, f, provider);
      const versionId = await insertVersion(client, f, connectionId);
      const authorizationId = await insertAuthorization(client, f, { provider, connectionId, versionId });
      const jobId = await insertJob(client, { ...f, authorizationId });
      return { ...f, provider, connectionId, versionId, authorizationId, jobId };
    }

    it("rejects the same execution ID twice in the same Account and provider, in any state", async () => {
      await inRolledBackTransaction(clients.runtime, async () => {
        const f = await fixture(clients.runtime, "wb-exec-same");
        const first = await submittedAttempt(clients.runtime, f);
        await clients.runtime.query(SUBMIT, [first]);
        await walk(clients.runtime, first, ["SUBMITTED_FAILED"]);

        const second = await submittedAttempt(clients.runtime, await siblingJob(clients.runtime, f));
        await expectSqlError(clients.runtime, SUBMIT, [second], { code: UNIQUE, constraint: "execution_attempts_provider_execution_uq" });
      });
    });

    it("allows the same execution ID in the same Account under a different provider", async () => {
      await inRolledBackTransaction(clients.runtime, async () => {
        const f = await fixture(clients.runtime, "wb-exec-cross-provider");
        await clients.runtime.query(SUBMIT, [await submittedAttempt(clients.runtime, f)]);
        const other = await sameAccountOtherProvider(clients.runtime, f);
        expect(other.accountId).toBe(f.accountId);
        await clients.runtime.query(SUBMIT, [await submittedAttempt(clients.runtime, other)]);
        const rows = await clients.runtime.query(
          "SELECT provider FROM execution_attempts WHERE account_id = $1 AND provider_execution_id = 'shared-execution' ORDER BY provider",
          [f.accountId],
        );
        expect(rows.rows).toEqual([{ provider: "EXAMPLE_PROVIDER" }, { provider: "OTHER_PROVIDER" }]);
      });
    });

    it("allows the same execution ID for the same provider in a different Account", async () => {
      await inRolledBackTransaction(clients.runtime, async () => {
        const a = await fixture(clients.runtime, "wb-exec-account-a");
        const b = await fixture(clients.runtime, "wb-exec-account-b");
        expect(a.provider).toBe(b.provider);
        await clients.runtime.query(SUBMIT, [await submittedAttempt(clients.runtime, a)]);
        await clients.runtime.query(SUBMIT, [await submittedAttempt(clients.runtime, b)]);
        const rows = await clients.runtime.query(
          "SELECT count(DISTINCT account_id)::int AS accounts FROM execution_attempts WHERE provider = $1 AND provider_execution_id = 'shared-execution'",
          [a.provider],
        );
        expect(rows.rows).toEqual([{ accounts: 2 }]);
      });
    });
  });

  it("records a definitive provider rejection as FAILED_BEFORE_SUBMISSION, keeping the crossed barrier", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-definitive-rejection");
      const id = await insertAttempt(clients.runtime, attemptFor(f));
      await walk(clients.runtime, id, PATH_TO.SUBMITTING);
      // The barrier cannot be erased to pretend no submission was attempted.
      await expectTriggerError(
        clients.runtime,
        `UPDATE execution_attempts SET state = 'FAILED_BEFORE_SUBMISSION', ${CLEAR_LEASE}, submitting_at = NULL,
                failure_code = 'PROVIDER_REJECTED_REQUEST', completed_at = now() WHERE id = $1`,
        [id],
        "immutable",
      );
      await clients.runtime.query(
        `UPDATE execution_attempts SET state = 'FAILED_BEFORE_SUBMISSION', ${CLEAR_LEASE},
                failure_code = 'PROVIDER_REJECTED_REQUEST', completed_at = now() WHERE id = $1`,
        [id],
      );
      const row = await clients.runtime.query(
        `SELECT state, submitting_at IS NOT NULL AS barrier_crossed, provider_execution_id, failure_code,
                state IN ('SUBMITTING', 'SUBMITTED', 'OUTCOME_UNKNOWN') AS recovery_open
           FROM execution_attempts WHERE id = $1`,
        [id],
      );
      expect(row.rows).toEqual([
        { state: "FAILED_BEFORE_SUBMISSION", barrier_crossed: true, provider_execution_id: null, failure_code: "PROVIDER_REJECTED_REQUEST", recovery_open: false },
      ]);
    });
  });

  it("records an ambiguous provider outcome as OUTCOME_UNKNOWN, which never becomes FAILED_BEFORE_SUBMISSION", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-ambiguous");
      const id = await insertAttempt(clients.runtime, attemptFor(f));
      await walk(clients.runtime, id, PATH_TO.SUBMITTING);
      await clients.runtime.query(
        `UPDATE execution_attempts SET state = 'OUTCOME_UNKNOWN', ${CLEAR_LEASE}, failure_code = 'PROVIDER_CREATE_TIMEOUT' WHERE id = $1`,
        [id],
      );
      const row = await clients.runtime.query(
        "SELECT state, state IN ('SUBMITTING', 'SUBMITTED', 'OUTCOME_UNKNOWN') AS recovery_open FROM execution_attempts WHERE id = $1",
        [id],
      );
      expect(row.rows).toEqual([{ state: "OUTCOME_UNKNOWN", recovery_open: true }]);
      // Once acceptance cannot be ruled out, the attempt cannot be reclassified as a clean pre-submission failure.
      await expectTriggerError(
        clients.runtime,
        "UPDATE execution_attempts SET state = 'FAILED_BEFORE_SUBMISSION', failure_code = 'PROVIDER_REJECTED_REQUEST', completed_at = now() WHERE id = $1",
        [id],
        "transition OUTCOME_UNKNOWN -> FAILED_BEFORE_SUBMISSION is not allowed",
      );
    });
  });

  it("supports the acknowledgement rule: only the current fenced lease can enter SUBMITTING", async () => {
    // Future service invariant: a provider call may occur only after the worker
    // receives acknowledgement that its current fenced attempt entered
    // SUBMITTING. The service expresses that acknowledgement as an UPDATE
    // conditioned on the worker's lease verifier and fencing generation.
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-ack-rule");
      const id = await insertAttempt(clients.runtime, attemptFor(f));
      await move(clients.runtime, id, "LEASED", workerA);
      await clients.runtime.query("UPDATE execution_attempts SET credential_granted_at = now() WHERE id = $1", [id]);
      const stale = (await clients.runtime.query<{ token: string; fencing: string }>(
        "SELECT lease_token_sha256 AS token, lease_fencing_counter AS fencing FROM execution_attempts WHERE id = $1",
        [id],
      )).rows[0]!;

      // The lease ends before SUBMITTING: the attempt is requeued and the lease-scoped grant cleared.
      await move(clients.runtime, id, "QUEUED");
      expect((await clients.runtime.query("SELECT credential_granted_at FROM execution_attempts WHERE id = $1", [id])).rows).toEqual([
        { credential_granted_at: null },
      ]);
      // A requeued attempt cannot jump straight to SUBMITTING.
      await expectTriggerError(clients.runtime, "UPDATE execution_attempts SET state = 'SUBMITTING' WHERE id = $1", [id], "QUEUED -> SUBMITTING is not allowed");

      // Another worker takes a new, higher-generation lease.
      await move(clients.runtime, id, "LEASED", workerB);
      const ENTER_SUBMITTING = `
        UPDATE execution_attempts
           SET state = 'SUBMITTING', credential_granted_at = COALESCE(credential_granted_at, now()), submitting_at = now()
         WHERE id = $1 AND state = 'LEASED' AND lease_token_sha256 = $2 AND lease_fencing_counter = $3`;
      // The stale worker's fenced acknowledgement matches nothing: it never gets authority to call the provider.
      expect((await clients.runtime.query(ENTER_SUBMITTING, [id, stale.token, stale.fencing])).rowCount).toBe(0);
      const current = (await clients.runtime.query<{ token: string; fencing: string }>(
        "SELECT lease_token_sha256 AS token, lease_fencing_counter AS fencing FROM execution_attempts WHERE id = $1",
        [id],
      )).rows[0]!;
      expect(Number(current.fencing)).toBeGreaterThan(Number(stale.fencing));
      expect((await clients.runtime.query(ENTER_SUBMITTING, [id, current.token, current.fencing])).rowCount).toBe(1);
      expect(await stateOf(clients.runtime, id)).toBe("SUBMITTING");
    });
  });

  it("represents a provider-policy recovery horizon only after the barrier, write-once", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-horizon");
      const id = await insertAttempt(clients.runtime, attemptFor(f));
      await move(clients.runtime, id, "LEASED");
      await expectSqlError(clients.runtime, "UPDATE execution_attempts SET recovery_expires_at = now() + interval '1 day' WHERE id = $1", [id], {
        code: CHECK,
        constraint: "execution_attempts_recovery_expires_at_ck",
      });
      await walk(clients.runtime, id, ["SUBMITTING", "SUBMITTED"]);
      await expectSqlError(clients.runtime, "UPDATE execution_attempts SET recovery_expires_at = now() - interval '1 second' WHERE id = $1", [id], {
        code: CHECK,
        constraint: "execution_attempts_recovery_expires_at_ck",
      });
      await clients.runtime.query("UPDATE execution_attempts SET recovery_expires_at = now() + interval '1 day' WHERE id = $1", [id]);
      await expectTriggerError(clients.runtime, "UPDATE execution_attempts SET recovery_expires_at = now() + interval '2 days' WHERE id = $1", [id], "immutable");
      // A passed horizon closes nothing by itself: the attempt stays SUBMITTED until an explicit decision.
      expect(await stateOf(clients.runtime, id)).toBe("SUBMITTED");
    });
  });

  it("requires complete, storage-neutral output exactly on SUCCEEDED", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-output");
      const id = await insertAttempt(clients.runtime, attemptFor(f));
      await walk(clients.runtime, id, PATH_TO.SUBMITTED);
      const OUTPUT_DEFAULTS: Record<string, string> = {
        output_object_key: "'accounts/a/jobs/j/output.mp4'",
        output_sha256: "repeat('a', 64)",
        output_byte_count: "10",
        output_content_type: "'video/mp4'",
      };
      // set is "<output column> = $2": that column replaces its valid default.
      const succeed = (set: string) => {
        const column = set.split("=")[0]!.trim();
        const output = Object.entries(OUTPUT_DEFAULTS)
          .map(([name, value]) => (name === column ? set : `${name} = ${value}`))
          .join(", ");
        return `UPDATE execution_attempts SET state = 'SUCCEEDED', ${CLEAR_LEASE}, completed_at = now(), ${output} WHERE id = $1`;
      };

      await expectSqlError(clients.runtime, `UPDATE execution_attempts SET state = 'SUCCEEDED', ${CLEAR_LEASE}, completed_at = now() WHERE id = $1`, [id], {
        code: CHECK,
        constraint: "execution_attempts_output_state_ck",
      });
      for (const key of [
        "/absolute/path.mp4",
        "C:/Users/operator/output.mp4",
        "C:\\\\Users\\\\output.mp4",
        "https://bucket.example/output.mp4?X-Signature=abc",
        "s3://bucket/output.mp4",
        "a//b.mp4",
        "a/../b.mp4",
        "a/./b.mp4",
        "a/b/",
        " leading.mp4",
        "x".repeat(513),
      ]) {
        await expectSqlError(clients.runtime, succeed("output_object_key = $2"), [id, key], { code: CHECK, constraint: "execution_attempts_output_object_key_ck" });
      }
      for (const hash of ["A".repeat(64), "a".repeat(63)]) {
        await expectSqlError(clients.runtime, succeed("output_sha256 = $2"), [id, hash], { code: CHECK, constraint: "execution_attempts_output_sha256_ck" });
      }
      for (const bytes of [0, -1]) {
        await expectSqlError(clients.runtime, succeed("output_byte_count = $2"), [id, bytes], { code: CHECK, constraint: "execution_attempts_output_byte_count_ck" });
      }
      for (const contentType of ["Video/MP4", "video", `video/${"x".repeat(64)}`, "video/mp4; codecs=avc1"]) {
        await expectSqlError(clients.runtime, succeed("output_content_type = $2"), [id, contentType], {
          code: CHECK,
          constraint: "execution_attempts_output_content_type_ck",
        });
      }
      await clients.runtime.query(succeed("output_object_key = $2"), [id, `accounts/${f.accountId}/jobs/${f.jobId}/attempt-1/output.mp4`]);
      await expectTriggerError(clients.runtime, "UPDATE execution_attempts SET output_sha256 = repeat('b', 64) WHERE id = $1", [id], "immutable");

      // A provider-terminal failure carries no output.
      const sibling = await siblingJob(clients.runtime, f);
      const failed = await insertAttempt(clients.runtime, attemptFor(sibling));
      await walk(clients.runtime, failed, PATH_TO.SUBMITTED_FAILED);
      const row = await clients.runtime.query("SELECT output_object_key, failure_code FROM execution_attempts WHERE id = $1", [failed]);
      expect(row.rows).toEqual([{ output_object_key: null, failure_code: "PROVIDER_GENERATION_FAILED" }]);
    });
  });
});

describe("immutable attempt provenance", () => {
  it.each([
    ["the exact credential version", "provider_credential_version_id = gen_random_uuid()"],
    ["the provider", "provider = 'OTHER_PROVIDER'"],
    ["the billing mode", "billing_mode = 'PLATFORM_HOSTED'"],
    ["the job", "execution_job_id = gen_random_uuid()"],
    ["the authorization", "generation_authorization_id = gen_random_uuid()"],
    ["the account", "account_id = gen_random_uuid()"],
    ["the attempt number", "attempt_number = attempt_number - 1"],
    ["the creation time", "created_at = now() - interval '1 day'"],
  ])("denies the runtime role and the owner rewriting %s", async (_label, assignment) => {
    for (const [client, kind] of [
      [clients.runtime, "runtime"],
      [clients.migrator, "owner"],
    ] as const) {
      await inRolledBackTransaction(client, async () => {
        const f = await fixture(client, `wb-immutable-${kind}`);
        const id = await insertAttempt(client, attemptFor(f, { attemptNumber: 2 }));
        await walk(client, id, PATH_TO.SUBMITTED);
        if (kind === "runtime") {
          await expectSqlError(client, `UPDATE execution_attempts SET ${assignment} WHERE id = $1`, [id], { code: DENIED });
        } else {
          await expectTriggerError(client, `UPDATE execution_attempts SET ${assignment} WHERE id = $1`, [id], "provenance is immutable");
        }
      });
    }
  });
});

describe("derivable credential obligations", () => {
  // The documented predicates from migration 0004, evaluated per attempt.
  const PREDICATES = `
    SELECT id,
           ((state = 'LEASED' AND credential_granted_at IS NOT NULL)
             OR state IN ('SUBMITTING', 'SUBMITTED', 'OUTCOME_UNKNOWN')) AS retention_open,
           state IN ('SUBMITTING', 'SUBMITTED', 'OUTCOME_UNKNOWN') AS recovery_open
      FROM execution_attempts WHERE id = $1`;
  const VERSION_RETENTION_OPEN = `
    SELECT EXISTS (
      SELECT 1 FROM execution_attempts
       WHERE provider_credential_version_id = $1
         AND ((state = 'LEASED' AND credential_granted_at IS NOT NULL) OR state IN ('SUBMITTING', 'SUBMITTED', 'OUTCOME_UNKNOWN'))
    ) AS open`;

  it("distinguishes every obligation-relevant attempt state for one exact credential version", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-obligations");
      const cases: [string, readonly State[], boolean, boolean][] = [
        ["queued", [], false, false],
        ["leased, never granted", ["LEASED"], false, false],
        ["requeued after a grant", ["LEASED", "QUEUED"], false, false],
        ["submitting", ["LEASED", "SUBMITTING"], true, true],
        ["outcome unknown", PATH_TO.OUTCOME_UNKNOWN, true, true],
        ["submitted", PATH_TO.SUBMITTED, true, true],
        ["succeeded", PATH_TO.SUCCEEDED, false, false],
        ["submitted failed", PATH_TO.SUBMITTED_FAILED, false, false],
        ["abandoned", PATH_TO.ABANDONED, false, false],
        ["failed before submission", PATH_TO.FAILED_BEFORE_SUBMISSION, false, false],
        ["cancelled", PATH_TO.CANCELLED, false, false],
      ];
      const observed: Record<string, [boolean, boolean]> = {};
      for (const [label, path, ,] of cases) {
        const job = await siblingJob(clients.runtime, f);
        const id = await insertAttempt(clients.runtime, attemptFor(job));
        if (label === "requeued after a grant") {
          await move(clients.runtime, id, "LEASED");
          await clients.runtime.query("UPDATE execution_attempts SET credential_granted_at = now() WHERE id = $1", [id]);
          await move(clients.runtime, id, "QUEUED");
        } else {
          await walk(clients.runtime, id, path);
        }
        const row = (await clients.runtime.query<{ retention_open: boolean; recovery_open: boolean }>(PREDICATES, [id])).rows[0]!;
        observed[label] = [row.retention_open, row.recovery_open];
      }

      // Leased with a granted credential, before SUBMITTING: retention only.
      const granted = await siblingJob(clients.runtime, f);
      const grantedId = await insertAttempt(clients.runtime, attemptFor(granted));
      await move(clients.runtime, grantedId, "LEASED");
      await clients.runtime.query("UPDATE execution_attempts SET credential_granted_at = now() WHERE id = $1", [grantedId]);
      const grantedRow = (await clients.runtime.query<{ retention_open: boolean; recovery_open: boolean }>(PREDICATES, [grantedId])).rows[0]!;
      observed["leased, credential granted"] = [grantedRow.retention_open, grantedRow.recovery_open];

      expect(observed).toEqual({
        ...Object.fromEntries(cases.map(([label, , retention, recovery]) => [label, [retention, recovery]])),
        "leased, credential granted": [true, false],
      });
      expect((await clients.runtime.query(VERSION_RETENTION_OPEN, [f.versionId])).rows).toEqual([{ open: true }]);
    });
  });

  it("reports no obligation for a version whose attempts are all closed", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "wb-obligations-closed");
      for (const path of [PATH_TO.SUCCEEDED, PATH_TO.CANCELLED]) {
        const job = await siblingJob(clients.runtime, f);
        await walk(clients.runtime, await insertAttempt(clients.runtime, attemptFor(job)), path);
      }
      expect((await clients.runtime.query(VERSION_RETENTION_OPEN, [f.versionId])).rows).toEqual([{ open: false }]);
    });
  });
});

describe("runtime privileges on worker-bridge tables", () => {
  it("cannot delete, truncate, run DDL or create a worker database role", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      for (const table of ["worker_principals", "execution_jobs", "execution_attempts"]) {
        for (const sql of [`DELETE FROM ${table}`, `TRUNCATE ${table}`, `ALTER TABLE ${table} ADD COLUMN probe integer`, `DROP TABLE ${table}`]) {
          await expectSqlError(clients.runtime, sql, [], { code: DENIED });
        }
      }
      await expectSqlError(clients.runtime, "ALTER TABLE execution_attempts DISABLE TRIGGER execution_attempts_guard", [], { code: DENIED });
      await expectSqlError(clients.runtime, "CREATE ROLE commercial_worker LOGIN", [], { code: DENIED });
    });
    const roles = await clients.migrator.query("SELECT rolname FROM pg_roles WHERE rolname ILIKE '%worker%'");
    expect(roles.rows).toEqual([]);
  });

  it("holds lifecycle-only column UPDATE on jobs and attempts", async () => {
    const updatable = async (table: string) =>
      (
        await clients.runtime.query<{ attname: string }>(
          `SELECT attname FROM pg_attribute
            WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped
              AND has_column_privilege(current_user, attrelid, attnum, 'UPDATE')
            ORDER BY attname`,
          [`public.${table}`],
        )
      ).rows.map((row) => row.attname);
    expect(await updatable("execution_jobs")).toEqual(["completed_at", "status", "updated_at"]);
    expect(await updatable("worker_principals")).toEqual(["disabled_at", "status", "updated_at"]);
    const attemptColumns = await updatable("execution_attempts");
    for (const immutable of [
      "id",
      "account_id",
      "execution_job_id",
      "generation_authorization_id",
      "attempt_number",
      "billing_mode",
      "provider",
      "provider_credential_version_id",
      "created_at",
    ]) {
      expect(attemptColumns).not.toContain(immutable);
    }
    const table = await clients.runtime.query(
      `SELECT bool_or(has_table_privilege(current_user, t, 'UPDATE')) AS table_update,
              bool_or(has_table_privilege(current_user, t, 'DELETE')) AS delete,
              bool_or(has_table_privilege(current_user, t, 'TRUNCATE')) AS truncate,
              bool_or(has_table_privilege(current_user, t, 'REFERENCES')) AS references,
              bool_or(has_table_privilege(current_user, t, 'TRIGGER')) AS trigger
         FROM unnest(ARRAY['public.worker_principals', 'public.execution_jobs', 'public.execution_attempts']) AS t`,
    );
    expect(table.rows).toEqual([{ table_update: false, delete: false, truncate: false, references: false, trigger: false }]);
  });
});

describe("audit events after migration 0004", () => {
  const INSERT_AUDIT = `INSERT INTO audit_events (actor_type, event_type, resource_type, resource_id, correlation_id)
                        VALUES ('SYSTEM', $1, $2, gen_random_uuid(), gen_random_uuid()) RETURNING id`;

  it("accepts every earlier and new resource type and rejects unknown ones", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      for (const type of [
        "user",
        "account",
        "entitlement_grant",
        "production",
        "provider_connection",
        "generation_authorization",
        "execution_job",
        "execution_attempt",
        "worker_principal",
      ]) {
        await clients.runtime.query(INSERT_AUDIT, ["execution_attempt.leased", type]);
      }
      for (const type of ["execution_attempts", "worker", "lease", "credential", "recovery_obligation"]) {
        await expectSqlError(clients.runtime, INSERT_AUDIT, ["execution_attempt.leased", type], { code: CHECK, constraint: "audit_events_resource_type_ck" });
      }
    });
  });

  it("remains append-only for the runtime role and the owner", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const inserted = await clients.migrator.query<{ id: string }>(INSERT_AUDIT, ["execution_attempt.submitting", "execution_attempt"]);
      for (const sql of ["UPDATE audit_events SET event_type = 'x.y' WHERE id = $1", "DELETE FROM audit_events WHERE id = $1"]) {
        await clients.migrator.query("SAVEPOINT audit_probe");
        await expect(clients.migrator.query(sql, [inserted.rows[0]!.id])).rejects.toMatchObject({ message: expect.stringContaining("audit_events is append-only") });
        await clients.migrator.query("ROLLBACK TO SAVEPOINT audit_probe");
      }
    });
    await inRolledBackTransaction(clients.runtime, async () => {
      const inserted = await clients.runtime.query<{ id: string }>(INSERT_AUDIT, ["worker_principal.disabled", "worker_principal"]);
      await expectSqlError(clients.runtime, "UPDATE audit_events SET event_type = 'x.y' WHERE id = $1", [inserted.rows[0]!.id], { code: DENIED });
      await expectSqlError(clients.runtime, "DELETE FROM audit_events WHERE id = $1", [inserted.rows[0]!.id], { code: DENIED });
      await expectSqlError(clients.runtime, "TRUNCATE audit_events", [], { code: DENIED });
    });
  });
});
