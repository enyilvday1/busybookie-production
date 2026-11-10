import { randomUUID } from "node:crypto";

import type { VerifiedIdentity } from "../authentication/verifiedIdentity.js";
import type { RuntimeClient, TransactionalPool } from "../database/runtimePool.js";
import { ProvisioningError } from "./provisioningError.js";

// Server-owned provisioning decisions. None of these can be supplied by a
// caller.
//
// FREE_BYO_POLICY_VERSION is the durable identifier of the initial FREE_BYO
// policy, recorded on every grant issued under it. A later policy gets a new
// identifier; existing grants keep the version they were issued under.
//
// FREE_BYO_ISSUANCE_KEY is the persistence design's key for the initial
// provisioning issuance. The account-level unique index (not this key) is what
// prevents a second initial grant.
export const FREE_BYO_POLICY_VERSION = "free-byo-v1";
export const FREE_BYO_ISSUANCE_KEY = "account-provisioning";

// Trusted identity claims, by contract supplied only by the authentication
// boundary that has verified them. Never accept these from an
// unauthenticated client. The type is owned by the authentication module.
export type { VerifiedIdentity };

export type ProvisionOptions = Readonly<{
  // Links this operation's audit events to an upstream request; generated when absent.
  correlationId?: string;
}>;

export type ProvisionedUser = Readonly<{
  id: string;
  idpIssuer: string;
  idpSubject: string;
  email: string | null;
  emailVerified: boolean;
  status: "ACTIVE" | "DISABLED";
  createdAt: Date;
  updatedAt: Date;
}>;

export type ProvisionedAccount = Readonly<{
  id: string;
  kind: "PERSONAL";
  ownerUserId: string;
  status: "ACTIVE" | "DISABLED";
  createdAt: Date;
  updatedAt: Date;
}>;

export type ProvisionedGrant = Readonly<{
  id: string;
  accountId: string;
  kind: "FREE_BYO";
  state: "AVAILABLE" | "RESERVED" | "CONSUMED" | "REVOKED" | "EXPIRED";
  source: "ACCOUNT_PROVISIONING";
  policyVersion: string;
  issuedAt: Date;
}>;

export type ProvisioningResult = Readonly<{
  user: ProvisionedUser;
  personalAccount: ProvisionedAccount;
  freeByoEntitlementGrant: ProvisionedGrant;
  // Which records this call created (false = already existed).
  created: Readonly<{ user: boolean; personalAccount: boolean; freeByoEntitlementGrant: boolean }>;
  correlationId: string;
}>;

const IDENTITY_KEYS = new Set(["issuer", "subject", "email"]);
const EMAIL_KEYS = new Set(["address", "verified"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Mirrors the users CHECK constraints (lengths in code points, as PostgreSQL
// char_length counts). Values are validated, never trimmed or case-folded:
// issuer and subject are opaque identity keys.
function boundedText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim() === "" || [...value].length > maxLength) {
    throw new ProvisioningError("PROVISIONING_INPUT_INVALID", `${field} must be a non-blank string of at most ${maxLength} characters.`);
  }
  return value;
}

function onlyKeys(value: object, allowed: ReadonlySet<string>, field: string): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new ProvisioningError("PROVISIONING_INPUT_INVALID", `${field} contains unsupported fields.`);
  }
}

export function validateVerifiedIdentity(input: unknown): VerifiedIdentity {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ProvisioningError("PROVISIONING_INPUT_INVALID", "identity must be an object.");
  }
  onlyKeys(input, IDENTITY_KEYS, "identity");
  const candidate = input as Record<string, unknown>;

  const issuer = boundedText(candidate.issuer, "issuer", 512);
  const subject = boundedText(candidate.subject, "subject", 255);

  if (candidate.email === undefined) {
    return { issuer, subject };
  }
  if (typeof candidate.email !== "object" || candidate.email === null || Array.isArray(candidate.email)) {
    throw new ProvisioningError("PROVISIONING_INPUT_INVALID", "email must be an object with address and verified.");
  }
  onlyKeys(candidate.email, EMAIL_KEYS, "email");
  const email = candidate.email as Record<string, unknown>;
  if (typeof email.verified !== "boolean") {
    throw new ProvisioningError("PROVISIONING_INPUT_INVALID", "email.verified must be a boolean.");
  }

  return { issuer, subject, email: { address: boundedText(email.address, "email.address", 320), verified: email.verified } };
}

type UserRow = {
  id: string;
  idp_issuer: string;
  idp_subject: string;
  email: string | null;
  email_verified: boolean;
  status: "ACTIVE" | "DISABLED";
  created_at: Date;
  updated_at: Date;
};

type AccountRow = {
  id: string;
  kind: string;
  owner_user_id: string;
  status: "ACTIVE" | "DISABLED";
  created_at: Date;
  updated_at: Date;
};

type GrantRow = {
  id: string;
  account_id: string;
  kind: string;
  state: ProvisionedGrant["state"];
  source: string;
  policy_version: string;
  issued_at: Date;
};

