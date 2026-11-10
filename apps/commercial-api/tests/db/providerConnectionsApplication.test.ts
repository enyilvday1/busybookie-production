import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { combineApplicationRouters } from "../../src/application/combineApplicationRouters.js";
import { createCustomerApplication } from "../../src/application/customerApplication.js";
import { createProviderConnectionApplication } from "../../src/application/providerConnectionApplication.js";
import type { AuthenticationAdapter } from "../../src/authentication/authenticationAdapter.js";
import type { VerifiedIdentity } from "../../src/authentication/verifiedIdentity.js";
import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type TransactionalPool } from "../../src/database/runtimePool.js";
import { PROVIDER_CREDENTIAL_PURPOSE } from "../../src/providerCredentials/credentialContext.js";
import { runCommercialApiProcess, type ShutdownSignal } from "../../src/runCommercialApiProcess.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { send, type TestResponse } from "../httpClient.js";
import { createTestCredentialFingerprinter, createTestCredentialOpener, createTestCredentialSealer, generateTestKey } from "../support/testCredentialCrypto.js";
import { createTestIdentityProvider } from "../support/testIdentityProvider.js";
import { createTestProviderRegistry } from "../support/testProviderRegistry.js";
import { openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

// ProviderConnection HTTP application against PostgreSQL 16, composed only in
// this test with the test identity provider, test registry and test crypto.
// Credentials are generated fixtures; assertions never print them.

const ISSUER = "https://issuer.provider-connections.test/";
const identities = {
  alice: { issuer: ISSUER, subject: "pc-alice" },
  bob: { issuer: ISSUER, subject: "pc-bob" },
  process: { issuer: ISSUER, subject: "pc-process" },
} satisfies Record<string, VerifiedIdentity>;
type Name = keyof typeof identities;
const auth = (name: Name) => ({ Authorization: `Bearer fixture-${name}` });
const jsonAuth = (name: Name) => ({ ...auth(name), "Content-Type": "application/json" });

const newCredential = () => `fixture-credential-${randomBytes(18).toString("hex")}`;

let clients: GuardedClients;
let adapter: AuthenticationAdapter;
const encryptionKey = generateTestKey("pc-test-encryption/v1");
const crypto = {
  registry: createTestProviderRegistry(),
  sealer: createTestCredentialSealer(encryptionKey),
  fingerprinter: createTestCredentialFingerprinter(generateTestKey("pc-test-fingerprint/v1"), encryptionKey),
};
// Test oracle only: proves what was sealed. The application never has one.
const opener = createTestCredentialOpener(encryptionKey);

const pools: TransactionalPool[] = [];
const servers: RunningCommercialApiServer[] = [];
let portA: number;
let portB: number;

async function composition(): Promise<number> {
  const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: "12" }, "development");
  const pool = await createRuntimePool(config!, () => {});
  pools.push(pool);
  const application = combineApplicationRouters(
    createCustomerApplication({ authentication: adapter, pool, reportFailure: () => {} }),
    createProviderConnectionApplication({ authentication: adapter, pool, ...crypto, reportFailure: () => {} }),
  );
  const server = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
  servers.push(server);
  return server.port;
}

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
  adapter = createTestIdentityProvider(Object.entries(identities).map(([name, identity]) => ({ token: `fixture-${name}`, identity })));
  portA = await composition();
  portB = await composition();
  for (const name of ["alice", "bob"] as const) {
    expect((await send(portA, "POST", "/account/bootstrap", undefined, auth(name))).status).toBe(200);
  }
});

afterAll(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
  await prepareSchemaV1(clients);
  await clients.close();
});

const json = (response: TestResponse) => JSON.parse(response.body) as Record<string, any>;

const create = (name: Name, body: Record<string, unknown>, port = portA) =>
  send(port, "POST", "/provider-connections", JSON.stringify(body), jsonAuth(name));
const rotate = (name: Name, id: string, body: Record<string, unknown>, port = portA) =>
  send(port, "POST", `/provider-connections/${id}/credentials`, JSON.stringify(body), jsonAuth(name));
const disconnect = (name: Name, id: string, port = portA) => send(port, "POST", `/provider-connections/${id}/disconnect`, undefined, auth(name));

