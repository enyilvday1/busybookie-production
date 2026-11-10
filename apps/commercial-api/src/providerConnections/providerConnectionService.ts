import { randomUUID, timingSafeEqual } from "node:crypto";

import type { RuntimeClient, TransactionalPool } from "../database/runtimePool.js";
import { MAX_CREDENTIAL_VERSION, PROVIDER_CREDENTIAL_PURPOSE } from "commercial-worker-protocol";
import type { CredentialFingerprint, CredentialFingerprinter, CredentialSealer } from "commercial-worker-protocol";
import { CredentialCryptoError } from "commercial-worker-protocol";
import { credentialBytes } from "commercial-worker-protocol";
import type { SealedCredentialEnvelope } from "commercial-worker-protocol";
import { readCredentialObligations } from "./credentialObligations.js";
import type { ProviderCapabilityRegistry } from "./providerCapabilityRegistry.js";
import { ProviderConnectionError, type ProviderConnectionErrorCode } from "./providerConnectionError.js";
import { getProviderConnectionForAccount, type ProviderConnectionView } from "./providerConnectionReadModel.js";

// ProviderConnection mutations: create, rotate, disconnect.
//
// Authority: the account and user come from the authenticated principal; the
// request supplies only provider, label, credential and idempotency key.
// These services seal and fingerprint; they never open a stored credential.
//
// Transactions and crypto: fingerprinting and sealing happen before any
// database transaction, so a future network key service never runs while
// locks are held. Inside each mutation transaction the account row is locked
// FOR NO KEY UPDATE (serialising creates, rotations and duplicate checks per
// account and re-checking that the account and user are still active), then
// the connection row FOR UPDATE. That order is the same everywhere.

export type ProviderConnectionServiceDependencies = Readonly<{
  pool: TransactionalPool;
  registry: ProviderCapabilityRegistry;
  sealer: CredentialSealer;
  fingerprinter: CredentialFingerprinter;
}>;

export type TrustedPrincipal = Readonly<{ userId: string; accountId: string }>;

export type MutationOptions = Readonly<{ correlationId?: string }>;

export type ProviderConnectionMutationResult = Readonly<{
  providerConnection: ProviderConnectionView;
  // false for an idempotent replay (or a repeated disconnect).
  created: boolean;
  credentialVersion: number | null;
}>;

const CREDENTIAL_KIND = "API_KEY";
const PROVIDER_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_LABEL_LENGTH = 100;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
// Rotation prepares a version number before its transaction; if concurrent
// rotations keep taking that number, it retries a bounded number of times.
export const MAX_ROTATION_ATTEMPTS = 4;

const CREATE_KEYS = new Set(["provider", "label", "credential", "idempotencyKey"]);
const ROTATE_KEYS = new Set(["credential", "idempotencyKey"]);
const ROTATABLE_STATUSES = new Set(["PENDING_VERIFICATION", "ACTIVE", "INVALID"]);

function fail(code: ProviderConnectionErrorCode): ProviderConnectionError {
  return new ProviderConnectionError(code);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codePoints(value: string): number {
  return [...value].length;
}

// The credential is validated exactly as the crypto layer will see it; it is
// never trimmed or otherwise changed.
function validateCredential(value: unknown): string {
  try {
    credentialBytes(value);
  } catch {
    throw fail("PROVIDER_CONNECTION_INPUT_INVALID");
  }
  return value as string;
}

function validateIdempotencyKey(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length === 0 || codePoints(value) > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw fail("PROVIDER_CONNECTION_INPUT_INVALID");
  }
  return value;
}

export type CreateProviderConnectionInput = Readonly<{
  provider: string;
  label: string | null;
  credential: string;
  idempotencyKey: string | null;
}>;

export function validateCreateInput(input: unknown): CreateProviderConnectionInput {
  if (!isPlainObject(input) || Object.keys(input).some((key) => !CREATE_KEYS.has(key))) {
    throw fail("PROVIDER_CONNECTION_INPUT_INVALID");
  }
  if (typeof input.provider !== "string" || !PROVIDER_PATTERN.test(input.provider)) {
    throw fail("PROVIDER_CONNECTION_INPUT_INVALID");
  }
  let label: string | null = null;
  if (input.label !== undefined) {
    // Mirrors provider_connections_label_ck; validated, never trimmed.
    if (typeof input.label !== "string" || input.label.length === 0 || codePoints(input.label) > MAX_LABEL_LENGTH || /^\s|\s$/.test(input.label)) {
      throw fail("PROVIDER_CONNECTION_INPUT_INVALID");
    }
    label = input.label;
  }
  return Object.freeze({
    provider: input.provider,
    label,
    credential: validateCredential(input.credential),
    idempotencyKey: validateIdempotencyKey(input.idempotencyKey),
  });
}

