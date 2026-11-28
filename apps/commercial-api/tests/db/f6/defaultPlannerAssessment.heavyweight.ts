import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { cpus, freemem, platform, totalmem } from "node:os";
import { performance } from "node:perf_hooks";

import { afterAll, beforeAll, beforeEach, describe, inject, it } from "vitest";

import { discoverMigrations } from "../../../src/database/migrationFiles.js";
import { loadRuntimeDatabaseConfig } from "../../../src/database/runtimeDatabaseConfig.js";
import { createRuntimePool, type RuntimeClient, type TransactionalPool } from "../../../src/database/runtimePool.js";
import { reconcileProviderVerificationJobs } from "../../../src/providerConnections/providerVerificationReconciliationService.js";
import { deferUnsupportedProviderVerification } from "../../../src/workerControl/workerProviderVerificationDeferralService.js";
import { acquireProviderVerificationLease } from "../../../src/workerControl/workerProviderVerificationLeaseService.js";
import { openGuardedClients, prepareSchemaV1, resetTestSchema, type GuardedClients } from "../support/testDatabase.js";

// R44B11G F6 production-like default-planner assessment (heavyweight,
// separate acceptance gate). Isolated from the ordinary regression file
// ../workerProviderVerificationDeferral.test.ts, which keeps the original
// forced-index F6 and its own root hooks unchanged.
//
// Selection. This module is deliberately not named *.test.ts and
// vitest.db.config.ts also excludes tests/db/f6/**, so `npm run test:db`
// never collects it. Only vitest.f6.config.ts includes it, and that config
// must also provide the r44b11gF6Selection literal; without it the suite
// registers as skipped. No environment variable selects or admits it.
//
// Lifecycle. This module has no root hooks. Its only hooks belong to the
// selected describe below, so nothing runs when it is skipped, and the
// ordinary regression hooks are never involved. Admission order:
//   1. resource admission (unconditionally BLOCKED: throws, no bypass);
//   2. explicit authorization and dedicated/exclusive database attestations;
//   3. live-provider safe-suite guard;
//   4. Git baseline/branch/index/tracked-modification preflight;
//   5. openGuardedClients(): the first database connection, with the
//      existing guarded server identity check for both roles;
//   6. assessment advisory exclusion lock;
//   7. runtime pool;
//   then per scenario: resource admission again, before prepareSchemaV1's
//   first DROP/write (the first mutation), and again inside the test body.
// Steps 2-7 are unreachable while step 1 throws.

// Module-local database handles, opened only by the selected beforeAll.
let clients: GuardedClients;
let pool: TransactionalPool;
let clientsOpened = false;
let poolOpened = false;

// ---------------------------------------------------------------------------
// Fixture helpers copied byte-for-byte from ../workerProviderVerificationDeferral.test.ts.
// A test module must never import another test module: that would register
// (and run) the regression suite's tests and root hooks here.

type Worker = Readonly<{ id: string; token: string }>;

async function workers(count: number): Promise<Worker[]> {
  const list: Worker[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = (await clients.migrator.query<{ id: string }>("INSERT INTO worker_principals (label) VALUES ($1) RETURNING id", [`deferral-worker-${index}`])).rows[0]!.id;
    list.push({ id, token: `fixture-worker-${randomBytes(16).toString("hex")}` });
  }
  return list;
}

type Fixture = Readonly<{ userId: string; accountId: string; connectionId: string; versionId: string; jobId: string }>;

type Lease = Readonly<{ providerVerificationJobId: string; leaseToken: string; fencingCounter: number }>;
type Proof = Readonly<{ fencingCounter: number; leaseToken: string }>;
const proofOf = (acquired: Lease): Proof => ({ fencingCounter: acquired.fencingCounter, leaseToken: acquired.leaseToken });
const contextOf = (worker: Worker) => Object.freeze({ workerPrincipalId: worker.id, correlationId: randomUUID() });

const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

type PlanNode = { "Node Type": string; Plans?: PlanNode[]; "Scan Direction"?: string; "Index Name"?: string; "Relation Name"?: string; Alias?: string; "Index Cond"?: string };

const allNodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(allNodes)];

function stripOuterParentheses(text: string): string {
  let current = text;
  for (;;) {
    if (!current.startsWith("(") || !current.endsWith(")")) return current;
    let depth = 0;
    let closesAtEnd = true;
    for (let index = 0; index < current.length; index += 1) {
      if (current[index] === "(") depth += 1;
      if (current[index] === ")") depth -= 1;
      if (depth === 0 && index < current.length - 1) {
        closesAtEnd = false;
        break;
      }
    }
    if (!closesAtEnd) return current;
    current = current.slice(1, -1);
  }
}

// m3: remove the j. qualifier, casts, whitespace and redundant outer parentheses.
const normaliseCondition = (condition: string) =>
  stripOuterParentheses(condition.replace(/\bj\./g, "").replace(/::[a-z ]+(\(\d+\))?/gi, "").replace(/\s+/g, ""));

function recordingPool(base: TransactionalPool, recorded: Set<string>): TransactionalPool {
  return Object.freeze({
    query: base.query,
    end: async () => {},
    connect: async () => {
      const client = await base.connect();
      return Object.freeze({
        query: <Row extends object>(sql: string, params?: unknown[]) => {
          recorded.add(sql);
          return client.query<Row>(sql, params);
        },
        release: (error?: Error) => client.release(error),
      });
    },
  });
}

// ---------------------------------------------------------------------------

// F6 production-like assessment. This is a separate acceptance gate: the
// original forced-index F6 in ../workerProviderVerificationDeferral.test.ts
// is deliberately byte-for-byte unchanged.
// No artifact writer exists here. Task metadata holds the proposed bundle;
// durable export needs a separately approved destination and reporter.
// Pinned baseline, preserved as authored. It is NOT the current HEAD; the
// Git preflight fails closed on the mismatch until a separate review re-pins it.
const F6_ASSESSMENT_BASELINE = "d47e7e591929288b363055faa38a9a1dc5dbc0d8";
declare module "vitest" {
  interface ProvidedContext {
    r44b11gF6Selection?: "EXPLICIT_HEAVYWEIGHT_F6_ONLY";
  }
}
// The Vitest invocation must positively provide this literal; only
// vitest.f6.config.ts does. No environment variable, including stale
// authorization flags, selects it. Selection is not admission.
const F6_ASSESSMENT_SELECTED = inject("r44b11gF6Selection") === "EXPLICIT_HEAVYWEIGHT_F6_ONLY";
const F6_RESOURCE_ADMISSION = Object.freeze({
  schema: "busybookie.r44b11g.f6-resource-admission/v1",
  status: "BLOCKED" as const,
  assessmentAccepted: false,
  classification: "SAFETY_GATE_FAILED" as const,
  guarantees: { cpuQuota: false, memoryQuota: false, databaseVolumeQuota: false, walQuota: false, serverCancellation: false },
  observedAccounting: "NONE_NO_DATABASE_CONTACT" as const,
  reasons: [
    "No authorized independently verifiable CPU/memory isolation or approved resource budgets.",
    "Table sizes and pg_database_size cannot establish total volume/WAL/archive/temp consumption or quotas.",
    "No authorized database-volume measurement or quota-enforcement interface; environment attestations are insufficient.",
    "Existing RuntimeClient exposes query/release, not confirmed server cancellation or an external process supervisor.",
  ],
  risks: [
    "S creates 60,350 jobs plus owners/accounts/grants/connections/versions and keeps large UUID mappings/histograms in runner memory.",
    "S performs 10,200 committed lease/deferral pairs; index churn, dead tuples, WAL and checkpoint/archive retention cannot be bounded by relation-size deltas.",
    "K can repeatedly examine an older 4,000-row lifecycle-ineligible prefix; CPU and setup throughput have no measured acceptance baseline.",
    "B/H/K also need isolation and quotas; smaller cardinality does not justify bypassing admission.",
  ],
  requestedWork: F6_SCENARIO_RESOURCE_DEMAND(),
});
function F6_SCENARIO_RESOURCE_DEMAND(): object {
  // Counts are from the accepted matrix, not new capacity thresholds.
  return { B: { jobs: 6035, deferrals: 5500 }, H: { jobs: 6035, deferrals: 1020 },
    K: { jobs: 10035, deferrals: 5500 }, S: { jobs: 60350, deferrals: 10200 }, concurrency: 8 };
}
function f6RequireResourceAdmission(): void {
  // Deliberately no environment/injected-token bypass. Removing this block
  // requires a reviewed resource supervisor/measurement design and authority.
  throw new F6AssessmentError("SAFETY_GATE_FAILED", "RESOURCE_ENFORCEMENT_UNAVAILABLE: CPU, memory, total volume/WAL and confirmed cancellation are not guaranteed");
}
const F6_ASSESSMENT_TABLES = ["provider_verification_jobs", "accounts", "users", "provider_connections", "provider_credential_versions"] as const;
const F6_ASSESSMENT_LIMITS = Object.freeze({
  concurrency: 8, poolMax: 12, connectionCeiling: 14, chunk: 1000, captures: 3,
  futureSeedMs: 150_000, futureWindowMs: 240_000, futureMarginSeconds: 30,
  analyzeMs: 30_000, statisticsWaitMs: 5000, explainMs: 10_000, lockMs: 1000,
  pastWaitMs: 10_000, growthBytes: 2 * 1024 ** 3,
  // Independent cleanup deadlines reuse the accepted 10/30 s command bounds
  // and existing 60 s hook budget; these are safeguards, not latency targets.
  controlMs: 10_000, rollbackMs: 10_000, closeMs: 10_000, drainMs: 60_000, cleanupMs: 60_000,
});
type F6Classification =
  | "SAFETY_GATE_FAILED" | "SETUP_INVALID" | "SETUP_WINDOW_EXCEEDED"
  | "STATISTICS_INVALID" | "CONFIGURATION_INVALID" | "PLAN_CAPTURE_FAILED"
  | "EXPECTED_ORDERED_PLAN" | "PLAN_DIVERGENCE_REVIEW_REQUIRED" | "PLAN_VARIATION_REVIEW_REQUIRED";
