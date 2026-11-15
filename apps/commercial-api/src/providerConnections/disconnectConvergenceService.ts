import type { RuntimeClient, TransactionalPool } from "../database/runtimePool.js";
import { ProviderConnectionError } from "./providerConnectionError.js";
import {
  cleanupDisconnectedProviderConnectionCredentials,
} from "./providerConnectionService.js";

export const PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE = "PROVIDER_CONNECTION_DISCONNECTED";
export const DISCONNECT_CANCELLED_USAGE_EVENT = "CANCELLED_BEFORE_SUBMISSION";

export const DEFAULT_DISCONNECT_CONVERGENCE_CONNECTION_BATCH_SIZE = 25;
export const DEFAULT_DISCONNECT_CONVERGENCE_CHILD_BATCH_SIZE = 25;
export const MAX_DISCONNECT_CONVERGENCE_BATCH_SIZE = 100;

export type DisconnectConvergenceMode = "TARGETED" | "BACKGROUND";

export type DisconnectConvergenceContext = Readonly<{
  correlationId: string;
  mode: DisconnectConvergenceMode;
  childBatchSize?: number;
}>;

export type DisconnectConvergenceResult = Readonly<{
  cancelledAuthorizations: number;
  cancelledAttempts: number;
}>;

export type DisconnectCredentialCleanupResult = Readonly<{
  destroyedCredentialVersions: number;
}>;

export type DisconnectConvergencePassResult = Readonly<{
  cancelledAuthorizations: number;
  cancelledAttempts: number;
  destroyedCredentialVersions: number;
}>;

export type DisconnectConvergenceErrorCode =
  | "DISCONNECT_CONVERGENCE_DATABASE_FAILURE"
  | "DISCONNECT_CONVERGENCE_INVARIANT_VIOLATION";

export class DisconnectConvergenceError extends Error {
  constructor(
    public readonly code: DisconnectConvergenceErrorCode,
    options: ErrorOptions = {},
  ) {
    super(code, options);
    this.name = "DisconnectConvergenceError";
  }
}

const invariant = (): DisconnectConvergenceError =>
  new DisconnectConvergenceError("DISCONNECT_CONVERGENCE_INVARIANT_VIOLATION");

function batchSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_DISCONNECT_CONVERGENCE_BATCH_SIZE) {
    throw new RangeError(`disconnect convergence batch size must be between 1 and ${MAX_DISCONNECT_CONVERGENCE_BATCH_SIZE}`);
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
    throw new DisconnectConvergenceError("DISCONNECT_CONVERGENCE_DATABASE_FAILURE", { cause: error });
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

    if (error instanceof DisconnectConvergenceError) {
      throw error;
    }

    throw new DisconnectConvergenceError("DISCONNECT_CONVERGENCE_DATABASE_FAILURE", { cause: error });
  } finally {
    client.release(destroyConnection);
  }
}

async function assertDisconnectedConnection(
  pool: TransactionalPool,
  connectionId: string,
): Promise<void> {
  let result;
  try {
    result = await pool.query<{ status: string }>(
      "SELECT status FROM provider_connections WHERE id = $1",
      [connectionId],
    );
  } catch (error) {
    throw new DisconnectConvergenceError("DISCONNECT_CONVERGENCE_DATABASE_FAILURE", { cause: error });
  }

  if (result.rows[0]?.status !== "DISCONNECTED") {
    throw invariant();
  }
}

const authorizationLockClause = (mode: DisconnectConvergenceMode): string =>
  mode === "BACKGROUND" ? "FOR UPDATE OF g SKIP LOCKED" : "FOR UPDATE OF g";

const attemptLockClause = (mode: DisconnectConvergenceMode): string =>
  mode === "BACKGROUND" ? "FOR UPDATE OF a SKIP LOCKED" : "FOR UPDATE OF a";

