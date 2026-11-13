import { randomBytes, randomUUID } from "node:crypto";

import type pg from "pg";
import {
  GOOGLE_MODEL,
  GOOGLE_PROVIDER_ID,
  generationRequestSha256,
  RUNWAY_MODEL,
  RUNWAY_PROVIDER_ID,
} from "commercial-worker-protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimeClient, type TransactionalPool } from "../../src/database/runtimePool.js";
import {
  createGenerationAuthorityPolicyRegistry,
  PRODUCTION_GENERATION_AUTHORITY_POLICY_REGISTRY,
  type GenerationAuthorityPolicyRegistry,
  type GenerationCapability,
} from "../../src/generationAuthorizations/generationAuthorityPolicy.js";
import { GenerationAuthorizationError } from "../../src/generationAuthorizations/generationAuthorizationError.js";
import {
  issueGenerationAuthorization,
  type IssueGenerationAuthorizationResult,
} from "../../src/generationAuthorizations/generationAuthorizationService.js";
import { FREE_BYO_ISSUANCE_KEY, FREE_BYO_POLICY_VERSION } from "../../src/provisioning/provisionPersonalAccountForIdentity.js";
import {
  connectAs,
  expectSqlError,
  inRolledBackTransaction,
  openGuardedClients,
  prepareSchemaV1,
  type GuardedClients,
} from "./support/testDatabase.js";
import { APPROVED_RUNTIME_ROLE } from "./support/testDatabaseGuard.js";

// R44B11C issuance against PostgreSQL 16 on the dedicated test database. The
// service always runs as the restricted runtime role through a real runtime
// pool; fixtures are committed by the migration role. Lock races are
// coordinated by PostgreSQL itself: a waiting session is observed through
// pg_blocking_pids(), never inferred from elapsed time.

let clients: GuardedClients;
let pool: TransactionalPool;
const pools: TransactionalPool[] = [];

async function runtimePool(): Promise<TransactionalPool> {
  const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl }, "development");
  const created = await createRuntimePool(config!, () => {});
  pools.push(created);
  return created;
}

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
  pool = await runtimePool();
});

afterAll(async () => {
  await Promise.all(pools.splice(0).map((created) => created.end()));
  await prepareSchemaV1(clients);
  await clients.close();
});

const GOOGLE_REQUEST = Object.freeze({
  prompt: "A lighthouse at dawn",
  // Opaque at issuance: stored exactly as given, never inspected.
  referenceImage: Object.freeze({ kind: "opaque-fixture", nested: Object.freeze([1, "two", null]) }),
  resolution: "720p",
});
const RUNWAY_REQUEST = Object.freeze({ prompt: "A paper boat on a canal", referenceImage: null, durationSeconds: 4 });

const googleCapability = (overrides: Partial<GenerationCapability> = {}): GenerationCapability => ({
  generationPolicyVersion: "test-generation-v1",
  provider: GOOGLE_PROVIDER_ID,
  model: GOOGLE_MODEL,
  claimLifetimeSeconds: 900,
  expectedCostAmount: () => 2_500_000,
  ...overrides,
});
const runwayCapability = (overrides: Partial<GenerationCapability> = {}): GenerationCapability => ({
  generationPolicyVersion: "test-generation-v1",
  provider: RUNWAY_PROVIDER_ID,
  model: RUNWAY_MODEL,
  claimLifetimeSeconds: 600,
  expectedCostAmount: (request) => ("durationSeconds" in request ? request.durationSeconds * 25 : 0),
  ...overrides,
});
const REGISTRY = createGenerationAuthorityPolicyRegistry([googleCapability(), runwayCapability()]);

type Fixture = Readonly<{
  userId: string;
  accountId: string;
  grantId: string;
  productionId: string;
  connectionId: string;
  versionId: string;
}>;

async function one(sql: string, params: unknown[]): Promise<string> {
  return (await clients.migrator.query<{ id: string }>(sql, params)).rows[0]!.id;
}

async function insertConnection(accountId: string, userId: string, provider = GOOGLE_PROVIDER_ID): Promise<string> {
  return one(
    `INSERT INTO provider_connections
       (account_id, provider, credential_kind, status, verification_status, last_verification_attempt_at, verified_at, created_by_user_id)
     VALUES ($1, $2, 'API_KEY', 'ACTIVE', 'VERIFIED', now(), now(), $3) RETURNING id`,
    [accountId, provider, userId],
  );
}

type VersionStatus = "ACTIVE" | "SUPERSEDED" | "RETAINED_FOR_RECOVERY" | "DESTROYED";

async function insertVersion(f: Pick<Fixture, "accountId" | "userId">, connectionId: string, credentialVersion: number, status: VersionStatus): Promise<string> {
  const destroyed = status === "DESTROYED";
  return one(
    `INSERT INTO provider_credential_versions
       (account_id, provider_connection_id, credential_version, status, sealed_credential, fingerprint_algorithm,
        fingerprint_key_ref, fingerprint_value, created_by_user_id, superseded_at, retained_for_recovery_at, destroyed_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9,
             CASE WHEN $4 = 'SUPERSEDED' THEN now() END,
             CASE WHEN $4 = 'RETAINED_FOR_RECOVERY' THEN now() END,
             CASE WHEN $4 = 'DESTROYED' THEN now() END)
     RETURNING id`,
    [
      f.accountId,
      connectionId,
      credentialVersion,
      status,
      destroyed ? null : '{"format":"fixture-envelope"}',
      destroyed ? null : "HMAC-SHA-256",
      destroyed ? null : "fixture/v1",
      destroyed ? null : randomBytes(32).toString("base64url"),
      f.userId,
    ],
  );
}

