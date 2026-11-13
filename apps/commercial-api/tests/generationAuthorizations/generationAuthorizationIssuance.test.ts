import {
  GOOGLE_EXPECTED_COST_CAP_UNIT,
  GOOGLE_MODEL,
  GOOGLE_PROVIDER_ID,
  generationRequestSha256,
  parseGoogleGenerationRequest,
  parseRunwayGenerationRequest,
  RUNWAY_EXPECTED_COST_CAP_UNIT,
  RUNWAY_MODEL,
  RUNWAY_PROVIDER_ID,
} from "commercial-worker-protocol";
import { describe, expect, it } from "vitest";

import type { RuntimeClient, TransactionalPool } from "../../src/database/runtimePool.js";
import {
  capabilityFor,
  createGenerationAuthorityPolicyRegistry,
  generationLimits,
  PRODUCTION_GENERATION_AUTHORITY_POLICY_REGISTRY,
  sharedGenerationContract,
  type GenerationAuthorityPolicyRegistry,
  type GenerationCapability,
} from "../../src/generationAuthorizations/generationAuthorityPolicy.js";
import { GenerationAuthorizationError } from "../../src/generationAuthorizations/generationAuthorizationError.js";
import {
  issueGenerationAuthorization,
  validateIssueGenerationAuthorizationInput,
} from "../../src/generationAuthorizations/generationAuthorizationService.js";

// Non-database R44B11C tests. The scripted pool answers each statement from a
// small in-memory state and records every statement, so lock order, the exact
// grant lookup, the audit payload and rollback handling are observable. Real
// PostgreSQL behaviour is proven in tests/db/generationAuthorizationIssuance.test.ts.

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const PRODUCTION_ID = "33333333-3333-4333-8333-333333333333";
const CONNECTION_ID = "44444444-4444-4444-8444-444444444444";
const GRANT_ID = "55555555-5555-4555-8555-555555555555";
const VERSION_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_GRANT_ID = "77777777-7777-4777-8777-777777777777";
const PRINCIPAL = Object.freeze({ userId: USER_ID, accountId: ACCOUNT_ID });

const PROMPT = "A lighthouse at dawn, secret-prompt-marker";
// referenceImage is opaque at issuance: an inner shape no R44B10P1 parser would accept passes untouched.
const OPAQUE_REFERENCE = { notAnObjectReference: ["secret-reference-marker", 1] };
const GOOGLE_REQUEST = { prompt: PROMPT, referenceImage: OPAQUE_REFERENCE, resolution: "720p" };
const RUNWAY_REQUEST = { prompt: PROMPT, referenceImage: null, durationSeconds: 5 };

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
  expectedCostAmount: (request) => ("durationSeconds" in request ? request.durationSeconds * 12 : 0),
  ...overrides,
});

const intent = (overrides: Record<string, unknown> = {}) => ({
  productionId: PRODUCTION_ID,
  providerConnectionId: CONNECTION_ID,
  model: GOOGLE_MODEL,
  generationRequest: GOOGLE_REQUEST,
  idempotencyKey: "issue-1",
  ...overrides,
});

function expectCode(action: () => unknown, code: string): void {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(GenerationAuthorizationError);
  expect((caught as GenerationAuthorizationError).code).toBe(code);
}

async function expectRejectCode(promise: Promise<unknown>, code: string): Promise<GenerationAuthorizationError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(GenerationAuthorizationError);
  expect((error as GenerationAuthorizationError).code).toBe(code);
  return error as GenerationAuthorizationError;
}

type Row = Record<string, unknown>;
type State = {
  user: Row | null;
  account: Row | null;
  existing: Row | null;
  connection: Row | null;
  newest: Row | null;
  production: Row | null;
  grant: Row | null;
  failAudit?: boolean;
  failRollback?: boolean;
  failConnect?: boolean;
};

function initialState(): State {
  return {
    user: { status: "ACTIVE" },
    account: { kind: "PERSONAL", owner_user_id: USER_ID, status: "ACTIVE" },
    existing: null,
    connection: { provider: GOOGLE_PROVIDER_ID, status: "ACTIVE", verification_status: "VERIFIED" },
    newest: { id: VERSION_ID, status: "ACTIVE" },
    production: { creation_entitlement_grant_id: GRANT_ID, archived_at: null },
    grant: { kind: "FREE_BYO", state: "AVAILABLE", policy_version: "free-byo-v1" },
  };
}

type Statement = { sql: string; params: readonly unknown[] };

