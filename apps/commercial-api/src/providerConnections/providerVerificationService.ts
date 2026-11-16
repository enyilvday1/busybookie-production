import { randomUUID } from "node:crypto";

import type { RuntimeClient, TransactionalPool } from "../database/runtimePool.js";
import { resolveVerificationPolicyId, type ProviderCapabilityRegistry } from "./providerCapabilityRegistry.js";
import { ProviderConnectionError, type ProviderConnectionErrorCode } from "./providerConnectionError.js";

// R44B11F customer verification request (Phase 2): control-plane work only.
//
// POST /provider-connections/:id/verify creates, or returns, the one open
// provider_verification_jobs row for the connection's exact current ACTIVE
// credential version. This module performs no provider network operation,
// never reads or opens a sealed credential and never touches lease, barrier
// or result columns; the worker-control lifecycle owns those.
//
// One READ COMMITTED transaction, lock order (R44B11F customer lifecycle):
//
//   Account FOR NO KEY UPDATE (with the requesting User re-checked ACTIVE)
//   -> ProviderConnection FOR UPDATE
//   -> exact ACTIVE ProviderCredentialVersion FOR SHARE
//
// The open-job lookup is a non-locking read; this transaction never takes a
// verification-job row lock. The partial unique index
// provider_verification_jobs_one_open_per_version_uq is the final
// concurrency authority: the insert uses it as its ON CONFLICT arbiter, so a
// concurrent winner is resolved by reading and returning its job, with no
// second job and no second AuditEvent.

export type ProviderVerificationServiceDependencies = Readonly<{
  pool: TransactionalPool;
  registry: ProviderCapabilityRegistry;
}>;

export type VerificationPrincipal = Readonly<{ userId: string; accountId: string }>;

export type ProviderVerificationRequestOptions = Readonly<{ correlationId?: string }>;

export type OpenProviderVerificationState = "QUEUED" | "LEASED" | "VERIFYING";

// Customer-safe job identity and state. No credential-version row ID,
// policy, lease, worker, fencing or result provenance.
export type ProviderVerificationJobView = Readonly<{
  id: string;
  providerConnectionId: string;
  credentialVersion: number;
  state: OpenProviderVerificationState;
  createdAt: Date;
}>;

export type ProviderVerificationRequestResult = Readonly<{
  verificationJob: ProviderVerificationJobView;
  // false when an already-open job was returned.
  created: boolean;
}>;

export const VERIFIABLE_CONNECTION_STATUSES: ReadonlySet<string> = new Set(["PENDING_VERIFICATION", "ACTIVE", "INVALID"]);
const OPEN_STATES: ReadonlySet<string> = new Set(["QUEUED", "LEASED", "VERIFYING"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AUDIT_EVENT = "provider_connection.verification_requested";

function fail(code: ProviderConnectionErrorCode): ProviderConnectionError {
  return new ProviderConnectionError(code);
}

function databaseFailure(error: unknown): ProviderConnectionError {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
  return new ProviderConnectionError("PROVIDER_CONNECTION_DATABASE_FAILURE", { cause: error, ...(code === undefined ? {} : { databaseCode: code }) });
}

async function withTransaction<T>(pool: TransactionalPool, work: (client: RuntimeClient) => Promise<T>): Promise<T> {
  let client: RuntimeClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw databaseFailure(error);
  }
  let destroyConnection: Error | undefined;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      destroyConnection = rollbackError instanceof Error ? rollbackError : new Error("rollback failed");
    }
    if (error instanceof ProviderConnectionError) throw error;
    throw databaseFailure(error);
  } finally {
    client.release(destroyConnection);
  }
}

async function lockActiveAccount(client: RuntimeClient, principal: VerificationPrincipal): Promise<void> {
  const result = await client.query<{ account_status: string; user_status: string }>(
    `SELECT a.status AS account_status, u.status AS user_status
       FROM accounts a JOIN users u ON u.id = a.owner_user_id
      WHERE a.id = $1 AND u.id = $2 AND a.kind = 'PERSONAL'
        FOR NO KEY UPDATE OF a`,
    [principal.accountId, principal.userId],
  );
  const row = result.rows[0];
  if (row === undefined || row.account_status !== "ACTIVE" || row.user_status !== "ACTIVE") {
    throw fail("ACCOUNT_UNAVAILABLE");
  }
}

type JobRow = { id: string; state: string; created_at: Date };

const OPEN_JOB = `
SELECT id, state, created_at
  FROM provider_verification_jobs
 WHERE account_id = $1
   AND provider_connection_id = $2
   AND provider_credential_version_id = $3
   AND state IN ('QUEUED', 'LEASED', 'VERIFYING')`;

// Same predicate as provider_verification_jobs_one_open_per_version_uq, so
// PostgreSQL infers exactly that partial unique index as the arbiter.
const INSERT_JOB = `
INSERT INTO provider_verification_jobs
  (account_id, provider_connection_id, provider_credential_version_id, verification_policy_id, requested_by_user_id)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (provider_connection_id, provider_credential_version_id)
  WHERE state IN ('QUEUED', 'LEASED', 'VERIFYING')
  DO NOTHING
RETURNING id, state, created_at`;

