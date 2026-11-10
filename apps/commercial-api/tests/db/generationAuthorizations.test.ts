import { createHash } from "node:crypto";

import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  expectSqlError,
  inRolledBackTransaction,
  insertAccountWithFreeGrant,
  openGuardedClients,
  prepareSchemaV1,
  type GuardedClients,
} from "./support/testDatabase.js";

// Migration 0003 invariants against PostgreSQL 16. Application writes run as
// the restricted runtime role inside rolled-back transactions, so the suite
// leaves no rows. Sealed envelopes and fingerprints are inert fixture values:
// no credential plaintext exists anywhere in this suite.

const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";
const DENIED = "42501";

let clients: GuardedClients;

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
});

afterAll(async () => {
  await clients.close();
});

type Owner = Readonly<{ userId: string; accountId: string; grantId: string }>;

async function insertProduction(client: pg.Client, owner: Owner, title = "Production"): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [owner.accountId, title, owner.grantId, owner.userId],
  );
  return result.rows[0]!.id;
}

async function insertConnection(client: pg.Client, owner: Owner, provider = "EXAMPLE_PROVIDER"): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO provider_connections (account_id, provider, credential_kind, created_by_user_id)
     VALUES ($1, $2, 'API_KEY', $3) RETURNING id`,
    [owner.accountId, provider, owner.userId],
  );
  return result.rows[0]!.id;
}

let fingerprintCounter = 0;

async function insertVersion(client: pg.Client, owner: Owner, connectionId: string, version = 1): Promise<string> {
  fingerprintCounter += 1;
  const result = await client.query<{ id: string }>(
    `INSERT INTO provider_credential_versions
       (account_id, provider_connection_id, credential_version, status, sealed_credential,
        fingerprint_algorithm, fingerprint_key_ref, fingerprint_value, created_by_user_id)
     VALUES ($1, $2, $3, 'ACTIVE', '{"format":"fixture-envelope"}'::jsonb, 'HMAC-SHA-256', 'fixture/v1', $4, $5) RETURNING id`,
    [owner.accountId, connectionId, version, String(fingerprintCounter).padStart(43, "A"), owner.userId],
  );
  return result.rows[0]!.id;
}

type Fixture = Owner & Readonly<{ productionId: string; connectionId: string; versionId: string }>;

async function fixture(client: pg.Client, subject: string, provider = "EXAMPLE_PROVIDER"): Promise<Fixture> {
  const owner = await insertAccountWithFreeGrant(client, subject);
  const productionId = await insertProduction(client, owner);
  const connectionId = await insertConnection(client, owner, provider);
  const versionId = await insertVersion(client, owner, connectionId);
  return { ...owner, productionId, connectionId, versionId };
}

const REQUEST = { prompt: "A lighthouse at dawn", durationSeconds: 5, aspectRatio: "16:9" };
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

type AuthorizationInput = {
  accountId: string;
  productionId: string;
  grantId: string;
  userId: string;
  billingMode?: string;
  provider?: string;
  model?: string;
  connectionId?: string | null;
  versionId?: string | null;
  request?: unknown;
  requestSha256?: string;
  costUnit?: string;
  costAmount?: string | number;
  status?: string;
  expiresAt?: string;
  claimedAt?: string | null;
  expiredAt?: string | null;
  cancelledAt?: string | null;
  idempotencyKey?: string | null;
};

const INSERT_AUTHORIZATION = `
INSERT INTO generation_authorizations
  (account_id, production_id, entitlement_grant_id, billing_mode, provider, model, provider_connection_id,
   provider_credential_version_id, generation_request, generation_request_sha256, expected_cost_cap_unit,
   expected_cost_cap_amount, status, expires_at, claimed_at, expired_at, cancelled_at, created_by_user_id,
   creation_idempotency_key)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
