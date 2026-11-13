import { randomUUID } from "node:crypto";

import { GenerationContractError, generationRequestSha256 } from "commercial-worker-protocol";

import type { ActivePrincipal } from "../application/resolveActivePrincipal.js";
import type { RuntimeClient, TransactionalPool } from "../database/runtimePool.js";
import { resolveFreeByoPolicy } from "../entitlements/freeByoPolicy.js";
import { capabilityFor, generationLimits, type GenerationAuthorityPolicyRegistry, type ValidatedGenerationRequest } from "./generationAuthorityPolicy.js";
import { GenerationAuthorizationError, type GenerationAuthorizationErrorCode, type PrincipalUnavailableReason } from "./generationAuthorizationError.js";

// USER_BYO GenerationAuthorization issuance (R44B11C;
// docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md, "USER_BYO
// generation-authorization issuance").
//
// Authority: the User and Account come only from the trusted active
// principal. The untrusted intent names exactly a Production, a
// ProviderConnection, a model, a generation request and a mandatory
// idempotency key. Provider derives from the connection, billing mode is
// always USER_BYO, and the entitlement grant, credential version, policy
// version, expected-cost cap and expiry are all server-authoritative.
//
// One READ COMMITTED transaction on one dedicated client, with the locked
// order User (FOR SHARE) -> Account (FOR NO KEY UPDATE, the account
// lifecycle lock) -> ProviderConnection (FOR UPDATE, the connection lifecycle
// lock) -> Production (FOR SHARE) -> entitlement grant (FOR SHARE). Every
// lock conflicts with the corresponding lifecycle UPDATE and is held through
// commit, so no eligibility row can become ineligible between its check and
// the commit. Application-local locks are never authority.
//
// Issuance writes only the authorization and its audit event: no usage-ledger
// row, job, attempt, lease, credential grant or provider work. It never opens
// a credential, inspects referenceImage or changes the entitlement grant.

export type IssueGenerationAuthorizationInput = Readonly<{
  productionId: string;
  providerConnectionId: string;
  model: string;
  generationRequest: unknown;
  idempotencyKey: string;
}>;

export type GenerationAuthorizationServiceDependencies = Readonly<{
  pool: TransactionalPool;
  policy: GenerationAuthorityPolicyRegistry;
}>;

export type IssueGenerationAuthorizationOptions = Readonly<{
  // Links the audit event to an upstream request; generated when absent.
  correlationId?: string;
}>;

export type GenerationAuthorizationView = Readonly<{
  id: string;
  accountId: string;
  productionId: string;
  entitlementGrantId: string;
  billingMode: string;
  provider: string;
  model: string;
  providerConnectionId: string;
  providerCredentialVersionId: string;
  generationRequest: unknown;
  generationRequestSha256: string;
  expectedCostCapUnit: string;
  expectedCostCapAmount: number;
  status: string;
  expiresAt: Date;
  claimedAt: Date | null;
  expiredAt: Date | null;
  cancelledAt: Date | null;
  createdByUserId: string;
  creationIdempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type IssueGenerationAuthorizationResult = Readonly<{
  authorization: GenerationAuthorizationView;
  // false when a true idempotent replay returned the original authorization.
  created: boolean;
  correlationId: string;
}>;

const INPUT_KEYS = Object.freeze(["generationRequest", "idempotencyKey", "model", "productionId", "providerConnectionId"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// generation_authorizations_model_ck.
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const BILLING_MODE = "USER_BYO";
const AUDIT_EVENT = "generation_authorization.issued";

const fail = (code: GenerationAuthorizationErrorCode) => new GenerationAuthorizationError(code);
const invalid = () => fail("GENERATION_AUTHORIZATION_INPUT_INVALID");
const principalUnavailable = (reason: PrincipalUnavailableReason) => new GenerationAuthorizationError("PRINCIPAL_UNAVAILABLE", { reason });

// Exactly the five intent members, as own data properties; anything else,
// including every server-authoritative field, is refused before SQL. The
// idempotency key is never trimmed or rewritten; its length is counted in code
// points, as char_length counts it.
export function validateIssueGenerationAuthorizationInput(input: unknown): IssueGenerationAuthorizationInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== INPUT_KEYS.length || keys.some((key) => typeof key !== "string" || !INPUT_KEYS.includes(key))) throw invalid();
  const candidate: Record<string, unknown> = {};
  for (const key of INPUT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !("value" in descriptor)) throw invalid();
    candidate[key] = descriptor.value;
  }

  const { productionId, providerConnectionId, model, generationRequest, idempotencyKey } = candidate;
  if (typeof productionId !== "string" || !UUID_PATTERN.test(productionId)) throw invalid();
  if (typeof providerConnectionId !== "string" || !UUID_PATTERN.test(providerConnectionId)) throw invalid();
  if (typeof model !== "string" || !MODEL_PATTERN.test(model)) throw invalid();
  if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0 || [...idempotencyKey].length > MAX_IDEMPOTENCY_KEY_LENGTH) throw invalid();
  return Object.freeze({ productionId, providerConnectionId, model, generationRequest, idempotencyKey });
}

