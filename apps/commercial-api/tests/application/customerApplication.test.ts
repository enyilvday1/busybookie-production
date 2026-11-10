import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createCustomerApplication, type CustomerApplicationServices } from "../../src/application/customerApplication.js";
import { PrincipalUnavailableError } from "../../src/application/resolveActivePrincipal.js";
import type { VerifiedIdentity } from "../../src/authentication/verifiedIdentity.js";
import type { TransactionalPool } from "../../src/database/runtimePool.js";
import { ProductionCreationError } from "../../src/productions/productionCreationError.js";
import { ProvisioningError } from "../../src/provisioning/provisioningError.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { send, sendRaw } from "../httpClient.js";
import { createTestIdentityProvider } from "../support/testIdentityProvider.js";

const ALICE: VerifiedIdentity = { issuer: "https://issuer.app.test/", subject: "alice-subject", email: { address: "alice@example.test", verified: true } };
const TOKEN = "fixture-token-alice";
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const JSON_HEADERS = { ...AUTH, "Content-Type": "application/json" };
const PRINCIPAL = { userId: "11111111-1111-4111-8111-111111111111", accountId: "22222222-2222-4222-8222-222222222222" };
const PRODUCTION_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-11-10T12:00:00.000Z");

const production = {
  id: PRODUCTION_ID,
  accountId: PRINCIPAL.accountId,
  title: "First",
  creationEntitlementGrantId: "44444444-4444-4444-8444-444444444444",
  createdByUserId: PRINCIPAL.userId,
  creationIdempotencyKey: "key-1",
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const summary = { id: PRODUCTION_ID, title: "First", archivedAt: null, createdAt: NOW, updatedAt: NOW };

const fakePool = {
  query: async () => {
    throw new Error("unit tests use injected services");
  },
  end: async () => {},
  connect: async () => {
    throw new Error("unit tests use injected services");
  },
} as unknown as TransactionalPool;

let running: RunningCommercialApiServer | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

function services(overrides: Partial<Record<keyof CustomerApplicationServices, ReturnType<typeof vi.fn>>> = {}) {
  const spies = {
    provision: vi.fn(async () => ({
      user: { id: PRINCIPAL.userId },
      personalAccount: { id: PRINCIPAL.accountId, kind: "PERSONAL", status: "ACTIVE" },
      freeByoEntitlementGrant: { id: "g", state: "AVAILABLE", policyVersion: "free-byo-v1" },
      created: { user: true, personalAccount: true, freeByoEntitlementGrant: true },
      correlationId: randomUUID(),
    })),
    resolvePrincipal: vi.fn(async () => PRINCIPAL),
    createProduction: vi.fn(async () => ({ production, created: true, correlationId: randomUUID() })),
    listProductions: vi.fn(async () => [summary]),
    getProduction: vi.fn(async () => summary),
    ...overrides,
  };
  return spies;
}

async function start(spies: ReturnType<typeof services>, authAvailable = true) {
  const failures: string[] = [];
  const application = createCustomerApplication({
    authentication: createTestIdentityProvider([{ token: TOKEN, identity: ALICE }], { available: () => authAvailable }),
    pool: fakePool,
    services: spies as unknown as CustomerApplicationServices,
    reportFailure: (text) => failures.push(text),
  });
  running = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
  return { port: running.port, failures };
}

const error = (code: string) => `{"status":"error","code":"${code}"}\n`;

describe("authentication on every customer route", () => {
  const routes: [string, string][] = [
    ["POST", "/account/bootstrap"],
    ["POST", "/productions"],
    ["GET", "/productions"],
    ["GET", `/productions/${PRODUCTION_ID}`],
  ];

  it.each(routes)("%s %s requires authentication and never reaches a service", async (method, path) => {
    const spies = services();
    const { port } = await start(spies);
    const response = await send(port, method, path);

    expect(response.status).toBe(401);
    expect(response.body).toBe(error("AUTHENTICATION_REQUIRED"));
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ["an unknown token", { Authorization: "Bearer not-a-fixture" }],
    ["a malformed credential", { Authorization: "Basic dXNlcjpwYXNz" }],
    ["an identity-shaped credential", { Authorization: "Bearer issuer:subject:email" }],
  ])("returns the same generic 401 for %s, without echoing it", async (_label, headers) => {
    const spies = services();
    const { port } = await start(spies);
    const response = await send(port, "GET", "/productions", undefined, headers);

    expect(response.status).toBe(401);
    expect(response.body).toBe(error("AUTHENTICATION_REQUIRED"));
    expect(JSON.stringify(response.headers) + response.body).not.toMatch(/not-a-fixture|dXNlcjpwYXNz|issuer:subject/);
    expect(spies.resolvePrincipal).not.toHaveBeenCalled();
  });

  it("rejects two Authorization header lines on the wire, even if one is valid", async () => {
    const spies = services();
    const { port } = await start(spies);
    const raw = await sendRaw(
      port,
      `GET /productions HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${TOKEN}\r\nAuthorization: Bearer other\r\nConnection: close\r\n\r\n`,
    );

    expect(raw.startsWith("HTTP/1.1 401")).toBe(true);
    expect(raw.endsWith(error("AUTHENTICATION_REQUIRED"))).toBe(true);
    expect(raw).not.toContain(TOKEN);
    expect(spies.resolvePrincipal).not.toHaveBeenCalled();
  });

  it("returns 503 when the verifier is unavailable and logs only the code", async () => {
    const spies = services();
    const { port, failures } = await start(spies, false);
    const response = await send(port, "GET", "/productions", undefined, AUTH);

    expect(response.status).toBe(503);
    expect(response.body).toBe(error("SERVICE_UNAVAILABLE"));
    expect(failures).toEqual(["commercial-api: request failed (503 SERVICE_UNAVAILABLE AUTHENTICATION_UNAVAILABLE)\n"]);
    expect(failures.join("")).not.toContain(TOKEN);
  });

  it("ignores identity and account headers, queries and body fields as authority", async () => {
    const spies = services();
    const { port } = await start(spies);
    await send(port, "GET", "/productions?accountId=99999999-9999-4999-8999-999999999999&userId=x", undefined, {
      ...AUTH,
      "X-User-Id": "99999999-9999-4999-8999-999999999999",
      "X-Account-Id": "99999999-9999-4999-8999-999999999999",
      "X-Role": "OWNER",
      "X-Plan": "CREATOR",
    });

    expect(spies.resolvePrincipal).toHaveBeenCalledWith(fakePool, ALICE);
    expect(spies.listProductions).toHaveBeenCalledWith(fakePool, PRINCIPAL.accountId);
  });
});

describe("POST /account/bootstrap", () => {
  it("provisions from the trusted identity only and returns a minimal 200 body", async () => {
    const spies = services();
    const { port } = await start(spies);
    const response = await send(port, "POST", "/account/bootstrap", undefined, AUTH);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      user: { id: PRINCIPAL.userId },
      account: { id: PRINCIPAL.accountId, kind: "PERSONAL", status: "ACTIVE" },
      entitlements: { freeByo: { state: "AVAILABLE" }, hostedTrial: { available: false } },
      created: { user: true, account: true, freeByoGrant: true },
    });
    expect(spies.provision).toHaveBeenCalledTimes(1);
    const [, identity, options] = spies.provision.mock.calls[0] as unknown as [unknown, VerifiedIdentity, { correlationId: string }];
    expect(identity).toEqual(ALICE);
    expect(options.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body).not.toMatch(/alice-subject|issuer\.app\.test|alice@example|account-provisioning|free-byo-v1|correlation/);
  });

  it("rejects a request body", async () => {
    const spies = services();
    const { port } = await start(spies);
    const response = await send(port, "POST", "/account/bootstrap", '{"accountId":"x"}', { ...AUTH, "Content-Type": "application/json" });

    expect(response.status).toBe(400);
    expect(response.body).toBe(error("INVALID_REQUEST"));
    expect(spies.provision).not.toHaveBeenCalled();
  });

  it("maps a refused (disabled) identity to 403", async () => {
    const spies = services({
      provision: vi.fn(async () => {
        throw new ProvisioningError("PROVISIONING_REFUSED", "x", { reason: "USER_DISABLED" });
      }),
    });
    const { port } = await start(spies);
    const response = await send(port, "POST", "/account/bootstrap", undefined, AUTH);
    expect(response.status).toBe(403);
    expect(response.body).toBe(error("ACCOUNT_UNAVAILABLE"));
  });

  it("maps a provisioning database failure to 503 without detail", async () => {
    const spies = services({
      provision: vi.fn(async () => {
        throw new ProvisioningError("PROVISIONING_DATABASE_FAILURE", "x", { databaseCode: "08006", cause: new Error("host db.internal password=hunter2") });
      }),
    });
    const { port, failures } = await start(spies);
    const response = await send(port, "POST", "/account/bootstrap", undefined, AUTH);
    expect(response.status).toBe(503);
    expect(response.body).toBe(error("SERVICE_UNAVAILABLE"));
    expect(failures.join("")).not.toMatch(/hunter2|db\.internal/);
  });
});

