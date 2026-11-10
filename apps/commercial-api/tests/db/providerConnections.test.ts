import { randomBytes } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PROVIDER_CREDENTIAL_PURPOSE } from "../../src/providerCredentials/credentialContext.js";
import { createTestCredentialFingerprinter, createTestCredentialSealer, generateTestKey } from "../support/testCredentialCrypto.js";
import {
  expectSqlError,
  inRolledBackTransaction,
  insertAccountWithFreeGrant,
  openGuardedClients,
  prepareSchemaV1,
  type GuardedClients,
} from "./support/testDatabase.js";

// Migration 0002 invariants against PostgreSQL 16. Application writes run as
// the restricted runtime role inside rolled-back transactions, so the suite
// leaves no rows. Sealed credentials are produced by the R44B5C test sealer
// from generated fixture values, never real provider credentials.

const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const DENIED = "42501";

let clients: GuardedClients;
const encryptionKey = generateTestKey("test-encryption-key/v1");
const sealer = createTestCredentialSealer(encryptionKey);
const fingerprinter = createTestCredentialFingerprinter(generateTestKey("test-fingerprint-key/v1"), encryptionKey);

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
});

afterAll(async () => {
  await clients.close();
});

const INSERT_CONNECTION = `
INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id, label, creation_idempotency_key)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`;

async function insertConnection(
  client: pg.Client,
  owner: { accountId: string; userId: string },
  overrides: Partial<{ provider: string; kind: string; label: string | null; key: string | null }> = {},
): Promise<string> {
  const result = await client.query<{ id: string }>(INSERT_CONNECTION, [
    owner.accountId,
    overrides.provider ?? "EXAMPLE_PROVIDER",
    overrides.kind ?? "API_KEY",
    owner.userId,
    overrides.label ?? null,
    overrides.key ?? null,
  ]);
  return result.rows[0]!.id;
}

async function sealedMaterial(accountId: string, connectionId: string, version: number) {
  const credential = `fixture-credential-${randomBytes(16).toString("hex")}`;
  const envelope = await sealer.seal(credential, {
    accountId,
    providerConnectionId: connectionId,
    provider: "EXAMPLE_PROVIDER",
    credentialVersion: version,
    purpose: PROVIDER_CREDENTIAL_PURPOSE,
  });
  const fingerprint = await fingerprinter.fingerprint(credential);
  return { credential, envelope, fingerprint };
}

const INSERT_VERSION = `
INSERT INTO provider_credential_versions
  (account_id, provider_connection_id, credential_version, status, sealed_credential,
   fingerprint_algorithm, fingerprint_key_ref, fingerprint_value, created_by_user_id, destroyed_at, rotation_idempotency_key, superseded_at)
VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12) RETURNING id`;

type VersionInput = {
  accountId: string;
  connectionId: string;
  userId: string;
  version?: number;
  status?: string;
  envelope?: unknown;
  fingerprint?: { algorithm: string | null; keyRef: string | null; value: string | null };
  destroyedAt?: string | null;
  rotationKey?: string | null;
  supersededAt?: string | null;
};

async function versionParams(input: VersionInput): Promise<unknown[]> {
  const material = await sealedMaterial(input.accountId, input.connectionId, input.version ?? 1);
  const envelope = input.envelope === undefined ? material.envelope : input.envelope;
  const fingerprint = input.fingerprint ?? material.fingerprint;
  return [
    input.accountId,
    input.connectionId,
    input.version ?? 1,
    input.status ?? "ACTIVE",
    envelope === null ? null : JSON.stringify(envelope),
    "algorithm" in fingerprint ? fingerprint.algorithm : null,
    fingerprint.keyRef,
    fingerprint.value,
    input.userId,
    input.destroyedAt ?? null,
    input.rotationKey ?? null,
    input.supersededAt ?? null,
  ];
}

async function insertVersion(client: pg.Client, input: VersionInput): Promise<string> {
  const result = await client.query<{ id: string }>(INSERT_VERSION, await versionParams(input));
  return result.rows[0]!.id;
}

const NULL_FINGERPRINT = { algorithm: null, keyRef: null, value: null };

