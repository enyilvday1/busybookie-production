import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it } from "vitest";

import { createProviderConnectionApplication } from "../../src/application/providerConnectionApplication.js";
import type { TransactionalPool } from "../../src/database/runtimePool.js";
import { MAX_CREDENTIAL_JSON_BODY_BYTES, MAX_JSON_BODY_BYTES } from "../../src/http/requestBody.js";
import { MAX_CREDENTIAL_BYTES } from "../../src/providerCredentials/credentialInput.js";
import { ProviderConnectionError } from "../../src/providerConnections/providerConnectionError.js";
import { validateCreateInput, validateRotateInput } from "../../src/providerConnections/providerConnectionService.js";
import { runCommercialApiProcess, type ShutdownSignal } from "../../src/runCommercialApiProcess.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { send } from "../httpClient.js";
import { createTestCredentialFingerprinter, createTestCredentialSealer, generateTestKey } from "../support/testCredentialCrypto.js";
import { createTestIdentityProvider } from "../support/testIdentityProvider.js";
import { createTestProviderRegistry } from "../support/testProviderRegistry.js";

const SECRET = `fixture-credential-${randomBytes(12).toString("hex")}`;
const TOKEN = "fixture-token-unit";
const AUTH = { Authorization: `Bearer ${TOKEN}` };
const PRINCIPAL_ROW = { user_id: "11111111-1111-4111-8111-111111111111", user_status: "ACTIVE", account_id: "22222222-2222-4222-8222-222222222222", account_status: "ACTIVE" };

function expectCode(fn: () => unknown, code: string) {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ProviderConnectionError);
  expect((caught as ProviderConnectionError).code).toBe(code);
  expect(`${(caught as Error).message} ${JSON.stringify(caught)}`).not.toContain(SECRET);
}

describe("request validation (no normalisation, exact keys)", () => {
  it("accepts the exact create contract and keeps the credential byte-for-byte", () => {
    for (const credential of [SECRET, ` ${SECRET} `, SECRET.toUpperCase(), "é"]) {
      const input = validateCreateInput({ provider: "TEST_PROVIDER", label: "Studio", credential, idempotencyKey: "k-1" });
      expect(input).toEqual({ provider: "TEST_PROVIDER", label: "Studio", credential, idempotencyKey: "k-1" });
    }
    expect(validateCreateInput({ provider: "TEST_PROVIDER", credential: SECRET })).toEqual({ provider: "TEST_PROVIDER", label: null, credential: SECRET, idempotencyKey: null });
  });

  it.each([
    "accountId",
    "userId",
    "credentialKind",
    "status",
    "verificationStatus",
    "credentialVersion",
    "providerConnectionId",
    "envelope",
    "sealedCredential",
    "fingerprint",
    "keyRef",
    "metadata",
    "createdByUserId",
  ])("rejects a create body containing %s", (field) => {
    expectCode(() => validateCreateInput({ provider: "TEST_PROVIDER", credential: SECRET, [field]: "x" }), "PROVIDER_CONNECTION_INPUT_INVALID");
  });

  it.each([
    ["a lowercase provider", { provider: "test_provider", credential: SECRET }],
    ["an empty credential", { provider: "TEST_PROVIDER", credential: "" }],
    ["an oversized credential", { provider: "TEST_PROVIDER", credential: "x".repeat(MAX_CREDENTIAL_BYTES + 1) }],
    ["a NUL credential", { provider: "TEST_PROVIDER", credential: `${SECRET}\u0000` }],
    ["a padded label", { provider: "TEST_PROVIDER", credential: SECRET, label: " Studio" }],
    ["a 101-character label", { provider: "TEST_PROVIDER", credential: SECRET, label: "x".repeat(101) }],
    ["an empty label", { provider: "TEST_PROVIDER", credential: SECRET, label: "" }],
    ["an empty idempotency key", { provider: "TEST_PROVIDER", credential: SECRET, idempotencyKey: "" }],
    ["a 129-character idempotency key", { provider: "TEST_PROVIDER", credential: SECRET, idempotencyKey: "k".repeat(129) }],
  ])("rejects %s", (_label, body) => {
    expectCode(() => validateCreateInput(body), "PROVIDER_CONNECTION_INPUT_INVALID");
  });

  it("accepts only credential and idempotencyKey for rotation", () => {
    expect(validateRotateInput({ credential: SECRET, idempotencyKey: "r-1" })).toEqual({ credential: SECRET, idempotencyKey: "r-1" });
    for (const field of ["credentialVersion", "provider", "accountId", "status"]) {
      expectCode(() => validateRotateInput({ credential: SECRET, [field]: 2 }), "PROVIDER_CONNECTION_INPUT_INVALID");
    }
  });
});

describe("body bounds", () => {
  it("keeps the existing default and gives credential routes a dedicated larger bound", () => {
    expect(MAX_JSON_BODY_BYTES).toBe(4096);
    expect(MAX_CREDENTIAL_JSON_BODY_BYTES).toBe(65_536);
    // The largest valid credential, maximally escaped as JSON (\\uXXXX = 6 bytes per byte), fits.
    expect(MAX_CREDENTIAL_BYTES * 6 + 256).toBeLessThan(MAX_CREDENTIAL_JSON_BODY_BYTES);
  });
});

