import type { TransactionalPool } from "../database/runtimePool.js";
import { isProviderExecutionId } from "commercial-worker-protocol";
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

// The live SUBMITTING -> SUBMITTED acknowledgement
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 18,
// "submitted route (live lease)"; R44B6O).
//
// The control plane records the provider execution ID that the worker
// obtained from a definitive provider acceptance. Nothing here calls a
// provider, and this route is not yet called by the worker: the durable
// acceptance journal that must precede it (section 17) does not exist yet.
//
// Authority is the same fenced proof as the SUBMITTING barrier (ACTIVE
// principal, this worker, exact fencing, matching token, unexpired lease),
// plus the exact live-route lease epoch (migrations 0005 and 0006): the
// current lease must still be the one that crossed LEASED -> SUBMITTING.
// A replacement or recovery lease never acknowledges a submission.
//
// One READ COMMITTED transaction, lock order as for the barrier:
//
//   1. worker principal          FOR SHARE
//   2. execution attempt         FOR UPDATE
//   3. provider connection       FOR SHARE
//   4. exact credential version  FOR SHARE
//
// Connection eligibility is not checked (submission was already
// authorised); a DESTROYED exact version fails closed as an invariant
// failure. The first transition writes only state, provider_execution_id,
// submitted_at (server time) and updated_at. The live lease, the barrier
// provenance and recovery_expires_at (NULL until a provider policy exists)
// are untouched; the job stays RUNNING.

// The migration 0004 provider-execution-ID check, exactly (1 to 256 visible
// ASCII characters, never a URL, no normalisation). It lives in the shared
// protocol package so the worker's journal applies the identical rule (R44B6P).
export { isProviderExecutionId };

// The Account + provider + provider execution ID unique index (migration 0004).
const PROVIDER_EXECUTION_UNIQUE = Object.freeze({ code: "23505", constraint: "execution_attempts_provider_execution_uq" });

const isProviderExecutionInUse = (error: unknown) =>
  error instanceof Error &&
  "code" in error &&
  error.code === PROVIDER_EXECUTION_UNIQUE.code &&
  "constraint" in error &&
  error.constraint === PROVIDER_EXECUTION_UNIQUE.constraint;

export type WorkerSubmittedAcknowledgement = Readonly<{
  executionAttemptId: string;
  fencingCounter: number;
  state: "SUBMITTED";
  providerExecutionId: string;
  submittedAt: Date;
  // false for a replay of an already-committed acknowledgement.
  firstTransition: boolean;
}>;

const reject = (reason: WorkerLeaseRejectionReason) => new WorkerLeaseError("LEASE_REJECTED", reason);

const REPLAYABLE_VERSION = (status: string) => status !== "DESTROYED";

export async function acknowledgeWorkerSubmitted(
  pool: TransactionalPool,
  context: WorkerControlContext,
  attemptId: string,
  proof: LeaseProof,
  providerExecutionId: string,
): Promise<WorkerSubmittedAcknowledgement> {
  return withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);
    let lease;
    try {
      lease = await lockCurrentLease(client, context, attemptId, proof, ["SUBMITTING", "SUBMITTED"]);
    } catch (error) {
      // Only SUBMITTING (or SUBMITTED for replay) is acceptable here: LEASED has
      // no provider-call authority, and OUTCOME_UNKNOWN belongs to acceptance-recovery.
      if (error instanceof WorkerLeaseError && error.reason === "NOT_LEASED") throw reject("INCOMPATIBLE_ATTEMPT_STATE");
      throw error;
    }

    // The exact live-route lease epoch (the row is already locked).
    const provenance = await client.query<{
      submitting_fencing_counter: string | null;
      submitting_worker_principal_id: string | null;
      provider_execution_id: string | null;
      submitted_at: Date | null;
    }>(
      `SELECT submitting_fencing_counter, submitting_worker_principal_id, provider_execution_id, submitted_at
         FROM execution_attempts WHERE id = $1`,
      [lease.id],
    );
    const epoch = provenance.rows[0];
    if (
      epoch === undefined ||
      epoch.submitting_fencing_counter === null ||
      Number(epoch.submitting_fencing_counter) !== lease.fencingCounter ||
      epoch.submitting_worker_principal_id !== context.workerPrincipalId
    ) {
      throw reject("SUBMITTED_LEASE_EPOCH_MISMATCH");
    }

    // The exact bound version must still hold its material for recovery.
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
      if (!REPLAYABLE_VERSION(versionRow.status)) throw reject("SUBMITTING_VERSION_DESTROYED");
      credentialVersion = versionRow.credential_version;
    }

    if (lease.state === "SUBMITTED") {
      // Replay: the same provider execution ID returns the committed result;
      // a different one is an invariant violation, never a rewrite.
      if (epoch.provider_execution_id !== providerExecutionId || epoch.submitted_at === null) throw reject("PROVIDER_EXECUTION_CONFLICT");
      return Object.freeze({
        executionAttemptId: lease.id,
        fencingCounter: lease.fencingCounter,
        state: "SUBMITTED",
        providerExecutionId: epoch.provider_execution_id,
        submittedAt: epoch.submitted_at,
        firstTransition: false,
      });
    }

    let submittedAt: Date | undefined;
    try {
      const transitioned = await client.query<{ submitted_at: Date }>(
        `UPDATE execution_attempts SET state = 'SUBMITTED', provider_execution_id = $2, submitted_at = now(), updated_at = now()
          WHERE id = $1 AND state = 'SUBMITTING'
          RETURNING submitted_at`,
        [lease.id, providerExecutionId],
      );
      submittedAt = transitioned.rows[0]?.submitted_at;
    } catch (error) {
      // Already adopted by another attempt of this Account and provider.
      if (isProviderExecutionInUse(error)) throw reject("PROVIDER_EXECUTION_ID_IN_USE");
      throw error;
    }
    if (submittedAt === undefined) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");
    await audit(client, "execution_attempt.submitted", { id: lease.id, accountId: lease.accountId }, context.correlationId, {
      attemptNumber: lease.attemptNumber,
      fencingCounter: lease.fencingCounter,
      workerPrincipalId: context.workerPrincipalId,
      provider: lease.provider,
      ...(credentialVersion === undefined ? {} : { credentialVersion }),
    });

    return Object.freeze({
      executionAttemptId: lease.id,
      fencingCounter: lease.fencingCounter,
      state: "SUBMITTED",
      providerExecutionId,
      submittedAt,
      firstTransition: true,
    });
  });
}
