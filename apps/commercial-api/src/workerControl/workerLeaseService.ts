import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { RuntimeClient, TransactionalPool } from "../database/runtimePool.js";
import {
  WORKER_EXPIRED_LEASE_RECLAIM_LIMIT,
  WORKER_LEASE_DURATION_SECONDS,
  WORKER_LEASE_TOKEN_BYTES,
  WORKER_MAX_CURRENT_LEASES,
} from "./workerLeasePolicy.js";
import type { WorkerLeaseRejectionReason } from "./workerSecurityEvents.js";

// Worker lease acquisition, heartbeat and pre-grant release
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md sections 11-15).
//
// Every operation is one READ COMMITTED transaction that first re-reads the
// authenticated worker principal FOR SHARE and requires it to be ACTIVE, so a
// principal disabled after authentication cannot mutate anything (disabling
// waits for, or is seen by, every in-flight worker transaction).
//
// Lock order: worker principal (FOR SHARE, or FOR UPDATE when acquiring), then execution attempt rows
// (FOR UPDATE), then their job rows. Nothing here locks provider connections
// or credential versions: no credential is granted in this slice.
//
// The highest state entered here by a worker is LEASED; the control-plane
// expired-SUBMITTING sweep (R44B6M) enters OUTCOME_UNKNOWN. Nothing here sets
// credential_granted_at, enters SUBMITTING, or reads secret material.

export type WorkerLeaseErrorCode = "WORKER_NOT_ACTIVE" | "LEASE_REJECTED" | "WORKER_CONTROL_DATABASE_FAILURE";

export class WorkerLeaseError extends Error {
  override readonly name = "WorkerLeaseError";

  constructor(
    readonly code: WorkerLeaseErrorCode,
    readonly reason: WorkerLeaseRejectionReason | null = null,
    options: Readonly<{ cause?: unknown }> = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
  }
}

export type WorkerLease = Readonly<{
  executionJobId: string;
  executionAttemptId: string;
  attemptNumber: number;
  provider: string;
  model: string;
  generationRequest: unknown;
  generationRequestSha256: string;
  expectedCostCap: Readonly<{ unit: string; amount: number }>;
  // Plaintext, returned exactly once to the issuing worker; only its SHA-256
  // verifier is stored.
  leaseToken: string;
  fencingCounter: number;
  leaseExpiresAt: Date;
}>;

export type LeaseProof = Readonly<{ fencingCounter: number; leaseToken: string }>;

export type WorkerControlContext = Readonly<{ workerPrincipalId: string; correlationId: string }>;

const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function tokenMatches(presented: string, storedVerifier: string | null): boolean {
  if (storedVerifier === null) return false;
  const expected = Buffer.from(storedVerifier, "hex");
  const actual = createHash("sha256").update(presented, "utf8").digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function withTransaction<T>(pool: TransactionalPool, work: (client: RuntimeClient) => Promise<T>): Promise<T> {
  let client: RuntimeClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE", null, { cause: error });
  }
  let destroyConnection: Error | undefined;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      destroyConnection = rollbackError instanceof Error ? rollbackError : new Error("rollback failed");
    }
    if (error instanceof WorkerLeaseError) throw error;
    throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE", null, { cause: error });
  } finally {
    client.release(destroyConnection);
  }
}

// FOR SHARE for lease-scoped operations; FOR UPDATE for acquisition, which
// also serialises one worker's concurrent acquisitions so the capacity check
// cannot be raced.
export async function requireActiveWorker(client: RuntimeClient, workerPrincipalId: string, lock: "FOR SHARE" | "FOR UPDATE" = "FOR SHARE"): Promise<void> {
  const result = await client.query<{ status: string }>(`SELECT status FROM worker_principals WHERE id = $1 ${lock}`, [workerPrincipalId]);
  if (result.rows[0]?.status !== "ACTIVE") throw new WorkerLeaseError("WORKER_NOT_ACTIVE", "WORKER_NOT_ACTIVE");
}

const INSERT_AUDIT = `
INSERT INTO audit_events (account_id, actor_type, event_type, resource_type, resource_id, correlation_id, metadata)
VALUES ($1, 'SYSTEM', $2, 'execution_attempt', $3, $4, $5::jsonb)`;

// Domain lifecycle evidence. Metadata never includes a lease token or verifier.
export async function audit(
  client: RuntimeClient,
  eventType: string,
  attempt: Readonly<{ id: string; accountId: string }>,
  correlationId: string,
  metadata: Readonly<{
    attemptNumber: number;
    fencingCounter: number;
    workerPrincipalId: string;
    provider?: string;
    credentialVersion?: number;
    failureCode?: string;
    recoveredFromJournal?: true;
  }>,
): Promise<void> {
  await client.query(INSERT_AUDIT, [attempt.accountId, eventType, attempt.id, correlationId, JSON.stringify(metadata)]);
}

