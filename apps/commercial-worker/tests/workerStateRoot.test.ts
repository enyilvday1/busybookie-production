import { lstat as realLstat, mkdir, mkdtemp, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { nodeJournalFileSystem, type AcceptanceInput, type JournalFileSystem } from "../src/acceptanceJournal.js";
import type { CredentialOpeningClient, WorkerLogEvent } from "../src/credentialOpeningRun.js";
import type { WorkerAcceptanceRecoveryResult } from "../src/workerControlClient.js";
import { PRODUCTION_WORKER_STATE_ROOT, type WorkerConfig } from "../src/workerConfig.js";
import {
  assertWorkerStateRoot,
  bindWorkerStateRoot,
  runConfiguredCredentialOpeningOnce,
  selectDirectorySync,
  type WorkerStateRootHost,
} from "../src/workerStateRoot.js";
import { WorkerError } from "../src/workerError.js";
import { fakeRecoveryTime } from "./support/fakeRecoveryTime.js";
import { createTestCredentialOpener, generateTestKey } from "./support/testCredentialOpening.js";

// R44B8: the application half of the state-root binding (architecture
// section 17, "State-root binding", R44B8A). Real temporary directories stand
// in for operator-provisioned roots; a fake control-plane client records
// every request, so "before any lease" is observed, not assumed. Production
// host facts (Linux, effective UID, owner-only mode) are injected, so the
// suite does not depend on the developer machine's OS or UID. No network, no
// control plane, no provider.

const opener = createTestCredentialOpener(generateTestKey("state-root/v1"));
const ATTEMPT = "11111111-2222-4333-8444-555555555555";
const RECORD: AcceptanceInput = Object.freeze({
  executionAttemptId: ATTEMPT,
  executionJobId: "66666666-7777-4888-9999-aaaaaaaaaaaa",
  accountId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  attemptNumber: 1,
  fencingCounter: 3,
  provider: "EXAMPLE_PROVIDER",
  generationRequestSha256: "c".repeat(64),
  submittingAt: new Date("2026-11-11T10:00:00.000Z"),
  providerExecutionId: "synthetic/operations/state-root",
  providerAcceptedAt: new Date("2026-11-11T10:00:01.000Z"),
});

let scratch: string;
let root: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), "bb-worker-state-root-"));
  root = join(scratch, "operator-provisioned-root");
  await mkdir(root);
});
afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const development = (stateRoot: string): WorkerConfig => Object.freeze({ mode: "development", stateRoot });
const PRODUCTION: WorkerConfig = Object.freeze({ mode: "production", stateRoot: PRODUCTION_WORKER_STATE_ROOT });

// Directory links that need no privilege on Windows (junctions); plain symlinks elsewhere.
const linkDirectory = (target: string, path: string) => symlink(target, path, "junction");

// A recording control-plane client: any call at all is visible.
function recordingClient(recovery: readonly (WorkerAcceptanceRecoveryResult | WorkerError)[] = []) {
  const calls: string[] = [];
  let recovered = 0;
  const client: CredentialOpeningClient = {
    leaseNextAttempt: async () => {
      calls.push("lease");
      return null;
    },
    requestCredentialGrant: async () => {
      calls.push("grant");
      throw new Error("unexpected grant");
    },
    recoverAcceptance: async () => {
      calls.push("recovery");
      const step = recovery[recovered++];
      if (step === undefined) throw new Error("unexpected recovery");
      if (step instanceof WorkerError) throw step;
      return step;
    },
  } as CredentialOpeningClient;
  return { client, calls };
}

const codeOf = async (promise: Promise<unknown>, secrets: readonly string[] = []) => {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(WorkerError);
  const text = `${(error as Error).message} ${JSON.stringify(error)}`;
  for (const secret of secrets) expect(text.includes(secret)).toBe(false);
  return (error as WorkerError).code;
};

function run(config: WorkerConfig, options: Readonly<{ host?: WorkerStateRootHost; journalFileSystem?: JournalFileSystem; recovery?: readonly (WorkerAcceptanceRecoveryResult | WorkerError)[] }> = {}) {
  const { client, calls } = recordingClient(options.recovery);
  const events: WorkerLogEvent[] = [];
  const time = fakeRecoveryTime();
  const result = runConfiguredCredentialOpeningOnce(config, {
    environment: {},
    client,
    opener,
    monotonicNow: time.monotonicNow,
    sleep: time.sleep,
    log: (event) => events.push(event),
    ...(options.host === undefined ? {} : { host: options.host }),
    ...(options.journalFileSystem === undefined ? {} : { journalFileSystem: options.journalFileSystem }),
  });
  return { result, calls, events };
}

