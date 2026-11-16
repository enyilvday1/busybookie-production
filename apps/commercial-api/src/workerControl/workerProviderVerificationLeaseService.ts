import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { RuntimeClient, TransactionalPool } from "../database/runtimePool.js";
import { WORKER_LEASE_TOKEN_BYTES } from "./workerLeasePolicy.js";
import { requireActiveWorker, withTransaction, WorkerLeaseError, type LeaseProof, type WorkerControlContext } from "./workerLeaseService.js";
import type { WorkerLeaseRejectionReason } from "./workerSecurityEvents.js";

// R44B11F Phase 3: provider-verification leasing and the shared lease and
// lifecycle primitives of the verification worker-control services
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md, R44B11F).
//
// Verification work is independent of generation execution. The authority is
// the provider_verification_jobs row; no execution job, attempt or
// generation authorization is read or written here.
//
// A lease is QUEUED -> LEASED for exactly 30 seconds of database time. The
// plaintext lease token is returned once to the issuing worker; only its
// SHA-256 verifier is stored. There is no heartbeat. Expired leases are not
// reclaimed here: expiry reconciliation belongs to Phase 4.
//
// Lock order for every verification lifecycle transaction:
//
//   worker principal FOR SHARE (ACTIVE re-check, the existing authority)
//   -> ProviderVerificationJob FOR UPDATE
//   -> Account
//   -> ProviderConnection
//   -> exact ProviderCredentialVersion
//
// Nothing here reads secret material or calls a provider.

export const PROVIDER_VERIFICATION_LEASE_SECONDS = 30;

// The JavaScript safe-integer ceiling also enforced by migration 0010.
const MAX_FENCING_COUNTER = "9007199254740991";

export type ProviderVerificationLease = Readonly<{
  providerVerificationJobId: string;
  provider: string;
  verificationPolicyId: string;
  // Plaintext, returned exactly once; only its SHA-256 verifier is stored.
  leaseToken: string;
  fencingCounter: number;
  leaseExpiresAt: Date;
}>;

export const rejectVerification = (reason: WorkerLeaseRejectionReason) => new WorkerLeaseError("LEASE_REJECTED", reason);