function scriptedPool(state: State) {
  const statements: Statement[] = [];
  const releases: (Error | undefined)[] = [];
  const rows = (row: Row | null) => ({ rows: row === null ? [] : [row] });
  const client: RuntimeClient = {
    query: async <R extends object>(sql: string, params: unknown[] = []) => {
      statements.push({ sql, params });
      const answer = (): { rows: Row[] } => {
        if (sql === "ROLLBACK" && state.failRollback === true) throw new Error("rollback failed");
        if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
        if (/INSERT INTO generation_authorizations/.test(sql)) {
          const row: Row = {
            id: "88888888-8888-4888-8888-888888888888",
            account_id: params[0],
            production_id: params[1],
            entitlement_grant_id: params[2],
            billing_mode: "USER_BYO",
            provider: params[3],
            model: params[4],
            provider_connection_id: params[5],
            provider_credential_version_id: params[6],
            generation_request: JSON.parse(params[7] as string),
            generation_request_sha256: params[8],
            expected_cost_cap_unit: params[9],
            expected_cost_cap_amount: String(params[10]),
            status: "ISSUED",
            expires_at: new Date(0),
            claimed_at: null,
            expired_at: null,
            cancelled_at: null,
            created_by_user_id: params[12],
            creation_idempotency_key: params[13],
            created_at: new Date(0),
            updated_at: new Date(0),
          };
          state.existing = row;
          return { rows: [row] };
        }
        if (/INSERT INTO audit_events/.test(sql)) {
          if (state.failAudit === true) {
            throw Object.assign(new Error(`violates check: ${PROMPT}`), { code: "23514" });
          }
          return { rows: [] };
        }
        if (/FROM users/.test(sql)) return rows(state.user);
        if (/FROM accounts/.test(sql)) return rows(state.account);
        if (/FROM generation_authorizations/.test(sql)) return rows(state.existing);
        if (/FROM provider_connections/.test(sql)) return rows(state.connection);
        if (/FROM provider_credential_versions/.test(sql)) return rows(state.newest);
        if (/FROM productions/.test(sql)) return rows(state.production);
        if (/FROM entitlement_grants/.test(sql)) return rows(state.grant);
        throw new Error(`unscripted statement: ${sql}`);
      };
      return answer() as unknown as { rows: R[] };
    },
    release: (error?: Error) => {
      releases.push(error);
    },
  };
  const pool: TransactionalPool = {
    query: async () => {
      throw new Error("pool.query must never run a transaction statement");
    },
    end: async () => undefined,
    connect: async () => {
      if (state.failConnect === true) throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
      return client;
    },
  };
  return { pool, statements, releases };
}

const registryWith = (...capabilities: GenerationCapability[]) => createGenerationAuthorityPolicyRegistry(capabilities);

function issue(state: State, rawInput: unknown = intent(), policy: GenerationAuthorityPolicyRegistry = registryWith(googleCapability(), runwayCapability())) {
  const scripted = scriptedPool(state);
  return { scripted, result: issueGenerationAuthorization({ pool: scripted.pool, policy }, PRINCIPAL, rawInput, { correlationId: "99999999-9999-4999-8999-999999999999" }) };
}

const auditStatements = (statements: readonly Statement[]) => statements.filter(({ sql }) => /INSERT INTO audit_events/.test(sql));
const insertStatements = (statements: readonly Statement[]) => statements.filter(({ sql }) => /INSERT INTO generation_authorizations/.test(sql));