// A User, PERSONAL Account and AVAILABLE FREE_BYO grant exactly as
// provisioning issues them: under the source-controlled FREE_BYO policy
// version, which issuance resolves. (The shared insertAccountWithFreeGrant()
// helper seeds a schema-only 'test-policy' version that the application
// policy deliberately does not resolve.)
async function insertIssuanceOwner(subject: string): Promise<Readonly<{ userId: string; accountId: string; grantId: string }>> {
  const userId = await one("INSERT INTO users (idp_issuer, idp_subject) VALUES ('https://issuer.test', $1) RETURNING id", [subject]);
  const accountId = await one("INSERT INTO accounts (kind, owner_user_id) VALUES ('PERSONAL', $1) RETURNING id", [userId]);
  const grantId = await one(
    `INSERT INTO entitlement_grants (account_id, kind, state, source, issuance_key, policy_version)
     VALUES ($1, 'FREE_BYO', 'AVAILABLE', 'ACCOUNT_PROVISIONING', $2, $3) RETURNING id`,
    [accountId, FREE_BYO_ISSUANCE_KEY, FREE_BYO_POLICY_VERSION],
  );
  return { userId, accountId, grantId };
}

async function fixture(label: string, options: Readonly<{ provider?: string; withVersion?: boolean }> = {}): Promise<Fixture> {
  const owner = await insertIssuanceOwner(`${label}-${randomUUID()}`);
  const productionId = await one(
    `INSERT INTO productions (account_id, title, creation_entitlement_grant_id, created_by_user_id)
     VALUES ($1, 'Production', $2, $3) RETURNING id`,
    [owner.accountId, owner.grantId, owner.userId],
  );
  const connectionId = await insertConnection(owner.accountId, owner.userId, options.provider);
  const versionId = options.withVersion === false ? "" : await insertVersion(owner, connectionId, 1, "ACTIVE");
  return { ...owner, productionId, connectionId, versionId };
}

const principalOf = (f: Fixture) => ({ userId: f.userId, accountId: f.accountId });

function intentFor(f: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    productionId: f.productionId,
    providerConnectionId: f.connectionId,
    model: GOOGLE_MODEL,
    generationRequest: GOOGLE_REQUEST,
    idempotencyKey: "issue-1",
    ...overrides,
  };
}

function issueAs(
  f: Fixture,
  overrides: Record<string, unknown> = {},
  options: Readonly<{ policy?: GenerationAuthorityPolicyRegistry; pool?: TransactionalPool; principal?: { userId: string; accountId: string } }> = {},
): Promise<IssueGenerationAuthorizationResult> {
  return issueGenerationAuthorization(
    { pool: options.pool ?? pool, policy: options.policy ?? REGISTRY },
    options.principal ?? principalOf(f),
    intentFor(f, overrides),
  );
}

async function expectRefusal(promise: Promise<unknown>, code: string): Promise<GenerationAuthorizationError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(GenerationAuthorizationError);
  expect((error as GenerationAuthorizationError).code).toBe(code);
  return error as GenerationAuthorizationError;
}

async function authorizationRows(accountId: string) {
  return (await clients.migrator.query("SELECT * FROM generation_authorizations WHERE account_id = $1 ORDER BY created_at, id", [accountId])).rows;
}

async function sideEffects(accountId: string) {
  const result = await clients.migrator.query<{ authorizations: number; audits: number; usage: number; jobs: number; attempts: number }>(
    `SELECT (SELECT count(*)::int FROM generation_authorizations WHERE account_id = $1) AS authorizations,
            (SELECT count(*)::int FROM audit_events WHERE account_id = $1 AND event_type = 'generation_authorization.issued') AS audits,
            (SELECT count(*)::int FROM generation_usage_ledger WHERE account_id = $1) AS usage,
            (SELECT count(*)::int FROM execution_jobs WHERE account_id = $1) AS jobs,
            (SELECT count(*)::int FROM execution_attempts WHERE account_id = $1) AS attempts`,
    [accountId],
  );
  return result.rows[0]!;
}

const NOTHING = { authorizations: 0, audits: 0, usage: 0, jobs: 0, attempts: 0 };
const ONE_AUTHORIZATION = { authorizations: 1, audits: 1, usage: 0, jobs: 0, attempts: 0 };

async function grantRow(grantId: string) {
  return (
    await clients.migrator.query("SELECT state, reserved_at, consumed_at, revoked_at, expired_at, policy_version, updated_at FROM entitlement_grants WHERE id = $1", [
      grantId,
    ])
  ).rows[0];
}

async function clockText(): Promise<string> {
  return (await clients.migrator.query<{ at: string }>("SELECT clock_timestamp()::text AS at")).rows[0]!.at;
}

describe("test database identity", () => {
  it("is PostgreSQL 16 on 127.0.0.1:5433, database busybookie_commercial_test, with the service as the runtime role", async () => {
    const identity = await clients.migrator.query<{ database: string; port: number; address: string; version: number }>(
      `SELECT current_database() AS database, inet_server_port() AS port, host(inet_server_addr()) AS address,
              current_setting('server_version_num')::int AS version`,
    );
    expect(identity.rows[0]!.database).toBe("busybookie_commercial_test");
    expect(identity.rows[0]!.port).toBe(5433);
    expect(identity.rows[0]!.address).toBe("127.0.0.1");
    expect(identity.rows[0]!.version).toBeGreaterThanOrEqual(160000);
    expect(identity.rows[0]!.version).toBeLessThan(170000);
    const runtime = await pool.query<{ user: string; port: number }>("SELECT current_user AS user, inet_server_port() AS port");
    expect(runtime.rows).toEqual([{ user: APPROVED_RUNTIME_ROLE, port: 5433 }]);
  });
});

