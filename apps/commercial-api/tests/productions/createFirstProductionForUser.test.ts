import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { resolveFreeByoPolicy } from "../../src/entitlements/freeByoPolicy.js";
import { createFirstProductionForUser, type CreateFirstProductionInput } from "../../src/productions/createFirstProductionForUser.js";
import { ProductionCreationError } from "../../src/productions/productionCreationError.js";
import { FREE_BYO_POLICY_VERSION } from "../../src/provisioning/provisionPersonalAccountForIdentity.js";
import { createFakeProductionDatabase } from "./fakeProductionDatabase.js";

async function expectCode(promise: Promise<unknown>, code: string, extra: Record<string, unknown> = {}) {
  await expect(promise).rejects.toBeInstanceOf(ProductionCreationError);
  await expect(promise).rejects.toMatchObject({ code, ...extra });
}

describe("free-byo policy resolution", () => {
  it("free-byo-v1 permits exactly one production", () => {
    expect(resolveFreeByoPolicy("free-byo-v1")).toEqual({ version: "free-byo-v1", maxProductions: 1 });
  });

  it("supports the policy version that provisioning issues", () => {
    expect(resolveFreeByoPolicy(FREE_BYO_POLICY_VERSION)).not.toBeNull();
  });

  it.each(["free-byo-v2", "FREE-BYO-V1", "free-byo-v1 ", "", "free-byo:provisional-v0"])("does not resolve unknown version %j", (version) => {
    expect(resolveFreeByoPolicy(version)).toBeNull();
  });
});