async function accountIdOf(name: Name): Promise<string> {
  const result = await clients.migrator.query<{ id: string }>(
    "SELECT a.id FROM accounts a JOIN users u ON u.id = a.owner_user_id WHERE u.idp_issuer = $1 AND u.idp_subject = $2",
    [identities[name].issuer, identities[name].subject],
  );
  return result.rows[0]!.id;
}

async function versionsOf(connectionId: string) {
  const result = await clients.migrator.query<{
    credential_version: number;
    status: string;
    sealed_credential: unknown;
    fingerprint_value: string | null;
    fingerprint_key_ref: string | null;
    fingerprint_algorithm: string | null;
    superseded_at: Date | null;
    destroyed_at: Date | null;
  }>(
    `SELECT credential_version, status, sealed_credential, fingerprint_value, fingerprint_key_ref, fingerprint_algorithm, superseded_at, destroyed_at
       FROM provider_credential_versions WHERE provider_connection_id = $1 ORDER BY credential_version`,
    [connectionId],
  );
  return result.rows;
}

async function auditsFor(connectionId: string) {
  const result = await clients.migrator.query<{ event_type: string; actor_type: string; metadata: Record<string, unknown> }>(
    "SELECT event_type, actor_type, metadata FROM audit_events WHERE resource_type = 'provider_connection' AND resource_id = $1 ORDER BY sequence",
    [connectionId],
  );
  return result.rows;
}

// Counts rows whose text form contains the plaintext; the plaintext itself is never printed.
async function plaintextOccurrences(secret: string): Promise<number> {
  const result = await clients.migrator.query<{ hits: number }>(
    `SELECT (SELECT count(*) FROM provider_connections t WHERE strpos(t::text, $1) > 0)
          + (SELECT count(*) FROM provider_credential_versions t WHERE strpos(t::text, $1) > 0)
          + (SELECT count(*) FROM audit_events t WHERE strpos(t::text, $1) > 0) AS hits`,
    [secret],
  );
  return Number(result.rows[0]!.hits);
}

const SAFE_DTO_KEYS = [
  "createdAt",
  "credentialKind",
  "currentCredentialStatus",
  "currentCredentialVersion",
  "disconnectedAt",
  "id",
  "label",
  "provider",
  "status",
  "updatedAt",
  "verificationStatus",
];

function expectNoSecret(response: TestResponse, secret: string) {
  // Boolean assertions so a failure never prints the secret.
  expect(response.body.includes(secret)).toBe(false);
  expect(JSON.stringify(response.headers).includes(secret)).toBe(false);
  expect(/fingerprint|sealed|envelope|ciphertext|keyRef|accountId|createdByUserId/i.test(response.body)).toBe(false);
}