async function cancelNextIssuedAuthorization(
  pool: TransactionalPool,
  connectionId: string,
  correlationId: string,
  mode: DisconnectConvergenceMode,
): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const selected = await client.query<{
      id: string;
      account_id: string;
      has_usage: boolean;
      has_execution: boolean;
      has_cancellation_audit: boolean;
    }>(
      `SELECT
         g.id,
         g.account_id,
         EXISTS (
           SELECT 1
             FROM generation_usage_ledger u
            WHERE u.generation_authorization_id = g.id
         ) AS has_usage,
         EXISTS (
           SELECT 1
             FROM execution_jobs j
            WHERE j.generation_authorization_id = g.id
         ) AS has_execution,
         EXISTS (
           SELECT 1
             FROM audit_events e
            WHERE e.resource_type = 'generation_authorization'
              AND e.resource_id = g.id
              AND e.event_type = 'generation_authorization.cancelled'
         ) AS has_cancellation_audit
       FROM generation_authorizations g
       JOIN provider_connections c
         ON c.id = g.provider_connection_id
        AND c.account_id = g.account_id
      WHERE g.provider_connection_id = $1
        AND g.billing_mode = 'USER_BYO'
        AND g.status = 'ISSUED'
        AND c.status = 'DISCONNECTED'
      ORDER BY g.created_at, g.id
      LIMIT 1
      ${authorizationLockClause(mode)}`,
      [connectionId],
    );

    const authorization = selected.rows[0];
    if (authorization === undefined) {
      return false;
    }

    if (authorization.has_usage || authorization.has_execution || authorization.has_cancellation_audit) {
      throw invariant();
    }

    const transitioned = await client.query(
      `UPDATE generation_authorizations
          SET status = 'CANCELLED',
              cancelled_at = now(),
              updated_at = now()
        WHERE id = $1
          AND status = 'ISSUED'
       RETURNING id`,
      [authorization.id],
    );

    if (transitioned.rows.length !== 1) {
      throw invariant();
    }

    await client.query(
      `INSERT INTO audit_events
         (account_id, actor_type, actor_user_id, event_type, resource_type,
          resource_id, correlation_id, metadata)
       VALUES
         ($1, 'SYSTEM', NULL, 'generation_authorization.cancelled',
          'generation_authorization', $2, $3, $4::jsonb)`,
      [
        authorization.account_id,
        authorization.id,
        correlationId,
        JSON.stringify({ reasonCode: PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE }),
      ],
    );

    return true;
  });
}

type AttemptCandidate = Readonly<{
  id: string;
  account_id: string;
  execution_job_id: string;
  generation_authorization_id: string;
  attempt_number: number;
  billing_mode: string;
  provider: string;
  provider_credential_version_id: string | null;
  state: string;
  lease_fencing_counter: string;
  authorization_account_id: string;
  authorization_production_id: string;
  authorization_status: string;
  authorization_billing_mode: string;
  authorization_provider: string;
  authorization_credential_version_id: string | null;
  connection_account_id: string;
}>;

