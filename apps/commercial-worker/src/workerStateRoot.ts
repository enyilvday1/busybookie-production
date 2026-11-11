import { lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { ACCEPTANCE_JOURNAL_DIRECTORY, ACCEPTANCE_JOURNAL_QUARANTINE_DIRECTORY, ACCEPTANCE_JOURNAL_RECORDS_DIRECTORY, createAcceptanceJournal, type AcceptanceJournal, type DirectorySyncPolicy, type JournalFileSystem } from "./acceptanceJournal.js";
import { runCredentialOpeningOnce, type CredentialOpeningRunDependencies, type CredentialOpeningRunResult } from "./credentialOpeningRun.js";
import { PRODUCTION_WORKER_STATE_ROOT, type WorkerConfig, type WorkerMode } from "./workerConfig.js";
import { WorkerError } from "./workerError.js";

// The application half of the state-root binding
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 17,
// "State-root binding", R44B8A):
//
//   validated WorkerConfig
//   -> state-root policy (absolute, pre-existing directory, not a symlink;
//      production: Linux, owned by the effective UID, owner-only mode)
//   -> createAcceptanceJournal(exact configured root, selected sync policy)
//   -> prepare() and managed-directory checks
//   -> the existing runCredentialOpeningOnce (startup reconciliation, then lease)
//
// It never creates, realpaths or rewrites the root, never falls back to a
// temporary or working directory, never logs the path, and adds no lock or
// metadata file. Every root failure is the existing STATE_ROOT_UNSUITABLE,
// raised before any control-plane request. No provider work happens here,
// and there is no process entry point.

// The runtime facts the policy needs. The default is the real host; tests
// inject deterministic facts.
export type WorkerStateRootStat = Readonly<{
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
  uid: number;
  mode: number;
}>;

export type WorkerStateRootHost = Readonly<{
  platform: string;
  // undefined where the platform has no effective UID (Windows).
  effectiveUid: () => number | undefined;
  lstat: (path: string) => Promise<WorkerStateRootStat>;
}>;

export const nodeWorkerStateRootHost: WorkerStateRootHost = Object.freeze({
  platform: process.platform,
  effectiveUid: () => (typeof process.geteuid === "function" ? process.geteuid() : undefined),
  lstat: (path: string) => lstat(path),
});

// The managed descendants the journal owns, outermost first.
const MANAGED_DIRECTORIES: readonly (readonly string[])[] = Object.freeze([
  [ACCEPTANCE_JOURNAL_DIRECTORY],
  [ACCEPTANCE_JOURNAL_DIRECTORY, ACCEPTANCE_JOURNAL_RECORDS_DIRECTORY],
  [ACCEPTANCE_JOURNAL_DIRECTORY, ACCEPTANCE_JOURNAL_QUARANTINE_DIRECTORY],
]);

const unsuitable = () => new WorkerError("STATE_ROOT_UNSUITABLE");
const errorCode = (error: unknown) => (error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined);

// Production is REQUIRED, always. Development flushes directories wherever the
// platform can (everything but Windows, where Node cannot open a directory
// handle). Not caller-overridable.
export function selectDirectorySync(mode: WorkerMode, platform: string): DirectorySyncPolicy {
  if (mode === "production") return "REQUIRED";
  return platform === "win32" ? "DEVELOPMENT_BEST_EFFORT" : "REQUIRED";
}

async function inspect(host: WorkerStateRootHost, path: string): Promise<WorkerStateRootStat | "MISSING"> {
  try {
    return await host.lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return "MISSING";
    throw unsuitable();
  }
}

// An existing managed directory must be a real directory, never a link; a
// missing one is allowed before prepare() (the journal creates it) and refused after.
async function assertManagedDirectories(host: WorkerStateRootHost, stateRoot: string, missingAllowed: boolean): Promise<void> {
  for (const segments of MANAGED_DIRECTORIES) {
    const entry = await inspect(host, join(stateRoot, ...segments));
    if (entry === "MISSING") {
      if (missingAllowed) continue;
      throw unsuitable();
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw unsuitable();
  }
}

// The configured root itself, checked before the journal touches it. It is
// trusted-host configuration validation, not hostile-filesystem defence.
export async function assertWorkerStateRoot(config: WorkerConfig, host: WorkerStateRootHost = nodeWorkerStateRootHost): Promise<void> {
  const { stateRoot, mode } = config;
  if (typeof stateRoot !== "string" || stateRoot.length === 0 || stateRoot.includes("\0") || !isAbsolute(stateRoot) || stateRoot.split(/[\\/]/).includes("..")) {
    throw unsuitable();
  }
  // Production durability is defined for Linux only; it never degrades
  // elsewhere. Even a hand-built production configuration binds only the
  // published deployment root.
  if (mode === "production" && (host.platform !== "linux" || stateRoot !== PRODUCTION_WORKER_STATE_ROOT)) throw unsuitable();

  const root = await inspect(host, stateRoot);
  // The worker never creates its root: the operator provisions it.
  if (root === "MISSING" || root.isSymbolicLink() || !root.isDirectory()) throw unsuitable();

  if (mode === "production") {
    const effectiveUid = host.effectiveUid();
    if (effectiveUid === undefined || root.uid !== effectiveUid || (root.mode & 0o077) !== 0) throw unsuitable();
  }
  await assertManagedDirectories(host, stateRoot, true);
}

export type WorkerStateRootBindingDependencies = Readonly<{
  host?: WorkerStateRootHost;
  // The journal's filesystem seam; the real filesystem by default.
  journalFileSystem?: JournalFileSystem;
}>;

// Validates the root, then builds and prepares the journal at exactly the
// configured path. Resolved once; the journal keeps the root for its lifetime.
export async function bindWorkerStateRoot(config: WorkerConfig, dependencies: WorkerStateRootBindingDependencies = {}): Promise<AcceptanceJournal> {
  const host = dependencies.host ?? nodeWorkerStateRootHost;
  await assertWorkerStateRoot(config, host);
  let journal: AcceptanceJournal;
  try {
    journal = createAcceptanceJournal({
      stateRoot: config.stateRoot,
      directorySync: selectDirectorySync(config.mode, host.platform),
      ...(dependencies.journalFileSystem === undefined ? {} : { fileSystem: dependencies.journalFileSystem }),
    });
    // The hard-link probe, and the directory-fsync probe under REQUIRED.
    await journal.prepare();
  } catch {
    throw unsuitable();
  }
  await assertManagedDirectories(host, config.stateRoot, false);
  return journal;
}

export type ConfiguredCredentialOpeningDependencies = Omit<CredentialOpeningRunDependencies, "journal"> & WorkerStateRootBindingDependencies;

// The production-capable startup composition: the bound journal, then the
// existing startup path, whose reconciliation must be CLEAR before any lease.
// An unsuitable root fails before any control-plane request.
export async function runConfiguredCredentialOpeningOnce(config: WorkerConfig, dependencies: ConfiguredCredentialOpeningDependencies): Promise<CredentialOpeningRunResult> {
  const { host, journalFileSystem, ...run } = dependencies;
  let journal: AcceptanceJournal;
  try {
    journal = await bindWorkerStateRoot(config, {
      ...(host === undefined ? {} : { host }),
      ...(journalFileSystem === undefined ? {} : { journalFileSystem }),
    });
  } catch {
    run.log?.({ stage: "STARTUP", outcome: "FAILED", code: "STATE_ROOT_UNSUITABLE" });
    throw unsuitable();
  }
  return runCredentialOpeningOnce({ ...run, journal });
}
