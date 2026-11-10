import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { authenticateWorker, type WorkerAuthenticationDependencies } from "../../src/workerAuthentication/workerAuthentication.js";
import type { WorkerAuthenticationAdapter } from "../../src/workerAuthentication/workerAuthenticationAdapter.js";
import { WorkerAuthenticationError, type WorkerAuthenticationFailureReason } from "../../src/workerAuthentication/workerAuthenticationError.js";
import { createTestWorkerAuthenticationAdapter } from "../support/testWorkerAuthentication.js";

// Worker authentication without a database: the principal table is a fake
// that records every query. Tokens are random fixture keys, never secrets.

const ACTIVE_ID = randomUUID();
const DISABLED_ID = randomUUID();
const UNKNOWN_ID = randomUUID();
const TOKEN = `fixture-worker-${randomBytes(16).toString("hex")}`;
const DISABLED_TOKEN = `fixture-worker-${randomBytes(16).toString("hex")}`;
const UNKNOWN_TOKEN = `fixture-worker-${randomBytes(16).toString("hex")}`;
const REVOKED_TOKEN = `fixture-worker-${randomBytes(16).toString("hex")}`;

const PRINCIPALS = new Map<string, { id: string; label: string; status: string }>([
  [ACTIVE_ID, { id: ACTIVE_ID, label: "private-worker-1", status: "ACTIVE" }],
  [DISABLED_ID, { id: DISABLED_ID, label: "private-worker-2", status: "DISABLED" }],
]);

function fakeDatabase(fail = false) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const database: WorkerAuthenticationDependencies["database"] = {
    query: async <Row extends object>(sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (fail) throw Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
      const row = PRINCIPALS.get(params[0] as string);
      return { rows: (row === undefined ? [] : [row]) as unknown as Row[] };
    },
  };
  return { database, queries };
}

const adapter = createTestWorkerAuthenticationAdapter([
  { token: TOKEN, workerPrincipalId: ACTIVE_ID },
  { token: DISABLED_TOKEN, workerPrincipalId: DISABLED_ID },
  { token: UNKNOWN_TOKEN, workerPrincipalId: UNKNOWN_ID },
  { token: REVOKED_TOKEN, workerPrincipalId: ACTIVE_ID, status: "revoked" },
]);

const bearer = (token: string) => [`Bearer ${token}`];

async function failure(promise: Promise<unknown>): Promise<WorkerAuthenticationError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(WorkerAuthenticationError);
  const typed = error as WorkerAuthenticationError;
  // No token, header value or principal ID ever appears in what a caller or log line could see.
  const visible = `${typed.message} ${typed.code} ${typed.reason} ${JSON.stringify(typed)}`;
  for (const secret of [TOKEN, DISABLED_TOKEN, UNKNOWN_TOKEN, REVOKED_TOKEN, ACTIVE_ID, DISABLED_ID, UNKNOWN_ID]) {
    expect(visible.includes(secret)).toBe(false);
  }
  return typed;
}

async function expectFailure(
  promise: Promise<unknown>,
  code: WorkerAuthenticationError["code"],
  reason: WorkerAuthenticationFailureReason,
): Promise<void> {
  const error = await failure(promise);
  expect({ code: error.code, reason: error.reason }).toEqual({ code, reason });
}

