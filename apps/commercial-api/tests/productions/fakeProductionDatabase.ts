import { randomUUID } from "node:crypto";

import type { RuntimeClient, TransactionalPool } from "../../src/database/runtimePool.js";

// In-memory stand-in for the statements createFirstProductionForUser issues.
// Applies the per-account idempotency key uniqueness and restores a snapshot
// on ROLLBACK. Real locking and conflict behaviour is proven against
// PostgreSQL in tests/db/productions.test.ts.

export type FakeUser = { id: string; status: "ACTIVE" | "DISABLED" };
export type FakeAccount = { id: string; owner_user_id: string; kind: "PERSONAL"; status: "ACTIVE" | "DISABLED" };
export type FakeGrant = { id: string; account_id: string; kind: string; state: string; policy_version: string; issued_at: Date; updated_at: Date };
export type FakeProduction = {
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
export type FakeAudit = { account_id: string; actor_user_id: string; event_type: string; resource_type: string; resource_id: string; correlation_id: string; metadata: Record<string, unknown> };

export type Tables = { users: FakeUser[]; accounts: FakeAccount[]; grants: FakeGrant[]; productions: FakeProduction[]; audits: FakeAudit[] };

export type FakeOptions = {
  failOn?: { sqlStartsWith: string; error?: Error };
  failRollback?: boolean;
  // Runs before a statement executes, e.g. to simulate a concurrent commit.
  beforeStatement?: (text: string, tables: Tables) => void;
};

const clone = (tables: Tables): Tables => ({
  users: tables.users.map((row) => ({ ...row })),
  accounts: tables.accounts.map((row) => ({ ...row })),
  grants: tables.grants.map((row) => ({ ...row })),
  productions: tables.productions.map((row) => ({ ...row })),
  audits: tables.audits.map((row) => ({ ...row })),
});

export function createFakeProductionDatabase(options: FakeOptions = {}) {
  let tables: Tables = { users: [], accounts: [], grants: [], productions: [], audits: [] };
  const statements: string[] = [];
  const releases: (Error | undefined)[] = [];
  let connects = 0;

  function execute(text: string, params: unknown[]): { rows: object[] } {
    if (text.startsWith("SELECT status FROM users")) {
      return { rows: tables.users.filter((row) => row.id === params[0]).map((row) => ({ status: row.status })) };
    }
    if (text.startsWith("SELECT id, status FROM accounts")) {
      return {
        rows: tables.accounts
          .filter((row) => row.owner_user_id === params[0] && row.kind === "PERSONAL")
          .map((row) => ({ id: row.id, status: row.status })),
      };
    }
    if (text.startsWith("SELECT id, account_id, title")) {
      return { rows: tables.productions.filter((row) => row.account_id === params[0] && row.creation_idempotency_key === params[1]).map((row) => ({ ...row })) };
    }
    if (text.startsWith("SELECT id, account_id, policy_version FROM entitlement_grants")) {
      const grant = tables.grants
        .filter((row) => row.account_id === params[0] && row.kind === "FREE_BYO" && row.state === "AVAILABLE")
        .sort((a, b) => a.issued_at.getTime() - b.issued_at.getTime())[0];
      return { rows: grant === undefined ? [] : [{ id: grant.id, account_id: grant.account_id, policy_version: grant.policy_version }] };
    }
    if (text.startsWith("SELECT count(*)::int AS count FROM productions")) {
      return { rows: [{ count: tables.productions.filter((row) => row.account_id === params[0] && row.creation_entitlement_grant_id === params[1]).length }] };
    }
    if (text.startsWith("INSERT INTO productions")) {
      const [accountId, title, grantId, userId, key] = params as [string, string, string, string, string | null];
      if (key !== null && tables.productions.some((row) => row.account_id === accountId && row.creation_idempotency_key === key)) {
        return { rows: [] };
      }
      const now = new Date();
      const row: FakeProduction = {
        id: randomUUID(),
        account_id: accountId,
        title,
        creation_entitlement_grant_id: grantId,
        created_by_user_id: userId,
        creation_idempotency_key: key,
        archived_at: null,
        created_at: now,
        updated_at: now,
      };
      tables.productions.push(row);
      return { rows: [{ ...row }] };
    }
    if (text.startsWith("INSERT INTO audit_events")) {
      const [accountId, actorUserId, resourceId, correlationId, metadata] = params as string[];
      tables.audits.push({
        account_id: accountId!,
        actor_user_id: actorUserId!,
        event_type: "production.created",
        resource_type: "production",
        resource_id: resourceId!,
        correlation_id: correlationId!,
        metadata: JSON.parse(metadata!) as Record<string, unknown>,
      });
      return { rows: [] };
    }
    if (text === "COMMIT") return { rows: [] };
    throw new Error(`fake database does not understand: ${text}`);
  }

  const pool: TransactionalPool = {
    query: async () => {
      throw new Error("production creation must not use Pool.query outside a dedicated client");
    },
    end: async () => {},
    connect: async () => {
      connects += 1;
      let snapshot: Tables | undefined;
      const client: RuntimeClient = {
        query: async <Row extends object>(sql: string, params: unknown[] = []) => {
          const text = sql.trim().replace(/\s+/g, " ");
          statements.push(text);
          if (text.startsWith("BEGIN")) {
            snapshot = clone(tables);
            return { rows: [] as Row[] };
          }
          if (text === "ROLLBACK") {
            if (options.failRollback) throw Object.assign(new Error("Connection terminated"), { code: "57P01" });
            if (snapshot) tables = snapshot;
            return { rows: [] as Row[] };
          }
          options.beforeStatement?.(text, tables);
          if (options.failOn !== undefined && text.startsWith(options.failOn.sqlStartsWith)) {
            throw options.failOn.error ?? Object.assign(new Error("simulated failure"), { code: "XX000" });
          }
          return execute(text, params) as { rows: Row[] };
        },
        release: (error?: Error) => {
          releases.push(error);
        },
      };
      return client;
    },
  };

  // A provisioned user with a PERSONAL account and an AVAILABLE FREE_BYO grant.
  const seedAccount = (overrides: { userStatus?: FakeUser["status"]; accountStatus?: FakeAccount["status"]; grant?: Partial<FakeGrant> | null } = {}) => {
    const user: FakeUser = { id: randomUUID(), status: overrides.userStatus ?? "ACTIVE" };
    const account: FakeAccount = { id: randomUUID(), owner_user_id: user.id, kind: "PERSONAL", status: overrides.accountStatus ?? "ACTIVE" };
    tables.users.push(user);
    tables.accounts.push(account);
    let grant: FakeGrant | null = null;
    if (overrides.grant !== null) {
      const issued = new Date(Date.now() - 60_000);
      grant = { id: randomUUID(), account_id: account.id, kind: "FREE_BYO", state: "AVAILABLE", policy_version: "free-byo-v1", issued_at: issued, updated_at: issued, ...overrides.grant };
      tables.grants.push(grant);
    }
    return { user, account, grant };
  };

  return { pool, statements, releases, connects: () => connects, tables: () => tables, seedAccount };
}