export type RotateCredentialInput = Readonly<{ credential: string; idempotencyKey: string | null }>;

export function validateRotateInput(input: unknown): RotateCredentialInput {
  if (!isPlainObject(input) || Object.keys(input).some((key) => !ROTATE_KEYS.has(key))) {
    throw fail("PROVIDER_CONNECTION_INPUT_INVALID");
  }
  return Object.freeze({ credential: validateCredential(input.credential), idempotencyKey: validateIdempotencyKey(input.idempotencyKey) });
}

function requireConnectionId(connectionId: string): void {
  if (!UUID_PATTERN.test(connectionId)) throw fail("PROVIDER_CONNECTION_NOT_FOUND");
}

function correlationIdFrom(options: MutationOptions): string {
  const id = options.correlationId ?? randomUUID();
  if (!UUID_PATTERN.test(id)) throw fail("PROVIDER_CONNECTION_INPUT_INVALID");
  return id;
}

// Crypto failures: a credential the crypto layer rejects is invalid input;
// anything else means the crypto service is unavailable. No detail is kept.
async function cryptoStep<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CredentialCryptoError && error.code === "CREDENTIAL_INVALID") {
      throw fail("PROVIDER_CONNECTION_INPUT_INVALID");
    }
    throw fail("CREDENTIAL_CRYPTO_UNAVAILABLE");
  }
}

// Constant-time comparison of a stored fingerprint with a freshly computed
// one. Different key references (or a destroyed fingerprint) never compare
// equal: the result fails closed.
function sameFingerprint(storedKeyRef: string | null, storedValue: string | null, fingerprint: CredentialFingerprint): boolean {
  if (storedKeyRef === null || storedValue === null || storedKeyRef !== fingerprint.keyRef) return false;
  const left = Buffer.from(storedValue);
  const right = Buffer.from(fingerprint.value);
  return left.length === right.length && timingSafeEqual(left, right);
}

function databaseFailure(error: unknown): ProviderConnectionError {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
  return new ProviderConnectionError("PROVIDER_CONNECTION_DATABASE_FAILURE", { cause: error, ...(code === undefined ? {} : { databaseCode: code }) });
}

// Signals a stale prepared rotation version; the transaction rolls back and
// the rotation retries with a fresh candidate.
class StaleVersion extends Error {
  constructor(readonly nextVersion: number) {
    super("stale credential version");
  }
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
    if (error instanceof ProviderConnectionError || error instanceof StaleVersion) throw error;
    throw databaseFailure(error);
  } finally {
    client.release(destroyConnection);
  }
}