describe("GET routes are read-only", () => {
  it("GET /productions resolves the principal but never provisions", async () => {
    const spies = services();
    const { port } = await start(spies);
    const response = await send(port, "GET", "/productions", undefined, AUTH);

    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      productions: [{ id: PRODUCTION_ID, title: "First", archivedAt: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() }],
    });
    expect(spies.provision).not.toHaveBeenCalled();
    expect(spies.createProduction).not.toHaveBeenCalled();
  });

  it.each(["USER_NOT_FOUND", "USER_DISABLED", "ACCOUNT_NOT_FOUND", "ACCOUNT_DISABLED"] as const)(
    "returns the same 403 for an unavailable principal (%s)",
    async (reason) => {
      const spies = services({
        resolvePrincipal: vi.fn(async () => {
          throw new PrincipalUnavailableError(reason);
        }),
      });
      const { port } = await start(spies);
      for (const [method, path] of [["GET", "/productions"], ["GET", `/productions/${PRODUCTION_ID}`]] as const) {
        const response = await send(port, method, path, undefined, AUTH);
        expect(response.status).toBe(403);
        expect(response.body).toBe(error("ACCOUNT_UNAVAILABLE"));
      }
      expect(spies.provision).not.toHaveBeenCalled();
      expect(spies.listProductions).not.toHaveBeenCalled();
    },
  );
});

