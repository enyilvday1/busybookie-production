import type { RuntimeClient } from "../database/runtimePool.js";

// Credential obligations derived from execution-attempt state
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 23;
// migration 0004). Nothing is stored: for one exact credential version V,
//
//   credential retention open := some attempt bound to V is
//       LEASED with credential_granted_at set, or
//       SUBMITTING, SUBMITTED or OUTCOME_UNKNOWN
//   provider recovery open    := some attempt bound to V is
//       SUBMITTING, SUBMITTED or OUTCOME_UNKNOWN
//
// Every other state closes both. State is authoritative: a recorded
// submitting_at on FAILED_BEFORE_SUBMISSION (a definitive provider rejection)
// does not keep an obligation open, and a passed recovery_expires_at never
// closes one; only an explicit terminal state such as ABANDONED does.
//
// Evaluation is always per exact credential version, never per connection or
// "current credential". Callers must hold the version rows' lifecycle lock
// (FOR UPDATE) before reading, and must read in a statement issued after the
// lock was acquired so READ COMMITTED sees every committed grant.

export type CredentialObligationState = Readonly<{
  hasOpenCredentialRetentionObligation: boolean;
  hasOpenProviderRecoveryObligation: boolean;
  blocksDestruction: boolean;
}>;

const RECOVERY_STATES = "('SUBMITTING', 'SUBMITTED', 'OUTCOME_UNKNOWN')";

const OBLIGATIONS = `
SELECT v.id,
       EXISTS (
         SELECT 1 FROM execution_attempts a
          WHERE a.account_id = v.account_id AND a.provider_credential_version_id = v.id
            AND ((a.state = 'LEASED' AND a.credential_granted_at IS NOT NULL) OR a.state IN ${RECOVERY_STATES})
       ) AS retention_open,
       EXISTS (
         SELECT 1 FROM execution_attempts a
          WHERE a.account_id = v.account_id AND a.provider_credential_version_id = v.id
            AND a.state IN ${RECOVERY_STATES}
       ) AS recovery_open
  FROM provider_credential_versions v
 WHERE v.account_id = $1 AND v.id = ANY($2::uuid[])`;

// Obligation state for each requested version of this account. A version with
// no attempts has no obligation.
export async function readCredentialObligations(
  client: RuntimeClient,
  accountId: string,
  credentialVersionIds: readonly string[],
): Promise<ReadonlyMap<string, CredentialObligationState>> {
  const states = new Map<string, CredentialObligationState>();
  if (credentialVersionIds.length === 0) return states;
  const result = await client.query<{ id: string; retention_open: boolean; recovery_open: boolean }>(OBLIGATIONS, [
    accountId,
    [...credentialVersionIds],
  ]);
  for (const row of result.rows) {
    states.set(
      row.id,
      Object.freeze({
        hasOpenCredentialRetentionObligation: row.retention_open,
        hasOpenProviderRecoveryObligation: row.recovery_open,
        blocksDestruction: row.retention_open || row.recovery_open,
      }),
    );
  }
  return states;
}