// A journal filesystem that records every path it is given.
function recordingFileSystem(overrides: Partial<JournalFileSystem> = {}) {
  const paths: string[] = [];
  const record =
    <A extends unknown[], R>(fn: (path: string, ...rest: A) => R) =>
    (path: string, ...rest: A): R => {
      paths.push(path);
      return fn(path, ...rest);
    };
  const fileSystem: JournalFileSystem = {
    ...nodeJournalFileSystem,
    makeDirectory: record(nodeJournalFileSystem.makeDirectory),
    openExclusive: record(nodeJournalFileSystem.openExclusive),
    isDirectory: record(nodeJournalFileSystem.isDirectory),
    readDirectory: record(nodeJournalFileSystem.readDirectory),
    ...overrides,
  };
  return { fileSystem, paths };
}

// ---------------------------------------------------------------------------
// Production: the canonical Linux root, mapped onto a temporary directory.

const CANONICAL = PRODUCTION_WORKER_STATE_ROOT;
const remap = (path: string) => {
  const normalized = path.split("\\").join("/");
  if (normalized === CANONICAL || normalized.startsWith(`${CANONICAL}/`)) return `${root}${normalized.slice(CANONICAL.length)}`;
  throw new Error("path outside the canonical root");
};

type ProductionFacts = Readonly<{ platform?: string; effectiveUid?: number | undefined; rootUid?: number; rootMode?: number }>;

function productionHost(facts: ProductionFacts = {}): WorkerStateRootHost {
  const effectiveUid = "effectiveUid" in facts ? facts.effectiveUid : 1000;
  return {
    platform: facts.platform ?? "linux",
    effectiveUid: () => effectiveUid,
    lstat: async (path) => {
      const real = await realLstat(remap(path));
      const isRoot = path.split("\\").join("/") === CANONICAL;
      return {
        isDirectory: () => real.isDirectory(),
        isSymbolicLink: () => real.isSymbolicLink(),
        uid: facts.rootUid ?? 1000,
        mode: isRoot ? (facts.rootMode ?? 0o40700) : 0o40700,
      };
    },
  };
}

// The journal on the canonical path, served from the temporary root; the
// directory flush is simulated (Linux) or failed on demand.
function productionFileSystem(directorySync: "OK" | "FAIL" = "OK"): JournalFileSystem {
  const map =
    <A extends unknown[], R>(fn: (path: string, ...rest: A) => R) =>
    (path: string, ...rest: A): R =>
      fn(remap(path), ...rest);
  return {
    openExclusive: map(nodeJournalFileSystem.openExclusive),
    openDirectory: async () => {
      if (directorySync === "FAIL") throw Object.assign(new Error("fsync unsupported"), { code: "EINVAL" });
      return { sync: async () => undefined, close: async () => undefined };
    },
    link: (existing, target) => nodeJournalFileSystem.link(remap(existing), remap(target)),
    unlink: map(nodeJournalFileSystem.unlink),
    readFile: map(nodeJournalFileSystem.readFile),
    makeDirectory: map(nodeJournalFileSystem.makeDirectory),
    chmod: map(nodeJournalFileSystem.chmod),
    isDirectory: map(nodeJournalFileSystem.isDirectory),
    readDirectory: map(nodeJournalFileSystem.readDirectory),
  };
}

// ---------------------------------------------------------------------------

describe("directory-sync selection", () => {
  it("is REQUIRED in production on every platform, and best effort only for Windows development", () => {
    for (const platform of ["linux", "win32", "darwin", "freebsd"]) expect(selectDirectorySync("production", platform)).toBe("REQUIRED");
    expect(selectDirectorySync("development", "win32")).toBe("DEVELOPMENT_BEST_EFFORT");
    expect(selectDirectorySync("development", "linux")).toBe("REQUIRED");
    expect(selectDirectorySync("development", "darwin")).toBe("REQUIRED");
  });
});

