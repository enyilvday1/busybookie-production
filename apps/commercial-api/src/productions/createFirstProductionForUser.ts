import { randomUUID } from "node:crypto";

import type { RuntimeClient, TransactionalPool } from "../database/runtimePool.js";
import { resolveFreeByoPolicy } from "../entitlements/freeByoPolicy.js";
import { ProductionCreationError } from "./productionCreationError.js";

// Input from a future authenticated boundary. userId is trusted by contract:
// it identifies the already-authenticated BusyBookie User. The account, grant
// and policy are always resolved server-side.
export type CreateFirstProductionInput = Readonly<{
  userId: string;
  title: string;
  idempotencyKey?: string;
}>;

export type CreateProductionOptions = Readonly<{
  // Links the audit event to an upstream request; generated when absent.
  correlationId?: string;
}>;

export type CreatedProduction = Readonly<{
  id: string;
  accountId: string;
  title: string;
  creationEntitlementGrantId: string;
  createdByUserId: string;
  creationIdempotencyKey: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateFirstProductionResult = Readonly<{
  production: CreatedProduction;
  // false when an idempotent retry returned an existing Production.
  created: boolean;
  correlationId: string;
}>;

const INPUT_KEYS = new Set(["userId", "title", "idempotencyKey"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TITLE_LENGTH = 200;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

function invalid(message: string): ProductionCreationError {
  return new ProductionCreationError("PRODUCTION_INPUT_INVALID", message);
}

// Mirrors productions_title_ck and productions_creation_idempotency_key_ck
// (lengths in code points, as char_length counts). The title is validated,
// never trimmed: the schema requires the stored value to carry no leading or
// trailing whitespace, so such input is rejected rather than altered.
export function validateCreateFirstProductionInput(input: unknown): CreateFirstProductionInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw invalid("input must be an object.");
  }
  if (Object.keys(input).some((key) => !INPUT_KEYS.has(key))) {
    throw invalid("input contains unsupported fields.");
  }
  const candidate = input as Record<string, unknown>;

  if (typeof candidate.userId !== "string" || !UUID_PATTERN.test(candidate.userId)) {
    throw invalid("userId must be a UUID.");
  }

  const title = candidate.title;
  if (typeof title !== "string" || title.length === 0 || [...title].length > MAX_TITLE_LENGTH || /^\s|\s$/.test(title)) {
    throw invalid(`title must be 1 to ${MAX_TITLE_LENGTH} characters with no leading or trailing whitespace.`);
  }

  if (candidate.idempotencyKey === undefined) {
    return { userId: candidate.userId, title };
  }
  const key = candidate.idempotencyKey;
  if (typeof key !== "string" || key.length === 0 || [...key].length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw invalid(`idempotencyKey must be 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`);
  }
  return { userId: candidate.userId, title, idempotencyKey: key };
}

type ProductionRow = {
  id: string;
  account_id: string;
  title: string;
  creation_entitlement_grant_id: string;
  created_by_user_id: string;
  creation_idempotency_key: string | null;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type GrantRow = { id: string; account_id: string; policy_version: string };

const PRODUCTION_COLUMNS =
  "id, account_id, title, creation_entitlement_grant_id, created_by_user_id, creation_idempotency_key, archived_at, created_at, updated_at";

const SELECT_BY_IDEMPOTENCY_KEY = `SELECT ${PRODUCTION_COLUMNS} FROM productions WHERE account_id = $1 AND creation_idempotency_key = $2`;

function toProduction(row: ProductionRow): CreatedProduction {
  return Object.freeze({
    id: row.id,
    accountId: row.account_id,
    title: row.title,
    creationEntitlementGrantId: row.creation_entitlement_grant_id,
    createdByUserId: row.created_by_user_id,
    creationIdempotencyKey: row.creation_idempotency_key,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function unavailable(reason: "USER_NOT_FOUND" | "USER_DISABLED" | "ACCOUNT_NOT_FOUND" | "ACCOUNT_DISABLED") {
  return new ProductionCreationError("PRODUCTION_ACCOUNT_UNAVAILABLE", "No active account is available for this user.", { reason });
}

async function resolveActivePersonalAccount(client: RuntimeClient, userId: string): Promise<string> {
  const user = await client.query<{ status: string }>("SELECT status FROM users WHERE id = $1", [userId]);
  if (user.rows.length === 0) throw unavailable("USER_NOT_FOUND");
  if (user.rows[0]!.status !== "ACTIVE") throw unavailable("USER_DISABLED");

  const account = await client.query<{ id: string; status: string }>(
    "SELECT id, status FROM accounts WHERE owner_user_id = $1 AND kind = 'PERSONAL'",
    [userId],
  );
  if (account.rows.length === 0) throw unavailable("ACCOUNT_NOT_FOUND");
  if (account.rows[0]!.status !== "ACTIVE") throw unavailable("ACCOUNT_DISABLED");
  return account.rows[0]!.id;
}

// Section 12 of the persistence architecture: a key reused for the same
// canonical request (the same title) returns the original Production; reused
// for a different title it is an explicit conflict.
function idempotentReplay(row: ProductionRow, input: CreateFirstProductionInput): CreatedProduction {
  if (row.title !== input.title) {
    throw new ProductionCreationError("IDEMPOTENCY_KEY_CONFLICT", "The idempotency key was already used for a different request.");
  }
  return toProduction(row);
}

async function findByIdempotencyKey(client: RuntimeClient, accountId: string, key: string): Promise<ProductionRow | null> {
  const existing = await client.query<ProductionRow>(SELECT_BY_IDEMPOTENCY_KEY, [accountId, key]);
  return existing.rows[0] ?? null;
}

function databaseFailure(error: unknown): ProductionCreationError {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
  return new ProductionCreationError("PRODUCTION_DATABASE_FAILURE", "The production could not be created.", {
    cause: error,
    ...(code === undefined ? {} : { databaseCode: code }),
  });
}

// Creates a Production for the trusted user's PERSONAL account under its
// FREE_BYO grant, in one READ COMMITTED transaction on one dedicated client.
//
// Concurrency, without process-local locking:
// - The AVAILABLE FREE_BYO grant row is locked FOR UPDATE, serialising every
//   creation attempt under it across processes. After a lock wait each
//   following statement takes a fresh snapshot, so the production count sees
//   the previous holder's committed Production and the policy limit holds.
// - Same idempotency key: the key is looked up before the lock (fast replay,
//   even after the limit is reached) and again after acquiring it, which sees
//   a concurrent same-key winner's committed row. The insert also uses
//   ON CONFLICT on the per-account key index as a final guard.
//
// Production creation never changes the grant's state or timestamps.
export async function createFirstProductionForUser(
  pool: TransactionalPool,
  rawInput: CreateFirstProductionInput,
  options: CreateProductionOptions = {},
): Promise<CreateFirstProductionResult> {
  const input = validateCreateFirstProductionInput(rawInput);
  const correlationId = options.correlationId ?? randomUUID();
  if (!UUID_PATTERN.test(correlationId)) {
    throw invalid("correlationId must be a UUID.");
  }

  let client: RuntimeClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw databaseFailure(error);
  }

  let destroyConnection: Error | undefined;
  try {
    await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");

    const accountId = await resolveActivePersonalAccount(client, input.userId);
    const key = input.idempotencyKey;

    const finish = async (result: CreateFirstProductionResult) => {
      await client.query("COMMIT");
      return Object.freeze(result);
    };

    if (key !== undefined) {
      const replay = await findByIdempotencyKey(client, accountId, key);
      if (replay !== null) {
        return await finish({ production: idempotentReplay(replay, input), created: false, correlationId });
      }
    }

    const grants = await client.query<GrantRow>(
      `SELECT id, account_id, policy_version FROM entitlement_grants
        WHERE account_id = $1 AND kind = 'FREE_BYO' AND state = 'AVAILABLE'
        ORDER BY issued_at, id
        LIMIT 1
        FOR UPDATE`,
      [accountId],
    );

    if (key !== undefined) {
      const replay = await findByIdempotencyKey(client, accountId, key);
      if (replay !== null) {
        return await finish({ production: idempotentReplay(replay, input), created: false, correlationId });
      }
    }

    const grant = grants.rows[0];
    if (grant === undefined) {
      throw new ProductionCreationError("ENTITLEMENT_NOT_AVAILABLE", "No entitlement is available to create a production.");
    }
    if (grant.account_id !== accountId) {
      throw new ProductionCreationError("PRODUCTION_INVARIANT_VIOLATION", "Selected entitlement does not belong to the account.");
    }

    const policy = resolveFreeByoPolicy(grant.policy_version);
    if (policy === null) {
      throw new ProductionCreationError("ENTITLEMENT_POLICY_UNSUPPORTED", "The entitlement policy is not supported.");
    }

    const used = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM productions WHERE account_id = $1 AND creation_entitlement_grant_id = $2",
      [accountId, grant.id],
    );
    if ((used.rows[0]?.count ?? 0) >= policy.maxProductions) {
      throw new ProductionCreationError("ENTITLEMENT_NOT_AVAILABLE", "No entitlement is available to create a production.");
    }

    const inserted = await client.query<ProductionRow>(
      `INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id, creation_idempotency_key)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id, creation_idempotency_key) WHERE creation_idempotency_key IS NOT NULL DO NOTHING
       RETURNING ${PRODUCTION_COLUMNS}`,
      [accountId, input.title, grant.id, input.userId, key ?? null],
    );

    if (inserted.rows.length === 0) {
      const replay = key === undefined ? null : await findByIdempotencyKey(client, accountId, key);
      if (replay === null) {
        throw new ProductionCreationError("PRODUCTION_INVARIANT_VIOLATION", "The production insert neither succeeded nor conflicted.");
      }
      return await finish({ production: idempotentReplay(replay, input), created: false, correlationId });
    }

    const production = inserted.rows[0]!;
    await client.query(
      `INSERT INTO audit_events (account_id, actor_type, actor_user_id, event_type, resource_type, resource_id, correlation_id, metadata)
       VALUES ($1, 'USER', $2, 'production.created', 'production', $3, $4, $5::jsonb)`,
      [accountId, input.userId, production.id, correlationId, JSON.stringify({ grantId: grant.id, policyVersion: grant.policy_version })],
    );

    return await finish({ production: toProduction(production), created: true, correlationId });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // The session state is unknown; destroy it instead of returning it to
      // the pool. The primary error below is preserved.
      destroyConnection = rollbackError instanceof Error ? rollbackError : new Error("rollback failed");
    }
    throw error instanceof ProductionCreationError ? error : databaseFailure(error);
  } finally {
    client.release(destroyConnection);
  }
}
