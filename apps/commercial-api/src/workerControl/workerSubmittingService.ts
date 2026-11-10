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

// The fenced SUBMITTING acknowledgement barrier
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md sections 15 and 23).
//
// POINT OF NO RETURN. A successful first LEASED -> SUBMITTING commit is the
// control plane's authorisation for the worker to call the provider; a worker
// may call a provider only after it has received this acknowledgement for
// its current fenced attempt. Consequently:
//   - a disconnect that commits before this transition prevents submission
//     (the first transition refuses a DISCONNECTED/DISABLED connection or a
//     RETAINED_FOR_RECOVERY/DESTROYED version);
//   - a SUBMITTING commit that wins against a disconnect means submission was
//     already authorised; the disconnect then sees the open recovery
//     obligation and retains the exact version;
//   - a replay under the same still-valid lease proof only recovers the
//     acknowledgement of that already-committed authority (same submittingAt,
//     no write, no audit), even after a later disconnect.
// A credential grant alone is never provider-call authority.
//
// One READ COMMITTED transaction, lock order (as for the credential grant):
//
//   1. worker principal          FOR SHARE   (ACTIVE re-check)
//   2. execution attempt         FOR UPDATE  (current fenced lease proof)
//   3. provider connection       FOR SHARE
//   4. exact credential version  FOR SHARE
//
// Disconnect locks account -> connection FOR UPDATE -> versions FOR UPDATE and
// never locks attempts or principals, so the shared connection -> version
// order cannot invert and the two transactions conflict on those rows.
//
// The only columns written are state, submitting_at and updated_at. No
// credential material, fingerprint or provider execution field is read or
// written, recovery_expires_at stays NULL (no provider horizon is defined
// yet), and nothing calls a provider.

export type WorkerSubmittingAcknowledgement = Readonly<{
  executionAttemptId: string;
  fencingCounter: number;
  state: "SUBMITTING";
  submittingAt: Date;
  // false for a replay of an already-committed SUBMITTING acknowledgement.
  firstTransition: boolean;
}>;

const ELIGIBLE_CONNECTION = (status: string) => status !== "DISCONNECTED" && status !== "DISABLED";
// The exact bound version, even if superseded by a rotation; never a retained
// or destroyed one for a new submission.
const ELIGIBLE_VERSION = (status: string) => status === "ACTIVE" || status === "SUPERSEDED";
// A replay may find the version retained by a later disconnect: that is this
// submission's own open obligation. DESTROYED would break that invariant.
const REPLAYABLE_VERSION = (status: string) => ELIGIBLE_VERSION(status) || status === "RETAINED_FOR_RECOVERY";

const reject = (reason: WorkerLeaseRejectionReason) => new WorkerLeaseError("LEASE_REJECTED", reason);

// The final authority on lease validity is the migration 0005 guard, which
// judges expiry by wall-clock time; the check in lockCurrentLease uses
// transaction time and is only a fast refusal. A lease that expires between
// the two is refused by the guard with exactly this identity (SQLSTATE 23514
// and this constraint name), and is the same lifecycle refusal as
// LEASE_EXPIRED. Every other database error stays a database failure.
const SUBMITTING_LEASE_EXPIRED = Object.freeze({ code: "23514", constraint: "execution_attempts_submitting_lease_unexpired" });

const isSubmittingLeaseExpiry = (error: unknown) =>
  error instanceof Error &&
  "code" in error &&
  error.code === SUBMITTING_LEASE_EXPIRED.code &&
  "constraint" in error &&
  error.constraint === SUBMITTING_LEASE_EXPIRED.constraint;