describe("provider_connections invariants", () => {
  it("stores a connection owned by an account with fail-closed defaults", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "pc-defaults");
      const id = await insertConnection(clients.runtime, owner, { label: "Studio key" });
      const row = await clients.runtime.query("SELECT account_id, provider, credential_kind, status, verification_status, label FROM provider_connections WHERE id = $1", [id]);
      expect(row.rows).toEqual([
        { account_id: owner.accountId, provider: "EXAMPLE_PROVIDER", credential_kind: "API_KEY", status: "PENDING_VERIFICATION", verification_status: "UNVERIFIED", label: "Studio key" },
      ]);
    });
  });

  it.each(["example", "", "1PROVIDER", "EXAMPLE-PROVIDER", "EXAMPLE PROVIDER", `P${"X".repeat(32)}`])("rejects the malformed provider identifier %j", async (provider) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "pc-provider");
      await expectSqlError(clients.runtime, INSERT_CONNECTION, [owner.accountId, provider, "API_KEY", owner.userId, null, null], {
        code: CHECK,
        constraint: "provider_connections_provider_ck",
      });
    });
  });

  it("accepts a 32-character provider identifier", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "pc-provider-32");
      await insertConnection(clients.runtime, owner, { provider: `P${"X".repeat(31)}` });
    });
  });

  it.each(["OAUTH", "SERVICE_ACCOUNT_KEY", "api_key", ""])("rejects credential kind %j (API_KEY only in v1)", async (kind) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "pc-kind");
      await expectSqlError(clients.runtime, INSERT_CONNECTION, [owner.accountId, "EXAMPLE_PROVIDER", kind, owner.userId, null, null], {
        code: CHECK,
        constraint: "provider_connections_credential_kind_ck",
      });
    });
  });

  it("rejects unknown statuses and inconsistent lifecycle timestamps", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "pc-status");
      const id = await insertConnection(clients.runtime, owner);
      const cases: [string, string][] = [
        ["UPDATE provider_connections SET status = 'DELETED' WHERE id = $1", "provider_connections_status_ck"],
        [
          "UPDATE provider_connections SET verification_status = 'PENDING', last_verification_attempt_at = now() WHERE id = $1",
          "provider_connections_verification_status_ck",
        ],
        ["UPDATE provider_connections SET status = 'DISCONNECTED' WHERE id = $1", "provider_connections_disconnected_at_ck"],
        ["UPDATE provider_connections SET status = 'DISABLED' WHERE id = $1", "provider_connections_disabled_at_ck"],
        ["UPDATE provider_connections SET verification_status = 'VERIFIED', last_verification_attempt_at = now() WHERE id = $1", "provider_connections_verified_at_ck"],
        ["UPDATE provider_connections SET verification_status = 'FAILED' WHERE id = $1", "provider_connections_verification_attempt_ck"],
        ["UPDATE provider_connections SET label = ' padded' WHERE id = $1", "provider_connections_label_ck"],
        [`UPDATE provider_connections SET label = '${"x".repeat(101)}' WHERE id = $1`, "provider_connections_label_ck"],
      ];
      for (const [sql, constraint] of cases) {
        await expectSqlError(clients.runtime, sql, [id], { code: CHECK, constraint });
      }
      await clients.runtime.query(
        "UPDATE provider_connections SET status = 'DISCONNECTED', disconnected_at = now(), verification_status = 'VERIFIED', verified_at = now(), last_verification_attempt_at = now(), updated_at = now() WHERE id = $1",
        [id],
      );
    });
  });

  it("scopes creation idempotency keys to the account", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const a = await insertAccountWithFreeGrant(clients.runtime, "pc-key-a");
      const b = await insertAccountWithFreeGrant(clients.runtime, "pc-key-b");
      await insertConnection(clients.runtime, a, { key: "create-1" });
      await insertConnection(clients.runtime, b, { key: "create-1" });
      await expectSqlError(clients.runtime, INSERT_CONNECTION, [a.accountId, "EXAMPLE_PROVIDER", "API_KEY", a.userId, null, "create-1"], {
        code: UNIQUE,
        constraint: "provider_connections_creation_idempotency_key_uq",
      });
    });
  });

  it("allows several connections, including to the same provider, per account", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "pc-many");
      for (let index = 0; index < 3; index += 1) await insertConnection(clients.runtime, owner);
      const count = await clients.runtime.query("SELECT count(*)::int AS count FROM provider_connections WHERE account_id = $1", [owner.accountId]);
      expect(count.rows).toEqual([{ count: 3 }]);
    });
  });
});

