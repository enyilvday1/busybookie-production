import { randomUUID } from "node:crypto";

import type { ActivePrincipal } from "../application/resolveActivePrincipal.js";
import type {
  RuntimeClient,
  TransactionalPool,
} from "../database/runtimePool.js";
import { resolveFreeByoPolicy } from "../entitlements/freeByoPolicy.js";
import {
  GenerationAuthorizationClaimError,
  type ClaimPrincipalUnavailableReason,
  type GenerationAuthorizationClaimErrorCode,
} from "./generationAuthorizationClaimError.js";

// USER_BYO GenerationAuthorization claim (R44B11D).
//
// Claim is the commercial commitment point. The caller supplies only the
// GenerationAuthorization ID; User and Account authority come exclusively
// from ActivePrincipal.
//
// New-claim lock order:
//
//   User -> Account -> ProviderConnection -> bound credential version
//        -> Production -> entitlement grant -> GenerationAuthorization
//
// In particular, the service never holds the GenerationAuthorization
// lifecycle lock while waiting for the ProviderConnection lifecycle lock.
//
// Claim creates no provider call, worker lease, credential grant or customer
// route. One successful transaction creates exactly one CLAIMED transition,
// one job, one initial QUEUED attempt, one canonical usage row and one audit
// event.

export type ClaimGenerationAuthorizationDependencies = Readonly<{
  pool: TransactionalPool;
}>;

export type ClaimGenerationAuthorizationOptions = Readonly<{
  correlationId?: string;
}>;

export type ClaimedExecutionJob = Readonly<{
  id: string;
  status: string;
}>;

export type ClaimedInitialExecutionAttempt = Readonly<{
  id: string;
  attemptNumber: number;
  state: string;
  leaseFencingCounter: number;
}>;

export type ClaimGenerationAuthorizationResult = Readonly<{
  generationAuthorizationId: string;
  claimedAt: Date;
  executionJob: ClaimedExecutionJob;
  initialExecutionAttempt: ClaimedInitialExecutionAttempt;
  // false only for an idempotent replay of an already-committed claim.
  created: boolean;
  correlationId: string;
}>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const BILLING_MODE = "USER_BYO";
const CLAIM_AUDIT_EVENT = "generation_authorization.claimed";

const fail = (code: GenerationAuthorizationClaimErrorCode) =>
  new GenerationAuthorizationClaimError(code);

const invalid = () => fail("GENERATION_AUTHORIZATION_CLAIM_INPUT_INVALID");

const principalUnavailable = (reason: ClaimPrincipalUnavailableReason) =>
  new GenerationAuthorizationClaimError("PRINCIPAL_UNAVAILABLE", { reason });

function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw invalid();
  return value;
}

function requireTrustedPrincipal(principal: ActivePrincipal): void {
  if (
    typeof principal?.userId !== "string" ||
    !UUID_PATTERN.test(principal.userId) ||
    typeof principal.accountId !== "string" ||
    !UUID_PATTERN.test(principal.accountId)
  ) {
    throw invalid();
  }
}

function databaseFailure(error: unknown): GenerationAuthorizationClaimError {
  const code =
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;

  return new GenerationAuthorizationClaimError(
    "GENERATION_AUTHORIZATION_CLAIM_DATABASE_FAILURE",
    {
      cause: error,
      ...(code === undefined ? {} : { databaseCode: code }),
    },
  );
}

async function withTransaction<T>(
  pool: TransactionalPool,
  work: (client: RuntimeClient) => Promise<T>,
): Promise<T> {
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
      destroyConnection =
        rollbackError instanceof Error
          ? rollbackError
          : new Error("rollback failed");
    }

    throw error instanceof GenerationAuthorizationClaimError
      ? error
      : databaseFailure(error);
  } finally {
    client.release(destroyConnection);
  }
}

async function lockActiveUser(
  client: RuntimeClient,
  principal: ActivePrincipal,
): Promise<void> {
  const result = await client.query<{ status: string }>(
    "SELECT status FROM users WHERE id = $1 FOR SHARE",
    [principal.userId],
  );

  const row = result.rows[0];

  if (row === undefined) throw principalUnavailable("USER_NOT_FOUND");
  if (row.status !== "ACTIVE") throw principalUnavailable("USER_DISABLED");
}