function requireTrustedPrincipal(principal: ActivePrincipal): void {
  if (typeof principal?.userId !== "string" || !UUID_PATTERN.test(principal.userId)) throw invalid();
  if (typeof principal.accountId !== "string" || !UUID_PATTERN.test(principal.accountId)) throw invalid();
}

// The canonical generation-request identity through the shared R44B11A hash
// authority. The shared parsers return their members unchanged, so this equals
// the hash of the validated request for any request the contract admits.
function canonicalRequestSha256(request: unknown): string {
  try {
    return generationRequestSha256(request);
  } catch (error) {
    if (error instanceof GenerationContractError) throw fail("GENERATION_REQUEST_INVALID");
    throw error;
  }
}

function validatedRequest(parse: (value: unknown) => ValidatedGenerationRequest, request: unknown): ValidatedGenerationRequest {
  try {
    return parse(request);
  } catch (error) {
    if (error instanceof GenerationContractError) throw fail("GENERATION_REQUEST_INVALID");
    throw error;
  }
}

type AuthorizationRow = {
  id: string;
  account_id: string;
  production_id: string;
  entitlement_grant_id: string;
  billing_mode: string;
  provider: string;
  model: string;
  provider_connection_id: string | null;
  provider_credential_version_id: string | null;
  generation_request: unknown;
  generation_request_sha256: string;
  expected_cost_cap_unit: string;
  expected_cost_cap_amount: string;
  status: string;
  expires_at: Date;
  claimed_at: Date | null;
  expired_at: Date | null;
  cancelled_at: Date | null;
  created_by_user_id: string;
  creation_idempotency_key: string | null;
  created_at: Date;
  updated_at: Date;
};

const AUTHORIZATION_COLUMNS = `id, account_id, production_id, entitlement_grant_id, billing_mode, provider, model,
  provider_connection_id, provider_credential_version_id, generation_request, generation_request_sha256,
  expected_cost_cap_unit, expected_cost_cap_amount, status, expires_at, claimed_at, expired_at, cancelled_at,
  created_by_user_id, creation_idempotency_key, created_at, updated_at`;

