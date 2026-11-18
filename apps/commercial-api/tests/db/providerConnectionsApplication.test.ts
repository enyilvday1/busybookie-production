import { randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { combineApplicationRouters } from "../../src/application/combineApplicationRouters.js";
import { createCustomerApplication } from "../../src/application/customerApplication.js";
import { createProviderConnectionApplication } from "../../src/application/providerConnectionApplication.js";
import type { AuthenticationAdapter } from "../../src/authentication/authenticationAdapter.js";
import type { VerifiedIdentity } from "../../src/authentication/verifiedIdentity.js";
import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimeClient, type TransactionalPool } from "../../src/database/runtimePool.js";
import { requestProviderVerification } from "../../src/providerConnections/providerVerificationService.js";
import { PROVIDER_CREDENTIAL_PURPOSE } from "commercial-worker-protocol";
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

type ProviderApplicationOverrides = Partial<Pick<
  Parameters<typeof createProviderConnectionApplication>[0],
  "convergeAfterDisconnect" | "reportFailure" | "registry"
>>;

async function composition(
  overrides: ProviderApplicationOverrides = {},
): Promise<number> {
  const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: "12" }, "development");
  const pool = await createRuntimePool(config!, () => {});
  pools.push(pool);
  const application = combineApplicationRouters(
    createCustomerApplication({ authentication: adapter, pool, reportFailure: () => {} }),
    createProviderConnectionApplication({
      authentication: adapter,
      pool,
      ...crypto,
      reportFailure: () => {},
      ...overrides,
    }),
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
const verify = (name: Name, id: string, port = portA) => send(port, "POST", `/provider-connections/${id}/verify`, undefined, auth(name));

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
  "lastVerificationAttemptAt",
  "provider",
  "status",
  "updatedAt",
  "verificationPending",
  "verificationStatus",
  "verifiedAt",
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

  it("retains a granted verification credential through disconnect and destroys it after the verification job becomes terminal", async () => {
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;
    const request = await verify("alice", connection.id);
    expect(request.status).toBe(202);
    const verificationJobId = (json(request).verificationJob as { id: string }).id;

    const worker = await clients.migrator.query<{ id: string }>(
      "INSERT INTO worker_principals (label) VALUES ($1) RETURNING id",
      [`verification-retention-${randomUUID()}`],
    );
    const workerId = worker.rows[0]!.id;

    await clients.migrator.query(
      `UPDATE provider_verification_jobs
          SET state = 'LEASED', lease_worker_principal_id = $2,
              lease_token_sha256 = repeat('a', 64), lease_fencing_counter = 1,
              leased_at = clock_timestamp(),
              lease_expires_at = clock_timestamp() + interval '30 seconds',
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [verificationJobId, workerId],
    );
    await clients.migrator.query(
      `UPDATE provider_verification_jobs
          SET credential_granted_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [verificationJobId],
    );

    const first = await disconnect("alice", connection.id);
    expect(first.status).toBe(200);
    const retained = await versionsOf(connection.id);
    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatchObject({ status: "RETAINED_FOR_RECOVERY" });
    expect(retained[0]!.sealed_credential).not.toBeNull();
    expect((await auditsFor(connection.id)).map((event) => event.event_type)).toContain("provider_connection.secret_retained_for_recovery");

    await clients.migrator.query(
      `UPDATE provider_verification_jobs
          SET state = 'CANCELLED',
              lease_worker_principal_id = NULL,
              lease_token_sha256 = NULL,
              leased_at = NULL,
              lease_expires_at = NULL,
              terminal_reason_code = 'LIFECYCLE_NO_LONGER_ELIGIBLE',
              completed_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE id = $1`,
      [verificationJobId],
    );

    const second = await disconnect("alice", connection.id, portB);
    expect(second.status).toBe(200);
    const destroyed = await versionsOf(connection.id);
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]).toMatchObject({
      status: "DESTROYED",
      sealed_credential: null,
      fingerprint_value: null,
      fingerprint_key_ref: null,
      fingerprint_algorithm: null,
    });
    expect(destroyed[0]!.destroyed_at).not.toBeNull();
    const audits = await auditsFor(connection.id);
    expect(audits.map((event) => event.event_type)).toEqual([
      "provider_connection.created",
      "provider_connection.verification_requested",
      "provider_connection.disconnected",
      "provider_connection.secret_retained_for_recovery",
      "provider_connection.secret_destroyed",
    ]);
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

async function waitForR44B11EProcessStop(
  stdout: readonly string[],
): Promise<void> {
  for (
    let attempt = 0;
    attempt < 200 &&
    !stdout.includes("commercial-api: stopped\n");
    attempt += 1
  ) {
    await new Promise((resolve) =>
      setTimeout(resolve, 10),
    );
  }

  expect(stdout).toContain(
    "commercial-api: stopped\n",
  );
}
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
    // R44B11F: the default process composes no verification request route.
    expect((await send(without.port, "POST", `/provider-connections/${randomUUID()}/verify`, undefined, auth("alice"))).status).toBe(404);
    expect((await send(without.port, "GET", "/productions", undefined, auth("alice"))).status).toBe(200);
    await without.stop();

    const withRoutes = await run(true);
    expect((await send(withRoutes.port, "POST", "/account/bootstrap", undefined, auth("process"))).status).toBe(200);
    const created = await send(withRoutes.port, "POST", "/provider-connections", JSON.stringify({ provider: "TEST_PROVIDER", credential: newCredential() }), jsonAuth("process"));
    expect(created.status).toBe(201);
    await withRoutes.stop();
  });
});

