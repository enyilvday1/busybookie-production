import type { TransactionalPool } from "../database/runtimePool.js";
import {
  audit,
  lockCurrentLease,
  requireActiveWorker,
  withTransaction,
  WorkerLeaseError,
  type LeaseProof,
  type WorkerControlContext,
} from "./workerLeaseService.js";
import type { WorkerLeaseRejectionReason } from "./workerSecurityEvents.js";

// The input-failed report (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md
// section 18, "input-failed route"; contract locked by R44B10P2).
//
// A worker that holds a granted, live LEASED attempt reports a permanent
// pre-provider input failure: LEASED -> FAILED_BEFORE_SUBMISSION, before any
// SUBMITTING barrier, provider construction or provider dispatch. It is never
// a provider rejection, a provider ambiguity or a submission failure. Nothing
// here calls a provider, opens a credential, retries or creates a new attempt.
//
// First transition (attempt still LEASED): the full live-lease proof of
// lockCurrentLease and a recorded credential grant. One READ COMMITTED
// transaction, lock order as for every lease-scoped route:
//
//   1. worker principal  FOR SHARE
//   2. execution attempt FOR UPDATE
//
// The exact credential version is read (never locked) only for the audit
// record. The target state clears the lease (migration 0004), and the
// migration 0007 guard stamps the reporter and its lease epoch from the lease
// being cleared. A request for an attempt that is no longer LEASED is
// therefore a replay candidate, authorised by that provenance only: the
// ACTIVE caller is the reporter, and the fencing counter equals both the
// reporting epoch and the retained lease counter. The lease token is then
// not authority and is never claimed to be validated. Only after that is the
// failure code compared; an exact match replays and writes nothing.
//
// The request vocabulary itself is validated by the router.

export const INPUT_FAILURE_CODES = Object.freeze([
  "INPUT_REFERENCE_INVALID",
  "INPUT_OBJECT_NOT_FOUND",
  "INPUT_OBJECT_TOO_LARGE",
  "INPUT_OBJECT_INTEGRITY_MISMATCH",
  "INPUT_MEDIA_TYPE_INVALID",
] as const);
export type InputFailureCode = (typeof INPUT_FAILURE_CODES)[number];

const CODES: ReadonlySet<string> = new Set(INPUT_FAILURE_CODES);
export const isInputFailureCode = (value: unknown): value is InputFailureCode => typeof value === "string" && CODES.has(value);

export type WorkerInputFailure = Readonly<{
  executionAttemptId: string;
  fencingCounter: number;
  state: "FAILED_BEFORE_SUBMISSION";
  failureCode: InputFailureCode;
  // false for an exact replay of an already-committed report.
  firstTransition: boolean;
}>;

const reject = (reason: WorkerLeaseRejectionReason) => new WorkerLeaseError("LEASE_REJECTED", reason);

export async function reportWorkerInputFailed(
  pool: TransactionalPool,
  context: WorkerControlContext,
  attemptId: string,
  proof: LeaseProof,
  failureCode: InputFailureCode,
): Promise<WorkerInputFailure> {
  return withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);
    const locked = await client.query<{
      state: string;
      failure_code: string | null;
      lease_fencing_counter: string;
      submitting_at: Date | null;
      input_failed_worker_principal_id: string | null;
      input_failed_fencing_counter: string | null;
    }>(
      `SELECT state, failure_code, lease_fencing_counter, submitting_at, input_failed_worker_principal_id, input_failed_fencing_counter
         FROM execution_attempts WHERE id = $1 FOR UPDATE`,
      [attemptId],
    );
    const row = locked.rows[0];
    if (row === undefined) throw reject("UNKNOWN_ATTEMPT");

    if (row.state !== "LEASED") {
      // Replay candidate: prove the reporter and its epoch before disclosing
      // any state. The lease token is not consulted.
      if (row.input_failed_worker_principal_id !== context.workerPrincipalId) throw reject("INPUT_FAILURE_PRINCIPAL_MISMATCH");
      if (
        row.input_failed_fencing_counter === null ||
        Number(row.input_failed_fencing_counter) !== proof.fencingCounter ||
        Number(row.lease_fencing_counter) !== proof.fencingCounter
      ) {
        throw reject("FENCING_MISMATCH");
      }
      // Only the exact committed input failure replays; the first reason wins.
      if (row.state !== "FAILED_BEFORE_SUBMISSION" || row.submitting_at !== null || row.failure_code !== failureCode) {
        throw reject("INCOMPATIBLE_ATTEMPT_STATE");
      }
      return Object.freeze({ executionAttemptId: attemptId, fencingCounter: proof.fencingCounter, state: "FAILED_BEFORE_SUBMISSION", failureCode, firstTransition: false });
    }

    // First transition: the full live-lease proof (the row is already locked).
    const lease = await lockCurrentLease(client, context, attemptId, proof, ["LEASED"]);
    if (lease.credentialGrantedAt === null) throw reject("CREDENTIAL_NOT_GRANTED");
    // LEASED implies no SUBMITTING barrier (migration 0004); anything else is an invariant failure.
    if (lease.submittingAt !== null) throw reject("AUTHORIZATION_INCONSISTENT");

    let credentialVersion: number | undefined;
    if (lease.providerCredentialVersionId !== null) {
      const version = await client.query<{ credential_version: number }>(
        "SELECT credential_version FROM provider_credential_versions WHERE account_id = $1 AND id = $2",
        [lease.accountId, lease.providerCredentialVersionId],
      );
      credentialVersion = version.rows[0]?.credential_version;
      if (credentialVersion === undefined) throw reject("AUTHORIZATION_INCONSISTENT");
    }

    // Every current-lease field is cleared; the retained fencing counter and
    // the credential grant are kept. The guard stamps the provenance.
    const transitioned = await client.query(
      `UPDATE execution_attempts
          SET state = 'FAILED_BEFORE_SUBMISSION', failure_code = $2, completed_at = now(), updated_at = now(),
              lease_worker_principal_id = NULL, lease_token_sha256 = NULL, leased_at = NULL, lease_expires_at = NULL, heartbeat_at = NULL
        WHERE id = $1 AND state = 'LEASED' AND credential_granted_at IS NOT NULL AND submitting_at IS NULL
       RETURNING id`,
      [attemptId, failureCode],
    );
    if (transitioned.rows.length !== 1) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");

    // No automatic retry or new attempt exists in v1.
    await client.query("UPDATE execution_jobs SET status = 'FAILED', completed_at = now(), updated_at = now() WHERE id = $1 AND status = 'RUNNING'", [
      lease.executionJobId,
    ]);
    await audit(client, "execution_attempt.input_failed", { id: attemptId, accountId: lease.accountId }, context.correlationId, {
      attemptNumber: lease.attemptNumber,
      fencingCounter: lease.fencingCounter,
      workerPrincipalId: context.workerPrincipalId,
      provider: lease.provider,
      ...(credentialVersion === undefined ? {} : { credentialVersion }),
      failureCode,
    });

    return Object.freeze({ executionAttemptId: attemptId, fencingCounter: lease.fencingCounter, state: "FAILED_BEFORE_SUBMISSION", failureCode, firstTransition: true });
  });
}