type F6Scenario = Readonly<{ id: "B" | "H" | "K" | "S"; past: number; future: number; never: number; ineligible: number; leased: number; cancelled: number; timeoutMs: number }>;
const F6_SCENARIOS: readonly F6Scenario[] = [
  { id: "B", past: 500, future: 5000, never: 520, ineligible: 0, leased: 5, cancelled: 10, timeoutMs: 600_000 },
  { id: "H", past: 500, future: 520, never: 5000, ineligible: 0, leased: 5, cancelled: 10, timeoutMs: 600_000 },
  { id: "K", past: 500, future: 5000, never: 520, ineligible: 4000, leased: 5, cancelled: 10, timeoutMs: 600_000 },
  { id: "S", past: 5000, future: 5200, never: 50_000, ineligible: 0, leased: 50, cancelled: 100, timeoutMs: 900_000 },
];
class F6AssessmentError extends Error {
  constructor(readonly classification: F6Classification, readonly reason: string) {
    // Never propagate a driver error, query parameters, URL or lease proof.
    super(`${classification}: ${reason}`);
  }
}
function f6Require(value: unknown, classification: F6Classification, reason: string): asserts value {
  if (!value) throw new F6AssessmentError(classification, reason);
}
function f6Failure(error: unknown, classification: F6Classification, reason: string): F6AssessmentError {
  // The production transaction helper wraps test deadline errors. Recover only
  // our own classified error, never include a driver's message or parameters.
  let cause = error;
  for (let depth = 0; depth < 8 && cause instanceof Error; depth += 1) {
    if (cause instanceof F6AssessmentError) return cause;
    cause = cause.cause;
  }
  return new F6AssessmentError(classification, reason);
}
type F6Setting = { name: string; setting: string; boot_val: string | null; reset_val: string | null; source: string; unit: string | null };
type F6Tree = PlanNode & { [key: string]: unknown; Plans?: F6Tree[] };
type F6Capture = {
  ordinal: number; raw: unknown; settings: F6Setting[]; population: object | null;
  classification: F6Classification | null; reasons: string[]; structure: object | null; nodes: object[];
  rollback: "pending" | "confirmed" | "failed";
  cleanup: F6Cleanup;
};
type F6Cleanup = {
  disposition: "NOT_REQUIRED" | "CONFIRMED" | "CLEANUP_FAILED";
  steps: { phase: string; result: "confirmed" | "failed" | "deadline"; elapsedMs: number }[];
  serverCancellationConfirmed: boolean;
};
class F6CleanupError extends Error {
  readonly disposition = "CLEANUP_FAILED";
  constructor() { super("CLEANUP_FAILED: session or fixture cleanup could not be confirmed"); }
}
let f6SessionsTrusted = true;
let f6DispatchDeadline: number | undefined;
const f6PendingOperations = new Set<Promise<unknown>>();
async function f6Deadline<T>(work: () => Promise<T>, milliseconds: number, cleanup?: F6Cleanup, phase = "database-operation"): Promise<T> {
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const operation = Promise.resolve().then(work);
  f6PendingOperations.add(operation);
  // Both handlers absorb late settlement; timed-out work stays tracked until
  // it really settles. A JS deadline does NOT cancel the PostgreSQL command.
  void operation.then(() => f6PendingOperations.delete(operation), () => f6PendingOperations.delete(operation));
  try {
    const result = await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        f6SessionsTrusted = false;
        reject(new F6AssessmentError("SAFETY_GATE_FAILED", "client deadline exceeded; server-side cancellation unconfirmed"));
      }, milliseconds);
    })]);
    cleanup?.steps.push({ phase, result: "confirmed", elapsedMs: performance.now() - started });
    return result;
  } catch (error) {
    cleanup?.steps.push({ phase, result: expired ? "deadline" : "failed", elapsedMs: performance.now() - started });
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
function f6TrustSession(): void {
  f6Require(f6SessionsTrusted, "SAFETY_GATE_FAILED", "session trust lost; no further fixture or inspection dispatch allowed");
}
function f6DispatchCheckpoint(): void {
  f6TrustSession();
  f6Require(f6DispatchDeadline === undefined || performance.now() < f6DispatchDeadline,
    "SETUP_WINDOW_EXCEEDED", "scenario dispatch deadline exceeded");
}
async function f6OwnerQuery<Row extends object = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }> {
  f6DispatchCheckpoint();
  return f6Deadline(async () => ({ rows: (await clients.migrator.query(sql, params)).rows as Row[] }), F6_ASSESSMENT_LIMITS.analyzeMs);
}
async function f6RuntimeQuery<Row extends object = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }> {
  f6DispatchCheckpoint();
  return f6Deadline(async () => ({ rows: (await clients.runtime.query(sql, params)).rows as Row[] }), F6_ASSESSMENT_LIMITS.controlMs);
}
function f6NewCleanup(): F6Cleanup {
  return { disposition: "NOT_REQUIRED", steps: [], serverCancellationConfirmed: false };
}
async function f6CloseUncertain(client: { end: () => Promise<void> }, cleanup: F6Cleanup, phase: string): Promise<void> {
  f6SessionsTrusted = false;
  // end() settlement is transport cleanup, not proof of server cancellation.
  try { await f6Deadline(() => client.end(), F6_ASSESSMENT_LIMITS.closeMs, cleanup, phase); }
  catch { cleanup.disposition = "CLEANUP_FAILED"; }
}
async function f6CleanupScenario(bundle: F6Bundle): Promise<void> {
  if (bundle.setup.fixtureWritesStarted !== true && f6SessionsTrusted && f6PendingOperations.size === 0) return;
  const cleanup = bundle.cleanup;
  const deadline = performance.now() + F6_ASSESSMENT_LIMITS.cleanupMs;
  const remaining = () => Math.max(1, deadline - performance.now());
  try {
    // Snapshot before f6Deadline tracks its own drain promise.
    const pending = [...f6PendingOperations];
    await f6Deadline(() => Promise.allSettled(pending), Math.min(remaining(), F6_ASSESSMENT_LIMITS.drainMs), cleanup, "fixture-drain");
    f6Require(f6SessionsTrusted && f6PendingOperations.size === 0, "SAFETY_GATE_FAILED", "unsettled or uncertain work forbids fixture cleanup");
    if (bundle.setup.fixtureWritesStarted !== true) { cleanup.disposition = "CONFIRMED"; return; }
    // Do not RESET timeouts. Keep verified 30 s statement / 1 s lock safety
    // bounds in force through resetTestSchema's identity check and DROP block.
    const settings = await f6Deadline(() => clients.migrator.query<{ safe: boolean }>(`SELECT current_setting('statement_timeout')::interval > interval '0'
      AND current_setting('statement_timeout')::interval <= interval '30 seconds'
      AND current_setting('lock_timeout')::interval > interval '0'
      AND current_setting('lock_timeout')::interval <= interval '1 second' AS safe`), Math.min(remaining(), F6_ASSESSMENT_LIMITS.analyzeMs), cleanup, "cleanup-timeout-validation");
    f6Require(settings.rows[0]?.safe, "SAFETY_GATE_FAILED", "cleanup server timeouts are ineffective");
    await f6Deadline(() => resetTestSchema(clients.migrator), remaining(), cleanup, "fixture-schema-reset");
    cleanup.disposition = "CONFIRMED";
  } catch {
    cleanup.disposition = "CLEANUP_FAILED";
    await f6CloseUncertain(clients.runtime, cleanup, "runtime-disconnect");
    await f6CloseUncertain(clients.migrator, cleanup, "owner-disconnect");
    try { await f6Deadline(() => pool.end(), F6_ASSESSMENT_LIMITS.closeMs, cleanup, "pool-disconnect"); }
    catch { /* Still failed and untrusted; an external supervisor must confirm server termination. */ }
    throw new F6CleanupError();
  }
}
type F6Bundle = {
  schema: "busybookie.r44b11g.f6-plan-evidence/v1";
  assessmentAccepted: boolean;
  outcome: F6Classification | null;
  manifest: Record<string, unknown>; query: { sql: string; sha256: string } | null;
  statistics: Record<string, unknown>; setup: Record<string, unknown>;
  captures: F6Capture[]; classifications: { classification: F6Classification; reason: string }[];
  cleanup: F6Cleanup;
  variations: { left: number; right: number; paths: string[] }[];
  review: { executionBenchmark: false; productionAcceptance: false; destination: null; openRequirements: string[] };
};
type F6Tenant = { userId: string; accountId: string; group: number; hot: boolean };
type F6Fixture = Fixture & { group: number };
type F6Cohorts = { past: string[]; future: string[]; never: string[]; leased: string[]; cancelled: string[]; ineligible: string[] };

// Full SQL contract is checked separately from the plan. EXPLAIN always uses
// the recorded production statement, never this independent contract string.
const F6_SELECT_CONTRACT = `SELECT j.id, c.provider, j.verification_policy_id
FROM provider_verification_jobs j
JOIN accounts a ON a.id = j.account_id
JOIN users u ON u.id = a.owner_user_id
JOIN provider_connections c ON c.account_id = j.account_id AND c.id = j.provider_connection_id
JOIN provider_credential_versions v ON v.account_id = j.account_id AND v.provider_connection_id = j.provider_connection_id AND v.id = j.provider_credential_version_id
WHERE j.state = 'QUEUED' AND COALESCE(j.deferred_until, j.created_at) <= now()
AND j.lease_fencing_counter < 9007199254740991 AND a.status = 'ACTIVE' AND u.status = 'ACTIVE'
AND c.status NOT IN ('DISCONNECTED', 'DISABLED') AND v.status = 'ACTIVE'
ORDER BY COALESCE(j.deferred_until, j.created_at), j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED`;
const f6SqlCanonical = (sql: string) => sql.replace(/\s+/g, " ").trim();