describe("create", () => {
  it("creates one connection, one ACTIVE version 1 and one audit event, in fail-closed states", async () => {
    const credential = newCredential();
    const response = await create("alice", { provider: "TEST_PROVIDER", label: "Studio key", credential, idempotencyKey: "create-1" });

    expect(response.status).toBe(201);
    expectNoSecret(response, credential);
    const dto = json(response).providerConnection;
    expect(Object.keys(dto).sort()).toEqual(SAFE_DTO_KEYS);
    expect(dto).toMatchObject({
      provider: "TEST_PROVIDER",
      credentialKind: "API_KEY",
      label: "Studio key",
      status: "PENDING_VERIFICATION",
      verificationStatus: "UNVERIFIED",
      currentCredentialVersion: 1,
      currentCredentialStatus: "ACTIVE",
      disconnectedAt: null,
    });

    const versions = await versionsOf(dto.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ credential_version: 1, status: "ACTIVE", fingerprint_algorithm: "HMAC-SHA-256", fingerprint_key_ref: "pc-test-fingerprint/v1" });
    expect((versions[0]!.sealed_credential as { format: string }).format).toBe("sealed-credential-v1");

    // Sealed for exactly this account, connection, provider and version 1, over the exact bytes.
    const context = {
      accountId: await accountIdOf("alice"),
      providerConnectionId: dto.id,
      provider: "TEST_PROVIDER",
      credentialVersion: 1,
      purpose: PROVIDER_CREDENTIAL_PURPOSE,
    } as const;
    expect((await opener.open(versions[0]!.sealed_credential, context)) === credential).toBe(true);
    await expect(opener.open(versions[0]!.sealed_credential, { ...context, credentialVersion: 2 })).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });

    expect(await auditsFor(dto.id)).toEqual([{ event_type: "provider_connection.created", actor_type: "USER", metadata: { provider: "TEST_PROVIDER", credentialVersion: 1 } }]);
    expect(await plaintextOccurrences(credential)).toBe(0);

    // Replay returns the same connection, with nothing new written.
    const replay = await create("alice", { provider: "TEST_PROVIDER", label: "Studio key", credential, idempotencyKey: "create-1" }, portB);
    expect(replay.status).toBe(200);
    expect(json(replay).providerConnection.id).toBe(dto.id);
    expect(await versionsOf(dto.id)).toHaveLength(1);
    expect(await auditsFor(dto.id)).toHaveLength(1);

    // Same key, different request: conflict.
    for (const body of [
      { provider: "TEST_PROVIDER", label: "Other label", credential, idempotencyKey: "create-1" },
      { provider: "TEST_PROVIDER", label: "Studio key", credential: newCredential(), idempotencyKey: "create-1" },
      { provider: "SECOND_TEST_PROVIDER", label: "Studio key", credential, idempotencyKey: "create-1" },
    ]) {
      const conflict = await create("alice", body);
      expect(conflict.status).toBe(409);
      expect(conflict.body).toBe('{"status":"error","code":"IDEMPOTENCY_KEY_CONFLICT"}\n');
    }
  });

  it("converges concurrent identical creates on one connection", async () => {
    const credential = newCredential();
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_unused, index) => create("alice", { provider: "TEST_PROVIDER", credential, idempotencyKey: "concurrent-create" }, index % 2 ? portA : portB)),
    );
    expect(responses.every((response) => response.status === 200 || response.status === 201)).toBe(true);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    const ids = new Set(responses.map((response) => json(response).providerConnection.id));
    expect(ids.size).toBe(1);
    const [id] = [...ids];
    expect(await versionsOf(id!)).toHaveLength(1);
    expect(await auditsFor(id!)).toHaveLength(1);
  });

  it("rejects a duplicate live credential in the same account, including under concurrency, but not across accounts", async () => {
    const credential = newCredential();
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_unused, index) => create("alice", { provider: "TEST_PROVIDER", credential, idempotencyKey: `dup-${index}` }, index % 2 ? portA : portB)),
    );
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    for (const response of responses.filter((candidate) => candidate.status !== 201)) {
      expect(response.status).toBe(409);
      expect(response.body).toBe('{"status":"error","code":"DUPLICATE_CREDENTIAL"}\n');
    }
    expect((await create("alice", { provider: "TEST_PROVIDER", credential })).status).toBe(409);

    // Bob may connect the same credential; Alice's ownership is never revealed.
    const bob = await create("bob", { provider: "TEST_PROVIDER", credential });
    expect(bob.status).toBe(201);
    expectNoSecret(bob, credential);
  });

  it.each([
    ["a disabled provider", "DISABLED_TEST_PROVIDER", 400, "PROVIDER_UNSUPPORTED"],
    ["a provider without API-key support", "OAUTH_ONLY_TEST_PROVIDER", 400, "PROVIDER_UNSUPPORTED"],
    ["an unknown provider", "UNKNOWN_PROVIDER", 400, "PROVIDER_UNSUPPORTED"],
    ["a malformed provider", "test-provider", 400, "INVALID_REQUEST"],
  ])("refuses %s before persistence", async (_label, provider, status, code) => {
    const before = await clients.migrator.query("SELECT count(*)::int AS count FROM provider_connections");
    const response = await create("alice", { provider, credential: newCredential() });
    expect(response.status).toBe(status);
    expect(response.body).toBe(`{"status":"error","code":"${code}"}\n`);
    expect((await clients.migrator.query("SELECT count(*)::int AS count FROM provider_connections")).rows).toEqual(before.rows);
  });

  it("rejects account, user and state authority in the body", async () => {
    const response = await create("alice", { provider: "TEST_PROVIDER", credential: newCredential(), accountId: await accountIdOf("bob"), credentialKind: "API_KEY" });
    expect(response.status).toBe(400);
  });
});

