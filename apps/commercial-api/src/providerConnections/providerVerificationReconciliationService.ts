import type { RuntimeClient, TransactionalPool } from "../database/runtimePool.js";

export const DEFAULT_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE = 25;
export const MAX_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE = 100;

export type ProviderVerificationReconciliationContext = Readonly<{
  correlationId: string;
  batchSize?: number;
}>;

export type ProviderVerificationReconciliationPassResult = Readonly<{
  cancelledJobs: number;
  requeuedJobs: number;
  completedJobs: number;
}>;

export type ProviderVerificationReconciliationErrorCode =
  | "PROVIDER_VERIFICATION_RECONCILIATION_DATABASE_FAILURE"
  | "PROVIDER_VERIFICATION_RECONCILIATION_INVARIANT_VIOLATION";

export class ProviderVerificationReconciliationError extends Error {
  constructor(public readonly code: ProviderVerificationReconciliationErrorCode, options: ErrorOptions = {}) {
    super(code, options);
    this.name = "ProviderVerificationReconciliationError";
  }
}

const invariant = () =>
  new ProviderVerificationReconciliationError("PROVIDER_VERIFICATION_RECONCILIATION_INVARIANT_VIOLATION");

function batchSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE) {
    throw new RangeError(
      `provider verification reconciliation batch size must be between 1 and ${MAX_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE}`,
    );
  }
  return value;
}

async function withTransaction<T>(
  pool: TransactionalPool,
  work: (client: RuntimeClient) => Promise<T>,
): Promise<T> {
  let client: RuntimeClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new ProviderVerificationReconciliationError("PROVIDER_VERIFICATION_RECONCILIATION_DATABASE_FAILURE", { cause: error });
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

    if (error instanceof ProviderVerificationReconciliationError) {
      throw error;
    }

    throw new ProviderVerificationReconciliationError("PROVIDER_VERIFICATION_RECONCILIATION_DATABASE_FAILURE", { cause: error });
  } finally {
    client.release(destroyConnection);
  }
}

type VerificationJobCandidate = Readonly<{
  id: string;
  account_id: string;
  provider_connection_id: string;
  provider_credential_version_id: string;
  verification_policy_id: string;
  state: string;
  lease_worker_principal_id: string | null;
  lease_fencing_counter: string;
  lease_expired: boolean | null;
  credential_granted_at: Date | null;
  verifying_worker_principal_id: string | null;
  verifying_fencing_counter: string | null;
}>;

const SELECT_NEXT_ACTIONABLE = `
SELECT j.id,
       j.account_id,
       j.provider_connection_id,
       j.provider_credential_version_id,
       j.verification_policy_id,
       j.state,
       j.lease_worker_principal_id,
       j.lease_fencing_counter,
       j.lease_expires_at <= now() AS lease_expired,
       j.credential_granted_at,
       j.verifying_worker_principal_id,
       j.verifying_fencing_counter
  FROM provider_verification_jobs j
  JOIN accounts a
    ON a.id = j.account_id
  JOIN users u
    ON u.id = a.owner_user_id
  JOIN provider_connections c
    ON c.account_id = j.account_id
   AND c.id = j.provider_connection_id
  JOIN provider_credential_versions v
    ON v.account_id = j.account_id
   AND v.provider_connection_id = j.provider_connection_id
   AND v.id = j.provider_credential_version_id
 WHERE (
        j.state IN ('QUEUED', 'LEASED')
        AND (
          a.status <> 'ACTIVE'
          OR u.status <> 'ACTIVE'
          OR c.status IN ('DISCONNECTED', 'DISABLED')
          OR v.status <> 'ACTIVE'
          OR EXISTS (
            SELECT 1
              FROM provider_credential_versions newer
             WHERE newer.account_id = v.account_id
               AND newer.provider_connection_id = v.provider_connection_id
               AND newer.credential_version > v.credential_version
          )
        )
       )
    OR (
         j.state IN ('LEASED', 'VERIFYING')
         AND j.lease_expires_at <= now()
       )
 ORDER BY j.created_at, j.id
 LIMIT 1
 FOR UPDATE OF j SKIP LOCKED`;

async function selectNextActionableJob(client: RuntimeClient): Promise<VerificationJobCandidate | null> {
  const result = await client.query<VerificationJobCandidate>(SELECT_NEXT_ACTIONABLE);
  return result.rows[0] ?? null;
}


type VerificationLifecycle = Readonly<{
  accountEligible: boolean;
  connectionStatus: string;
  provider: string;
  credentialVersion: number;
  versionStatus: string;
  versionIsLatest: boolean;
}>;

const INELIGIBLE_CONNECTION_STATUSES: ReadonlySet<string> = new Set(["DISCONNECTED", "DISABLED"]);