async function f6Chunks<T>(items: readonly T[], work: (chunk: readonly T[]) => Promise<void>): Promise<void> {
  for (let offset = 0; offset < items.length; offset += F6_ASSESSMENT_LIMITS.chunk) await work(items.slice(offset, offset + F6_ASSESSMENT_LIMITS.chunk));
}

// Stop dispatch on the first failure, but drain ALL workers before throwing.
// No rejected Promise.race or Vitest timeout is used to abandon database work.
async function f6Drain(count: number, check: () => void, work: () => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  let failure: unknown;
  let signalFailure: () => void = () => {};
  const firstFailure = new Promise<void>((resolve) => { signalFailure = resolve; });
  const workers = Array.from({ length: F6_ASSESSMENT_LIMITS.concurrency }, async () => {
    while (!failed && next < count) {
      try {
        check();
        next += 1;
        await work();
        check();
      } catch (error) {
        failed = true;
        failure ??= error;
        signalFailure();
      }
    }
  });
  const settled = Promise.allSettled(workers);
  // The existing scenario/future deadlines govern normal dispatch. The drain
  // budget starts independently at the first failure, not at phase start.
  await Promise.race([settled, firstFailure]);
  if (failed) await f6Deadline(() => settled, F6_ASSESSMENT_LIMITS.drainMs);
  if (failed) throw failure;
}

function f6BoundedPool(base: TransactionalPool, check: () => void): TransactionalPool {
  return {
    query: async <Row extends object>(sql: string, params?: unknown[]) => {
      check();
      f6DispatchCheckpoint();
      return f6Deadline(() => base.query<Row>(sql, params), F6_ASSESSMENT_LIMITS.controlMs);
    },
    end: async () => {},
    connect: async () => {
      check();
      f6DispatchCheckpoint();
      const pending = base.connect();
      void pending.then((client) => { if (!f6SessionsTrusted) client.release(new Error("F6_SESSION_UNTRUSTED")); }, () => {});
      const client = await f6Deadline(() => pending, F6_ASSESSMENT_LIMITS.controlMs);
      return {
        query: async <Row extends object>(sql: string, params?: unknown[]) => {
          // Always let withTransaction roll back after the deadline. Each other
          // statement checks it, so an active sequence cannot continue issuing
          // all remaining service statements after another worker has failed.
          const rollback = sql.trim().toUpperCase() === "ROLLBACK";
          if (!rollback) { check(); f6DispatchCheckpoint(); }
          return f6Deadline(() => client.query<Row>(sql, params), rollback ? F6_ASSESSMENT_LIMITS.rollbackMs : F6_ASSESSMENT_LIMITS.controlMs);
        },
        release: (error?: Error) => client.release(error ?? (!f6SessionsTrusted ? new Error("F6_SESSION_UNTRUSTED") : undefined)),
      };
    },
  };
}

async function f6Tenants(count: number, skew: boolean, check: () => void, checkpoint: () => Promise<void>): Promise<F6Tenant[]> {
  const tenants = Array.from({ length: count }, (_, index) => ({
    userId: randomUUID(), accountId: randomUUID(), group: skew ? Math.floor(index / 20) : 0, hot: skew && index % 20 < 2,
  }));
  await f6Chunks(tenants, async (chunk) => {
    check();
    const users = chunk.map((row) => row.userId);
    const accounts = chunk.map((row) => row.accountId);
    await f6OwnerQuery("INSERT INTO users (id, idp_issuer, idp_subject) SELECT u, 'https://issuer.test', u::text FROM unnest($1::uuid[]) t(u)", [users]);
    await f6OwnerQuery("INSERT INTO accounts (id, kind, owner_user_id) SELECT a, 'PERSONAL', u FROM unnest($1::uuid[], $2::uuid[]) t(a,u)", [accounts, users]);
    // Bulk equivalent of insertAccountWithFreeGrant, including the unused grant.
    await f6OwnerQuery(`INSERT INTO entitlement_grants (account_id, kind, state, source, issuance_key, policy_version)
      SELECT a, 'FREE_BYO', 'AVAILABLE', 'ACCOUNT_PROVISIONING', 'account-provisioning', 'test-policy' FROM unnest($1::uuid[]) t(a)`, [accounts]);
    await checkpoint();
  });
  return tenants;
}

function f6FixtureRows(tenants: readonly F6Tenant[], count: number, group: number, skew: boolean): F6Fixture[] {
  const candidates = tenants.filter((tenant) => tenant.group === group);
  const hot = candidates.filter((tenant) => tenant.hot);
  const tail = candidates.filter((tenant) => !tenant.hot);
  const hotCount = count * 4 / 5;
  f6Require(!skew || Number.isInteger(hotCount), "SETUP_INVALID", "skew assignment must have exact 80 percent cardinality");
  return Array.from({ length: count }, (_, index) => {
    const tenant = skew
      ? (index < hotCount ? hot[index % hot.length]! : tail[(index - hotCount) % tail.length]!)
      : candidates[index]!;
    return { userId: tenant.userId, accountId: tenant.accountId, connectionId: randomUUID(), versionId: randomUUID(), jobId: randomUUID(), group };
  });
}

async function f6InsertRows(rows: readonly F6Fixture[], check: () => void, checkpoint: () => Promise<void>): Promise<void> {
  await f6Chunks(rows, async (chunk) => {
    check();
    const accounts = chunk.map((row) => row.accountId);
    const users = chunk.map((row) => row.userId);
    const connections = chunk.map((row) => row.connectionId);
    const versions = chunk.map((row) => row.versionId);
    await f6OwnerQuery(`INSERT INTO provider_connections (id, account_id, provider, credential_kind, created_by_user_id)
      SELECT c, a, 'EXAMPLE_PROVIDER', 'API_KEY', u FROM unnest($1::uuid[], $2::uuid[], $3::uuid[]) t(c,a,u)`, [connections, accounts, users]);
    // Same bounded, schema-valid dummy envelope as bulkJobs; no opener/grant is
    // used. Real production envelope width is an explicit representativeness gap.
    await f6OwnerQuery(`INSERT INTO provider_credential_versions
      (id, account_id, provider_connection_id, credential_version, sealed_credential, fingerprint_algorithm, fingerprint_key_ref, fingerprint_value, created_by_user_id)
      SELECT v, a, c, 1, '{"format":"fixture-envelope"}'::jsonb, 'HMAC-SHA-256', 'fixture/v1', repeat('a',43), u
      FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[]) t(v,a,c,u)`, [versions, accounts, connections, users]);
    await f6OwnerQuery(`INSERT INTO provider_verification_jobs
      (id, account_id, provider_connection_id, provider_credential_version_id, verification_policy_id, requested_by_user_id)
      SELECT j, a, c, v, 'EXAMPLE_METADATA_V1', u FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[]) t(j,a,c,v,u)`,
    [chunk.map((row) => row.jobId), accounts, connections, versions, users]);
    await checkpoint();
  });
}

async function f6Ineligible(rows: readonly F6Fixture[], check: () => void, checkpoint: () => Promise<void>): Promise<void> {
  await f6Chunks(rows, async (chunk) => {
    check();
    const group = chunk[0]!.group;
    if (group === 1) await f6OwnerQuery("UPDATE accounts SET status = 'DISABLED', disabled_at = now() WHERE id = ANY($1::uuid[])", [chunk.map((row) => row.accountId)]);
    if (group === 2) await f6OwnerQuery("UPDATE users SET status = 'DISABLED', disabled_at = now() WHERE id = ANY($1::uuid[])", [chunk.map((row) => row.userId)]);
    if (group === 3) {
      await f6OwnerQuery("UPDATE provider_connections SET status = 'DISCONNECTED', disconnected_at = now() WHERE id = ANY($1::uuid[])", [chunk.slice(0, 500).map((row) => row.connectionId)]);
      await f6OwnerQuery("UPDATE provider_connections SET status = 'DISABLED', disabled_at = now() WHERE id = ANY($1::uuid[])", [chunk.slice(500).map((row) => row.connectionId)]);
    }
    if (group === 4) {
      await f6OwnerQuery("UPDATE provider_credential_versions SET status = 'SUPERSEDED', superseded_at = now(), updated_at = now() WHERE id = ANY($1::uuid[])", [chunk.map((row) => row.versionId)]);
      // Supersede first: the one-ACTIVE-version partial unique index stays live.
      await f6OwnerQuery(`INSERT INTO provider_credential_versions
        (account_id, provider_connection_id, credential_version, sealed_credential, fingerprint_algorithm, fingerprint_key_ref, fingerprint_value, created_by_user_id)
        SELECT a, c, 2, '{"format":"fixture-envelope"}'::jsonb, 'HMAC-SHA-256', 'fixture/v1', repeat('b',43), u
        FROM unnest($1::uuid[], $2::uuid[], $3::uuid[]) t(a,c,u)`, [chunk.map((row) => row.accountId), chunk.map((row) => row.connectionId), chunk.map((row) => row.userId)]);
    }
    await checkpoint();
  });
}