async function lockActiveAccount(
  client: RuntimeClient,
  principal: ActivePrincipal,
): Promise<void> {
  const result = await client.query<{
    kind: string;
    owner_user_id: string;
    status: string;
  }>(
    "SELECT kind, owner_user_id, status FROM accounts WHERE id = $1 FOR NO KEY UPDATE",
    [principal.accountId],
  );

  const row = result.rows[0];

  if (row === undefined || row.kind !== "PERSONAL") {
    throw principalUnavailable("ACCOUNT_NOT_FOUND");
  }

  if (row.owner_user_id !== principal.userId) {
    throw principalUnavailable("ACCOUNT_NOT_OWNED");
  }

  if (row.status !== "ACTIVE") {
    throw principalUnavailable("ACCOUNT_DISABLED");
  }
}

type AuthorizationRow = Readonly<{
  id: string;
  account_id: string;
  production_id: string;
  entitlement_grant_id: string;
  billing_mode: string;
  provider: string;
  provider_connection_id: string | null;
  provider_credential_version_id: string | null;
  status: string;
  expires_at: Date;
  claimed_at: Date | null;
}>;

const AUTHORIZATION_COLUMNS = `
  id,
  account_id,
  production_id,
  entitlement_grant_id,
  billing_mode,
  provider,
  provider_connection_id,
  provider_credential_version_id,
  status,
  expires_at,
  claimed_at`;

async function readAuthorization(
  client: RuntimeClient,
  principal: ActivePrincipal,
  authorizationId: string,
  lock = false,
): Promise<AuthorizationRow | null> {
  const result = await client.query<AuthorizationRow>(
    `SELECT ${AUTHORIZATION_COLUMNS}
       FROM generation_authorizations
      WHERE account_id = $1
        AND id = $2
      ${lock ? "FOR UPDATE" : ""}`,
    [principal.accountId, authorizationId],
  );

  return result.rows[0] ?? null;
}

function requireUserByoProvenance(row: AuthorizationRow): void {
  if (
    row.billing_mode !== BILLING_MODE ||
    row.provider_connection_id === null ||
    row.provider_credential_version_id === null
  ) {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }
}

function sameImmutableClaimProvenance(
  left: AuthorizationRow,
  right: AuthorizationRow,
): boolean {
  return (
    left.id === right.id &&
    left.account_id === right.account_id &&
    left.production_id === right.production_id &&
    left.entitlement_grant_id === right.entitlement_grant_id &&
    left.billing_mode === right.billing_mode &&
    left.provider === right.provider &&
    left.provider_connection_id === right.provider_connection_id &&
    left.provider_credential_version_id ===
      right.provider_credential_version_id &&
    left.expires_at.getTime() === right.expires_at.getTime()
  );
}

function requireNotTerminalBeforeClaim(row: AuthorizationRow): void {
  if (row.status === "CANCELLED" || row.status === "EXPIRED") {
    throw fail("GENERATION_AUTHORIZATION_NOT_CLAIMABLE");
  }

  if (row.status !== "ISSUED" && row.status !== "CLAIMED") {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }
}

function safeInteger(value: string | number): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }

  return parsed;
}

type JobRow = Readonly<{
  id: string;
  status: string;
}>;

type AttemptRow = Readonly<{
  id: string;
  attempt_number: number;
  state: string;
  lease_fencing_counter: string | number;
}>;