const CLEAR_LEASE = `lease_worker_principal_id = NULL, lease_token_sha256 = NULL, leased_at = NULL,
                     lease_expires_at = NULL, heartbeat_at = NULL`;

// Closed failure code (architecture sections 12 and 27): the control-plane
// fact that the lease expired after the barrier, nothing about the provider.
export const SUBMITTING_LEASE_EXPIRED_FAILURE_CODE = "WORKER_LEASE_EXPIRED_DURING_SUBMISSION";

// Returns expired pre-grant leases to the queue. A lease that ever received a
// credential grant is left alone: it carries an open retention obligation and
// is a later recovery/sweep concern, never silently requeued here.
async function reclaimExpiredLeases(client: RuntimeClient, correlationId: string): Promise<void> {
  const reclaimed = await client.query<{
    id: string;
    account_id: string;
    execution_job_id: string;
    attempt_number: number;
    lease_fencing_counter: string;
    lease_worker_principal_id: string;
  }>(
    `WITH expired AS (
       SELECT id, lease_worker_principal_id FROM execution_attempts
        WHERE state = 'LEASED' AND credential_granted_at IS NULL AND lease_expires_at <= now()
        ORDER BY lease_expires_at, id
        LIMIT ${WORKER_EXPIRED_LEASE_RECLAIM_LIMIT}
          FOR UPDATE SKIP LOCKED
     )
     UPDATE execution_attempts a
        SET state = 'QUEUED', ${CLEAR_LEASE}, updated_at = now()
       FROM expired
      WHERE a.id = expired.id
     RETURNING a.id, a.account_id, a.execution_job_id, a.attempt_number, a.lease_fencing_counter, expired.lease_worker_principal_id`,
  );
  for (const row of reclaimed.rows) {
    await client.query("UPDATE execution_jobs SET status = 'QUEUED', updated_at = now() WHERE id = $1 AND status = 'RUNNING'", [row.execution_job_id]);
    await audit(client, "execution_attempt.lease_expired", { id: row.id, accountId: row.account_id }, correlationId, {
      attemptNumber: row.attempt_number,
      fencingCounter: Number(row.lease_fencing_counter),
      workerPrincipalId: row.lease_worker_principal_id,
    });
  }
}

// The authoritative expired-SUBMITTING sweep (architecture section 12,
// R44B6M). A SUBMITTING attempt whose lease has expired may already have
// reached the provider, so it is never requeued, re-leased or treated as a
// failure before submission: it becomes OUTCOME_UNKNOWN with every live lease
// field cleared. The fencing counter, credential grant, submitting_at and the
// immutable submitting principal are kept; the parent job needs attention.
// Recognising lost authority uses transaction-stable now() (R44B6K5): at
// worst an expiry is recognised one transaction later, never earlier.
// The acquisition batch skips locked rows. A named acceptance-recovery scan
// waits for its row instead, then applies the same expiry predicate. The
// outer state predicate makes a concurrent conversion a no-op. Runs inside
// the caller's READ COMMITTED transaction; no network work happens here.
export async function sweepExpiredSubmittingAttempts(client: RuntimeClient, correlationId: string, attemptId?: string): Promise<void> {
  const swept = await client.query<{
    id: string;
    account_id: string;
    execution_job_id: string;
    attempt_number: number;
    lease_fencing_counter: string;
    lease_worker_principal_id: string;
  }>(
    `WITH expired AS (
       SELECT id, lease_worker_principal_id FROM execution_attempts
        WHERE state = 'SUBMITTING' AND lease_expires_at <= now()
          ${attemptId === undefined ? "" : "AND id = $1"}
        ORDER BY lease_expires_at, id
        LIMIT ${WORKER_EXPIRED_LEASE_RECLAIM_LIMIT}
          ${attemptId === undefined ? "FOR UPDATE SKIP LOCKED" : "FOR UPDATE"}
     )
     UPDATE execution_attempts a
        SET state = 'OUTCOME_UNKNOWN', failure_code = '${SUBMITTING_LEASE_EXPIRED_FAILURE_CODE}', ${CLEAR_LEASE}, updated_at = now()
       FROM expired
      WHERE a.id = expired.id AND a.state = 'SUBMITTING'
     RETURNING a.id, a.account_id, a.execution_job_id, a.attempt_number, a.lease_fencing_counter, expired.lease_worker_principal_id`,
    attemptId === undefined ? undefined : [attemptId],
  );
  for (const row of swept.rows) {
    await client.query("UPDATE execution_jobs SET status = 'NEEDS_ATTENTION', updated_at = now() WHERE id = $1 AND status = 'RUNNING'", [
      row.execution_job_id,
    ]);
    await audit(client, "execution_attempt.outcome_unknown", { id: row.id, accountId: row.account_id }, correlationId, {
      attemptNumber: row.attempt_number,
      fencingCounter: Number(row.lease_fencing_counter),
      workerPrincipalId: row.lease_worker_principal_id,
      failureCode: SUBMITTING_LEASE_EXPIRED_FAILURE_CODE,
    });
  }
}