describe("provider_credential_versions invariants", () => {
  it("stores an R44B5C sealed envelope and fingerprint", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "cv-store");
      const connectionId = await insertConnection(clients.runtime, owner);
      const id = await insertVersion(clients.runtime, { ...owner, connectionId });
      const row = await clients.runtime.query("SELECT status, sealed_credential, fingerprint_algorithm FROM provider_credential_versions WHERE id = $1", [id]);
      expect(row.rows[0]).toMatchObject({ status: "ACTIVE", fingerprint_algorithm: "HMAC-SHA-256", sealed_credential: { format: "sealed-credential-v1", algorithm: "AES-256-GCM" } });
    });
  });

  it.each([0, -1, 1_000_001])("rejects credential version %i", async (version) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "cv-version");
      const connectionId = await insertConnection(clients.runtime, owner);
      const params = await versionParams({ ...owner, connectionId, version: 1 });
      params[2] = version;
      await expectSqlError(clients.runtime, INSERT_VERSION, params, { code: CHECK, constraint: "provider_credential_versions_version_ck" });
    });
  });

  it("rejects a duplicate version number but allows the same number on another connection", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "cv-duplicate");
      const first = await insertConnection(clients.runtime, owner);
      const second = await insertConnection(clients.runtime, owner);
      const superseded = new Date().toISOString();
      await insertVersion(clients.runtime, { ...owner, connectionId: first, version: 1, status: "SUPERSEDED", supersededAt: superseded });
      await insertVersion(clients.runtime, { ...owner, connectionId: second, version: 1 });
      await insertVersion(clients.runtime, { ...owner, connectionId: first, version: 2 });
      await expectSqlError(clients.runtime, INSERT_VERSION, await versionParams({ ...owner, connectionId: first, version: 2, status: "SUPERSEDED", supersededAt: superseded }), {
        code: UNIQUE,
        constraint: "provider_credential_versions_version_uq",
      });
    });
  });

  it("allows at most one ACTIVE version per connection", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "cv-active");
      const connectionId = await insertConnection(clients.runtime, owner);
      await insertVersion(clients.runtime, { ...owner, connectionId, version: 1 });
      await expectSqlError(clients.runtime, INSERT_VERSION, await versionParams({ ...owner, connectionId, version: 2 }), {
        code: UNIQUE,
        constraint: "provider_credential_versions_one_active_uq",
      });
    });
  });

  it.each([
    ["a destroyed version that still holds secret material", { status: "DESTROYED", fingerprint: NULL_FINGERPRINT, destroyedAt: "now" }, "provider_credential_versions_secret_presence_ck"],
    ["a destroyed version that still holds a fingerprint", { status: "DESTROYED", envelope: null, destroyedAt: "now" }, "provider_credential_versions_fingerprint_presence_ck"],
    ["a live version without secret material", { envelope: null }, "provider_credential_versions_secret_presence_ck"],
    ["a live version without a fingerprint", { fingerprint: NULL_FINGERPRINT }, "provider_credential_versions_fingerprint_presence_ck"],
    ["a destroyed version without destroyed_at", { status: "DESTROYED", envelope: null, fingerprint: NULL_FINGERPRINT }, "provider_credential_versions_destroyed_at_ck"],
    ["a live version with destroyed_at", { destroyedAt: "now" }, "provider_credential_versions_destroyed_at_ck"],
    ["an array envelope", { envelope: [1, 2] }, "provider_credential_versions_sealed_credential_ck"],
    ["an envelope without a format", { envelope: { ciphertext: "abc" } }, "provider_credential_versions_sealed_credential_ck"],
    ["an envelope with a non-string format", { envelope: { format: 1 } }, "provider_credential_versions_sealed_credential_ck"],
    ["a scalar envelope", { envelope: "sealed-credential-v1" }, "provider_credential_versions_sealed_credential_ck"],
    ["an oversized envelope", { envelope: { format: "sealed-credential-v1", pad: "x".repeat(17000) } }, "provider_credential_versions_sealed_credential_ck"],
    ["a raw SHA-256 fingerprint algorithm", { fingerprint: { algorithm: "SHA-256", keyRef: "fp/v1", value: "A".repeat(43) } }, "provider_credential_versions_fingerprint_algorithm_ck"],
    ["a malformed fingerprint value", { fingerprint: { algorithm: "HMAC-SHA-256", keyRef: "fp/v1", value: "short" } }, "provider_credential_versions_fingerprint_value_ck"],
    ["a malformed fingerprint key reference", { fingerprint: { algorithm: "HMAC-SHA-256", keyRef: "bad key", value: "A".repeat(43) } }, "provider_credential_versions_fingerprint_key_ref_ck"],
    ["an unknown status", { status: "REVOKED" }, "provider_credential_versions_status_ck"],
  ] as const)("rejects %s", async (_label, overrides, constraint) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "cv-shape");
      const connectionId = await insertConnection(clients.runtime, owner);
      const params = await versionParams({
        ...owner,
        connectionId,
        ...overrides,
        destroyedAt: "destroyedAt" in overrides ? new Date().toISOString() : null,
      } as VersionInput);
      await expectSqlError(clients.runtime, INSERT_VERSION, params, { code: CHECK, constraint });
    });
  });

  it("scopes rotation idempotency keys to the connection", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "cv-rotation");
      const first = await insertConnection(clients.runtime, owner);
      const second = await insertConnection(clients.runtime, owner);
      await insertVersion(clients.runtime, { ...owner, connectionId: first, version: 1, rotationKey: "rotate-1" });
      await insertVersion(clients.runtime, { ...owner, connectionId: second, version: 1, rotationKey: "rotate-1" });
      await expectSqlError(
        clients.runtime,
        INSERT_VERSION,
        await versionParams({ ...owner, connectionId: first, version: 2, status: "SUPERSEDED", supersededAt: new Date().toISOString(), rotationKey: "rotate-1" }),
        { code: UNIQUE, constraint: "provider_credential_versions_rotation_idempotency_key_uq" },
      );
    });
  });

  it("does not make fingerprints unique, even within one account", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const owner = await insertAccountWithFreeGrant(clients.runtime, "cv-fingerprint");
      const first = await insertConnection(clients.runtime, owner);
      const second = await insertConnection(clients.runtime, owner);
      const shared = { algorithm: "HMAC-SHA-256", keyRef: "test-fingerprint-key/v1", value: "B".repeat(43) };
      await insertVersion(clients.runtime, { ...owner, connectionId: first, fingerprint: shared });
      await insertVersion(clients.runtime, { ...owner, connectionId: second, fingerprint: shared });
    });
  });
});