async function cancelNextPreSubmissionAttempt(
  pool: TransactionalPool,
  connectionId: string,
  correlationId: string,
  mode: DisconnectConvergenceMode,
): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const selected = await client.query<AttemptCandidate>(
      `SELECT
         a.id,
         a.account_id,
         a.execution_job_id,
         a.generation_authorization_id,
         a.attempt_number,
         a.billing_mode,
         a.provider,
         a.provider_credential_version_id,
         a.state,
         a.lease_fencing_counter,
         g.account_id AS authorization_account_id,
         g.production_id AS authorization_production_id,
         g.status AS authorization_status,
         g.billing_mode AS authorization_billing_mode,
         g.provider AS authorization_provider,
         g.provider_credential_version_id AS authorization_credential_version_id,
         c.account_id AS connection_account_id
       FROM execution_attempts a
       JOIN generation_authorizations g
         ON g.id = a.generation_authorization_id
       JOIN provider_connections c
         ON c.id = g.provider_connection_id
      WHERE g.provider_connection_id = $1
        AND c.status = 'DISCONNECTED'
        AND a.state IN ('QUEUED', 'LEASED')
      ORDER BY a.created_at, a.id
      LIMIT 1
      ${attemptLockClause(mode)}`,
      [connectionId],
    );

    const attempt = selected.rows[0];
    if (attempt === undefined) {
      return false;
    }

    if (
      attempt.account_id !== attempt.authorization_account_id ||
      attempt.authorization_account_id !== attempt.connection_account_id ||
      attempt.billing_mode !== "USER_BYO" ||
      attempt.authorization_billing_mode !== "USER_BYO" ||
      attempt.authorization_status !== "CLAIMED" ||
      attempt.provider !== attempt.authorization_provider ||
      attempt.provider_credential_version_id !== attempt.authorization_credential_version_id
    ) {
      throw invariant();
    }

    const job = await client.query<{
      id: string;
      account_id: string;
      production_id: string;
      generation_authorization_id: string;
      status: string;
    }>(
      `SELECT id, account_id, production_id, generation_authorization_id, status
         FROM execution_jobs
        WHERE id = $1
        FOR UPDATE`,
      [attempt.execution_job_id],
    );

    const lockedJob = job.rows[0];
    if (
      lockedJob === undefined ||
      lockedJob.account_id !== attempt.account_id ||
      lockedJob.production_id !== attempt.authorization_production_id ||
      lockedJob.generation_authorization_id !== attempt.generation_authorization_id
    ) {
      throw invariant();
    }

    const expectedJobStatus = attempt.state === "QUEUED" ? "QUEUED" : "RUNNING";
    if (lockedJob.status !== expectedJobStatus) {
      throw invariant();
    }

    const usage = await client.query<{
      account_id: string;
      production_id: string;
    }>(
      `SELECT account_id, production_id
         FROM generation_usage_ledger
        WHERE generation_authorization_id = $1`,
      [attempt.generation_authorization_id],
    );

    const usageRow = usage.rows[0];
    if (
      usageRow === undefined ||
      usage.rows.length !== 1 ||
      usageRow.account_id !== attempt.account_id ||
      usageRow.production_id !== attempt.authorization_production_id
    ) {
      throw invariant();
    }

    const existingEvidence = await client.query<{
      has_usage_event: boolean;
      has_cancellation_audit: boolean;
    }>(
      `SELECT
         EXISTS (
           SELECT 1
             FROM generation_usage_events
            WHERE generation_authorization_id = $1
              AND event_type = 'CANCELLED_BEFORE_SUBMISSION'
         ) AS has_usage_event,
         EXISTS (
           SELECT 1
             FROM audit_events
            WHERE resource_type = 'execution_attempt'
              AND resource_id = $2
              AND event_type = 'execution_attempt.cancelled'
         ) AS has_cancellation_audit`,
      [attempt.generation_authorization_id, attempt.id],
    );

    const evidence = existingEvidence.rows[0];
    if (evidence === undefined || evidence.has_usage_event || evidence.has_cancellation_audit) {
      throw invariant();
    }

    const transitionedAttempt = await client.query(
      `UPDATE execution_attempts
          SET state = 'CANCELLED',
              failure_code = $2,
              completed_at = now(),
              updated_at = now(),
              lease_worker_principal_id = NULL,
              lease_token_sha256 = NULL,
              leased_at = NULL,
              lease_expires_at = NULL,
              heartbeat_at = NULL
        WHERE id = $1
          AND state = $3
       RETURNING id`,
      [attempt.id, PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE, attempt.state],
    );

    if (transitionedAttempt.rows.length !== 1) {
      throw invariant();
    }

    const transitionedJob = await client.query(
      `UPDATE execution_jobs
          SET status = 'CANCELLED',
              completed_at = now(),
              updated_at = now()
        WHERE id = $1
          AND status = $2
       RETURNING id`,
      [attempt.execution_job_id, expectedJobStatus],
    );

    if (transitionedJob.rows.length !== 1) {
      throw invariant();
    }

    await client.query(
      `INSERT INTO generation_usage_events
         (generation_authorization_id, event_type, reason_code)
       VALUES
         ($1, 'CANCELLED_BEFORE_SUBMISSION', $2)`,
      [attempt.generation_authorization_id, PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE],
    );

    await client.query(
      `INSERT INTO audit_events
         (account_id, actor_type, actor_user_id, event_type, resource_type,
          resource_id, correlation_id, metadata)
       VALUES
         ($1, 'SYSTEM', NULL, 'execution_attempt.cancelled',
          'execution_attempt', $2, $3, $4::jsonb)`,
      [
        attempt.account_id,
        attempt.id,
        correlationId,
        JSON.stringify({
          attemptNumber: attempt.attempt_number,
          fencingCounter: Number(attempt.lease_fencing_counter),
          failureCode: PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE,
        }),
      ],
    );

    return true;
  });
}