// Eligible work: a QUEUED attempt of a non-terminal job whose authorization
// has been claimed and, for USER_BYO, whose exact bound credential version is
// still usable for new work on a connection that is neither DISCONNECTED nor
// DISABLED. This is a filter, not the grant check: the future credential
// grant re-verifies eligibility under the credential-version row lock.
// Oldest first, ID as tie-breaker (the execution_attempts_queue_ix order).
const SELECT_NEXT = `
SELECT a.id, a.account_id, a.execution_job_id, a.generation_authorization_id, a.attempt_number
  FROM execution_attempts a
  JOIN execution_jobs j ON j.id = a.execution_job_id AND j.account_id = a.account_id
  JOIN generation_authorizations g ON g.id = a.generation_authorization_id AND g.account_id = a.account_id
  LEFT JOIN provider_credential_versions v ON v.id = a.provider_credential_version_id AND v.account_id = a.account_id
  LEFT JOIN provider_connections c ON c.id = v.provider_connection_id AND c.account_id = a.account_id
 WHERE a.state = 'QUEUED'
   AND j.status IN ('QUEUED', 'RUNNING')
   AND g.status = 'CLAIMED'
   AND (a.billing_mode <> 'USER_BYO'
        OR (v.status IN ('ACTIVE', 'SUPERSEDED') AND c.status NOT IN ('DISCONNECTED', 'DISABLED')))
 ORDER BY a.created_at, a.id
 LIMIT 1
   FOR UPDATE OF a SKIP LOCKED`;

// Leases the next eligible attempt to this worker, or returns null when the
// queue is empty. SKIP LOCKED means two concurrent requests never wait on, or
// both obtain, the same attempt.
export async function acquireWorkerLease(pool: TransactionalPool, context: WorkerControlContext): Promise<WorkerLease | null> {
  return withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId, "FOR UPDATE");
    await reclaimExpiredLeases(client, context.correlationId);
    // Before the capacity check: a swept attempt no longer holds a lease, and
    // it is never a candidate (only QUEUED attempts are).
    await sweepExpiredSubmittingAttempts(client, context.correlationId);

    const held = await client.query<{ current: number }>(
      "SELECT count(*)::int AS current FROM execution_attempts WHERE lease_worker_principal_id = $1",
      [context.workerPrincipalId],
    );
    if ((held.rows[0]?.current ?? 0) >= WORKER_MAX_CURRENT_LEASES) throw new WorkerLeaseError("LEASE_REJECTED", "WORKER_AT_CAPACITY");

    const next = await client.query<{
      id: string;
      account_id: string;
      execution_job_id: string;
      generation_authorization_id: string;
      attempt_number: number;
    }>(SELECT_NEXT);
    const candidate = next.rows[0];
    if (candidate === undefined) return null;

    const leaseToken = randomBytes(WORKER_LEASE_TOKEN_BYTES).toString("base64url");
    const leased = await client.query<{ lease_fencing_counter: string; lease_expires_at: Date }>(
      `UPDATE execution_attempts
          SET state = 'LEASED', lease_worker_principal_id = $2, lease_token_sha256 = $3,
              lease_fencing_counter = lease_fencing_counter + 1, leased_at = now(),
              lease_expires_at = now() + make_interval(secs => $4), heartbeat_at = now(), updated_at = now()
        WHERE id = $1 AND state = 'QUEUED'
        RETURNING lease_fencing_counter, lease_expires_at`,
      [candidate.id, context.workerPrincipalId, sha256Hex(leaseToken), WORKER_LEASE_DURATION_SECONDS],
    );
    const row = leased.rows[0];
    if (row === undefined) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");
    const fencingCounter = Number(row.lease_fencing_counter);

    await client.query("UPDATE execution_jobs SET status = 'RUNNING', updated_at = now() WHERE id = $1 AND status = 'QUEUED'", [candidate.execution_job_id]);
    await audit(client, "execution_attempt.leased", { id: candidate.id, accountId: candidate.account_id }, context.correlationId, {
      attemptNumber: candidate.attempt_number,
      fencingCounter,
      workerPrincipalId: context.workerPrincipalId,
    });

    // Work comes only from the immutable authorization; never from the worker.
    const authorization = await client.query<{
      provider: string;
      model: string;
      generation_request: unknown;
      generation_request_sha256: string;
      expected_cost_cap_unit: string;
      expected_cost_cap_amount: string;
    }>(
      `SELECT provider, model, generation_request, generation_request_sha256, expected_cost_cap_unit, expected_cost_cap_amount
         FROM generation_authorizations WHERE id = $1 AND account_id = $2`,
      [candidate.generation_authorization_id, candidate.account_id],
    );
    const work = authorization.rows[0];
    if (work === undefined) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");

    return Object.freeze({
      executionJobId: candidate.execution_job_id,
      executionAttemptId: candidate.id,
      attemptNumber: candidate.attempt_number,
      provider: work.provider,
      model: work.model,
      generationRequest: work.generation_request,
      generationRequestSha256: work.generation_request_sha256,
      expectedCostCap: Object.freeze({ unit: work.expected_cost_cap_unit, amount: Number(work.expected_cost_cap_amount) }),
      leaseToken,
      fencingCounter,
      leaseExpiresAt: row.lease_expires_at,
    });
  });
}

