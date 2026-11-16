import type { TransactionalPool } from "../database/runtimePool.js";
import { isStructurallyValidVerificationPolicyId } from "../providerConnections/providerCapabilityRegistry.js";
import { requireActiveWorker, withTransaction, WorkerLeaseError, type LeaseProof, type WorkerControlContext } from "./workerLeaseService.js";
import {
  lockVerificationJob,
  lockVerificationLifecycle,
  rejectVerification,
  requireEligibleForVerification,
  requireLiveVerificationLease,
} from "./workerProviderVerificationLeaseService.js";

// R44B11F Phase 3 durable VERIFYING barrier: LEASED -> VERIFYING.
//
// Receiving a sealed envelope is not authority to open it. A worker may open
// the credential and perform the fixed metadata request only after this
// acknowledgement. Nothing here opens a credential or calls a provider.
//
// One READ COMMITTED transaction. Lock order:
//
//   worker principal FOR SHARE -> verification job FOR UPDATE
//   -> Account FOR SHARE -> ProviderConnection FOR UPDATE
//   -> exact credential version FOR SHARE
//
// The first barrier requires the current live lease proof, a committed
// credential grant, and the bound version still being the eligible
// connection's current ACTIVE version. It atomically stamps the immutable
// verifying provenance (database time, this worker, this fence) and the
// aggregate last_verification_attempt_at, which the eligibility check proves
// still belongs to the same current version. A rotation or disconnect that
// committed first makes the barrier fail closed.
//
// A committed barrier is durable provider-call authority, exactly like the
// SUBMITTING barrier. An exact replay by the worker and fence that crossed
// it, under the same still-live lease, only recovers that acknowledgement:
// it returns the original verifying_at with no write, no aggregate timestamp
// rewrite and no audit, and does NOT re-run first-transition eligibility. A
// rotation, disconnect or Account change committed after the barrier does
// not erase it. Only a DESTROYED bound version, which would break the
// retention invariant, fails a replay closed.

export type ProviderVerificationVerifyingAcknowledgement = Readonly<{
  providerVerificationJobId: string;
  fencingCounter: number;
  state: "VERIFYING";
  verifyingAt: Date;
  // false for an exact replay.
  firstTransition: boolean;
}>;

export async function acknowledgeProviderVerificationVerifying(
  pool: TransactionalPool,
  context: WorkerControlContext,
  jobId: string,
  proof: LeaseProof,
): Promise<ProviderVerificationVerifyingAcknowledgement> {
  return withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);
    const job = await lockVerificationJob(client, jobId);
    if (job.state !== "LEASED" && job.state !== "VERIFYING") throw rejectVerification("NOT_LEASED");
    requireLiveVerificationLease(job, context, proof);

    if (job.state === "VERIFYING") {
      // Replay: the authority was already committed; recover its acknowledgement only.
      if (job.verifyingWorkerPrincipalId !== context.workerPrincipalId || job.verifyingFencingCounter !== proof.fencingCounter) {
        throw rejectVerification("VERIFYING_PRINCIPAL_MISMATCH");
      }
      if (job.verifyingAt === null) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");
      const committed = await lockVerificationLifecycle(client, job, "FOR SHARE");
      if (committed.versionStatus === "DESTROYED") throw rejectVerification("VERIFYING_VERSION_DESTROYED");
      return Object.freeze({
        providerVerificationJobId: job.id,
        fencingCounter: job.leaseFencingCounter,
        state: "VERIFYING" as const,
        verifyingAt: job.verifyingAt,
        firstTransition: false,
      });
    }

    // First transition: everything must still be eligible for provider-call authority.
    if (job.credentialGrantedAt === null) throw rejectVerification("CREDENTIAL_NOT_GRANTED");
    const lifecycle = await lockVerificationLifecycle(client, job, "FOR UPDATE");
    requireEligibleForVerification(lifecycle);
    if (!isStructurallyValidVerificationPolicyId(job.verificationPolicyId)) throw rejectVerification("VERIFICATION_POLICY_INVALID");

    const barrier = await client.query<{ verifying_at: Date }>(
      `UPDATE provider_verification_jobs
          SET state = 'VERIFYING', verifying_at = now(), verifying_worker_principal_id = $2,
              verifying_fencing_counter = lease_fencing_counter, updated_at = now()
        WHERE id = $1 AND state = 'LEASED' AND credential_granted_at IS NOT NULL
          AND lease_worker_principal_id = $2 AND lease_fencing_counter = $3
        RETURNING verifying_at`,
      [job.id, context.workerPrincipalId, proof.fencingCounter],
    );
    const verifyingAt = barrier.rows[0]?.verifying_at;
    if (verifyingAt === undefined) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");

    // Same transaction, same database time as the barrier.
    const attempt = await client.query<{ id: string }>(
      `UPDATE provider_connections SET last_verification_attempt_at = now(), updated_at = now()
        WHERE account_id = $1 AND id = $2
        RETURNING id`,
      [job.accountId, job.providerConnectionId],
    );
    if (attempt.rows.length !== 1) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");

    return Object.freeze({
      providerVerificationJobId: job.id,
      fencingCounter: job.leaseFencingCounter,
      state: "VERIFYING" as const,
      verifyingAt,
      firstTransition: true,
    });
  });
}