const F6_POPULATION_SQL = `WITH x AS (
  SELECT j.*, a.status = 'ACTIVE' AND u.status = 'ACTIVE'
    AND c.status NOT IN ('DISCONNECTED','DISABLED') AND v.status = 'ACTIVE' AS lifecycle
  FROM provider_verification_jobs j JOIN accounts a ON a.id = j.account_id JOIN users u ON u.id = a.owner_user_id
  JOIN provider_connections c ON c.account_id = j.account_id AND c.id = j.provider_connection_id
  JOIN provider_credential_versions v ON v.account_id = j.account_id AND v.provider_connection_id = j.provider_connection_id AND v.id = j.provider_credential_version_id
) SELECT count(*)::int AS total,
  count(*) FILTER (WHERE state = 'QUEUED' AND lifecycle AND lease_fencing_counter < 9007199254740991 AND COALESCE(deferred_until,created_at) <= now())::int AS eligible,
  count(*) FILTER (WHERE state = 'QUEUED' AND NOT lifecycle)::int AS ineligible,
  count(*) FILTER (WHERE state = 'QUEUED' AND deferred_until > now())::int AS future,
  count(*) FILTER (WHERE state = 'QUEUED' AND deferred_until <= now())::int AS past,
  count(*) FILTER (WHERE state = 'QUEUED' AND deferred_until IS NULL AND lifecycle)::int AS never,
  count(*) FILTER (WHERE state = 'LEASED')::int AS leased,
  count(*) FILTER (WHERE state = 'LEASED' AND lease_expires_at <= now())::int AS expired_leases,
  count(*) FILTER (WHERE id = ANY($3::uuid[]))::int AS leased_cohort_rows,
  count(*) FILTER (WHERE id = ANY($3::uuid[]) AND (state <> 'LEASED' OR lease_expires_at IS NULL OR lease_expires_at <= now()
    OR credential_granted_at IS NOT NULL OR unsupported_deferral_count <> 0 OR lease_fencing_counter <> 1))::int AS invalid_leased_cohort,
  count(*) FILTER (WHERE state = 'CANCELLED')::int AS cancelled,
  count(*) FILTER (WHERE (id = ANY($1::uuid[]) AND (state <> 'QUEUED' OR unsupported_deferral_count <> 1 OR deferred_until > now()))
    OR (id = ANY($2::uuid[]) AND (state <> 'QUEUED' OR unsupported_deferral_count <> 1 OR deferred_until <= now() + interval '30 seconds')))::int AS invalid_deferrals,
  (min(deferred_until) FILTER (WHERE id = ANY($2::uuid[])))::text AS earliest_future,
  now()::text AS transaction_time,
  (SELECT count(*)::int FROM x q WHERE q.state = 'QUEUED' AND NOT q.lifecycle
    AND (COALESCE(q.deferred_until,q.created_at),q.id) < (SELECT COALESCE(e.deferred_until,e.created_at),e.id FROM x e
      WHERE e.state = 'QUEUED' AND e.lifecycle AND e.lease_fencing_counter < 9007199254740991 AND COALESCE(e.deferred_until,e.created_at) <= now()
      ORDER BY COALESCE(e.deferred_until,e.created_at),e.id LIMIT 1)) AS ineligible_prefix
FROM x`;

async function f6Population(client: Pick<RuntimeClient, "query">, scenario: F6Scenario, cohorts: F6Cohorts, record: (row: Record<string, unknown>) => void): Promise<Record<string, unknown>> {
  const row = (await client.query<Record<string, unknown>>(F6_POPULATION_SQL, [cohorts.past, cohorts.future, cohorts.leased])).rows[0]!;
  record(row); // Preserve invalid population evidence before validation throws.
  const expected = { total: scenario.past + scenario.future + scenario.never + scenario.ineligible + scenario.leased + scenario.cancelled,
    eligible: scenario.past + scenario.never, past: scenario.past, future: scenario.future, never: scenario.never,
    ineligible: scenario.ineligible, leased: scenario.leased, expired_leases: 0, leased_cohort_rows: scenario.leased, invalid_leased_cohort: 0,
    cancelled: scenario.cancelled, invalid_deferrals: 0, ineligible_prefix: scenario.ineligible };
  for (const [key, value] of Object.entries(expected)) f6Require(row[key] === value,
    key === "future" || key === "invalid_deferrals" ? "SETUP_WINDOW_EXCEEDED" : "SETUP_INVALID", `population mismatch: ${key}`);
  return row;
}

type F6TableStat = { relname: string; analyze_count: string; last_analyze: string | null; reltuples: number; relpages: number; bytes: string };
const F6_TABLE_STATS_SQL = `SELECT s.relname, s.analyze_count::text, s.last_analyze::text,
  c.reltuples::float8 AS reltuples, c.relpages, pg_total_relation_size(c.oid)::text AS bytes
  FROM pg_stat_user_tables s JOIN pg_class c ON c.oid = s.relid
  WHERE s.schemaname = 'public' AND s.relname = ANY($1::text[]) ORDER BY s.relname`;