const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function tokenMatches(presented: string, storedVerifier: string | null): boolean {
  if (storedVerifier === null) return false;
  const expected = Buffer.from(storedVerifier, "hex");
  const actual = createHash("sha256").update(presented, "utf8").digest();
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export type LockedVerificationJob = Readonly<{
  id: string;
  accountId: string;
  providerConnectionId: string;
  providerCredentialVersionId: string;
  verificationPolicyId: string;
  state: string;
  leaseWorkerPrincipalId: string | null;
  leaseTokenSha256: string | null;
  leaseFencingCounter: number;
  leaseExpired: boolean | null;
  credentialGrantedAt: Date | null;
  verifyingAt: Date | null;
  verifyingWorkerPrincipalId: string | null;
  verifyingFencingCounter: number | null;
  resultOutcome: string | null;
  terminalReasonCode: string | null;
  resultWorkerPrincipalId: string | null;
  resultFencingCounter: number | null;
  completedAt: Date | null;
}>;

// The job row first, FOR UPDATE. Expiry is judged by the database clock.
export async function lockVerificationJob(client: RuntimeClient, jobId: string): Promise<LockedVerificationJob> {
  const result = await client.query<{
    id: string;
    account_id: string;
    provider_connection_id: string;
    provider_credential_version_id: string;
    verification_policy_id: string;
    state: string;
    lease_worker_principal_id: string | null;
    lease_token_sha256: string | null;
    lease_fencing_counter: string;
    expired: boolean | null;
    credential_granted_at: Date | null;
    verifying_at: Date | null;
    verifying_worker_principal_id: string | null;
    verifying_fencing_counter: string | null;
    result_outcome: string | null;
    terminal_reason_code: string | null;
    result_worker_principal_id: string | null;
    result_fencing_counter: string | null;
    completed_at: Date | null;
  }>(
    `SELECT id, account_id, provider_connection_id, provider_credential_version_id, verification_policy_id, state,
            lease_worker_principal_id, lease_token_sha256, lease_fencing_counter, lease_expires_at <= now() AS expired,
            credential_granted_at, verifying_at, verifying_worker_principal_id, verifying_fencing_counter,
            result_outcome, terminal_reason_code, result_worker_principal_id, result_fencing_counter, completed_at
       FROM provider_verification_jobs
      WHERE id = $1
        FOR UPDATE`,
    [jobId],
  );
  const row = result.rows[0];
  if (row === undefined) throw rejectVerification("UNKNOWN_VERIFICATION_JOB");
  return Object.freeze({
    id: row.id,
    accountId: row.account_id,
    providerConnectionId: row.provider_connection_id,
    providerCredentialVersionId: row.provider_credential_version_id,
    verificationPolicyId: row.verification_policy_id,
    state: row.state,
    leaseWorkerPrincipalId: row.lease_worker_principal_id,
    leaseTokenSha256: row.lease_token_sha256,
    leaseFencingCounter: Number(row.lease_fencing_counter),
    leaseExpired: row.expired,
    credentialGrantedAt: row.credential_granted_at,
    verifyingAt: row.verifying_at,
    verifyingWorkerPrincipalId: row.verifying_worker_principal_id,
    verifyingFencingCounter: row.verifying_fencing_counter === null ? null : Number(row.verifying_fencing_counter),
    resultOutcome: row.result_outcome,
    terminalReasonCode: row.terminal_reason_code,
    resultWorkerPrincipalId: row.result_worker_principal_id,
    resultFencingCounter: row.result_fencing_counter === null ? null : Number(row.result_fencing_counter),
    completedAt: row.completed_at,
  });
}

// The current live lease proof, in the existing generation-lease order:
// owner, fence, token verifier, then database-clock expiry.
export function requireLiveVerificationLease(job: LockedVerificationJob, context: WorkerControlContext, proof: LeaseProof): void {
  if (job.leaseWorkerPrincipalId !== context.workerPrincipalId) throw rejectVerification("OTHER_WORKER");
  if (job.leaseFencingCounter !== proof.fencingCounter) throw rejectVerification("FENCING_MISMATCH");
  if (!tokenMatches(proof.leaseToken, job.leaseTokenSha256)) throw rejectVerification("TOKEN_MISMATCH");
  if (job.leaseExpired !== false) throw rejectVerification("LEASE_EXPIRED");
}

export type VerificationLifecycle = Readonly<{
  accountEligible: boolean;
  connectionStatus: string;
  provider: string;
  credentialVersion: number;
  versionStatus: string;
  // The bound version is the connection's newest version.
  versionIsLatest: boolean;
}>;

const INELIGIBLE_CONNECTION_STATUSES: ReadonlySet<string> = new Set(["DISCONNECTED", "DISABLED"]);

// Locks Account -> ProviderConnection -> exact bound version, after the job.
// The connection lock is FOR UPDATE where the caller writes the aggregate.
export async function lockVerificationLifecycle(
  client: RuntimeClient,
  job: LockedVerificationJob,
  connectionLock: "FOR SHARE" | "FOR UPDATE",
): Promise<VerificationLifecycle> {
  const account = await client.query<{ account_status: string; user_status: string }>(
    `SELECT a.status AS account_status, u.status AS user_status
       FROM accounts a JOIN users u ON u.id = a.owner_user_id
      WHERE a.id = $1
        FOR SHARE OF a`,
    [job.accountId],
  );
  const accountRow = account.rows[0];

  const connection = await client.query<{ status: string; provider: string }>(
    `SELECT status, provider FROM provider_connections WHERE account_id = $1 AND id = $2 ${connectionLock}`,
    [job.accountId, job.providerConnectionId],
  );
  const connectionRow = connection.rows[0];

  const version = await client.query<{ credential_version: number; status: string; latest: boolean }>(
    `SELECT v.credential_version, v.status,
            NOT EXISTS (
              SELECT 1 FROM provider_credential_versions n
               WHERE n.account_id = v.account_id AND n.provider_connection_id = v.provider_connection_id
                 AND n.credential_version > v.credential_version
            ) AS latest
       FROM provider_credential_versions v
      WHERE v.account_id = $1 AND v.provider_connection_id = $2 AND v.id = $3
        FOR SHARE OF v`,
    [job.accountId, job.providerConnectionId, job.providerCredentialVersionId],
  );
  const versionRow = version.rows[0];

  // The composite foreign keys make these rows mandatory; absence is corruption.
  if (accountRow === undefined || connectionRow === undefined || versionRow === undefined) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");

  return Object.freeze({
    accountEligible: accountRow.account_status === "ACTIVE" && accountRow.user_status === "ACTIVE",
    connectionStatus: connectionRow.status,
    provider: connectionRow.provider,
    credentialVersion: versionRow.credential_version,
    versionStatus: versionRow.status,
    versionIsLatest: versionRow.latest,
  });
}

// New provider-call authority (grant and barrier) requires the exact bound
// version to still be the eligible connection's current ACTIVE version.
export function requireEligibleForVerification(lifecycle: VerificationLifecycle): void {
  if (!lifecycle.accountEligible) throw rejectVerification("ACCOUNT_INELIGIBLE");
  if (INELIGIBLE_CONNECTION_STATUSES.has(lifecycle.connectionStatus)) throw rejectVerification("CONNECTION_INELIGIBLE");
  if (lifecycle.versionStatus !== "ACTIVE" || !lifecycle.versionIsLatest) throw rejectVerification("CREDENTIAL_VERSION_INELIGIBLE");
}

// The published aggregate-application rule: a terminal result may mutate the
// ProviderConnection only while the job still names the connection's current
// ACTIVE version and the connection is neither DISCONNECTED nor DISABLED.
// Account and owner status are deliberately not part of it: they gate
// leasing, granting and the first barrier, not a result after the barrier.
export function isCurrentForAggregate(lifecycle: VerificationLifecycle): boolean {
  return (
    !INELIGIBLE_CONNECTION_STATUSES.has(lifecycle.connectionStatus) &&
    lifecycle.versionStatus === "ACTIVE" &&
    lifecycle.versionIsLatest
  );
}

// Eligible verification work only: an ACTIVE Account and owner, a connection
// that is neither DISCONNECTED nor DISABLED, and a bound version that is still
// ACTIVE. This is a filter; the grant and barrier re-check under locks.
// Oldest first (provider_verification_jobs_queue_ix order); bounded to one
// row; SKIP LOCKED so concurrent workers never wait on or share a job.
const SELECT_NEXT = `
SELECT j.id, c.provider, j.verification_policy_id
  FROM provider_verification_jobs j
  JOIN accounts a ON a.id = j.account_id
  JOIN users u ON u.id = a.owner_user_id
  JOIN provider_connections c ON c.account_id = j.account_id AND c.id = j.provider_connection_id
  JOIN provider_credential_versions v
    ON v.account_id = j.account_id AND v.provider_connection_id = j.provider_connection_id AND v.id = j.provider_credential_version_id
 WHERE j.state = 'QUEUED'
   AND j.lease_fencing_counter < ${MAX_FENCING_COUNTER}
   AND a.status = 'ACTIVE'
   AND u.status = 'ACTIVE'
   AND c.status NOT IN ('DISCONNECTED', 'DISABLED')
   AND v.status = 'ACTIVE'
 ORDER BY j.created_at, j.id
 LIMIT 1
   FOR UPDATE OF j SKIP LOCKED`;

// Leases the next eligible verification job to this worker, or null.
export async function acquireProviderVerificationLease(
  pool: TransactionalPool,
  context: WorkerControlContext,
): Promise<ProviderVerificationLease | null> {
  return withTransaction(pool, async (client) => {
    await requireActiveWorker(client, context.workerPrincipalId);

    const next = await client.query<{ id: string; provider: string; verification_policy_id: string }>(SELECT_NEXT);
    const candidate = next.rows[0];
    if (candidate === undefined) return null;

    const leaseToken = randomBytes(WORKER_LEASE_TOKEN_BYTES).toString("base64url");
    const leased = await client.query<{ lease_fencing_counter: string; lease_expires_at: Date }>(
      `UPDATE provider_verification_jobs
          SET state = 'LEASED', lease_worker_principal_id = $2, lease_token_sha256 = $3,
              lease_fencing_counter = lease_fencing_counter + 1, leased_at = now(),
              lease_expires_at = now() + make_interval(secs => $4), updated_at = now()
        WHERE id = $1 AND state = 'QUEUED'
        RETURNING lease_fencing_counter, lease_expires_at`,
      [candidate.id, context.workerPrincipalId, sha256Hex(leaseToken), PROVIDER_VERIFICATION_LEASE_SECONDS],
    );
    const row = leased.rows[0];
    if (row === undefined) throw new WorkerLeaseError("WORKER_CONTROL_DATABASE_FAILURE");

    return Object.freeze({
      providerVerificationJobId: candidate.id,
      provider: candidate.provider,
      verificationPolicyId: candidate.verification_policy_id,
      leaseToken,
      fencingCounter: Number(row.lease_fencing_counter),
      leaseExpiresAt: row.lease_expires_at,
    });
  });
}
