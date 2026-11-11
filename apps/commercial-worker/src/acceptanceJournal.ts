import { createHash, randomBytes } from "node:crypto";
import { chmod, link, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { isProviderExecutionId } from "./providerExecutionContract.js";

// The worker-local durable provider-acceptance journal
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 17; R44B6P).
//
// One immutable JSON record per attempt, published by an exclusive hard link
// from a fully written, fsynced temporary file in the same directory. A record
// is written after a definitive provider acceptance and before the
// submission-accepted handler may resolve (section 18). It only ever lets the
// worker report the SAME provider execution ID; it never authorises a
// provider create. Nothing here calls a provider or the control plane.
//
// The state root is an explicit configuration value supplied by the worker
// composition; this module reads no environment variable.
//
// Layout (section 17):
//   <state-root>/acceptance-journal/v1/<executionAttemptId>.json
//   <state-root>/acceptance-journal/v1/<executionAttemptId>.<32 hex>.tmp
//   <state-root>/acceptance-journal/quarantine/<name>
//
// A record holds no secret: no credential, sealed envelope, fingerprint,
// lease token, bearer token, provider payload, prompt, URL or path. The
// closed schema makes any such member invalid.

export const ACCEPTANCE_JOURNAL_FORMAT = "busybookie.commercial-worker.acceptance/v1";
export const ACCEPTANCE_JOURNAL_DIRECTORY = "acceptance-journal";
export const ACCEPTANCE_JOURNAL_RECORDS_DIRECTORY = "v1";
export const ACCEPTANCE_JOURNAL_QUARANTINE_DIRECTORY = "quarantine";
// Owner-only (section 17). Applied explicitly, never left to the umask. On
// Windows, Node maps file modes to the read-only attribute only, so
// owner-only access there depends on the state root's ACL.
export const ACCEPTANCE_JOURNAL_DIRECTORY_MODE = 0o700;
export const ACCEPTANCE_JOURNAL_FILE_MODE = 0o600;

// Canonical member order (section 17). The first twelve form the digest
// preimage; recordSha256 is never part of its own preimage.
export const ACCEPTANCE_RECORD_PREIMAGE_MEMBERS = [
  "format",
  "executionAttemptId",
  "executionJobId",
  "accountId",
  "attemptNumber",
  "fencingCounter",
  "provider",
  "generationRequestSha256",
  "submittingAt",
  "providerExecutionId",
  "providerAcceptedAt",
  "recordedAt",
] as const;
export const ACCEPTANCE_RECORD_MEMBERS = [...ACCEPTANCE_RECORD_PREIMAGE_MEMBERS, "recordSha256"] as const;

export type AcceptanceRecord = Readonly<{
  format: typeof ACCEPTANCE_JOURNAL_FORMAT;
  executionAttemptId: string;
  executionJobId: string;
  accountId: string;
  attemptNumber: number;
  fencingCounter: number;
  provider: string;
  generationRequestSha256: string;
  submittingAt: string;
  providerExecutionId: string;
  providerAcceptedAt: string;
  recordedAt: string;
  recordSha256: string;
}>;

// Everything a caller may supply. There is deliberately no field for a
// token, credential, provider payload or path.
export type AcceptanceInput = Readonly<{
  executionAttemptId: string;
  executionJobId: string;
  accountId: string;
  attemptNumber: number;
  fencingCounter: number;
  provider: string;
  generationRequestSha256: string;
  submittingAt: Date;
  providerExecutionId: string;
  providerAcceptedAt: Date;
}>;

// Worker-local closed codes (section 30). Messages are fixed text and carry no
// path, identifier, provider execution ID or cause.
export type AcceptanceJournalErrorCode =
  | "ACCEPTANCE_RECORD_INVALID"
  | "ACCEPTANCE_JOURNAL_CORRUPT"
  | "ACCEPTANCE_JOURNAL_CONFLICT"
  | "ACCEPTANCE_JOURNAL_WRITE_FAILED"
  | "STATE_ROOT_UNSUITABLE";