async function f6Statistics(bundle: F6Bundle, check: () => void): Promise<void> {
  const warnings: string[] = [];
  const notice = (message: { severity?: string | undefined }) => { if (message.severity === "WARNING") warnings.push("ANALYZE_WARNING"); };
  bundle.statistics.warnings = warnings;
  clients.migrator.on("notice", notice);
  try {
    const before = (await f6OwnerQuery<F6TableStat>(F6_TABLE_STATS_SQL, [F6_ASSESSMENT_TABLES])).rows;
    bundle.statistics.before = before;
    // Owner autocommit, never an inspection transaction or a runtime ANALYZE.
    // The assessment owns this session's 30 s safety timeout through finally.
    check();
    await f6OwnerQuery("ANALYZE provider_verification_jobs, accounts, users, provider_connections, provider_credential_versions");
    const deadline = performance.now() + F6_ASSESSMENT_LIMITS.statisticsWaitMs;
    let after: F6TableStat[];
    for (;;) {
      check();
      after = (await f6OwnerQuery<F6TableStat>(F6_TABLE_STATS_SQL, [F6_ASSESSMENT_TABLES])).rows;
      bundle.statistics.after = after;
      const refreshed = F6_ASSESSMENT_TABLES.every((name) => {
        const old = before.find((row) => row.relname === name);
        const current = after.find((row) => row.relname === name);
        return old && current && current.reltuples > 0 && (BigInt(current.analyze_count) > BigInt(old.analyze_count) || (current.last_analyze !== null && current.last_analyze !== old.last_analyze));
      });
      if (refreshed) break;
      f6Require(performance.now() < deadline, "STATISTICS_INVALID", "refresh not observed for all five tables");
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
    bundle.statistics.after = after;
    bundle.statistics.warnings = warnings;
    f6Require(warnings.length === 0, "STATISTICS_INVALID", "owner ANALYZE emitted a warning");
    // Never retain most_common_vals/histogram_bounds: values could include IDs
    // or secret-bearing columns. Only planner-relevant scheduling/status stats.
    bundle.statistics.columns = (await f6OwnerQuery(`SELECT tablename, attname, null_frac, n_distinct, avg_width, correlation
      FROM pg_stats WHERE schemaname = 'public' AND (tablename = 'provider_verification_jobs_eligible_queue_ix'
        OR (tablename = ANY($1::text[]) AND attname IN ('state','status','account_id','owner_user_id','provider_connection_id','provider_credential_version_id','deferred_until','created_at','lease_fencing_counter')))
      ORDER BY tablename, attname`, [F6_ASSESSMENT_TABLES])).rows;
    const expression = await f6OwnerQuery("SELECT attname FROM pg_stats WHERE schemaname = 'public' AND tablename = 'provider_verification_jobs_eligible_queue_ix'");
    f6Require(expression.rows.length > 0, "STATISTICS_INVALID", "expression-index statistics absent");
    bundle.statistics.relations = (await f6OwnerQuery(`SELECT c.relname, c.relkind, c.reltuples::float8, c.relpages,
      pg_total_relation_size(c.oid)::text AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND (c.relname = ANY($1::text[]) OR c.oid IN
        (SELECT i.indexrelid FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_namespace s ON s.oid=t.relnamespace WHERE s.nspname='public' AND t.relname=ANY($1::text[])))
      ORDER BY c.relname`, [F6_ASSESSMENT_TABLES])).rows;
    bundle.statistics.targets = (await f6OwnerQuery(`SELECT c.relname, a.attname, a.attstattarget FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND (c.relname = ANY($1::text[]) OR c.relname = 'provider_verification_jobs_eligible_queue_ix')
      AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`, [F6_ASSESSMENT_TABLES])).rows;
    bundle.statistics.extended = (await f6OwnerQuery(`SELECT e.stxname AS statistics_name, pg_get_statisticsobjdef(e.oid) AS definition
      FROM pg_statistic_ext e JOIN pg_class c ON c.oid=e.stxrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY e.stxname`, [F6_ASSESSMENT_TABLES])).rows;
  } catch (error) {
    if (error instanceof F6AssessmentError) throw error;
    throw new F6AssessmentError("STATISTICS_INVALID", "owner statistics collection failed");
  } finally {
    clients.migrator.removeListener("notice", notice);
  }
}

function f6PlanStructure(node: F6Tree): object {
  // Only these four estimates are excluded: their sampling/cost variation is
  // not topology or operator behavior. Every other property (including future
  // PostgreSQL fields) is retained. Raw plans retain even these estimates.
  const estimates = new Set(["Startup Cost", "Total Cost", "Plan Rows", "Plan Width"]);
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical); // Child order matters.
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !estimates.has(key)).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]));
    return value;
  };
  return canonical(node) as object;
}
function f6VariationPaths(left: unknown, right: unknown, path = "Plan"): string[] {
  if (JSON.stringify(left) === JSON.stringify(right)) return [];
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object"
    || Array.isArray(left) !== Array.isArray(right)) return [path];
  const l = left as Record<string, unknown>;
  const r = right as Record<string, unknown>;
  return [...new Set([...Object.keys(l), ...Object.keys(r)])].sort()
    .flatMap((key) => key in l && key in r ? f6VariationPaths(l[key], r[key], `${path}.${key}`) : [`${path}.${key}`]);
}
function f6RecordVariations(bundle: F6Bundle): void {
  bundle.variations = [];
  for (let left = 0; left < bundle.captures.length; left += 1) for (let right = left + 1; right < bundle.captures.length; right += 1) {
    const l = bundle.captures[left]!;
    const r = bundle.captures[right]!;
    if (l.structure === null || r.structure === null) continue;
    const paths = f6VariationPaths(l.structure, r.structure);
    if (paths.length) bundle.variations.push({ left: l.ordinal, right: r.ordinal, paths });
  }
}
function f6Classify(plan: F6Tree): { reasons: string[]; nodes: object[] } {
  const reasons: string[] = [];
  const outerChild = (node: F6Tree, path: string): F6Tree | undefined => {
    if (node.Plans?.length !== 1 || node.Plans[0]?.["Parent Relationship"] !== "Outer") {
      reasons.push(`${path}: requires one Outer child`);
      return undefined;
    }
    return node.Plans[0];
  };
  const serial = (node: F6Tree, path: string) => {
    if (node["Parallel Aware"] !== false || node["Async Capable"] === true || Number(node["Workers Planned"] ?? 0) !== 0)
      reasons.push(`${path}: parallel driving path is not accepted`);
  };
  let root = plan;
  while (root["Node Type"] === "Result") {
    serial(root, "Result");
    if (root["One-Time Filter"] !== undefined) reasons.push("Result: unexpected one-time filter");
    const child = outerChild(root, "Result");
    if (!child) break;
    root = child;
  }
  serial(root, "Limit");
  if (root["Node Type"] !== "Limit") reasons.push("root is not Limit");
  const lock = outerChild(root, "Limit");
  if (lock?.["Node Type"] !== "LockRows") reasons.push("Limit child is not LockRows");
  if (lock) serial(lock, "LockRows");
  let driving = lock ? outerChild(lock, "LockRows") : undefined;
  const lifecycle = new Map([["a", "accounts"], ["u", "users"], ["c", "provider_connections"], ["v", "provider_credential_versions"]]);
  const seen = new Set<string>();
  const innerRelation = (node: F6Tree) => {
    let leaf: F6Tree | undefined = node;
    while (leaf && ["Memoize", "Materialize"].includes(leaf["Node Type"])) {
      serial(leaf, "lifecycle wrapper");
      leaf = outerChild(leaf, "lifecycle wrapper");
    }
    if (!leaf || !["Index Scan", "Index Only Scan", "Seq Scan"].includes(leaf["Node Type"])
      || (leaf.Plans?.length ?? 0) !== 0 || lifecycle.get(leaf.Alias ?? "") !== leaf["Relation Name"] || seen.has(leaf.Alias ?? "")) {
      reasons.push("inner branch is not a distinct lifecycle lookup");
      return;
    }
    serial(leaf, "lifecycle lookup");
    seen.add(leaf.Alias!);
  };
  // Only a serial, left-deep INNER nested-loop chain with unique inner
  // lifecycle lookups proves ordered jobs input here. Hash/Merge/Gather and
  // unknown wrappers are conservatively review-required, never descended.
  while (driving?.["Node Type"] === "Nested Loop") {
    serial(driving, "Nested Loop");
    if (driving["Join Type"] !== "Inner" || driving["Inner Unique"] !== true
      || driving.Plans?.length !== 2 || driving.Plans[0]?.["Parent Relationship"] !== "Outer"
      || driving.Plans[1]?.["Parent Relationship"] !== "Inner") {
      reasons.push("join does not prove unique ordered Outer-to-Inner lookup");
      break;
    }
    innerRelation(driving.Plans[1]);
    driving = driving.Plans[0];
  }
  if (seen.size !== lifecycle.size) reasons.push("ordered path does not cover all four lifecycle lookups");
  if (driving) serial(driving, "jobs scan");
  if (driving?.["Node Type"] !== "Index Scan" || driving["Scan Direction"] !== "Forward"
    || driving["Index Name"] !== "provider_verification_jobs_eligible_queue_ix" || driving["Relation Name"] !== "provider_verification_jobs" || driving.Alias !== "j"
    || (driving.Plans?.length ?? 0) !== 0) reasons.push("jobs ordered driving index scan absent");
  if (normaliseCondition(driving?.["Index Cond"] ?? "") !== "COALESCE(deferred_until,created_at)<=now()") reasons.push("driving index range condition differs");
  const nodes: object[] = [];
  const visit = (node: F6Tree, path: string) => {
    nodes.push({ path, ...Object.fromEntries(Object.entries(node).filter(([key]) => key !== "Plans")) });
    if (["Sort", "Incremental Sort"].includes(node["Node Type"])) reasons.push(`${path}: sort`);
    if ((node["Node Type"] === "Bitmap Heap Scan" && node["Relation Name"] === "provider_verification_jobs")
      || (node["Node Type"] === "Bitmap Index Scan" && (node["Index Name"] ?? "").startsWith("provider_verification_jobs_"))) reasons.push(`${path}: jobs bitmap scan`);
    node.Plans?.forEach((child, index) => visit(child, `${path}.Plans[${index}]`));
  };
  visit(plan, "Plan");
  if (allNodes(plan).filter((node) => node["Relation Name"] === "provider_verification_jobs").length !== 1)
    reasons.push("plan must contain exactly one jobs relation scan");
  return { reasons, nodes };
}

const F6_SETTINGS_SQL = `SELECT name, setting, boot_val, reset_val, source, unit FROM pg_settings
 WHERE name LIKE 'enable_%' OR category LIKE 'Query Tuning%'
 OR name IN ('work_mem','hash_mem_multiplier','effective_cache_size','default_statistics_target','shared_buffers',
 'jit','jit_above_cost','jit_inline_above_cost','jit_optimize_above_cost','max_parallel_workers_per_gather',
 'plan_cache_mode','search_path','transaction_isolation','stats_fetch_consistency','TimeZone','statement_timeout','lock_timeout') ORDER BY name`;

function f6SafeSettings(settings: F6Setting[]): F6Setting[] {
  // Numeric settings and fixed PostgreSQL vocabulary only. Reject unknown
  // string settings BEFORE they can enter metadata, including search_path.
  const vocabulary = new Set(["on", "off", "auto", "force_generic_plan", "force_custom_plan", "partition", "cache", "snapshot", "none",
    "read committed", "UTC", "Etc/UTC", "GMT", '"$user", public', "public", "regress"]);
  const sources = new Set(["default", "dynamic default", "environment variable", "configuration file", "command line", "global", "database", "user", "database user", "client", "override", "interactive", "test", "session"]);
  const valueSafe = (value: string | null) => value === null || vocabulary.has(value) || /^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value);
  f6Require(settings.every((row) => /^[a-zA-Z_]+$/.test(row.name) && sources.has(row.source)
    && [row.setting, row.boot_val, row.reset_val].every(valueSafe)
    && (row.unit === null || ["B", "kB", "MB", "GB", "ms", "s", "min", "8kB", "16MB"].includes(row.unit))),
  "CONFIGURATION_INVALID", "non-allowlisted configuration metadata rejected");
  return settings;
}

async function f6Capture(bundle: F6Bundle, scenario: F6Scenario, cohorts: F6Cohorts, check: () => void): Promise<void> {
  const capture: F6Capture = { ordinal: bundle.captures.length + 1, raw: null, settings: [], population: null, classification: null, reasons: [], structure: null, nodes: [], rollback: "pending", cleanup: f6NewCleanup() };
  bundle.captures.push(capture);
  // BEGIN is inside try so even a failed/uncertain BEGIN is followed by ROLLBACK.
  try {
    await f6RuntimeQuery("BEGIN ISOLATION LEVEL READ COMMITTED");
    await f6RuntimeQuery("SET LOCAL statement_timeout = '10s'");
    await f6RuntimeQuery("SET LOCAL lock_timeout = '1s'");
    capture.settings = f6SafeSettings((await f6RuntimeQuery<F6Setting>(F6_SETTINGS_SQL)).rows);
    const methods = capture.settings.filter((setting) => setting.name.startsWith("enable_"));
    f6Require(methods.length > 0 && methods.some((setting) => setting.name === "enable_seqscan" && setting.setting === "on")
      && methods.every((setting) => setting.setting === setting.boot_val), "CONFIGURATION_INVALID", "planner methods differ from PostgreSQL defaults");
    // The cost/memory baseline is recorded, never tuned to obtain a plan.
    const baselineSettings = bundle.manifest.plannerBaseline as F6Setting[] | undefined;
    const stable = capture.settings.filter((setting) => !["statement_timeout", "lock_timeout"].includes(setting.name));
    if (baselineSettings) f6Require(JSON.stringify(stable) === JSON.stringify(baselineSettings), "CONFIGURATION_INVALID", "configuration changed between captures");
    else bundle.manifest.plannerBaseline = stable;
    check();
    await f6Population({ query: f6RuntimeQuery }, scenario, cohorts, (row) => { capture.population = row; });
    const explained = await f6RuntimeQuery<{ "QUERY PLAN": unknown }>(`EXPLAIN (FORMAT JSON) ${bundle.query!.sql}`);
    // Retain raw output before parsing/classifying, including divergent plans.
    capture.raw = explained.rows[0]?.["QUERY PLAN"] ?? null;
    const raw = capture.raw as { Plan?: F6Tree }[] | null;
    f6Require(Array.isArray(raw) && raw.length === 1 && raw[0]?.Plan && typeof raw[0].Plan["Node Type"] === "string", "PLAN_CAPTURE_FAILED", "malformed PostgreSQL JSON plan");
    const classified = f6Classify(raw[0].Plan);
    capture.structure = f6PlanStructure(raw[0].Plan);
    f6RecordVariations(bundle); // Preserve variation evidence even if a later capture fails.
    capture.nodes = classified.nodes;
    capture.reasons = classified.reasons;
    capture.classification = classified.reasons.length ? "PLAN_DIVERGENCE_REVIEW_REQUIRED" : "EXPECTED_ORDERED_PLAN";
    check();
  } catch (error) {
    capture.classification = error instanceof F6AssessmentError ? error.classification : "PLAN_CAPTURE_FAILED";
    capture.reasons.push(error instanceof F6AssessmentError ? error.reason : "inspection statement failed");
    throw error instanceof F6AssessmentError ? error : new F6AssessmentError("PLAN_CAPTURE_FAILED", "inspection statement failed");
  } finally {
    try {
      // Attempt even after a BEGIN/query deadline; this may queue behind an
      // unconfirmed server operation, so it has its own independent deadline.
      await f6Deadline(() => clients.runtime.query("ROLLBACK"), F6_ASSESSMENT_LIMITS.rollbackMs, capture.cleanup, "inspection-rollback");
      capture.rollback = "confirmed";
    } catch {
      capture.rollback = "failed";
    }
    if (capture.rollback !== "confirmed" || !f6SessionsTrusted) {
      capture.cleanup.disposition = "CLEANUP_FAILED";
      capture.classification ??= "PLAN_CAPTURE_FAILED";
      // Never reuse a session whose transaction boundary is uncertain.
      await f6CloseUncertain(clients.runtime, capture.cleanup, "runtime-disconnect");
      throw new F6CleanupError();
    }
    capture.cleanup.disposition = "CONFIRMED";
  }
}