describe("HTTP routing without a database", () => {
  let running: RunningCommercialApiServer | undefined;
  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  // The pool answers only the read-only principal query; any other use fails.
  const pool = {
    query: async <Row extends object>(sql: string) => {
      if (sql.includes("FROM users u")) return { rows: [PRINCIPAL_ROW] as unknown as Row[] };
      throw new Error("unexpected query in unit test");
    },
    end: async () => {},
    connect: async () => {
      throw new Error("unexpected transaction in unit test");
    },
  } as TransactionalPool;

  async function start() {
    const encryptionKey = generateTestKey("unit-encryption/v1");
    const application = createProviderConnectionApplication({
      authentication: createTestIdentityProvider([{ token: TOKEN, identity: { issuer: "https://issuer.unit.test/", subject: "unit" } }]),
      pool,
      registry: createTestProviderRegistry(),
      sealer: createTestCredentialSealer(encryptionKey),
      fingerprinter: createTestCredentialFingerprinter(generateTestKey("unit-fingerprint/v1"), encryptionKey),
      reportFailure: () => {},
    });
    running = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
    return running.port;
  }

  const id = randomUUID();

  it.each([
    ["GET", "/provider-connections"],
    ["POST", "/provider-connections"],
    ["GET", `/provider-connections/${id}`],
    ["POST", `/provider-connections/${id}/credentials`],
    ["POST", `/provider-connections/${id}/disconnect`],
  ])("%s %s requires authentication", async (method, path) => {
    const port = await start();
    const response = await send(port, method, path);
    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
  });

  it.each([
    ["DELETE", "/provider-connections", "GET, POST"],
    ["PUT", `/provider-connections/${id}`, "GET"],
    ["DELETE", `/provider-connections/${id}`, "GET"],
    ["GET", `/provider-connections/${id}/credentials`, "POST"],
    ["GET", `/provider-connections/${id}/disconnect`, "POST"],
  ])("%s %s is 405 with Allow: %s", async (method, path, allow) => {
    const port = await start();
    const response = await send(port, method, path, undefined, AUTH);
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe(allow);
  });

  it.each(["/provider-connections/", `/provider-connections/${id}/verify`, `/provider-connections/${id}/credentials/2`, "/provider-connections/a/b/c"])(
    "%s is 404 (no verify or other routes)",
    async (path) => {
      const port = await start();
      expect((await send(port, "POST", path, undefined, AUTH)).status).toBe(404);
    },
  );

  it("answers malformed connection IDs with the generic 404, before any body or transaction", async () => {
    const port = await start();
    for (const [method, path] of [
      ["GET", "/provider-connections/not-a-uuid"],
      ["POST", "/provider-connections/not-a-uuid/credentials"],
      ["POST", "/provider-connections/NOT-A-UUID/disconnect"],
    ] as const) {
      const response = await send(port, method, path, undefined, AUTH);
      expect(response.status).toBe(404);
      expect(response.body).toBe('{"status":"error","code":"NOT_FOUND"}\n');
    }
  });

  it("returns 413 above the credential bound and never echoes the body", async () => {
    const port = await start();
    const body = JSON.stringify({ provider: "TEST_PROVIDER", credential: `${SECRET}${"x".repeat(MAX_CREDENTIAL_JSON_BODY_BYTES)}` });
    const response = await send(port, "POST", "/provider-connections", body, { ...AUTH, "Content-Type": "application/json" });
    expect(response.status).toBe(413);
    expect(response.body).toBe('{"status":"error","code":"PAYLOAD_TOO_LARGE"}\n');
    expect(JSON.stringify(response.headers) + response.body).not.toContain(SECRET);
  });

  it("rejects a forbidden body member with a generic 400 that does not echo the credential", async () => {
    const port = await start();
    const response = await send(port, "POST", "/provider-connections", JSON.stringify({ provider: "TEST_PROVIDER", credential: SECRET, accountId: id }), {
      ...AUTH,
      "Content-Type": "application/json",
    });
    expect(response.status).toBe(400);
    expect(response.body).not.toContain(SECRET);
  });
});

describe("process composition", () => {
  it("refuses provider connections without the authenticated application", async () => {
    const stderr: string[] = [];
    const encryptionKey = generateTestKey("unit-encryption/v1");
    const result = await runCommercialApiProcess({
      environment: { COMMERCIAL_API_DATABASE_URL: "postgres://app_runtime@127.0.0.1:5433/app_db" },
      onSignal: (_signal: ShutdownSignal, _listener: () => void) => {},
      writeStdout: () => {},
      writeStderr: (text) => stderr.push(text),
      setExitCode: () => {},
      providerConnections: {
        registry: createTestProviderRegistry(),
        sealer: createTestCredentialSealer(encryptionKey),
        fingerprinter: createTestCredentialFingerprinter(generateTestKey("unit-fingerprint/v1"), encryptionKey),
      },
    });
    expect(result).toBeNull();
    expect(stderr.join("")).toContain("Provider connections require the authenticated application.");
  });

  it("cannot be enabled through environment variables", async () => {
    const signals = new EventEmitter();
    const running = await runCommercialApiProcess({
      environment: {
        COMMERCIAL_API_PROVIDER_CONNECTIONS: "YES",
        COMMERCIAL_API_TEST_CRYPTO: "YES",
        COMMERCIAL_API_PROVIDER_REGISTRY: "TEST_PROVIDER",
        NODE_ENV: "test",
      },
      onSignal: (signal: ShutdownSignal, listener: () => void) => {
        signals.once(signal, listener);
      },
      writeStdout: () => {},
      writeStderr: () => {},
      setExitCode: () => {},
      startServer: (options) => startCommercialApiServer({ ...options, port: 0 }),
    });
    try {
      for (const path of ["/provider-connections", `/provider-connections/${randomUUID()}`]) {
        expect((await send(running!.port, "GET", path, undefined, AUTH)).status).toBe(404);
      }
      expect((await send(running!.port, "POST", `/provider-connections/${randomUUID()}/disconnect`, undefined, AUTH)).status).toBe(404);
    } finally {
      await running!.close();
    }
  });
});