const MESSAGES: Readonly<Record<AcceptanceJournalErrorCode, string>> = {
  ACCEPTANCE_RECORD_INVALID: "The acceptance record is invalid.",
  ACCEPTANCE_JOURNAL_CORRUPT: "A published acceptance record is corrupt.",
  ACCEPTANCE_JOURNAL_CONFLICT: "A published acceptance record conflicts with the acceptance being recorded.",
  ACCEPTANCE_JOURNAL_WRITE_FAILED: "The acceptance record could not be made durable.",
  STATE_ROOT_UNSUITABLE: "The worker state root is unsuitable for the acceptance journal.",
};

export class AcceptanceJournalError extends Error {
  override readonly name = "AcceptanceJournalError";

  constructor(readonly code: AcceptanceJournalErrorCode) {
    super(MESSAGES[code]);
  }
}

// ---------------------------------------------------------------------------
// Closed schema and canonical bytes

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROVIDER = /^[A-Z][A-Z0-9_]{0,31}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TEMPORARY_NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9a-f]{32})\.tmp$/;
const RANDOM_SUFFIX = /^[0-9a-f]{32}$/;

const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isPositiveSafeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
const isInstant = (value: unknown): value is string => {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toISOString() === value;
};

function isValidRecordBody(record: Record<string, unknown>): boolean {
  return (
    record.format === ACCEPTANCE_JOURNAL_FORMAT &&
    isUuid(record.executionAttemptId) &&
    isUuid(record.executionJobId) &&
    isUuid(record.accountId) &&
    isPositiveSafeInteger(record.attemptNumber) &&
    isPositiveSafeInteger(record.fencingCounter) &&
    typeof record.provider === "string" &&
    PROVIDER.test(record.provider) &&
    typeof record.generationRequestSha256 === "string" &&
    SHA256_HEX.test(record.generationRequestSha256) &&
    isInstant(record.submittingAt) &&
    isProviderExecutionId(record.providerExecutionId) &&
    isInstant(record.providerAcceptedAt) &&
    isInstant(record.recordedAt)
  );
}

// Section 17: "{", then for each member in order, separated by ",": the
// JSON.stringify of the name, ":", the JSON.stringify of the value; then "}".
// Every value is an ASCII string or a safe integer, so JSON.stringify is exact.
function canonical(record: Readonly<Record<string, unknown>>, members: readonly string[]): string {
  return `{${members.map((member) => `${JSON.stringify(member)}:${JSON.stringify(record[member])}`).join(",")}}`;
}

export function acceptanceRecordPreimage(record: Readonly<Record<string, unknown>>): string {
  return canonical(record, ACCEPTANCE_RECORD_PREIMAGE_MEMBERS);
}

export function acceptanceRecordDigest(record: Readonly<Record<string, unknown>>): string {
  return createHash("sha256").update(acceptanceRecordPreimage(record), "utf8").digest("hex");
}

// The exact stored bytes: all thirteen members, recordSha256 last, one LF.
export function serializeAcceptanceRecord(record: AcceptanceRecord): string {
  return `${canonical(record, ACCEPTANCE_RECORD_MEMBERS)}\n`;
}

// Builds the closed record from validated input; recordedAt is the worker
// clock at serialisation time.
export function buildAcceptanceRecord(input: AcceptanceInput, recordedAt: Date): AcceptanceRecord {
  const instant = (value: unknown) => (value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null);
  const body: Record<string, unknown> = {
    format: ACCEPTANCE_JOURNAL_FORMAT,
    executionAttemptId: input.executionAttemptId,
    executionJobId: input.executionJobId,
    accountId: input.accountId,
    attemptNumber: input.attemptNumber,
    fencingCounter: input.fencingCounter,
    provider: input.provider,
    generationRequestSha256: input.generationRequestSha256,
    submittingAt: instant(input.submittingAt),
    providerExecutionId: input.providerExecutionId,
    providerAcceptedAt: instant(input.providerAcceptedAt),
    recordedAt: instant(recordedAt),
  };
  if (!isValidRecordBody(body)) throw new AcceptanceJournalError("ACCEPTANCE_RECORD_INVALID");
  return Object.freeze({ ...(body as Omit<AcceptanceRecord, "recordSha256">), recordSha256: acceptanceRecordDigest(body) });
}

