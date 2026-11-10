import { randomUUID } from "node:crypto";

import type { RuntimeClient, TransactionalPool } from "../../src/database/runtimePool.js";

// In-memory stand-in for the four tables the provisioning service touches.
// It understands only the statements that service issues, applies the same
// unique keys, and restores a snapshot on ROLLBACK. Real conflict and
// isolation behaviour is proven against PostgreSQL in tests/db.

type User = { id: string; idp_issuer: string; idp_subject: string; email: string | null; email_verified: boolean; status: "ACTIVE" | "DISABLED"; created_at: Date; updated_at: Date };
type Account = { id: string; kind: string; owner_user_id: string; status: "ACTIVE" | "DISABLED"; created_at: Date; updated_at: Date };
type Grant = { id: string; account_id: string; kind: string; state: string; source: string; issuance_key: string; policy_version: string; issued_at: Date };
type Audit = { account_id: string; actor_type: string; actor_user_id: string; event_type: string; resource_type: string; resource_id: string; correlation_id: string; metadata: unknown };

export type Tables = { users: User[]; accounts: Account[]; grants: Grant[]; audits: Audit[] };

export type FakeOptions = {
  // Throws (with a PostgreSQL-like code) when a statement starting with this text runs.
  failOn?: { sqlStartsWith: string; error?: Error; occurrence?: number };
  failRollback?: boolean;
};

export function createFakeDatabase(options: FakeOptions = {}) {
  let tables: Tables = { users: [], accounts: [], grants: [], audits: [] };
  const statements: string[] = [];
  const releases: (Error | undefined)[] = [];
  let connects = 0;
  let failOnSeen = 0;

  const clone = (value: Tables): Tables => ({
    users: value.users.map((row) => ({ ...row })),
    accounts: value.accounts.map((row) => ({ ...row })),
    grants: value.grants.map((row) => ({ ...row })),
    audits: value.audits.map((row) => ({ ...row })),
  });

  async function execute(sql: string, params: unknown[] = []): Promise<{ rows: object[] }> {
    const text = sql.trim().replace(/\s+/g, " ");
    statements.push(text);

    if (options.failOn !== undefined && text.startsWith(options.failOn.sqlStartsWith)) {
      failOnSeen += 1;
      if (failOnSeen === (options.failOn.occurrence ?? 1)) {
        throw options.failOn.error ?? Object.assign(new Error("simulated failure"), { code: "XX000" });
      }
    }

    if (text.startsWith("INSERT INTO users")) {
      const [issuer, subject, email, verified] = params as [string, string, string | null, boolean];
      if (tables.users.some((row) => row.idp_issuer === issuer && row.idp_subject === subject)) return { rows: [] };
      const now = new Date();
      const row: User = { id: randomUUID(), idp_issuer: issuer, idp_subject: subject, email, email_verified: verified, status: "ACTIVE", created_at: now, updated_at: now };
      tables.users.push(row);
      return { rows: [{ ...row }] };
    }
    if (text.startsWith("SELECT id, idp_issuer")) {
      const [issuer, subject] = params as [string, string];
      return { rows: tables.users.filter((row) => row.idp_issuer === issuer && row.idp_subject === subject).map((row) => ({ ...row })) };
    }
    if (text.startsWith("UPDATE users SET email")) {
      const [id, email, verified] = params as [string, string, boolean];
      const row = tables.users.find((candidate) => candidate.id === id);
      if (!row) return { rows: [] };
      Object.assign(row, { email, email_verified: verified, updated_at: new Date() });
      return { rows: [{ ...row }] };
    }
    if (text.startsWith("INSERT INTO accounts")) {
      const [owner] = params as [string];
      if (tables.accounts.some((row) => row.owner_user_id === owner && row.kind === "PERSONAL")) return { rows: [] };
      const now = new Date();
      const row: Account = { id: randomUUID(), kind: "PERSONAL", owner_user_id: owner, status: "ACTIVE", created_at: now, updated_at: now };
      tables.accounts.push(row);
      return { rows: [{ ...row }] };
    }
    if (text.startsWith("SELECT id, kind, owner_user_id")) {
      const [owner] = params as [string];
      return { rows: tables.accounts.filter((row) => row.owner_user_id === owner && row.kind === "PERSONAL").map((row) => ({ ...row })) };
    }
    if (text.startsWith("INSERT INTO entitlement_grants")) {
      const [accountId, issuanceKey, policyVersion] = params as [string, string, string];
      if (tables.grants.some((row) => row.account_id === accountId && row.kind === "FREE_BYO" && row.source === "ACCOUNT_PROVISIONING")) return { rows: [] };
      const row: Grant = { id: randomUUID(), account_id: accountId, kind: "FREE_BYO", state: "AVAILABLE", source: "ACCOUNT_PROVISIONING", issuance_key: issuanceKey, policy_version: policyVersion, issued_at: new Date() };
      tables.grants.push(row);
      return { rows: [{ ...row }] };
    }
    if (text.startsWith("SELECT id, account_id, kind")) {
      const [accountId] = params as [string];
      return {
        rows: tables.grants
          .filter((row) => row.account_id === accountId && row.kind === "FREE_BYO" && row.source === "ACCOUNT_PROVISIONING")
          .map((row) => ({ ...row })),
      };
    }
    if (text.startsWith("INSERT INTO audit_events")) {
      const [accountId, actorUserId, eventType, resourceType, resourceId, correlationId, metadata] = params as string[];
      tables.audits.push({
        account_id: accountId!,
        actor_type: "USER",
        actor_user_id: actorUserId!,
        event_type: eventType!,
        resource_type: resourceType!,
        resource_id: resourceId!,
        correlation_id: correlationId!,
        metadata: JSON.parse(metadata!),
      });
      return { rows: [] };
    }
    if (text === "COMMIT") return { rows: [] };
    throw new Error(`fake database does not understand: ${text}`);
  }

  const pool: TransactionalPool = {
    query: async () => {
      throw new Error("provisioning must not use Pool.query outside a dedicated client");
    },
    end: async () => {},
    connect: async () => {
      connects += 1;
      let snapshot: Tables | undefined;
      const client: RuntimeClient = {
        query: async <Row extends object>(sql: string, params?: unknown[]) => {
          if (sql.startsWith("BEGIN")) {
            statements.push(sql);
            snapshot = clone(tables);
            return { rows: [] as Row[] };
          }
          if (sql === "ROLLBACK") {
            statements.push(sql);
            if (options.failRollback) throw Object.assign(new Error("Connection terminated"), { code: "57P01" });
            if (snapshot) tables = snapshot;
            return { rows: [] as Row[] };
          }
          return (await execute(sql, params)) as { rows: Row[] };
        },
        release: (error?: Error) => {
          releases.push(error);
        },
      };
      return client;
    },
  };

  return {
    pool,
    statements,
    releases,
    connects: () => connects,
    tables: () => tables,
    seed: (mutate: (current: Tables) => void) => mutate(tables),
  };
}
