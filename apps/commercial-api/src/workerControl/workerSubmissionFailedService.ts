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

// The submission-failed report (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md
// section 18, "submission-failed route"; contract locked by R44B6T0).
//
// A worker that crossed the SUBMITTING barrier reports that the provider
// create did not produce durable acceptance: either a definitive provider
// rejection (SUBMITTING -> FAILED_BEFORE_SUBMISSION) or an outcome that cannot
// rule out acceptance (SUBMITTING -> OUTCOME_UNKNOWN). Nothing here calls a
// provider, opens a credential, retries or creates a new attempt.
//
// First transition (attempt still SUBMITTING): the full live-lease proof of
// lockCurrentLease plus the exact submission epoch (migrations 0005 and
// 0006). One READ COMMITTED transaction, lock order as for the barrier:
//
//   1. worker principal          FOR SHARE
//   2. execution attempt         FOR UPDATE
//   3. provider connection       FOR SHARE
//   4. exact credential version  FOR SHARE (must not be DESTROYED)
//
// Both target states clear the lease (migration 0004), so no token verifier
// survives the first commit. A request for an attempt that is no longer
// SUBMITTING is therefore a replay candidate, authorised by the original
// submission epoch only: the ACTIVE caller is the immutable submitting
// principal and the fencing counter equals both the immutable submitting
// counter and the retained lease counter. The lease token is then not
// authority and is never claimed to be validated. A replay succeeds only on
// an exact match with the committed state and failure code, and writes
// nothing; it neither locks nor requires the credential version.
//
// The outcome/failure-code pair is classified only after the applicable
// authority is proven, so an unauthorised caller learns nothing about route
// semantics. The request vocabulary itself is validated by the router.

export type SubmissionFailureOutcome = "DEFINITIVELY_REJECTED" | "OUTCOME_UNKNOWN";
export type SubmissionFailureCode =
  | "PROVIDER_REJECTED_DEFINITIVELY"
  | "PROVIDER_SUBMISSION_AMBIGUOUS"
  | "ACCEPTANCE_JOURNAL_WRITE_FAILED"
  | "PROVIDER_EXECUTION_ID_INVALID";
export type SubmissionFailureState = "FAILED_BEFORE_SUBMISSION" | "OUTCOME_UNKNOWN";

// The closed worker-reportable table (sections 18 and 27). The sweep-only
// WORKER_LEASE_EXPIRED_DURING_SUBMISSION is deliberately absent.
const OUTCOMES: Readonly<Record<SubmissionFailureOutcome, Readonly<{ state: SubmissionFailureState; codes: readonly SubmissionFailureCode[] }>>> = {
  DEFINITIVELY_REJECTED: { state: "FAILED_BEFORE_SUBMISSION", codes: ["PROVIDER_REJECTED_DEFINITIVELY"] },
  OUTCOME_UNKNOWN: {
    state: "OUTCOME_UNKNOWN",
    codes: ["PROVIDER_SUBMISSION_AMBIGUOUS", "ACCEPTANCE_JOURNAL_WRITE_FAILED", "PROVIDER_EXECUTION_ID_INVALID"],
  },
};
const CODES: ReadonlySet<string> = new Set(Object.values(OUTCOMES).flatMap(({ codes }) => codes));

export const isSubmissionFailureOutcome = (value: unknown): value is SubmissionFailureOutcome => typeof value === "string" && Object.hasOwn(OUTCOMES, value);
export const isWorkerReportableFailureCode = (value: unknown): value is SubmissionFailureCode => typeof value === "string" && CODES.has(value);

export type WorkerSubmissionFailure = Readonly<{
  executionAttemptId: string;
  fencingCounter: number;
  state: SubmissionFailureState;
  failureCode: SubmissionFailureCode;
  // false for an exact replay of an already-committed report.
  firstTransition: boolean;
}>;

const reject = (reason: WorkerLeaseRejectionReason) => new WorkerLeaseError("LEASE_REJECTED", reason);