function toView(row: AuthorizationRow): GenerationAuthorizationView {
  const amount = Number(row.expected_cost_cap_amount);
  if (
    row.billing_mode !== BILLING_MODE ||
    row.provider_connection_id === null ||
    row.provider_credential_version_id === null ||
    row.creation_idempotency_key === null ||
    !Number.isSafeInteger(amount) ||
    String(amount) !== String(row.expected_cost_cap_amount)
  ) {
    throw fail("GENERATION_AUTHORIZATION_INVARIANT_VIOLATION");
  }
  return Object.freeze({
    id: row.id,
    accountId: row.account_id,
    productionId: row.production_id,
    entitlementGrantId: row.entitlement_grant_id,
    billingMode: row.billing_mode,
    provider: row.provider,
    model: row.model,
    providerConnectionId: row.provider_connection_id,
    providerCredentialVersionId: row.provider_credential_version_id,
    generationRequest: row.generation_request,
    generationRequestSha256: row.generation_request_sha256,
    expectedCostCapUnit: row.expected_cost_cap_unit,
    expectedCostCapAmount: amount,
    status: row.status,
    expiresAt: row.expires_at,
    claimedAt: row.claimed_at,
    expiredAt: row.expired_at,
    cancelledAt: row.cancelled_at,
    createdByUserId: row.created_by_user_id,
    creationIdempotencyKey: row.creation_idempotency_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function databaseFailure(error: unknown): GenerationAuthorizationError {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
  return new GenerationAuthorizationError("GENERATION_AUTHORIZATION_DATABASE_FAILURE", {
    cause: error,
    ...(code === undefined ? {} : { databaseCode: code }),
  });
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
      // The session state is unknown; destroy it instead of returning it to
      // the pool. The primary error below is preserved.
      destroyConnection = rollbackError instanceof Error ? rollbackError : new Error("rollback failed");
    }
    throw error instanceof GenerationAuthorizationError ? error : databaseFailure(error);
  } finally {
    client.release(destroyConnection);
  }
}

// 1. The exact trusted User, FOR SHARE: a status UPDATE cannot commit ahead of
//    this transaction.
async function lockActiveUser(client: RuntimeClient, principal: ActivePrincipal): Promise<void> {
  const user = await client.query<{ status: string }>("SELECT status FROM users WHERE id = $1 FOR SHARE", [principal.userId]);
  if (user.rows.length === 0) throw principalUnavailable("USER_NOT_FOUND");
  if (user.rows[0]!.status !== "ACTIVE") throw principalUnavailable("USER_DISABLED");
}

// 2. The trusted PERSONAL Account with the account lifecycle lock (FOR NO KEY
//    UPDATE), owned by the trusted User and ACTIVE.
async function lockActiveAccount(client: RuntimeClient, principal: ActivePrincipal): Promise<void> {
  const account = await client.query<{ kind: string; owner_user_id: string; status: string }>(
    "SELECT kind, owner_user_id, status FROM accounts WHERE id = $1 FOR NO KEY UPDATE",
    [principal.accountId],
  );
  const row = account.rows[0];
  if (row === undefined || row.kind !== "PERSONAL") throw principalUnavailable("ACCOUNT_NOT_FOUND");
  if (row.owner_user_id !== principal.userId) throw principalUnavailable("ACCOUNT_NOT_OWNED");
  if (row.status !== "ACTIVE") throw principalUnavailable("ACCOUNT_DISABLED");
}

async function findByIdempotencyKey(client: RuntimeClient, principal: ActivePrincipal, input: IssueGenerationAuthorizationInput) {
  const existing = await client.query<AuthorizationRow>(
    `SELECT ${AUTHORIZATION_COLUMNS} FROM generation_authorizations
      WHERE account_id = $1 AND production_id = $2 AND creation_idempotency_key = $3`,
    [principal.accountId, input.productionId, input.idempotencyKey],
  );
  return existing.rows[0] ?? null;
}

// The same logical intent: same Production (by the lookup), ProviderConnection,
// model and canonical request hash. The original is returned unchanged in
// every lifecycle state; nothing is refreshed, rebound, re-priced or audited.
function replayOf(row: AuthorizationRow, input: IssueGenerationAuthorizationInput, requestSha256: string): GenerationAuthorizationView {
  if (
    row.production_id !== input.productionId ||
    row.provider_connection_id !== input.providerConnectionId ||
    row.model !== input.model ||
    row.generation_request_sha256 !== requestSha256
  ) {
    throw fail("IDEMPOTENCY_KEY_CONFLICT");
  }
  return toView(row);
}

const INSERT_AUTHORIZATION = `
INSERT INTO generation_authorizations
  (account_id, production_id, entitlement_grant_id, billing_mode, provider, model, provider_connection_id,
   provider_credential_version_id, generation_request, generation_request_sha256, expected_cost_cap_unit,
   expected_cost_cap_amount, status, expires_at, created_by_user_id, creation_idempotency_key)
VALUES ($1, $2, $3, '${BILLING_MODE}', $4, $5, $6, $7, $8::jsonb, $9, $10, $11, 'ISSUED',
        clock_timestamp() + $12::double precision * interval '1 second', $13, $14)
ON CONFLICT (account_id, production_id, creation_idempotency_key) WHERE creation_idempotency_key IS NOT NULL DO NOTHING
RETURNING ${AUTHORIZATION_COLUMNS}`;

const INSERT_AUDIT = `
INSERT INTO audit_events (account_id, actor_type, actor_user_id, event_type, resource_type, resource_id, correlation_id, metadata)
VALUES ($1, 'USER', $2, '${AUDIT_EVENT}', 'generation_authorization', $3, $4, $5::jsonb)`;

// Issues one ISSUED USER_BYO GenerationAuthorization, or returns the original
// on a true idempotent replay.
export async function issueGenerationAuthorization(
  dependencies: GenerationAuthorizationServiceDependencies,
  principal: ActivePrincipal,
  rawInput: unknown,
  options: IssueGenerationAuthorizationOptions = {},
): Promise<IssueGenerationAuthorizationResult> {
  requireTrustedPrincipal(principal);
  const input = validateIssueGenerationAuthorizationInput(rawInput);
  const correlationId = options.correlationId ?? randomUUID();
  if (typeof correlationId !== "string" || !UUID_PATTERN.test(correlationId)) throw invalid();
  const requestSha256 = canonicalRequestSha256(input.generationRequest);

  return withTransaction(dependencies.pool, async (client) => {
    const finish = (authorization: GenerationAuthorizationView, created: boolean) => Object.freeze({ authorization, created, correlationId });

    await lockActiveUser(client, principal);
    await lockActiveAccount(client, principal);

    // Replay revalidates only the active principal: the original is returned
    // even if the connection, Production or grant has since changed.
    const replay = await findByIdempotencyKey(client, principal, input);
    if (replay !== null) return finish(replayOf(replay, input, requestSha256), false);

    // 3. The exact same-account connection with its lifecycle lock; the
    //    provider derives from it.
    const connection = await client.query<{ provider: string; status: string; verification_status: string }>(
      "SELECT provider, status, verification_status FROM provider_connections WHERE account_id = $1 AND id = $2 FOR UPDATE",
      [principal.accountId, input.providerConnectionId],
    );
    const connectionRow = connection.rows[0];
    if (connectionRow === undefined || connectionRow.status !== "ACTIVE" || connectionRow.verification_status !== "VERIFIED") {
      throw fail("PROVIDER_CONNECTION_UNAVAILABLE");
    }

    // 4. The newest credential version only; an older ACTIVE version is never
    //    a substitute. Rotation and disconnect take the connection lock first.
    const newest = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM provider_credential_versions
        WHERE account_id = $1 AND provider_connection_id = $2
        ORDER BY credential_version DESC
        LIMIT 1`,
      [principal.accountId, input.providerConnectionId],
    );
    const credential = newest.rows[0];
    if (credential === undefined || credential.status !== "ACTIVE") throw fail("CREDENTIAL_UNAVAILABLE");

    // 5. The exact same-account Production, FOR SHARE against archival.
    const production = await client.query<{ creation_entitlement_grant_id: string; archived_at: Date | null }>(
      "SELECT creation_entitlement_grant_id, archived_at FROM productions WHERE account_id = $1 AND id = $2 FOR SHARE",
      [principal.accountId, input.productionId],
    );
    const productionRow = production.rows[0];
    if (productionRow === undefined || productionRow.archived_at !== null) throw fail("PRODUCTION_UNAVAILABLE");

    // 6. That Production's exact creation grant, FOR SHARE against lifecycle
    //    updates. No other grant is ever searched for.
    const grant = await client.query<{ kind: string; state: string; policy_version: string }>(
      "SELECT kind, state, policy_version FROM entitlement_grants WHERE account_id = $1 AND id = $2 FOR SHARE",
      [principal.accountId, productionRow.creation_entitlement_grant_id],
    );
    const grantRow = grant.rows[0];
    if (grantRow === undefined || grantRow.kind !== "FREE_BYO" || grantRow.state !== "AVAILABLE") throw fail("ENTITLEMENT_NOT_AVAILABLE");
    const entitlementPolicy = resolveFreeByoPolicy(grantRow.policy_version);
    if (entitlementPolicy === null) throw fail("ENTITLEMENT_POLICY_UNSUPPORTED");

    // Every authoritative lock is held: a concurrent same-key winner is visible.
    const lateReplay = await findByIdempotencyKey(client, principal, input);
    if (lateReplay !== null) return finish(replayOf(lateReplay, input, requestSha256), false);

    // 7. Exact provider/model capability; the production registry has none.
    const resolved = capabilityFor(dependencies.policy, connectionRow.provider, input.model);
    if (resolved === null) throw fail("GENERATION_CAPABILITY_UNAVAILABLE");

    // 8. The shared contract validates; the shared hash authority hashes.
    const request = validatedRequest(resolved.contract.parse, input.generationRequest);
    const storedSha256 = canonicalRequestSha256(request);
    if (storedSha256 !== requestSha256) throw fail("GENERATION_AUTHORIZATION_INVARIANT_VIOLATION");

    // 9-10. Server-policy cost cap in the shared unit; expiry from the
    //       database clock plus the policy's lifetime.
    const limits = generationLimits(resolved.capability, resolved.contract, request);

    // 11. Exactly one ISSUED authorization; the unique index is the final
    //     same-key race guard.
    const inserted = await client.query<AuthorizationRow>(INSERT_AUTHORIZATION, [
      principal.accountId,
      input.productionId,
      productionRow.creation_entitlement_grant_id,
      connectionRow.provider,
      input.model,
      input.providerConnectionId,
      credential.id,
      JSON.stringify(request),
      storedSha256,
      limits.expectedCostCapUnit,
      limits.expectedCostCapAmount,
      limits.claimLifetimeSeconds,
      principal.userId,
      input.idempotencyKey,
    ]);
    const row = inserted.rows[0];
    if (row === undefined) {
      const winner = await findByIdempotencyKey(client, principal, input);
      if (winner === null) throw fail("GENERATION_AUTHORIZATION_INVARIANT_VIOLATION");
      return finish(replayOf(winner, input, requestSha256), false);
    }

    // 12. One safe audit event: policy versions only, never the request,
    //     prompt, reference or any credential material.
    await client.query(INSERT_AUDIT, [
      principal.accountId,
      principal.userId,
      row.id,
      correlationId,
      JSON.stringify({ entitlementPolicyVersion: entitlementPolicy.version, generationPolicyVersion: limits.generationPolicyVersion }),
    ]);

    return finish(toView(row), true);
  });
}