describe("state-root path and shape", () => {
  it.each([
    ["a relative root", "relative/worker-state"],
    ["a dot-relative root", "./worker-state"],
    ["a root with a '..' segment", "/srv/worker/../worker-state"],
    ["a root containing NUL", "/srv/worker\0state"],
    ["an empty root", ""],
  ])("refuses %s before any request", async (_label, stateRoot) => {
    const attempt = run(development(stateRoot));
    expect(await codeOf(attempt.result)).toBe("STATE_ROOT_UNSUITABLE");
    expect(attempt.calls).toEqual([]);
  });

  it("refuses a root that does not exist, and never creates it", async () => {
    const missing = join(scratch, "not-provisioned");
    const attempt = run(development(missing));
    expect(await codeOf(attempt.result, [missing])).toBe("STATE_ROOT_UNSUITABLE");
    expect(attempt.calls).toEqual([]);
    await expect(stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
    expect(attempt.events).toEqual([{ stage: "STARTUP", outcome: "FAILED", code: "STATE_ROOT_UNSUITABLE" }]);
  });

  it("refuses a regular file in place of the root", async () => {
    const file = join(scratch, "a-file");
    await writeFile(file, "not a directory");
    const attempt = run(development(file));
    expect(await codeOf(attempt.result)).toBe("STATE_ROOT_UNSUITABLE");
    expect(attempt.calls).toEqual([]);
  });

  it("refuses a root that is itself a link", async () => {
    const linked = join(scratch, "root-link");
    await linkDirectory(root, linked);
    const attempt = run(development(linked));
    expect(await codeOf(attempt.result, [linked])).toBe("STATE_ROOT_UNSUITABLE");
    expect(attempt.calls).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    ["acceptance-journal", ["acceptance-journal"]],
    ["acceptance-journal/v1", ["acceptance-journal", "v1"]],
    ["acceptance-journal/quarantine", ["acceptance-journal", "quarantine"]],
  ] as const)("refuses an existing linked managed directory %s", async (_label, segments) => {
    const elsewhere = join(scratch, "elsewhere");
    await mkdir(elsewhere);
    if (segments.length === 2) await mkdir(join(root, segments[0]));
    await linkDirectory(elsewhere, join(root, ...segments));
    const attempt = run(development(root));
    expect(await codeOf(attempt.result)).toBe("STATE_ROOT_UNSUITABLE");
    expect(attempt.calls).toEqual([]);
    // Nothing was written through the link.
    expect(await readdir(elsewhere)).toEqual([]);
  });

  it("accepts ordinary managed directories that already exist", async () => {
    await mkdir(join(root, "acceptance-journal", "v1"), { recursive: true });
    await mkdir(join(root, "acceptance-journal", "quarantine"));
    const attempt = run(development(root));
    expect(await attempt.result).toEqual({ status: "NO_WORK" });
    expect(attempt.calls).toEqual(["lease"]);
  });

  it("uses exactly the configured root, without resolving links in its parents", async () => {
    // The root is reached through a linked parent: valid (the root itself is a
    // real directory), and the journal must see the configured string, not a realpath.
    const real = join(scratch, "real-parent");
    await mkdir(join(real, "root"), { recursive: true });
    const viaLink = join(scratch, "linked-parent");
    await linkDirectory(real, viaLink);
    const configured = join(viaLink, "root");
    const { fileSystem, paths } = recordingFileSystem();
    const attempt = run(development(configured), { journalFileSystem: fileSystem });
    expect(await attempt.result).toEqual({ status: "NO_WORK" });
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path === configured || path.startsWith(`${configured}${path.includes("\\") ? "\\" : "/"}`))).toBe(true);
    expect(paths).toContain(join(configured, "acceptance-journal", "v1"));
    expect((await readdir(join(real, "root"))).sort()).toEqual(["acceptance-journal"]);
  });
});

describe("production Linux root policy", () => {
  it("accepts the canonical root owned by the effective UID with owner-only mode, using REQUIRED directory sync", async () => {
    let flushes = 0;
    const fileSystem = { ...productionFileSystem(), openDirectory: async () => ({ sync: async () => void (flushes += 1), close: async () => undefined }) };
    const attempt = run(PRODUCTION, { host: productionHost(), journalFileSystem: fileSystem });
    expect(await attempt.result).toEqual({ status: "NO_WORK" });
    expect(attempt.calls).toEqual(["lease"]);
    expect(flushes).toBeGreaterThan(0);
    expect((await readdir(join(root, "acceptance-journal"))).sort()).toEqual(["quarantine", "v1"]);
  });

  it.each([
    ["a non-Linux platform", { platform: "win32" }],
    ["macOS", { platform: "darwin" }],
    ["a platform without an effective UID", { effectiveUid: undefined }],
    ["a root owned by another user", { rootUid: 1001 }],
    ["a group-readable root", { rootMode: 0o40740 }],
    ["a group-writable root", { rootMode: 0o40720 }],
    ["a group-executable root", { rootMode: 0o40710 }],
    ["an other-readable root", { rootMode: 0o40704 }],
    ["an other-writable root", { rootMode: 0o40702 }],
    ["an other-executable root", { rootMode: 0o40701 }],
    ["a world-open root", { rootMode: 0o40777 }],
  ] as const)("refuses %s before any request", async (_label, facts) => {
    const attempt = run(PRODUCTION, { host: productionHost(facts), journalFileSystem: productionFileSystem() });
    expect(await codeOf(attempt.result, [CANONICAL, root])).toBe("STATE_ROOT_UNSUITABLE");
    expect(attempt.calls).toEqual([]);
    // The root is never chmod-repaired or populated.
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses a hand-built production configuration naming any other root, even an otherwise valid one", async () => {
    const attempt = run(Object.freeze({ mode: "production", stateRoot: root }), {
      host: { ...productionHost(), lstat: async (path) => realLstat(path) },
    });
    expect(await codeOf(attempt.result, [root])).toBe("STATE_ROOT_UNSUITABLE");
    expect(attempt.calls).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });

  it("refuses when the required directory flush fails, never downgrading to best effort", async () => {
    const attempt = run(PRODUCTION, { host: productionHost(), journalFileSystem: productionFileSystem("FAIL") });
    expect(await codeOf(attempt.result)).toBe("STATE_ROOT_UNSUITABLE");
    expect(attempt.calls).toEqual([]);
  });
});