describe("read isolation", () => {
  it("lists and gets only the caller's connections; foreign, missing and malformed IDs look identical", async () => {
    const aliceCredential = newCredential();
    const aliceConnection = json(await create("alice", { provider: "TEST_PROVIDER", credential: aliceCredential, label: "Alice only" })).providerConnection;

    const aliceList = json(await send(portA, "GET", "/provider-connections", undefined, auth("alice"))).providerConnections as { id: string }[];
    const bobList = json(await send(portB, "GET", "/provider-connections", undefined, auth("bob"))).providerConnections as { id: string; label: string | null }[];
    expect(aliceList.some((item) => item.id === aliceConnection.id)).toBe(true);
    expect(bobList.some((item) => item.id === aliceConnection.id)).toBe(false);
    for (const item of [...aliceList, ...bobList]) expect(Object.keys(item).sort()).toEqual(SAFE_DTO_KEYS);

    const own = await send(portA, "GET", `/provider-connections/${aliceConnection.id}`, undefined, auth("alice"));
    expect(own.status).toBe(200);
    expectNoSecret(own, aliceCredential);

    const aliceAccount = await accountIdOf("alice");
    const foreign = await send(portB, "GET", `/provider-connections/${aliceConnection.id}?accountId=${aliceAccount}`, undefined, {
      ...auth("bob"),
      "X-Account-Id": aliceAccount,
    });
    const missing = await send(portB, "GET", `/provider-connections/${randomUUID()}`, undefined, auth("bob"));
    const malformed = await send(portB, "GET", "/provider-connections/not-a-uuid", undefined, auth("bob"));
    for (const response of [foreign, missing, malformed]) {
      expect(response.status).toBe(404);
      expect(response.body).toBe('{"status":"error","code":"NOT_FOUND"}\n');
    }

    const spoofedList = json(await send(portB, "GET", `/provider-connections?accountId=${aliceAccount}`, undefined, { ...auth("bob"), "X-Account-Id": aliceAccount }))
      .providerConnections as { id: string }[];
    expect(spoofedList.some((item) => item.id === aliceConnection.id)).toBe(false);

    // Bob cannot rotate or disconnect Alice's connection, and nothing changes.
    expect((await rotate("bob", aliceConnection.id, { credential: newCredential() }, portB)).status).toBe(404);
    expect((await disconnect("bob", aliceConnection.id, portB)).status).toBe(404);
    expect((await versionsOf(aliceConnection.id)).map((version) => version.status)).toEqual(["ACTIVE"]);
  });
});