describe.skipIf(!F6_ASSESSMENT_SELECTED)("F6 production-like default-planner assessment (separate acceptance gate)", () => {
  let locked = false;
  let prerequisites: Record<string, unknown> = {};
  beforeAll(async (_context, suite) => {
    // 1. Resource admission: record the evidence, then reject unconditionally.
    // This precedes every database connection and mutation; no handle exists
    // on this selected path while R1 is blocked, and no bypass is implemented.
    Object.assign(suite.meta, { f6ResourceAdmission: F6_RESOURCE_ADMISSION });
    f6RequireResourceAdmission();
    // 2-3. Explicit attestations supplement, never replace, openGuardedClients.
    f6Require(process.env.COMMERCIAL_API_F6_ASSESSMENT_AUTHORIZED === "YES"
      && process.env.COMMERCIAL_API_F6_TEST_DATABASE_EXCLUSIVE === "YES"
      && process.env.COMMERCIAL_API_F6_TEST_DATABASE_DEDICATED === "YES", "SAFETY_GATE_FAILED", "explicit assessment authorization and dedicated/exclusive database attestations required");
    f6Require(process.env.WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED === "NO"
      && ["RUNWAYML_API_SECRET", "GEMINI_API_KEY", "GOOGLE_API_KEY"].every((key) => !process.env[key]), "SAFETY_GATE_FAILED", "live-provider safe-suite guard failed");
    // 4. Git preflight from the repository root (five levels above tests/db/f6).
    const git = (...args: string[]) => execFileSync("git", args, { cwd: new URL("../../../../../", import.meta.url), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    try {
      const head = git("rev-parse", "HEAD");
      f6Require(head === F6_ASSESSMENT_BASELINE && git("branch", "--show-current") === "master"
        && git("diff", "--cached", "--name-only") === "", "SAFETY_GATE_FAILED", "required baseline, branch or empty index gate failed");
      const tracked = git("diff", "--name-only").split(/\r?\n/).filter(Boolean);
      // Allowlist preserved as authored (fail-closed). It predates this
      // module's isolation and must be re-reviewed together with the baseline.
      f6Require(tracked.every((path) => path === "apps/commercial-api/tests/db/workerProviderVerificationDeferral.test.ts"), "SAFETY_GATE_FAILED", "unexpected tracked modifications");
      prerequisites = { head, branch: "master", tracked, host: { platform: platform(), cores: cpus().length, totalMemoryBytes: totalmem(), freeMemoryBytes: freemem() },
        storage: { mode: "GUARDED_LOOPBACK", accounting: "UNAVAILABLE", enforcement: "UNAVAILABLE" }, limits: F6_ASSESSMENT_LIMITS,
        attestations: { authorized: true, exclusive: true, dedicated: true, liveDisabled: true } };
    } catch (error) {
      throw error instanceof F6AssessmentError ? error : new F6AssessmentError("SAFETY_GATE_FAILED", "Git preflight unavailable");
    }
    // 5. First database connection: the existing guarded identity contract
    // (approved database, both approved roles, minimum server version).
    clients = await openGuardedClients();
    clientsOpened = true;
    // 6. Assessment exclusion before any pool or schema work.
    const lock = await f6OwnerQuery<{ acquired: boolean }>("SELECT pg_try_advisory_lock(4411, 6) AS acquired");
    locked = lock.rows[0]?.acquired === true;
    f6Require(locked, "SAFETY_GATE_FAILED", "assessment advisory exclusion unavailable");
    // Other existing suites do not share this advisory key; external exclusive
    // scheduling remains mandatory and cannot be inferred from this lock.
    // 7. Runtime pool (poolMax 12 of the 14-connection ceiling).
    const config = loadRuntimeDatabaseConfig({ COMMERCIAL_API_DATABASE_URL: clients.config.runtimeUrl, COMMERCIAL_API_DATABASE_POOL_MAX: "12" }, "development");
    pool = await createRuntimePool(config!, () => {});
    poolOpened = true;
  });
  beforeEach(async (context) => {
    Object.assign(context.task.meta, { f6ResourceAdmission: F6_RESOURCE_ADMISSION });
    f6RequireResourceAdmission(); // Before prepareSchemaV1's first DROP/write.
    f6Require(clientsOpened && poolOpened && locked, "SAFETY_GATE_FAILED", "assessment lifecycle was not admitted");
    // Existing guarded reset: identity re-check, drop, committed migrations, grants.
    await prepareSchemaV1(clients);
  });
  afterAll(async (_context, suite) => {
    // This suite's own teardown; no ordinary regression hook is involved.
    // Fixture cleanup already ran per scenario (f6CleanupScenario). Closing a
    // session also releases its advisory lock, so close is always attempted.
    const cleanup = f6NewCleanup();
    Object.assign(suite.meta, { f6SuiteCleanup: cleanup });
    try {
      if (locked && f6SessionsTrusted) await f6Deadline(() => clients.migrator.query("SELECT pg_advisory_unlock(4411, 6)"), F6_ASSESSMENT_LIMITS.controlMs, cleanup, "advisory-unlock");
    } catch { cleanup.disposition = "CLEANUP_FAILED"; }
    locked = false;
    if (poolOpened) {
      poolOpened = false;
      try { await f6Deadline(() => pool.end(), F6_ASSESSMENT_LIMITS.closeMs, cleanup, "pool-disconnect"); }
      catch { cleanup.disposition = "CLEANUP_FAILED"; }
    }
    if (clientsOpened) {
      clientsOpened = false;
      try { await f6Deadline(() => clients.close(), F6_ASSESSMENT_LIMITS.closeMs, cleanup, "session-disconnect"); }
      catch { cleanup.disposition = "CLEANUP_FAILED"; }
    }
    if (cleanup.disposition === "CLEANUP_FAILED") throw new F6CleanupError();
    if (cleanup.steps.length) cleanup.disposition = "CONFIRMED";
  });

  for (const scenario of F6_SCENARIOS) {
    it(`${scenario.id}: captures three exact-query default plans with verified workload and statistics`, async (testContext) => {
      const started = performance.now();
      f6DispatchDeadline = started + scenario.timeoutMs - 180_000;
      let futureStarted: number | undefined;
      const bundle: F6Bundle = {
        schema: "busybookie.r44b11g.f6-plan-evidence/v1", assessmentAccepted: false, outcome: null, manifest: { ...prerequisites, scenario }, query: null, statistics: {}, setup: { sequences: [], clockSamples: [] }, captures: [], classifications: [],
        cleanup: f6NewCleanup(), variations: [],
        review: { executionBenchmark: false, productionAcceptance: false, destination: null, openRequirements: [
          "Authorize and independently verify OS/container CPU and memory limits, total database-volume/WAL quotas and a cancellation supervisor before removing RESOURCE_ENFORCEMENT_UNAVAILABLE.",
          "Separately authorize guarded database execution, migrations/grants/reset and cleanup.",
          "Authorize an artifact destination and reporter before durable bundle export; metadata alone is not a retained bundle.",
          "Validate production distributions, row widths, hardware/configuration and performance objectives independently.",
          "Authorize any execution benchmark separately; no EXPLAIN ANALYZE is used here.",
        ] },
      };
      // Serializable, versioned task metadata only: no filesystem writer or URL.
      Object.assign(testContext.task.meta, { f6PlanEvidence: bundle });
      const cohorts: F6Cohorts = { past: [], future: [], never: [], leased: [], cancelled: [], ineligible: [] };
      const check = () => {
        f6TrustSession();
        // Reserve draining and session cleanup time before Vitest's hard limit.
        f6Require(performance.now() - started < scenario.timeoutMs - 180_000, "SETUP_WINDOW_EXCEEDED", "scenario deadline reached");
        f6Require(futureStarted === undefined || performance.now() - futureStarted < F6_ASSESSMENT_LIMITS.futureWindowMs, "SETUP_WINDOW_EXCEEDED", "end-to-end first-deferral window exceeded");
      };
      let previousClock: string | undefined;
      let previousMonotonic: number | undefined;
      const clock = async () => {
        check();
        const sample = await f6OwnerQuery<{ at: string; elapsed_ms: number | null }>(`SELECT clock_timestamp()::text AS at,
          extract(epoch FROM clock_timestamp() - $1::timestamptz)::float8 * 1000 AS elapsed_ms`, [previousClock ?? null]);
        const row = sample.rows[0]!;
        const monotonic = performance.now();
        if (row.elapsed_ms !== null && previousMonotonic !== undefined) f6Require(row.elapsed_ms >= 0
          && Math.abs(row.elapsed_ms - (monotonic - previousMonotonic)) <= F6_ASSESSMENT_LIMITS.futureMarginSeconds * 1000,
        "SETUP_WINDOW_EXCEEDED", "server clock reversal or abnormal elapsed-time jump");
        (bundle.setup.clockSamples as object[]).push({ ...row, monotonicMs: monotonic - started });
        previousClock = row.at;
        previousMonotonic = monotonic;
      };
      const growth = async () => {
        check();
        const row = (await f6OwnerQuery<{ bytes: string }>("SELECT coalesce(sum(pg_total_relation_size(relid)),0)::text AS bytes FROM pg_stat_user_tables WHERE schemaname = 'public'")).rows[0]!;
        bundle.setup.relationBytes = row.bytes;
        const baseline = Number(bundle.setup.initialRelationBytes ?? row.bytes);
        bundle.setup.initialRelationBytes ??= row.bytes;
        f6Require(Number(row.bytes) - baseline <= F6_ASSESSMENT_LIMITS.growthBytes, "SAFETY_GATE_FAILED", "incremental relation growth exceeded 2 GiB");
        await clock();
      };
      try {
        f6RequireResourceAdmission(); // Defense in depth; never an env bypass.
        await f6OwnerQuery("SET statement_timeout = '30s'");
        await f6OwnerQuery("SET lock_timeout = '1s'");
        await growth();
        const migrations = await discoverMigrations();
        const applied = (await f6OwnerQuery<{ version: number; sha256: string }>("SELECT version, sha256 FROM schema_migrations ORDER BY version")).rows;
        f6Require(JSON.stringify(applied) === JSON.stringify(migrations.map(({ version, sha256 }) => ({ version, sha256 })))
          && migrations.at(-1)?.version === 11, "SAFETY_GATE_FAILED", "migration manifest/checksum mismatch");
        bundle.manifest.migrations = applied;
        // Relocated inputs: the lease service, this assessment module and the
        // regression file that still holds the original forced-index F6.
        bundle.manifest.inputHashes = await Promise.all(["../../../src/workerControl/workerProviderVerificationLeaseService.ts", "./defaultPlannerAssessment.heavyweight.ts", "../workerProviderVerificationDeferral.test.ts"].map(async (path) => ({ path, sha256: sha256Hex(await readFile(new URL(path, import.meta.url), "utf8")) })));
        const guards = (await f6OwnerQuery<{ tgname: string; tgenabled: string }>("SELECT tgname,tgenabled FROM pg_trigger WHERE tgrelid = 'provider_verification_jobs'::regclass AND NOT tgisinternal ORDER BY tgname")).rows;
        f6Require(["provider_verification_jobs_deferral_guard", "provider_verification_jobs_guard"].every((name) => guards.some((row) => row.tgname === name && row.tgenabled === "O")), "SAFETY_GATE_FAILED", "job guards missing or disabled");
        bundle.manifest.triggers = guards;
        const indexes = (await f6OwnerQuery<{ indexname: string; indexdef: string }>("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY indexname", [F6_ASSESSMENT_TABLES])).rows;
        bundle.manifest.indexes = indexes;
        f6Require(indexes.some((row) => row.indexname === "provider_verification_jobs_eligible_queue_ix"
          && /COALESCE\(deferred_until, created_at\)/.test(row.indexdef) && /WHERE.*state.*QUEUED/.test(row.indexdef)), "SAFETY_GATE_FAILED", "eligible partial expression index missing");
        bundle.manifest.server = (await f6OwnerQuery("SELECT version() AS version, current_database() AS database, current_user AS owner, current_setting('server_version_num') AS version_num")).rows[0];
        const total = scenario.past + scenario.future + scenario.never + scenario.leased + scenario.cancelled;
        bundle.setup.fixtureWritesStarted = true;
        const tenants = await f6Tenants(scenario.id === "K" ? 100 : total, scenario.id === "K", check, growth);
        const valid = f6FixtureRows(tenants, total, 0, scenario.id === "K");
        const cancelled = valid.slice(0, scenario.cancelled);
        await f6InsertRows(cancelled, check, growth);
        await f6OwnerQuery("UPDATE provider_connections SET status = 'DISCONNECTED', disconnected_at = now() WHERE id = ANY($1::uuid[])", [cancelled.map((row) => row.connectionId)]);
        const reconciliation = await reconcileProviderVerificationJobs(f6BoundedPool(pool, check), { correlationId: randomUUID(), batchSize: 100 });
        f6Require(reconciliation.cancelledJobs === scenario.cancelled && reconciliation.requeuedJobs === 0 && reconciliation.completedJobs === 0, "SETUP_INVALID", "terminal fixture reconciliation mismatch");
        cohorts.cancelled = cancelled.map((row) => row.jobId);
        const invalid: F6Fixture[] = [];
        if (scenario.id === "K") for (let group = 1; group <= 4; group += 1) {
          const rows = f6FixtureRows(tenants, 1000, group, true);
          await f6InsertRows(rows, check, growth);
          await f6Ineligible(rows, check, growth);
          invalid.push(...rows);
        }
        cohorts.ineligible = invalid.map((row) => row.jobId);
        const open = valid.slice(scenario.cancelled);
        await f6InsertRows(open, check, growth);
        await growth();
        const mappings = [...valid, ...invalid];
        await f6Chunks(mappings, async (chunk) => {
          check();
          const mapped = (await f6OwnerQuery<{ n: number }>(`SELECT count(*)::int AS n FROM
            unnest($1::uuid[],$2::uuid[],$3::uuid[],$4::uuid[],$5::uuid[]) t(j,a,u,c,v)
            JOIN provider_verification_jobs q ON q.id=t.j AND q.account_id=t.a AND q.requested_by_user_id=t.u AND q.provider_connection_id=t.c AND q.provider_credential_version_id=t.v
            JOIN accounts a ON a.id=t.a AND a.owner_user_id=t.u JOIN provider_connections c ON c.id=t.c AND c.account_id=t.a
            JOIN provider_credential_versions v ON v.id=t.v AND v.account_id=t.a AND v.provider_connection_id=t.c`,
          [chunk.map((row) => row.jobId), chunk.map((row) => row.accountId), chunk.map((row) => row.userId), chunk.map((row) => row.connectionId), chunk.map((row) => row.versionId)])).rows[0]!;
          f6Require(mapped.n === chunk.length, "SETUP_INVALID", "account-sharing mapping mismatch");
        });
        const histogram = (await f6OwnerQuery<{ account_id: string; jobs: number }>("SELECT account_id,count(*)::int AS jobs FROM provider_verification_jobs GROUP BY account_id ORDER BY jobs DESC,account_id")).rows;
        f6Require(histogram.length === tenants.length, "SETUP_INVALID", "tenant cardinality mismatch");
        const expectedHistogram = new Map<string, number>();
        for (const row of mappings) expectedHistogram.set(row.accountId, (expectedHistogram.get(row.accountId) ?? 0) + 1);
        f6Require(histogram.every((row) => expectedHistogram.get(row.account_id) === row.jobs), "SETUP_INVALID", "tenant histogram differs from fixture assignment");
        // Anonymize tenant IDs in evidence while preserving the full histogram.
        const tenantOrdinal = new Map(tenants.map((tenant, index) => [tenant.accountId, index]));
        bundle.setup.tenantHistogram = histogram.map((row) => ({ tenant: tenantOrdinal.get(row.account_id), jobs: row.jobs }));
        const hotIds = new Set(tenants.filter((tenant) => tenant.hot).map((tenant) => tenant.accountId));
        const hotJobs = histogram.filter((row) => hotIds.has(row.account_id)).reduce((sum, row) => sum + row.jobs, 0);
        bundle.setup.tenantSkew = { accounts: tenants.length, hotAccounts: hotIds.size, hotJobs, totalJobs: mappings.length };
        f6Require(scenario.id !== "K" || (hotIds.size === 10 && hotJobs * 5 === mappings.length * 4), "SETUP_INVALID", "hot-tenant share mismatch");
        if (invalid.length) {
          const lifecycle = (await f6OwnerQuery<{ cohort: number; rows: number; valid: boolean }>(`SELECT t.g AS cohort,count(*)::int AS rows,
            bool_and(CASE t.g
              WHEN 1 THEN a.status='DISABLED' AND u.status='ACTIVE' AND c.status='PENDING_VERIFICATION' AND v.status='ACTIVE'
              WHEN 2 THEN a.status='ACTIVE' AND u.status='DISABLED' AND c.status='PENDING_VERIFICATION' AND v.status='ACTIVE'
              WHEN 3 THEN a.status='ACTIVE' AND u.status='ACTIVE' AND c.status IN ('DISCONNECTED','DISABLED') AND v.status='ACTIVE'
              WHEN 4 THEN a.status='ACTIVE' AND u.status='ACTIVE' AND c.status='PENDING_VERIFICATION' AND v.status='SUPERSEDED'
              ELSE false END AND j.state='QUEUED' AND j.unsupported_deferral_count=0) AS valid
            FROM unnest($1::uuid[],$2::int[]) t(id,g) JOIN provider_verification_jobs j ON j.id=t.id
            JOIN accounts a ON a.id=j.account_id JOIN users u ON u.id=a.owner_user_id
            JOIN provider_connections c ON c.id=j.provider_connection_id JOIN provider_credential_versions v ON v.id=j.provider_credential_version_id
            GROUP BY t.g ORDER BY t.g`, [invalid.map((row) => row.jobId), invalid.map((row) => row.group)])).rows;
          bundle.setup.lifecycleCohorts = lifecycle;
          f6Require(lifecycle.length === 4 && lifecycle.every((row, index) => row.cohort === index + 1 && row.rows === 1000 && row.valid), "SETUP_INVALID", "lifecycle-skew cohort facts mismatch");
          const connections = (await f6OwnerQuery<{ status: string; rows: number }>(`SELECT c.status,count(*)::int AS rows
            FROM provider_connections c WHERE c.id=ANY($1::uuid[]) GROUP BY c.status ORDER BY c.status`, [invalid.filter((row) => row.group === 3).map((row) => row.connectionId)])).rows;
          bundle.setup.ineligibleConnectionStates = connections;
          f6Require(connections.length === 2 && connections.every((row) => row.rows === 500), "SETUP_INVALID", "connection-state split differs from 500/500");
        }
        const [worker] = await workers(1);
        const context = contextOf(worker!);
        const recorded = new Set<string>();
        let stopSeeding = false;
        let futureSeeding = false;
        const seedCheck = () => {
          check();
          f6Require(!stopSeeding, "SETUP_INVALID", "seeding stopped after a peer failure");
          f6Require(!futureSeeding || performance.now() - futureStarted! < F6_ASSESSMENT_LIMITS.futureSeedMs,
            "SETUP_WINDOW_EXCEEDED", "future seeding exceeded 150 seconds");
        };
        const boundedPool = f6BoundedPool(pool, seedCheck);
        const observedPool = recordingPool(boundedPool, recorded);
        const used = new Set<string>();
        const openIds = new Set(open.map((row) => row.jobId));
        const seed = async (future: boolean) => {
          const sequenceStarted = performance.now();
          try {
            const acquired = await acquireProviderVerificationLease(observedPool, context);
            f6Require(acquired && openIds.has(acquired.providerVerificationJobId) && !used.has(acquired.providerVerificationJobId), "SETUP_INVALID", "lease was missing, outside cohort or repeated");
            used.add(acquired.providerVerificationJobId);
            if (future) await deferUnsupportedProviderVerification(boundedPool, context, acquired.providerVerificationJobId, proofOf(acquired), "UNSUPPORTED_PROVIDER");
            else await deferUnsupportedProviderVerification(boundedPool, context, acquired.providerVerificationJobId, proofOf(acquired), "UNSUPPORTED_PROVIDER", () => 1);
            (future ? cohorts.future : cohorts.past).push(acquired.providerVerificationJobId);
            (bundle.setup.sequences as object[]).push({ cohort: future ? "future" : "past", elapsedMs: performance.now() - sequenceStarted, deferralCommitted: true });
          } catch (error) {
            stopSeeding = true;
            (bundle.setup.sequences as object[]).push({ cohort: future ? "future" : "past", elapsedMs: performance.now() - sequenceStarted, deferralCommitted: false });
            throw error;
          }
        };
        await f6Drain(scenario.past, check, () => seed(false));
        const ordering = (await f6OwnerQuery<{ valid: boolean }>(`SELECT
          (SELECT max(created_at) FROM provider_verification_jobs WHERE id = ANY($1::uuid[])) <
          (SELECT min(deferred_until) FROM provider_verification_jobs WHERE id = ANY($2::uuid[])) AS valid`, [open.map((row) => row.jobId), cohorts.past])).rows[0]!;
        f6Require(ordering.valid, "SETUP_INVALID", "original jobs do not all precede the short-deferral keys");
        bundle.setup.originalCreationPrecedesDeferrals = ordering.valid;
        await growth();
        futureStarted = performance.now(); // Conservative: before first lease/deferral transaction.
        futureSeeding = true;
        await f6Drain(scenario.future, () => {
          check();
          f6Require(performance.now() - futureStarted! < F6_ASSESSMENT_LIMITS.futureSeedMs, "SETUP_WINDOW_EXCEEDED", "future seeding exceeded 150 seconds");
        }, () => seed(true));
        futureSeeding = false;
        bundle.setup.futureSeedingMs = performance.now() - futureStarted;
        for (let index = 0; index < scenario.leased; index += 1) {
          check();
          const acquired = await acquireProviderVerificationLease(observedPool, context);
          f6Require(acquired && openIds.has(acquired.providerVerificationJobId) && !used.has(acquired.providerVerificationJobId), "SETUP_INVALID", "final leased cohort mismatch");
          used.add(acquired.providerVerificationJobId);
          cohorts.leased.push(acquired.providerVerificationJobId);
        }
        cohorts.never = open.filter((row) => !used.has(row.jobId)).map((row) => row.jobId);
        f6Require(cohorts.never.length === scenario.never && cohorts.past.length === scenario.past && cohorts.future.length === scenario.future, "SETUP_INVALID", "seed cohort cardinality mismatch");
        const selections = [...recorded].filter((sql) => sql.includes("FOR UPDATE OF j SKIP LOCKED"));
        f6Require(selections.length === 1 && f6SqlCanonical(selections[0]!) === f6SqlCanonical(F6_SELECT_CONTRACT), "PLAN_CAPTURE_FAILED", "recorded SELECT_NEXT differs from complete production-query contract");
        bundle.query = { sql: selections[0]!, sha256: sha256Hex(selections[0]!) };
        bundle.setup.cohorts = Object.fromEntries(Object.entries(cohorts).map(([name, ids]) => [name, { rows: ids.length, distinctIds: new Set(ids).size }]));
        const past = (await f6OwnerQuery<{ at: string }>("SELECT max(deferred_until)::text AS at FROM provider_verification_jobs WHERE id = ANY($1::uuid[])", [cohorts.past])).rows[0]!;
        const waitDeadline = performance.now() + F6_ASSESSMENT_LIMITS.pastWaitMs;
        for (;;) {
          check();
          if ((await f6OwnerQuery<{ past: boolean }>("SELECT clock_timestamp() > $1::timestamptz AS past", [past.at])).rows[0]!.past) break;
          f6Require(performance.now() < waitDeadline, "SETUP_WINDOW_EXCEEDED", "past deferrals did not expire within bounded wait");
          await new Promise<void>((resolve) => setTimeout(resolve, 20));
        }
        await f6Population({ query: f6OwnerQuery }, scenario, cohorts, (row) => { bundle.setup.populationBeforeStatistics = row; });
        await growth();
        await f6Statistics(bundle, check);
        for (let index = 0; index < F6_ASSESSMENT_LIMITS.captures; index += 1) {
          await clock();
          await f6Capture(bundle, scenario, cohorts, check);
          await clock();
          const margin = (await f6OwnerQuery<{ valid: boolean; remaining_seconds: number }>(`SELECT bool_and(deferred_until > clock_timestamp() + interval '30 seconds') AS valid,
            extract(epoch FROM min(deferred_until) - clock_timestamp())::float8 AS remaining_seconds FROM provider_verification_jobs WHERE id = ANY($1::uuid[])`, [cohorts.future])).rows[0]!;
          bundle.setup.lastFutureMargin = margin;
          f6Require(margin.valid, "SETUP_WINDOW_EXCEEDED", "future cohort margin failed after inspection");
        }
        await f6Population({ query: f6OwnerQuery }, scenario, cohorts, (row) => { bundle.setup.finalPopulation = row; });
        await growth();
        f6RecordVariations(bundle);
        const structures = new Set(bundle.captures.map((capture) => JSON.stringify(capture.structure)));
        if (structures.size !== 1) bundle.classifications.push({ classification: "PLAN_VARIATION_REVIEW_REQUIRED", reason: "repeated plan structures differ" });
        for (const capture of bundle.captures) bundle.classifications.push({ classification: capture.classification!, reason: capture.reasons.join("; ") || "default plan satisfies unchanged F6 structural criteria" });
        f6Require(structures.size === 1, "PLAN_VARIATION_REVIEW_REQUIRED", "repeated plan structures differ");
        f6Require(bundle.captures.every((capture) => capture.classification === "EXPECTED_ORDERED_PLAN" && capture.rollback === "confirmed"), "PLAN_DIVERGENCE_REVIEW_REQUIRED", "unexpected default plan retained for independent review");
        bundle.outcome = "EXPECTED_ORDERED_PLAN";
      } catch (error) {
        if (error instanceof F6CleanupError) {
          bundle.cleanup.disposition = "CLEANUP_FAILED";
          // Keep the primary inspection classification alongside cleanup's
          // separate disposition; never replace it with a tenth primary code.
          const primary = bundle.captures.at(-1)?.classification;
          bundle.outcome = primary && primary !== "EXPECTED_ORDERED_PLAN" ? primary : "PLAN_CAPTURE_FAILED";
          bundle.classifications.push({ classification: bundle.outcome, reason: "inspection cleanup failed; see separate CLEANUP_FAILED disposition" });
          throw error;
        }
        const failure = f6Failure(error, "SETUP_INVALID", "fixture or service operation failed");
        bundle.outcome = failure.classification;
        bundle.classifications.push({ classification: failure.classification, reason: failure.reason });
        throw failure;
      } finally {
        bundle.setup.elapsedMs = performance.now() - started;
        bundle.setup.firstFutureToEndMs = futureStarted === undefined ? null : performance.now() - futureStarted;
        // Drain first, never reset a schema with uncertain work. Session safety
        // timeouts remain enabled throughout bounded cleanup; no RESET-to-zero.
        await f6CleanupScenario(bundle);
        bundle.assessmentAccepted = bundle.outcome === "EXPECTED_ORDERED_PLAN" && bundle.cleanup.disposition !== "CLEANUP_FAILED"
          && bundle.captures.length === F6_ASSESSMENT_LIMITS.captures && bundle.captures.every((capture) => capture.cleanup.disposition === "CONFIRMED");
      }
    }, scenario.timeoutMs);
  }
});
