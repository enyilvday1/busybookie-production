import type { TransactionalPool } from "../database/runtimePool.js";
import { requireActiveWorker, withTransaction, WorkerLeaseError, type LeaseProof, type WorkerControlContext } from "./workerLeaseService.js";
import {
  isCurrentForAggregate,
  lockVerificationJob,
  lockVerificationLifecycle,
  rejectVerification,
  requireLiveVerificationLease,
} from "./workerProviderVerificationLeaseService.js";

// R44B11F Phase 3 worker-reported terminal result: VERIFYING -> COMPLETED.
// Implements the published result wire contract (R44B11F Phase 3 result
// wire-contract amendment); it does not classify provider responses.
//
// One READ COMMITTED transaction. Lock order:
//
//   worker principal FOR SHARE -> verification job FOR UPDATE
//   -> Account FOR SHARE -> ProviderConnection FOR UPDATE
//   -> exact credential version FOR SHARE
//
// First transition authority: the job is VERIFYING, the caller holds the
// live unexpired lease (owner, fence, token verifier), and the caller and
// fence are exactly the ones that crossed the barrier. An expired VERIFYING
// lease is not worker authority (Phase 4 converges it). A recognised but
// mismatched outcome/reason pair is classified only after that authority.
//
// The first commit stores immutable result provenance, clears the live lease
// fields as migration 0010 requires, keeps the verifying provenance and the
// fencing counter, applies the aggregate only when the job still names the
// connection's current ACTIVE version and the connection is neither
// DISCONNECTED nor DISABLED, and inserts exactly one AuditEvent, all
// atomically. A job stale by version or connection lifecycle drift records
// its terminal history, never mutates the aggregate and is audited as
// verification_result_stale. Account or owner status does not make a result
// stale: it gates work before the barrier, not a result after it.
//
// Exact replay of a COMPLETED job: the lease-token verifier no longer exists,
// so the token is not authority. The authenticated worker and fence must be
// the verifying and result provenance, and the outcome and reason must equal
// the stored ones; then the stored result is returned with no write, no
// aggregate mutation and no AuditEvent. Anything else fails closed.

export const PROVIDER_VERIFICATION_OUTCOMES = Object.freeze(["VERIFIED", "DEFINITIVE_FAILURE", "INCONCLUSIVE"] as const);
export type ProviderVerificationOutcome = (typeof PROVIDER_VERIFICATION_OUTCOMES)[number];

// The closed worker-reportable vocabulary. The Phase 4 reconciliation reasons
// WORKER_LOST_AFTER_CREDENTIAL_GRANT and WORKER_LOST_DURING_VERIFYING are not
// worker-reportable and are deliberately absent.
const REASONS_BY_OUTCOME: Readonly<Record<ProviderVerificationOutcome, readonly string[]>> = Object.freeze({
  VERIFIED: Object.freeze(["VERIFICATION_SUCCEEDED"]),
  DEFINITIVE_FAILURE: Object.freeze(["CREDENTIAL_REJECTED", "CREDENTIAL_NOT_AUTHORIZED"]),
  INCONCLUSIVE: Object.freeze([
    "PROVIDER_BILLING_RESTRICTION",
    "PROVIDER_RATE_OR_QUOTA_LIMITED",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_TIMEOUT",
    "PROVIDER_NETWORK_FAILURE",
    "PROVIDER_RESPONSE_MALFORMED",
    "PROVIDER_RESPONSE_TOO_LARGE",
    "PROVIDER_UNEXPECTED_STATUS",
    "PROVIDER_OPERATION_DRIFT",
    "VERIFICATION_AMBIGUOUS",
  ]),
});

const OUTCOMES: ReadonlySet<string> = new Set(PROVIDER_VERIFICATION_OUTCOMES);
const REASONS: ReadonlySet<string> = new Set(Object.values(REASONS_BY_OUTCOME).flat());

export const isProviderVerificationOutcome = (value: unknown): value is ProviderVerificationOutcome => typeof value === "string" && OUTCOMES.has(value);
export const isWorkerReportableVerificationReason = (value: unknown): value is string => typeof value === "string" && REASONS.has(value);

export type ProviderVerificationResult = Readonly<{
  providerVerificationJobId: string;
  fencingCounter: number;
  state: "COMPLETED";
  outcome: ProviderVerificationOutcome;
  reasonCode: string;
  completedAt: Date;
  // false for an exact replay.
  firstTransition: boolean;
}>;

const INSERT_AUDIT = `
INSERT INTO audit_events (account_id, actor_type, event_type, resource_type, resource_id, correlation_id, metadata)
VALUES ($1, 'SYSTEM', $2, 'provider_connection', $3, $4, $5::jsonb)`;

function auditEventFor(outcome: ProviderVerificationOutcome, current: boolean): string {
  if (!current) return "provider_connection.verification_result_stale";
  if (outcome === "VERIFIED") return "provider_connection.verified";
  if (outcome === "DEFINITIVE_FAILURE") return "provider_connection.verification_failed";
  return "provider_connection.verification_inconclusive";
}

