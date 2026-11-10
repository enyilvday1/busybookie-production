import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadRuntimeDatabaseConfig } from "../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type TransactionalPool } from "../../src/database/runtimePool.js";
import { authenticateWorker } from "../../src/workerAuthentication/workerAuthentication.js";
import { createTestWorkerAuthenticationAdapter } from "../support/testWorkerAuthentication.js";
import { openGuardedClients, prepareSchemaV1, type GuardedClients } from "./support/testDatabase.js";

// Worker authentication against PostgreSQL 16 through a runtime-role pool.
// Worker principals are provisioned by the owner role (the runtime role
// cannot insert them) and removed by the schema reset in afterAll.

let clients: GuardedClients;
let pool: TransactionalPool;
let activeId: string;
let toDisableId: string;
let disabledId: string;
const token = (name: string) => `fixture-${name}-${randomBytes(12).toString("hex")}`;
const TOKENS = { active: token("active"), toDisable: token("to-disable"), disabled: token("disabled"), unknown: token("unknown") };

beforeAll(async () => {
  clients = await openGuardedClients();
  await prepareSchemaV1(clients);
  const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: "2" }, "development");
  pool = await createRuntimePool(config!, () => {});
  const inserted = await clients.migrator.query<{ id: string; label: string }>(
    `INSERT INTO worker_principals (label, status, disabled_at)
     VALUES ('private-worker-active', 'ACTIVE', NULL), ('private-worker-to-disable', 'ACTIVE', NULL), ('private-worker-disabled', 'DISABLED', now())
     RETURNING id, label`,
  );
  const byLabel = new Map(inserted.rows.map((row) => [row.label, row.id]));
  activeId = byLabel.get("private-worker-active")!;
  toDisableId = byLabel.get("private-worker-to-disable")!;
  disabledId = byLabel.get("private-worker-disabled")!;
});

afterAll(async () => {
  await pool.end();
  await prepareSchemaV1(clients);
  await clients.close();
});

const adapter = () =>
  createTestWorkerAuthenticationAdapter([
    { token: TOKENS.active, workerPrincipalId: activeId },
    { token: TOKENS.toDisable, workerPrincipalId: toDisableId },
    { token: TOKENS.disabled, workerPrincipalId: disabledId },
    { token: TOKENS.unknown, workerPrincipalId: randomUUID() },
  ]);

const authenticate = (value: string) => authenticateWorker({ adapter: adapter(), database: pool }, [`Bearer ${value}`]);

describe("worker authentication against worker_principals", () => {
  it("authenticates an ACTIVE principal and rejects unknown and DISABLED ones uniformly", async () => {
    await expect(authenticate(TOKENS.active)).resolves.toEqual({ workerPrincipalId: activeId, label: "private-worker-active" });
    await expect(authenticate(TOKENS.unknown)).rejects.toMatchObject({ code: "WORKER_AUTHENTICATION_REJECTED", reason: "PRINCIPAL_UNKNOWN" });
    await expect(authenticate(TOKENS.disabled)).rejects.toMatchObject({ code: "WORKER_AUTHENTICATION_REJECTED", reason: "PRINCIPAL_DISABLED" });
  });

  it("treats the database status as authoritative on every request: disabling revokes immediately", async () => {
    await expect(authenticate(TOKENS.toDisable)).resolves.toMatchObject({ workerPrincipalId: toDisableId });
    // Revocation through the runtime role's lifecycle columns, as a future operator API would.
    await clients.runtime.query("UPDATE worker_principals SET status = 'DISABLED', disabled_at = now(), updated_at = now() WHERE id = $1", [toDisableId]);
    // The adapter still accepts the credential; the database does not.
    await expect(authenticate(TOKENS.toDisable)).rejects.toMatchObject({ code: "WORKER_AUTHENTICATION_REJECTED", reason: "PRINCIPAL_DISABLED" });
  });

  it("needs only the runtime role's existing SELECT, which it holds without INSERT", async () => {
    const privileges = await clients.runtime.query(
      `SELECT has_table_privilege(current_user, 'public.worker_principals', 'SELECT') AS select,
              has_table_privilege(current_user, 'public.worker_principals', 'INSERT') AS insert,
              has_table_privilege(current_user, 'public.worker_principals', 'DELETE') AS delete`,
    );
    expect(privileges.rows).toEqual([{ select: true, insert: false, delete: false }]);
  });

  it("writes no audit event and changes no row for authentication", async () => {
    const before = await clients.migrator.query("SELECT (SELECT count(*) FROM audit_events) AS audits, (SELECT max(updated_at) FROM worker_principals) AS updated");
    await authenticate(TOKENS.active);
    await authenticate(TOKENS.unknown).catch(() => undefined);
    const after = await clients.migrator.query("SELECT (SELECT count(*) FROM audit_events) AS audits, (SELECT max(updated_at) FROM worker_principals) AS updated");
    expect(after.rows).toEqual(before.rows);
  });
});