describe("createFirstProductionForUser", () => {
  it("creates the production under the account's FREE_BYO grant in one transaction on one client", async () => {
    const db = createFakeProductionDatabase();
    const { user, account, grant } = db.seedAccount();
    const correlationId = randomUUID();

    const result = await createFirstProductionForUser(db.pool, { userId: user.id, title: "My first story", idempotencyKey: "req-1" }, { correlationId });

    expect(result.created).toBe(true);
    expect(result.production).toMatchObject({
      accountId: account.id,
      title: "My first story",
      creationEntitlementGrantId: grant!.id,
      createdByUserId: user.id,
      creationIdempotencyKey: "req-1",
      archivedAt: null,
    });
    expect(db.connects()).toBe(1);
    expect(db.statements[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED");
    expect(db.statements.at(-1)).toBe("COMMIT");
    expect(db.releases).toEqual([undefined]);
    expect(db.statements.find((sql) => sql.includes("FROM entitlement_grants"))).toMatch(
      /WHERE account_id = \$1 AND kind = 'FREE_BYO' AND state = 'AVAILABLE' ORDER BY issued_at, id LIMIT 1 FOR UPDATE$/,
    );
  });

  it("writes exactly one production.created audit event with only grant and policy metadata", async () => {
    const db = createFakeProductionDatabase();
    const { user, account, grant } = db.seedAccount();
    const correlationId = randomUUID();

    const result = await createFirstProductionForUser(db.pool, { userId: user.id, title: "Private title" }, { correlationId });

    expect(db.tables().audits).toEqual([
      {
        account_id: account.id,
        actor_user_id: user.id,
        event_type: "production.created",
        resource_type: "production",
        resource_id: result.production.id,
        correlation_id: correlationId,
        metadata: { grantId: grant!.id, policyVersion: "free-byo-v1" },
      },
    ]);
    expect(JSON.stringify(db.tables().audits)).not.toContain("Private title");
    expect(db.statements.find((sql) => sql.startsWith("INSERT INTO audit_events"))).toContain("'USER'");
  });

  it("never changes the grant", async () => {
    const db = createFakeProductionDatabase();
    const { user, grant } = db.seedAccount();
    const before = { ...grant! };

    await createFirstProductionForUser(db.pool, { userId: user.id, title: "First" });

    expect(db.tables().grants[0]).toEqual(before);
    expect(db.statements.some((sql) => sql.startsWith("UPDATE"))).toBe(false);
  });

  it("refuses a second production under free-byo-v1, archived or not", async () => {
    const db = createFakeProductionDatabase();
    const { user } = db.seedAccount();
    await createFirstProductionForUser(db.pool, { userId: user.id, title: "First" });
    db.tables().productions[0]!.archived_at = new Date();

    await expectCode(createFirstProductionForUser(db.pool, { userId: user.id, title: "Second" }), "ENTITLEMENT_NOT_AVAILABLE");
    expect(db.tables().productions).toHaveLength(1);
    expect(db.tables().audits).toHaveLength(1);
  });

  describe("idempotency", () => {
    it("returns the existing production for a repeated key without a new audit event, even after the limit is reached", async () => {
      const db = createFakeProductionDatabase();
      const { user } = db.seedAccount();
      const first = await createFirstProductionForUser(db.pool, { userId: user.id, title: "First", idempotencyKey: "req-1" });
      const statementsBefore = db.statements.length;

      const again = await createFirstProductionForUser(db.pool, { userId: user.id, title: "First", idempotencyKey: "req-1" });

      expect(again.created).toBe(false);
      expect(again.production.id).toBe(first.production.id);
      expect(db.tables().audits).toHaveLength(1);
      // The fast path replays before touching the grant or counting.
      const replayStatements = db.statements.slice(statementsBefore);
      expect(replayStatements.some((sql) => sql.includes("FROM entitlement_grants") || sql.startsWith("SELECT count"))).toBe(false);
    });

    it("treats the same key with a different title as a conflict", async () => {
      const db = createFakeProductionDatabase();
      const { user } = db.seedAccount();
      await createFirstProductionForUser(db.pool, { userId: user.id, title: "First", idempotencyKey: "req-1" });

      await expectCode(createFirstProductionForUser(db.pool, { userId: user.id, title: "Different", idempotencyKey: "req-1" }), "IDEMPOTENCY_KEY_CONFLICT");
      expect(db.tables().productions).toHaveLength(1);
    });

    it("re-checks the key after acquiring the grant lock and replays a concurrent winner", async () => {
      let injected = false;
      const db = createFakeProductionDatabase({
        // Simulates a concurrent same-key transaction committing while this one waited for the grant lock.
        beforeStatement: (text, tables) => {
          if (!injected && text.includes("FOR UPDATE")) {
            injected = true;
            const account = tables.accounts[0]!;
            tables.productions.push({
              id: "11111111-1111-4111-8111-111111111111",
              account_id: account.id,
              title: "Shared",
              creation_entitlement_grant_id: tables.grants[0]!.id,
              created_by_user_id: account.owner_user_id,
              creation_idempotency_key: "req-race",
              archived_at: null,
              created_at: new Date(),
              updated_at: new Date(),
            });
          }
        },
      });
      const { user } = db.seedAccount();

      const result = await createFirstProductionForUser(db.pool, { userId: user.id, title: "Shared", idempotencyKey: "req-race" });

      expect(result).toMatchObject({ created: false, production: { id: "11111111-1111-4111-8111-111111111111" } });
      expect(db.statements.some((sql) => sql.startsWith("SELECT count"))).toBe(false);
      expect(db.tables().audits).toHaveLength(0);
    });

    it("scopes keys to the account", async () => {
      const db = createFakeProductionDatabase();
      const a = db.seedAccount();
      const b = db.seedAccount();

      const first = await createFirstProductionForUser(db.pool, { userId: a.user.id, title: "Same", idempotencyKey: "shared-key" });
      const second = await createFirstProductionForUser(db.pool, { userId: b.user.id, title: "Same", idempotencyKey: "shared-key" });

      expect(second.created).toBe(true);
      expect(second.production.id).not.toBe(first.production.id);
      expect(second.production.accountId).toBe(b.account.id);
    });
  });

  describe("entitlement and account refusals", () => {
    it.each(["RESERVED", "CONSUMED", "REVOKED", "EXPIRED"])("refuses when the only grant is %s", async (state) => {
      const db = createFakeProductionDatabase();
      const { user } = db.seedAccount({ grant: { state } });
      await expectCode(createFirstProductionForUser(db.pool, { userId: user.id, title: "T" }), "ENTITLEMENT_NOT_AVAILABLE");
      expect(db.tables().productions).toHaveLength(0);
      expect(db.tables().grants[0]!.state).toBe(state);
    });

    it("refuses when the account has no grant", async () => {
      const db = createFakeProductionDatabase();
      const { user } = db.seedAccount({ grant: null });
      await expectCode(createFirstProductionForUser(db.pool, { userId: user.id, title: "T" }), "ENTITLEMENT_NOT_AVAILABLE");
    });

    it("fails closed on an unknown policy version", async () => {
      const db = createFakeProductionDatabase();
      const { user } = db.seedAccount({ grant: { policy_version: "free-byo-v99" } });
      await expectCode(createFirstProductionForUser(db.pool, { userId: user.id, title: "T" }), "ENTITLEMENT_POLICY_UNSUPPORTED");
      expect(db.tables().productions).toHaveLength(0);
      expect(db.statements.some((sql) => sql.startsWith("SELECT count"))).toBe(false);
    });

    it.each([
      ["USER_NOT_FOUND", () => ({ userId: randomUUID() }), {}],
      ["USER_DISABLED", null, { userStatus: "DISABLED" as const }],
      ["ACCOUNT_DISABLED", null, { accountStatus: "DISABLED" as const }],
    ])("refuses with %s and creates nothing", async (reason, userOverride, seed) => {
      const db = createFakeProductionDatabase();
      const { user } = db.seedAccount(seed);
      const userId = userOverride === null ? user.id : userOverride().userId;

      await expectCode(createFirstProductionForUser(db.pool, { userId, title: "T" }), "PRODUCTION_ACCOUNT_UNAVAILABLE", { reason });
      expect(db.tables().productions).toHaveLength(0);
      expect(db.tables().audits).toHaveLength(0);
    });

    it("refuses a user without a PERSONAL account and never creates one", async () => {
      const db = createFakeProductionDatabase();
      const { user } = db.seedAccount();
      db.tables().accounts.length = 0;

      await expectCode(createFirstProductionForUser(db.pool, { userId: user.id, title: "T" }), "PRODUCTION_ACCOUNT_UNAVAILABLE", { reason: "ACCOUNT_NOT_FOUND" });
      expect(db.statements.some((sql) => sql.startsWith("INSERT INTO accounts"))).toBe(false);
    });
  });

  describe("input validation (before any SQL)", () => {
    const userId = randomUUID();

    it.each([
      ["a caller-chosen account", { userId, title: "T", accountId: randomUUID() }],
      ["a caller-chosen grant", { userId, title: "T", creationEntitlementGrantId: randomUUID() }],
      ["a caller-chosen grant id", { userId, title: "T", grantId: randomUUID() }],
      ["an entitlement kind", { userId, title: "T", kind: "FREE_BYO" }],
      ["an entitlement state", { userId, title: "T", state: "AVAILABLE" }],
      ["a policy version", { userId, title: "T", policyVersion: "free-byo-v1" }],
      ["an account owner", { userId, title: "T", ownerUserId: randomUUID() }],
      ["an archived state", { userId, title: "T", archivedAt: new Date() }],
      ["an audit actor", { userId, title: "T", actorUserId: randomUUID() }],
      ["audit metadata", { userId, title: "T", metadata: {} }],
      ["a missing user", { title: "T" }],
      ["a non-UUID user", { userId: "user-1", title: "T" }],
      ["a missing title", { userId }],
      ["an empty title", { userId, title: "" }],
      ["a whitespace-only title", { userId, title: "   " }],
      ["a leading space", { userId, title: " Leading" }],
      ["a trailing space", { userId, title: "Trailing " }],
      ["a trailing tab", { userId, title: "Trailing\t" }],
      ["a leading newline", { userId, title: "\nLeading" }],
      ["a 201-character title", { userId, title: "x".repeat(201) }],
      ["a non-string title", { userId, title: 7 }],
      ["an empty idempotency key", { userId, title: "T", idempotencyKey: "" }],
      ["a 129-character idempotency key", { userId, title: "T", idempotencyKey: "k".repeat(129) }],
      ["a non-string idempotency key", { userId, title: "T", idempotencyKey: 1 }],
      ["a non-object input", "title"],
    ])("rejects %s", async (_label, input) => {
      const db = createFakeProductionDatabase();
      await expectCode(createFirstProductionForUser(db.pool, input as unknown as CreateFirstProductionInput), "PRODUCTION_INPUT_INVALID");
      expect(db.connects()).toBe(0);
    });

    it.each([
      ["a 1-character title", "x"],
      ["a 200-character title", "x".repeat(200)],
      ["inner whitespace", "Two  words\tand more"],
      ["a 200-code-point title of astral characters", "😀".repeat(200)],
    ])("accepts %s unchanged", async (_label, title) => {
      const db = createFakeProductionDatabase();
      const { user } = db.seedAccount();
      const result = await createFirstProductionForUser(db.pool, { userId: user.id, title, idempotencyKey: "k".repeat(128) });
      expect(result.production.title).toBe(title);
    });

    it("rejects a malformed correlation ID", async () => {
      const db = createFakeProductionDatabase();
      await expectCode(createFirstProductionForUser(db.pool, { userId, title: "T" }, { correlationId: "req" }), "PRODUCTION_INPUT_INVALID");
      expect(db.connects()).toBe(0);
    });
  });

  describe("failure handling", () => {
    it("rolls back the production when the audit insert fails, and releases the client", async () => {
      const db = createFakeProductionDatabase({ failOn: { sqlStartsWith: "INSERT INTO audit_events" } });
      const { user } = db.seedAccount();

      await expectCode(createFirstProductionForUser(db.pool, { userId: user.id, title: "T" }), "PRODUCTION_DATABASE_FAILURE", { databaseCode: "XX000" });
      expect(db.statements).toContain("ROLLBACK");
      expect(db.statements).not.toContain("COMMIT");
      expect(db.tables().productions).toHaveLength(0);
      expect(db.releases).toEqual([undefined]);
    });

    it("preserves the primary error and destroys the connection when rollback fails", async () => {
      const primary = Object.assign(new Error("deadlock detected"), { code: "40P01" });
      const db = createFakeProductionDatabase({ failOn: { sqlStartsWith: "INSERT INTO productions", error: primary }, failRollback: true });
      const { user } = db.seedAccount();

      await expectCode(createFirstProductionForUser(db.pool, { userId: user.id, title: "T" }), "PRODUCTION_DATABASE_FAILURE", { databaseCode: "40P01", cause: primary });
      expect(db.releases).toHaveLength(1);
      expect(db.releases[0]).toMatchObject({ code: "57P01" });
    });

    it("releases the client after a domain refusal", async () => {
      const db = createFakeProductionDatabase();
      const { user } = db.seedAccount({ grant: null });
      await expect(createFirstProductionForUser(db.pool, { userId: user.id, title: "T" })).rejects.toBeInstanceOf(ProductionCreationError);
      expect(db.statements.at(-1)).toBe("ROLLBACK");
      expect(db.releases).toEqual([undefined]);
    });

    it("never uses Pool.query", async () => {
      const db = createFakeProductionDatabase();
      const { user } = db.seedAccount();
      await expect(createFirstProductionForUser(db.pool, { userId: user.id, title: "T" })).resolves.toBeDefined();
    });
  });
});