describe("account isolation", () => {
  it("rejects a credential version that claims another account's connection", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const a = await insertAccountWithFreeGrant(clients.runtime, "iso-a");
      const b = await insertAccountWithFreeGrant(clients.runtime, "iso-b");
      const aConnection = await insertConnection(clients.runtime, a);

      await insertVersion(clients.runtime, { ...a, connectionId: aConnection });
      const params = await versionParams({ ...b, connectionId: aConnection, version: 2, status: "SUPERSEDED", supersededAt: new Date().toISOString() });
      await expectSqlError(clients.runtime, INSERT_VERSION, params, {
        code: FOREIGN_KEY,
        constraint: "provider_credential_versions_connection_same_account_fk",
      });
    });
  });

  it("cannot move a connection or version to another account", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const a = await insertAccountWithFreeGrant(clients.runtime, "iso-move-a");
      const b = await insertAccountWithFreeGrant(clients.runtime, "iso-move-b");
      const connectionId = await insertConnection(clients.runtime, a);
      const versionId = await insertVersion(clients.runtime, { ...a, connectionId });
      await expectSqlError(clients.runtime, "UPDATE provider_connections SET account_id = $1 WHERE id = $2", [b.accountId, connectionId], { code: DENIED });
      await expectSqlError(clients.runtime, "UPDATE provider_credential_versions SET account_id = $1 WHERE id = $2", [b.accountId, versionId], { code: DENIED });
    });
  });
});

