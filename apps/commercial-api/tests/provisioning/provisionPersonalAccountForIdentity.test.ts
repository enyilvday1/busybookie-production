import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { ProvisioningError } from "../../src/provisioning/provisioningError.js";
import {
  FREE_BYO_ISSUANCE_KEY,
  FREE_BYO_POLICY_VERSION,
  provisionPersonalAccountForIdentity,
  type VerifiedIdentity,
} from "../../src/provisioning/provisionPersonalAccountForIdentity.js";
import { createFakeDatabase } from "./fakeProvisioningDatabase.js";

const ISSUER = "https://issuer.example.test/";
const identity = (subject: string, email?: VerifiedIdentity["email"]): VerifiedIdentity =>
  email === undefined ? { issuer: ISSUER, subject } : { issuer: ISSUER, subject, email };

async function expectProvisioningError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ProvisioningError);
  await expect(promise).rejects.toMatchObject({ code });
}

describe("locked provisioning policy values", () => {
  it("issues the initial FREE_BYO grant under policy free-byo-v1 with issuance key account-provisioning", () => {
    expect(FREE_BYO_POLICY_VERSION).toBe("free-byo-v1");
    expect(FREE_BYO_ISSUANCE_KEY).toBe("account-provisioning");
  });
});

describe("provisionPersonalAccountForIdentity", () => {
  it("provisions a user, PERSONAL account and initial FREE_BYO grant for a new identity", async () => {
    const db = createFakeDatabase();

    const result = await provisionPersonalAccountForIdentity(db.pool, identity("subject-1", { address: "a@example.test", verified: true }));

    expect(result.created).toEqual({ user: true, personalAccount: true, freeByoEntitlementGrant: true });
    expect(result.user).toMatchObject({ idpIssuer: ISSUER, idpSubject: "subject-1", email: "a@example.test", emailVerified: true, status: "ACTIVE" });
    expect(result.personalAccount).toMatchObject({ kind: "PERSONAL", ownerUserId: result.user.id, status: "ACTIVE" });
    expect(result.freeByoEntitlementGrant).toMatchObject({
      accountId: result.personalAccount.id,
      kind: "FREE_BYO",
      state: "AVAILABLE",
      source: "ACCOUNT_PROVISIONING",
      policyVersion: FREE_BYO_POLICY_VERSION,
    });
    expect(db.tables().grants[0]?.issuance_key).toBe(FREE_BYO_ISSUANCE_KEY);
    expect(db.tables().users).toHaveLength(1);
    expect(db.tables().accounts).toHaveLength(1);
    expect(db.tables().grants).toHaveLength(1);
  });

  it("runs as one transaction on one dedicated client and releases it", async () => {
    const db = createFakeDatabase();

    await provisionPersonalAccountForIdentity(db.pool, identity("subject-tx"));

    expect(db.connects()).toBe(1);
    expect(db.statements[0]).toBe("BEGIN ISOLATION LEVEL READ COMMITTED");
    expect(db.statements.at(-1)).toBe("COMMIT");
    expect(db.releases).toEqual([undefined]);
  });

  it("writes one creation audit event per created record with a shared correlation ID and no email", async () => {
    const db = createFakeDatabase();
    const correlationId = randomUUID();

    const result = await provisionPersonalAccountForIdentity(db.pool, identity("subject-audit", { address: "secret@example.test", verified: true }), {
      correlationId,
    });

    expect(db.tables().audits.map((event) => [event.event_type, event.resource_type, event.resource_id])).toEqual([
      ["user.provisioned", "user", result.user.id],
      ["account.provisioned", "account", result.personalAccount.id],
      ["entitlement_grant.issued", "entitlement_grant", result.freeByoEntitlementGrant.id],
    ]);
    for (const event of db.tables().audits) {
      expect(event).toMatchObject({ account_id: result.personalAccount.id, actor_type: "USER", actor_user_id: result.user.id, correlation_id: correlationId });
      expect(JSON.stringify(event.metadata)).not.toContain("secret@example.test");
    }
    expect(result.correlationId).toBe(correlationId);
  });

  it("is idempotent: a repeat call returns the same IDs, creates nothing and writes no audit events", async () => {
    const db = createFakeDatabase();
    const first = await provisionPersonalAccountForIdentity(db.pool, identity("subject-repeat"));
    const second = await provisionPersonalAccountForIdentity(db.pool, identity("subject-repeat"));
    const third = await provisionPersonalAccountForIdentity(db.pool, identity("subject-repeat"));

    for (const result of [second, third]) {
      expect(result.user.id).toBe(first.user.id);
      expect(result.personalAccount.id).toBe(first.personalAccount.id);
      expect(result.freeByoEntitlementGrant.id).toBe(first.freeByoEntitlementGrant.id);
      expect(result.created).toEqual({ user: false, personalAccount: false, freeByoEntitlementGrant: false });
    }
    expect([db.tables().users.length, db.tables().accounts.length, db.tables().grants.length, db.tables().audits.length]).toEqual([1, 1, 1, 3]);
  });

  it("completes a user that has no PERSONAL account", async () => {
    const db = createFakeDatabase();
    const existing = await provisionPersonalAccountForIdentity(db.pool, identity("subject-partial-account"));
    db.seed((tables) => {
      tables.grants = [];
      tables.accounts = [];
      tables.audits = [];
    });

    const result = await provisionPersonalAccountForIdentity(db.pool, identity("subject-partial-account"));

    expect(result.user.id).toBe(existing.user.id);
    expect(result.created).toEqual({ user: false, personalAccount: true, freeByoEntitlementGrant: true });
    expect(db.tables().audits.map((event) => event.event_type)).toEqual(["account.provisioned", "entitlement_grant.issued"]);
  });

  it("completes a user and account that have no initial FREE_BYO grant", async () => {
    const db = createFakeDatabase();
    const existing = await provisionPersonalAccountForIdentity(db.pool, identity("subject-partial-grant"));
    db.seed((tables) => {
      tables.grants = [];
      tables.audits = [];
    });

    const result = await provisionPersonalAccountForIdentity(db.pool, identity("subject-partial-grant"));

    expect(result.personalAccount.id).toBe(existing.personalAccount.id);
    expect(result.created).toEqual({ user: false, personalAccount: false, freeByoEntitlementGrant: true });
    expect(db.tables().audits.map((event) => event.event_type)).toEqual(["entitlement_grant.issued"]);
  });

  it("returns an existing grant in any state without changing it", async () => {
    const db = createFakeDatabase();
    const first = await provisionPersonalAccountForIdentity(db.pool, identity("subject-revoked"));
    db.seed((tables) => {
      tables.grants[0]!.state = "REVOKED";
    });

    const again = await provisionPersonalAccountForIdentity(db.pool, identity("subject-revoked"));

    expect(again.freeByoEntitlementGrant).toMatchObject({ id: first.freeByoEntitlementGrant.id, state: "REVOKED" });
    expect(db.tables().grants).toHaveLength(1);
    expect(db.statements.some((sql) => sql.startsWith("UPDATE entitlement_grants"))).toBe(false);
  });

  it("does not merge identities that share an email", async () => {
    const db = createFakeDatabase();
    const email = { address: "shared@example.test", verified: true };
    const one = await provisionPersonalAccountForIdentity(db.pool, identity("subject-a", email));
    const two = await provisionPersonalAccountForIdentity(db.pool, identity("subject-b", email));

    expect(two.user.id).not.toBe(one.user.id);
    expect(two.personalAccount.id).not.toBe(one.personalAccount.id);
    expect(two.freeByoEntitlementGrant.id).not.toBe(one.freeByoEntitlementGrant.id);
    expect(db.statements.some((sql) => /WHERE email|email =.*WHERE|lower\(email\)/i.test(sql) && sql.startsWith("SELECT"))).toBe(false);
  });

  it("does not merge the same subject under different issuers", async () => {
    const db = createFakeDatabase();
    const one = await provisionPersonalAccountForIdentity(db.pool, { issuer: "https://issuer-one.test", subject: "same-subject" });
    const two = await provisionPersonalAccountForIdentity(db.pool, { issuer: "https://issuer-two.test", subject: "same-subject" });

    expect(two.user.id).not.toBe(one.user.id);
    expect(db.tables().users).toHaveLength(2);
  });

  it("treats issuer and subject as opaque: no trimming or case folding", async () => {
    const db = createFakeDatabase();
    const upper = await provisionPersonalAccountForIdentity(db.pool, { issuer: ISSUER, subject: "Subject-X" });
    const lower = await provisionPersonalAccountForIdentity(db.pool, { issuer: ISSUER, subject: "subject-x" });

    expect(upper.user.idpSubject).toBe("Subject-X");
    expect(lower.user.id).not.toBe(upper.user.id);
  });

  describe("email", () => {
    it("refreshes a changed verified email claim", async () => {
      const db = createFakeDatabase();
      await provisionPersonalAccountForIdentity(db.pool, identity("subject-email", { address: "old@example.test", verified: false }));
      const refreshed = await provisionPersonalAccountForIdentity(db.pool, identity("subject-email", { address: "new@example.test", verified: true }));

      expect(refreshed.user).toMatchObject({ email: "new@example.test", emailVerified: true });
    });

    it("never erases a stored email when a later claim has none", async () => {
      const db = createFakeDatabase();
      await provisionPersonalAccountForIdentity(db.pool, identity("subject-keep", { address: "kept@example.test", verified: true }));
      const again = await provisionPersonalAccountForIdentity(db.pool, identity("subject-keep"));

      expect(again.user).toMatchObject({ email: "kept@example.test", emailVerified: true });
      expect(db.statements.filter((sql) => sql.startsWith("UPDATE users"))).toEqual([]);
    });

    it("does not write when the claim is unchanged", async () => {
      const db = createFakeDatabase();
      const email = { address: "same@example.test", verified: true };
      await provisionPersonalAccountForIdentity(db.pool, identity("subject-same", email));
      await provisionPersonalAccountForIdentity(db.pool, identity("subject-same", email));

      expect(db.statements.filter((sql) => sql.startsWith("UPDATE users"))).toEqual([]);
    });
  });

  describe("refusals", () => {
    it("refuses a disabled user without creating or updating anything", async () => {
      const db = createFakeDatabase();
      await provisionPersonalAccountForIdentity(db.pool, identity("subject-disabled"));
      db.seed((tables) => {
        tables.users[0]!.status = "DISABLED";
        tables.grants = [];
      });

      const attempt = provisionPersonalAccountForIdentity(db.pool, identity("subject-disabled", { address: "x@example.test", verified: true }));
      await expectProvisioningError(attempt, "PROVISIONING_REFUSED");
      await expect(attempt).rejects.toMatchObject({ reason: "USER_DISABLED" });
      expect(db.tables().grants).toHaveLength(0);
      expect(db.tables().users[0]!.email).toBeNull();
      expect(db.releases.at(-1)).toBeUndefined();
    });

    it("refuses a disabled PERSONAL account without issuing a grant", async () => {
      const db = createFakeDatabase();
      await provisionPersonalAccountForIdentity(db.pool, identity("subject-account-disabled"));
      db.seed((tables) => {
        tables.accounts[0]!.status = "DISABLED";
        tables.grants = [];
      });

      const attempt = provisionPersonalAccountForIdentity(db.pool, identity("subject-account-disabled"));
      await expectProvisioningError(attempt, "PROVISIONING_REFUSED");
      await expect(attempt).rejects.toMatchObject({ reason: "ACCOUNT_DISABLED" });
      expect(db.tables().grants).toHaveLength(0);
    });
  });

  describe("input validation (before any SQL)", () => {
    it.each([
      ["a missing issuer", { subject: "s" }],
      ["a blank issuer", { issuer: "   ", subject: "s" }],
      ["a missing subject", { issuer: ISSUER }],
      ["a blank subject", { issuer: ISSUER, subject: "" }],
      ["an overlong subject", { issuer: ISSUER, subject: "s".repeat(256) }],
      ["an overlong issuer", { issuer: "i".repeat(513), subject: "s" }],
      ["a non-string subject", { issuer: ISSUER, subject: 42 }],
      ["an email without verified", { issuer: ISSUER, subject: "s", email: { address: "a@example.test" } }],
      ["a blank email address", { issuer: ISSUER, subject: "s", email: { address: " ", verified: true } }],
      ["an overlong email", { issuer: ISSUER, subject: "s", email: { address: `${"a".repeat(320)}@x`, verified: true } }],
      ["a caller-chosen user ID", { issuer: ISSUER, subject: "s", userId: randomUUID() }],
      ["a caller-chosen account", { issuer: ISSUER, subject: "s", accountId: randomUUID() }],
      ["a caller-chosen grant kind", { issuer: ISSUER, subject: "s", kind: "CREATOR" }],
      ["a caller-chosen grant state", { issuer: ISSUER, subject: "s", state: "AVAILABLE" }],
      ["a caller-chosen grant source", { issuer: ISSUER, subject: "s", source: "PROMOTION" }],
      ["a caller-chosen issuance key", { issuer: ISSUER, subject: "s", issuanceKey: "second-free-grant" }],
      ["a caller-chosen role", { issuer: ISSUER, subject: "s", role: "OWNER" }],
      ["audit metadata", { issuer: ISSUER, subject: "s", metadata: { note: "x" } }],
      ["extra email fields", { issuer: ISSUER, subject: "s", email: { address: "a@example.test", verified: true, primary: true } }],
      ["a non-object identity", "issuer|subject"],
    ])("rejects %s", async (_label, input) => {
      const db = createFakeDatabase();
      await expectProvisioningError(provisionPersonalAccountForIdentity(db.pool, input as unknown as VerifiedIdentity), "PROVISIONING_INPUT_INVALID");
      expect(db.connects()).toBe(0);
      expect(db.statements).toEqual([]);
    });

    it("rejects a malformed correlation ID", async () => {
      const db = createFakeDatabase();
      await expectProvisioningError(provisionPersonalAccountForIdentity(db.pool, identity("s"), { correlationId: "request-1" }), "PROVISIONING_INPUT_INVALID");
      expect(db.connects()).toBe(0);
    });

    it("never echoes identity values in input errors", async () => {
      const db = createFakeDatabase();
      const attempt = provisionPersonalAccountForIdentity(db.pool, { issuer: ISSUER, subject: "secret-subject", accountId: "x" } as unknown as VerifiedIdentity);
      await expect(attempt).rejects.not.toThrow(/secret-subject|issuer\.example/);
    });
  });

  describe("failure and rollback", () => {
    it("rolls back every earlier insert when a late statement fails, and releases the client", async () => {
      const db = createFakeDatabase({ failOn: { sqlStartsWith: "INSERT INTO audit_events", occurrence: 3 } });

      const attempt = provisionPersonalAccountForIdentity(db.pool, identity("subject-rollback"));
      await expectProvisioningError(attempt, "PROVISIONING_DATABASE_FAILURE");
      await expect(attempt).rejects.toMatchObject({ databaseCode: "XX000", message: "Provisioning could not be completed." });

      expect(db.statements).toContain("ROLLBACK");
      expect(db.statements).not.toContain("COMMIT");
      expect(db.tables()).toEqual({ users: [], accounts: [], grants: [], audits: [] });
      expect(db.releases).toEqual([undefined]);
    });

    it("keeps the primary error when the rollback itself fails, and destroys the connection", async () => {
      const primary = Object.assign(new Error("deadlock detected"), { code: "40P01" });
      const db = createFakeDatabase({ failOn: { sqlStartsWith: "INSERT INTO accounts", error: primary }, failRollback: true });

      const attempt = provisionPersonalAccountForIdentity(db.pool, identity("subject-broken"));
      await expectProvisioningError(attempt, "PROVISIONING_DATABASE_FAILURE");
      await expect(attempt).rejects.toMatchObject({ databaseCode: "40P01", cause: primary });

      expect(db.releases).toHaveLength(1);
      expect(db.releases[0]).toMatchObject({ code: "57P01" });
    });

    it("does not report a unique violation as a domain conflict", async () => {
      const db = createFakeDatabase({
        failOn: { sqlStartsWith: "INSERT INTO entitlement_grants", error: Object.assign(new Error("duplicate key"), { code: "23505" }) },
      });

      await expect(provisionPersonalAccountForIdentity(db.pool, identity("subject-unique"))).rejects.toMatchObject({
        code: "PROVISIONING_DATABASE_FAILURE",
        databaseCode: "23505",
      });
    });

    it("reports a pool that cannot provide a client as a database failure", async () => {
      const db = createFakeDatabase();
      const pool = { ...db.pool, connect: async () => { throw Object.assign(new Error("timeout exceeded when trying to connect"), { code: "ETIMEDOUT" }); } };

      await expectProvisioningError(provisionPersonalAccountForIdentity(pool, identity("subject-noconnect")), "PROVISIONING_DATABASE_FAILURE");
    });

    it("never uses Pool.query for transactional work", async () => {
      const db = createFakeDatabase();
      // The fake's Pool.query throws; success proves every statement used the dedicated client.
      await expect(provisionPersonalAccountForIdentity(db.pool, identity("subject-client"))).resolves.toBeDefined();
    });
  });
});