// Strict read (section 17, "Validation on every read"). Returns null for any
// deviation: non-ASCII, not exactly one trailing LF, unparsable, missing,
// extra or reordered members, invalid values, non-canonical bytes, a digest
// mismatch or a filename stem that is not the record's attempt.
export function parseAcceptanceRecord(bytes: Uint8Array, expectedAttemptId: string): AcceptanceRecord | null {
  if (bytes.length < 2 || bytes[bytes.length - 1] !== 0x0a) return null;
  for (let index = 0; index < bytes.length - 1; index += 1) {
    const byte = bytes[index]!;
    if (byte < 0x20 || byte > 0x7e) return null;
  }
  const text = Buffer.from(bytes.subarray(0, bytes.length - 1)).toString("ascii");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== ACCEPTANCE_RECORD_MEMBERS.length || keys.some((key, index) => key !== ACCEPTANCE_RECORD_MEMBERS[index])) return null;
  if (!isValidRecordBody(record) || typeof record.recordSha256 !== "string" || !SHA256_HEX.test(record.recordSha256)) return null;
  if (canonical(record, ACCEPTANCE_RECORD_MEMBERS) !== text) return null;
  if (acceptanceRecordDigest(record) !== record.recordSha256) return null;
  if (record.executionAttemptId !== expectedAttemptId) return null;
  return Object.freeze({ ...(record as AcceptanceRecord) });
}

// ---------------------------------------------------------------------------
// Narrow filesystem boundary (injectable so tests can prove ordering)

export type JournalFileHandle = Readonly<{
  writeFile: (data: Uint8Array) => Promise<void>;
  sync: () => Promise<void>;
  close: () => Promise<void>;
}>;

export type JournalDirectoryHandle = Readonly<{
  sync: () => Promise<void>;
  close: () => Promise<void>;
}>;

