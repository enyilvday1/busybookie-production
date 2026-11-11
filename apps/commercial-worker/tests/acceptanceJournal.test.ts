import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ACCEPTANCE_JOURNAL_FORMAT,
  ACCEPTANCE_RECORD_MEMBERS,
  ACCEPTANCE_RECORD_PREIMAGE_MEMBERS,
  AcceptanceJournalError,
  acceptanceRecordDigest,
  acceptanceRecordPreimage,
  buildAcceptanceRecord,
  createAcceptanceJournal,
  parseAcceptanceRecord,
  serializeAcceptanceRecord,
  type AcceptanceInput,
  type AcceptanceRecord,
  type JournalFileSystem,
} from "../src/acceptanceJournal.js";

// R44B6P: the worker-local durable provider-acceptance journal
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 17).
// Real-filesystem tests run in an OS temporary directory, never in the
// repository. An in-memory filesystem records the exact call order. No
// provider is involved: acceptance data here is synthetic.

const ATTEMPT = "11111111-2222-4333-8444-555555555555";
const INPUT: AcceptanceInput = Object.freeze({
  executionAttemptId: ATTEMPT,
  executionJobId: "66666666-7777-4888-9999-aaaaaaaaaaaa",
  accountId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  attemptNumber: 1,
  fencingCounter: 3,
  provider: "EXAMPLE_PROVIDER",
  generationRequestSha256: "c".repeat(64),
  submittingAt: new Date("2026-11-11T10:00:00.000Z"),
  providerExecutionId: 'models/x/operations/op-"q"\\1',
  providerAcceptedAt: new Date("2026-11-11T10:00:01.250Z"),
});
const RECORDED_AT = new Date("2026-11-11T10:00:01.500Z");
const clock = () => RECORDED_AT;

// Independently computed from the architecture text (not from this module).
const PINNED_PREIMAGE = String.raw`{"format":"busybookie.commercial-worker.acceptance/v1","executionAttemptId":"11111111-2222-4333-8444-555555555555","executionJobId":"66666666-7777-4888-9999-aaaaaaaaaaaa","accountId":"bbbbbbbb-cccc-4ddd-8eee-ffffffffffff","attemptNumber":1,"fencingCounter":3,"provider":"EXAMPLE_PROVIDER","generationRequestSha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","submittingAt":"2026-11-11T10:00:00.000Z","providerExecutionId":"models/x/operations/op-\"q\"\\1","providerAcceptedAt":"2026-11-11T10:00:01.250Z","recordedAt":"2026-11-11T10:00:01.500Z"}`;
const PINNED_DIGEST = "06bce943a986c191d06949064ed571c88c088b260780bbd9574f890560d953c2";
const PINNED_FILE = `${PINNED_PREIMAGE.slice(0, -1)},"recordSha256":"${PINNED_DIGEST}"}\n`;

const bytesOf = (text: string) => new Uint8Array(Buffer.from(text, "latin1"));
const errorOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
};
const codeOf = async (promise: Promise<unknown>) => ((await errorOf(promise)) as AcceptanceJournalError).code;