export type LockedLease = Readonly<{
  id: string;
  accountId: string;
  executionJobId: string;
  generationAuthorizationId: string;
  attemptNumber: number;
  billingMode: string;
  provider: string;
  // The attempt's immutable copy of the authorization's exact version.
  providerCredentialVersionId: string | null;
  fencingCounter: number;
  credentialGrantedAt: Date | null;
  credentialGranted: boolean;
  state: string;
  submittingAt: Date | null;
}>;

// Locks the attempt and proves the caller holds its current lease: in an
// accepted state (LEASED unless the caller says otherwise; the SUBMITTING
// barrier also accepts SUBMITTING to replay its acknowledgement), this worker,
// this exact fencing generation, this token, not expired. Every failure is the
// same LEASE_REJECTED to the caller; the reason is only for the security log.
export async function lockCurrentLease(
  client: RuntimeClient,
  context: WorkerControlContext,
  attemptId: string,
  proof: LeaseProof,
  acceptedStates: readonly string[] = ["LEASED"],
): Promise<LockedLease> {
  const result = await client.query<{
    id: string;
    account_id: string;
    execution_job_id: string;
    generation_authorization_id: string;
    attempt_number: number;
    billing_mode: string;
    provider: string;
    provider_credential_version_id: string | null;
    state: string;
    lease_worker_principal_id: string | null;
    lease_token_sha256: string | null;
    lease_fencing_counter: string;
    expired: boolean | null;
    credential_granted_at: Date | null;
    submitting_at: Date | null;
  }>(
    `SELECT id, account_id, execution_job_id, generation_authorization_id, attempt_number, billing_mode, provider,
            provider_credential_version_id, state, lease_worker_principal_id, lease_token_sha256,
            lease_fencing_counter, lease_expires_at <= now() AS expired, credential_granted_at, submitting_at
       FROM execution_attempts WHERE id = $1 FOR UPDATE`,
    [attemptId],
  );
  const row = result.rows[0];
  const reject = (reason: WorkerLeaseRejectionReason) => new WorkerLeaseError("LEASE_REJECTED", reason);
  if (row === undefined) throw reject("UNKNOWN_ATTEMPT");
  if (!acceptedStates.includes(row.state)) throw reject("NOT_LEASED");
  if (row.lease_worker_principal_id !== context.workerPrincipalId) throw reject("OTHER_WORKER");
  if (Number(row.lease_fencing_counter) !== proof.fencingCounter) throw reject("FENCING_MISMATCH");
  if (!tokenMatches(proof.leaseToken, row.lease_token_sha256)) throw reject("TOKEN_MISMATCH");
  if (row.expired !== false) throw reject("LEASE_EXPIRED");
  return {
    id: row.id,
    accountId: row.account_id,
    executionJobId: row.execution_job_id,
    generationAuthorizationId: row.generation_authorization_id,
    attemptNumber: row.attempt_number,
    billingMode: row.billing_mode,
    provider: row.provider,
    providerCredentialVersionId: row.provider_credential_version_id,
    fencingCounter: Number(row.lease_fencing_counter),
    credentialGrantedAt: row.credential_granted_at,
    credentialGranted: row.credential_granted_at !== null,
    state: row.state,
    submittingAt: row.submitting_at,
  };
}