describe("credential-version immutability", () => {
  async function liveVersion(client: pg.Client, label: string) {
    const owner = await insertAccountWithFreeGrant(client, label);
    const connectionId = await insertConnection(client, owner);
    const versionId = await insertVersion(client, { ...owner, connectionId });
    return { owner, connectionId, versionId };
  }

  it("permits lifecycle transitions and one-way destruction", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const { versionId } = await liveVersion(clients.runtime, "imm-lifecycle");
      await clients.runtime.query("UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now(), updated_at = now() WHERE id = $1", [versionId]);
      await clients.runtime.query(
        "UPDATE provider_credential_versions SET status = 'RETAINED_FOR_RECOVERY', retained_for_recovery_at = now(), updated_at = now() WHERE id = $1",
        [versionId],
      );
      await clients.runtime.query(
        `UPDATE provider_credential_versions
            SET status = 'DESTROYED', destroyed_at = now(), sealed_credential = NULL,
                fingerprint_algorithm = NULL, fingerprint_key_ref = NULL, fingerprint_value = NULL, updated_at = now()
          WHERE id = $1`,
        [versionId],
      );
      const row = await clients.runtime.query("SELECT status, sealed_credential, fingerprint_value FROM provider_credential_versions WHERE id = $1", [versionId]);
      expect(row.rows).toEqual([{ status: "DESTROYED", sealed_credential: null, fingerprint_value: null }]);
    });
  });

  it("rejects replacing secret material or a fingerprint with a different value", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const { owner, connectionId, versionId } = await liveVersion(clients.runtime, "imm-replace");
      const other = await sealedMaterial(owner.accountId, connectionId, 1);
      const replaced = { code: CHECK };
      await expectSqlError(clients.runtime, "UPDATE provider_credential_versions SET sealed_credential = $1::jsonb WHERE id = $2", [JSON.stringify(other.envelope), versionId], replaced);
      await expectSqlError(clients.runtime, "UPDATE provider_credential_versions SET fingerprint_value = $1 WHERE id = $2", [other.fingerprint.value, versionId], replaced);
      await expectSqlError(clients.runtime, "UPDATE provider_credential_versions SET fingerprint_key_ref = 'other-key/v9' WHERE id = $1", [versionId], replaced);
      // Re-writing the identical value is not a replacement and is allowed.
      await clients.runtime.query("UPDATE provider_credential_versions SET sealed_credential = sealed_credential, updated_at = now() WHERE id = $1", [versionId]);
    });
  });

  it("rejects nulling secret material without destruction", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const { versionId } = await liveVersion(clients.runtime, "imm-null");
      await expectSqlError(clients.runtime, "UPDATE provider_credential_versions SET sealed_credential = NULL WHERE id = $1", [versionId], {
        code: CHECK,
        constraint: "provider_credential_versions_secret_presence_ck",
      });
    });
  });

  it("rejects moving a version back to ACTIVE or out of DESTROYED", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const { versionId } = await liveVersion(clients.runtime, "imm-backwards");
      await clients.runtime.query("UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now() WHERE id = $1", [versionId]);
      await expectSqlError(clients.runtime, "UPDATE provider_credential_versions SET status = 'ACTIVE', superseded_at = NULL WHERE id = $1", [versionId], { code: CHECK });
      await clients.runtime.query(
        `UPDATE provider_credential_versions SET status = 'DESTROYED', destroyed_at = now(), sealed_credential = NULL,
                fingerprint_algorithm = NULL, fingerprint_key_ref = NULL, fingerprint_value = NULL WHERE id = $1`,
        [versionId],
      );
      await expectSqlError(clients.runtime, "UPDATE provider_credential_versions SET status = 'SUPERSEDED', destroyed_at = NULL WHERE id = $1", [versionId], { code: CHECK });
    });
  });

  it("denies the runtime role any change to identity columns", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const { versionId, connectionId } = await liveVersion(clients.runtime, "imm-identity");
      for (const sql of [
        "UPDATE provider_credential_versions SET credential_version = 7 WHERE id = $1",
        "UPDATE provider_credential_versions SET provider_connection_id = gen_random_uuid() WHERE id = $1",
        "UPDATE provider_credential_versions SET created_at = now() WHERE id = $1",
        "UPDATE provider_credential_versions SET rotation_idempotency_key = 'x' WHERE id = $1",
      ]) {
        await expectSqlError(clients.runtime, sql, [versionId], { code: DENIED });
      }
      for (const sql of [
        "UPDATE provider_connections SET provider = 'OTHER' WHERE id = $1",
        "UPDATE provider_connections SET credential_kind = 'API_KEY' WHERE id = $1",
        "UPDATE provider_connections SET created_by_user_id = created_by_user_id WHERE id = $1",
        "UPDATE provider_connections SET creation_idempotency_key = 'x' WHERE id = $1",
      ]) {
        await expectSqlError(clients.runtime, sql, [connectionId], { code: DENIED });
      }
    });
  });

  it("guards identity and material even for the table owner", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const { owner, connectionId, versionId } = await liveVersion(clients.migrator, "imm-owner");
      const other = await sealedMaterial(owner.accountId, connectionId, 1);
      await expectSqlError(clients.migrator, "UPDATE provider_credential_versions SET credential_version = 9 WHERE id = $1", [versionId], { code: CHECK });
      await expectSqlError(clients.migrator, "UPDATE provider_credential_versions SET sealed_credential = $1::jsonb WHERE id = $2", [JSON.stringify(other.envelope), versionId], {
        code: CHECK,
      });
      await clients.migrator.query("SAVEPOINT owner_probe");
      await expect(clients.migrator.query("UPDATE provider_credential_versions SET fingerprint_value = $1 WHERE id = $2", [other.fingerprint.value, versionId])).rejects.toMatchObject({
        message: "provider credential material cannot be replaced",
      });
      await clients.migrator.query("ROLLBACK TO SAVEPOINT owner_probe");
    });
  });
});