export async function discoverDisconnectedProviderConnections(
  pool: TransactionalPool,
  limit: number = DEFAULT_DISCONNECT_CONVERGENCE_CONNECTION_BATCH_SIZE,
): Promise<readonly string[]> {
  const boundedLimit = batchSize(limit);

  try {
    const result = await pool.query<{ id: string }>(
      `SELECT c.id
         FROM provider_connections c
        WHERE c.status = 'DISCONNECTED'
          AND (
            EXISTS (
              SELECT 1
                FROM generation_authorizations g
               WHERE g.provider_connection_id = c.id
                 AND g.billing_mode = 'USER_BYO'
                 AND g.status = 'ISSUED'
            )
            OR EXISTS (
              SELECT 1
                FROM execution_attempts a
                JOIN generation_authorizations g
                  ON g.id = a.generation_authorization_id
               WHERE g.provider_connection_id = c.id
                 AND a.state IN ('QUEUED', 'LEASED')
            )
            OR EXISTS (
              SELECT 1
                FROM provider_credential_versions v
               WHERE v.provider_connection_id = c.id
                 AND v.status = 'RETAINED_FOR_RECOVERY'
            )
          )
        ORDER BY c.disconnected_at, c.id
        LIMIT $1`,
      [boundedLimit],
    );

    return Object.freeze(result.rows.map((row) => row.id));
  } catch (error) {
    throw new DisconnectConvergenceError("DISCONNECT_CONVERGENCE_DATABASE_FAILURE", { cause: error });
  }
}