// States whose current lease may be renewed (architecture section 12,
// R44B6M and R44B6N): LEASED; SUBMITTING, so the worker that holds
// provider-call authority keeps owning the attempt during the create call;
// and SUBMITTED, only for the exact live-route lease epoch (below). Never
// OUTCOME_UNKNOWN or a terminal state, which carry no lease.
const HEARTBEAT_STATES = ["LEASED", "SUBMITTING", "SUBMITTED"] as const;

// A SUBMITTED attempt may carry a replacement lease (a new token at a higher
// fencing generation), even for the same worker principal, so the principal
// and the current proof alone never show the live-route epoch (R44B6M1). The
// database-stamped, immutable submitting_fencing_counter (migration 0006)
// does: every new token takes a strictly higher generation, so only the epoch
// that entered SUBMITTING still equals it. The principal must also be the
// submitting principal. The row is already locked by lockCurrentLease.
async function requireLiveRouteLeaseEpoch(client: RuntimeClient, attemptId: string, context: WorkerControlContext, fencingCounter: number): Promise<void> {
  const result = await client.query<{ submitting_fencing_counter: string | null; submitting_worker_principal_id: string | null }>(
    "SELECT submitting_fencing_counter, submitting_worker_principal_id FROM execution_attempts WHERE id = $1",
    [attemptId],
  );
  const row = result.rows[0];
  if (
    row === undefined ||
    row.submitting_fencing_counter === null ||
    Number(row.submitting_fencing_counter) !== fencingCounter ||
    row.submitting_worker_principal_id !== context.workerPrincipalId
  ) {
    throw new WorkerLeaseError("LEASE_REJECTED", "SUBMITTED_LEASE_EPOCH_MISMATCH");
  }
}

// Renews the caller's current lease: heartbeat_at and lease_expires_at move
// forward; state, fencing generation, provenance and everything else stay
// unchanged. Renewal never re-enters SUBMITTING or creates new authority.
export async function heartbeatWorkerLease(
  pool: TransactionalPool,
  context: WorkerControlContext,
  attemptId: string,
  proof: LeaseProof,
): Promise<Readonly<{ fencingCounter: number; leaseExpiresAt: Date }>> {
  return withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);
    const lease = await lockCurrentLease(client, context, attemptId, proof, HEARTBEAT_STATES);
    if (lease.state === "SUBMITTED") await requireLiveRouteLeaseEpoch(client, lease.id, context, lease.fencingCounter);
    const renewed = await client.query<{ lease_expires_at: Date }>(
      `UPDATE execution_attempts
          SET heartbeat_at = now(), lease_expires_at = now() + make_interval(secs => $2), updated_at = now()
        WHERE id = $1 AND state = $3 AND lease_worker_principal_id = $4 AND lease_fencing_counter = $5
        RETURNING lease_expires_at`,
      [lease.id, WORKER_LEASE_DURATION_SECONDS, lease.state, context.workerPrincipalId, lease.fencingCounter],
    );
    const row = renewed.rows[0];
    if (row === undefined) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");
    return Object.freeze({ fencingCounter: lease.fencingCounter, leaseExpiresAt: row.lease_expires_at });
  });
}

// Returns the caller's lease to the queue (LEASED -> QUEUED) before any
// credential grant and before SUBMITTING. The fencing generation is kept, so
// the next lease takes a strictly higher one.
export async function releaseWorkerLease(pool: TransactionalPool, context: WorkerControlContext, attemptId: string, proof: LeaseProof): Promise<void> {
  await withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);
    const lease = await lockCurrentLease(client, context, attemptId, proof);
    if (lease.credentialGranted) throw new WorkerLeaseError("LEASE_REJECTED", "CREDENTIAL_GRANTED");
    await client.query(
      `UPDATE execution_attempts SET state = 'QUEUED', ${CLEAR_LEASE}, updated_at = now()
        WHERE id = $1 AND state = 'LEASED' AND credential_granted_at IS NULL`,
      [lease.id],
    );
    await client.query("UPDATE execution_jobs SET status = 'QUEUED', updated_at = now() WHERE id = $1 AND status = 'RUNNING'", [lease.executionJobId]);
    await audit(client, "execution_attempt.lease_released", { id: lease.id, accountId: lease.accountId }, context.correlationId, {
      attemptNumber: lease.attemptNumber,
      fencingCounter: lease.fencingCounter,
      workerPrincipalId: context.workerPrincipalId,
    });
  });
}