export async function reportProviderVerificationResult(
  pool: TransactionalPool,
  context: WorkerControlContext,
  jobId: string,
  proof: LeaseProof,
  outcome: ProviderVerificationOutcome,
  reasonCode: string,
): Promise<ProviderVerificationResult> {
  return withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);
    const job = await lockVerificationJob(client, jobId);

    if (job.state === "COMPLETED") {
      // Token-free exact replay: verifying principal and fence first, then
      // the stored terminal tuple. A result whose stored reason is not
      // worker-reportable (Phase 4 convergence) never replays here.
      if (job.verifyingWorkerPrincipalId !== context.workerPrincipalId) throw rejectVerification("VERIFYING_PRINCIPAL_MISMATCH");
      if (job.verifyingFencingCounter !== proof.fencingCounter) throw rejectVerification("FENCING_MISMATCH");
      if (
        job.resultWorkerPrincipalId !== context.workerPrincipalId ||
        job.resultFencingCounter !== proof.fencingCounter ||
        job.resultOutcome !== outcome ||
        job.terminalReasonCode !== reasonCode ||
        !isWorkerReportableVerificationReason(job.terminalReasonCode) ||
        job.completedAt === null
      ) {
        throw rejectVerification("VERIFICATION_RESULT_CONFLICT");
      }
      return Object.freeze({
        providerVerificationJobId: job.id,
        fencingCounter: job.resultFencingCounter,
        state: "COMPLETED" as const,
        outcome,
        reasonCode,
        completedAt: job.completedAt,
        firstTransition: false,
      });
    }

    if (job.state !== "VERIFYING") throw rejectVerification("NOT_VERIFYING");
    requireLiveVerificationLease(job, context, proof);
    if (job.verifyingWorkerPrincipalId !== context.workerPrincipalId || job.verifyingFencingCounter !== proof.fencingCounter) {
      throw rejectVerification("VERIFYING_PRINCIPAL_MISMATCH");
    }
    // Authority is proven; only now is the recognised pair classified.
    if (!REASONS_BY_OUTCOME[outcome].includes(reasonCode)) throw rejectVerification("REASON_CODE_OUTCOME_MISMATCH");

    const lifecycle = await lockVerificationLifecycle(client, job, "FOR UPDATE");
    const current = isCurrentForAggregate(lifecycle);

    const completed = await client.query<{ completed_at: Date }>(
      `UPDATE provider_verification_jobs
          SET state = 'COMPLETED', lease_worker_principal_id = NULL, lease_token_sha256 = NULL,
              leased_at = NULL, lease_expires_at = NULL, result_outcome = $3, terminal_reason_code = $4,
              result_worker_principal_id = $2, result_fencing_counter = verifying_fencing_counter,
              completed_at = now(), updated_at = now()
        WHERE id = $1 AND state = 'VERIFYING'
          AND verifying_worker_principal_id = $2 AND verifying_fencing_counter = $5
        RETURNING completed_at`,
      [job.id, context.workerPrincipalId, outcome, reasonCode, proof.fencingCounter],
    );
    const completedAt = completed.rows[0]?.completed_at;
    if (completedAt === undefined) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");

    if (current && outcome === "VERIFIED") {
      await requireOneConnectionRow(
        client.query<{ id: string }>(
          `UPDATE provider_connections
              SET status = 'ACTIVE', verification_status = 'VERIFIED', verified_at = $3, updated_at = now()
            WHERE account_id = $1 AND id = $2
            RETURNING id`,
          [job.accountId, job.providerConnectionId, completedAt],
        ),
      );
    } else if (current && outcome === "DEFINITIVE_FAILURE") {
      await requireOneConnectionRow(
        client.query<{ id: string }>(
          `UPDATE provider_connections
              SET status = 'INVALID', verification_status = 'FAILED', verified_at = NULL, updated_at = now()
            WHERE account_id = $1 AND id = $2
            RETURNING id`,
          [job.accountId, job.providerConnectionId],
        ),
      );
    }
    // INCONCLUSIVE never changes the aggregate: a previously verified
    // connection stays verified, and the barrier already stamped the attempt.

    // Safe identifiers, the credential version number, the fixed policy ID,
    // the outcome and the safe reason only.
    await client.query(INSERT_AUDIT, [
      job.accountId,
      auditEventFor(outcome, current),
      job.providerConnectionId,
      context.correlationId,
      JSON.stringify({
        provider: lifecycle.provider,
        credentialVersion: lifecycle.credentialVersion,
        verificationJobId: job.id,
        verificationPolicyId: job.verificationPolicyId,
        outcome,
        reasonCode,
      }),
    ]);

    return Object.freeze({
      providerVerificationJobId: job.id,
      fencingCounter: proof.fencingCounter,
      state: "COMPLETED" as const,
      outcome,
      reasonCode,
      completedAt,
      firstTransition: true,
    });
  });
}

async function requireOneConnectionRow(update: Promise<{ rows: { id: string }[] }>): Promise<void> {
  if ((await update).rows.length !== 1) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");
}