describe("R44B11E immediate targeted disconnect convergence", () => {
  it("runs targeted convergence only after the primary disconnect committed and reuses its correlation identity", async () => {
    let observed:
      | {
          connectionId: string;
          mode: string;
          correlationId: string;
          databaseStatus: string;
        }
      | undefined;

    const port = await composition({
      convergeAfterDisconnect:
        async (targetPool, connectionId, context) => {
          const state =
            await targetPool.query<{ status: string }>(
              "SELECT status FROM provider_connections WHERE id = $1",
              [connectionId],
            );

          observed = {
            connectionId,
            mode: context.mode,
            correlationId: context.correlationId,
            databaseStatus: state.rows[0]!.status,
          };

          return Object.freeze({
            cancelledAuthorizations: 0,
            cancelledAttempts: 0,
            destroyedCredentialVersions: 0,
          });
        },
    });

    const connection = json(
      await create("alice", {
        provider: "TEST_PROVIDER",
        credential: newCredential(),
      }, port),
    ).providerConnection;

    const response =
      await disconnect("alice", connection.id, port);

    expect(response.status).toBe(200);
    expect(json(response).providerConnection.status).toBe(
      "DISCONNECTED",
    );

    expect(observed).toMatchObject({
      connectionId: connection.id,
      mode: "TARGETED",
      databaseStatus: "DISCONNECTED",
    });

    expect(observed!.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );

    const audit =
      await clients.migrator.query<{
        correlation_id: string;
      }>(
        `SELECT correlation_id
           FROM audit_events
          WHERE resource_type = 'provider_connection'
            AND resource_id = $1
            AND event_type = 'provider_connection.disconnected'`,
        [connection.id],
      );

    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]!.correlation_id).toBe(
      observed!.correlationId,
    );
  });

  it("reports targeted convergence failure only to the server sink and preserves HTTP disconnect success", async () => {
    const failures: string[] = [];

    const port = await composition({
      reportFailure: (text) => failures.push(text),
      convergeAfterDisconnect: async () => {
        throw new Error("fixture convergence failure");
      },
    });

    const connection = json(
      await create("alice", {
        provider: "TEST_PROVIDER",
        credential: newCredential(),
      }, port),
    ).providerConnection;

    const response =
      await disconnect("alice", connection.id, port);

    expect(response.status).toBe(200);
    expect(json(response).providerConnection.status).toBe(
      "DISCONNECTED",
    );

    const state =
      await clients.migrator.query<{ status: string }>(
        "SELECT status FROM provider_connections WHERE id = $1",
        [connection.id],
      );

    expect(state.rows).toEqual([
      { status: "DISCONNECTED" },
    ]);

    expect(failures).toEqual([
      "commercial-api: provider disconnect convergence failed (unexpected)\n",
    ]);
  });
});