const USER_COLUMNS = "id, idp_issuer, idp_subject, email, email_verified, status, created_at, updated_at";
const ACCOUNT_COLUMNS = "id, kind, owner_user_id, status, created_at, updated_at";
const GRANT_COLUMNS = "id, account_id, kind, state, source, policy_version, issued_at";

function invariant(message: string): ProvisioningError {
  return new ProvisioningError("PROVISIONING_INVARIANT_VIOLATION", message);
}

// Insert-or-select under READ COMMITTED: ON CONFLICT DO NOTHING waits for a
// concurrent inserter of the same key to finish; if it committed, nothing is
// returned and the following SELECT (a new statement, so a new snapshot) sees
// the committed row. Returns the row and whether this call created it.
async function insertOrSelect<Row extends object>(
  client: RuntimeClient,
  insertSql: string,
  selectSql: string,
  params: unknown[],
  selectParams: unknown[],
  what: string,
): Promise<{ row: Row; created: boolean }> {
  const inserted = await client.query<Row>(insertSql, params);
  if (inserted.rows.length === 1) {
    return { row: inserted.rows[0]!, created: true };
  }

  const selected = await client.query<Row>(selectSql, selectParams);
  if (selected.rows.length !== 1) {
    throw invariant(`Expected exactly one ${what} after an insert conflict.`);
  }
  return { row: selected.rows[0]!, created: false };
}

async function resolveUser(client: RuntimeClient, identity: VerifiedIdentity): Promise<{ row: UserRow; created: boolean }> {
  const result = await insertOrSelect<UserRow>(
    client,
    `INSERT INTO users (idp_issuer, idp_subject, email, email_verified)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (idp_issuer, idp_subject) DO NOTHING
     RETURNING ${USER_COLUMNS}`,
    `SELECT ${USER_COLUMNS} FROM users WHERE idp_issuer = $1 AND idp_subject = $2`,
    [identity.issuer, identity.subject, identity.email?.address ?? null, identity.email?.verified ?? false],
    [identity.issuer, identity.subject],
    "user",
  );

  if (result.row.idp_issuer !== identity.issuer || result.row.idp_subject !== identity.subject) {
    throw invariant("Resolved user does not match the requested identity.");
  }
  if (result.row.status === "DISABLED") {
    throw new ProvisioningError("PROVISIONING_REFUSED", "This identity cannot be provisioned.", { reason: "USER_DISABLED" });
  }

  // Refresh the non-authoritative email attributes from a verified claim.
  // An absent claim never erases a stored email; an unchanged claim writes nothing.
  if (
    !result.created &&
    identity.email !== undefined &&
    (result.row.email !== identity.email.address || result.row.email_verified !== identity.email.verified)
  ) {
    const updated = await client.query<UserRow>(
      `UPDATE users SET email = $2, email_verified = $3, updated_at = now()
        WHERE id = $1
        RETURNING ${USER_COLUMNS}`,
      [result.row.id, identity.email.address, identity.email.verified],
    );
    if (updated.rows.length !== 1) {
      throw invariant("Resolved user disappeared during provisioning.");
    }
    return { row: updated.rows[0]!, created: false };
  }

  return result;
}