describe("runtime privileges on provider tables", () => {
  it("denies DELETE, TRUNCATE and DDL", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      for (const sql of [
        "DELETE FROM provider_connections",
        "DELETE FROM provider_credential_versions",
        "TRUNCATE provider_connections",
        "TRUNCATE provider_credential_versions",
        "ALTER TABLE provider_connections ADD COLUMN probe integer",
        "ALTER TABLE provider_credential_versions DISABLE TRIGGER provider_credential_versions_guard_update",
        "DROP TABLE provider_credential_versions",
        "CREATE TABLE provider_probe (id integer)",
      ]) {
        await expectSqlError(clients.runtime, sql, [], { code: DENIED });
      }
    });
  });

  it("holds exactly SELECT and INSERT at table level, no owner-like privileges", async () => {
    for (const table of ["provider_connections", "provider_credential_versions"]) {
      const privileges = await clients.runtime.query<Record<string, boolean>>(
        `SELECT has_table_privilege(current_user, $1, 'SELECT') AS select, has_table_privilege(current_user, $1, 'INSERT') AS insert,
                has_table_privilege(current_user, $1, 'UPDATE') AS table_update, has_table_privilege(current_user, $1, 'DELETE') AS delete,
                has_table_privilege(current_user, $1, 'TRUNCATE') AS truncate, has_table_privilege(current_user, $1, 'REFERENCES') AS references,
                has_table_privilege(current_user, $1, 'TRIGGER') AS trigger`,
        [`public.${table}`],
      );
      expect(privileges.rows[0], table).toEqual({ select: true, insert: true, table_update: false, delete: false, truncate: false, references: false, trigger: false });
    }
    const owner = await clients.runtime.query("SELECT count(*)::int AS owned FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)");
    expect(owner.rows).toEqual([{ owned: 0 }]);
  });
});

describe("audit events after migration 0002", () => {
  const INSERT_AUDIT = `INSERT INTO audit_events (actor_type, event_type, resource_type, resource_id, correlation_id)
                        VALUES ('SYSTEM', $1, $2, gen_random_uuid(), gen_random_uuid()) RETURNING id`;

  it("accepts provider_connection and every earlier resource type, and rejects unknown types", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      for (const type of ["user", "account", "entitlement_grant", "production", "provider_connection"]) {
        await clients.runtime.query(INSERT_AUDIT, ["provider_connection.created", type]);
      }
      for (const type of ["provider_credential_version", "credential", "secret"]) {
        await expectSqlError(clients.runtime, INSERT_AUDIT, ["provider_connection.created", type], { code: CHECK, constraint: "audit_events_resource_type_ck" });
      }
    });
  });

  it("remains append-only for the runtime role and the owner", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const inserted = await clients.migrator.query<{ id: string }>(INSERT_AUDIT, ["provider_connection.disconnected", "provider_connection"]);
      const id = inserted.rows[0]!.id;
      for (const sql of ["UPDATE audit_events SET event_type = 'provider_connection.created' WHERE id = $1", "DELETE FROM audit_events WHERE id = $1"]) {
        await clients.migrator.query("SAVEPOINT audit_probe");
        await expect(clients.migrator.query(sql, [id])).rejects.toMatchObject({ message: expect.stringContaining("audit_events is append-only") });
        await clients.migrator.query("ROLLBACK TO SAVEPOINT audit_probe");
      }
    });
    await inRolledBackTransaction(clients.runtime, async () => {
      const inserted = await clients.runtime.query<{ id: string }>(INSERT_AUDIT, ["provider_connection.created", "provider_connection"]);
      await expectSqlError(clients.runtime, "UPDATE audit_events SET event_type = 'x.y' WHERE id = $1", [inserted.rows[0]!.id], { code: DENIED });
      await expectSqlError(clients.runtime, "DELETE FROM audit_events WHERE id = $1", [inserted.rows[0]!.id], { code: DENIED });
    });
  });
});