const INSERT_AUDIT = `
INSERT INTO audit_events (account_id, actor_type, actor_user_id, event_type, resource_type, resource_id, correlation_id, metadata)
VALUES ($1, 'USER', $2, '${AUDIT_EVENT}', 'provider_connection', $3, $4, $5::jsonb)`;

async function findOpenJob(client: RuntimeClient, accountId: string, connectionId: string, versionId: string): Promise<JobRow | null> {
  const result = await client.query<JobRow>(OPEN_JOB, [accountId, connectionId, versionId]);
  if (result.rows.length > 1) throw fail("PROVIDER_CONNECTION_INVARIANT_VIOLATION");
  return result.rows[0] ?? null;
}

function toView(row: JobRow, connectionId: string, credentialVersion: number): ProviderVerificationJobView {
  if (!OPEN_STATES.has(row.state)) throw fail("PROVIDER_CONNECTION_INVARIANT_VIOLATION");
  return Object.freeze({
    id: row.id,
    providerConnectionId: connectionId,
    credentialVersion,
    state: row.state as OpenProviderVerificationState,
    createdAt: row.created_at,
  });
}

// Missing, foreign and malformed connection IDs are indistinguishable
// (PROVIDER_CONNECTION_NOT_FOUND). A connection outside PENDING_VERIFICATION,
// ACTIVE or INVALID is CONNECTION_STATE_CONFLICT. A provider whose capability
// does not explicitly enable verification with a structurally valid policy
// ID is PROVIDER_UNSUPPORTED. An eligible connection without exactly one
// ACTIVE credential version is an invariant violation; nothing is repaired.
export async function requestProviderVerification(
  dependencies: ProviderVerificationServiceDependencies,
  principal: VerificationPrincipal,
  connectionId: string,
  options: ProviderVerificationRequestOptions = {},
): Promise<ProviderVerificationRequestResult> {
  if (!UUID_PATTERN.test(connectionId)) throw fail("PROVIDER_CONNECTION_NOT_FOUND");
  const correlationId = options.correlationId ?? randomUUID();
  if (!UUID_PATTERN.test(correlationId)) throw fail("PROVIDER_CONNECTION_INPUT_INVALID");

  return withTransaction(dependencies.pool, async (client) => {
    await lockActiveAccount(client, principal);

    const connection = await client.query<{ provider: string; status: string }>(
      "SELECT provider, status FROM provider_connections WHERE account_id = $1 AND id = $2 FOR UPDATE",
      [principal.accountId, connectionId],
    );
    const connectionRow = connection.rows[0];
    if (connectionRow === undefined) throw fail("PROVIDER_CONNECTION_NOT_FOUND");
    if (!VERIFIABLE_CONNECTION_STATUSES.has(connectionRow.status)) throw fail("CONNECTION_STATE_CONFLICT");

    const verificationPolicyId = resolveVerificationPolicyId(dependencies.registry, connectionRow.provider);
    if (verificationPolicyId === null) throw fail("PROVIDER_UNSUPPORTED");

    const version = await client.query<{ id: string; credential_version: number }>(
      `SELECT id, credential_version
         FROM provider_credential_versions
        WHERE account_id = $1 AND provider_connection_id = $2 AND status = 'ACTIVE'
          FOR SHARE`,
      [principal.accountId, connectionId],
    );
    if (version.rows.length !== 1) throw fail("PROVIDER_CONNECTION_INVARIANT_VIOLATION");
    const versionRow = version.rows[0]!;

    const existing = await findOpenJob(client, principal.accountId, connectionId, versionRow.id);
    if (existing !== null) {
      return Object.freeze({ verificationJob: toView(existing, connectionId, versionRow.credential_version), created: false });
    }

    const inserted = await client.query<JobRow>(INSERT_JOB, [principal.accountId, connectionId, versionRow.id, verificationPolicyId, principal.userId]);
    const insertedRow = inserted.rows[0];

    if (insertedRow === undefined) {
      // A concurrent transaction committed the open job first. This new
      // statement sees it; if it has already left the open states, fail
      // closed rather than create unrequested work.
      const winner = await findOpenJob(client, principal.accountId, connectionId, versionRow.id);
      if (winner === null) throw fail("CONCURRENT_MODIFICATION");
      return Object.freeze({ verificationJob: toView(winner, connectionId, versionRow.credential_version), created: false });
    }

    // Metadata: safe IDs, the credential version number and the fixed policy
    // ID only. Never a credential, envelope, fingerprint or key reference.
    await client.query(INSERT_AUDIT, [
      principal.accountId,
      principal.userId,
      connectionId,
      correlationId,
      JSON.stringify({
        provider: connectionRow.provider,
        credentialVersion: versionRow.credential_version,
        verificationJobId: insertedRow.id,
        verificationPolicyId,
      }),
    ]);

    return Object.freeze({ verificationJob: toView(insertedRow, connectionId, versionRow.credential_version), created: true });
  });
}