function claimResult(
  authorization: AuthorizationRow,
  job: JobRow,
  attempt: AttemptRow,
  created: boolean,
  correlationId: string,
): ClaimGenerationAuthorizationResult {
  if (authorization.claimed_at === null) {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }

  const attemptNumber = safeInteger(attempt.attempt_number);
  const leaseFencingCounter = safeInteger(attempt.lease_fencing_counter);

  if (attemptNumber !== 1) {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }

  return Object.freeze({
    generationAuthorizationId: authorization.id,
    claimedAt: authorization.claimed_at,
    executionJob: Object.freeze({
      id: job.id,
      status: job.status,
    }),
    initialExecutionAttempt: Object.freeze({
      id: attempt.id,
      attemptNumber,
      state: attempt.state,
      leaseFencingCounter,
    }),
    created,
    correlationId,
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function replayClaim(
  client: RuntimeClient,
  principal: ActivePrincipal,
  authorization: AuthorizationRow,
  correlationId: string,
): Promise<ClaimGenerationAuthorizationResult> {
  if (authorization.status !== "CLAIMED" || authorization.claimed_at === null) {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }

  const jobs = await client.query<JobRow>(
    `SELECT id, status
       FROM execution_jobs
      WHERE account_id = $1
        AND generation_authorization_id = $2`,
    [principal.accountId, authorization.id],
  );

  if (jobs.rows.length !== 1) {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }

  const job = jobs.rows[0]!;

  const attempts = await client.query<AttemptRow>(
    `SELECT id, attempt_number, state, lease_fencing_counter
       FROM execution_attempts
      WHERE account_id = $1
        AND execution_job_id = $2
        AND generation_authorization_id = $3
        AND attempt_number = 1`,
    [principal.accountId, job.id, authorization.id],
  );

  if (attempts.rows.length !== 1) {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }

  const attempt = attempts.rows[0]!;

  const usage = await client.query<{ generation_authorization_id: string }>(
    `SELECT generation_authorization_id
       FROM generation_usage_ledger
      WHERE generation_authorization_id = $1
        AND account_id = $2
        AND production_id = $3`,
    [
      authorization.id,
      principal.accountId,
      authorization.production_id,
    ],
  );

  if (usage.rows.length !== 1) {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }

  const audits = await client.query<{
    actor_type: string;
    actor_user_id: string | null;
    metadata: unknown;
  }>(
    `SELECT actor_type, actor_user_id, metadata
       FROM audit_events
      WHERE account_id = $1
        AND event_type = $2
        AND resource_type = 'generation_authorization'
        AND resource_id = $3
      ORDER BY sequence`,
    [principal.accountId, CLAIM_AUDIT_EVENT, authorization.id],
  );

  if (audits.rows.length !== 1) {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }

  const audit = audits.rows[0]!;

  if (
    audit.actor_type !== "USER" ||
    audit.actor_user_id !== principal.userId ||
    !isPlainObject(audit.metadata)
  ) {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }

  const metadataKeys = Object.keys(audit.metadata).sort();

  if (
    metadataKeys.length !== 3 ||
    metadataKeys[0] !== "entitlementPolicyVersion" ||
    metadataKeys[1] !== "executionJobId" ||
    metadataKeys[2] !== "initialExecutionAttemptId" ||
    audit.metadata.executionJobId !== job.id ||
    audit.metadata.initialExecutionAttemptId !== attempt.id ||
    typeof audit.metadata.entitlementPolicyVersion !== "string" ||
    audit.metadata.entitlementPolicyVersion.length === 0
  ) {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }

  return claimResult(
    authorization,
    job,
    attempt,
    false,
    correlationId,
  );
}

async function requireClaimableCredential(
  client: RuntimeClient,
  authorization: AuthorizationRow,
  connection: Readonly<{
    provider: string;
    status: string;
    verification_status: string;
  }>,
): Promise<void> {
  if (
    authorization.provider_connection_id === null ||
    authorization.provider_credential_version_id === null
  ) {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }

  if (connection.provider !== authorization.provider) {
    throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
  }

  if (
    connection.status === "INVALID" ||
    connection.status === "DISCONNECTED" ||
    connection.status === "DISABLED"
  ) {
    throw fail("PROVIDER_CONNECTION_UNAVAILABLE");
  }

  const versions = await client.query<{
    status: string;
    has_sealed_credential: boolean;
  }>(
    `SELECT status,
            (sealed_credential IS NOT NULL) AS has_sealed_credential
       FROM provider_credential_versions
      WHERE account_id = $1
        AND provider_connection_id = $2
        AND id = $3
      FOR SHARE`,
    [
      authorization.account_id,
      authorization.provider_connection_id,
      authorization.provider_credential_version_id,
    ],
  );

  const version = versions.rows[0];

  if (
    version === undefined ||
    !version.has_sealed_credential ||
    (version.status !== "ACTIVE" && version.status !== "SUPERSEDED")
  ) {
    throw fail("CREDENTIAL_UNAVAILABLE");
  }

  if (
    connection.status === "ACTIVE" &&
    connection.verification_status === "VERIFIED"
  ) {
    return;
  }

  if (
    connection.status === "PENDING_VERIFICATION" &&
    connection.verification_status === "UNVERIFIED" &&
    version.status === "SUPERSEDED"
  ) {
    const current = await client.query<{ id: string }>(
      `SELECT id
         FROM provider_credential_versions
        WHERE account_id = $1
          AND provider_connection_id = $2
          AND id <> $3
          AND status = 'ACTIVE'
        LIMIT 1`,
      [
        authorization.account_id,
        authorization.provider_connection_id,
        authorization.provider_credential_version_id,
      ],
    );

    if (current.rows.length === 1) return;
  }

  throw fail("PROVIDER_CONNECTION_UNAVAILABLE");
}

export async function claimGenerationAuthorization(
  dependencies: ClaimGenerationAuthorizationDependencies,
  principal: ActivePrincipal,
  rawGenerationAuthorizationId: unknown,
  options: ClaimGenerationAuthorizationOptions = {},
): Promise<ClaimGenerationAuthorizationResult> {
  requireTrustedPrincipal(principal);

  const authorizationId = requireUuid(rawGenerationAuthorizationId);

  const correlationId = options.correlationId ?? randomUUID();

  if (
    typeof correlationId !== "string" ||
    !UUID_PATTERN.test(correlationId)
  ) {
    throw invalid();
  }

  return withTransaction(dependencies.pool, async (client) => {
    // 1-2. Principal authority.
    await lockActiveUser(client, principal);
    await lockActiveAccount(client, principal);

    // Immutable-provenance pre-read. No authorization row lock is taken here:
    // doing so before the connection lifecycle lock would invert disconnect.
    let authorization = await readAuthorization(
      client,
      principal,
      authorizationId,
    );

    if (authorization === null) {
      throw fail("GENERATION_AUTHORIZATION_UNAVAILABLE");
    }

    requireUserByoProvenance(authorization);
    requireNotTerminalBeforeClaim(authorization);

    if (authorization.status === "CLAIMED") {
      return replayClaim(
        client,
        principal,
        authorization,
        correlationId,
      );
    }

    const connectionId = authorization.provider_connection_id;

    if (connectionId === null) {
      throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
    }

    // 3. ProviderConnection lifecycle authority. Rotation and disconnect use
    // this same FOR UPDATE direction.
    const connections = await client.query<{
      provider: string;
      status: string;
      verification_status: string;
    }>(
      `SELECT provider, status, verification_status
         FROM provider_connections
        WHERE account_id = $1
          AND id = $2
        FOR UPDATE`,
      [principal.accountId, connectionId],
    );

    const connection = connections.rows[0];

    if (connection === undefined) {
      throw fail("PROVIDER_CONNECTION_UNAVAILABLE");
    }

    // A claim may have committed while this transaction waited for the
    // connection lifecycle lock. Re-read before applying new-claim dynamic
    // eligibility; a committed claim is replayed instead.
    const afterConnection = await readAuthorization(
      client,
      principal,
      authorizationId,
    );

    if (afterConnection === null) {
      throw fail("GENERATION_AUTHORIZATION_UNAVAILABLE");
    }

    if (!sameImmutableClaimProvenance(authorization, afterConnection)) {
      throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
    }

    authorization = afterConnection;

    requireNotTerminalBeforeClaim(authorization);

    if (authorization.status === "CLAIMED") {
      return replayClaim(
        client,
        principal,
        authorization,
        correlationId,
      );
    }

    // 4. Exact immutable credential binding; never a replacement credential.
    await requireClaimableCredential(
      client,
      authorization,
      connection,
    );

    // 5. Exact Production.
    const productions = await client.query<{
      creation_entitlement_grant_id: string;
      archived_at: Date | null;
    }>(
      `SELECT creation_entitlement_grant_id, archived_at
         FROM productions
        WHERE account_id = $1
          AND id = $2
        FOR SHARE`,
      [principal.accountId, authorization.production_id],
    );

    const production = productions.rows[0];

    if (production === undefined || production.archived_at !== null) {
      throw fail("PRODUCTION_UNAVAILABLE");
    }

    if (
      production.creation_entitlement_grant_id !==
      authorization.entitlement_grant_id
    ) {
      throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
    }

    // 6. Exact creation grant.
    const grants = await client.query<{
      kind: string;
      state: string;
      policy_version: string;
    }>(
      `SELECT kind, state, policy_version
         FROM entitlement_grants
        WHERE account_id = $1
          AND id = $2
        FOR SHARE`,
      [principal.accountId, authorization.entitlement_grant_id],
    );

    const grant = grants.rows[0];

    if (
      grant === undefined ||
      grant.kind !== "FREE_BYO" ||
      grant.state !== "AVAILABLE"
    ) {
      throw fail("ENTITLEMENT_NOT_AVAILABLE");
    }

    const entitlementPolicy = resolveFreeByoPolicy(grant.policy_version);

    if (entitlementPolicy === null) {
      throw fail("ENTITLEMENT_POLICY_UNSUPPORTED");
    }

    // 7. Only now take the GenerationAuthorization lifecycle lock.
    const lockedAuthorization = await readAuthorization(
      client,
      principal,
      authorizationId,
      true,
    );

    if (lockedAuthorization === null) {
      throw fail("GENERATION_AUTHORIZATION_UNAVAILABLE");
    }

    if (
      !sameImmutableClaimProvenance(
        authorization,
        lockedAuthorization,
      )
    ) {
      throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
    }

    authorization = lockedAuthorization;

    requireNotTerminalBeforeClaim(authorization);

    if (authorization.status === "CLAIMED") {
      return replayClaim(
        client,
        principal,
        authorization,
        correlationId,
      );
    }

    // One database wall-clock value owns both the expiry comparison and
    // claimed_at. A zero-row result can only mean that the still-ISSUED,
    // locked authorization reached its claim deadline.
    const claimed = await client.query<{ claimed_at: Date }>(
      `WITH claim_clock AS MATERIALIZED (
         SELECT clock_timestamp() AS at
       )
       UPDATE generation_authorizations AS g
          SET status = 'CLAIMED',
              claimed_at = claim_clock.at,
              updated_at = claim_clock.at
         FROM claim_clock
        WHERE g.account_id = $1
          AND g.id = $2
          AND g.status = 'ISSUED'
          AND claim_clock.at < g.expires_at
       RETURNING g.claimed_at`,
      [principal.accountId, authorization.id],
    );

    const claimedRow = claimed.rows[0];

    if (claimedRow === undefined) {
      throw fail("GENERATION_AUTHORIZATION_CLAIM_EXPIRED");
    }

    authorization = Object.freeze({
      ...authorization,
      status: "CLAIMED",
      claimed_at: claimedRow.claimed_at,
    });

    // Exactly one job for this authorization.
    const jobs = await client.query<JobRow>(
      `INSERT INTO execution_jobs
         (account_id, production_id, generation_authorization_id)
       VALUES ($1, $2, $3)
       RETURNING id, status`,
      [
        principal.accountId,
        authorization.production_id,
        authorization.id,
      ],
    );

    const job = jobs.rows[0];

    if (job === undefined || job.status !== "QUEUED") {
      throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
    }

    if (authorization.provider_credential_version_id === null) {
      throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
    }

    // Initial attempt #1. State and fencing generation are protected by the
    // persistence guard; fencing generation remains the schema default zero.
    const attempts = await client.query<AttemptRow>(
      `INSERT INTO execution_attempts
         (account_id,
          execution_job_id,
          generation_authorization_id,
          attempt_number,
          state,
          billing_mode,
          provider,
          provider_credential_version_id)
       VALUES ($1, $2, $3, 1, 'QUEUED', 'USER_BYO', $4, $5)
       RETURNING id, attempt_number, state, lease_fencing_counter`,
      [
        principal.accountId,
        job.id,
        authorization.id,
        authorization.provider,
        authorization.provider_credential_version_id,
      ],
    );

    const attempt = attempts.rows[0];

    if (
      attempt === undefined ||
      safeInteger(attempt.attempt_number) !== 1 ||
      attempt.state !== "QUEUED" ||
      safeInteger(attempt.lease_fencing_counter) !== 0
    ) {
      throw fail("GENERATION_AUTHORIZATION_CLAIM_INVARIANT_VIOLATION");
    }

    // Canonical authorised-usage identity. recorded_at is deliberately omitted
    // so migration 0008 remains database authority.
    await client.query(
      `INSERT INTO generation_usage_ledger
         (generation_authorization_id, account_id, production_id)
       VALUES ($1, $2, $3)`,
      [
        authorization.id,
        principal.accountId,
        authorization.production_id,
      ],
    );

    // One safe claim audit. No request, prompt, reference, credential envelope,
    // fingerprint or key material enters metadata.
    await client.query(
      `INSERT INTO audit_events
         (account_id,
          actor_type,
          actor_user_id,
          event_type,
          resource_type,
          resource_id,
          correlation_id,
          metadata)
       VALUES
         ($1,
          'USER',
          $2,
          $3,
          'generation_authorization',
          $4,
          $5,
          $6::jsonb)`,
      [
        principal.accountId,
        principal.userId,
        CLAIM_AUDIT_EVENT,
        authorization.id,
        correlationId,
        JSON.stringify({
          executionJobId: job.id,
          initialExecutionAttemptId: attempt.id,
          entitlementPolicyVersion: entitlementPolicy.version,
        }),
      ],
    );

    return claimResult(
      authorization,
      job,
      attempt,
      true,
      correlationId,
    );
  });
}
