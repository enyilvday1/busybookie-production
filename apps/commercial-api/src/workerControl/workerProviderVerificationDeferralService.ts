import type { TransactionalPool } from "../database/runtimePool.js";
import { requireActiveWorker, withTransaction, WorkerLeaseError, type LeaseProof, type WorkerControlContext } from "./workerLeaseService.js";
import { lockVerificationJob, rejectVerification, requireLiveVerificationLease } from "./workerProviderVerificationLeaseService.js";

// R44B11G unsupported verification lease bounded deferral
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md, R44B11G sections
// 1, 2, 4.3 and 6).
//
// A worker that leased a verification job it cannot serve reports its
// admission refusal here. The refusal is evidence about that worker build
// only and is never terminal authority: the job goes LEASED -> QUEUED with a
// bounded deferral and stays open, leasable after the deferral, and subject to
// the existing lifecycle reconciler. Nothing here writes a terminal state, a
// result, an audit row or a customer-visible column, and nothing reads a
// credential or calls a provider.
//
// One READ COMMITTED transaction. Lock order:
//
//   worker principal FOR SHARE -> verification job FOR UPDATE
//
// No Account, ProviderConnection or credential-version row is read or locked.
// Authority checks, in order: ACTIVE worker, the named job, LEASED, the live
// lease proof (owner, fence, token verifier, database-clock expiry), then no
// credential grant under this lease.
//
// The deferral is d(n) seconds of database time after transaction-start now(),
// where n is the count after the increment. Migration 0011's guard trigger is
// the authoritative upper bound: whatever schedule a caller uses, the database
// refuses a deferral that is not in the future or exceeds d(n). The schedule
// parameter exists for tests only; the HTTP route never passes one and the
// request body carries no duration.
//
// A repeat after a committed deferral is not replayed: the job is no longer
// LEASED, so it is rejected NOT_LEASED. A count overflow raises a database
// error, rolls the transaction back and leaves the job LEASED until natural
// expiry requeues it.

export const PROVIDER_VERIFICATION_REFUSALS = Object.freeze(["UNSUPPORTED_PROVIDER", "UNSUPPORTED_POLICY", "PROVIDER_POLICY_MISMATCH"] as const);

export type ProviderVerificationRefusal = (typeof PROVIDER_VERIFICATION_REFUSALS)[number];

export function isProviderVerificationRefusal(value: unknown): value is ProviderVerificationRefusal {
  return typeof value === "string" && (PROVIDER_VERIFICATION_REFUSALS as readonly string[]).includes(value);
}

// Seconds of deferral for the count after the increment (n >= 1).
export type UnsupportedDeferralSchedule = (deferralCount: number) => number;

// d(n): 300, 600, 1200, 2400, then 3600 seconds for every n >= 5.
export function unsupportedDeferralSeconds(deferralCount: number): number {
  return deferralCount >= 5 ? 3600 : 300 * 2 ** (deferralCount - 1);
}

export type ProviderVerificationDeferral = Readonly<{
  providerVerificationJobId: string;
  fencingCounter: number;
  state: "QUEUED";
  deferredUntil: Date;
}>;

export async function deferUnsupportedProviderVerification(
  pool: TransactionalPool,
  context: WorkerControlContext,
  jobId: string,
  proof: LeaseProof,
  refusal: ProviderVerificationRefusal,
  schedule: UnsupportedDeferralSchedule = unsupportedDeferralSeconds,
): Promise<ProviderVerificationDeferral> {
  return withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);
    const job = await lockVerificationJob(client, jobId);
    if (job.state !== "LEASED") throw rejectVerification("NOT_LEASED");
    requireLiveVerificationLease(job, context, proof);
    if (job.credentialGrantedAt !== null) throw rejectVerification("CREDENTIAL_GRANTED");

    // The job row is already locked FOR UPDATE by this transaction.
    const counted = await client.query<{ unsupported_deferral_count: number }>(
      "SELECT unsupported_deferral_count FROM provider_verification_jobs WHERE id = $1",
      [job.id],
    );
    const previousCount = counted.rows[0]?.unsupported_deferral_count;
    if (typeof previousCount !== "number" || !Number.isSafeInteger(previousCount) || previousCount < 0) {
      throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");
    }
    const deferralSeconds = schedule(previousCount + 1);
    if (typeof deferralSeconds !== "number" || !Number.isFinite(deferralSeconds) || deferralSeconds <= 0) {
      throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");
    }

    const deferred = await client.query<{ lease_fencing_counter: string; deferred_until: Date }>(
      `UPDATE provider_verification_jobs
          SET state = 'QUEUED', lease_worker_principal_id = NULL, lease_token_sha256 = NULL,
              leased_at = NULL, lease_expires_at = NULL,
              unsupported_deferral_count = unsupported_deferral_count + 1,
              last_unsupported_refusal = $5, deferred_until = now() + make_interval(secs => $6), updated_at = now()
        WHERE id = $1 AND state = 'LEASED' AND credential_granted_at IS NULL
          AND lease_worker_principal_id = $2 AND lease_fencing_counter = $3 AND unsupported_deferral_count = $4
        RETURNING lease_fencing_counter, deferred_until`,
      [job.id, context.workerPrincipalId, job.leaseFencingCounter, previousCount, refusal, deferralSeconds],
    );
    const row = deferred.rows[0];
    if (row === undefined) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");

    return Object.freeze({
      providerVerificationJobId: job.id,
      fencingCounter: Number(row.lease_fencing_counter),
      state: "QUEUED" as const,
      deferredUntil: row.deferred_until,
    });
  });
}
