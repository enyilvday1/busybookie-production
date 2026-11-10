import type { TransactionalPool } from "../database/runtimePool.js";
import { PROVIDER_CREDENTIAL_PURPOSE, validateSealingContext, type CredentialSealingContext } from "commercial-worker-protocol";
import { parseSealedEnvelope, type SealedCredentialEnvelope } from "commercial-worker-protocol";
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

// Exact credential grant to an already-leased worker
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md sections 19-23).
//
// The grant returns the SEALED envelope of exactly the credential version the
// generation authorization bound, together with the exact opening context
// (provider-credential-context-v1) the private worker's future
// CredentialOpener needs. Nothing here decrypts: the commercial API has no
// opener. It never looks up a "current" or "latest" credential.
//
// One READ COMMITTED transaction, lock order:
//
//   1. worker principal          FOR SHARE   (ACTIVE re-check)
//   2. execution attempt         FOR UPDATE  (current lease proof)
//   3. provider connection       FOR SHARE
//   4. exact credential version  FOR SHARE
//
// Disconnect locks the account, then the connection FOR UPDATE, then its
// versions FOR UPDATE, and never locks attempts or principals, so the shared
// connection -> version order cannot invert. FOR SHARE conflicts with
// disconnect's FOR UPDATE: either this grant commits first (disconnect then
// sees credential_granted_at and retains the version) or disconnect commits
// first (this transaction then re-reads the locked rows, finds the connection
// DISCONNECTED and the version DESTROYED or RETAINED_FOR_RECOVERY, and
// refuses).
//
// The attempt stays LEASED. The only column written is credential_granted_at,
// on the first successful grant; that opens the credential-retention
// obligation. Only a FIRST grant requires the connection and version to be
// eligible for new work. A retry under the same still-valid current lease
// after a committed grant is a replay, not a new grant: it returns the same
// envelope, context and original credentialGrantedAt with no write and no
// audit, even if a disconnect has since retained the version. That does not
// authorise provider execution: the future SUBMITTING transaction must
// re-check connection and version eligibility itself and refuse a
// disconnected connection.

export type WorkerCredentialGrant = Readonly<{
  executionAttemptId: string;
  fencingCounter: number;
  credentialGrantedAt: Date;
  sealedEnvelope: SealedCredentialEnvelope;
  openingContext: CredentialSealingContext;
  // false for an idempotent retry of an earlier grant under the same lease.
  firstGrant: boolean;
}>;

const ELIGIBLE_CONNECTION = (status: string) => status !== "DISCONNECTED" && status !== "DISABLED";
// RETAINED_FOR_RECOVERY serves only already-open obligations, never new work.
const ELIGIBLE_VERSION = (status: string) => status === "ACTIVE" || status === "SUPERSEDED";
// Replaying an already-committed grant: the version may since have been
// retained by a disconnect, because this grant's own obligation retains it.
const REPLAYABLE_VERSION = (status: string) => ELIGIBLE_VERSION(status) || status === "RETAINED_FOR_RECOVERY";

const reject = (reason: WorkerLeaseRejectionReason) => new WorkerLeaseError("LEASE_REJECTED", reason);

export async function grantWorkerCredential(
  pool: TransactionalPool,
  context: WorkerControlContext,
  attemptId: string,
  proof: LeaseProof,
): Promise<WorkerCredentialGrant> {
  return withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);
    const lease = await lockCurrentLease(client, context, attemptId, proof);
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

    const connection = await client.query<{ status: string; provider: string }>(
      "SELECT status, provider FROM provider_connections WHERE account_id = $1 AND id = $2 FOR SHARE",
      [lease.accountId, binding.authorization_connection_id],
    );
    const connectionRow = connection.rows[0];
    if (connectionRow === undefined || connectionRow.provider !== lease.provider) throw reject("AUTHORIZATION_INCONSISTENT");

    // Exactly the authorization's version, scoped to its account and connection.
    const version = await client.query<{ credential_version: number; status: string; sealed_credential: unknown }>(
      `SELECT credential_version, status, sealed_credential FROM provider_credential_versions
        WHERE account_id = $1 AND provider_connection_id = $2 AND id = $3
          FOR SHARE`,
      [lease.accountId, binding.authorization_connection_id, lease.providerCredentialVersionId],
    );
    const versionRow = version.rows[0];
    if (versionRow === undefined) throw reject("AUTHORIZATION_INCONSISTENT");

    const firstGrant = lease.credentialGrantedAt === null;
    if (firstGrant) {
      // A NEW pre-submission grant: the connection and exact version must
      // still be eligible for new work.
      if (!ELIGIBLE_CONNECTION(connectionRow.status)) throw reject("CONNECTION_INELIGIBLE");
      if (!ELIGIBLE_VERSION(versionRow.status) || versionRow.sealed_credential === null) throw reject("CREDENTIAL_VERSION_INELIGIBLE");
    } else if (!REPLAYABLE_VERSION(versionRow.status) || versionRow.sealed_credential === null) {
      // A replay of a grant this same current lease already committed. A later
      // disconnect does not make it unreplayable (the version is retained for
      // exactly this open obligation), but a DESTROYED version under an open
      // LEASED+grant obligation breaks the retention invariant: fail closed.
      throw reject("GRANTED_VERSION_DESTROYED");
    }

    // Strict validation of what is returned; failures never echo the envelope.
    let sealedEnvelope: SealedCredentialEnvelope;
    let openingContext: CredentialSealingContext;
    try {
      sealedEnvelope = parseSealedEnvelope(versionRow.sealed_credential).envelope;
      openingContext = validateSealingContext({
        accountId: lease.accountId,
        providerConnectionId: binding.authorization_connection_id,
        provider: lease.provider,
        credentialVersion: versionRow.credential_version,
        purpose: PROVIDER_CREDENTIAL_PURPOSE,
      });
    } catch {
      throw reject("AUTHORIZATION_INCONSISTENT");
    }

    let credentialGrantedAt = lease.credentialGrantedAt;
    if (firstGrant) {
      const granted = await client.query<{ credential_granted_at: Date }>(
        `UPDATE execution_attempts SET credential_granted_at = now(), updated_at = now()
          WHERE id = $1 AND state = 'LEASED' AND credential_granted_at IS NULL
          RETURNING credential_granted_at`,
        [lease.id],
      );
      credentialGrantedAt = granted.rows[0]?.credential_granted_at ?? null;
      if (credentialGrantedAt === null) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");
      await audit(client, "execution_attempt.credential_granted", { id: lease.id, accountId: lease.accountId }, context.correlationId, {
        attemptNumber: lease.attemptNumber,
        fencingCounter: lease.fencingCounter,
        workerPrincipalId: context.workerPrincipalId,
        provider: lease.provider,
        credentialVersion: versionRow.credential_version,
      });
    }

    return Object.freeze({
      executionAttemptId: lease.id,
      fencingCounter: lease.fencingCounter,
      credentialGrantedAt: credentialGrantedAt!,
      sealedEnvelope,
      openingContext,
      firstGrant,
    });
  });
}