export async function reportWorkerSubmissionFailed(
  pool: TransactionalPool,
  context: WorkerControlContext,
  attemptId: string,
  proof: LeaseProof,
  outcome: SubmissionFailureOutcome,
  failureCode: SubmissionFailureCode,
): Promise<WorkerSubmissionFailure> {
  const target = OUTCOMES[outcome];
  const pairValid = target.codes.includes(failureCode);

  return withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);
    const locked = await client.query<{
      state: string;
      failure_code: string | null;
      lease_fencing_counter: string;
      submitting_at: Date | null;
      submitting_worker_principal_id: string | null;
      submitting_fencing_counter: string | null;
    }>(
      `SELECT state, failure_code, lease_fencing_counter, submitting_at, submitting_worker_principal_id, submitting_fencing_counter
         FROM execution_attempts WHERE id = $1 FOR UPDATE`,
      [attemptId],
    );
    const row = locked.rows[0];
    if (row === undefined) throw reject("UNKNOWN_ATTEMPT");

    if (row.state !== "SUBMITTING") {
      // Replay candidate: prove the original submission epoch before
      // disclosing any state. The lease token is not consulted.
      if (row.submitting_worker_principal_id !== context.workerPrincipalId) throw reject("SUBMITTING_PRINCIPAL_MISMATCH");
      if (row.submitting_at === null) throw reject("INCOMPATIBLE_ATTEMPT_STATE");
      if (
        row.submitting_fencing_counter === null ||
        Number(row.submitting_fencing_counter) !== proof.fencingCounter ||
        Number(row.lease_fencing_counter) !== proof.fencingCounter
      ) {
        throw reject("FENCING_MISMATCH");
      }
      if (!pairValid) throw reject("FAILURE_CODE_OUTCOME_MISMATCH");
      // Only the exact committed result replays. A different outcome or code,
      // a sweep-recorded expiry or any other state is never rewritten.
      if (row.state !== target.state || row.failure_code !== failureCode) throw reject("INCOMPATIBLE_ATTEMPT_STATE");
      return Object.freeze({ executionAttemptId: attemptId, fencingCounter: proof.fencingCounter, state: target.state, failureCode, firstTransition: false });
    }

    // First transition: the full live-lease proof (the row is already locked).
    const lease = await lockCurrentLease(client, context, attemptId, proof, ["SUBMITTING"]);
    // The exact live-route submission epoch; a replacement or recovery lease
    // never reports the original provider-call failure.
    if (row.submitting_worker_principal_id !== context.workerPrincipalId) throw reject("SUBMITTING_PRINCIPAL_MISMATCH");
    if (row.submitting_fencing_counter === null || Number(row.submitting_fencing_counter) !== lease.fencingCounter) throw reject("FENCING_MISMATCH");

    // The exact bound version must not be DESTROYED (an invariant failure).
    let credentialVersion: number | undefined;
    if (lease.providerCredentialVersionId !== null) {
      const binding = await client.query<{ provider_connection_id: string }>(
        "SELECT provider_connection_id FROM provider_credential_versions WHERE account_id = $1 AND id = $2",
        [lease.accountId, lease.providerCredentialVersionId],
      );
      const connectionId = binding.rows[0]?.provider_connection_id;
      if (connectionId === undefined) throw reject("AUTHORIZATION_INCONSISTENT");
      await client.query("SELECT id FROM provider_connections WHERE account_id = $1 AND id = $2 FOR SHARE", [lease.accountId, connectionId]);
      const version = await client.query<{ credential_version: number; status: string }>(
        `SELECT credential_version, status FROM provider_credential_versions
          WHERE account_id = $1 AND provider_connection_id = $2 AND id = $3
            FOR SHARE`,
        [lease.accountId, connectionId, lease.providerCredentialVersionId],
      );
      const versionRow = version.rows[0];
      if (versionRow === undefined) throw reject("AUTHORIZATION_INCONSISTENT");
      if (versionRow.status === "DESTROYED") throw reject("SUBMITTING_VERSION_DESTROYED");
      credentialVersion = versionRow.credential_version;
    }

    if (!pairValid) throw reject("FAILURE_CODE_OUTCOME_MISMATCH");

    // Every current-lease field is cleared; submitting provenance, the
    // retained fencing counter and the credential grant are kept.
    const transitioned =
      target.state === "FAILED_BEFORE_SUBMISSION"
        ? await client.query(
            `UPDATE execution_attempts
                SET state = 'FAILED_BEFORE_SUBMISSION', failure_code = $2, completed_at = now(), updated_at = now(),
                    lease_worker_principal_id = NULL, lease_token_sha256 = NULL, leased_at = NULL, lease_expires_at = NULL, heartbeat_at = NULL
              WHERE id = $1 AND state = 'SUBMITTING'
             RETURNING id`,
            [attemptId, failureCode],
          )
        : await client.query(
            `UPDATE execution_attempts
                SET state = 'OUTCOME_UNKNOWN', failure_code = $2, updated_at = now(),
                    lease_worker_principal_id = NULL, lease_token_sha256 = NULL, leased_at = NULL, lease_expires_at = NULL, heartbeat_at = NULL
              WHERE id = $1 AND state = 'SUBMITTING'
             RETURNING id`,
            [attemptId, failureCode],
          );
    if (transitioned.rows.length !== 1) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");

    if (target.state === "FAILED_BEFORE_SUBMISSION") {
      // No automatic retry or new attempt exists in v1.
      await client.query("UPDATE execution_jobs SET status = 'FAILED', completed_at = now(), updated_at = now() WHERE id = $1 AND status = 'RUNNING'", [
        lease.executionJobId,
      ]);
    } else {
      await client.query("UPDATE execution_jobs SET status = 'NEEDS_ATTENTION', updated_at = now() WHERE id = $1 AND status = 'RUNNING'", [
        lease.executionJobId,
      ]);
    }
    await audit(
      client,
      target.state === "FAILED_BEFORE_SUBMISSION" ? "execution_attempt.failed_before_submission" : "execution_attempt.outcome_unknown",
      { id: attemptId, accountId: lease.accountId },
      context.correlationId,
      {
        attemptNumber: lease.attemptNumber,
        fencingCounter: lease.fencingCounter,
        workerPrincipalId: context.workerPrincipalId,
        provider: lease.provider,
        ...(credentialVersion === undefined ? {} : { credentialVersion }),
        failureCode,
      },
    );

    return Object.freeze({ executionAttemptId: attemptId, fencingCounter: lease.fencingCounter, state: target.state, failureCode, firstTransition: true });
  });
}