RETURNING id`;

function authorizationParams(input: AuthorizationInput): unknown[] {
  const request = input.request === undefined ? REQUEST : input.request;
  return [
    input.accountId,
    input.productionId,
    input.grantId,
    input.billingMode ?? "USER_BYO",
    input.provider ?? "EXAMPLE_PROVIDER",
    input.model ?? "example-model-1.0",
    input.connectionId === undefined ? null : input.connectionId,
    input.versionId === undefined ? null : input.versionId,
    JSON.stringify(request),
    input.requestSha256 ?? sha256(request),
    input.costUnit ?? "MICRO_USD",
    input.costAmount ?? 2_000_000,
    input.status ?? "ISSUED",
    input.expiresAt ?? "infinity",
    input.claimedAt ?? null,
    input.expiredAt ?? null,
    input.cancelledAt ?? null,
    input.userId,
    input.idempotencyKey ?? null,
  ];
}

function forFixture(f: Fixture, overrides: Partial<AuthorizationInput> = {}): AuthorizationInput {
  return {
    accountId: f.accountId,
    productionId: f.productionId,
    grantId: f.grantId,
    userId: f.userId,
    connectionId: f.connectionId,
    versionId: f.versionId,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    ...overrides,
  };
}

async function insertAuthorization(client: pg.Client, input: AuthorizationInput): Promise<string> {
  const result = await client.query<{ id: string }>(INSERT_AUTHORIZATION, authorizationParams(input));
  return result.rows[0]!.id;
}

async function expectAuthorizationError(input: AuthorizationInput, code: string, constraint: string, client = clients.runtime) {
  await expectSqlError(client, INSERT_AUTHORIZATION, authorizationParams(input), { code, constraint });
}

describe("ownership and provenance", () => {
  it("stores a USER_BYO authorization bound to the exact credential version, in the fail-closed ISSUED state", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-valid");
      const id = await insertAuthorization(clients.runtime, forFixture(f, { idempotencyKey: "issue-1" }));

      const row = await clients.runtime.query(
        `SELECT account_id, production_id, entitlement_grant_id, billing_mode, provider, provider_connection_id,
                provider_credential_version_id, generation_request, generation_request_sha256, expected_cost_cap_unit,
                expected_cost_cap_amount, status, claimed_at, expired_at, cancelled_at
           FROM generation_authorizations WHERE id = $1`,
        [id],
      );
      expect(row.rows).toEqual([
        {
          account_id: f.accountId,
          production_id: f.productionId,
          entitlement_grant_id: f.grantId,
          billing_mode: "USER_BYO",
          provider: "EXAMPLE_PROVIDER",
          provider_connection_id: f.connectionId,
          provider_credential_version_id: f.versionId,
          generation_request: REQUEST,
          generation_request_sha256: sha256(REQUEST),
          expected_cost_cap_unit: "MICRO_USD",
          expected_cost_cap_amount: "2000000",
          status: "ISSUED",
          claimed_at: null,
          expired_at: null,
          cancelled_at: null,
        },
      ]);

      // Grant provenance neither reserves nor consumes the grant.
      const grant = await clients.runtime.query("SELECT state, reserved_at, consumed_at FROM entitlement_grants WHERE id = $1", [f.grantId]);
      expect(grant.rows).toEqual([{ state: "AVAILABLE", reserved_at: null, consumed_at: null }]);
    });
  });

  it("rejects another account's production, grant, connection or credential version", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const a = await fixture(clients.runtime, "ga-owner-a");
      const b = await fixture(clients.runtime, "ga-owner-b");

      await expectAuthorizationError(forFixture(a, { productionId: b.productionId }), FOREIGN_KEY, "generation_authorizations_production_same_account_fk");
      await expectAuthorizationError(forFixture(a, { grantId: b.grantId }), FOREIGN_KEY, "generation_authorizations_grant_same_account_fk");
      await expectAuthorizationError(
        forFixture(a, { connectionId: b.connectionId, versionId: b.versionId }),
        FOREIGN_KEY,
        "generation_authorizations_connection_same_account_fk",
      );
      await expectAuthorizationError(forFixture(a, { versionId: b.versionId }), FOREIGN_KEY, "generation_authorizations_credential_version_same_connection_fk");

      // Even with every identifier from Account B, Account A cannot own the row.
      await expectAuthorizationError(
        forFixture(b, { accountId: a.accountId, userId: a.userId }),
        FOREIGN_KEY,
        "generation_authorizations_production_same_account_fk",
      );
    });
  });

  it("rejects a credential version from another connection of the same account", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-cross-connection");
      const otherConnection = await insertConnection(clients.runtime, f);
      const otherVersion = await insertVersion(clients.runtime, f, otherConnection);

      await expectAuthorizationError(forFixture(f, { versionId: otherVersion }), FOREIGN_KEY, "generation_authorizations_credential_version_same_connection_fk");
      await expectAuthorizationError(forFixture(f, { connectionId: otherConnection }), FOREIGN_KEY, "generation_authorizations_credential_version_same_connection_fk");
      // A random UUID is not a credential version either.
      await expectAuthorizationError(
        forFixture(f, { versionId: "00000000-0000-4000-8000-000000000000" }),
        FOREIGN_KEY,
        "generation_authorizations_credential_version_same_connection_fk",
      );
    });
  });

  it("rejects a requested provider that differs from the bound connection's provider", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-provider-mismatch");
      await expectAuthorizationError(forFixture(f, { provider: "OTHER_PROVIDER" }), FOREIGN_KEY, "generation_authorizations_connection_same_account_fk");
    });
  });
});

describe("billing mode and credential binding", () => {
  it("requires USER_BYO to bind both the connection and the exact credential version", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-user-byo");
      await expectAuthorizationError(forFixture(f, { connectionId: null, versionId: null }), CHECK, "generation_authorizations_credential_binding_ck");
      await expectAuthorizationError(forFixture(f, { versionId: null }), CHECK, "generation_authorizations_credential_binding_ck");
      await expectAuthorizationError(forFixture(f, { connectionId: null }), CHECK, "generation_authorizations_credential_binding_ck");
    });
  });

  it("keeps PLATFORM_HOSTED as vocabulary that cannot be issued and never carries a user credential", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-platform");
      await expectAuthorizationError(
        forFixture(f, { billingMode: "PLATFORM_HOSTED", connectionId: null, versionId: null }),
        CHECK,
        "generation_authorizations_v1_issuable_billing_mode_ck",
      );
      await expectAuthorizationError(forFixture(f, { billingMode: "PLATFORM_HOSTED" }), CHECK, "generation_authorizations_credential_binding_ck");
    });
    // The table owner is bound by the same checks.
    await inRolledBackTransaction(clients.migrator, async () => {
      const f = await fixture(clients.migrator, "ga-platform-owner");
      await expectAuthorizationError(
        forFixture(f, { billingMode: "PLATFORM_HOSTED", connectionId: null, versionId: null }),
        CHECK,
        "generation_authorizations_v1_issuable_billing_mode_ck",
        clients.migrator,
      );
    });
  });

  it.each(["HOSTED_TRIAL", "user_byo", "", "BYO"])("rejects the unknown billing mode %j", async (billingMode) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-mode");
      await expectAuthorizationError(forFixture(f, { billingMode }), CHECK, "generation_authorizations_billing_mode_ck");
    });
  });
});

describe("provider, model, request and cost bounds", () => {
  it.each(["example", "", "1PROVIDER", "EXAMPLE-PROVIDER", `P${"X".repeat(32)}`])("rejects the malformed provider %j", async (provider) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-provider");
      await expectAuthorizationError(forFixture(f, { provider }), CHECK, "generation_authorizations_provider_ck");
    });
  });

  it("accepts bounded model identifiers and rejects malformed or oversized ones", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-model");
      for (const model of ["gen4.5", "example-model_1.0:preview", `m${"x".repeat(127)}`, "models/example-1"]) {
        await insertAuthorization(clients.runtime, forFixture(f, { model }));
      }
      for (const model of ["", " model", "model name", "-model", `m${"x".repeat(128)}`, "model\n"]) {
        await expectAuthorizationError(forFixture(f, { model }), CHECK, "generation_authorizations_model_ck");
      }
    });
  });

  it.each([
    ["an array", [1, 2]],
    ["a string", "prompt"],
    ["a number", 5],
    ["null", null],
    ["an empty object", {}],
    ["an oversized object", { prompt: "x".repeat(16_400) }],
  ])("rejects %s as the generation request", async (_label, request) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-request");
      await expectAuthorizationError(forFixture(f, { request, requestSha256: "a".repeat(64) }), CHECK, "generation_authorizations_generation_request_ck");
    });
  });

  it("accepts a request at the size bound", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-request-bound");
      // {"prompt": "..."} renders as 14 bytes of jsonb text around the value.
      const request = { prompt: "x".repeat(16_384 - 14) };
      await insertAuthorization(clients.runtime, forFixture(f, { request }));
      await expectAuthorizationError(forFixture(f, { request: { prompt: "x".repeat(16_384 - 13) } }), CHECK, "generation_authorizations_generation_request_ck");
    });
  });

  it.each(["A".repeat(64), "a".repeat(63), "a".repeat(65), "g".repeat(64), ""])("rejects the malformed request hash %j", async (requestSha256) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-hash");
      await expectAuthorizationError(forFixture(f, { requestSha256 }), CHECK, "generation_authorizations_generation_request_sha256_ck");
    });
  });

  it("bounds the expected-cost cap to a positive safe integer in a known unit", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-cost");
      await insertAuthorization(clients.runtime, forFixture(f, { costUnit: "PROVIDER_CREDITS", costAmount: 1 }));
      await insertAuthorization(clients.runtime, forFixture(f, { costAmount: "9007199254740991" }));
      for (const costAmount of [0, -1, "9007199254740992"]) {
        await expectAuthorizationError(forFixture(f, { costAmount }), CHECK, "generation_authorizations_expected_cost_cap_amount_ck");
      }
      for (const costUnit of ["USD", "USD_CENTS", "credits", "EXAMPLE_CREDITS"]) {
        await expectAuthorizationError(forFixture(f, { costUnit }), CHECK, "generation_authorizations_expected_cost_cap_unit_ck");
      }
      // Fractional values never reach the column: bigint rejects them.
      await expectSqlError(clients.runtime, INSERT_AUTHORIZATION, authorizationParams(forFixture(f, { costAmount: "1.5" })), { code: "22P02" });
    });
  });
});

describe("lifecycle, expiry and idempotency", () => {
  it.each(["SUBMITTING", "SUBMITTED", "SUCCEEDED", "CONSUMED", "issued"])("rejects the unknown status %j", async (status) => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-status");
      await expectAuthorizationError(forFixture(f, { status }), CHECK, "generation_authorizations_status_ck");
    });
  });

  it("requires each terminal timestamp exactly in its state", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-timestamps");
      const now = new Date().toISOString();
      await expectAuthorizationError(forFixture(f, { status: "CLAIMED" }), CHECK, "generation_authorizations_claimed_at_ck");
      await expectAuthorizationError(forFixture(f, { claimedAt: now }), CHECK, "generation_authorizations_claimed_at_ck");
      await expectAuthorizationError(forFixture(f, { status: "CANCELLED" }), CHECK, "generation_authorizations_cancelled_at_ck");
      await expectAuthorizationError(forFixture(f, { status: "EXPIRED" }), CHECK, "generation_authorizations_expired_at_ck");
      await expectAuthorizationError(forFixture(f, { status: "CLAIMED", claimedAt: now, cancelledAt: now }), CHECK, "generation_authorizations_cancelled_at_ck");
    });
  });

  it("requires expiry after creation, claims before expiry and expiry records after expiry", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-expiry");
      const past = new Date(Date.now() - 60_000).toISOString();
      await expectAuthorizationError(forFixture(f, { expiresAt: past }), CHECK, "generation_authorizations_expires_at_ck");

      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const afterExpiry = new Date(Date.now() + 120_000).toISOString();
      await expectAuthorizationError(
        forFixture(f, { expiresAt, status: "CLAIMED", claimedAt: afterExpiry }),
        CHECK,
        "generation_authorizations_claim_before_expiry_ck",
      );
      await expectAuthorizationError(
        forFixture(f, { expiresAt, status: "EXPIRED", expiredAt: new Date().toISOString() }),
        CHECK,
        "generation_authorizations_expired_after_expiry_ck",
      );
    });
  });

  it("scopes the creation idempotency key to the account and production", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-idempotency");
      await insertAuthorization(clients.runtime, forFixture(f, { idempotencyKey: "issue-1" }));
      await expectAuthorizationError(forFixture(f, { idempotencyKey: "issue-1" }), UNIQUE, "generation_authorizations_creation_idempotency_key_uq");

      const secondProduction = await insertProduction(clients.runtime, f, "Second");
      await insertAuthorization(clients.runtime, forFixture(f, { productionId: secondProduction, idempotencyKey: "issue-1" }));
      // NULL keys never collide.
      await insertAuthorization(clients.runtime, forFixture(f));
      await insertAuthorization(clients.runtime, forFixture(f));

      for (const idempotencyKey of ["", "k".repeat(129)]) {
        await expectAuthorizationError(forFixture(f, { idempotencyKey }), CHECK, "generation_authorizations_creation_idempotency_key_ck");
      }
    });
  });
});

describe("immutability", () => {
  it("lets the runtime role move ISSUED to exactly one terminal state, then nothing", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-lifecycle");
      const claimed = await insertAuthorization(clients.runtime, forFixture(f));
      await clients.runtime.query("UPDATE generation_authorizations SET status = 'CLAIMED', claimed_at = now(), updated_at = now() WHERE id = $1", [claimed]);
      const cancelled = await insertAuthorization(clients.runtime, forFixture(f));
      await clients.runtime.query("UPDATE generation_authorizations SET status = 'CANCELLED', cancelled_at = now() WHERE id = $1", [cancelled]);

      for (const id of [claimed, cancelled]) {
        for (const sql of [
          "UPDATE generation_authorizations SET status = 'ISSUED', claimed_at = NULL, cancelled_at = NULL WHERE id = $1",
          "UPDATE generation_authorizations SET status = 'CANCELLED', claimed_at = NULL, cancelled_at = clock_timestamp() WHERE id = $1",
          "UPDATE generation_authorizations SET claimed_at = claimed_at - interval '1 second', cancelled_at = cancelled_at - interval '1 second' WHERE id = $1",
        ]) {
          await expectSqlError(clients.runtime, sql, [id], { code: CHECK });
        }
        // updated_at alone remains writable.
        await clients.runtime.query("UPDATE generation_authorizations SET updated_at = now() WHERE id = $1", [id]);
      }
      const states = await clients.runtime.query("SELECT status FROM generation_authorizations WHERE id = ANY($1) ORDER BY status", [[claimed, cancelled]]);
      expect(states.rows).toEqual([{ status: "CANCELLED" }, { status: "CLAIMED" }]);
    });
  });

  it.each([
    ["the exact credential version", "provider_credential_version_id = $2", "version"],
    ["the production", "production_id = $2", "production"],
    ["the account", "account_id = $2", "account"],
    ["the connection", "provider_connection_id = $2", "connection"],
    ["the entitlement grant", "entitlement_grant_id = $2", "grant"],
    ["the billing mode", "billing_mode = 'PLATFORM_HOSTED'", null],
    ["the provider", "provider = 'OTHER_PROVIDER'", null],
    ["the model", "model = 'other-model'", null],
    ["the generation request", `generation_request = '{"prompt":"different"}'::jsonb`, null],
    ["the request hash", `generation_request_sha256 = repeat('b', 64)`, null],
    ["the cost cap", "expected_cost_cap_amount = expected_cost_cap_amount + 1", null],
    ["the cost unit", "expected_cost_cap_unit = 'PROVIDER_CREDITS'", null],
    ["the expiry", "expires_at = expires_at + interval '1 day'", null],
    ["the creator", "created_by_user_id = $2", "user"],
    ["the idempotency key", "creation_idempotency_key = 'other'", null],
    ["the creation time", "created_at = now() - interval '1 day'", null],
  ])("denies the runtime role and the owner rewriting %s", async (_label, assignment, replacement) => {
    for (const [client, code] of [
      [clients.runtime, DENIED],
      [clients.migrator, CHECK],
    ] as const) {
      await inRolledBackTransaction(client, async () => {
        const f = await fixture(client, `ga-immutable-${code}`);
        const other = await fixture(client, `ga-immutable-other-${code}`);
        const id = await insertAuthorization(client, forFixture(f, { idempotencyKey: "original" }));
        // Same-account replacements, so only immutability (not a foreign key) can refuse them.
        // A rotated v2 of the same connection: the classic "current credential" substitution.
        await client.query("UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now() WHERE id = $1", [f.versionId]);
        const replacements: Record<string, string> = {
          version: await insertVersion(client, f, f.connectionId, 2),
          production: await insertProduction(client, f, "Replacement"),
          account: other.accountId,
          connection: other.connectionId,
          grant: other.grantId,
          user: other.userId,
        };
        const params = replacement === null ? [id] : [id, replacements[replacement]];
        await expectSqlError(client, `UPDATE generation_authorizations SET ${assignment} WHERE id = $1`, params, { code });
        if (code === CHECK) {
          await client.query("SAVEPOINT message_probe");
          await expect(client.query(`UPDATE generation_authorizations SET ${assignment} WHERE id = $1`, params)).rejects.toMatchObject({
            message: "generation authorization provenance is immutable",
          });
          await client.query("ROLLBACK TO SAVEPOINT message_probe");
        }
      });
    }
  });

  it("keeps historical provenance through rotation, disconnect and destruction", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-history");
      const id = await insertAuthorization(clients.runtime, forFixture(f));

      // Rotate: v1 superseded, v2 active. The authorization still names v1.
      await clients.runtime.query(
        "UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now() WHERE id = $1",
        [f.versionId],
      );
      await insertVersion(clients.runtime, f, f.connectionId, 2);
      // Disconnect and destroy every version.
      await clients.runtime.query("UPDATE provider_connections SET status = 'DISCONNECTED', disconnected_at = now() WHERE id = $1", [f.connectionId]);
      await clients.runtime.query(
        `UPDATE provider_credential_versions
            SET status = 'DESTROYED', destroyed_at = now(), sealed_credential = NULL,
                fingerprint_algorithm = NULL, fingerprint_key_ref = NULL, fingerprint_value = NULL
          WHERE provider_connection_id = $1`,
        [f.connectionId],
      );

      const history = await clients.runtime.query(
        `SELECT a.provider_credential_version_id, v.credential_version, v.status AS version_status, c.status AS connection_status
           FROM generation_authorizations a
           JOIN provider_credential_versions v ON v.id = a.provider_credential_version_id
           JOIN provider_connections c ON c.id = a.provider_connection_id
          WHERE a.id = $1`,
        [id],
      );
      expect(history.rows).toEqual([
        { provider_credential_version_id: f.versionId, credential_version: 1, version_status: "DESTROYED", connection_status: "DISCONNECTED" },
      ]);
    });
  });
});

describe("runtime privileges on generation_authorizations", () => {
  it("can insert, read and lock, but never delete, truncate or run DDL", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      const f = await fixture(clients.runtime, "ga-privileges");
      const id = await insertAuthorization(clients.runtime, forFixture(f));
      const locked = await clients.runtime.query("SELECT id FROM generation_authorizations WHERE id = $1 FOR UPDATE", [id]);
      expect(locked.rowCount).toBe(1);

      for (const sql of [
        "DELETE FROM generation_authorizations",
        "TRUNCATE generation_authorizations",
        "ALTER TABLE generation_authorizations ADD COLUMN probe integer",
        "ALTER TABLE generation_authorizations DISABLE TRIGGER generation_authorizations_guard_update",
        "DROP TABLE generation_authorizations",
        "CREATE TABLE execution_jobs (id uuid)",
      ]) {
        await expectSqlError(clients.runtime, sql, [], { code: DENIED });
      }
    });
  });

  it("holds lifecycle-only UPDATE and no table-wide UPDATE", async () => {
    const privileges = await clients.runtime.query(
      `SELECT has_table_privilege(current_user, 'public.generation_authorizations', 'UPDATE') AS table_update,
              has_table_privilege(current_user, 'public.generation_authorizations', 'DELETE') AS delete,
              has_table_privilege(current_user, 'public.generation_authorizations', 'TRUNCATE') AS truncate,
              has_table_privilege(current_user, 'public.generation_authorizations', 'REFERENCES') AS references,
              has_function_privilege(current_user, 'public.generation_authorizations_guard_update()', 'EXECUTE') AS guard_execute`,
    );
    expect(privileges.rows).toEqual([{ table_update: false, delete: false, truncate: false, references: false, guard_execute: false }]);

    const updatable = await clients.runtime.query<{ attname: string }>(
      `SELECT attname FROM pg_attribute
        WHERE attrelid = 'public.generation_authorizations'::regclass AND attnum > 0 AND NOT attisdropped
          AND has_column_privilege(current_user, attrelid, attnum, 'UPDATE')
        ORDER BY attname`,
    );
    expect(updatable.rows.map((row) => row.attname)).toEqual(["cancelled_at", "claimed_at", "expired_at", "status", "updated_at"]);
  });
});

describe("audit events after migration 0003", () => {
  const INSERT_AUDIT = `INSERT INTO audit_events (actor_type, event_type, resource_type, resource_id, correlation_id)
                        VALUES ('SYSTEM', $1, $2, gen_random_uuid(), gen_random_uuid()) RETURNING id`;

  it("accepts generation_authorization and every earlier resource type, and rejects unknown types", async () => {
    await inRolledBackTransaction(clients.runtime, async () => {
      for (const type of ["user", "account", "entitlement_grant", "production", "provider_connection", "generation_authorization"]) {
        await clients.runtime.query(INSERT_AUDIT, ["generation_authorization.issued", type]);
      }
      for (const type of ["execution_job", "execution_attempt", "worker_principal", "generation_authorizations", "credential"]) {
        await expectSqlError(clients.runtime, INSERT_AUDIT, ["generation_authorization.issued", type], {
          code: CHECK,
          constraint: "audit_events_resource_type_ck",
        });
      }
    });
  });

  it("remains append-only for the runtime role and the owner", async () => {
    await inRolledBackTransaction(clients.migrator, async () => {
      const inserted = await clients.migrator.query<{ id: string }>(INSERT_AUDIT, ["generation_authorization.issued", "generation_authorization"]);
      for (const sql of ["UPDATE audit_events SET event_type = 'x.y' WHERE id = $1", "DELETE FROM audit_events WHERE id = $1"]) {
        await clients.migrator.query("SAVEPOINT audit_probe");
        await expect(clients.migrator.query(sql, [inserted.rows[0]!.id])).rejects.toMatchObject({
          message: expect.stringContaining("audit_events is append-only"),
        });
        await clients.migrator.query("ROLLBACK TO SAVEPOINT audit_probe");
      }
    });
    await inRolledBackTransaction(clients.runtime, async () => {
      const inserted = await clients.runtime.query<{ id: string }>(INSERT_AUDIT, ["generation_authorization.issued", "generation_authorization"]);
      await expectSqlError(clients.runtime, "UPDATE audit_events SET event_type = 'x.y' WHERE id = $1", [inserted.rows[0]!.id], { code: DENIED });
      await expectSqlError(clients.runtime, "DELETE FROM audit_events WHERE id = $1", [inserted.rows[0]!.id], { code: DENIED });
      await expectSqlError(clients.runtime, "TRUNCATE audit_events", [], { code: DENIED });
    });
  });
});
