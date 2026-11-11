import type { TransactionalPool } from "../database/runtimePool.js";
import { audit, requireActiveWorker, sweepExpiredSubmittingAttempts, withTransaction, WorkerLeaseError, type WorkerControlContext } from "./workerLeaseService.js";
import type { WorkerLeaseRejectionReason } from "./workerSecurityEvents.js";

// Section 18 acceptance recovery, R44B6R. The authenticated worker reports
// only the original fence and accepted provider identity, never journal JSON.
// No token, new lease, provider call or credential material is involved.
export type WorkerAcceptanceRecoveryResult =
  | Readonly<{ state: "SUBMITTING" }>
  | Readonly<{
      executionAttemptId: string;
      fencingCounter: number;
      state: "SUBMITTED" | "SUCCEEDED" | "SUBMITTED_FAILED" | "ABANDONED";
      providerExecutionId: string;
    }>;

const reject = (reason: WorkerLeaseRejectionReason) => new WorkerLeaseError("LEASE_REJECTED", reason);

export async function recoverWorkerAcceptance(
  pool: TransactionalPool,
  context: WorkerControlContext,
  attemptId: string,
  fencingCounter: number,
  providerExecutionId: string,
): Promise<WorkerAcceptanceRecoveryResult> {
  // Expiry is a control-plane lifecycle fact, committed independently even
  // when the later recovery refuses. The shared sweep uses server now(), not
  // a caller clock, and touches only the named attempt here.
  await withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);
    await sweepExpiredSubmittingAttempts(client, context.correlationId, attemptId);
  });

  return withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);
    const locked = await client.query<{
      id: string; account_id: string; execution_job_id: string; generation_authorization_id: string;
      attempt_number: number; billing_mode: string; provider: string; provider_credential_version_id: string | null;
      state: string; lease_fencing_counter: string; submitting_fencing_counter: string | null;
      submitting_worker_principal_id: string | null; submitting_at: Date | null; provider_execution_id: string | null;
    }>(
      `SELECT id, account_id, execution_job_id, generation_authorization_id, attempt_number, billing_mode, provider,
              provider_credential_version_id, state, lease_fencing_counter, submitting_fencing_counter,
              submitting_worker_principal_id, submitting_at, provider_execution_id
         FROM execution_attempts WHERE id = $1 FOR UPDATE`, [attemptId],
    );
    const attempt = locked.rows[0];
    if (attempt === undefined) throw reject("UNKNOWN_ATTEMPT");
    // Prove the immutable submission epoch before disclosing any state. The
    // current principal alone, or a newer same-principal fence, is insufficient.
    if (attempt.submitting_worker_principal_id !== context.workerPrincipalId) throw reject("SUBMITTING_PRINCIPAL_MISMATCH");
    if (attempt.submitting_fencing_counter === null || Number(attempt.submitting_fencing_counter) !== fencingCounter ||
        Number(attempt.lease_fencing_counter) !== fencingCounter) throw reject("FENCING_MISMATCH");
    if (attempt.submitting_at === null) throw reject("INCOMPATIBLE_ATTEMPT_STATE");
    if (attempt.state === "SUBMITTING") return Object.freeze({ state: "SUBMITTING" });

    const replay = attempt.state === "SUBMITTED" || attempt.state === "SUCCEEDED" || attempt.state === "SUBMITTED_FAILED" || attempt.state === "ABANDONED";
    if (replay) {
      if (attempt.provider_execution_id !== providerExecutionId) throw reject("PROVIDER_EXECUTION_CONFLICT");
      // The same-ID committed result is authoritative, including terminal
      // outcomes whose credential-retention obligation has already closed.
      return Object.freeze({ executionAttemptId: attempt.id, fencingCounter, state: attempt.state as "SUBMITTED" | "SUCCEEDED" | "SUBMITTED_FAILED" | "ABANDONED", providerExecutionId });
    }
    if (attempt.state !== "OUTCOME_UNKNOWN") throw reject("INCOMPATIBLE_ATTEMPT_STATE");

    // Authoritative immutable bindings only. The request carries no account,
    // job, provider, request digest, connection or credential version to trust.
    const binding = (await client.query<{
      authorization_status: string; provider: string; billing_mode: string; provider_connection_id: string | null;
      provider_credential_version_id: string | null; production_id: string; job_production_id: string;
      job_authorization_id: string; job_status: string;
    }>(
      `SELECT g.status AS authorization_status, g.provider, g.billing_mode, g.provider_connection_id,
              g.provider_credential_version_id, g.production_id, j.production_id AS job_production_id,
              j.generation_authorization_id AS job_authorization_id, j.status AS job_status
         FROM generation_authorizations g
         JOIN execution_jobs j ON j.account_id = g.account_id AND j.id = $3
        WHERE g.account_id = $1 AND g.id = $2`,
      [attempt.account_id, attempt.generation_authorization_id, attempt.execution_job_id],
    )).rows[0];
    if (binding === undefined || binding.authorization_status !== "CLAIMED" || binding.provider !== attempt.provider ||
        binding.billing_mode !== attempt.billing_mode || binding.provider_credential_version_id !== attempt.provider_credential_version_id ||
        binding.production_id !== binding.job_production_id || binding.job_authorization_id !== attempt.generation_authorization_id ||
        binding.job_status !== "NEEDS_ATTENTION" || attempt.billing_mode !== "USER_BYO" ||
        attempt.provider_credential_version_id === null || binding.provider_connection_id === null) throw reject("INCOMPATIBLE_ATTEMPT_STATE");

    // Same lock order as submission/disconnect: connection then exact version.
    // A later disconnect or rotation cannot substitute the original version.
    const connection = (await client.query<{ provider: string }>(
      "SELECT provider FROM provider_connections WHERE account_id = $1 AND id = $2 FOR SHARE",
      [attempt.account_id, binding.provider_connection_id],
    )).rows[0];
    const version = (await client.query<{ status: string; credential_version: number }>(
      `SELECT status, credential_version FROM provider_credential_versions
        WHERE account_id = $1 AND provider_connection_id = $2 AND id = $3 FOR SHARE`,
      [attempt.account_id, binding.provider_connection_id, attempt.provider_credential_version_id],
    )).rows[0];
    if (connection?.provider !== attempt.provider || version === undefined) throw reject("INCOMPATIBLE_ATTEMPT_STATE");
    if (version.status === "DESTROYED") throw reject("SUBMITTING_VERSION_DESTROYED");

    try {
      // Clear the unknown-outcome failure code as required by schema v6's
      // failure-state check. Lease fields, submitting provenance, credential
      // grant and the undefined provider recovery horizon are untouched.
      await client.query(
        `UPDATE execution_attempts SET state = 'SUBMITTED', provider_execution_id = $2,
                submitted_at = now(), failure_code = NULL, updated_at = now()
          WHERE id = $1 AND state = 'OUTCOME_UNKNOWN'`, [attempt.id, providerExecutionId],
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "23505" && "constraint" in error &&
          error.constraint === "execution_attempts_provider_execution_uq") throw reject("PROVIDER_EXECUTION_ID_IN_USE");
      throw error;
    }
    await client.query("UPDATE execution_jobs SET status = 'RUNNING', updated_at = now() WHERE id = $1 AND status = 'NEEDS_ATTENTION'", [attempt.execution_job_id]);
    await audit(client, "execution_attempt.submitted", { id: attempt.id, accountId: attempt.account_id }, context.correlationId, {
      attemptNumber: attempt.attempt_number, fencingCounter, workerPrincipalId: context.workerPrincipalId,
      provider: attempt.provider, credentialVersion: version.credential_version, recoveredFromJournal: true,
    });
    return Object.freeze({ executionAttemptId: attempt.id, fencingCounter, state: "SUBMITTED", providerExecutionId });
  });
}
