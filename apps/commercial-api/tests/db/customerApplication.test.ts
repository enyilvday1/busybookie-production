import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCustomerApplication } from "../../src/application/customerApplication.js";
import type { AuthenticationAdapter } from "../../src/authentication/authenticationAdapter.js";
import type { VerifiedIdentity } from "../../src/authentication/verifiedIdentity.js";
import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type TransactionalPool } from "../../src/database/runtimePool.js";
import { runCommercialApiProcess, type ShutdownSignal } from "../../src/runCommercialApiProcess.js";
import { startCommercialApiServer, type RunningCommercialApiServer } from "../../src/startCommercialApiServer.js";
import { send, type TestResponse } from "../httpClient.js";
import { createTestIdentityProvider } from "../support/testIdentityProvider.js";
import { openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

// The authenticated HTTP surface against PostgreSQL 16, composed explicitly
// with the test-only fixture identity provider. All application writes run
// as the runtime role. The database is restored to pristine schema v1.

const ISSUER = "https://issuer.http.test/";
const SHARED_EMAIL = { address: "shared@example.test", verified: true };

const identities = {
  alice: { issuer: ISSUER, subject: "alice", email: SHARED_EMAIL },
  bob: { issuer: ISSUER, subject: "bob", email: SHARED_EMAIL },
  carol: { issuer: ISSUER, subject: "carol-never-bootstrapped" },
  concurrent: { issuer: ISSUER, subject: "concurrent" },
  disabledUser: { issuer: ISSUER, subject: "disabled-user" },
  disabledAccount: { issuer: ISSUER, subject: "disabled-account" },
  processUser: { issuer: ISSUER, subject: "process-user" },
} satisfies Record<string, VerifiedIdentity>;

type Name = keyof typeof identities;
const tokenFor = (name: Name) => `fixture-${name}`;
const auth = (name: Name) => ({ Authorization: `Bearer ${tokenFor(name)}` });
const jsonAuth = (name: Name) => ({ ...auth(name), "Content-Type": "application/json" });

let clients: GuardedClients;
let adapter: AuthenticationAdapter;
const pools: TransactionalPool[] = [];
const servers: RunningCommercialApiServer[] = [];
let portA: number;
let portB: number;

async function runtimePool(): Promise<TransactionalPool> {
  const config = loadRuntimeDatabaseConfig(
    { COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: "12" },
    "development",
  );
  const pool = await createRuntimePool(config!, () => {});
  pools.push(pool);
  return pool;
}

async function startComposition(): Promise<number> {
  const pool = await runtimePool();
  const application = createCustomerApplication({ authentication: adapter, pool, reportFailure: () => {} });
  const server = await startCommercialApiServer({ host: "127.0.0.1", port: 0, dependencies: { application, checkReadiness: async () => true } });
  servers.push(server);
  return server.port;
}

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
  adapter = createTestIdentityProvider(Object.entries(identities).map(([name, identity]) => ({ token: tokenFor(name as Name), identity })));
  portA = await startComposition();
  portB = await startComposition();
});

afterAll(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
  await prepareSchemaV1(clients);
  await clients.close();
});

const json = (response: TestResponse) => JSON.parse(response.body) as Record<string, any>;

async function countsFor(identity: VerifiedIdentity) {
  const result = await clients.migrator.query<Record<string, number>>(
    `WITH u AS (SELECT id FROM users WHERE idp_issuer = $1 AND idp_subject = $2),
          a AS (SELECT id FROM accounts WHERE owner_user_id IN (SELECT id FROM u) AND kind = 'PERSONAL'),
          g AS (SELECT id FROM entitlement_grants WHERE account_id IN (SELECT id FROM a))
     SELECT (SELECT count(*)::int FROM u) AS users,
            (SELECT count(*)::int FROM a) AS accounts,
            (SELECT count(*)::int FROM g) AS grants,
            (SELECT count(*)::int FROM productions WHERE account_id IN (SELECT id FROM a)) AS productions,
            (SELECT count(*)::int FROM audit_events WHERE event_type = 'user.provisioned' AND resource_id IN (SELECT id FROM u)) AS user_events,
            (SELECT count(*)::int FROM audit_events WHERE event_type = 'account.provisioned' AND resource_id IN (SELECT id FROM a)) AS account_events,
            (SELECT count(*)::int FROM audit_events WHERE event_type = 'entitlement_grant.issued' AND resource_id IN (SELECT id FROM g)) AS grant_events,
            (SELECT count(*)::int FROM audit_events WHERE event_type = 'production.created' AND account_id IN (SELECT id FROM a)) AS production_events`,
    [identity.issuer, identity.subject],
  );
  return result.rows[0]!;
}