export type JournalFileSystem = Readonly<{
  // Exclusive creation (O_CREAT|O_EXCL, "wx").
  openExclusive: (path: string, mode: number) => Promise<JournalFileHandle>;
  openDirectory: (path: string) => Promise<JournalDirectoryHandle>;
  link: (existingPath: string, newPath: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  readFile: (path: string) => Promise<Uint8Array>;
  makeDirectory: (path: string, mode: number) => Promise<void>;
  chmod: (path: string, mode: number) => Promise<void>;
  isDirectory: (path: string) => Promise<boolean>;
}>;

export const nodeJournalFileSystem: JournalFileSystem = Object.freeze({
  openExclusive: async (path: string, mode: number) => {
    const handle = await open(path, "wx", mode);
    return Object.freeze({
      writeFile: (data: Uint8Array) => handle.writeFile(data),
      sync: () => handle.sync(),
      close: () => handle.close(),
    });
  },
  openDirectory: async (path: string) => {
    const handle = await open(path, "r");
    return Object.freeze({ sync: () => handle.sync(), close: () => handle.close() });
  },
  link: (existingPath: string, newPath: string) => link(existingPath, newPath),
  unlink: (path: string) => unlink(path),
  readFile: async (path: string) => new Uint8Array(await readFile(path)),
  makeDirectory: async (path: string, mode: number) => {
    await mkdir(path, { mode });
  },
  chmod: (path: string, mode: number) => chmod(path, mode),
  isDirectory: async (path: string) => {
    try {
      return (await stat(path)).isDirectory();
    } catch {
      return false;
    }
  },
});

const errorCode = (error: unknown) => (error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined);

// ---------------------------------------------------------------------------
// The journal

// REQUIRED: a directory fsync failure is a journal-write failure (Linux, the
// deployment target). DEVELOPMENT_BEST_EFFORT: tolerated and reported, for
// development on Windows, where Node cannot flush a directory handle; such a
// worker makes no durability claim for the link (section 17).
export type DirectorySyncPolicy = "REQUIRED" | "DEVELOPMENT_BEST_EFFORT";

export type AcceptanceJournalOptions = Readonly<{
  stateRoot: string;
  directorySync: DirectorySyncPolicy;
  fileSystem?: JournalFileSystem;
  // 32 lowercase hex characters; defaults to 16 CSPRNG bytes.
  randomSuffix?: () => string;
  clock?: () => Date;
}>;

export type AcceptanceWriteResult = Readonly<{
  outcome: "PUBLISHED" | "ALREADY_PUBLISHED";
  record: AcceptanceRecord;
  // false only under DEVELOPMENT_BEST_EFFORT when the platform could not flush the directory.
  directorySynced: boolean;
  // false when step 7's unlink failed; the startup scan handles the leftover.
  temporaryRemoved: boolean;
}>;

export type AcceptanceReadResult =
  | Readonly<{ status: "NOT_FOUND" }>
  | Readonly<{ status: "VALID_RECORD"; record: AcceptanceRecord }>
  // Malformed, truncated, unknown format, digest mismatch or unreadable.
  | Readonly<{ status: "CORRUPT_RECORD" }>
  // Valid, but not the identity the caller expects (section 17).
  | Readonly<{ status: "CONFLICTING_RECORD"; record: AcceptanceRecord }>;

export type AcceptanceTemporaryResult =
  | Readonly<{ status: "NOT_FOUND" }>
  // Complete and valid: publication can be completed from step 4.
  | Readonly<{ status: "VALID_TEMPORARY"; record: AcceptanceRecord }>
  // Partial or invalid: never evidence; quarantined.
  | Readonly<{ status: "INVALID_TEMPORARY" }>;

export type ExpectedAcceptanceIdentity = Partial<
  Pick<AcceptanceRecord, "executionJobId" | "accountId" | "attemptNumber" | "fencingCounter" | "provider" | "generationRequestSha256" | "providerExecutionId">
>;

export type AcceptanceJournal = Readonly<{
  // Validates the state root, creates the owner-only layout, and probes link
  // support (and directory fsync under REQUIRED). Refuses an unsuitable root.
  prepare: () => Promise<Readonly<{ directorySyncSupported: boolean }>>;
  // Builds the record (recordedAt from the journal clock) and publishes it.
  write: (input: AcceptanceInput) => Promise<AcceptanceWriteResult>;
  // Publishes an already-built record, for example to retry exactly the same
  // bytes; it is re-validated strictly first. Section 17 makes EEXIST
  // idempotent only for byte-identical records.
  publish: (record: AcceptanceRecord) => Promise<AcceptanceWriteResult>;
  read: (executionAttemptId: string, expected?: ExpectedAcceptanceIdentity) => Promise<AcceptanceReadResult>;
  inspectTemporary: (fileName: string) => Promise<AcceptanceTemporaryResult>;
  // Moves an INVALID temporary to quarantine/ (exclusive link, then unlink).
  quarantineInvalidTemporary: (fileName: string) => Promise<void>;
}>;

const MAX_TEMPORARY_ATTEMPTS = 4;

export function createAcceptanceJournal(options: AcceptanceJournalOptions): AcceptanceJournal {
  const { stateRoot, directorySync } = options;
  // The state root is configuration, never request input: an absolute path
  // with no ".." segment and no NUL byte.
  if (
    typeof stateRoot !== "string" ||
    !isAbsolute(stateRoot) ||
    stateRoot.includes("\0") ||
    stateRoot.split(/[\\/]/).includes("..") ||
    (directorySync !== "REQUIRED" && directorySync !== "DEVELOPMENT_BEST_EFFORT")
  ) {
    throw new AcceptanceJournalError("STATE_ROOT_UNSUITABLE");
  }
  const fs = options.fileSystem ?? nodeJournalFileSystem;
  const randomSuffix = options.randomSuffix ?? (() => randomBytes(16).toString("hex"));
  const clock = options.clock ?? (() => new Date());

  const journalDirectory = join(stateRoot, ACCEPTANCE_JOURNAL_DIRECTORY);
  const recordsDirectory = join(journalDirectory, ACCEPTANCE_JOURNAL_RECORDS_DIRECTORY);
  const quarantineDirectory = join(journalDirectory, ACCEPTANCE_JOURNAL_QUARANTINE_DIRECTORY);

  // Attempt IDs are canonical UUIDs, never path fragments.
  const finalPath = (executionAttemptId: string) => {
    if (!isUuid(executionAttemptId)) throw new AcceptanceJournalError("ACCEPTANCE_RECORD_INVALID");
    return join(recordsDirectory, `${executionAttemptId}.json`);
  };
  const temporaryName = (fileName: string) => {
    const match = TEMPORARY_NAME.exec(fileName);
    if (match === null) throw new AcceptanceJournalError("ACCEPTANCE_RECORD_INVALID");
    return { attemptId: match[1]!, path: join(recordsDirectory, fileName) };
  };

  // Section 17, step 6. Returns whether the directory entry was flushed.
  async function syncDirectory(path: string, failure: AcceptanceJournalErrorCode): Promise<boolean> {
    try {
      const handle = await fs.openDirectory(path);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      return true;
    } catch {
      if (directorySync === "REQUIRED") throw new AcceptanceJournalError(failure);
      return false;
    }
  }

  async function ensureDirectory(path: string): Promise<void> {
    try {
      await fs.makeDirectory(path, ACCEPTANCE_JOURNAL_DIRECTORY_MODE);
    } catch (error) {
      if (errorCode(error) !== "EEXIST" || !(await fs.isDirectory(path))) throw new AcceptanceJournalError("STATE_ROOT_UNSUITABLE");
    }
    try {
      await fs.chmod(path, ACCEPTANCE_JOURNAL_DIRECTORY_MODE);
    } catch {
      throw new AcceptanceJournalError("STATE_ROOT_UNSUITABLE");
    }
  }

  async function prepare() {
    if (!(await fs.isDirectory(stateRoot))) throw new AcceptanceJournalError("STATE_ROOT_UNSUITABLE");
    for (const directory of [journalDirectory, recordsDirectory, quarantineDirectory]) await ensureDirectory(directory);
    // Link probe, outside v1 so a crash never leaves a non-journal entry there.
    const probe = join(journalDirectory, `.link-probe-${randomSuffix()}`);
    const probeLink = `${probe}.linked`;
    try {
      const handle = await fs.openExclusive(probe, ACCEPTANCE_JOURNAL_FILE_MODE);
      await handle.close();
      await fs.link(probe, probeLink);
    } catch {
      throw new AcceptanceJournalError("STATE_ROOT_UNSUITABLE");
    } finally {
      await fs.unlink(probeLink).catch(() => undefined);
      await fs.unlink(probe).catch(() => undefined);
    }
    const directorySyncSupported = await syncDirectory(recordsDirectory, "STATE_ROOT_UNSUITABLE");
    return Object.freeze({ directorySyncSupported });
  }

  async function write(input: AcceptanceInput): Promise<AcceptanceWriteResult> {
    return publish(buildAcceptanceRecord(input, clock()));
  }

  async function publish(candidate: AcceptanceRecord): Promise<AcceptanceWriteResult> {
    // Step 1: validate and serialise. The record must round-trip the strict
    // reader exactly, so nothing outside the closed schema can be written.
    const attemptId = (candidate as { executionAttemptId?: unknown })?.executionAttemptId;
    if (!isUuid(attemptId)) throw new AcceptanceJournalError("ACCEPTANCE_RECORD_INVALID");
    // Exactly the closed members: an object carrying anything else is refused,
    // even though the serialiser would never write the extra member.
    const keys = Object.keys(candidate);
    if (keys.length !== ACCEPTANCE_RECORD_MEMBERS.length || keys.some((key) => !(ACCEPTANCE_RECORD_MEMBERS as readonly string[]).includes(key))) {
      throw new AcceptanceJournalError("ACCEPTANCE_RECORD_INVALID");
    }
    const serialized = serializeAcceptanceRecord(candidate);
    const bytes = Buffer.from(serialized, "ascii");
    const record = parseAcceptanceRecord(bytes, attemptId);
    if (record === null || bytes.toString("ascii") !== serialized) throw new AcceptanceJournalError("ACCEPTANCE_RECORD_INVALID");
    const target = finalPath(record.executionAttemptId);

    // Step 2: exclusive temporary in the same directory.
    let temporary: string | undefined;
    let handle: JournalFileHandle | undefined;
    for (let attempt = 0; attempt < MAX_TEMPORARY_ATTEMPTS && handle === undefined; attempt += 1) {
      const suffix = randomSuffix();
      if (!RANDOM_SUFFIX.test(suffix)) throw new AcceptanceJournalError("ACCEPTANCE_JOURNAL_WRITE_FAILED");
      const candidate = join(recordsDirectory, `${record.executionAttemptId}.${suffix}.tmp`);
      try {
        handle = await fs.openExclusive(candidate, ACCEPTANCE_JOURNAL_FILE_MODE);
        temporary = candidate;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw new AcceptanceJournalError("ACCEPTANCE_JOURNAL_WRITE_FAILED");
      }
    }
    if (handle === undefined || temporary === undefined) throw new AcceptanceJournalError("ACCEPTANCE_JOURNAL_WRITE_FAILED");

    // Step 3: write everything, flush, close; then the explicit owner-only mode.
    try {
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.chmod(temporary, ACCEPTANCE_JOURNAL_FILE_MODE);
    } catch {
      // The partial temporary is never evidence; the startup scan quarantines it.
      throw new AcceptanceJournalError("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    }

    // Step 4: atomic exclusive publication. No rename, copy or direct write.
    let outcome: AcceptanceWriteResult["outcome"] = "PUBLISHED";
    try {
      await fs.link(temporary, target);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw new AcceptanceJournalError("ACCEPTANCE_JOURNAL_WRITE_FAILED");
      // Step 5: compare with the existing record; never overwrite it.
      let existing: Uint8Array;
      try {
        existing = await fs.readFile(target);
      } catch {
        throw new AcceptanceJournalError("ACCEPTANCE_JOURNAL_CORRUPT");
      }
      if (!Buffer.from(existing).equals(bytes)) {
        throw new AcceptanceJournalError(
          parseAcceptanceRecord(existing, record.executionAttemptId) === null ? "ACCEPTANCE_JOURNAL_CORRUPT" : "ACCEPTANCE_JOURNAL_CONFLICT",
        );
      }
      outcome = "ALREADY_PUBLISHED";
    }

    // Step 6: make the directory entry durable (also for an existing record,
    // whose link may not yet have been flushed before a crash).
    const directorySynced = await syncDirectory(recordsDirectory, "ACCEPTANCE_JOURNAL_WRITE_FAILED");

    // Step 7: remove the temporary; failure is harmless.
    let temporaryRemoved = true;
    try {
      await fs.unlink(temporary);
    } catch {
      temporaryRemoved = false;
    }
    return Object.freeze({ outcome, record, directorySynced, temporaryRemoved });
  }

  async function read(executionAttemptId: string, expected: ExpectedAcceptanceIdentity = {}): Promise<AcceptanceReadResult> {
    const path = finalPath(executionAttemptId);
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(path);
    } catch (error) {
      return errorCode(error) === "ENOENT" ? Object.freeze({ status: "NOT_FOUND" }) : Object.freeze({ status: "CORRUPT_RECORD" });
    }
    const record = parseAcceptanceRecord(bytes, executionAttemptId);
    if (record === null) return Object.freeze({ status: "CORRUPT_RECORD" });
    const mismatch = (Object.keys(expected) as (keyof ExpectedAcceptanceIdentity)[]).some((key) => expected[key] !== undefined && expected[key] !== record[key]);
    return Object.freeze(mismatch ? { status: "CONFLICTING_RECORD", record } : { status: "VALID_RECORD", record });
  }

  async function inspectTemporary(fileName: string): Promise<AcceptanceTemporaryResult> {
    const { attemptId, path } = temporaryName(fileName);
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(path);
    } catch (error) {
      return errorCode(error) === "ENOENT" ? Object.freeze({ status: "NOT_FOUND" }) : Object.freeze({ status: "INVALID_TEMPORARY" });
    }
    const record = parseAcceptanceRecord(bytes, attemptId);
    return Object.freeze(record === null ? { status: "INVALID_TEMPORARY" } : { status: "VALID_TEMPORARY", record });
  }

  async function quarantineInvalidTemporary(fileName: string): Promise<void> {
    const { path } = temporaryName(fileName);
    // A valid temporary is evidence awaiting publication, never quarantined.
    if ((await inspectTemporary(fileName)).status !== "INVALID_TEMPORARY") throw new AcceptanceJournalError("ACCEPTANCE_JOURNAL_CONFLICT");
    try {
      await fs.link(path, join(quarantineDirectory, fileName));
    } catch {
      throw new AcceptanceJournalError("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    }
    await syncDirectory(quarantineDirectory, "ACCEPTANCE_JOURNAL_WRITE_FAILED");
    try {
      await fs.unlink(path);
    } catch {
      throw new AcceptanceJournalError("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    }
    await syncDirectory(recordsDirectory, "ACCEPTANCE_JOURNAL_WRITE_FAILED");
  }

  return Object.freeze({ prepare, write, publish, read, inspectTemporary, quarantineInvalidTemporary });
}