async function resolvePersonalAccount(client: RuntimeClient, userId: string): Promise<{ row: AccountRow; created: boolean }> {
  const result = await insertOrSelect<AccountRow>(
    client,
    `INSERT INTO accounts (kind, owner_user_id)
     VALUES ('PERSONAL', $1)
     ON CONFLICT (owner_user_id) WHERE kind = 'PERSONAL' DO NOTHING
     RETURNING ${ACCOUNT_COLUMNS}`,
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE owner_user_id = $1 AND kind = 'PERSONAL'`,
    [userId],
    [userId],
    "PERSONAL account",
  );

  if (result.row.kind !== "PERSONAL" || result.row.owner_user_id !== userId) {
    throw invariant("Resolved account is not this user's PERSONAL account.");
  }
  if (result.row.status === "DISABLED") {
    throw new ProvisioningError("PROVISIONING_REFUSED", "This identity cannot be provisioned.", { reason: "ACCOUNT_DISABLED" });
  }

  return result;
}

// The arbiter is the account-level partial unique index, not the issuance
// key, so an existing account-provisioned FREE_BYO grant in any state is
// returned unchanged: provisioning never re-issues or reactivates a grant.
async function resolveInitialFreeByoGrant(client: RuntimeClient, accountId: string): Promise<{ row: GrantRow; created: boolean }> {
  const result = await insertOrSelect<GrantRow>(
    client,
    `INSERT INTO entitlement_grants (account_id, kind, state, source, issuance_key, policy_version)
     VALUES ($1, 'FREE_BYO', 'AVAILABLE', 'ACCOUNT_PROVISIONING', $2, $3)
     ON CONFLICT (account_id) WHERE kind = 'FREE_BYO' AND source = 'ACCOUNT_PROVISIONING' DO NOTHING
     RETURNING ${GRANT_COLUMNS}`,
    `SELECT ${GRANT_COLUMNS} FROM entitlement_grants
      WHERE account_id = $1 AND kind = 'FREE_BYO' AND source = 'ACCOUNT_PROVISIONING'`,
    [accountId, FREE_BYO_ISSUANCE_KEY, FREE_BYO_POLICY_VERSION],
    [accountId],
    "initial FREE_BYO grant",
  );

  if (result.row.account_id !== accountId || result.row.kind !== "FREE_BYO" || result.row.source !== "ACCOUNT_PROVISIONING") {
    throw invariant("Resolved grant is not this account's initial FREE_BYO grant.");
  }

  return result;
}

const INSERT_AUDIT_EVENT = `
INSERT INTO audit_events (account_id, actor_type, actor_user_id, event_type, resource_type, resource_id, correlation_id, metadata)
VALUES ($1, 'USER', $2, $3, $4, $5, $6, $7::jsonb)`;

// One event per record this transaction actually created, sharing one
// correlation ID. Metadata holds no email or identity values.
async function writeCreationAuditEvents(
  client: RuntimeClient,
  user: UserRow,
  account: { row: AccountRow; created: boolean },
  grant: { row: GrantRow; created: boolean },
  userCreated: boolean,
  correlationId: string,
): Promise<void> {
  const events: [string, string, string, Record<string, string>][] = [];
  if (userCreated) {
    events.push(["user.provisioned", "user", user.id, {}]);
  }
  if (account.created) {
    events.push(["account.provisioned", "account", account.row.id, { kind: "PERSONAL" }]);
  }
  if (grant.created) {
    events.push([
      "entitlement_grant.issued",
      "entitlement_grant",
      grant.row.id,
      { kind: "FREE_BYO", source: "ACCOUNT_PROVISIONING", policyVersion: grant.row.policy_version },
    ]);
  }

  for (const [eventType, resourceType, resourceId, metadata] of events) {
    await client.query(INSERT_AUDIT_EVENT, [
      account.row.id,
      user.id,
      eventType,
      resourceType,
      resourceId,
      correlationId,
      JSON.stringify(metadata),
    ]);
  }
}

function databaseFailure(error: unknown): ProvisioningError {
  const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
  return new ProvisioningError("PROVISIONING_DATABASE_FAILURE", "Provisioning could not be completed.", {
    cause: error,
    ...(code === undefined ? {} : { databaseCode: code }),
  });
}

// Provisions, or recovers, exactly one User for a verified identity, that
// User's PERSONAL Account and the Account's account-provisioned FREE_BYO
// grant, in one READ COMMITTED transaction on one dedicated client. Completes
// legitimately partial state, never deletes or recreates records, and relies
// on the schema's unique constraints (not process-local locking) so
// concurrent calls from any number of processes converge on the same rows.
export async function provisionPersonalAccountForIdentity(
  pool: TransactionalPool,
  identityInput: VerifiedIdentity,
  options: ProvisionOptions = {},
): Promise<ProvisioningResult> {
  const identity = validateVerifiedIdentity(identityInput);
  const correlationId = options.correlationId ?? randomUUID();
  if (!UUID_PATTERN.test(correlationId)) {
    throw new ProvisioningError("PROVISIONING_INPUT_INVALID", "correlationId must be a UUID.");
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

    const user = await resolveUser(client, identity);
    const account = await resolvePersonalAccount(client, user.row.id);
    const grant = await resolveInitialFreeByoGrant(client, account.row.id);
    await writeCreationAuditEvents(client, user.row, account, grant, user.created, correlationId);

    await client.query("COMMIT");

    return Object.freeze({
      user: Object.freeze({
        id: user.row.id,
        idpIssuer: user.row.idp_issuer,
        idpSubject: user.row.idp_subject,
        email: user.row.email,
        emailVerified: user.row.email_verified,
        status: user.row.status,
        createdAt: user.row.created_at,
        updatedAt: user.row.updated_at,
      }),
      personalAccount: Object.freeze({
        id: account.row.id,
        kind: "PERSONAL" as const,
        ownerUserId: account.row.owner_user_id,
        status: account.row.status,
        createdAt: account.row.created_at,
        updatedAt: account.row.updated_at,
      }),
      freeByoEntitlementGrant: Object.freeze({
        id: grant.row.id,
        accountId: grant.row.account_id,
        kind: "FREE_BYO" as const,
        state: grant.row.state,
        source: "ACCOUNT_PROVISIONING" as const,
        policyVersion: grant.row.policy_version,
        issuedAt: grant.row.issued_at,
      }),
      created: Object.freeze({ user: user.created, personalAccount: account.created, freeByoEntitlementGrant: grant.created }),
      correlationId,
    });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      // The session state is unknown; never return it to the pool. The
      // primary error below is preserved.
      destroyConnection = rollbackError instanceof Error ? rollbackError : new Error("rollback failed");
    }
    throw error instanceof ProvisioningError ? error : databaseFailure(error);
  } finally {
    client.release(destroyConnection);
  }
}