describe("rotation", () => {
  it("supersedes v1, adds an ACTIVE v2 sealed for v2, resets verification and never rewrites v1", async () => {
    const first = newCredential();
    const second = newCredential();
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential: first })).providerConnection;
    // Simulate an earlier successful verification so the reset is observable.
    await pools[0]!.query(
      "UPDATE provider_connections SET status = 'ACTIVE', verification_status = 'VERIFIED', verified_at = now(), last_verification_attempt_at = now() WHERE id = $1",
      [connection.id],
    );
    const [v1Before] = await versionsOf(connection.id);

    const rotated = await rotate("alice", connection.id, { credential: second, idempotencyKey: "rotate-1" });
    expect(rotated.status).toBe(201);
    expectNoSecret(rotated, second);
    expect(json(rotated)).toMatchObject({
      credentialVersion: 2,
      providerConnection: { status: "PENDING_VERIFICATION", verificationStatus: "UNVERIFIED", currentCredentialVersion: 2, currentCredentialStatus: "ACTIVE" },
    });
    const state = await clients.migrator.query("SELECT verified_at, last_verification_attempt_at FROM provider_connections WHERE id = $1", [connection.id]);
    expect(state.rows).toEqual([{ verified_at: null, last_verification_attempt_at: null }]);

    const [v1, v2] = await versionsOf(connection.id);
    expect(v1).toMatchObject({ credential_version: 1, status: "SUPERSEDED" });
    expect(v1!.superseded_at).not.toBeNull();
    expect(v1!.sealed_credential).toEqual(v1Before!.sealed_credential);
    expect(v1!.fingerprint_value).toBe(v1Before!.fingerprint_value);
    expect(v2).toMatchObject({ credential_version: 2, status: "ACTIVE" });

    const context = { accountId: await accountIdOf("alice"), providerConnectionId: connection.id, provider: "TEST_PROVIDER", credentialVersion: 2, purpose: PROVIDER_CREDENTIAL_PURPOSE } as const;
    expect((await opener.open(v2!.sealed_credential, context)) === second).toBe(true);
    await expect(opener.open(v2!.sealed_credential, { ...context, credentialVersion: 1 })).rejects.toMatchObject({ code: "AUTHENTICATION_FAILED" });

    // Replay returns the existing version; a different credential under the key conflicts.
    const replay = await rotate("alice", connection.id, { credential: second, idempotencyKey: "rotate-1" }, portB);
    expect(replay.status).toBe(200);
    expect(json(replay).credentialVersion).toBe(2);
    expect((await rotate("alice", connection.id, { credential: newCredential(), idempotencyKey: "rotate-1" })).body).toBe(
      '{"status":"error","code":"IDEMPOTENCY_KEY_CONFLICT"}\n',
    );

    // The active credential again: no meaningless new version.
    const unchanged = await rotate("alice", connection.id, { credential: second });
    expect(unchanged.status).toBe(409);
    expect(unchanged.body).toBe('{"status":"error","code":"CREDENTIAL_UNCHANGED"}\n');

    expect(await versionsOf(connection.id)).toHaveLength(2);
    const audits = await auditsFor(connection.id);
    expect(audits.map((event) => event.event_type)).toEqual(["provider_connection.created", "provider_connection.credential_rotated"]);
    expect(audits[1]!.metadata).toEqual({ provider: "TEST_PROVIDER", credentialVersion: 2 });
    expect(await plaintextOccurrences(first)).toBe(0);
    expect(await plaintextOccurrences(second)).toBe(0);
  });

  it("converges concurrent identical rotations and serialises concurrent different ones", async () => {
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;

    const credential = newCredential();
    const same = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) => rotate("alice", connection.id, { credential, idempotencyKey: "same-rotation" }, index % 2 ? portA : portB)),
    );
    expect(same.every((response) => response.status === 200 || response.status === 201)).toBe(true);
    expect(same.filter((response) => response.status === 201)).toHaveLength(1);
    expect(new Set(same.map((response) => json(response).credentialVersion))).toEqual(new Set([2]));

    const different = await Promise.all(
      Array.from({ length: 3 }, (_unused, index) => rotate("alice", connection.id, { credential: newCredential() }, index % 2 ? portA : portB)),
    );
    expect(different.map((response) => response.status)).toEqual([201, 201, 201]);
    expect(new Set(different.map((response) => json(response).credentialVersion))).toEqual(new Set([3, 4, 5]));

    const versions = await versionsOf(connection.id);
    expect(versions.map((version) => version.credential_version)).toEqual([1, 2, 3, 4, 5]);
    expect(versions.filter((version) => version.status === "ACTIVE")).toHaveLength(1);
    expect((await auditsFor(connection.id)).filter((event) => event.event_type === "provider_connection.credential_rotated")).toHaveLength(4);
  });

  it("refuses rotation of DISABLED and DISCONNECTED connections", async () => {
    const disabled = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;
    await pools[0]!.query("UPDATE provider_connections SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [disabled.id]);
    const disabledRotation = await rotate("alice", disabled.id, { credential: newCredential() });
    expect(disabledRotation.status).toBe(409);
    expect(disabledRotation.body).toBe('{"status":"error","code":"CONNECTION_STATE_CONFLICT"}\n');

    const disconnected = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;
    expect((await disconnect("alice", disconnected.id)).status).toBe(200);
    expect((await rotate("alice", disconnected.id, { credential: newCredential() })).body).toBe('{"status":"error","code":"CONNECTION_STATE_CONFLICT"}\n');
  });
});