async function assertCommittedTerminalCancellationEvidence(
  pool: TransactionalPool,
  connectionId: string,
): Promise<void> {
  let result;

  try {
    result = await pool.query<{ malformed: boolean }>(
      `SELECT
         EXISTS (
           SELECT 1
             FROM generation_authorizations g
             JOIN provider_connections c
               ON c.id = g.provider_connection_id
            WHERE g.provider_connection_id = $1
              AND g.billing_mode = 'USER_BYO'
              AND g.status = 'CANCELLED'
              AND c.status = 'DISCONNECTED'
              AND (
                c.account_id <> g.account_id
                OR EXISTS (
                  SELECT 1
                    FROM generation_usage_ledger u
                   WHERE u.generation_authorization_id = g.id
                )
                OR EXISTS (
                  SELECT 1
                    FROM execution_jobs j
                   WHERE j.generation_authorization_id = g.id
                )
                OR (
                  SELECT count(*)
                    FROM audit_events e
                   WHERE e.resource_type = 'generation_authorization'
                     AND e.resource_id = g.id
                     AND e.event_type = 'generation_authorization.cancelled'
                ) <> 1
                OR NOT EXISTS (
                  SELECT 1
                    FROM audit_events e
                   WHERE e.account_id = g.account_id
                     AND e.actor_type = 'SYSTEM'
                     AND e.actor_user_id IS NULL
                     AND e.resource_type = 'generation_authorization'
                     AND e.resource_id = g.id
                     AND e.event_type = 'generation_authorization.cancelled'
                     AND e.metadata = jsonb_build_object(
                       'reasonCode',
                       $2::text
                     )
                )
              )
         )
         OR EXISTS (
           SELECT 1
             FROM execution_attempts a
             JOIN generation_authorizations g
               ON g.id = a.generation_authorization_id
             JOIN provider_connections c
               ON c.id = g.provider_connection_id
             JOIN execution_jobs j
               ON j.id = a.execution_job_id
            WHERE g.provider_connection_id = $1
              AND c.status = 'DISCONNECTED'
              AND a.state = 'CANCELLED'
              AND (
                a.failure_code = $2
                OR EXISTS (
                  SELECT 1
                    FROM generation_usage_events ue
                   WHERE ue.generation_authorization_id =
                         a.generation_authorization_id
                     AND ue.event_type =
                         'CANCELLED_BEFORE_SUBMISSION'
                )
                OR EXISTS (
                  SELECT 1
                    FROM audit_events ae
                   WHERE ae.resource_type = 'execution_attempt'
                     AND ae.resource_id = a.id
                     AND ae.event_type = 'execution_attempt.cancelled'
                )
              )
              AND (
                a.account_id <> g.account_id
                OR c.account_id <> g.account_id
                OR a.billing_mode <> 'USER_BYO'
                OR g.billing_mode <> 'USER_BYO'
                OR g.status <> 'CLAIMED'
                OR a.provider <> g.provider
                OR a.provider_credential_version_id
                   IS DISTINCT FROM
                   g.provider_credential_version_id
                OR j.account_id <> a.account_id
                OR j.production_id <> g.production_id
                OR j.generation_authorization_id <> g.id
                OR j.status <> 'CANCELLED'
                OR j.completed_at IS NULL
                OR a.failure_code IS DISTINCT FROM $2
                OR a.completed_at IS NULL
                OR a.submitting_at IS NOT NULL
                OR a.lease_worker_principal_id IS NOT NULL
                OR a.lease_token_sha256 IS NOT NULL
                OR a.leased_at IS NOT NULL
                OR a.lease_expires_at IS NOT NULL
                OR a.heartbeat_at IS NOT NULL
                OR (
                  SELECT count(*)
                    FROM generation_usage_ledger u
                   WHERE u.generation_authorization_id =
                         a.generation_authorization_id
                ) <> 1
                OR NOT EXISTS (
                  SELECT 1
                    FROM generation_usage_ledger u
                   WHERE u.generation_authorization_id =
                         a.generation_authorization_id
                     AND u.account_id = a.account_id
                     AND u.production_id = g.production_id
                )
                OR (
                  SELECT count(*)
                    FROM generation_usage_events ue
                   WHERE ue.generation_authorization_id =
                         a.generation_authorization_id
                     AND ue.event_type =
                         'CANCELLED_BEFORE_SUBMISSION'
                ) <> 1
                OR NOT EXISTS (
                  SELECT 1
                    FROM generation_usage_events ue
                   WHERE ue.generation_authorization_id =
                         a.generation_authorization_id
                     AND ue.event_type =
                         'CANCELLED_BEFORE_SUBMISSION'
                     AND ue.reason_code = $2
                )
                OR (
                  SELECT count(*)
                    FROM audit_events ae
                   WHERE ae.resource_type = 'execution_attempt'
                     AND ae.resource_id = a.id
                     AND ae.event_type = 'execution_attempt.cancelled'
                ) <> 1
                OR NOT EXISTS (
                  SELECT 1
                    FROM audit_events ae
                   WHERE ae.account_id = a.account_id
                     AND ae.actor_type = 'SYSTEM'
                     AND ae.actor_user_id IS NULL
                     AND ae.resource_type = 'execution_attempt'
                     AND ae.resource_id = a.id
                     AND ae.event_type = 'execution_attempt.cancelled'
                     AND ae.metadata = jsonb_build_object(
                       'attemptNumber',
                       a.attempt_number,
                       'fencingCounter',
                       a.lease_fencing_counter,
                       'failureCode',
                       $2::text
                     )
                )
              )
         ) AS malformed`,
      [
        connectionId,
        PROVIDER_CONNECTION_DISCONNECTED_FAILURE_CODE,
      ],
    );
  } catch (error) {
    throw new DisconnectConvergenceError(
      "DISCONNECT_CONVERGENCE_DATABASE_FAILURE",
      { cause: error },
    );
  }

  if (
    result.rows[0] === undefined ||
    result.rows[0].malformed
  ) {
    throw invariant();
  }
}
export async function convergeDisconnectedProviderConnectionPreSubmission(
  pool: TransactionalPool,
  connectionId: string,
  context: DisconnectConvergenceContext,
): Promise<DisconnectConvergenceResult> {
  const limit = batchSize(context.childBatchSize ?? DEFAULT_DISCONNECT_CONVERGENCE_CHILD_BATCH_SIZE);

  await assertDisconnectedConnection(pool, connectionId);

  let cancelledAuthorizations = 0;
  for (; cancelledAuthorizations < limit; cancelledAuthorizations += 1) {
    const changed = await cancelNextIssuedAuthorization(pool, connectionId, context.correlationId, context.mode);
    if (!changed) {
      break;
    }
  }

  let cancelledAttempts = 0;
  for (; cancelledAttempts < limit; cancelledAttempts += 1) {
    const changed = await cancelNextPreSubmissionAttempt(pool, connectionId, context.correlationId, context.mode);
    if (!changed) {
      break;
    }
  }

  await assertCommittedTerminalCancellationEvidence(
    pool,
    connectionId,
  );

  return Object.freeze({
    cancelledAuthorizations,
    cancelledAttempts,
  });
}