describe("A. new issuance", () => {
  it("issues one immutable ISSUED USER_BYO authorization with exact provenance, shared hash, server cost cap, database-clock expiry and one audit event", async () => {
    const f = await fixture("issue-google");
    const grantBefore = await grantRow(f.grantId);
    const before = await clockText();

    const result = await issueGenerationAuthorization({ pool, policy: REGISTRY }, principalOf(f), intentFor(f), {
      correlationId: "12345678-1234-4234-8234-123456789012",
    });

    const after = await clockText();
    expect(result.created).toBe(true);
    const [row] = await authorizationRows(f.accountId);
    expect(row).toMatchObject({
      id: result.authorization.id,
      account_id: f.accountId,
      production_id: f.productionId,
      entitlement_grant_id: f.grantId,
      billing_mode: "USER_BYO",
      provider: GOOGLE_PROVIDER_ID,
      model: GOOGLE_MODEL,
      provider_connection_id: f.connectionId,
      provider_credential_version_id: f.versionId,
      generation_request: GOOGLE_REQUEST,
      generation_request_sha256: generationRequestSha256(GOOGLE_REQUEST),
      expected_cost_cap_unit: "MICRO_USD",
      expected_cost_cap_amount: "2500000",
      status: "ISSUED",
      claimed_at: null,
      expired_at: null,
      cancelled_at: null,
      created_by_user_id: f.userId,
      creation_idempotency_key: "issue-1",
    });
    expect(result.authorization).toMatchObject({ expectedCostCapAmount: 2_500_000, providerCredentialVersionId: f.versionId, status: "ISSUED" });

    // expires_at is database clock_timestamp() at insert plus exactly the policy lifetime.
    const expiry = await clients.migrator.query(
      `SELECT expires_at >= $2::timestamptz + interval '900 seconds' AS not_early,
              expires_at <= $3::timestamptz + interval '900 seconds' AS not_late,
              expires_at > created_at AS after_creation
         FROM generation_authorizations WHERE id = $1`,
      [result.authorization.id, before, after],
    );
    expect(expiry.rows).toEqual([{ not_early: true, not_late: true, after_creation: true }]);

    const audit = await clients.migrator.query(
      `SELECT actor_type, actor_user_id, event_type, resource_type, resource_id, correlation_id, metadata
         FROM audit_events WHERE account_id = $1 AND event_type LIKE 'generation_authorization.%'`,
      [f.accountId],
    );
    expect(audit.rows).toEqual([
      {
        actor_type: "USER",
        actor_user_id: f.userId,
        event_type: "generation_authorization.issued",
        resource_type: "generation_authorization",
        resource_id: result.authorization.id,
        correlation_id: "12345678-1234-4234-8234-123456789012",
        metadata: { entitlementPolicyVersion: "free-byo-v1", generationPolicyVersion: "test-generation-v1" },
      },
    ]);
    expect(await sideEffects(f.accountId)).toEqual(ONE_AUTHORIZATION);
    expect(await grantRow(f.grantId)).toEqual(grantBefore);

    // Provenance is immutable after issuance, even for the owner.
    await inRolledBackTransaction(clients.migrator, async () => {
      await expectSqlError(clients.migrator, "UPDATE generation_authorizations SET expected_cost_cap_amount = 1 WHERE id = $1", [result.authorization.id], {
        code: "23514",
      });
    });
  });

  it("issues a Runway authorization in PROVIDER_CREDITS and generates a correlation ID when none is supplied", async () => {
    const f = await fixture("issue-runway", { provider: RUNWAY_PROVIDER_ID });
    const result = await issueAs(f, { model: RUNWAY_MODEL, generationRequest: RUNWAY_REQUEST });
    expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await authorizationRows(f.accountId)).toEqual([
      expect.objectContaining({
        provider: RUNWAY_PROVIDER_ID,
        model: RUNWAY_MODEL,
        generation_request: RUNWAY_REQUEST,
        generation_request_sha256: generationRequestSha256(RUNWAY_REQUEST),
        expected_cost_cap_unit: "PROVIDER_CREDITS",
        expected_cost_cap_amount: "100",
      }),
    ]);
  });

  it("rolls back the inserted authorization when the audit write fails, leaving nothing behind", async () => {
    const f = await fixture("issue-audit-failure");
    const grantBefore = await grantRow(f.grantId);
    let insertedAuthorizationId: string | undefined;
    let auditAttempted = false;
    // Every statement runs on the real runtime session, including the
    // authorization INSERT; only the audit INSERT fails, before reaching PostgreSQL.
    const failingAudit: TransactionalPool = {
      ...pool,
      connect: async () => {
        const client = await pool.connect();
        return {
          query: async <Row extends object>(sql: string, params?: unknown[]) => {
            if (/INSERT INTO audit_events/.test(sql)) {
              auditAttempted = true;
              throw Object.assign(new Error("synthetic audit failure"), { code: "XX000" });
            }
            const result = await client.query<Row>(sql, params);
            if (/INSERT INTO generation_authorizations/.test(sql)) {
              insertedAuthorizationId = (result.rows[0] as { id?: string } | undefined)?.id;
            }
            return result;
          },
          release: (error?: Error) => client.release(error),
        };
      },
    };

    const error = await expectRefusal(issueAs(f, {}, { pool: failingAudit }), "GENERATION_AUTHORIZATION_DATABASE_FAILURE");

    expect(error.databaseCode).toBe("XX000");
    expect(insertedAuthorizationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(auditAttempted).toBe(true);
    expect((await clients.migrator.query("SELECT id FROM generation_authorizations WHERE id = $1", [insertedAuthorizationId])).rows).toEqual([]);
    expect(await sideEffects(f.accountId)).toEqual(NOTHING);
    expect(await grantRow(f.grantId)).toEqual(grantBefore);
  });

  it("refuses a request outside the shared contract before insertion", async () => {
    const f = await fixture("issue-invalid-request");
    await expectRefusal(issueAs(f, { generationRequest: { ...GOOGLE_REQUEST, resolution: "1080p" } }), "GENERATION_REQUEST_INVALID");
    await expectRefusal(issueAs(f, { generationRequest: { ...GOOGLE_REQUEST, extra: true } }), "GENERATION_REQUEST_INVALID");
    expect(await sideEffects(f.accountId)).toEqual(NOTHING);
  });
});