describe("journal suitability before any lease", () => {
  it("refuses a root whose filesystem cannot hard-link, with zero lease requests", async () => {
    const { fileSystem } = recordingFileSystem({
      link: async () => {
        throw Object.assign(new Error("links unsupported"), { code: "EPERM" });
      },
    });
    const attempt = run(development(root), { journalFileSystem: fileSystem });
    expect(await codeOf(attempt.result)).toBe("STATE_ROOT_UNSUITABLE");
    expect(attempt.calls).toEqual([]);
  });

  it("refuses a managed directory replaced by a link during preparation", async () => {
    const elsewhere = join(scratch, "elsewhere");
    await mkdir(elsewhere);
    const { fileSystem } = recordingFileSystem({
      makeDirectory: async (path, mode) => {
        if (path === join(root, "acceptance-journal", "quarantine")) return linkDirectory(elsewhere, path);
        return nodeJournalFileSystem.makeDirectory(path, mode);
      },
      isDirectory: nodeJournalFileSystem.isDirectory,
    });
    const attempt = run(development(root), { journalFileSystem: fileSystem });
    expect(await codeOf(attempt.result)).toBe("STATE_ROOT_UNSUITABLE");
    expect(attempt.calls).toEqual([]);
  });
});

describe("startup reconciliation through the bound root", () => {
  async function retainRecord(stateRoot: string) {
    const journal = await bindWorkerStateRoot(development(stateRoot));
    await journal.write(RECORD);
  }
  const acknowledged = (state: "SUBMITTED" | "ABANDONED"): WorkerAcceptanceRecoveryResult => ({
    status: "ACKNOWLEDGED",
    acknowledgement: { executionAttemptId: ATTEMPT, fencingCounter: 3, state, providerExecutionId: RECORD.providerExecutionId },
  });

  it("reconciles retained acceptance before the first lease request", async () => {
    await retainRecord(root);
    const attempt = run(development(root), { recovery: [acknowledged("SUBMITTED")] });
    expect(await attempt.result).toEqual({ status: "NO_WORK" });
    expect(attempt.calls).toEqual(["recovery", "lease"]);
  });

  it("never leases when reconciliation fails", async () => {
    await retainRecord(root);
    const attempt = run(development(root), { recovery: [new WorkerError("ACCEPTANCE_RECONCILIATION_FAILED")] });
    expect(await codeOf(attempt.result)).toBe("ACCEPTANCE_RECONCILIATION_FAILED");
    expect(attempt.calls).toEqual(["recovery"]);
  });

  it("gives a recreated composition the same root and its retained journal state", async () => {
    const first = await bindWorkerStateRoot(development(root));
    await first.write(RECORD);
    // A new process: a fresh binding from the same configuration.
    const second = await bindWorkerStateRoot(development(root));
    expect(await second.enumerate()).toEqual([{ kind: "FINAL", executionAttemptId: ATTEMPT }]);
    expect((await second.read(ATTEMPT)).status).toBe("VALID_RECORD");
    const attempt = run(development(root), { recovery: [acknowledged("SUBMITTED")] });
    expect(await attempt.result).toEqual({ status: "NO_WORK" });
    expect(attempt.calls).toEqual(["recovery", "lease"]);
    expect(await second.enumerate()).toEqual([{ kind: "FINAL", executionAttemptId: ATTEMPT }]);
  });
});

describe("assertWorkerStateRoot", () => {
  it("checks policy only: it creates nothing inside a valid root", async () => {
    await assertWorkerStateRoot(development(root));
    expect(await readdir(root)).toEqual([]);
  });
});