// Re-checks inside the mutation transaction that the trusted account and user
// are still active, and locks the account row to serialise this account's
// connection mutations.
async function lockActiveAccount(client: RuntimeClient, principal: TrustedPrincipal): Promise<void> {
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

const INSERT_AUDIT = `
INSERT INTO audit_events (account_id, actor_type, actor_user_id, event_type, resource_type, resource_id, correlation_id, metadata)
VALUES ($1, 'USER', $2, $3, 'provider_connection', $4, $5, $6::jsonb)`;

// Metadata is limited to the provider and credential version: never a
// credential, envelope, fingerprint, key reference or label.
async function audit(
  client: RuntimeClient,
  principal: TrustedPrincipal,
  eventType: string,
  connectionId: string,
  correlationId: string,
  metadata: Readonly<{ provider: string; credentialVersion?: number }>,
): Promise<void> {
  await client.query(INSERT_AUDIT, [principal.accountId, principal.userId, eventType, connectionId, correlationId, JSON.stringify(metadata)]);
}

async function readView(client: RuntimeClient, principal: TrustedPrincipal, connectionId: string): Promise<ProviderConnectionView> {
  const view = await getProviderConnectionForAccount(client, principal.accountId, connectionId);
  if (view === null) throw fail("PROVIDER_CONNECTION_INVARIANT_VIOLATION");
  return view;
}

// Live (non-destroyed) credential of a non-disconnected connection of this
// account and provider with the same fingerprint. Never compares across
// accounts. Optionally ignores one connection (the one being rotated).
async function findDuplicateCredential(
  client: RuntimeClient,
  principal: TrustedPrincipal,
  provider: string,
  fingerprint: CredentialFingerprint,
  excludeConnectionId: string | null,
): Promise<boolean> {
  const result = await client.query<{ fingerprint_value: string }>(
    `SELECT v.fingerprint_value
       FROM provider_credential_versions v
       JOIN provider_connections c ON c.id = v.provider_connection_id AND c.account_id = v.account_id
      WHERE v.account_id = $1 AND c.provider = $2 AND v.fingerprint_key_ref = $3
        AND v.status <> 'DESTROYED'
        AND c.status IN ('PENDING_VERIFICATION', 'ACTIVE', 'INVALID', 'DISABLED')
        AND ($4::uuid IS NULL OR c.id <> $4::uuid)`,
    [principal.accountId, provider, fingerprint.keyRef, excludeConnectionId],
  );
  return result.rows.some((row) => sameFingerprint(fingerprint.keyRef, row.fingerprint_value, fingerprint));
}

type CreationReplayRow = { id: string; provider: string; label: string | null; fingerprint_key_ref: string | null; fingerprint_value: string | null };

async function findCreationReplay(client: RuntimeClient | TransactionalPool, principal: TrustedPrincipal, key: string): Promise<CreationReplayRow | null> {
  const result = await client.query<CreationReplayRow>(
    `SELECT c.id, c.provider, c.label, v.fingerprint_key_ref, v.fingerprint_value
       FROM provider_connections c
       LEFT JOIN provider_credential_versions v
         ON v.provider_connection_id = c.id AND v.account_id = c.account_id AND v.credential_version = 1
      WHERE c.account_id = $1 AND c.creation_idempotency_key = $2`,
    [principal.accountId, key],
  );
  return result.rows[0] ?? null;
}

// A creation key replays only for the same provider, label and credential
// (by fingerprint). Anything else, including an unprovable fingerprint, is a
// conflict.
function assertCreationReplay(row: CreationReplayRow, input: CreateProviderConnectionInput, fingerprint: CredentialFingerprint): void {
  if (row.provider !== input.provider || row.label !== input.label || !sameFingerprint(row.fingerprint_key_ref, row.fingerprint_value, fingerprint)) {
    throw fail("IDEMPOTENCY_KEY_CONFLICT");
  }
}

function resolveCapability(registry: ProviderCapabilityRegistry, provider: string): void {
  const capability = registry.resolve(provider);
  if (capability === null || capability.provider !== provider || !capability.connectionCreationEnabled || !capability.credentialKinds.includes(CREDENTIAL_KIND)) {
    throw fail("PROVIDER_UNSUPPORTED");
  }
}

export async function createProviderConnection(
  dependencies: ProviderConnectionServiceDependencies,
  principal: TrustedPrincipal,
  rawInput: unknown,
  options: MutationOptions = {},
): Promise<ProviderConnectionMutationResult> {
  const input = validateCreateInput(rawInput);
  const correlationId = correlationIdFrom(options);
  resolveCapability(dependencies.registry, input.provider);

  const fingerprint = await cryptoStep(() => dependencies.fingerprinter.fingerprint(input.credential));

  // Fast replay without sealing anything.
  if (input.idempotencyKey !== null) {
    const replay = await findCreationReplay(dependencies.pool, principal, input.idempotencyKey).catch((error: unknown) => {
      throw databaseFailure(error);
    });
    if (replay !== null) {
      assertCreationReplay(replay, input, fingerprint);
      const view = await withTransaction(dependencies.pool, (client) => readView(client, principal, replay.id));
      return Object.freeze({ providerConnection: view, created: false, credentialVersion: 1 });
    }
  }

  const connectionId = randomUUID();
  const versionId = randomUUID();
  const envelope: SealedCredentialEnvelope = await cryptoStep(() =>
    dependencies.sealer.seal(input.credential, {
      accountId: principal.accountId,
      providerConnectionId: connectionId,
      provider: input.provider,
      credentialVersion: 1,
      purpose: PROVIDER_CREDENTIAL_PURPOSE,
    }),
  );

  return withTransaction(dependencies.pool, async (client) => {
    await lockActiveAccount(client, principal);

    // A concurrent request with the same key may have committed while this
    // one waited for the account lock; the prepared envelope is then discarded.
    if (input.idempotencyKey !== null) {
      const replay = await findCreationReplay(client, principal, input.idempotencyKey);
      if (replay !== null) {
        assertCreationReplay(replay, input, fingerprint);
        return Object.freeze({ providerConnection: await readView(client, principal, replay.id), created: false, credentialVersion: 1 });
      }
    }

    if (await findDuplicateCredential(client, principal, input.provider, fingerprint, null)) {
      throw fail("DUPLICATE_CREDENTIAL");
    }

    await client.query(
      `INSERT INTO provider_connections (id, account_id, provider, credential_kind, label, created_by_user_id, creation_idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [connectionId, principal.accountId, input.provider, CREDENTIAL_KIND, input.label, principal.userId, input.idempotencyKey],
    );
    await client.query(
      `INSERT INTO provider_credential_versions
         (id, account_id, provider_connection_id, credential_version, status, sealed_credential,
          fingerprint_algorithm, fingerprint_key_ref, fingerprint_value, created_by_user_id)
       VALUES ($1, $2, $3, 1, 'ACTIVE', $4::jsonb, $5, $6, $7, $8)`,
      [versionId, principal.accountId, connectionId, JSON.stringify(envelope), fingerprint.algorithm, fingerprint.keyRef, fingerprint.value, principal.userId],
    );
    await audit(client, principal, "provider_connection.created", connectionId, correlationId, { provider: input.provider, credentialVersion: 1 });

    return Object.freeze({ providerConnection: await readView(client, principal, connectionId), created: true, credentialVersion: 1 });
  });
}

type ConnectionStateRow = { id: string; provider: string; status: string };
type VersionRow = { credential_version: number; status: string; fingerprint_key_ref: string | null; fingerprint_value: string | null };

async function maxCredentialVersion(client: RuntimeClient | TransactionalPool, principal: TrustedPrincipal, connectionId: string): Promise<number> {
  const result = await client.query<{ max: number | null }>(
    "SELECT max(credential_version) AS max FROM provider_credential_versions WHERE account_id = $1 AND provider_connection_id = $2",
    [principal.accountId, connectionId],
  );
  return result.rows[0]?.max ?? 0;
}

async function findRotationReplay(client: RuntimeClient | TransactionalPool, principal: TrustedPrincipal, connectionId: string, key: string): Promise<VersionRow | null> {
  const result = await client.query<VersionRow>(
    `SELECT credential_version, status, fingerprint_key_ref, fingerprint_value
       FROM provider_credential_versions
      WHERE account_id = $1 AND provider_connection_id = $2 AND rotation_idempotency_key = $3`,
    [principal.accountId, connectionId, key],
  );
  return result.rows[0] ?? null;
}

export async function rotateProviderCredential(
  dependencies: ProviderConnectionServiceDependencies,
  principal: TrustedPrincipal,
  connectionId: string,
  rawInput: unknown,
  options: MutationOptions = {},
): Promise<ProviderConnectionMutationResult> {
  requireConnectionId(connectionId);
  const input = validateRotateInput(rawInput);
  const correlationId = correlationIdFrom(options);

  const connection = await dependencies.pool
    .query<ConnectionStateRow>("SELECT id, provider, status FROM provider_connections WHERE account_id = $1 AND id = $2", [principal.accountId, connectionId])
    .catch((error: unknown) => {
      throw databaseFailure(error);
    });
  const current = connection.rows[0];
  if (current === undefined) throw fail("PROVIDER_CONNECTION_NOT_FOUND");

  const fingerprint = await cryptoStep(() => dependencies.fingerprinter.fingerprint(input.credential));

  const replayFrom = async (client: RuntimeClient, row: VersionRow): Promise<ProviderConnectionMutationResult> => {
    if (!sameFingerprint(row.fingerprint_key_ref, row.fingerprint_value, fingerprint)) throw fail("IDEMPOTENCY_KEY_CONFLICT");
    return Object.freeze({ providerConnection: await readView(client, principal, connectionId), created: false, credentialVersion: row.credential_version });
  };

  let candidate = await maxCredentialVersion(dependencies.pool, principal, connectionId).then((max) => max + 1, (error: unknown) => {
    throw databaseFailure(error);
  });

  for (let attempt = 1; attempt <= MAX_ROTATION_ATTEMPTS; attempt += 1) {
    if (candidate > MAX_CREDENTIAL_VERSION) throw fail("CONNECTION_STATE_CONFLICT");

    const versionId = randomUUID();
    const proposedVersion = candidate;
    const envelope = await cryptoStep(() =>
      dependencies.sealer.seal(input.credential, {
        accountId: principal.accountId,
        providerConnectionId: connectionId,
        provider: current.provider,
        credentialVersion: proposedVersion,
        purpose: PROVIDER_CREDENTIAL_PURPOSE,
      }),
    );

    try {
      return await withTransaction(dependencies.pool, async (client) => {
        await lockActiveAccount(client, principal);
        const locked = await client.query<ConnectionStateRow>(
          "SELECT id, provider, status FROM provider_connections WHERE account_id = $1 AND id = $2 FOR UPDATE",
          [principal.accountId, connectionId],
        );
        const connectionRow = locked.rows[0];
        if (connectionRow === undefined) throw fail("PROVIDER_CONNECTION_NOT_FOUND");

        if (input.idempotencyKey !== null) {
          const replay = await findRotationReplay(client, principal, connectionId, input.idempotencyKey);
          if (replay !== null) return replayFrom(client, replay);
        }

        if (!ROTATABLE_STATUSES.has(connectionRow.status)) throw fail("CONNECTION_STATE_CONFLICT");

        const latest = await maxCredentialVersion(client, principal, connectionId);
        if (latest + 1 !== proposedVersion) throw new StaleVersion(latest + 1);

        const active = await client.query<VersionRow & { id: string }>(
          `SELECT id, credential_version, status, fingerprint_key_ref, fingerprint_value
             FROM provider_credential_versions
            WHERE account_id = $1 AND provider_connection_id = $2 AND status = 'ACTIVE'`,
          [principal.accountId, connectionId],
        );
        const activeRow = active.rows[0];
        if (activeRow === undefined) throw fail("PROVIDER_CONNECTION_INVARIANT_VIOLATION");
        if (sameFingerprint(activeRow.fingerprint_key_ref, activeRow.fingerprint_value, fingerprint)) throw fail("CREDENTIAL_UNCHANGED");
        if (await findDuplicateCredential(client, principal, connectionRow.provider, fingerprint, connectionId)) throw fail("DUPLICATE_CREDENTIAL");

        await client.query(
          "UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now(), updated_at = now() WHERE id = $1 AND account_id = $2",
          [activeRow.id, principal.accountId],
        );
        await client.query(
          `INSERT INTO provider_credential_versions
             (id, account_id, provider_connection_id, credential_version, status, sealed_credential,
              fingerprint_algorithm, fingerprint_key_ref, fingerprint_value, rotation_idempotency_key, created_by_user_id)
           VALUES ($1, $2, $3, $4, 'ACTIVE', $5::jsonb, $6, $7, $8, $9, $10)`,
          [versionId, principal.accountId, connectionId, proposedVersion, JSON.stringify(envelope), fingerprint.algorithm, fingerprint.keyRef, fingerprint.value, input.idempotencyKey, principal.userId],
        );
        // The new credential is not verified: verification returns to the fail-closed state.
        await client.query(
          `UPDATE provider_connections
              SET status = 'PENDING_VERIFICATION', verification_status = 'UNVERIFIED',
                  verified_at = NULL, last_verification_attempt_at = NULL, updated_at = now()
            WHERE id = $1 AND account_id = $2`,
          [connectionId, principal.accountId],
        );
        await audit(client, principal, "provider_connection.credential_rotated", connectionId, correlationId, {
          provider: connectionRow.provider,
          credentialVersion: proposedVersion,
        });

        return Object.freeze({ providerConnection: await readView(client, principal, connectionId), created: true, credentialVersion: proposedVersion });
      });
    } catch (error) {
      if (error instanceof StaleVersion) {
        candidate = error.nextVersion;
        continue;
      }
      throw error;
    }
  }

  throw fail("CONCURRENT_MODIFICATION");
}

// Logical disconnect with the retention/recovery destruction gate
// (worker bridge architecture sections 23-24).
//
// The connection becomes DISCONNECTED and is never eligible for new work
// again. Each non-destroyed credential version is then decided on its own:
// a version with an open credential-retention or provider-recovery
// obligation (see credentialObligations.ts) is kept sealed as
// RETAINED_FOR_RECOVERY, solely for that already-open work; every other
// version is destroyed (sealed credential and fingerprint set to NULL),
// irreversibly. Repeating the disconnect re-evaluates retained versions and
// destroys those whose obligations have since closed, so it is also the
// cleanup path; it never revives anything.
//
// Lock order (inside one READ COMMITTED transaction): the account row FOR NO
// KEY UPDATE, then the connection row FOR UPDATE, then the connection's
// non-destroyed credential version rows FOR UPDATE in credential_version
// order, and only then the obligation read, as a new statement, so it sees
// every grant committed before the version locks were obtained.
//
// Contract for the future worker-control service (not implemented here):
// the only event that opens an obligation is a credential grant (setting
// credential_granted_at, directly or on entering SUBMITTING). That
// transaction must lock the exact provider_credential_versions row (FOR SHARE
// or stronger) before recording the grant, and must verify in the same
// transaction that the version is not DESTROYED and, for a new pre-submission
// grant, that the connection is still eligible (not DISCONNECTED or
// DISABLED) and the version is not RETAINED_FOR_RECOVERY; a recovery grant
// for an already-submitted attempt may use a retained version. Because both
// transactions take conflicting locks on the same version row, a grant either
// commits first (and this disconnect then sees it and retains the version) or
// waits and then finds the version destroyed or the connection disconnected
// (and must refuse). A plain SELECT without that lock would not be safe.
export async function disconnectProviderConnection(
  dependencies: Pick<ProviderConnectionServiceDependencies, "pool">,
  principal: TrustedPrincipal,
  connectionId: string,
  options: MutationOptions = {},
): Promise<ProviderConnectionMutationResult> {
  requireConnectionId(connectionId);
  const correlationId = correlationIdFrom(options);

  return withTransaction(dependencies.pool, async (client) => {
    await lockActiveAccount(client, principal);
    const locked = await client.query<ConnectionStateRow>(
      "SELECT id, provider, status FROM provider_connections WHERE account_id = $1 AND id = $2 FOR UPDATE",
      [principal.accountId, connectionId],
    );
    const connection = locked.rows[0];
    if (connection === undefined) throw fail("PROVIDER_CONNECTION_NOT_FOUND");
    const alreadyDisconnected = connection.status === "DISCONNECTED";

    if (!alreadyDisconnected) {
      await client.query(
        "UPDATE provider_connections SET status = 'DISCONNECTED', disconnected_at = now(), updated_at = now() WHERE id = $1 AND account_id = $2",
        [connectionId, principal.accountId],
      );
    }

    const versions = await client.query<{ id: string; credential_version: number; status: string }>(
      `SELECT id, credential_version, status FROM provider_credential_versions
        WHERE account_id = $1 AND provider_connection_id = $2 AND status <> 'DESTROYED'
        ORDER BY credential_version
          FOR UPDATE`,
      [principal.accountId, connectionId],
    );
    const obligations = await readCredentialObligations(
      client,
      principal.accountId,
      versions.rows.map((row) => row.id),
    );

    const retained: number[] = [];
    const destroyed: number[] = [];
    for (const version of versions.rows) {
      const state = obligations.get(version.id);
      if (state === undefined) throw fail("PROVIDER_CONNECTION_INVARIANT_VIOLATION");
      if (state.blocksDestruction) {
        // Sealed material, fingerprint and identity stay exactly as they are.
        if (version.status !== "RETAINED_FOR_RECOVERY") {
          await client.query(
            `UPDATE provider_credential_versions
                SET status = 'RETAINED_FOR_RECOVERY', retained_for_recovery_at = now(), updated_at = now()
              WHERE id = $1 AND account_id = $2`,
            [version.id, principal.accountId],
          );
          retained.push(version.credential_version);
        }
      } else {
        await client.query(
          `UPDATE provider_credential_versions
              SET status = 'DESTROYED', destroyed_at = now(), sealed_credential = NULL,
                  fingerprint_algorithm = NULL, fingerprint_key_ref = NULL, fingerprint_value = NULL, updated_at = now()
            WHERE id = $1 AND account_id = $2`,
          [version.id, principal.accountId],
        );
        destroyed.push(version.credential_version);
      }
    }

    if (!alreadyDisconnected) {
      await audit(client, principal, "provider_connection.disconnected", connectionId, correlationId, { provider: connection.provider });
    }
    for (const credentialVersion of retained) {
      await audit(client, principal, "provider_connection.secret_retained_for_recovery", connectionId, correlationId, {
        provider: connection.provider,
        credentialVersion,
      });
    }
    for (const credentialVersion of destroyed) {
      await audit(client, principal, "provider_connection.secret_destroyed", connectionId, correlationId, {
        provider: connection.provider,
        credentialVersion,
      });
    }

    return Object.freeze({
      providerConnection: await readView(client, principal, connectionId),
      created: !alreadyDisconnected,
      credentialVersion: null,
    });
  });
}