describe("GET /productions/:productionId", () => {
  it("looks up only within the principal's account", async () => {
    const spies = services();
    const { port } = await start(spies);
    const response = await send(port, "GET", `/productions/${PRODUCTION_ID}`, undefined, AUTH);

    expect(response.status).toBe(200);
    expect(spies.getProduction).toHaveBeenCalledWith(fakePool, PRINCIPAL.accountId, PRODUCTION_ID);
  });

  it("answers missing, foreign and malformed IDs identically, without querying malformed ones", async () => {
    const spies = services({ getProduction: vi.fn(async () => null) });
    const { port } = await start(spies);

    const missing = await send(port, "GET", `/productions/${randomUUID()}`, undefined, AUTH);
    const malformed = await send(port, "GET", "/productions/not-a-uuid", undefined, AUTH);
    const unknownRoute = await send(port, "GET", "/no-such-route", undefined, AUTH);

    for (const response of [missing, malformed]) {
      expect(response.status).toBe(404);
      expect(response.body).toBe(unknownRoute.body);
    }
    expect(spies.getProduction).toHaveBeenCalledTimes(1);
  });
});

describe("POST /productions", () => {
  it("passes only the trusted user ID plus title and key to the service, returning 201", async () => {
    const spies = services();
    const { port } = await start(spies);
    const response = await send(port, "POST", "/productions", JSON.stringify({ title: "First", idempotencyKey: "key-1" }), JSON_HEADERS);

    expect(response.status).toBe(201);
    expect(JSON.parse(response.body)).toEqual({
      production: { id: PRODUCTION_ID, title: "First", archivedAt: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
    });
    const [, input, options] = spies.createProduction.mock.calls[0] as unknown as [unknown, object, { correlationId: string }];
    expect(input).toEqual({ userId: PRINCIPAL.userId, title: "First", idempotencyKey: "key-1" });
    expect(options.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body).not.toMatch(/accountId|creationEntitlementGrantId|createdByUserId|policy|grant/i);
  });

  it("returns 200 for an idempotent replay", async () => {
    const spies = services({ createProduction: vi.fn(async () => ({ production, created: false, correlationId: randomUUID() })) });
    const { port } = await start(spies);
    const response = await send(port, "POST", "/productions", JSON.stringify({ title: "First", idempotencyKey: "key-1" }), JSON_HEADERS);
    expect(response.status).toBe(200);
  });

  it.each([
    ["ENTITLEMENT_NOT_AVAILABLE", 403, "ENTITLEMENT_NOT_AVAILABLE"],
    ["IDEMPOTENCY_KEY_CONFLICT", 409, "IDEMPOTENCY_KEY_CONFLICT"],
    ["PRODUCTION_INPUT_INVALID", 400, "INVALID_REQUEST"],
    ["PRODUCTION_ACCOUNT_UNAVAILABLE", 403, "ACCOUNT_UNAVAILABLE"],
    ["ENTITLEMENT_POLICY_UNSUPPORTED", 503, "SERVICE_UNAVAILABLE"],
    ["PRODUCTION_DATABASE_FAILURE", 503, "SERVICE_UNAVAILABLE"],
    ["PRODUCTION_INVARIANT_VIOLATION", 500, "INTERNAL_ERROR"],
  ] as const)("maps %s to %i %s", async (code, status, httpCode) => {
    const spies = services({
      createProduction: vi.fn(async () => {
        throw new ProductionCreationError(code, "detail with secret-title", { databaseCode: "23505" });
      }),
    });
    const { port } = await start(spies);
    const response = await send(port, "POST", "/productions", JSON.stringify({ title: "secret-title" }), JSON_HEADERS);

    expect(response.status).toBe(status);
    expect(response.body).toBe(error(httpCode));
  });

  it.each([
    ["userId", { title: "T", userId: PRINCIPAL.userId }],
    ["accountId", { title: "T", accountId: PRINCIPAL.accountId }],
    ["grantId", { title: "T", grantId: "g" }],
    ["creationEntitlementGrantId", { title: "T", creationEntitlementGrantId: "g" }],
    ["ownerUserId", { title: "T", ownerUserId: "u" }],
    ["policyVersion", { title: "T", policyVersion: "free-byo-v1" }],
    ["state", { title: "T", state: "AVAILABLE" }],
    ["kind", { title: "T", kind: "FREE_BYO" }],
    ["archivedAt", { title: "T", archivedAt: null }],
    ["actorUserId", { title: "T", actorUserId: "u" }],
    ["metadata", { title: "T", metadata: {} }],
  ])("rejects a body containing %s before calling the service", async (_label, body) => {
    const spies = services();
    const { port } = await start(spies);
    const response = await send(port, "POST", "/productions", JSON.stringify(body), JSON_HEADERS);

    expect(response.status).toBe(400);
    expect(response.body).toBe(error("INVALID_REQUEST"));
    expect(spies.createProduction).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", '{"title": "T"', 400, "INVALID_REQUEST"],
    ["a JSON array", '["T"]', 400, "INVALID_REQUEST"],
    ["JSON null", "null", 400, "INVALID_REQUEST"],
    ["a JSON string", '"T"', 400, "INVALID_REQUEST"],
    ["a JSON number", "7", 400, "INVALID_REQUEST"],
    ["an empty body", "", 400, "INVALID_REQUEST"],
    ["duplicate members", '{"title":"A","title":"B"}', 400, "INVALID_REQUEST"],
    ["a duplicate escaped member", '{"title":"A","\\u0074itle":"B"}', 400, "INVALID_REQUEST"],
    ["an oversized body", JSON.stringify({ title: "x".repeat(5000) }), 413, "PAYLOAD_TOO_LARGE"],
  ])("rejects %s", async (_label, body, status, code) => {
    const spies = services();
    const { port } = await start(spies);
    const response = await send(port, "POST", "/productions", body, JSON_HEADERS);

    expect(response.status).toBe(status);
    expect(response.body).toBe(error(code));
    expect(response.body).not.toContain("xxxxxxxx");
    expect(spies.createProduction).not.toHaveBeenCalled();
  });

  it("accepts nested JSON only inside allowed members, and checks duplicates only at the top level", async () => {
    const spies = services();
    const { port } = await start(spies);
    // A nested object as the title is passed through and rejected by the service's own validation.
    spies.createProduction.mockImplementationOnce(async () => {
      throw new ProductionCreationError("PRODUCTION_INPUT_INVALID", "x");
    });
    const response = await send(port, "POST", "/productions", '{"title":{"title":1,"title":2}}', JSON_HEADERS);
    expect(response.status).toBe(400);
  });

  it.each([
    ["no content type", { ...AUTH }],
    ["text/plain", { ...AUTH, "Content-Type": "text/plain" }],
    ["form encoding", { ...AUTH, "Content-Type": "application/x-www-form-urlencoded" }],
    ["a non-UTF-8 charset", { ...AUTH, "Content-Type": "application/json; charset=latin1" }],
  ])("rejects %s with 415", async (_label, headers) => {
    const spies = services();
    const { port } = await start(spies);
    const response = await send(port, "POST", "/productions", '{"title":"T"}', headers);
    expect(response.status).toBe(415);
    expect(response.body).toBe(error("UNSUPPORTED_MEDIA_TYPE"));
  });

  it("accepts application/json with charset=utf-8", async () => {
    const spies = services();
    const { port } = await start(spies);
    const response = await send(port, "POST", "/productions", '{"title":"T"}', { ...AUTH, "Content-Type": "application/json; charset=UTF-8" });
    expect(response.status).toBe(201);
  });

  it("checks the principal before reading the body", async () => {
    const spies = services({
      resolvePrincipal: vi.fn(async () => {
        throw new PrincipalUnavailableError("USER_NOT_FOUND");
      }),
    });
    const { port } = await start(spies);
    const response = await send(port, "POST", "/productions", '{"title":"T"}', JSON_HEADERS);
    expect(response.status).toBe(403);
    expect(spies.createProduction).not.toHaveBeenCalled();
  });
});

describe("routing", () => {
  it.each([
    ["PUT", "/account/bootstrap", "POST"],
    ["GET", "/account/bootstrap", "POST"],
    ["DELETE", "/productions", "GET, POST"],
    ["PATCH", "/productions", "GET, POST"],
    ["POST", `/productions/${PRODUCTION_ID}`, "GET"],
    ["DELETE", `/productions/${PRODUCTION_ID}`, "GET"],
  ])("%s %s is 405 with Allow: %s and runs no authentication or service", async (method, path, allow) => {
    const spies = services();
    const { port } = await start(spies);
    const response = await send(port, method, path, undefined, AUTH);
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe(allow);
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });

  it.each(["/signup", "/login", "/logout", "/auth/callback", "/api/v1/productions", "/productions/", "/productions/a/b", "/account", "/accounts"])(
    "%s remains 404",
    async (path) => {
      const spies = services();
      const { port } = await start(spies);
      const response = await send(port, "POST", path, undefined, AUTH);
      expect(response.status).toBe(404);
      expect(response.body).toBe(error("NOT_FOUND"));
    },
  );

  it("keeps /__health and /__ready unchanged when the application is installed", async () => {
    const spies = services();
    const { port } = await start(spies);
    expect((await send(port, "GET", "/__health")).body).toBe('{"status":"ok","service":"commercial-api"}\n');
    expect((await send(port, "GET", "/__ready")).body).toBe('{"status":"ready","service":"commercial-api"}\n');
  });

  it("turns an unexpected service failure into a safe 500", async () => {
    const spies = services({
      listProductions: vi.fn(async () => {
        throw new TypeError("internal at /srv/app/secret.ts");
      }),
    });
    const { port, failures } = await start(spies);
    const response = await send(port, "GET", "/productions", undefined, AUTH);
    expect(response.status).toBe(500);
    expect(response.body).toBe(error("INTERNAL_ERROR"));
    expect(failures.join("")).not.toContain("/srv/app");
  });
});