async function lockVerificationLifecycle(
  client: RuntimeClient,
  job: VerificationJobCandidate,
): Promise<VerificationLifecycle> {
  const account = await client.query<{ account_status: string; user_status: string }>(
    `SELECT a.status AS account_status, u.status AS user_status
       FROM accounts a
       JOIN users u ON u.id = a.owner_user_id
      WHERE a.id = $1
        FOR SHARE OF a`,
    [job.account_id],
  );
  const accountRow = account.rows[0];

  const connection = await client.query<{ status: string; provider: string }>(
    `SELECT status, provider
       FROM provider_connections
      WHERE account_id = $1 AND id = $2
        FOR SHARE`,
    [job.account_id, job.provider_connection_id],
  );
  const connectionRow = connection.rows[0];

  const version = await client.query<{ credential_version: number; status: string; latest: boolean }>(
    `SELECT v.credential_version,
            v.status,
            NOT EXISTS (
              SELECT 1
                FROM provider_credential_versions newer
               WHERE newer.account_id = v.account_id
                 AND newer.provider_connection_id = v.provider_connection_id
                 AND newer.credential_version > v.credential_version
            ) AS latest
       FROM provider_credential_versions v
      WHERE v.account_id = $1
        AND v.provider_connection_id = $2
        AND v.id = $3
        FOR SHARE OF v`,
    [job.account_id, job.provider_connection_id, job.provider_credential_version_id],
  );
  const versionRow = version.rows[0];

  if (accountRow === undefined || connectionRow === undefined || versionRow === undefined) {
    throw invariant();
  }

  return Object.freeze({
    accountEligible: accountRow.account_status === "ACTIVE" && accountRow.user_status === "ACTIVE",
    connectionStatus: connectionRow.status,
    provider: connectionRow.provider,
    credentialVersion: versionRow.credential_version,
    versionStatus: versionRow.status,
    versionIsLatest: versionRow.latest,
  });
}

function isEligibleBeforeVerifying(lifecycle: VerificationLifecycle): boolean {
  return (
    lifecycle.accountEligible &&
    !INELIGIBLE_CONNECTION_STATUSES.has(lifecycle.connectionStatus) &&
    lifecycle.versionStatus === "ACTIVE" &&
    lifecycle.versionIsLatest
  );
}

function isCurrentForAggregate(lifecycle: VerificationLifecycle): boolean {
  return (
    !INELIGIBLE_CONNECTION_STATUSES.has(lifecycle.connectionStatus) &&
    lifecycle.versionStatus === "ACTIVE" &&
    lifecycle.versionIsLatest
  );
}

async function cancelPreBarrierJob(
  client: RuntimeClient,
  job: VerificationJobCandidate,
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `UPDATE provider_verification_jobs
        SET state = 'CANCELLED',
            lease_worker_principal_id = NULL,
            lease_token_sha256 = NULL,
            leased_at = NULL,
            lease_expires_at = NULL,
            terminal_reason_code = 'LIFECYCLE_NO_LONGER_ELIGIBLE',
            completed_at = now(),
            updated_at = now()
      WHERE id = $1
        AND state = $2
        AND state IN ('QUEUED', 'LEASED')
      RETURNING id`,
    [job.id, job.state],
  );
  if (result.rows.length !== 1) {
    throw invariant();
  }
}

async function requeueExpiredPreGrantLease(
  client: RuntimeClient,
  job: VerificationJobCandidate,
): Promise<void> {
  const result = await client.query<{ id: string }>(
    `UPDATE provider_verification_jobs
        SET state = 'QUEUED',
            lease_worker_principal_id = NULL,
            lease_token_sha256 = NULL,
            leased_at = NULL,
            lease_expires_at = NULL,
            updated_at = now()
      WHERE id = $1
        AND state = 'LEASED'
        AND credential_granted_at IS NULL
      RETURNING id`,
    [job.id],
  );
  if (result.rows.length !== 1) {
    throw invariant();
  }
}