describe("record schema and canonical bytes", () => {
  it("pins the format literal and the exact member order", () => {
    expect(ACCEPTANCE_JOURNAL_FORMAT).toBe("busybookie.commercial-worker.acceptance/v1");
    expect(ACCEPTANCE_RECORD_MEMBERS).toEqual([
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
      "recordSha256",
    ]);
    expect(ACCEPTANCE_RECORD_PREIMAGE_MEMBERS).toEqual(ACCEPTANCE_RECORD_MEMBERS.slice(0, 12));
  });

  it("matches the independently computed preimage, digest and exact file bytes", () => {
    const record = buildAcceptanceRecord(INPUT, RECORDED_AT);
    expect(acceptanceRecordPreimage(record)).toBe(PINNED_PREIMAGE);
    expect(createHash("sha256").update(PINNED_PREIMAGE, "utf8").digest("hex")).toBe(PINNED_DIGEST);
    expect(acceptanceRecordDigest(record)).toBe(PINNED_DIGEST);
    expect(record.recordSha256).toBe(PINNED_DIGEST);
    const file = serializeAcceptanceRecord(record);
    expect(file).toBe(PINNED_FILE);
    // recordSha256 last, exactly one LF, no CR, no BOM, ASCII only.
    expect(file.endsWith(`"recordSha256":"${PINNED_DIGEST}"}\n`)).toBe(true);
    expect(file.indexOf("\n")).toBe(file.length - 1);
    expect(file.includes("\r")).toBe(false);
    expect([...Buffer.from(file, "utf8")].every((byte) => byte === 0x0a || (byte >= 0x20 && byte <= 0x7e))).toBe(true);
    expect(parseAcceptanceRecord(bytesOf(file), ATTEMPT)).toEqual(record);
  });

  it.each([
    ["an uppercase attempt UUID", { executionAttemptId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".toUpperCase() }],
    ["a malformed job UUID", { executionJobId: "not-a-uuid" }],
    ["attempt number 0", { attemptNumber: 0 }],
    ["an unsafe fencing counter", { fencingCounter: 2 ** 53 }],
    ["a fractional fencing counter", { fencingCounter: 1.5 }],
    ["a lowercase provider", { provider: "example" }],
    ["an uppercase request hash", { generationRequestSha256: "C".repeat(64) }],
    ["an invalid submittingAt", { submittingAt: new Date("not a date") }],
    ["a provider ID with a space", { providerExecutionId: "op 1" }],
    ["a provider ID that is a URL", { providerExecutionId: "https://provider.example/tasks/1" }],
    ["an empty provider ID", { providerExecutionId: "" }],
    ["a 257-character provider ID", { providerExecutionId: "x".repeat(257) }],
    ["a non-ASCII provider ID", { providerExecutionId: "op-\u00e9" }],
  ] as const)("rejects %s before anything is written", (_label, override) => {
    expect(() => buildAcceptanceRecord({ ...INPUT, ...override } as AcceptanceInput, RECORDED_AT)).toThrow(AcceptanceJournalError);
  });

  it("keeps any extra caller field out of the record", () => {
    const smuggled = { ...INPUT, leaseToken: "secret-lease-token", credential: "secret-credential", providerResponse: { body: "x" } } as AcceptanceInput;
    const file = serializeAcceptanceRecord(buildAcceptanceRecord(smuggled, RECORDED_AT));
    expect(file).toBe(PINNED_FILE);
  });

  it.each([
    ["an extra member", PINNED_FILE.replace(`{"format"`, `{"extra":1,"format"`)],
    ["a missing member", PINNED_FILE.replace(`"attemptNumber":1,`, "")],
    ["reordered members", PINNED_FILE.replace(`"attemptNumber":1,"fencingCounter":3`, `"fencingCounter":3,"attemptNumber":1`)],
    ["insignificant whitespace", PINNED_FILE.replace(`"attemptNumber":1`, `"attemptNumber": 1`)],
    ["CRLF", PINNED_FILE.replace(/\n$/, "\r\n")],
    ["two trailing LFs", `${PINNED_FILE}\n`],
    ["no trailing LF", PINNED_FILE.slice(0, -1)],
    ["a BOM", `\ufeff${PINNED_FILE}`],
    ["a truncated record", PINNED_FILE.slice(0, 100)],
    ["an unknown format", PINNED_FILE.replace("acceptance/v1", "acceptance/v2")],
    ["a number written as a string", PINNED_FILE.replace(`"attemptNumber":1`, `"attemptNumber":"1"`)],
    ["a leading zero", PINNED_FILE.replace(`"fencingCounter":3`, `"fencingCounter":03`)],
    ["a duplicate member", PINNED_FILE.replace(`{"format"`, `{"format":"x","format"`)],
    ["a digest mismatch", PINNED_FILE.replace(PINNED_DIGEST, "0".repeat(64))],
    ["a tampered value with its old digest", PINNED_FILE.replace(`"fencingCounter":3`, `"fencingCounter":4`)],
    ["an alternate escape form", PINNED_FILE.replace(String.raw`op-\"q\"`, String.raw`op-\u0022q\u0022`)],
  ])("reads %s as corrupt, with no best-effort parsing", (_label, text) => {
    expect(parseAcceptanceRecord(bytesOf(text), ATTEMPT)).toBeNull();
  });

  it("rejects a record read under another attempt's filename", () => {
    expect(parseAcceptanceRecord(bytesOf(PINNED_FILE), "99999999-2222-4333-8444-555555555555")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real filesystem (an OS temporary directory, never the repository)

const POLICY = process.platform === "win32" ? "DEVELOPMENT_BEST_EFFORT" : "REQUIRED";
let root: string;
const records = () => join(root, "acceptance-journal", "v1");
const finalFile = () => join(records(), `${ATTEMPT}.json`);

describe("journal on the real filesystem", () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "busybookie-acceptance-journal-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("prepares the owner-only layout and refuses an unsuitable state root", async () => {
    const journal = createAcceptanceJournal({ stateRoot: root, directorySync: POLICY, clock });
    const prepared = await journal.prepare();
    expect((await readdir(join(root, "acceptance-journal"))).sort()).toEqual(["quarantine", "v1"]);
    expect(await readdir(records())).toEqual([]);
    if (process.platform !== "win32") {
      expect(prepared.directorySyncSupported).toBe(true);
      for (const directory of ["acceptance-journal", "acceptance-journal/v1", "acceptance-journal/quarantine"]) {
        expect((await stat(join(root, directory))).mode & 0o777).toBe(0o700);
      }
    }
    // A literal ".." segment (path.join would normalise it away before the guard saw it).
    for (const stateRoot of ["relative/state", `${root}${sep}..${sep}escape`, `${root}\0x`]) {
      expect(() => createAcceptanceJournal({ stateRoot, directorySync: POLICY })).toThrow(AcceptanceJournalError);
    }
    await expect(createAcceptanceJournal({ stateRoot: join(root, "missing"), directorySync: POLICY }).prepare()).rejects.toMatchObject({
      code: "STATE_ROOT_UNSUITABLE",
    });
  });

  it("publishes the exact bytes by exclusive link, removes the temporary, and reads them back as the only evidence", async () => {
    const journal = createAcceptanceJournal({ stateRoot: root, directorySync: POLICY, clock });
    await journal.prepare();
    expect(await journal.read(ATTEMPT)).toEqual({ status: "NOT_FOUND" });

    const result = await journal.write(INPUT);
    expect(result).toMatchObject({ outcome: "PUBLISHED", temporaryRemoved: true });
    expect(result.directorySynced).toBe(process.platform !== "win32" || result.directorySynced);
    expect(await readFile(finalFile(), "latin1")).toBe(PINNED_FILE);
    expect(await readdir(records())).toEqual([`${ATTEMPT}.json`]);
    if (process.platform !== "win32") expect((await stat(finalFile())).mode & 0o777).toBe(0o600);
    expect(await journal.read(ATTEMPT)).toEqual({ status: "VALID_RECORD", record: result.record });

    // No secret-bearing text can be present: the bytes are exactly the closed record.
    const text = await readFile(finalFile(), "latin1");
    expect(/token|credential|sealed|fingerprint|bearer|authorization|prompt|https?:/i.test(text)).toBe(false);
  });

  it("treats a byte-identical republication as idempotent and leaves the record untouched", async () => {
    const journal = createAcceptanceJournal({ stateRoot: root, directorySync: POLICY, clock });
    await journal.prepare();
    const first = await journal.write(INPUT);
    const again = await journal.publish(first.record);
    expect(again).toMatchObject({ outcome: "ALREADY_PUBLISHED", temporaryRemoved: true });
    expect(await readFile(finalFile(), "latin1")).toBe(PINNED_FILE);
    expect(await readdir(records())).toEqual([`${ATTEMPT}.json`]);
  });

  it("never overwrites a conflicting record, and keeps both the record and the new temporary", async () => {
    const journal = createAcceptanceJournal({ stateRoot: root, directorySync: POLICY, clock });
    await journal.prepare();
    await journal.write(INPUT);
    expect(await codeOf(journal.write({ ...INPUT, providerExecutionId: "a-different-execution" }))).toBe("ACCEPTANCE_JOURNAL_CONFLICT");
    // A later clock reading also differs in bytes: only byte-identical republication is idempotent.
    const later = createAcceptanceJournal({ stateRoot: root, directorySync: POLICY, clock: () => new Date("2026-11-11T10:00:02.000Z") });
    expect(await codeOf(later.write(INPUT))).toBe("ACCEPTANCE_JOURNAL_CONFLICT");
    expect(await readFile(finalFile(), "latin1")).toBe(PINNED_FILE);
    const entries = await readdir(records());
    expect(entries.filter((name) => name.endsWith(".tmp"))).toHaveLength(2);
  });

  it("fails closed on a corrupt published record without deleting or replacing its bytes", async () => {
    const journal = createAcceptanceJournal({ stateRoot: root, directorySync: POLICY, clock });
    await journal.prepare();
    const corrupt = PINNED_FILE.slice(0, 80);
    await writeFile(finalFile(), corrupt, "latin1");
    expect(await journal.read(ATTEMPT)).toEqual({ status: "CORRUPT_RECORD" });
    expect(await codeOf(journal.write(INPUT))).toBe("ACCEPTANCE_JOURNAL_CORRUPT");
    expect(await readFile(finalFile(), "latin1")).toBe(corrupt);
    // Published records are moved to quarantine only by an operator (section 17).
    expect(await readdir(join(root, "acceptance-journal", "quarantine"))).toEqual([]);
  });

  it("reports a valid record with a different expected identity as conflicting", async () => {
    const journal = createAcceptanceJournal({ stateRoot: root, directorySync: POLICY, clock });
    await journal.prepare();
    await journal.write(INPUT);
    expect((await journal.read(ATTEMPT, { provider: "EXAMPLE_PROVIDER", fencingCounter: 3 })).status).toBe("VALID_RECORD");
    expect((await journal.read(ATTEMPT, { provider: "OTHER_PROVIDER" })).status).toBe("CONFLICTING_RECORD");
    expect((await journal.read(ATTEMPT, { generationRequestSha256: "d".repeat(64) })).status).toBe("CONFLICTING_RECORD");
  });

  it("never builds a path from a malformed attempt identity", async () => {
    const journal = createAcceptanceJournal({ stateRoot: root, directorySync: POLICY, clock });
    await journal.prepare();
    for (const attemptId of ["../escape", `${ATTEMPT}/../x`, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee".toUpperCase(), ""]) {
      expect(await codeOf(journal.read(attemptId))).toBe("ACCEPTANCE_RECORD_INVALID");
    }
    for (const name of ["../x.0123456789abcdef0123456789abcdef.tmp", `${ATTEMPT}.json`, `${ATTEMPT}.short.tmp`]) {
      expect(await codeOf(journal.inspectTemporary(name))).toBe("ACCEPTANCE_RECORD_INVALID");
    }
  });

  describe("crash points (section 17)", () => {
    const TEMP = `${ATTEMPT}.0123456789abcdef0123456789abcdef.tmp`;

    it("before any temporary exists: nothing is evidence", async () => {
      const journal = createAcceptanceJournal({ stateRoot: root, directorySync: POLICY, clock });
      await journal.prepare();
      expect(await journal.read(ATTEMPT)).toEqual({ status: "NOT_FOUND" });
    });

    it("an incomplete temporary is never evidence, and is quarantined with its bytes preserved", async () => {
      const journal = createAcceptanceJournal({ stateRoot: root, directorySync: POLICY, clock });
      await journal.prepare();
      const partial = PINNED_FILE.slice(0, 120);
      await writeFile(join(records(), TEMP), partial, "latin1");
      expect(await journal.read(ATTEMPT)).toEqual({ status: "NOT_FOUND" });
      expect(await journal.inspectTemporary(TEMP)).toEqual({ status: "INVALID_TEMPORARY" });
      await journal.quarantineInvalidTemporary(TEMP);
      expect(await readdir(records())).toEqual([]);
      expect(await readFile(join(root, "acceptance-journal", "quarantine", TEMP), "latin1")).toBe(partial);
    });

    it("a complete temporary (synced or not) is still not evidence until linked, and is never quarantined", async () => {
      const journal = createAcceptanceJournal({ stateRoot: root, directorySync: POLICY, clock });
      await journal.prepare();
      await writeFile(join(records(), TEMP), PINNED_FILE, "latin1");
      expect(await journal.read(ATTEMPT)).toEqual({ status: "NOT_FOUND" });
      const inspected = await journal.inspectTemporary(TEMP);
      expect(inspected.status).toBe("VALID_TEMPORARY");
      expect(await codeOf(journal.quarantineInvalidTemporary(TEMP))).toBe("ACCEPTANCE_JOURNAL_CONFLICT");
      // Completing publication from step 4 uses exactly the temporary's record.
      if (inspected.status === "VALID_TEMPORARY") {
        expect((await journal.publish(inspected.record)).outcome).toBe("PUBLISHED");
      }
      expect(await journal.read(ATTEMPT)).toMatchObject({ status: "VALID_RECORD" });
    });

    it("a linked final record (before or after the directory flush) reads back as the same evidence", async () => {
      const journal = createAcceptanceJournal({ stateRoot: root, directorySync: POLICY, clock });
      await journal.prepare();
      // Simulate a crash after link and before step 6/7: final and temporary both present.
      await writeFile(join(records(), TEMP), PINNED_FILE, "latin1");
      await writeFile(finalFile(), PINNED_FILE, "latin1");
      const read = await journal.read(ATTEMPT);
      expect(read.status).toBe("VALID_RECORD");
      // Restart: republishing the same record is idempotent and completes steps 6 and 7.
      if (read.status === "VALID_RECORD") expect((await journal.publish(read.record)).outcome).toBe("ALREADY_PUBLISHED");
    });
  });
});

// ---------------------------------------------------------------------------
// Ordering and failure handling on an in-memory filesystem

type Call = string;

function memoryFileSystem(overrides: Partial<Record<keyof JournalFileSystem | "dirSync" | "write" | "sync", (path: string) => Error | undefined>> = {}) {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>();
  const calls: Call[] = [];
  const fail = (name: keyof typeof overrides, path: string) => {
    const error = overrides[name]?.(path);
    if (error !== undefined) throw error;
  };
  const err = (code: string) => Object.assign(new Error(code), { code });
  const fs: JournalFileSystem = {
    readDirectory: async (path) => [...files.keys()].filter((file) => file.startsWith(path + sep)).map((file) => ({ name: file.slice(path.length + 1), regularFile: true })),
    openExclusive: async (path, mode) => {
      calls.push(`openExclusive ${path.split(/[\\/]/).pop()} ${mode.toString(8)}`);
      fail("openExclusive", path);
      if (files.has(path)) throw err("EEXIST");
      files.set(path, new Uint8Array());
      return {
        writeFile: async (data) => {
          calls.push("write");
          fail("write", path);
          files.set(path, data);
        },
        sync: async () => {
          calls.push("sync");
          fail("sync", path);
        },
        close: async () => {
          calls.push("close");
        },
      };
    },
    openDirectory: async (path) => {
      calls.push(`openDirectory ${path.split(/[\\/]/).pop()}`);
      fail("openDirectory", path);
      return {
        sync: async () => {
          calls.push("dirSync");
          fail("dirSync", path);
        },
        close: async () => {
          calls.push("dirClose");
        },
      };
    },
    link: async (from, to) => {
      calls.push(`link ${from.split(/[\\/]/).pop()} -> ${to.split(/[\\/]/).pop()}`);
      fail("link", to);
      if (files.has(to)) throw err("EEXIST");
      files.set(to, files.get(from)!);
    },
    unlink: async (path) => {
      calls.push(`unlink ${path.split(/[\\/]/).pop()}`);
      fail("unlink", path);
      if (!files.delete(path)) throw err("ENOENT");
    },
    readFile: async (path) => {
      const data = files.get(path);
      if (data === undefined) throw err("ENOENT");
      return data;
    },
    makeDirectory: async (path) => {
      if (directories.has(path)) throw err("EEXIST");
      directories.add(path);
    },
    chmod: async (path, mode) => {
      calls.push(`chmod ${path.split(/[\\/]/).pop()} ${mode.toString(8)}`);
    },
    isDirectory: async (path) => directories.has(path) || path === STATE_ROOT,
  };
  return { fs, files, calls };
}

const STATE_ROOT = process.platform === "win32" ? "C:\\worker-state" : "/var/lib/worker-state";
const SUFFIXES = ["a".repeat(32), "b".repeat(32), "c".repeat(32), "d".repeat(32), "e".repeat(32)];
const suffixes = () => {
  let index = 0;
  return () => SUFFIXES[index++ % SUFFIXES.length]!;
};

describe("write algorithm ordering (section 17, steps 2-7)", () => {
  it("creates the temporary exclusively, writes, syncs, closes, chmods, links, flushes the directory, then unlinks", async () => {
    const memory = memoryFileSystem();
    const journal = createAcceptanceJournal({ stateRoot: STATE_ROOT, directorySync: "REQUIRED", fileSystem: memory.fs, randomSuffix: suffixes(), clock });
    const result = await journal.write(INPUT);
    expect(result).toMatchObject({ outcome: "PUBLISHED", directorySynced: true, temporaryRemoved: true });
    const temp = `${ATTEMPT}.${"a".repeat(32)}.tmp`;
    expect(memory.calls).toEqual([
      `openExclusive ${temp} 600`,
      "write",
      "sync",
      "close",
      `chmod ${temp} 600`,
      `link ${temp} -> ${ATTEMPT}.json`,
      "openDirectory v1",
      "dirSync",
      "dirClose",
      `unlink ${temp}`,
    ]);
    // Never rename, copy or write the final path directly.
    expect(memory.calls.some((call) => /rename|copy/.test(call) || call.startsWith(`openExclusive ${ATTEMPT}.json`))).toBe(false);
  });

  it("takes a fresh random suffix on a temporary-name collision, and gives up after four", async () => {
    const collide = (count: number) => {
      let collisions = 0;
      return memoryFileSystem({ openExclusive: () => (collisions++ < count ? Object.assign(new Error("EEXIST"), { code: "EEXIST" }) : undefined) });
    };
    const once = collide(1);
    await createAcceptanceJournal({ stateRoot: STATE_ROOT, directorySync: "REQUIRED", fileSystem: once.fs, randomSuffix: suffixes(), clock }).write(INPUT);
    expect(once.calls.filter((call) => call.startsWith("openExclusive"))).toEqual([
      `openExclusive ${ATTEMPT}.${"a".repeat(32)}.tmp 600`,
      `openExclusive ${ATTEMPT}.${"b".repeat(32)}.tmp 600`,
    ]);
    const always = collide(10);
    expect(
      await codeOf(createAcceptanceJournal({ stateRoot: STATE_ROOT, directorySync: "REQUIRED", fileSystem: always.fs, randomSuffix: suffixes(), clock }).write(INPUT)),
    ).toBe("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    expect(always.calls.filter((call) => call.startsWith("openExclusive"))).toHaveLength(4);
    // A malformed suffix is never used as a filename.
    expect(
      await codeOf(createAcceptanceJournal({ stateRoot: STATE_ROOT, directorySync: "REQUIRED", fileSystem: memoryFileSystem().fs, randomSuffix: () => "../x", clock }).write(INPUT)),
    ).toBe("ACCEPTANCE_JOURNAL_WRITE_FAILED");
  });

  it.each([
    ["the temporary write", "write"],
    ["the file sync", "sync"],
  ] as const)("fails closed when %s fails, publishing nothing", async (_label, step) => {
    const memory = memoryFileSystem({ [step]: () => new Error("EIO") });
    const journal = createAcceptanceJournal({ stateRoot: STATE_ROOT, directorySync: "REQUIRED", fileSystem: memory.fs, randomSuffix: suffixes(), clock });
    expect(await codeOf(journal.write(INPUT))).toBe("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    expect(memory.calls).toContain("close");
    expect(memory.calls.some((call) => call.startsWith("link"))).toBe(false);
    expect(await journal.read(ATTEMPT)).toEqual({ status: "NOT_FOUND" });
  });

  it.each(["EPERM", "EXDEV", "ENOTSUP", "EISDIR"])("has no fallback when link fails with %s", async (code) => {
    const memory = memoryFileSystem({ link: () => Object.assign(new Error(code), { code }) });
    const journal = createAcceptanceJournal({ stateRoot: STATE_ROOT, directorySync: "REQUIRED", fileSystem: memory.fs, randomSuffix: suffixes(), clock });
    expect(await codeOf(journal.write(INPUT))).toBe("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    expect(memory.calls.at(-1)).toMatch(/^link /);
    expect(await journal.read(ATTEMPT)).toEqual({ status: "NOT_FOUND" });
  });

  it("treats a directory-flush failure as a write failure under REQUIRED, and reports it under DEVELOPMENT_BEST_EFFORT", async () => {
    const required = memoryFileSystem({ dirSync: () => new Error("EINVAL") });
    expect(
      await codeOf(createAcceptanceJournal({ stateRoot: STATE_ROOT, directorySync: "REQUIRED", fileSystem: required.fs, randomSuffix: suffixes(), clock }).write(INPUT)),
    ).toBe("ACCEPTANCE_JOURNAL_WRITE_FAILED");
    // The temporary is kept for the startup scan; nothing claims durability.
    expect(required.calls.some((call) => call.startsWith("unlink"))).toBe(false);

    const development = memoryFileSystem({ openDirectory: () => Object.assign(new Error("EISDIR"), { code: "EISDIR" }) });
    const result = await createAcceptanceJournal({
      stateRoot: STATE_ROOT,
      directorySync: "DEVELOPMENT_BEST_EFFORT",
      fileSystem: development.fs,
      randomSuffix: suffixes(),
      clock,
    }).write(INPUT);
    expect(result).toMatchObject({ outcome: "PUBLISHED", directorySynced: false });
  });

  it("refuses a state root without link or directory-flush support under REQUIRED", async () => {
    const noLink = memoryFileSystem({ link: () => Object.assign(new Error("EPERM"), { code: "EPERM" }) });
    expect(await codeOf(createAcceptanceJournal({ stateRoot: STATE_ROOT, directorySync: "REQUIRED", fileSystem: noLink.fs, randomSuffix: suffixes() }).prepare())).toBe(
      "STATE_ROOT_UNSUITABLE",
    );
    const noFlush = memoryFileSystem({ openDirectory: () => Object.assign(new Error("EISDIR"), { code: "EISDIR" }) });
    expect(await codeOf(createAcceptanceJournal({ stateRoot: STATE_ROOT, directorySync: "REQUIRED", fileSystem: noFlush.fs, randomSuffix: suffixes() }).prepare())).toBe(
      "STATE_ROOT_UNSUITABLE",
    );
    const development = memoryFileSystem({ openDirectory: () => Object.assign(new Error("EISDIR"), { code: "EISDIR" }) });
    expect(
      await createAcceptanceJournal({ stateRoot: STATE_ROOT, directorySync: "DEVELOPMENT_BEST_EFFORT", fileSystem: development.fs, randomSuffix: suffixes() }).prepare(),
    ).toEqual({ directorySyncSupported: false });
    // Directories are created owner-only, and the mode is applied explicitly.
    expect(development.calls.filter((call) => call.startsWith("chmod")).slice(0, 3)).toEqual(["chmod acceptance-journal 700", "chmod v1 700", "chmod quarantine 700"]);
  });

  it("only republishes a record that passes the strict reader", async () => {
    const memory = memoryFileSystem();
    const journal = createAcceptanceJournal({ stateRoot: STATE_ROOT, directorySync: "REQUIRED", fileSystem: memory.fs, randomSuffix: suffixes(), clock });
    const record = buildAcceptanceRecord(INPUT, RECORDED_AT);
    for (const tampered of [
      { ...record, recordSha256: "0".repeat(64) },
      { ...record, fencingCounter: 4 },
      { ...record, leaseToken: "secret" },
    ]) {
      expect(await codeOf(journal.publish(tampered as AcceptanceRecord))).toBe("ACCEPTANCE_RECORD_INVALID");
    }
    expect(memory.calls).toEqual([]);
  });
});