export async function convergeDisconnectedProviderConnectionCredentials(
  pool: TransactionalPool,
  connectionId: string,
  correlationId: string,
): Promise<DisconnectCredentialCleanupResult> {
  try {
    const result =
      await cleanupDisconnectedProviderConnectionCredentials(
        { pool },
        connectionId,
        { correlationId },
      );

    return Object.freeze({
      destroyedCredentialVersions:
        result.destroyedCredentialVersions.length,
    });
  } catch (error) {
    if (error instanceof ProviderConnectionError) {
      if (
        error.code ===
        "PROVIDER_CONNECTION_DATABASE_FAILURE"
      ) {
        throw new DisconnectConvergenceError(
          "DISCONNECT_CONVERGENCE_DATABASE_FAILURE",
          { cause: error },
        );
      }

      throw invariant();
    }

    throw new DisconnectConvergenceError(
      "DISCONNECT_CONVERGENCE_DATABASE_FAILURE",
      { cause: error },
    );
  }
}

// One bounded convergence pass for one already-disconnected connection.
// Phase A/B transaction domains complete before Phase C enters the
// credential lifecycle lock domain.
export async function convergeDisconnectedProviderConnection(
  pool: TransactionalPool,
  connectionId: string,
  context: DisconnectConvergenceContext,
): Promise<DisconnectConvergencePassResult> {
  const preSubmission =
    await convergeDisconnectedProviderConnectionPreSubmission(
      pool,
      connectionId,
      context,
    );

  const credentials =
    await convergeDisconnectedProviderConnectionCredentials(
      pool,
      connectionId,
      context.correlationId,
    );

  return Object.freeze({
    cancelledAuthorizations:
      preSubmission.cancelledAuthorizations,
    cancelledAttempts:
      preSubmission.cancelledAttempts,
    destroyedCredentialVersions:
      credentials.destroyedCredentialVersions,
  });
}