async function completeWorkerLoss(
  client: RuntimeClient,
  job: VerificationJobCandidate,
  lifecycle: VerificationLifecycle,
  correlationId: string,
): Promise<void> {
  let reasonCode: "WORKER_LOST_AFTER_CREDENTIAL_GRANT" | "WORKER_LOST_DURING_VERIFYING";
  let resultWorkerPrincipalId: string;
  let resultFencingCounter: string;
  let eventType: "provider_connection.verification_inconclusive" | "provider_connection.verification_result_stale";

  if (job.state === "LEASED") {
    if (
      job.credential_granted_at === null ||
      job.lease_worker_principal_id === null
    ) {
      throw invariant();
    }
    reasonCode = "WORKER_LOST_AFTER_CREDENTIAL_GRANT";
    resultWorkerPrincipalId = job.lease_worker_principal_id;
    resultFencingCounter = job.lease_fencing_counter;
    eventType = "provider_connection.verification_inconclusive";
  } else if (job.state === "VERIFYING") {
    if (
      job.verifying_worker_principal_id === null ||
      job.verifying_fencing_counter === null
    ) {
      throw invariant();
    }
    reasonCode = "WORKER_LOST_DURING_VERIFYING";
    resultWorkerPrincipalId = job.verifying_worker_principal_id;
    resultFencingCounter = job.verifying_fencing_counter;
    eventType = isCurrentForAggregate(lifecycle)
      ? "provider_connection.verification_inconclusive"
      : "provider_connection.verification_result_stale";
  } else {
    throw invariant();
  }

  const completed = await client.query<{ id: string }>(
    `UPDATE provider_verification_jobs
        SET state = 'COMPLETED',
            lease_worker_principal_id = NULL,
            lease_token_sha256 = NULL,
            leased_at = NULL,
            lease_expires_at = NULL,
            result_outcome = 'INCONCLUSIVE',
            terminal_reason_code = $2,
            result_worker_principal_id = $3,
            result_fencing_counter = $4,
            completed_at = now(),
            updated_at = now()
      WHERE id = $1
        AND state = $5
      RETURNING id`,
    [job.id, reasonCode, resultWorkerPrincipalId, resultFencingCounter, job.state],
  );
  if (completed.rows.length !== 1) {
    throw invariant();
  }

  await client.query(
    `INSERT INTO audit_events
       (account_id, actor_type, event_type, resource_type, resource_id, correlation_id, metadata)
     VALUES ($1, 'SYSTEM', $2, 'provider_connection', $3, $4, $5::jsonb)`,
    [
      job.account_id,
      eventType,
      job.provider_connection_id,
      correlationId,
      JSON.stringify({
        provider: lifecycle.provider,
        credentialVersion: lifecycle.credentialVersion,
        verificationJobId: job.id,
        verificationPolicyId: job.verification_policy_id,
        outcome: "INCONCLUSIVE",
        reasonCode,
      }),
    ],
  );
}

async function readCurrentLeaseExpired(
  client: RuntimeClient,
  jobId: string,
): Promise<boolean> {
  const result = await client.query<{ expired: boolean | null }>(
    `SELECT lease_expires_at <= clock_timestamp() AS expired
       FROM provider_verification_jobs
      WHERE id = $1`,
    [jobId],
  );
  const expired = result.rows[0]?.expired;
  if (expired === null || expired === undefined) {
    throw invariant();
  }
  return expired;
}

type ReconciliationAction = "NONE" | "CANCELLED" | "REQUEUED" | "COMPLETED";

async function reconcileLockedJob(
  client: RuntimeClient,
  job: VerificationJobCandidate,
  correlationId: string,
): Promise<ReconciliationAction> {
  const lifecycle = await lockVerificationLifecycle(client, job);

  if (job.state === "QUEUED" || job.state === "LEASED") {
    if (!isEligibleBeforeVerifying(lifecycle)) {
      await cancelPreBarrierJob(client, job);
      return "CANCELLED";
    }
  }

  if (job.state === "QUEUED") {
    return "NONE";
  }

  if (job.state !== "LEASED" && job.state !== "VERIFYING") {
    throw invariant();
  }

  const expired = await readCurrentLeaseExpired(client, job.id);
  if (!expired) {
    return "NONE";
  }

  if (job.state === "LEASED" && job.credential_granted_at === null) {
    await requeueExpiredPreGrantLease(client, job);
    return "REQUEUED";
  }

  await completeWorkerLoss(client, job, lifecycle, correlationId);
  return "COMPLETED";
}

async function reconcileNextActionableJob(
  pool: TransactionalPool,
  correlationId: string,
): Promise<ReconciliationAction | null> {
  return withTransaction(pool, async (client) => {
    const job = await selectNextActionableJob(client);
    if (job === null) {
      return null;
    }
    return reconcileLockedJob(client, job, correlationId);
  });
}

export async function reconcileProviderVerificationJobs(
  pool: TransactionalPool,
  context: ProviderVerificationReconciliationContext,
): Promise<ProviderVerificationReconciliationPassResult> {
  const limit = batchSize(
    context.batchSize ?? DEFAULT_PROVIDER_VERIFICATION_RECONCILIATION_BATCH_SIZE,
  );

  let cancelledJobs = 0;
  let requeuedJobs = 0;
  let completedJobs = 0;

  for (let index = 0; index < limit; index += 1) {
    const action = await reconcileNextActionableJob(pool, context.correlationId);
    if (action === null) {
      break;
    }

    if (action === "CANCELLED") {
      cancelledJobs += 1;
    } else if (action === "REQUEUED") {
      requeuedJobs += 1;
    } else if (action === "COMPLETED") {
      completedJobs += 1;
    }
  }

  return Object.freeze({
    cancelledJobs,
    requeuedJobs,
    completedJobs,
  });
}