describe("disconnect", () => {
  it("disconnects logically, destroys every version with no open obligation, and is idempotent", async () => {
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;
    expect((await rotate("alice", connection.id, { credential: newCredential() })).status).toBe(201);

    const first = await disconnect("alice", connection.id);
    expect(first.status).toBe(200);
    expect(json(first).providerConnection).toMatchObject({ status: "DISCONNECTED", currentCredentialVersion: 2, currentCredentialStatus: "DESTROYED" });
    expect(json(first).providerConnection.disconnectedAt).not.toBeNull();

    for (const version of await versionsOf(connection.id)) {
      expect(version).toMatchObject({ status: "DESTROYED", sealed_credential: null, fingerprint_value: null, fingerprint_key_ref: null, fingerprint_algorithm: null });
      expect(version.destroyed_at).not.toBeNull();
    }
    const auditsAfterFirst = await auditsFor(connection.id);
    expect(auditsAfterFirst.map((event) => event.event_type)).toEqual([
      "provider_connection.created",
      "provider_connection.credential_rotated",
      "provider_connection.disconnected",
      "provider_connection.secret_destroyed",
      "provider_connection.secret_destroyed",
    ]);
    expect(auditsAfterFirst.slice(3).map((event) => event.metadata)).toEqual([
      { provider: "TEST_PROVIDER", credentialVersion: 1 },
      { provider: "TEST_PROVIDER", credentialVersion: 2 },
    ]);

    const replay = await disconnect("alice", connection.id, portB);
    expect(replay.status).toBe(200);
    expect(await auditsFor(connection.id)).toHaveLength(5);
    const rows = await clients.migrator.query("SELECT count(*)::int AS count FROM provider_connections WHERE id = $1", [connection.id]);
    expect(rows.rows).toEqual([{ count: 1 }]);
  });

  it("lets a DISABLED connection be disconnected, and the same credential be connected again afterwards", async () => {
    const credential = newCredential();
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential })).providerConnection;
    await pools[0]!.query("UPDATE provider_connections SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [connection.id]);
    // Disabled does not open a bypass: the same credential is still a duplicate.
    expect((await create("alice", { provider: "TEST_PROVIDER", credential })).status).toBe(409);

    const response = await disconnect("alice", connection.id);
    expect(response.status).toBe(200);
    expect(json(response).providerConnection.status).toBe("DISCONNECTED");
    expect((await versionsOf(connection.id)).every((version) => version.status === "DESTROYED" && version.sealed_credential === null)).toBe(true);

    // With the fingerprint destroyed, reconnecting the credential is a new connection.
    expect((await create("alice", { provider: "TEST_PROVIDER", credential })).status).toBe(201);
  });

  it("requires an empty body", async () => {
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;
    const response = await send(portA, "POST", `/provider-connections/${connection.id}/disconnect`, '{"destroy":false}', jsonAuth("alice"));
    expect(response.status).toBe(400);
    expect((await versionsOf(connection.id))[0]!.status).toBe("ACTIVE");
  });
});

describe("process composition", () => {
  it("installs provider-connection routes only when they are injected in code", async () => {
    const run = async (withProviderConnections: boolean) => {
      const signals = new EventEmitter();
      const stdout: string[] = [];
      const running = await runCommercialApiProcess({
        environment: { COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl },
        onSignal: (signal: ShutdownSignal, listener: () => void) => {
          signals.once(signal, listener);
        },
        writeStdout: (text) => stdout.push(text),
        writeStderr: () => {},
        setExitCode: () => {},
        startServer: (options) => startCommercialApiServer({ ...options, port: 0 }),
        authentication: adapter,
        ...(withProviderConnections ? { providerConnections: crypto } : {}),
      });
      return {
        port: running!.port,
        stop: async () => {
          signals.emit("SIGTERM");
          for (let attempt = 0; attempt < 200 && !stdout.includes("commercial-api: stopped\n"); attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        },
      };
    };

    const without = await run(false);
    expect((await send(without.port, "GET", "/provider-connections", undefined, auth("alice"))).status).toBe(404);
    expect((await send(without.port, "GET", "/productions", undefined, auth("alice"))).status).toBe(200);
    await without.stop();

    const withRoutes = await run(true);
    expect((await send(withRoutes.port, "POST", "/account/bootstrap", undefined, auth("process"))).status).toBe(200);
    const created = await send(withRoutes.port, "POST", "/provider-connections", JSON.stringify({ provider: "TEST_PROVIDER", credential: newCredential() }), jsonAuth("process"));
    expect(created.status).toBe(201);
    await withRoutes.stop();
  });
});