describe("B. active principal", () => {
  it("refuses a disabled User, a disabled Account and an Account the User does not own", async () => {
    const disabledUser = await fixture("principal-user");
    await clients.migrator.query("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [disabledUser.userId]);
    expect((await expectRefusal(issueAs(disabledUser), "PRINCIPAL_UNAVAILABLE")).reason).toBe("USER_DISABLED");

    const disabledAccount = await fixture("principal-account");
    await clients.migrator.query("UPDATE accounts SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [disabledAccount.accountId]);
    expect((await expectRefusal(issueAs(disabledAccount), "PRINCIPAL_UNAVAILABLE")).reason).toBe("ACCOUNT_DISABLED");

    const owner = await fixture("principal-owner");
    const other = await fixture("principal-other");
    const mismatch = { userId: owner.userId, accountId: other.accountId };
    expect((await expectRefusal(issueAs(other, {}, { principal: mismatch }), "PRINCIPAL_UNAVAILABLE")).reason).toBe("ACCOUNT_NOT_OWNED");

    for (const f of [disabledUser, disabledAccount, owner, other]) expect(await sideEffects(f.accountId)).toEqual(NOTHING);
  });
});

describe("C. Production", () => {
  it("refuses a foreign or archived Production", async () => {
    const f = await fixture("production-own");
    const other = await fixture("production-other");
    await expectRefusal(issueAs(f, { productionId: other.productionId }), "PRODUCTION_UNAVAILABLE");
    await clients.migrator.query("UPDATE productions SET archived_at = now() WHERE id = $1", [f.productionId]);
    await expectRefusal(issueAs(f), "PRODUCTION_UNAVAILABLE");
    expect(await sideEffects(f.accountId)).toEqual(NOTHING);
    expect(await sideEffects(other.accountId)).toEqual(NOTHING);
  });
});

describe("D. entitlement", () => {
  it.each([
    ["RESERVED", "reserved_at"],
    ["CONSUMED", "consumed_at"],
    ["REVOKED", "revoked_at"],
    ["EXPIRED", "expired_at"],
  ])("refuses the Production's grant in %s", async (state, column) => {
    const f = await fixture(`grant-${state.toLowerCase()}`);
    await clients.migrator.query(`UPDATE entitlement_grants SET state = $2, ${column} = now() WHERE id = $1`, [f.grantId, state]);
    await expectRefusal(issueAs(f), "ENTITLEMENT_NOT_AVAILABLE");
    expect(await sideEffects(f.accountId)).toEqual(NOTHING);
  });

  it("refuses an unsupported FREE_BYO policy version", async () => {
    const f = await fixture("grant-policy");
    await clients.migrator.query("UPDATE entitlement_grants SET policy_version = 'free-byo-v999' WHERE id = $1", [f.grantId]);
    await expectRefusal(issueAs(f), "ENTITLEMENT_POLICY_UNSUPPORTED");
    expect(await sideEffects(f.accountId)).toEqual(NOTHING);
  });

  it("never substitutes another AVAILABLE grant for the Production's exact grant", async () => {
    const f = await fixture("grant-exact");
    const other = await fixture("grant-other-available");
    await clients.migrator.query("UPDATE entitlement_grants SET state = 'REVOKED', revoked_at = now() WHERE id = $1", [f.grantId]);
    expect((await grantRow(other.grantId))!.state).toBe("AVAILABLE");
    await expectRefusal(issueAs(f), "ENTITLEMENT_NOT_AVAILABLE");
    expect(await sideEffects(f.accountId)).toEqual(NOTHING);
  });

  it("cannot even represent a non-FREE_BYO, second or foreign grant for a Production (covered by the scripted suite)", async () => {
    // The schema makes these states unrepresentable, so the service's refusal of
    // them is proven in tests/generationAuthorizations with a scripted database.
    const f = await fixture("grant-unrepresentable");
    const other = await fixture("grant-unrepresentable-other");
    await inRolledBackTransaction(clients.migrator, async () => {
      await expectSqlError(
        clients.migrator,
        `INSERT INTO entitlement_grants (account_id, kind, state, source, issuance_key, policy_version)
         VALUES ($1, 'HOSTED_TRIAL', 'AVAILABLE', 'ACCOUNT_PROVISIONING', 'second', 'free-byo-v1')`,
        [f.accountId],
        { code: "23514", constraint: "entitlement_grants_v1_issuable_kind_ck" },
      );
      await expectSqlError(
        clients.migrator,
        `INSERT INTO entitlement_grants (account_id, kind, state, source, issuance_key, policy_version)
         VALUES ($1, 'FREE_BYO', 'AVAILABLE', 'ACCOUNT_PROVISIONING', 'second', 'free-byo-v1')`,
        [f.accountId],
        { code: "23505", constraint: "entitlement_grants_initial_free_byo_uq" },
      );
      await expectSqlError(clients.migrator, "UPDATE productions SET creation_entitlement_grant_id = $2 WHERE id = $1", [f.productionId, other.grantId], {
        code: "23503",
        constraint: "productions_creation_grant_same_account_fk",
      });
    });
  });
});

describe("E. ProviderConnection", () => {
  it("refuses a foreign or missing connection", async () => {
    const f = await fixture("connection-own");
    const other = await fixture("connection-other");
    await expectRefusal(issueAs(f, { providerConnectionId: other.connectionId }), "PROVIDER_CONNECTION_UNAVAILABLE");
    await expectRefusal(issueAs(f, { providerConnectionId: randomUUID() }), "PROVIDER_CONNECTION_UNAVAILABLE");
    expect(await sideEffects(f.accountId)).toEqual(NOTHING);
  });

  it.each([
    ["PENDING_VERIFICATION", "status = 'PENDING_VERIFICATION'"],
    ["INVALID", "status = 'INVALID'"],
    ["DISCONNECTED", "status = 'DISCONNECTED', disconnected_at = now()"],
    ["DISABLED", "status = 'DISABLED', disabled_at = now()"],
    ["UNVERIFIED", "verification_status = 'UNVERIFIED'"],
    ["FAILED verification", "verification_status = 'FAILED'"],
  ])("refuses a %s connection", async (label, assignment) => {
    const f = await fixture(`connection-${label.toLowerCase().replace(/\W+/g, "-")}`);
    await clients.migrator.query(`UPDATE provider_connections SET ${assignment} WHERE id = $1`, [f.connectionId]);
    await expectRefusal(issueAs(f), "PROVIDER_CONNECTION_UNAVAILABLE");
    expect(await sideEffects(f.accountId)).toEqual(NOTHING);
  });
});

describe("F. credential version", () => {
  it("refuses a connection with no credential version", async () => {
    const f = await fixture("credential-none", { withVersion: false });
    await expectRefusal(issueAs(f), "CREDENTIAL_UNAVAILABLE");
    expect(await sideEffects(f.accountId)).toEqual(NOTHING);
  });

  it.each(["SUPERSEDED", "RETAINED_FOR_RECOVERY", "DESTROYED"] as const)(
    "refuses a newest %s version and never substitutes the older ACTIVE one",
    async (status) => {
      const f = await fixture(`credential-${status.toLowerCase()}`);
      await insertVersion(f, f.connectionId, 2, status);
      const versions = await clients.migrator.query("SELECT credential_version, status FROM provider_credential_versions WHERE provider_connection_id = $1 ORDER BY 1", [
        f.connectionId,
      ]);
      expect(versions.rows).toEqual([
        { credential_version: 1, status: "ACTIVE" },
        { credential_version: 2, status },
      ]);
      await expectRefusal(issueAs(f), "CREDENTIAL_UNAVAILABLE");
      expect(await sideEffects(f.accountId)).toEqual(NOTHING);
    },
  );

  it("binds the exact newest ACTIVE version", async () => {
    const f = await fixture("credential-newest", { withVersion: false });
    await insertVersion(f, f.connectionId, 1, "SUPERSEDED");
    const newest = await insertVersion(f, f.connectionId, 2, "ACTIVE");
    const result = await issueAs(f);
    expect(result.authorization.providerCredentialVersionId).toBe(newest);
  });
});

describe("G. generation capability", () => {
  it("refuses issuance under the empty production registry", async () => {
    const f = await fixture("capability-production");
    await expectRefusal(issueAs(f, {}, { policy: PRODUCTION_GENERATION_AUTHORITY_POLICY_REGISTRY }), "GENERATION_CAPABILITY_UNAVAILABLE");
    expect(await sideEffects(f.accountId)).toEqual(NOTHING);
  });

  it("refuses an unsupported provider/model pair", async () => {
    const google = await fixture("capability-mismatch");
    await expectRefusal(issueAs(google, { model: RUNWAY_MODEL, generationRequest: RUNWAY_REQUEST }), "GENERATION_CAPABILITY_UNAVAILABLE");
    const example = await fixture("capability-unknown", { provider: "EXAMPLE_PROVIDER" });
    await expectRefusal(issueAs(example), "GENERATION_CAPABILITY_UNAVAILABLE");
    const googleOnly = createGenerationAuthorityPolicyRegistry([googleCapability()]);
    const runway = await fixture("capability-not-enabled", { provider: RUNWAY_PROVIDER_ID });
    await expectRefusal(issueAs(runway, { model: RUNWAY_MODEL, generationRequest: RUNWAY_REQUEST }, { policy: googleOnly }), "GENERATION_CAPABILITY_UNAVAILABLE");
    for (const f of [google, example, runway]) expect(await sideEffects(f.accountId)).toEqual(NOTHING);
  });
});

describe("H. idempotency", () => {
  it("returns the original on exact replay with no second audit, expiry extension or cost refresh", async () => {
    const f = await fixture("replay-exact");
    const first = await issueAs(f);
    const [original] = await authorizationRows(f.accountId);

    // Same request with members in another order: same canonical hash.
    const reordered = { resolution: "720p", referenceImage: GOOGLE_REQUEST.referenceImage, prompt: GOOGLE_REQUEST.prompt };
    const changedPolicy = createGenerationAuthorityPolicyRegistry([
      googleCapability({ generationPolicyVersion: "test-generation-v2", claimLifetimeSeconds: 7200, expectedCostAmount: () => 1 }),
    ]);
    const replay = await issueAs(f, { generationRequest: reordered }, { policy: changedPolicy });

    expect(replay.created).toBe(false);
    expect(replay.authorization).toEqual(first.authorization);
    expect(await authorizationRows(f.accountId)).toEqual([original]);
    expect(await sideEffects(f.accountId)).toEqual(ONE_AUTHORIZATION);
  });

  it("never rebinds a replay to a credential rotated in after issuance", async () => {
    const f = await fixture("replay-rotation");
    const first = await issueAs(f);
    // A committed rotation, then re-verification: v2 is now the current ACTIVE credential.
    await clients.migrator.query("UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now() WHERE id = $1", [f.versionId]);
    const v2 = await insertVersion(f, f.connectionId, 2, "ACTIVE");

    const replay = await issueAs(f);
    expect(replay.created).toBe(false);
    expect(replay.authorization.providerCredentialVersionId).toBe(f.versionId);
    // A genuinely new issuance does see the rotation.
    const fresh = await issueAs(f, { idempotencyKey: "issue-2" });
    expect(fresh.authorization.providerCredentialVersionId).toBe(v2);
    expect(first.authorization.providerCredentialVersionId).toBe(f.versionId);
  });

  it.each([
    ["CLAIMED", "status = 'CLAIMED', claimed_at = now()"],
    ["CANCELLED", "status = 'CANCELLED', cancelled_at = now()"],
    ["EXPIRED", "status = 'EXPIRED', expired_at = expires_at"],
  ])("returns a %s original unchanged on replay", async (status, assignment) => {
    const f = await fixture(`replay-${status.toLowerCase()}`);
    const first = await issueAs(f);
    await clients.migrator.query(`UPDATE generation_authorizations SET ${assignment} WHERE id = $1`, [first.authorization.id]);
    const [moved] = await authorizationRows(f.accountId);

    const replay = await issueAs(f);
    expect(replay).toMatchObject({ created: false, authorization: { id: first.authorization.id, status } });
    expect(await authorizationRows(f.accountId)).toEqual([moved]);
    expect(await sideEffects(f.accountId)).toEqual(ONE_AUTHORIZATION);
  });

  it("returns a past-due ISSUED original unchanged, without resurrecting or extending it", async () => {
    const f = await fixture("replay-past-due");
    const shortLived = createGenerationAuthorityPolicyRegistry([googleCapability({ claimLifetimeSeconds: 1 })]);
    const first = await issueAs(f, {}, { policy: shortLived });
    // Wait for the database clock (the expiry authority) to pass expires_at.
    const deadline = Date.now() + 10_000;
    for (;;) {
      const due = await clients.migrator.query<{ due: boolean }>("SELECT clock_timestamp() > expires_at AS due FROM generation_authorizations WHERE id = $1", [
        first.authorization.id,
      ]);
      if (due.rows[0]!.due) break;
      if (Date.now() > deadline) throw new Error("expiry never passed");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const [original] = await authorizationRows(f.accountId);

    const replay = await issueAs(f);
    expect(replay).toMatchObject({ created: false, authorization: { status: "ISSUED", expiresAt: first.authorization.expiresAt } });
    expect(await authorizationRows(f.accountId)).toEqual([original]);
    expect(await sideEffects(f.accountId)).toEqual(ONE_AUTHORIZATION);
  });

  it("revalidates only the active principal on replay", async () => {
    const f = await fixture("replay-eligibility");
    const first = await issueAs(f);
    await clients.migrator.query("UPDATE productions SET archived_at = now() WHERE id = $1", [f.productionId]);
    await clients.migrator.query("UPDATE provider_connections SET status = 'DISCONNECTED', disconnected_at = now() WHERE id = $1", [f.connectionId]);
    await clients.migrator.query("UPDATE entitlement_grants SET state = 'REVOKED', revoked_at = now() WHERE id = $1", [f.grantId]);
    expect((await issueAs(f)).authorization).toEqual(first.authorization);

    await clients.migrator.query("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [f.userId]);
    await expectRefusal(issueAs(f), "PRINCIPAL_UNAVAILABLE");
    expect(await sideEffects(f.accountId)).toEqual(ONE_AUTHORIZATION);
  });

  it("treats the same key with a different connection, model or request as a conflict", async () => {
    const f = await fixture("replay-conflict");
    await issueAs(f);
    const secondConnection = await insertConnection(f.accountId, f.userId);
    await insertVersion(f, secondConnection, 1, "ACTIVE");

    await expectRefusal(issueAs(f, { providerConnectionId: secondConnection }), "IDEMPOTENCY_KEY_CONFLICT");
    await expectRefusal(issueAs(f, { model: RUNWAY_MODEL, generationRequest: RUNWAY_REQUEST }), "IDEMPOTENCY_KEY_CONFLICT");
    await expectRefusal(issueAs(f, { generationRequest: { ...GOOGLE_REQUEST, prompt: "A different prompt" } }), "IDEMPOTENCY_KEY_CONFLICT");
    expect(await sideEffects(f.accountId)).toEqual(ONE_AUTHORIZATION);
  });

  it("commits exactly one authorization and one audit event for concurrent same-key issuance", async () => {
    const f = await fixture("replay-concurrent");
    const parties = 4;
    const racePools = await Promise.all(Array.from({ length: parties }, () => runtimePool()));
    // Every party holds a checked-out session before any begins its transaction.
    let arrived = 0;
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const barrierPool = (base: TransactionalPool): TransactionalPool => ({
      ...base,
      connect: async () => {
        const client = await base.connect();
        arrived += 1;
        if (arrived === parties) open();
        await gate;
        return client;
      },
    });

    const outcomes = await Promise.all(racePools.map((racePool) => issueAs(f, {}, { pool: barrierPool(racePool) })));

    expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);
    expect(new Set(outcomes.map((outcome) => outcome.authorization.id)).size).toBe(1);
    expect(await sideEffects(f.accountId)).toEqual(ONE_AUTHORIZATION);
  });
});

// I. Lock races. A pausing pool stops the issuance right after a chosen lock
// statement returns; a second runtime session runs the conflicting mutation.
// Ordering is established only through pg_blocking_pids().

type Instrumented = Readonly<{ pool: TransactionalPool; pid: Promise<number>; reached: Promise<void>; resume: () => void }>;

function instrumented(base: TransactionalPool, pauseAfter?: RegExp): Instrumented {
  let resolvePid!: (pid: number) => void;
  const pid = new Promise<number>((resolve) => (resolvePid = resolve));
  let signal!: () => void;
  const reached = new Promise<void>((resolve) => (signal = resolve));
  let resume!: () => void;
  const resumed = new Promise<void>((resolve) => (resume = resolve));
  let paused = false;
  return {
    pid,
    reached,
    resume,
    pool: {
      ...base,
      connect: async () => {
        const client = await base.connect();
        resolvePid((await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid);
        const wrapped: RuntimeClient = {
          query: async <Row extends object>(sql: string, params?: unknown[]) => {
            const result = await client.query<Row>(sql, params);
            if (pauseAfter !== undefined && !paused && pauseAfter.test(sql)) {
              paused = true;
              signal();
              await resumed;
            }
            return result;
          },
          release: (error?: Error) => client.release(error),
        };
        return wrapped;
      },
    },
  };
}

async function backendPid(client: pg.Client): Promise<number> {
  return (await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
}

// Resolves once PostgreSQL reports that `waiter` is blocked by `holder`.
async function blockedBy(waiter: number, holder: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const result = await clients.migrator.query<{ blocked: boolean }>("SELECT $2::int = ANY (pg_blocking_pids($1::int)) AS blocked", [waiter, holder]);
    if (result.rows[0]!.blocked) return;
    if (Date.now() > deadline) throw new Error(`session ${waiter} never blocked on ${holder}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

type Mutation = Readonly<{ statements: readonly (readonly [string, (f: Fixture) => unknown[]])[] }>;

const USER_DISABLE: Mutation = {
  statements: [["UPDATE users SET status = 'DISABLED', disabled_at = now(), updated_at = now() WHERE id = $1", (f) => [f.userId]]],
};
const ACCOUNT_DISABLE: Mutation = {
  statements: [["UPDATE accounts SET status = 'DISABLED', disabled_at = now(), updated_at = now() WHERE id = $1", (f) => [f.accountId]]],
};
const CONNECTION_DISCONNECT: Mutation = {
  statements: [["UPDATE provider_connections SET status = 'DISCONNECTED', disconnected_at = now(), updated_at = now() WHERE id = $1", (f) => [f.connectionId]]],
};
// The rotation service's state change under the connection lifecycle lock.
const CONNECTION_ROTATE: Mutation = {
  statements: [
    ["SELECT id FROM provider_connections WHERE id = $1 FOR UPDATE", (f) => [f.connectionId]],
    ["UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now(), updated_at = now() WHERE id = $1", (f) => [f.versionId]],
    [
      `INSERT INTO provider_credential_versions
         (account_id, provider_connection_id, credential_version, status, sealed_credential, fingerprint_algorithm,
          fingerprint_key_ref, fingerprint_value, created_by_user_id)
       VALUES ($1, $2, 2, 'ACTIVE', '{"format":"fixture-envelope"}'::jsonb, 'HMAC-SHA-256', 'fixture/v1', $3, $4)`,
      (f) => [f.accountId, f.connectionId, randomBytes(32).toString("base64url"), f.userId],
    ],
    [
      `UPDATE provider_connections
          SET status = 'PENDING_VERIFICATION', verification_status = 'UNVERIFIED',
              verified_at = NULL, last_verification_attempt_at = NULL, updated_at = now()
        WHERE id = $1`,
      (f) => [f.connectionId],
    ],
  ],
};
const PRODUCTION_ARCHIVE: Mutation = {
  statements: [["UPDATE productions SET archived_at = now(), updated_at = now() WHERE id = $1", (f) => [f.productionId]]],
};
const GRANT_REVOKE: Mutation = {
  statements: [["UPDATE entitlement_grants SET state = 'REVOKED', revoked_at = now(), updated_at = now() WHERE id = $1", (f) => [f.grantId]]],
};

// The mutation commits first; issuance, blocked on the corresponding lock,
// then observes the committed state and refuses.
async function mutationWins(f: Fixture, mutation: Mutation, code: string): Promise<void> {
  const holder = await connectAs(clients.config.runtimeUrl, APPROVED_RUNTIME_ROLE);
  try {
    const holderPid = await backendPid(holder);
    await holder.query("BEGIN");
    for (const [sql, params] of mutation.statements) await holder.query(sql, params(f));

    const probe = instrumented(pool);
    const pending = issueAs(f, {}, { pool: probe.pool }).then(
      () => undefined,
      (error: unknown) => error,
    );
    await blockedBy(await probe.pid, holderPid);
    await holder.query("COMMIT");

    const error = await pending;
    expect(error).toBeInstanceOf(GenerationAuthorizationError);
    expect((error as GenerationAuthorizationError).code).toBe(code);
    expect(await sideEffects(f.accountId)).toEqual(NOTHING);
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    await holder.end();
  }
}

// Issuance holds the lock first; the mutation blocks on it and commits only
// after issuance has committed.
async function issuanceHolds(f: Fixture, pauseAfter: RegExp, mutation: Mutation): Promise<IssueGenerationAuthorizationResult> {
  const probe = instrumented(pool, pauseAfter);
  const pending = issueAs(f, {}, { pool: probe.pool });
  await probe.reached;
  const issuancePid = await probe.pid;

  const mutator = await connectAs(clients.config.runtimeUrl, APPROVED_RUNTIME_ROLE);
  try {
    const mutatorPid = await backendPid(mutator);
    await mutator.query("BEGIN");
    const [firstSql, firstParams] = mutation.statements[0]!;
    const rest = mutation.statements.slice(1);
    let mutationSettled = false;
    const blocked = mutator.query(firstSql, firstParams(f)).finally(() => {
      mutationSettled = true;
    });
    await blockedBy(mutatorPid, issuancePid);
    expect(mutationSettled).toBe(false);
    expect(await sideEffects(f.accountId)).toEqual(NOTHING);

    probe.resume();
    const issued = await pending;
    expect(issued.created).toBe(true);
    await blocked;
    for (const [sql, params] of rest) await mutator.query(sql, params(f));
    await mutator.query("COMMIT");
    expect(await sideEffects(f.accountId)).toEqual(ONE_AUTHORIZATION);
    return issued;
  } finally {
    probe.resume();
    await mutator.query("ROLLBACK").catch(() => undefined);
    await mutator.end();
  }
}

const AFTER_USER_LOCK = /FROM users WHERE id = \$1 FOR SHARE$/;
const AFTER_ACCOUNT_LOCK = /FROM accounts WHERE id = \$1 FOR NO KEY UPDATE$/;
const AFTER_CONNECTION_LOCK = /FROM provider_connections WHERE account_id = \$1 AND id = \$2 FOR UPDATE$/;
const AFTER_PRODUCTION_LOCK = /FROM productions WHERE account_id = \$1 AND id = \$2 FOR SHARE$/;
const AFTER_GRANT_LOCK = /FROM entitlement_grants WHERE account_id = \$1 AND id = \$2 FOR SHARE$/;

describe("I. lock races", () => {
  it("1. User disablement that wins the User row makes issuance refuse", async () => {
    await mutationWins(await fixture("race-user-first"), USER_DISABLE, "PRINCIPAL_UNAVAILABLE");
  });

  it("2. issuance holding the User eligibility lock keeps a User status update from committing ahead of it", async () => {
    const f = await fixture("race-user-held");
    await issuanceHolds(f, AFTER_USER_LOCK, USER_DISABLE);
    expect((await clients.migrator.query("SELECT status FROM users WHERE id = $1", [f.userId])).rows).toEqual([{ status: "DISABLED" }]);
  });

  it("3. Account disablement that wins the Account lock makes issuance refuse", async () => {
    await mutationWins(await fixture("race-account-first"), ACCOUNT_DISABLE, "PRINCIPAL_UNAVAILABLE");
  });

  it("4. issuance holding the Account lifecycle lock keeps an Account status update from committing ahead of it", async () => {
    const f = await fixture("race-account-held");
    await issuanceHolds(f, AFTER_ACCOUNT_LOCK, ACCOUNT_DISABLE);
    expect((await clients.migrator.query("SELECT status FROM accounts WHERE id = $1", [f.accountId])).rows).toEqual([{ status: "DISABLED" }]);
  });

  it("5a. a disconnect that wins the ProviderConnection lock makes issuance refuse", async () => {
    await mutationWins(await fixture("race-disconnect-first"), CONNECTION_DISCONNECT, "PROVIDER_CONNECTION_UNAVAILABLE");
  });

  it("5b. a rotation that wins the ProviderConnection lock makes issuance refuse", async () => {
    await mutationWins(await fixture("race-rotate-first"), CONNECTION_ROTATE, "PROVIDER_CONNECTION_UNAVAILABLE");
  });

  it("6. issuance holding the ProviderConnection lock keeps a disconnect or rotation from committing ahead of it", async () => {
    const disconnected = await fixture("race-disconnect-held");
    await issuanceHolds(disconnected, AFTER_CONNECTION_LOCK, CONNECTION_DISCONNECT);
    expect((await authorizationRows(disconnected.accountId))[0]).toMatchObject({ provider_credential_version_id: disconnected.versionId });

    const rotated = await fixture("race-rotate-held");
    const issued = await issuanceHolds(rotated, AFTER_CONNECTION_LOCK, CONNECTION_ROTATE);
    // Committed first, so it bound v1; the later rotation does not rewrite it.
    expect(issued.authorization.providerCredentialVersionId).toBe(rotated.versionId);
    expect((await authorizationRows(rotated.accountId))[0]).toMatchObject({ provider_credential_version_id: rotated.versionId });
  });

  it("7. Production archival that wins the Production row makes issuance refuse", async () => {
    await mutationWins(await fixture("race-production-first"), PRODUCTION_ARCHIVE, "PRODUCTION_UNAVAILABLE");
  });

  it("8. issuance holding the Production lock keeps archival from committing ahead of it", async () => {
    const f = await fixture("race-production-held");
    await issuanceHolds(f, AFTER_PRODUCTION_LOCK, PRODUCTION_ARCHIVE);
    expect((await clients.migrator.query("SELECT archived_at IS NOT NULL AS archived FROM productions WHERE id = $1", [f.productionId])).rows).toEqual([
      { archived: true },
    ]);
  });

  it("9. an entitlement lifecycle update that wins the grant row makes issuance refuse", async () => {
    await mutationWins(await fixture("race-grant-first"), GRANT_REVOKE, "ENTITLEMENT_NOT_AVAILABLE");
  });

  it("10. issuance holding the grant lock keeps a lifecycle update from committing ahead of it", async () => {
    const f = await fixture("race-grant-held");
    await issuanceHolds(f, AFTER_GRANT_LOCK, GRANT_REVOKE);
    expect((await grantRow(f.grantId))!.state).toBe("REVOKED");
  });
});
