import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { createProviderConnectionApplication } from "../../src/application/providerConnectionApplication.js";
import type { TransactionalPool } from "../../src/database/runtimePool.js";
import { MAX_CREDENTIAL_JSON_BODY_BYTES, MAX_JSON_BODY_BYTES } from "../../src/http/requestBody.js";
import { MAX_CREDENTIAL_BYTES } from "commercial-worker-protocol";
import { isStructurallyValidVerificationPolicyId, resolveVerificationPolicyId } from "../../src/providerConnections/providerCapabilityRegistry.js";
import { ProviderConnectionError } from "../../src/providerConnections/providerConnectionError.js";
import { requestProviderVerification } from "../../src/providerConnections/providerVerificationService.js";
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
    ["POST", `/provider-connections/${id}/verify`],
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
    ["GET", `/provider-connections/${id}/verify`, "POST"],
    ["PUT", `/provider-connections/${id}/verify`, "POST"],
  ])("%s %s is 405 with Allow: %s", async (method, path, allow) => {
    const port = await start();
    const response = await send(port, method, path, undefined, AUTH);
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe(allow);
  });

  it.each(["/provider-connections/", `/provider-connections/${id}/verify/`, `/provider-connections/${id}/verify/now`, `/provider-connections/${id}/credentials/2`, "/provider-connections/a/b/c"])(
    "%s is 404 (no other routes)",
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
      ["POST", "/provider-connections/not-a-uuid/verify"],
    ] as const) {
      const response = await send(port, method, path, undefined, AUTH);
      expect(response.status).toBe(404);
      expect(response.body).toBe('{"status":"error","code":"NOT_FOUND"}\n');
    }
  });

  it("requires an empty verify body, rejected before any transaction", async () => {
    const port = await start();
    const response = await send(port, "POST", `/provider-connections/${id}/verify`, JSON.stringify({ credentialVersion: 1 }), { ...AUTH, "Content-Type": "application/json" });
    expect(response.status).toBe(400);
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

// R44B11F Phase 2: the verification capability is registry-supplied and
// default-off; the request path is control-plane only.
describe("R44B11F verification capability and request boundary", () => {
  const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
  const withoutComments = (text: string) => text.replace(/^\s*\/\/.*$/gm, "");
  const listSources = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? listSources(join(directory, entry.name)) : [join(directory, entry.name)],
    );

  it("resolves a policy ID only for an explicitly enabled, structurally valid capability", () => {
    const registry = createTestProviderRegistry([
      { provider: "LOCKED_A", connectionCreationEnabled: false, credentialKinds: ["API_KEY"], verificationEnabled: true, verificationPolicyId: "GOOGLE_GENAI_MODELS_LIST_V1BETA" },
      { provider: "LOCKED_B", connectionCreationEnabled: true, credentialKinds: ["API_KEY"], verificationEnabled: true, verificationPolicyId: "RUNWAY_ORGANIZATION_GET_V1_2024_11_06" },
      { provider: "TOO_LONG", connectionCreationEnabled: true, credentialKinds: ["API_KEY"], verificationEnabled: true, verificationPolicyId: `A${"B".repeat(128)}` },
    ]);
    expect(resolveVerificationPolicyId(registry, "TEST_PROVIDER")).toBe("TEST_PROVIDER_METADATA_V1");
    // Verification is independent of the connection-creation flag.
    expect(resolveVerificationPolicyId(registry, "LOCKED_A")).toBe("GOOGLE_GENAI_MODELS_LIST_V1BETA");
    expect(resolveVerificationPolicyId(registry, "LOCKED_B")).toBe("RUNWAY_ORGANIZATION_GET_V1_2024_11_06");
    for (const provider of [
      "UNVERIFIABLE_TEST_PROVIDER",
      "POLICY_ONLY_TEST_PROVIDER",
      "MALFORMED_POLICY_TEST_PROVIDER",
      "MISSING_POLICY_TEST_PROVIDER",
      "DISABLED_TEST_PROVIDER",
      "TOO_LONG",
      "UNKNOWN_PROVIDER",
    ]) {
      expect(resolveVerificationPolicyId(registry, provider), provider).toBeNull();
    }
    // A capability answering for a different provider fails closed.
    const mismatched = Object.freeze({
      resolve: () =>
        Object.freeze({ provider: "OTHER", connectionCreationEnabled: true, credentialKinds: ["API_KEY"], verificationEnabled: true, verificationPolicyId: "OTHER_METADATA_V1" }),
    });
    expect(resolveVerificationPolicyId(mismatched, "TEST_PROVIDER")).toBeNull();
    // A truthy non-boolean flag is not explicit enablement.
    const truthy = Object.freeze({
      resolve: () => ({ provider: "TEST_PROVIDER", connectionCreationEnabled: true, credentialKinds: ["API_KEY"], verificationEnabled: "true" as unknown as boolean, verificationPolicyId: "TEST_V1" }),
    });
    expect(resolveVerificationPolicyId(truthy, "TEST_PROVIDER")).toBeNull();

    for (const valid of ["A", "GOOGLE_GENAI_MODELS_LIST_V1BETA", "RUNWAY_ORGANIZATION_GET_V1_2024_11_06", `A${"B".repeat(127)}`]) {
      expect(isStructurallyValidVerificationPolicyId(valid), valid).toBe(true);
    }
    for (const invalid of ["", "lowercase", "_LEADING", "1LEADING", "HAS-DASH", "HAS SPACE", `A${"B".repeat(128)}`, null, 7]) {
      expect(isStructurallyValidVerificationPolicyId(invalid), String(invalid)).toBe(false);
    }
  });

  it("rejects a malformed connection ID before any database work", async () => {
    const pool = {
      query: async () => {
        throw new Error("unexpected query");
      },
      end: async () => {},
      connect: async () => {
        throw new Error("unexpected transaction");
      },
    } as TransactionalPool;
    await expect(
      requestProviderVerification({ pool, registry: createTestProviderRegistry() }, { userId: randomUUID(), accountId: randomUUID() }, "not-a-uuid"),
    ).rejects.toMatchObject({ code: "PROVIDER_CONNECTION_NOT_FOUND" });
  });

  it("keeps production source default-off: no capability enables verification and no provider policy ID is named", () => {
    for (const path of listSources(SRC)) {
      const code = withoutComments(readFileSync(path, "utf8"));
      expect(/verificationEnabled\s*:\s*true/.test(code), path).toBe(false);
      expect(/_V1BETA|_ORGANIZATION_GET_|generativelanguage|api\.dev\./i.test(code), path).toBe(false);
    }
  });

  it("performs no provider network operation and never reads, opens or leaks credential or lease material", () => {
    const service = withoutComments(readFileSync(join(SRC, "providerConnections", "providerVerificationService.ts"), "utf8"));
    expect(/fetch\s*\(|node:https?|node:net|node:tls|node:dns|undici|https?:\/\/|XMLHttpRequest|WebSocket/.test(service)).toBe(false);
    expect(/sealed|envelope|fingerprint|CredentialOpener|\.open\s*\(|commercial-worker-protocol|createDecipheriv/i.test(service)).toBe(false);
    expect(/lease_|credential_granted_at|verifying_|result_|completed_at|terminal_reason_code/.test(service)).toBe(false);
    // Guard the guards.
    expect(/fetch\s*\(|node:https?/.test('await fetch("https://example.invalid")')).toBe(true);
    expect(/lease_|credential_granted_at/.test("SET lease_token_sha256 = $1")).toBe(true);
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
      expect((await send(running!.port, "POST", `/provider-connections/${randomUUID()}/verify`, undefined, AUTH)).status).toBe(404);
    } finally {
      await running!.close();
    }
  });
});