describe("R44B11E periodic process orchestration", () => {
  it("starts after verified database composition without customer routes and stops before HTTP shutdown", async () => {
    const signals = new EventEmitter();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const events: string[] = [];

    const writeStderr = (text: string) => {
      stderr.push(text);
    };

    let startedPool:
      | TransactionalPool
      | undefined;

    const policy = {
      cadenceMs: 4_000,
      connectionBatchSize: 6,
      childBatchSize: 8,
    } as const;

    const running =
      await runCommercialApiProcess({
        environment: {
          COMMERCIAL_API_DATABASE_URL:
            clients.config.runtimeUrl,
        },
        onSignal: (signal, listener) => {
          signals.once(signal, listener);
        },
        writeStdout: (text) =>
          stdout.push(text),
        writeStderr,
        setExitCode: () => {},
        startServer: async (options) => {
          events.push(
            "http-start",
          );

          const actual =
            await startCommercialApiServer({
              ...options,
              port: 0,
            });

          return Object.freeze({
            host: actual.host,
            port: actual.port,
            close: async () => {
              events.push(
                "http-close",
              );
              await actual.close();
            },
          });
        },
        disconnectConvergence: {
          policy,
          start: (options) => {
            events.push(
              "loop-start",
            );

            startedPool = options.pool;

            expect(
              options.reportFailure,
            ).toBe(writeStderr);

            expect(options.policy).toEqual(
              policy,
            );

            return Object.freeze({
              runNow: async () => {},
              stop: () => {
                events.push(
                  "loop-stop",
                );
              },
            });
          },
        },
      });

    expect(running).not.toBeNull();
    expect(startedPool).toBeDefined();

    expect(stdout).toContain(
      "commercial-api: database verified\n",
    );

    expect(events).toEqual([
      "loop-start",
      "http-start",
    ]);

    // No authenticated application was supplied. Periodic convergence is
    // therefore demonstrably independent of customer/provider route
    // composition.
    expect(
      (
        await send(
          running!.port,
          "GET",
          "/provider-connections",
        )
      ).status,
    ).toBe(404);

    signals.emit("SIGTERM");

    await waitForR44B11EProcessStop(
      stdout,
    );

    expect(
      events.indexOf("loop-stop"),
    ).toBeGreaterThanOrEqual(0);

    expect(
      events.indexOf("http-close"),
    ).toBeGreaterThan(
      events.indexOf("loop-stop"),
    );

    expect(
      events.filter((event) => event === "loop-stop"),
    ).toHaveLength(1);

    expect(stderr).toEqual([]);
  });

  it("does not start periodic convergence when no runtime database is configured", async () => {
    const signals = new EventEmitter();
    const stdout: string[] = [];
    let loopStarts = 0;

    const running =
      await runCommercialApiProcess({
        environment: {},
        onSignal: (signal, listener) => {
          signals.once(signal, listener);
        },
        writeStdout: (text) =>
          stdout.push(text),
        writeStderr: () => {},
        setExitCode: () => {},
        startServer: (options) =>
          startCommercialApiServer({
            ...options,
            port: 0,
          }),
        disconnectConvergence: {
          start: () => {
            loopStarts += 1;

            return Object.freeze({
              runNow: async () => {},
              stop: () => {},
            });
          },
        },
      });

    expect(running).not.toBeNull();
    expect(loopStarts).toBe(0);

    expect(stdout).toContain(
      "commercial-api: no database configured; /__ready reports not ready\n",
    );

    signals.emit("SIGTERM");

    await waitForR44B11EProcessStop(
      stdout,
    );
  });

  it("does not start periodic convergence or HTTP listening when database verification fails", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCodes: number[] = [];
    let loopStarts = 0;
    let serverStarts = 0;

    const running =
      await runCommercialApiProcess({
        environment: {
          COMMERCIAL_API_DATABASE_URL:
            clients.config.runtimeUrl,
        },
        onSignal: () => {},
        writeStdout: (text) =>
          stdout.push(text),
        writeStderr: (text) =>
          stderr.push(text),
        setExitCode: (code) =>
          exitCodes.push(code),
        verifyDatabase: async () => {
          throw new Error("fixture verification failure");
        },
        startServer: async () => {
          serverStarts += 1;
          throw new Error("must not listen");
        },
        disconnectConvergence: {
          start: () => {
            loopStarts += 1;

            return Object.freeze({
              runNow: async () => {},
              stop: () => {},
            });
          },
        },
      });

    expect(running).toBeNull();
    expect(loopStarts).toBe(0);
    expect(serverStarts).toBe(0);
    expect(exitCodes).toEqual([1]);

    expect(stdout).not.toContain(
      "commercial-api: database verified\n",
    );

    expect(stderr).toEqual([
      "commercial-api: Database startup failed.\n",
    ]);
  });
});