export async function acknowledgeWorkerSubmitting(
  pool: TransactionalPool,
  context: WorkerControlContext,
  attemptId: string,
  proof: LeaseProof,
): Promise<WorkerSubmittingAcknowledgement> {
  return withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);
    // The same constant-time fenced proof as heartbeat, release and grant;
    // SUBMITTING is accepted only so an acknowledgement can be replayed.
    const lease = await lockCurrentLease(client, context, attemptId, proof, ["LEASED", "SUBMITTING"]);
    if (lease.credentialGrantedAt === null) throw reject("CREDENTIAL_NOT_GRANTED");
    if (lease.billingMode !== "USER_BYO" || lease.providerCredentialVersionId === null) throw reject("AUTHORIZATION_INCONSISTENT");

    // The immutable bindings must agree end to end; any disagreement fails closed.
    const bindings = await client.query<{
      authorization_status: string;
      authorization_provider: string;
      authorization_billing_mode: string;
      authorization_connection_id: string | null;
      authorization_version_id: string | null;
      authorization_production_id: string;
      job_authorization_id: string;
      job_production_id: string;
    }>(
      `SELECT g.status AS authorization_status, g.provider AS authorization_provider, g.billing_mode AS authorization_billing_mode,
              g.provider_connection_id AS authorization_connection_id, g.provider_credential_version_id AS authorization_version_id,
              g.production_id AS authorization_production_id,
              j.generation_authorization_id AS job_authorization_id, j.production_id AS job_production_id
         FROM generation_authorizations g
         JOIN execution_jobs j ON j.account_id = g.account_id AND j.id = $3
        WHERE g.account_id = $1 AND g.id = $2`,
      [lease.accountId, lease.generationAuthorizationId, lease.executionJobId],
    );
    const binding = bindings.rows[0];
    if (
      binding === undefined ||
      binding.authorization_status !== "CLAIMED" ||
      binding.authorization_provider !== lease.provider ||
      binding.authorization_billing_mode !== lease.billingMode ||
      binding.authorization_version_id !== lease.providerCredentialVersionId ||
      binding.authorization_connection_id === null ||
      binding.job_authorization_id !== lease.generationAuthorizationId ||
      binding.job_production_id !== binding.authorization_production_id
    ) {
      throw reject("AUTHORIZATION_INCONSISTENT");
    }

    // Identity and status only: never the sealed credential or fingerprint.
    const connection = await client.query<{ status: string; provider: string }>(
      "SELECT status, provider FROM provider_connections WHERE account_id = $1 AND id = $2 FOR SHARE",
      [lease.accountId, binding.authorization_connection_id],
    );
    const connectionRow = connection.rows[0];
    if (connectionRow === undefined || connectionRow.provider !== lease.provider) throw reject("AUTHORIZATION_INCONSISTENT");

    const version = await client.query<{ credential_version: number; status: string }>(
      `SELECT credential_version, status FROM provider_credential_versions
        WHERE account_id = $1 AND provider_connection_id = $2 AND id = $3
          FOR SHARE`,
      [lease.accountId, binding.authorization_connection_id, lease.providerCredentialVersionId],
    );
    const versionRow = version.rows[0];
    if (versionRow === undefined) throw reject("AUTHORIZATION_INCONSISTENT");

    if (lease.state === "SUBMITTING") {
      // Replay: the authority was already committed; recover its acknowledgement only.
      if (!REPLAYABLE_VERSION(versionRow.status)) throw reject("SUBMITTING_VERSION_DESTROYED");
      if (lease.submittingAt === null) throw reject("AUTHORIZATION_INCONSISTENT");
      return Object.freeze({
        executionAttemptId: lease.id,
        fencingCounter: lease.fencingCounter,
        state: "SUBMITTING",
        submittingAt: lease.submittingAt,
        firstTransition: false,
      });
    }

    // First transition: everything must still be eligible for a new submission.
    if (!ELIGIBLE_CONNECTION(connectionRow.status)) throw reject("CONNECTION_INELIGIBLE");
    if (!ELIGIBLE_VERSION(versionRow.status)) throw reject("CREDENTIAL_VERSION_INELIGIBLE");

    let submittingAt: Date | undefined;
    try {
      const transitioned = await client.query<{ submitting_at: Date }>(
        `UPDATE execution_attempts SET state = 'SUBMITTING', submitting_at = now(), updated_at = now()
          WHERE id = $1 AND state = 'LEASED' AND credential_granted_at IS NOT NULL
          RETURNING submitting_at`,
        [lease.id],
      );
      submittingAt = transitioned.rows[0]?.submitting_at;
    } catch (error) {
      if (isSubmittingLeaseExpiry(error)) throw reject("LEASE_EXPIRED");
      throw error;
    }
    if (submittingAt === undefined) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");
    await audit(client, "execution_attempt.submitting", { id: lease.id, accountId: lease.accountId }, context.correlationId, {
      attemptNumber: lease.attemptNumber,
      fencingCounter: lease.fencingCounter,
      workerPrincipalId: context.workerPrincipalId,
      provider: lease.provider,
      credentialVersion: versionRow.credential_version,
    });

    return Object.freeze({
      executionAttemptId: lease.id,
      fencingCounter: lease.fencingCounter,
      state: "SUBMITTING",
      submittingAt,
      firstTransition: true,
    });
  });
}