describe("worker authentication", () => {
  it("authenticates a valid credential for an ACTIVE worker principal", async () => {
    const { database, queries } = fakeDatabase();
    const worker = await authenticateWorker({ adapter, database }, bearer(TOKEN));
    expect(worker).toEqual({ workerPrincipalId: ACTIVE_ID, label: "private-worker-1" });
    expect(Object.isFrozen(worker)).toBe(true);
    expect(queries).toEqual([{ sql: "SELECT id, label, status FROM worker_principals WHERE id = $1", params: [ACTIVE_ID] }]);
    // Case-insensitive scheme, as for customer bearer credentials.
    await expect(authenticateWorker({ adapter, database }, [`bearer ${TOKEN}`])).resolves.toEqual(worker);
  });

  it("rejects an unknown or DISABLED principal with the same code as any other rejection", async () => {
    const { database } = fakeDatabase();
    await expectFailure(authenticateWorker({ adapter, database }, bearer(UNKNOWN_TOKEN)), "WORKER_AUTHENTICATION_REJECTED", "PRINCIPAL_UNKNOWN");
    await expectFailure(authenticateWorker({ adapter, database }, bearer(DISABLED_TOKEN)), "WORKER_AUTHENTICATION_REJECTED", "PRINCIPAL_DISABLED");
    await expectFailure(authenticateWorker({ adapter, database }, bearer("not-a-fixture")), "WORKER_AUTHENTICATION_REJECTED", "ADAPTER_REJECTED");
    await expectFailure(authenticateWorker({ adapter, database }, bearer(REVOKED_TOKEN)), "WORKER_AUTHENTICATION_REJECTED", "ADAPTER_REJECTED");
    // The uniform public message gives nothing away.
    const messages = new Set(
      await Promise.all([UNKNOWN_TOKEN, DISABLED_TOKEN, "not-a-fixture", REVOKED_TOKEN].map(async (token) => (await failure(authenticateWorker({ adapter, database }, bearer(token)))).message)),
    );
    expect([...messages]).toEqual(["Worker authentication was rejected."]);
  });

  it("requires a credential and refuses every malformed Authorization shape before the adapter runs", async () => {
    let calls = 0;
    const counting: WorkerAuthenticationAdapter = {
      verify: async (credential) => {
        calls += 1;
        return adapter.verify(credential);
      },
    };
    const { database, queries } = fakeDatabase();
    await expectFailure(authenticateWorker({ adapter: counting, database }, []), "WORKER_AUTHENTICATION_REQUIRED", "CREDENTIAL_ABSENT");
    for (const values of [
      [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`],
      [`Bearer ${TOKEN}, Bearer ${TOKEN}`],
      [`Basic ${Buffer.from("worker:secret").toString("base64")}`],
      ["Bearer"],
      ["Bearer "],
      [""],
      [`  Bearer ${TOKEN}`],
      [`Bearer  ${TOKEN}`],
      [`Bearer ${TOKEN} extra`],
      [`Bearer\t${TOKEN}`],
      [`Bearer ${"a".repeat(4097)}`],
      [`Bearer tokén`],
      [`Worker ${TOKEN}`],
    ]) {
      await expectFailure(authenticateWorker({ adapter: counting, database }, values), "WORKER_AUTHENTICATION_REJECTED", "CREDENTIAL_MALFORMED");
    }
    expect(calls).toBe(0);
    expect(queries).toEqual([]);
    // The 4096-character bound itself is accepted by the parser (and then refused by the adapter).
    await expectFailure(authenticateWorker({ adapter: counting, database }, bearer("a".repeat(4096))), "WORKER_AUTHENTICATION_REJECTED", "ADAPTER_REJECTED");
  });

  it("fails closed without an adapter, without parsing, querying or falling back", async () => {
    const { database, queries } = fakeDatabase();
    await expectFailure(authenticateWorker({ database }, bearer(TOKEN)), "WORKER_AUTHENTICATION_UNAVAILABLE", "ADAPTER_NOT_CONFIGURED");
    await expectFailure(authenticateWorker({ database }, []), "WORKER_AUTHENTICATION_UNAVAILABLE", "ADAPTER_NOT_CONFIGURED");
    expect(queries).toEqual([]);
  });

  it("turns adapter and database faults into a safe UNAVAILABLE failure", async () => {
    const { database } = fakeDatabase();
    const outage = createTestWorkerAuthenticationAdapter([{ token: TOKEN, workerPrincipalId: ACTIVE_ID }], { available: () => false });
    await expectFailure(authenticateWorker({ adapter: outage, database }, bearer(TOKEN)), "WORKER_AUTHENTICATION_UNAVAILABLE", "ADAPTER_FAULT");

    const throwing: WorkerAuthenticationAdapter = {
      verify: async () => {
        throw new TypeError(`unexpected failure while checking ${TOKEN}`);
      },
    };
    const error = await failure(authenticateWorker({ adapter: throwing, database }, bearer(TOKEN)));
    expect({ code: error.code, reason: error.reason }).toEqual({ code: "WORKER_AUTHENTICATION_UNAVAILABLE", reason: "ADAPTER_FAULT" });

    const reportsUnavailable: WorkerAuthenticationAdapter = {
      verify: async () => {
        throw new WorkerAuthenticationError("WORKER_AUTHENTICATION_UNAVAILABLE", "ADAPTER_FAULT");
      },
    };
    await expectFailure(authenticateWorker({ adapter: reportsUnavailable, database }, bearer(TOKEN)), "WORKER_AUTHENTICATION_UNAVAILABLE", "ADAPTER_FAULT");

    // An adapter cannot escalate its own refusal into anything but a rejection.
    const claimsRequired: WorkerAuthenticationAdapter = {
      verify: async () => {
        throw new WorkerAuthenticationError("WORKER_AUTHENTICATION_REQUIRED", "CREDENTIAL_ABSENT");
      },
    };
    await expectFailure(authenticateWorker({ adapter: claimsRequired, database }, bearer(TOKEN)), "WORKER_AUTHENTICATION_REJECTED", "ADAPTER_REJECTED");

    const failing = fakeDatabase(true);
    await expectFailure(authenticateWorker({ adapter, database: failing.database }, bearer(TOKEN)), "WORKER_AUTHENTICATION_UNAVAILABLE", "DATABASE_FAILURE");
  });
});

describe("worker identity trust boundary", () => {
  it.each([
    ["a customer user", { workerPrincipalId: ACTIVE_ID, userId: randomUUID() }],
    ["account authority", { workerPrincipalId: ACTIVE_ID, accountId: randomUUID() }],
    ["a worker status", { workerPrincipalId: ACTIVE_ID, status: "ACTIVE" }],
    ["a generation authorization", { workerPrincipalId: ACTIVE_ID, generationAuthorizationId: randomUUID() }],
    ["attempt or lease authority", { workerPrincipalId: ACTIVE_ID, attemptId: randomUUID(), leaseToken: "x" }],
    ["a provider credential version", { workerPrincipalId: ACTIVE_ID, providerCredentialVersionId: randomUUID() }],
    ["scopes", { workerPrincipalId: ACTIVE_ID, scopes: ["lease", "grant"] }],
    ["a customer identity instead of a principal", { issuer: "https://issuer.test/", subject: "worker" }],
    ["a malformed principal ID", { workerPrincipalId: ACTIVE_ID.toUpperCase() }],
    ["a non-object", "worker"],
  ])("refuses adapter output carrying %s, before any database read", async (_label, output) => {
    const { database, queries } = fakeDatabase();
    const overreaching: WorkerAuthenticationAdapter = { verify: async () => output as never };
    await expectFailure(authenticateWorker({ adapter: overreaching, database }, bearer(TOKEN)), "WORKER_AUTHENTICATION_UNAVAILABLE", "IDENTITY_INVALID");
    expect(queries).toEqual([]);
  });

  it("returns only the worker principal identity, with the database's view of it", async () => {
    const { database } = fakeDatabase();
    const worker = await authenticateWorker({ adapter, database }, bearer(TOKEN));
    expect(Object.keys(worker).sort()).toEqual(["label", "workerPrincipalId"]);
  });

  it("refuses duplicate fixture tokens and empty tokens when the test adapter is built", () => {
    expect(() => createTestWorkerAuthenticationAdapter([{ token: TOKEN, workerPrincipalId: ACTIVE_ID }, { token: TOKEN, workerPrincipalId: DISABLED_ID }])).toThrow(
      "Duplicate test worker fixture token.",
    );
    expect(() => createTestWorkerAuthenticationAdapter([{ token: "", workerPrincipalId: ACTIVE_ID }])).toThrow();
  });
});