// R44B11F Phase 2: customer verification request, read model and
// default-off capability. No provider network operation exists on this path;
// the worker-side lease/grant/barrier/result lifecycle is simulated here only
// with migrator SQL that satisfies the migration 0010 guard.
describe("R44B11F customer verification request", () => {
  const JOB_DTO_KEYS = ["createdAt", "credentialVersion", "id", "providerConnectionId", "state"];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
  // Worker, lease, credential and internal-database vocabulary never leaves the API.
  const INTERNAL =
    /leasedAt|leaseExpiresAt|worker|fencing|token|sha256|granted|verifyingAt|verifying_|policy|sealed|envelope|fingerprint|keyRef|accountId|account_id|userId|requestedBy|credentialVersionId|provider_credential_version_id|result|completed|reason/i;

  type JobRow = {
    id: string;
    account_id: string;
    provider_connection_id: string;
    provider_credential_version_id: string;
    verification_policy_id: string;
    requested_by_user_id: string;
    state: string;
  };

  async function jobsFor(connectionId: string): Promise<JobRow[]> {
    const result = await clients.migrator.query<JobRow>(
      `SELECT id, account_id, provider_connection_id, provider_credential_version_id,
              verification_policy_id, requested_by_user_id, state
         FROM provider_verification_jobs WHERE provider_connection_id = $1 ORDER BY created_at, id`,
      [connectionId],
    );
    return result.rows;
  }

  async function activeVersionId(connectionId: string): Promise<string> {
    const result = await clients.migrator.query<{ id: string }>(
      "SELECT id FROM provider_credential_versions WHERE provider_connection_id = $1 AND status = 'ACTIVE'",
      [connectionId],
    );
    expect(result.rows).toHaveLength(1);
    return result.rows[0]!.id;
  }

  async function principalOf(name: Name): Promise<{ userId: string; accountId: string }> {
    const result = await clients.migrator.query<{ user_id: string; account_id: string }>(
      `SELECT u.id AS user_id, a.id AS account_id FROM users u JOIN accounts a ON a.owner_user_id = u.id
        WHERE u.idp_issuer = $1 AND u.idp_subject = $2`,
      [identities[name].issuer, identities[name].subject],
    );
    return { userId: result.rows[0]!.user_id, accountId: result.rows[0]!.account_id };
  }

  const requestedAudits = async (connectionId: string) =>
    (await auditsFor(connectionId)).filter((event) => event.event_type === "provider_connection.verification_requested");

  async function workerPrincipal(): Promise<string> {
    const result = await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ($1) RETURNING id", [`pv-${randomUUID()}`]);
    return result.rows[0]!.id;
  }

  async function leaseJob(jobId: string, workerId: string): Promise<void> {
    await clients.migrator.query(
      `UPDATE provider_verification_jobs
          SET state = 'LEASED', lease_worker_principal_id = $2, lease_token_sha256 = repeat('b', 64),
              lease_fencing_counter = 1, leased_at = clock_timestamp(),
              lease_expires_at = clock_timestamp() + interval '30 seconds', updated_at = clock_timestamp()
        WHERE id = $1`,
      [jobId, workerId],
    );
  }

  async function verifyingJob(jobId: string, workerId: string): Promise<void> {
    await clients.migrator.query(
      "UPDATE provider_verification_jobs SET credential_granted_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1",
      [jobId],
    );
    await clients.migrator.query(
      `UPDATE provider_verification_jobs
          SET state = 'VERIFYING', verifying_at = clock_timestamp(), verifying_worker_principal_id = $2,
              verifying_fencing_counter = 1, updated_at = clock_timestamp()
        WHERE id = $1`,
      [jobId, workerId],
    );
  }

  async function completeJob(jobId: string, workerId: string): Promise<void> {
    await clients.migrator.query(
      `UPDATE provider_verification_jobs
          SET state = 'COMPLETED', lease_worker_principal_id = NULL, lease_token_sha256 = NULL,
              leased_at = NULL, lease_expires_at = NULL, result_outcome = 'INCONCLUSIVE',
              terminal_reason_code = 'PROVIDER_UNAVAILABLE', result_worker_principal_id = $2,
              result_fencing_counter = 1, completed_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE id = $1`,
      [jobId, workerId],
    );
  }

  async function cancelJob(jobId: string): Promise<void> {
    await clients.migrator.query(
      `UPDATE provider_verification_jobs
          SET state = 'CANCELLED', terminal_reason_code = 'LIFECYCLE_NO_LONGER_ELIGIBLE',
              completed_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE id = $1`,
      [jobId],
    );
  }

  const getConnection = async (name: Name, id: string, port = portA) =>
    json(await send(port, "GET", `/provider-connections/${id}`, undefined, auth(name))).providerConnection as Record<string, unknown>;

  type JobDto = { id: string; providerConnectionId: string; credentialVersion: number; state: string; createdAt: string };

  function expectSafeJobResponse(response: TestResponse, credential: string): JobDto {
    expect(response.status).toBe(202);
    expectNoSecret(response, credential);
    expect(INTERNAL.test(response.body)).toBe(false);
    const body = json(response);
    expect(Object.keys(body)).toEqual(["verificationJob"]);
    expect(Object.keys(body.verificationJob).sort()).toEqual(JOB_DTO_KEYS);
    expect(body.verificationJob.id).toMatch(UUID);
    expect(Number.isNaN(Date.parse(body.verificationJob.createdAt))).toBe(false);
    return body.verificationJob as JobDto;
  }

  it("queues exactly one job bound to the exact ACTIVE version of a PENDING_VERIFICATION connection, with one audit event", async () => {
    const credential = newCredential();
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential })).providerConnection;
    expect(connection).toMatchObject({ verificationPending: false, lastVerificationAttemptAt: null, verifiedAt: null });

    const job = expectSafeJobResponse(await verify("alice", connection.id), credential);
    expect(job).toMatchObject({ providerConnectionId: connection.id, credentialVersion: 1, state: "QUEUED" });

    const principal = await principalOf("alice");
    expect(await jobsFor(connection.id)).toEqual([
      {
        id: job.id,
        account_id: principal.accountId,
        provider_connection_id: connection.id,
        provider_credential_version_id: await activeVersionId(connection.id),
        verification_policy_id: "TEST_PROVIDER_METADATA_V1",
        requested_by_user_id: principal.userId,
        state: "QUEUED",
      },
    ]);

    expect(await requestedAudits(connection.id)).toEqual([
      {
        event_type: "provider_connection.verification_requested",
        actor_type: "USER",
        metadata: { provider: "TEST_PROVIDER", credentialVersion: 1, verificationJobId: job.id, verificationPolicyId: "TEST_PROVIDER_METADATA_V1" },
      },
    ]);
    expect(await plaintextOccurrences(credential)).toBe(0);

    // The request alone changes no aggregate verification state.
    const view = await getConnection("alice", connection.id, portB);
    expect(view).toMatchObject({
      status: "PENDING_VERIFICATION",
      verificationStatus: "UNVERIFIED",
      verificationPending: true,
      lastVerificationAttemptAt: null,
      verifiedAt: null,
    });
    expect(Object.keys(view).sort()).toEqual(SAFE_DTO_KEYS);
    const listed = json(await send(portA, "GET", "/provider-connections", undefined, auth("alice"))).providerConnections as Record<string, unknown>[];
    expect(listed.find((item) => item.id === connection.id)).toMatchObject({ verificationPending: true });
  });

  it.each([
    ["ACTIVE", "VERIFIED", "verified_at = now(), last_verification_attempt_at = now()"],
    ["INVALID", "FAILED", "last_verification_attempt_at = now()"],
  ])("accepts an %s connection without overwriting its verification result", async (status, verificationStatus, stamps) => {
    const credential = newCredential();
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential })).providerConnection;
    await pools[0]!.query(`UPDATE provider_connections SET status = $2, verification_status = $3, ${stamps} WHERE id = $1`, [
      connection.id,
      status,
      verificationStatus,
    ]);
    const stateSql = "SELECT status, verification_status, verified_at, last_verification_attempt_at FROM provider_connections WHERE id = $1";
    const before = await clients.migrator.query<{ verified_at: Date | null; last_verification_attempt_at: Date }>(stateSql, [connection.id]);

    const job = expectSafeJobResponse(await verify("alice", connection.id), credential);
    expect(job).toMatchObject({ credentialVersion: 1, state: "QUEUED" });
    expect((await jobsFor(connection.id)).map((row) => row.provider_credential_version_id)).toEqual([await activeVersionId(connection.id)]);
    expect(await requestedAudits(connection.id)).toHaveLength(1);

    expect((await clients.migrator.query(stateSql, [connection.id])).rows).toEqual(before.rows);

    const view = await getConnection("alice", connection.id);
    expect(view.verificationPending).toBe(true);
    expect(view.lastVerificationAttemptAt).toBe(before.rows[0]!.last_verification_attempt_at.toISOString());
    expect(view.verifiedAt).toBe(status === "ACTIVE" ? before.rows[0]!.verified_at!.toISOString() : null);
  });

  it("refuses DISABLED and DISCONNECTED connections with no job and no audit", async () => {
    const disabled = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;
    await pools[0]!.query("UPDATE provider_connections SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [disabled.id]);
    const disconnected = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;
    expect((await disconnect("alice", disconnected.id)).status).toBe(200);

    for (const id of [disabled.id, disconnected.id]) {
      const response = await verify("alice", id);
      expect(response.status).toBe(409);
      expect(response.body).toBe('{"status":"error","code":"CONNECTION_STATE_CONFLICT"}\n');
      expect(await jobsFor(id)).toEqual([]);
      expect(await requestedAudits(id)).toEqual([]);
      expect((await getConnection("alice", id)).verificationPending).toBe(false);
    }
  });

  it("never reveals or touches another account's connection: foreign, missing and malformed IDs look identical", async () => {
    const aliceConnection = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;
    const foreign = await verify("bob", aliceConnection.id, portB);
    const missing = await verify("bob", randomUUID(), portB);
    const malformed = await verify("bob", "not-a-uuid", portB);
    for (const response of [foreign, missing, malformed]) {
      expect(response.status).toBe(404);
      expect(response.body).toBe('{"status":"error","code":"NOT_FOUND"}\n');
    }
    expect(await jobsFor(aliceConnection.id)).toEqual([]);
    expect(await auditsFor(aliceConnection.id)).toHaveLength(1);
  });

  it("requires an empty body, authentication and an active account", async () => {
    const connection = json(await create("bob", { provider: "TEST_PROVIDER", credential: newCredential() }, portB)).providerConnection;
    const withBody = await send(portA, "POST", `/provider-connections/${connection.id}/verify`, '{"credentialVersion":1}', jsonAuth("bob"));
    expect(withBody.status).toBe(400);
    expect((await send(portA, "POST", `/provider-connections/${connection.id}/verify`)).status).toBe(401);

    const bob = await principalOf("bob");
    await clients.migrator.query("UPDATE accounts SET status = 'DISABLED', disabled_at = now() WHERE id = $1", [bob.accountId]);
    try {
      const inactive = await verify("bob", connection.id);
      expect(inactive.status).toBe(403);
      expect(inactive.body).toBe('{"status":"error","code":"ACCOUNT_UNAVAILABLE"}\n');
    } finally {
      await clients.migrator.query("UPDATE accounts SET status = 'ACTIVE', disabled_at = NULL WHERE id = $1", [bob.accountId]);
    }
    expect(await jobsFor(connection.id)).toEqual([]);
  });

  it("binds the rotated current version, never the superseded one", async () => {
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;
    const first = expectSafeJobResponse(await verify("alice", connection.id), "unused-secret-marker");
    expect(first.credentialVersion).toBe(1);
    const v1 = (await jobsFor(connection.id))[0]!.provider_credential_version_id;

    expect((await rotate("alice", connection.id, { credential: newCredential() })).status).toBe(201);
    const v2 = await activeVersionId(connection.id);
    expect(v2).not.toBe(v1);

    const second = expectSafeJobResponse(await verify("alice", connection.id), "unused-secret-marker");
    expect(second.id).not.toBe(first.id);
    expect(second.credentialVersion).toBe(2);
    expect((await jobsFor(connection.id)).map((row) => [row.id, row.provider_credential_version_id, row.state])).toEqual([
      [first.id, v1, "QUEUED"],
      [second.id, v2, "QUEUED"],
    ]);
    expect((await requestedAudits(connection.id)).map((event) => event.metadata.credentialVersion)).toEqual([1, 2]);
  });

  it("fails closed when an eligible connection has no ACTIVE credential version", async () => {
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;
    await clients.migrator.query(
      "UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now(), updated_at = now() WHERE provider_connection_id = $1",
      [connection.id],
    );
    const response = await verify("alice", connection.id);
    expect(response.status).toBe(500);
    expect(response.body).toBe('{"status":"error","code":"INTERNAL_ERROR"}\n');
    expect(await jobsFor(connection.id)).toEqual([]);
    expect(await requestedAudits(connection.id)).toEqual([]);
  });

  it("returns the same open job while QUEUED, LEASED and VERIFYING, with no second job or audit", async () => {
    const credential = newCredential();
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential })).providerConnection;
    const first = expectSafeJobResponse(await verify("alice", connection.id), credential);

    expect(expectSafeJobResponse(await verify("alice", connection.id, portB), credential)).toEqual(first);

    const workerId = await workerPrincipal();
    await leaseJob(first.id, workerId);
    const leasedResponse = await verify("alice", connection.id);
    expect(expectSafeJobResponse(leasedResponse, credential)).toEqual({ ...first, state: "LEASED" });
    expect(leasedResponse.body.includes(workerId)).toBe(false);

    await verifyingJob(first.id, workerId);
    const verifyingResponse = await verify("alice", connection.id, portB);
    expect(expectSafeJobResponse(verifyingResponse, credential)).toEqual({ ...first, state: "VERIFYING" });
    expect(verifyingResponse.body.includes(workerId)).toBe(false);
    expect((await getConnection("alice", connection.id)).verificationPending).toBe(true);

    expect(await jobsFor(connection.id)).toHaveLength(1);
    expect(await requestedAudits(connection.id)).toHaveLength(1);

    // Terminal: no longer pending, and an explicit new request creates fresh work.
    await completeJob(first.id, workerId);
    const terminalView = await getConnection("alice", connection.id);
    expect(terminalView.verificationPending).toBe(false);
    expect(INTERNAL.test(JSON.stringify(terminalView))).toBe(false);
    const fresh = expectSafeJobResponse(await verify("alice", connection.id), credential);
    expect(fresh.id).not.toBe(first.id);
    expect(fresh).toMatchObject({ credentialVersion: 1, state: "QUEUED" });
    expect(await jobsFor(connection.id)).toHaveLength(2);
    expect(await requestedAudits(connection.id)).toHaveLength(2);
  });

  it("creates a fresh job after a CANCELLED job", async () => {
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;
    const first = expectSafeJobResponse(await verify("alice", connection.id), "unused-secret-marker");
    await cancelJob(first.id);
    expect((await getConnection("alice", connection.id)).verificationPending).toBe(false);

    const second = expectSafeJobResponse(await verify("alice", connection.id), "unused-secret-marker");
    expect(second.id).not.toBe(first.id);
    expect((await jobsFor(connection.id)).map((row) => row.state)).toEqual(["CANCELLED", "QUEUED"]);
    expect(await requestedAudits(connection.id)).toHaveLength(2);
  });

  it("converges concurrent requests across processes on one job and one audit event", async () => {
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;
    const responses = await Promise.all(Array.from({ length: 12 }, (_unused, index) => verify("alice", connection.id, index % 2 ? portA : portB)));
    expect(responses.map((response) => response.status)).toEqual(Array.from({ length: 12 }, () => 202));
    expect(new Set(responses.map((response) => json(response).verificationJob.id)).size).toBe(1);
    expect(await jobsFor(connection.id)).toHaveLength(1);
    expect(await requestedAudits(connection.id)).toHaveLength(1);
  });

  it("resolves an insert that loses the open-job unique race to the committed winner, without a second job or audit", async () => {
    const connection = json(await create("alice", { provider: "TEST_PROVIDER", credential: newCredential() })).providerConnection;
    const principal = await principalOf("alice");
    const winner = expectSafeJobResponse(await verify("alice", connection.id), "unused-secret-marker");

    // Fault injection: the first non-locking open-job lookup reports nothing,
    // as if it had run before the winner committed. Only the database partial
    // unique index (the ON CONFLICT arbiter) then prevents a duplicate.
    let hiddenLookups = 0;
    let insertAttempts = 0;
    const base = pools[0]!;
    const racingPool: TransactionalPool = {
      query: base.query,
      end: base.end,
      connect: async () => {
        const client = await base.connect();
        const wrapped: RuntimeClient = {
          query: (async (sql: string, values?: unknown[]) => {
            if (sql.includes("FROM provider_verification_jobs") && sql.includes("provider_credential_version_id = $3") && hiddenLookups === 0) {
              hiddenLookups += 1;
              return { rows: [], rowCount: 0 };
            }
            if (sql.includes("INSERT INTO provider_verification_jobs")) insertAttempts += 1;
            return client.query(sql, values);
          }) as RuntimeClient["query"],
          release: (error?: Error) => client.release(error),
        };
        return wrapped;
      },
    };

    const result = await requestProviderVerification({ pool: racingPool, registry: crypto.registry }, principal, connection.id);
    expect(hiddenLookups).toBe(1);
    expect(insertAttempts).toBe(1);
    expect(result.created).toBe(false);
    expect(result.verificationJob.id).toBe(winner.id);
    expect(result.verificationJob.state).toBe("QUEUED");
    expect(await jobsFor(connection.id)).toHaveLength(1);
    expect(await requestedAudits(connection.id)).toHaveLength(1);
  });

  it.each([
    ["verification is default-off", "UNVERIFIABLE_TEST_PROVIDER"],
    ["a policy ID exists without explicit enablement", "POLICY_ONLY_TEST_PROVIDER"],
    ["the policy ID is malformed", "MALFORMED_POLICY_TEST_PROVIDER"],
    ["the policy ID is missing", "MISSING_POLICY_TEST_PROVIDER"],
  ])("refuses to create work when %s", async (_label, provider) => {
    const connection = json(await create("alice", { provider, credential: newCredential() })).providerConnection;
    const response = await verify("alice", connection.id);
    expect(response.status).toBe(400);
    expect(response.body).toBe('{"status":"error","code":"PROVIDER_UNSUPPORTED"}\n');
    expect(await jobsFor(connection.id)).toEqual([]);
    expect(await requestedAudits(connection.id)).toEqual([]);
  });

  it("persists the exact locked verification policy IDs supplied by an explicitly composed registry", async () => {
    const LOCKED = [
      ["GOOGLE_GENAI", "GOOGLE_GENAI_MODELS_LIST_V1BETA"],
      ["RUNWAY", "RUNWAY_ORGANIZATION_GET_V1_2024_11_06"],
    ] as const;
    const port = await composition({
      registry: createTestProviderRegistry(
        LOCKED.map(([provider, verificationPolicyId]) => ({
          provider,
          connectionCreationEnabled: true,
          credentialKinds: ["API_KEY"],
          verificationEnabled: true,
          verificationPolicyId,
        })),
      ),
    });

    for (const [provider, policyId] of LOCKED) {
      const credential = newCredential();
      const connection = json(await create("alice", { provider, credential }, port)).providerConnection;
      expectSafeJobResponse(await verify("alice", connection.id, port), credential);
      expect((await jobsFor(connection.id)).map((row) => row.verification_policy_id)).toEqual([policyId]);
      expect((await requestedAudits(connection.id))[0]!.metadata.verificationPolicyId).toBe(policyId);
    }

    // The default test composition does not enable these providers at all.
    expect((await create("alice", { provider: "RUNWAY", credential: newCredential() })).status).toBe(400);
  });
});