async function totalRows() {
  const result = await clients.migrator.query<Record<string, number>>(
    `SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM accounts) AS accounts,
            (SELECT count(*)::int FROM entitlement_grants) AS grants, (SELECT count(*)::int FROM productions) AS productions,
            (SELECT count(*)::int FROM audit_events) AS audits`,
  );
  return result.rows[0]!;
}

const bootstrap = (name: Name, port = portA) => send(port, "POST", "/account/bootstrap", undefined, auth(name));
const createProduction = (name: Name, body: object, port = portA) => send(port, "POST", "/productions", JSON.stringify(body), jsonAuth(name));

describe("authenticated first slice over HTTP against PostgreSQL 16", () => {
  it("Q. runs every application query as the runtime role", async () => {
    const pool = pools[0]!;
    expect((await pool.query<{ user: string }>("SELECT current_user AS user")).rows).toEqual([{ user: "busybookie_commercial_test_runtime" }]);
  });

  it("D/E. GET before bootstrap is refused and writes nothing; after bootstrap it lists nothing", async () => {
    const before = await totalRows();
    for (const path of ["/productions", `/productions/${randomUUID()}`]) {
      const response = await send(portA, "GET", path, undefined, auth("carol"));
      expect(response.status).toBe(403);
      expect(response.body).toBe('{"status":"error","code":"ACCOUNT_UNAVAILABLE"}\n');
    }
    expect(await totalRows()).toEqual(before);
    expect(await countsFor(identities.carol)).toMatchObject({ users: 0, accounts: 0, grants: 0 });

    expect((await bootstrap("carol")).status).toBe(200);
    const listed = await send(portA, "GET", "/productions", undefined, auth("carol"));
    expect(listed.status).toBe(200);
    expect(json(listed)).toEqual({ productions: [] });
  });

  it("A/B. bootstrap provisions once and a retry returns the same state", async () => {
    const first = await bootstrap("alice");
    expect(first.status).toBe(200);
    const body = json(first);
    expect(body).toMatchObject({
      account: { kind: "PERSONAL", status: "ACTIVE" },
      entitlements: { freeByo: { state: "AVAILABLE" }, hostedTrial: { available: false } },
      created: { user: true, account: true, freeByoGrant: true },
    });
    expect(first.body).not.toMatch(/alice|issuer\.http\.test|shared@example|account-provisioning|free-byo-v1/);

    const retry = await bootstrap("alice", portB);
    expect(retry.status).toBe(200);
    expect(json(retry)).toMatchObject({ user: body.user, account: body.account, created: { user: false, account: false, freeByoGrant: false } });
    expect(await countsFor(identities.alice)).toMatchObject({ users: 1, accounts: 1, grants: 1, user_events: 1, account_events: 1, grant_events: 1 });
  });

  it("C. 20 concurrent bootstraps across two compositions converge with no surfaced error", async () => {
    const responses = await Promise.all(Array.from({ length: 20 }, (_unused, index) => bootstrap("concurrent", index % 2 === 0 ? portA : portB)));

    expect(responses.map((response) => response.status)).toEqual(Array(20).fill(200));
    const bodies = responses.map(json);
    expect(new Set(bodies.map((body) => body.user.id)).size).toBe(1);
    expect(new Set(bodies.map((body) => body.account.id)).size).toBe(1);
    expect(bodies.filter((body) => body.created.user)).toHaveLength(1);
    expect(bodies.filter((body) => body.created.freeByoGrant)).toHaveLength(1);
    expect(await countsFor(identities.concurrent)).toMatchObject({ users: 1, accounts: 1, grants: 1, user_events: 1, account_events: 1, grant_events: 1 });
  });

  it("F/G/H/I. creates, replays, conflicts and enforces the FREE_BYO limit over HTTP", async () => {
    const created = await createProduction("alice", { title: "Alice first", idempotencyKey: "alice-key" });
    expect(created.status).toBe(201);
    const production = json(created).production;
    expect(Object.keys(production).sort()).toEqual(["archivedAt", "createdAt", "id", "title", "updatedAt"]);
    expect(production).toMatchObject({ title: "Alice first", archivedAt: null });

    const replay = await createProduction("alice", { title: "Alice first", idempotencyKey: "alice-key" }, portB);
    expect(replay.status).toBe(200);
    expect(json(replay).production.id).toBe(production.id);

    const conflict = await createProduction("alice", { title: "Different", idempotencyKey: "alice-key" });
    expect(conflict.status).toBe(409);
    expect(conflict.body).toBe('{"status":"error","code":"IDEMPOTENCY_KEY_CONFLICT"}\n');

    for (const body of [{ title: "No key" }, { title: "Other key", idempotencyKey: "other" }]) {
      const refused = await createProduction("alice", body);
      expect(refused.status).toBe(403);
      expect(refused.body).toBe('{"status":"error","code":"ENTITLEMENT_NOT_AVAILABLE"}\n');
    }

    expect(await countsFor(identities.alice)).toMatchObject({ productions: 1, production_events: 1 });
    const stored = await clients.migrator.query(
      `SELECT p.title, p.creation_entitlement_grant_id = g.id AS provenance, g.state
         FROM productions p JOIN entitlement_grants g ON g.account_id = p.account_id WHERE p.id = $1`,
      [production.id],
    );
    expect(stored.rows).toEqual([{ title: "Alice first", provenance: true, state: "AVAILABLE" }]);
  });

  it("J/K/L/M. isolates accounts, including identities that share an email", async () => {
    await bootstrap("bob");
    const bobCreated = await createProduction("bob", { title: "Bob first" }, portB);
    expect(bobCreated.status).toBe(201);
    const bobProduction = json(bobCreated).production;

    const aliceList = json(await send(portA, "GET", "/productions", undefined, auth("alice"))).productions as { id: string; title: string }[];
    const bobList = json(await send(portB, "GET", "/productions", undefined, auth("bob"))).productions as { id: string; title: string }[];
    expect(aliceList.map((item) => item.title)).toEqual(["Alice first"]);
    expect(bobList.map((item) => item.title)).toEqual(["Bob first"]);
    const aliceProductionId = aliceList[0]!.id;

    expect((await send(portA, "GET", `/productions/${aliceProductionId}`, undefined, auth("alice"))).status).toBe(200);

    const foreign = await send(portB, "GET", `/productions/${aliceProductionId}`, undefined, auth("bob"));
    const missing = await send(portB, "GET", `/productions/${randomUUID()}`, undefined, auth("bob"));
    expect(foreign.status).toBe(404);
    expect(foreign.body).toBe(missing.body);
    expect(foreign.body).toBe('{"status":"error","code":"NOT_FOUND"}\n');

    // Selectors in query, headers or body cannot widen Bob's view.
    const aliceAccount = await clients.migrator.query<{ id: string; owner_user_id: string }>(
      "SELECT a.id, a.owner_user_id FROM accounts a JOIN users u ON u.id = a.owner_user_id WHERE u.idp_subject = 'alice'",
    );
    const selectors = { "X-Account-Id": aliceAccount.rows[0]!.id, "X-User-Id": aliceAccount.rows[0]!.owner_user_id };
    const viaQuery = await send(portB, "GET", `/productions?accountId=${aliceAccount.rows[0]!.id}&userId=${aliceAccount.rows[0]!.owner_user_id}`, undefined, { ...auth("bob"), ...selectors });
    expect(json(viaQuery).productions.map((item: { title: string }) => item.title)).toEqual(["Bob first"]);
    const itemViaHeaders = await send(portB, "GET", `/productions/${aliceProductionId}?accountId=${aliceAccount.rows[0]!.id}`, undefined, { ...auth("bob"), ...selectors });
    expect(itemViaHeaders.status).toBe(404);
    const bodySelector = await send(portB, "POST", "/productions", JSON.stringify({ title: "Steal", accountId: aliceAccount.rows[0]!.id }), jsonAuth("bob"));
    expect(bodySelector.status).toBe(400);

    // Shared email: two users, two accounts, each seeing only its own production.
    const users = await clients.migrator.query<{ idp_subject: string; email: string }>(
      "SELECT idp_subject, email FROM users WHERE idp_subject IN ('alice', 'bob') ORDER BY idp_subject",
    );
    expect(users.rows).toEqual([
      { idp_subject: "alice", email: "shared@example.test" },
      { idp_subject: "bob", email: "shared@example.test" },
    ]);
    expect(bobProduction.id).not.toBe(aliceProductionId);
  });

  it("N. a disabled user is refused on every route and nothing is written", async () => {
    await bootstrap("disabledUser");
    await pools[0]!.query("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE idp_issuer = $1 AND idp_subject = $2", [
      ISSUER,
      identities.disabledUser.subject,
    ]);
    const before = await totalRows();

    for (const response of [
      await bootstrap("disabledUser"),
      await send(portA, "GET", "/productions", undefined, auth("disabledUser")),
      await send(portA, "GET", `/productions/${randomUUID()}`, undefined, auth("disabledUser")),
      await createProduction("disabledUser", { title: "Nope" }),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body).toBe('{"status":"error","code":"ACCOUNT_UNAVAILABLE"}\n');
    }
    expect(await totalRows()).toEqual(before);
  });

  it("O. a disabled account is refused on every route and nothing is written", async () => {
    await bootstrap("disabledAccount");
    await pools[0]!.query(
      `UPDATE accounts SET status = 'DISABLED', disabled_at = now()
        WHERE owner_user_id = (SELECT id FROM users WHERE idp_issuer = $1 AND idp_subject = $2)`,
      [ISSUER, identities.disabledAccount.subject],
    );
    const before = await totalRows();

    for (const response of [
      await bootstrap("disabledAccount"),
      await send(portA, "GET", "/productions", undefined, auth("disabledAccount")),
      await createProduction("disabledAccount", { title: "Nope" }),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body).toBe('{"status":"error","code":"ACCOUNT_UNAVAILABLE"}\n');
    }
    expect(await totalRows()).toEqual(before);
  });

  it("rejects invalid credentials before touching the database", async () => {
    const before = await totalRows();
    for (const headers of [{}, { Authorization: "Bearer not-a-fixture" }, { Authorization: "Bearer a", authorization: "Bearer b" }]) {
      const response = await send(portA, "POST", "/account/bootstrap", undefined, headers);
      expect(response.status).toBe(401);
    }
    expect(await totalRows()).toEqual(before);
  });

  it("P. totals: one production per account that created one, audit events match", async () => {
    const rows = await clients.migrator.query<{ productions: number; production_events: number }>(
      `SELECT (SELECT count(*)::int FROM productions) AS productions,
              (SELECT count(*)::int FROM audit_events WHERE event_type = 'production.created') AS production_events`,
    );
    expect(rows.rows).toEqual([{ productions: 2, production_events: 2 }]);
  });
});

