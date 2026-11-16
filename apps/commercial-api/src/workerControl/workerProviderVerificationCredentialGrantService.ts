import type { TransactionalPool } from "../database/runtimePool.js";
import { PROVIDER_CREDENTIAL_PURPOSE, validateSealingContext, type CredentialSealingContext } from "commercial-worker-protocol";
import { parseSealedEnvelope, type SealedCredentialEnvelope } from "commercial-worker-protocol";
import { isStructurallyValidVerificationPolicyId } from "../providerConnections/providerCapabilityRegistry.js";
import { requireActiveWorker, withTransaction, WorkerLeaseError, type LeaseProof, type WorkerControlContext } from "./workerLeaseService.js";
import {
  lockVerificationJob,
  lockVerificationLifecycle,
  rejectVerification,
  requireEligibleForVerification,
  requireLiveVerificationLease,
} from "./workerProviderVerificationLeaseService.js";

// R44B11F Phase 3 exact credential grant to a leased verification worker.
//
// Returns the SEALED envelope of exactly the credential version the job
// immutably bound, with the provider-credential-context-v1 opening context
// for that exact version. Nothing here decrypts: the commercial API has no
// opener. It never looks up another, "current" or "latest" credential, and
// never returns more than this one envelope.
//
// One READ COMMITTED transaction. Lock order:
//
//   worker principal FOR SHARE -> verification job FOR UPDATE
//   -> Account FOR SHARE -> ProviderConnection FOR SHARE
//   -> exact credential version FOR SHARE
//
// Every grant, including an exact replay under the same live lease, re-checks
// under those locks that the Account and owner are ACTIVE, the connection is
// neither DISCONNECTED nor DISABLED, the bound version is still the
// connection's current ACTIVE version with sealed material, and the immutable
// policy ID is structurally valid. Only the first grant writes: it stamps
// credential_granted_at from the database clock. A replay returns the same
// envelope, context and original timestamp with no write.
//
// The verification credential-retention obligation that this grant opens is
// integrated into disconnect cleanup by Phase 4; Phase 3 does not change
// credential obligations.

export type ProviderVerificationCredentialGrant = Readonly<{
  providerVerificationJobId: string;
  fencingCounter: number;
  credentialGrantedAt: Date;
  sealedEnvelope: SealedCredentialEnvelope;
  openingContext: CredentialSealingContext;
  // false for an exact replay of an earlier grant under the same lease.
  firstGrant: boolean;
}>;

export async function grantProviderVerificationCredential(
  pool: TransactionalPool,
  context: WorkerControlContext,
  jobId: string,
  proof: LeaseProof,
): Promise<ProviderVerificationCredentialGrant> {
  return withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);
    const job = await lockVerificationJob(client, jobId);
    if (job.state !== "LEASED") throw rejectVerification("NOT_LEASED");
    requireLiveVerificationLease(job, context, proof);

    const lifecycle = await lockVerificationLifecycle(client, job, "FOR SHARE");
    requireEligibleForVerification(lifecycle);
    if (!isStructurallyValidVerificationPolicyId(job.verificationPolicyId)) throw rejectVerification("VERIFICATION_POLICY_INVALID");

    // The exact bound version only, already locked FOR SHARE above.
    const material = await client.query<{ sealed_credential: unknown }>(
      `SELECT sealed_credential FROM provider_credential_versions
        WHERE account_id = $1 AND provider_connection_id = $2 AND id = $3`,
      [job.accountId, job.providerConnectionId, job.providerCredentialVersionId],
    );
    const sealed = material.rows[0]?.sealed_credential;
    if (sealed === undefined || sealed === null) throw rejectVerification("CREDENTIAL_VERSION_INELIGIBLE");

    // Strict validation of what is returned; a failure never echoes the envelope.
    let sealedEnvelope: SealedCredentialEnvelope;
    let openingContext: CredentialSealingContext;
    try {
      sealedEnvelope = parseSealedEnvelope(sealed).envelope;
      openingContext = validateSealingContext({
        accountId: job.accountId,
        providerConnectionId: job.providerConnectionId,
        provider: lifecycle.provider,
        credentialVersion: lifecycle.credentialVersion,
        purpose: PROVIDER_CREDENTIAL_PURPOSE,
      });
    } catch {
      throw rejectVerification("CREDENTIAL_VERSION_INELIGIBLE");
    }

    const firstGrant = job.credentialGrantedAt === null;
    let credentialGrantedAt = job.credentialGrantedAt;
    if (firstGrant) {
      const granted = await client.query<{ credential_granted_at: Date }>(
        `UPDATE provider_verification_jobs SET credential_granted_at = now(), updated_at = now()
          WHERE id = $1 AND state = 'LEASED' AND credential_granted_at IS NULL
          RETURNING credential_granted_at`,
        [job.id],
      );
      credentialGrantedAt = granted.rows[0]?.credential_granted_at ?? null;
      if (credentialGrantedAt === null) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");
    }

    return Object.freeze({
      providerVerificationJobId: job.id,
      fencingCounter: job.leaseFencingCounter,
      credentialGrantedAt: credentialGrantedAt!,
      sealedEnvelope,
      openingContext,
      firstGrant,
    });
  });
}