describe("issuance input boundary", () => {
  it("accepts exactly the five intent members and preserves them unchanged", () => {
    const key = "  padded key é  ";
    const validated = validateIssueGenerationAuthorizationInput(intent({ idempotencyKey: key }));
    expect(validated).toEqual(intent({ idempotencyKey: key }));
    expect(validated.idempotencyKey).toBe(key);
  });

  it.each(["productionId", "providerConnectionId", "model", "generationRequest", "idempotencyKey"])("requires %s", (member) => {
    const input: Record<string, unknown> = intent();
    delete input[member];
    expectCode(() => validateIssueGenerationAuthorizationInput(input), "GENERATION_AUTHORIZATION_INPUT_INVALID");
  });

  it.each([
    "accountId",
    "entitlementGrantId",
    "grantId",
    "billingMode",
    "provider",
    "providerCredentialVersionId",
    "entitlementDecision",
    "generationPolicyVersion",
    "expectedCostCapUnit",
    "expectedCostCapAmount",
    "expiresAt",
    "createdByUserId",
    "auditMetadata",
    "status",
    "unknownMember",
  ])("refuses the caller-supplied authority or unknown member %s", (member) => {
    expectCode(() => validateIssueGenerationAuthorizationInput(intent({ [member]: "x" })), "GENERATION_AUTHORIZATION_INPUT_INVALID");
  });

  it("refuses non-objects, accessors and symbol keys", () => {
    for (const input of [null, undefined, "x", 1, [], [intent()]]) {
      expectCode(() => validateIssueGenerationAuthorizationInput(input), "GENERATION_AUTHORIZATION_INPUT_INVALID");
    }
    const withGetter = intent();
    Object.defineProperty(withGetter, "model", { get: () => GOOGLE_MODEL, enumerable: true });
    expectCode(() => validateIssueGenerationAuthorizationInput(withGetter), "GENERATION_AUTHORIZATION_INPUT_INVALID");
    expectCode(() => validateIssueGenerationAuthorizationInput({ ...intent(), [Symbol("x")]: 1 }), "GENERATION_AUTHORIZATION_INPUT_INVALID");
  });

  it.each([
    ["productionId", "not-a-uuid"],
    ["productionId", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".toUpperCase()],
    ["productionId", 42],
    ["providerConnectionId", `${CONNECTION_ID}0`],
    ["providerConnectionId", ""],
    ["model", ""],
    ["model", " leading-space"],
    ["model", "m".repeat(129)],
    ["model", 7],
  ])("refuses %s = %j", (member, value) => {
    expectCode(() => validateIssueGenerationAuthorizationInput(intent({ [member]: value })), "GENERATION_AUTHORIZATION_INPUT_INVALID");
  });

  it("requires a non-empty idempotency key of at most 128 code points, never trimmed", () => {
    for (const key of [undefined, null, 1, "", "k".repeat(129), "\u{1F600}".repeat(129)]) {
      expectCode(() => validateIssueGenerationAuthorizationInput(intent({ idempotencyKey: key })), "GENERATION_AUTHORIZATION_INPUT_INVALID");
    }
    for (const key of ["k", "k".repeat(128), "\u{1F600}".repeat(128), " ", "\tkey\n"]) {
      expect(validateIssueGenerationAuthorizationInput(intent({ idempotencyKey: key })).idempotencyKey).toBe(key);
    }
  });

  it("refuses a malformed trusted principal or correlation ID before any SQL", async () => {
    const scripted = scriptedPool(initialState());
    const policy = registryWith(googleCapability());
    await expectRejectCode(
      issueGenerationAuthorization({ pool: scripted.pool, policy }, { userId: "x", accountId: ACCOUNT_ID }, intent()),
      "GENERATION_AUTHORIZATION_INPUT_INVALID",
    );
    await expectRejectCode(
      issueGenerationAuthorization({ pool: scripted.pool, policy }, PRINCIPAL, intent(), { correlationId: "not-a-uuid" }),
      "GENERATION_AUTHORIZATION_INPUT_INVALID",
    );
    expect(scripted.statements).toEqual([]);
  });
});

describe("generation-authority policy", () => {
  it("enables no provider/model in the production registry", () => {
    for (const [provider, model] of [
      [GOOGLE_PROVIDER_ID, GOOGLE_MODEL],
      [RUNWAY_PROVIDER_ID, RUNWAY_MODEL],
      ["EXAMPLE_PROVIDER", "example-model-1.0"],
    ] as const) {
      expect(PRODUCTION_GENERATION_AUTHORITY_POLICY_REGISTRY.resolve(provider, model)).toBeNull();
      expect(capabilityFor(PRODUCTION_GENERATION_AUTHORITY_POLICY_REGISTRY, provider, model)).toBeNull();
    }
  });

  it("dispatches only to the exact shared provider/model contracts, parsers and units", () => {
    expect(sharedGenerationContract(GOOGLE_PROVIDER_ID, GOOGLE_MODEL)).toMatchObject({
      expectedCostCapUnit: GOOGLE_EXPECTED_COST_CAP_UNIT,
      parse: parseGoogleGenerationRequest,
    });
    expect(sharedGenerationContract(RUNWAY_PROVIDER_ID, RUNWAY_MODEL)).toMatchObject({
      expectedCostCapUnit: RUNWAY_EXPECTED_COST_CAP_UNIT,
      parse: parseRunwayGenerationRequest,
    });
    expect(GOOGLE_EXPECTED_COST_CAP_UNIT).toBe("MICRO_USD");
    expect(RUNWAY_EXPECTED_COST_CAP_UNIT).toBe("PROVIDER_CREDITS");
    for (const [provider, model] of [
      [GOOGLE_PROVIDER_ID, RUNWAY_MODEL],
      [RUNWAY_PROVIDER_ID, GOOGLE_MODEL],
      [GOOGLE_PROVIDER_ID.toLowerCase(), GOOGLE_MODEL],
      [GOOGLE_PROVIDER_ID, GOOGLE_MODEL.toUpperCase()],
      [GOOGLE_PROVIDER_ID, `${GOOGLE_MODEL} `],
    ]) {
      expect(sharedGenerationContract(provider!, model!)).toBeNull();
    }
  });

  it("resolves injected Google and Runway capabilities with their shared units", () => {
    const registry = registryWith(googleCapability(), runwayCapability());
    const google = capabilityFor(registry, GOOGLE_PROVIDER_ID, GOOGLE_MODEL)!;
    const runway = capabilityFor(registry, RUNWAY_PROVIDER_ID, RUNWAY_MODEL)!;
    expect(generationLimits(google.capability, google.contract, parseGoogleGenerationRequest(GOOGLE_REQUEST))).toEqual({
      generationPolicyVersion: "test-generation-v1",
      claimLifetimeSeconds: 900,
      expectedCostCapUnit: "MICRO_USD",
      expectedCostCapAmount: 2_500_000,
    });
    expect(generationLimits(runway.capability, runway.contract, parseRunwayGenerationRequest(RUNWAY_REQUEST))).toEqual({
      generationPolicyVersion: "test-generation-v1",
      claimLifetimeSeconds: 600,
      expectedCostCapUnit: "PROVIDER_CREDITS",
      expectedCostCapAmount: 60,
    });
    expect(capabilityFor(registry, GOOGLE_PROVIDER_ID, RUNWAY_MODEL)).toBeNull();
  });

  it.each([
    ["an empty policy version", { generationPolicyVersion: "" }],
    ["an uppercase policy version", { generationPolicyVersion: "Policy-V1" }],
    ["a zero lifetime", { claimLifetimeSeconds: 0 }],
    ["a negative lifetime", { claimLifetimeSeconds: -60 }],
    ["a fractional lifetime", { claimLifetimeSeconds: 1.5 }],
    ["an unsafe lifetime", { claimLifetimeSeconds: 2 ** 53 }],
    ["a non-numeric lifetime", { claimLifetimeSeconds: "900" as unknown as number }],
    ["an unknown provider/model pair", { model: "example-model-1.0" }],
    ["a cost policy that is not a function", { expectedCostAmount: 5 as unknown as GenerationCapability["expectedCostAmount"] }],
  ])("refuses a capability with %s", (_label, overrides) => {
    expectCode(() => registryWith(googleCapability(overrides)), "GENERATION_POLICY_INVALID");
  });

  it("refuses a duplicate pair and an injected validator, unit or other extra member", () => {
    expectCode(() => registryWith(googleCapability(), googleCapability()), "GENERATION_POLICY_INVALID");
    for (const extra of [{ parse: () => ({}) }, { expectedCostCapUnit: "MICRO_USD" }, { canonicalize: () => "" }]) {
      expectCode(() => registryWith({ ...googleCapability(), ...extra } as GenerationCapability), "GENERATION_POLICY_INVALID");
    }
  });

  it.each([
    ["zero", () => 0],
    ["negative", () => -1],
    ["fractional", () => 1.5],
    ["unsafe", () => 2 ** 53],
    ["non-numeric", () => "100" as unknown as number],
    ["NaN", () => Number.NaN],
    ["throwing", () => {
      throw new Error("policy bug");
    }],
  ])("fails closed on a %s expected-cost amount", (_label, expectedCostAmount) => {
    const { capability, contract } = capabilityFor(registryWith(googleCapability({ expectedCostAmount })), GOOGLE_PROVIDER_ID, GOOGLE_MODEL)!;
    expectCode(() => generationLimits(capability, contract, parseGoogleGenerationRequest(GOOGLE_REQUEST)), "GENERATION_POLICY_INVALID");
  });

  it("re-checks what a hand-built registry returns", () => {
    const mismatched: GenerationAuthorityPolicyRegistry = { resolve: () => runwayCapability() };
    expectCode(() => capabilityFor(mismatched, GOOGLE_PROVIDER_ID, GOOGLE_MODEL), "GENERATION_POLICY_INVALID");
    const malformed: GenerationAuthorityPolicyRegistry = { resolve: () => ({ ...googleCapability(), claimLifetimeSeconds: 0 }) };
    expectCode(() => capabilityFor(malformed, GOOGLE_PROVIDER_ID, GOOGLE_MODEL), "GENERATION_POLICY_INVALID");
    const smuggled: GenerationAuthorityPolicyRegistry = {
      resolve: () => ({ ...googleCapability(), contract: { parse: () => ({}) } }) as unknown as GenerationCapability,
    };
    expectCode(() => capabilityFor(smuggled, GOOGLE_PROVIDER_ID, GOOGLE_MODEL), "GENERATION_POLICY_INVALID");
  });
});

describe("issuance transaction (scripted database)", () => {
  it("issues with the locked lock order, exact provenance, shared hash, server cost cap and database-clock expiry", async () => {
    const state = initialState();
    const { scripted, result } = issue(state);
    const issued = await result;

    expect(issued.created).toBe(true);
    expect(issued.authorization).toMatchObject({
      accountId: ACCOUNT_ID,
      productionId: PRODUCTION_ID,
      entitlementGrantId: GRANT_ID,
      billingMode: "USER_BYO",
      provider: GOOGLE_PROVIDER_ID,
      model: GOOGLE_MODEL,
      providerConnectionId: CONNECTION_ID,
      providerCredentialVersionId: VERSION_ID,
      generationRequest: GOOGLE_REQUEST,
      generationRequestSha256: generationRequestSha256(GOOGLE_REQUEST),
      expectedCostCapUnit: "MICRO_USD",
      expectedCostCapAmount: 2_500_000,
      status: "ISSUED",
      createdByUserId: USER_ID,
      creationIdempotencyKey: "issue-1",
    });

    const order = scripted.statements.map(({ sql }) => {
      for (const [pattern, name] of [
        [/^BEGIN ISOLATION LEVEL READ COMMITTED$/, "BEGIN"],
        [/FROM users WHERE id = \$1 FOR SHARE$/, "USER FOR SHARE"],
        [/FROM accounts WHERE id = \$1 FOR NO KEY UPDATE$/, "ACCOUNT FOR NO KEY UPDATE"],
        [/^SELECT[\s\S]*FROM generation_authorizations/, "REPLAY"],
        [/FROM provider_connections WHERE account_id = \$1 AND id = \$2 FOR UPDATE$/, "CONNECTION FOR UPDATE"],
        [/FROM provider_credential_versions[\s\S]*ORDER BY credential_version DESC[\s\S]*LIMIT 1$/, "NEWEST CREDENTIAL"],
        [/FROM productions WHERE account_id = \$1 AND id = \$2 FOR SHARE$/, "PRODUCTION FOR SHARE"],
        [/FROM entitlement_grants WHERE account_id = \$1 AND id = \$2 FOR SHARE$/, "GRANT FOR SHARE"],
        [/INSERT INTO generation_authorizations/, "INSERT"],
        [/INSERT INTO audit_events/, "AUDIT"],
        [/^COMMIT$/, "COMMIT"],
      ] as const) {
        if (pattern.test(sql)) return name;
      }
      return sql;
    });
    expect(order).toEqual([
      "BEGIN",
      "USER FOR SHARE",
      "ACCOUNT FOR NO KEY UPDATE",
      "REPLAY",
      "CONNECTION FOR UPDATE",
      "NEWEST CREDENTIAL",
      "PRODUCTION FOR SHARE",
      "GRANT FOR SHARE",
      "REPLAY",
      "INSERT",
      "AUDIT",
      "COMMIT",
    ]);
    expect(scripted.releases).toEqual([undefined]);

    // Expiry is a database-clock expression; no application timestamp is sent.
    const [insert] = insertStatements(scripted.statements);
    expect(insert!.sql).toContain("clock_timestamp() + $12::double precision * interval '1 second'");
    expect(insert!.params[11]).toBe(900);
    expect(insert!.params.some((param) => param instanceof Date)).toBe(false);
    expect(insert!.sql).toMatch(/'USER_BYO'/);
    expect(insert!.sql).toMatch(/'ISSUED'/);
    // The exact Production creation grant is used; no other grant is searched for.
    const grantLookups = scripted.statements.filter(({ sql }) => /entitlement_grants/.test(sql));
    expect(grantLookups).toHaveLength(1);
    expect(grantLookups[0]!.params).toEqual([ACCOUNT_ID, GRANT_ID]);
    // No row is changed, and nothing outside the authorization and its audit is written.
    expect(scripted.statements.some(({ sql }) => /^\s*(UPDATE|DELETE)\b|generation_usage_ledger|execution_jobs|execution_attempts/i.test(sql))).toBe(false);
    expect(scripted.statements.filter(({ sql }) => /^\s*INSERT\b/.test(sql))).toHaveLength(2);
  });

  it("writes audit metadata with only the two policy versions", async () => {
    const { scripted, result } = issue(initialState());
    const issued = await result;
    const [audit] = auditStatements(scripted.statements);
    expect(audit!.sql).toContain("'generation_authorization.issued', 'generation_authorization'");
    expect(audit!.params).toEqual([ACCOUNT_ID, USER_ID, issued.authorization.id, "99999999-9999-4999-8999-999999999999", expect.any(String)]);
    expect(JSON.parse(audit!.params[4] as string)).toEqual({ entitlementPolicyVersion: "free-byo-v1", generationPolicyVersion: "test-generation-v1" });
    expect(audit!.params[4]).not.toMatch(/prompt|secret|reference|credential|fingerprint|sealed|key/i);
  });

  it("issues for an injected Runway capability with its shared unit", async () => {
    const state = initialState();
    state.connection = { provider: RUNWAY_PROVIDER_ID, status: "ACTIVE", verification_status: "VERIFIED" };
    const issued = await issue(state, intent({ model: RUNWAY_MODEL, generationRequest: RUNWAY_REQUEST })).result;
    expect(issued.authorization).toMatchObject({ provider: RUNWAY_PROVIDER_ID, expectedCostCapUnit: "PROVIDER_CREDITS", expectedCostCapAmount: 60 });
  });

  it("refuses issuance with the production registry, after the eligibility checks", async () => {
    const { scripted, result } = issue(initialState(), intent(), PRODUCTION_GENERATION_AUTHORITY_POLICY_REGISTRY);
    await expectRejectCode(result, "GENERATION_CAPABILITY_UNAVAILABLE");
    expect(insertStatements(scripted.statements)).toEqual([]);
    expect(scripted.statements.at(-1)!.sql).toBe("ROLLBACK");
  });

  it("refuses a model the derived provider has no capability for", async () => {
    await expectRejectCode(issue(initialState(), intent({ model: RUNWAY_MODEL, generationRequest: RUNWAY_REQUEST })).result, "GENERATION_CAPABILITY_UNAVAILABLE");
  });

  it.each([
    ["an extra member", { ...GOOGLE_REQUEST, seed: 1 }],
    ["a missing member", { prompt: PROMPT, referenceImage: null }],
    ["a wrong resolution", { ...GOOGLE_REQUEST, resolution: "1080p" }],
    ["an edge-whitespace prompt", { ...GOOGLE_REQUEST, prompt: ` ${PROMPT}` }],
    ["a non-object", "prompt"],
  ])("refuses a shared-contract-invalid request (%s) before insertion", async (_label, generationRequest) => {
    const { scripted, result } = issue(initialState(), intent({ generationRequest }));
    const error = await expectRejectCode(result, "GENERATION_REQUEST_INVALID");
    expect(error.message).not.toContain(PROMPT);
    expect(insertStatements(scripted.statements)).toEqual([]);
  });

  it.each([
    ["undefined", { ...GOOGLE_REQUEST, referenceImage: undefined }],
    ["a bigint", { ...GOOGLE_REQUEST, referenceImage: 1n }],
    ["a lone surrogate", { ...GOOGLE_REQUEST, prompt: "a\ud800" }],
    ["a non-finite number", { ...GOOGLE_REQUEST, referenceImage: Number.POSITIVE_INFINITY }],
  ])("refuses a non-canonicalizable request (%s) before any SQL", async (_label, generationRequest) => {
    const { scripted, result } = issue(initialState(), intent({ generationRequest }));
    await expectRejectCode(result, "GENERATION_REQUEST_INVALID");
    expect(scripted.statements).toEqual([]);
  });

  it.each([
    ["missing User", (s: State) => (s.user = null), "PRINCIPAL_UNAVAILABLE", "USER_NOT_FOUND"],
    ["disabled User", (s: State) => (s.user = { status: "DISABLED" }), "PRINCIPAL_UNAVAILABLE", "USER_DISABLED"],
    ["missing Account", (s: State) => (s.account = null), "PRINCIPAL_UNAVAILABLE", "ACCOUNT_NOT_FOUND"],
    ["foreign-owned Account", (s: State) => (s.account = { kind: "PERSONAL", owner_user_id: GRANT_ID, status: "ACTIVE" }), "PRINCIPAL_UNAVAILABLE", "ACCOUNT_NOT_OWNED"],
    ["disabled Account", (s: State) => (s.account = { kind: "PERSONAL", owner_user_id: USER_ID, status: "DISABLED" }), "PRINCIPAL_UNAVAILABLE", "ACCOUNT_DISABLED"],
    ["missing connection", (s: State) => (s.connection = null), "PROVIDER_CONNECTION_UNAVAILABLE", undefined],
    ["unverified connection", (s: State) => (s.connection = { provider: GOOGLE_PROVIDER_ID, status: "ACTIVE", verification_status: "UNVERIFIED" }), "PROVIDER_CONNECTION_UNAVAILABLE", undefined],
    ["pending connection", (s: State) => (s.connection = { provider: GOOGLE_PROVIDER_ID, status: "PENDING_VERIFICATION", verification_status: "VERIFIED" }), "PROVIDER_CONNECTION_UNAVAILABLE", undefined],
    ["no credential version", (s: State) => (s.newest = null), "CREDENTIAL_UNAVAILABLE", undefined],
    ["newest version SUPERSEDED", (s: State) => (s.newest = { id: VERSION_ID, status: "SUPERSEDED" }), "CREDENTIAL_UNAVAILABLE", undefined],
    ["missing Production", (s: State) => (s.production = null), "PRODUCTION_UNAVAILABLE", undefined],
    ["archived Production", (s: State) => (s.production = { creation_entitlement_grant_id: GRANT_ID, archived_at: new Date(0) }), "PRODUCTION_UNAVAILABLE", undefined],
    ["missing grant", (s: State) => (s.grant = null), "ENTITLEMENT_NOT_AVAILABLE", undefined],
    ["non-FREE_BYO grant", (s: State) => (s.grant = { kind: "HOSTED_TRIAL", state: "AVAILABLE", policy_version: "free-byo-v1" }), "ENTITLEMENT_NOT_AVAILABLE", undefined],
    ["RESERVED grant", (s: State) => (s.grant = { kind: "FREE_BYO", state: "RESERVED", policy_version: "free-byo-v1" }), "ENTITLEMENT_NOT_AVAILABLE", undefined],
    ["unknown policy", (s: State) => (s.grant = { kind: "FREE_BYO", state: "AVAILABLE", policy_version: "free-byo-v999" }), "ENTITLEMENT_POLICY_UNSUPPORTED", undefined],
  ])("refuses a %s and rolls back", async (_label, mutate, code, reason) => {
    const state = initialState();
    mutate(state);
    const { scripted, result } = issue(state);
    const error = await expectRejectCode(result, code);
    expect(error.reason).toBe(reason);
    expect(insertStatements(scripted.statements)).toEqual([]);
    expect(scripted.statements.at(-1)!.sql).toBe("ROLLBACK");
    expect(scripted.releases).toEqual([undefined]);
  });

  it("never substitutes another grant when the Production's exact grant is unavailable", async () => {
    const state = initialState();
    state.production = { creation_entitlement_grant_id: OTHER_GRANT_ID, archived_at: null };
    state.grant = null;
    const { scripted, result } = issue(state);
    await expectRejectCode(result, "ENTITLEMENT_NOT_AVAILABLE");
    const grantLookups = scripted.statements.filter(({ sql }) => /entitlement_grants/.test(sql));
    expect(grantLookups.map(({ params }) => params)).toEqual([[ACCOUNT_ID, OTHER_GRANT_ID]]);
    expect(grantLookups[0]!.sql).not.toMatch(/ORDER BY|LIMIT|state = 'AVAILABLE'/);
  });
});

describe("idempotent replay (scripted database)", () => {
  it("returns the original unchanged after only the principal locks, with no insert or audit", async () => {
    const state = initialState();
    await issue(state).result;
    const original = state.existing!;
    // Every other dynamic eligibility has since changed; replay does not look.
    state.connection = { provider: GOOGLE_PROVIDER_ID, status: "DISCONNECTED", verification_status: "VERIFIED" };
    state.production = { creation_entitlement_grant_id: GRANT_ID, archived_at: new Date(0) };
    state.grant = { kind: "FREE_BYO", state: "CONSUMED", policy_version: "free-byo-v1" };
    const changedPolicy = registryWith(googleCapability({ generationPolicyVersion: "test-generation-v2", claimLifetimeSeconds: 5, expectedCostAmount: () => 1 }));

    // Member order differs; the canonical hash is the same.
    const reordered = { resolution: "720p", referenceImage: OPAQUE_REFERENCE, prompt: PROMPT };
    const { scripted, result } = issue(state, intent({ generationRequest: reordered }), changedPolicy);
    const replay = await result;

    expect(replay.created).toBe(false);
    expect(replay.authorization).toMatchObject({ id: original.id, expectedCostCapAmount: 2_500_000, providerCredentialVersionId: VERSION_ID });
    // BEGIN, User lock, Account lock, replay lookup, COMMIT: nothing else.
    expect(scripted.statements).toHaveLength(5);
    expect(insertStatements(scripted.statements)).toEqual([]);
    expect(auditStatements(scripted.statements)).toEqual([]);
    expect(scripted.statements.at(-1)!.sql).toBe("COMMIT");
  });

  it.each(["CLAIMED", "CANCELLED", "EXPIRED"])("returns a %s original as it is", async (status) => {
    const state = initialState();
    await issue(state).result;
    state.existing = { ...state.existing!, status };
    const replay = await issue(state).result;
    expect(replay).toMatchObject({ created: false, authorization: { status } });
  });

  it("still revalidates the active principal on replay", async () => {
    const state = initialState();
    await issue(state).result;
    state.user = { status: "DISABLED" };
    await expectRejectCode(issue(state).result, "PRINCIPAL_UNAVAILABLE");
  });

  it.each([
    ["a different connection", { providerConnectionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
    ["a different model", { model: "other-model" }],
    ["a different request", { generationRequest: { ...GOOGLE_REQUEST, prompt: "Another prompt" } }],
  ])("treats the same key with %s as a conflict", async (_label, overrides) => {
    const state = initialState();
    await issue(state).result;
    const { scripted, result } = issue(state, intent(overrides));
    await expectRejectCode(result, "IDEMPOTENCY_KEY_CONFLICT");
    expect(insertStatements(scripted.statements)).toEqual([]);
  });
});

describe("failure handling", () => {
  it("rolls back the authorization when the audit insert fails, with a safe error", async () => {
    const state = initialState();
    state.failAudit = true;
    const { scripted, result } = issue(state);
    const error = await expectRejectCode(result, "GENERATION_AUTHORIZATION_DATABASE_FAILURE");
    expect(error.databaseCode).toBe("23514");
    expect(error.message).toBe("The generation authorization could not be issued.");
    expect(error.message).not.toContain(PROMPT);
    expect(scripted.statements.at(-1)!.sql).toBe("ROLLBACK");
    expect(scripted.statements.some(({ sql }) => sql === "COMMIT")).toBe(false);
    expect(scripted.releases).toEqual([undefined]);
  });

  it("destroys the session when the rollback cannot be confirmed, preserving the original failure", async () => {
    const state = initialState();
    state.failAudit = true;
    state.failRollback = true;
    const { scripted, result } = issue(state);
    await expectRejectCode(result, "GENERATION_AUTHORIZATION_DATABASE_FAILURE");
    expect(scripted.releases).toHaveLength(1);
    expect(scripted.releases[0]).toBeInstanceOf(Error);
  });

  it("maps a connection failure to a database failure without a session", async () => {
    const state = initialState();
    state.failConnect = true;
    const { scripted, result } = issue(state);
    const error = await expectRejectCode(result, "GENERATION_AUTHORIZATION_DATABASE_FAILURE");
    expect(error.databaseCode).toBe("ECONNREFUSED");
    expect(scripted.releases).toEqual([]);
  });

  it("uses fixed messages that echo no request, identity or credential value", () => {
    const codes = [
      "GENERATION_AUTHORIZATION_INPUT_INVALID",
      "PRINCIPAL_UNAVAILABLE",
      "PRODUCTION_UNAVAILABLE",
      "ENTITLEMENT_NOT_AVAILABLE",
      "ENTITLEMENT_POLICY_UNSUPPORTED",
      "PROVIDER_CONNECTION_UNAVAILABLE",
      "CREDENTIAL_UNAVAILABLE",
      "GENERATION_CAPABILITY_UNAVAILABLE",
      "GENERATION_REQUEST_INVALID",
      "IDEMPOTENCY_KEY_CONFLICT",
      "GENERATION_POLICY_INVALID",
      "GENERATION_AUTHORIZATION_INVARIANT_VIOLATION",
      "GENERATION_AUTHORIZATION_DATABASE_FAILURE",
    ] as const;
    for (const code of codes) {
      const error = new GenerationAuthorizationError(code, { cause: new Error(`${PROMPT} ${VERSION_ID}`) });
      expect(error.message.length).toBeGreaterThan(0);
      expect(error.message).not.toMatch(/[0-9a-f]{8}-|secret|prompt|SELECT|INSERT|\$\d/i);
    }
  });
});