describe("process composition", () => {
  it("installs the routes only when an adapter is injected, on the process's single pool", async () => {
    const run = async (authentication?: AuthenticationAdapter) => {
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
        ...(authentication === undefined ? {} : { authentication }),
      });
      const stop = async () => {
        signals.emit("SIGTERM");
        for (let attempt = 0; attempt < 200 && !stdout.includes("commercial-api: stopped\n"); attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      };
      return { port: running!.port, stop };
    };

    const withoutAdapter = await run();
    const notExposed = await send(withoutAdapter.port, "POST", "/account/bootstrap", undefined, auth("processUser"));
    expect(notExposed.status).toBe(404);
    await withoutAdapter.stop();
    expect(await countsFor(identities.processUser)).toMatchObject({ users: 0 });

    const withAdapter = await run(adapter);
    expect((await send(withAdapter.port, "POST", "/account/bootstrap", undefined, auth("processUser"))).status).toBe(200);
    expect((await send(withAdapter.port, "GET", "/productions", undefined, auth("processUser"))).status).toBe(200);
    expect((await send(withAdapter.port, "GET", "/__health")).body).toBe('{"status":"ok","service":"commercial-api"}\n');
    expect((await send(withAdapter.port, "GET", "/__ready")).body).toBe('{"status":"ready","service":"commercial-api"}\n');
    await withAdapter.stop();
    expect(await countsFor(identities.processUser)).toMatchObject({ users: 1, accounts: 1, grants: 1 });
  });
});
