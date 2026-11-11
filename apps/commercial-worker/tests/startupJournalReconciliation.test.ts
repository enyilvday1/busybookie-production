import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAcceptanceRecord, createAcceptanceJournal, nodeJournalFileSystem, serializeAcceptanceRecord,
  type AcceptanceJournal, type AcceptanceRecord, type JournalFileSystem,
} from "../src/acceptanceJournal.js";
import { runCredentialOpeningOnce, type WorkerLogEvent } from "../src/credentialOpeningRun.js";
import { reconcileStartupJournal } from "../src/startupJournalReconciliation.js";

const A = "11111111-2222-4333-8444-555555555555";
const B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TIME = new Date("2026-11-11T10:00:01.500Z");
const record = (executionAttemptId = A, providerExecutionId = "synthetic/operations/one"): AcceptanceRecord => buildAcceptanceRecord({
  executionAttemptId, executionJobId: "66666666-7777-4888-9999-aaaaaaaaaaaa", accountId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  attemptNumber: 1, fencingCounter: 3, provider: "EXAMPLE_PROVIDER", generationRequestSha256: "c".repeat(64),
  submittingAt: new Date("2026-11-11T10:00:00.000Z"), providerExecutionId, providerAcceptedAt: new Date("2026-11-11T10:00:01.250Z"),
}, TIME);
const POLICY = process.platform === "win32" ? "DEVELOPMENT_BEST_EFFORT" : "REQUIRED";
const tempName = (id = A, suffix = "a") => `${id}.${suffix.repeat(32)}.tmp`;
let stateRoot: string;
let journal: AcceptanceJournal;
const records = () => join(stateRoot, "acceptance-journal", "v1");
const final = (id = A) => join(records(), `${id}.json`);
const temporary = (id = A, suffix = "a") => join(records(), tempName(id, suffix));
const makeJournal = (fileSystem = nodeJournalFileSystem) => createAcceptanceJournal({ stateRoot, directorySync: POLICY, fileSystem });
beforeEach(async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("outbound calls are forbidden in startup reconciliation"));
  stateRoot = await mkdtemp(join(tmpdir(), "busybookie-startup-journal-"));
  journal = makeJournal();
  await journal.prepare();
});
afterEach(async () => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  await rm(stateRoot, { recursive: true, force: true });
});

function gated(journalDependency: AcceptanceJournal = journal) {
  const client = { leaseNextAttempt: vi.fn(async () => null), requestCredentialGrant: vi.fn() };
  const opener = { open: vi.fn() };
  const events: WorkerLogEvent[] = [];
  const run = () => runCredentialOpeningOnce({ environment: {}, journal: journalDependency, client, opener, log: (event) => events.push(event) });
  return { client, opener, events, run };
}
async function blocked(expectedCode: string, dependency = journal) {
  const run = gated(dependency);
  await expect(run.run()).rejects.toMatchObject({ code: expectedCode });
  expect(run.client.leaseNextAttempt).not.toHaveBeenCalled();
  expect(run.client.requestCredentialGrant).not.toHaveBeenCalled();
  expect(run.opener.open).not.toHaveBeenCalled();
  expect(run.events).toEqual([{ stage: "STARTUP", outcome: "FAILED", code: expectedCode }]);
  return run;
}

describe("local startup reconciliation (section 17 and restart matrix A-H)", () => {
  it("empty startup remains CLEAR across restarts and permits the existing lease path", async () => {
    expect(await reconcileStartupJournal(journal)).toEqual({ status: "CLEAR", quarantinedTemporaryCount: 0 });
    expect(await reconcileStartupJournal(journal)).toEqual({ status: "CLEAR", quarantinedTemporaryCount: 0 });
    const run = gated();
    expect(await run.run()).toEqual({ status: "NO_WORK" });
    expect(run.client.leaseNextAttempt).toHaveBeenCalledTimes(1);
    expect(run.client.requestCredentialGrant).not.toHaveBeenCalled();
  });

  it("retains a published final byte-for-byte and blocks leases on every restart", async () => {
    await journal.publish(record());
    const before = await readFile(final());
    for (let restart = 0; restart < 2; restart++) {
      expect((await reconcileStartupJournal(journal)).status).toBe("UNRESOLVED_ACCEPTANCE");
      await blocked("ACCEPTANCE_RECONCILIATION_FAILED");
      expect(await readFile(final())).toEqual(before);
      expect(await readdir(records())).toEqual([`${A}.json`]);
    }
  });

  it("completes an interrupted pre-link publication using the original exact record, time and digest", async () => {
    // Crash between steps 3 and 4: leave the real writer's complete temporary.
    const interrupted = makeJournal({ ...nodeJournalFileSystem, link: async (source, target) => {
      if (target.endsWith(".json")) throw new Error("simulated pre-link crash");
      await nodeJournalFileSystem.link(source, target);
    } });
    const original = record();
    await expect(interrupted.publish(original)).rejects.toMatchObject({ code: "ACCEPTANCE_JOURNAL_WRITE_FAILED" });
    const [name] = await readdir(records());
    const originalBytes = await readFile(join(records(), name!));
    const publish = vi.fn(journal.publish);
    const write = vi.fn(journal.write);
    const startup = { ...journal, publish, write };
    expect((await reconcileStartupJournal(startup)).status).toBe("UNRESOLVED_ACCEPTANCE");
    expect(write).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledExactlyOnceWith(original);
    expect(await readFile(final())).toEqual(originalBytes);
    expect(await journal.read(A)).toEqual({ status: "VALID_RECORD", record: original });
    expect(await readdir(records())).toEqual([`${A}.json`]);
    expect((await reconcileStartupJournal(journal)).status).toBe("UNRESOLVED_ACCEPTANCE");
    await blocked("ACCEPTANCE_RECONCILIATION_FAILED");
  });

  it("handles a post-link crash and duplicate identical temporaries without duplicate finals", async () => {
    await journal.publish(record());
    await link(final(), temporary());
    await writeFile(temporary(A, "b"), serializeAcceptanceRecord(record()));
    expect((await reconcileStartupJournal(journal)).status).toBe("UNRESOLVED_ACCEPTANCE");
    expect(await readdir(records())).toEqual([`${A}.json`]);
    expect((await reconcileStartupJournal(journal)).status).toBe("UNRESOLVED_ACCEPTANCE");
  });

  it("quarantines invalid temporary bytes once, logs a safe corruption code, then allows fresh work", async () => {
    const bytes = Buffer.from('{"partial":"fixture-secret-provider-payload');
    await writeFile(temporary(), bytes);
    const run = gated();
    expect(await run.run()).toEqual({ status: "NO_WORK" });
    expect(run.client.leaseNextAttempt).toHaveBeenCalledTimes(1);
    expect(await readFile(join(stateRoot, "acceptance-journal", "quarantine", tempName()))).toEqual(bytes);
    expect(await readdir(records())).toEqual([]);
    expect(run.events[0]).toEqual({ stage: "STARTUP", outcome: "OK", code: "ACCEPTANCE_JOURNAL_CORRUPT" });
    expect(JSON.stringify(run.events)).not.toContain("fixture-secret");
    expect(await reconcileStartupJournal(journal)).toEqual({ status: "CLEAR", quarantinedTemporaryCount: 0 });
  });

  it("restarts after a quarantine link crash without overwriting or duplicating evidence", async () => {
    await writeFile(temporary(), "partial");
    const quarantined = join(stateRoot, "acceptance-journal", "quarantine", tempName());
    await link(temporary(), quarantined);
    expect(await reconcileStartupJournal(journal)).toEqual({ status: "CLEAR", quarantinedTemporaryCount: 1 });
    expect(await readFile(quarantined, "utf8")).toBe("partial");
    expect(await reconcileStartupJournal(journal)).toEqual({ status: "CLEAR", quarantinedTemporaryCount: 0 });
  });

  it("blocks conflicting quarantine evidence without overwriting either file", async () => {
    await writeFile(temporary(), "partial-one");
    await writeFile(join(stateRoot, "acceptance-journal", "quarantine", tempName()), "partial-two");
    expect((await reconcileStartupJournal(journal)).status).toBe("CONFLICT");
    await blocked("ACCEPTANCE_JOURNAL_CONFLICT");
    expect(await readFile(temporary(), "utf8")).toBe("partial-one");
  });

  it("preserves a corrupt final for operator attention across repeated startup", async () => {
    await writeFile(final(), "corrupt-final");
    for (let restart = 0; restart < 2; restart++) {
      expect((await reconcileStartupJournal(journal)).status).toBe("CORRUPT");
      await blocked("ACCEPTANCE_JOURNAL_CORRUPT");
      expect(await readFile(final(), "utf8")).toBe("corrupt-final");
    }
  });

  it.each(["provider ID", "recordedAt"])("detects a final/temporary conflict in %s without changing either", async (difference) => {
    const original = record();
    const conflicting = difference === "provider ID" ? record(A, "synthetic/operations/two") : buildAcceptanceRecord({
      ...original, submittingAt: new Date(original.submittingAt), providerAcceptedAt: new Date(original.providerAcceptedAt),
    }, new Date(TIME.getTime() + 1));
    await journal.publish(original);
    await writeFile(temporary(), serializeAcceptanceRecord(conflicting));
    expect((await reconcileStartupJournal(journal)).status).toBe("CONFLICT");
    await blocked("ACCEPTANCE_JOURNAL_CONFLICT");
    expect(await readFile(final(), "utf8")).toBe(serializeAcceptanceRecord(original));
    expect(await readFile(temporary(), "utf8")).toBe(serializeAcceptanceRecord(conflicting));
  });

  it("does not choose a winner between conflicting valid temporaries with no final", async () => {
    await writeFile(temporary(), serializeAcceptanceRecord(record()));
    await writeFile(temporary(A, "b"), serializeAcceptanceRecord(record(A, "synthetic/operations/two")));
    expect((await reconcileStartupJournal(journal)).status).toBe("CONFLICT");
    expect(await readdir(records())).toEqual([tempName(), tempName(A, "b")]);
    await blocked("ACCEPTANCE_JOURNAL_CONFLICT");
  });

  it("processes multiple entries lexically regardless of filesystem order, retaining all valid evidence", async () => {
    await writeFile(temporary(B), serializeAcceptanceRecord(record(B)));
    await writeFile(temporary(), serializeAcceptanceRecord(record()));
    await writeFile(temporary(A, "b"), "partial");
    const reversed = makeJournal({ ...nodeJournalFileSystem, readDirectory: async (path) => [...await nodeJournalFileSystem.readDirectory(path)].reverse() });
    const seen: string[] = [];
    const inspectTemporary: AcceptanceJournal["inspectTemporary"] = async (name) => { seen.push(name); return reversed.inspectTemporary(name); };
    expect(await reconcileStartupJournal({ ...reversed, inspectTemporary })).toEqual({ status: "UNRESOLVED_ACCEPTANCE", quarantinedTemporaryCount: 1 });
    expect(seen).toEqual([tempName(), tempName(A, "b"), tempName(B)]);
    expect((await readdir(records())).sort()).toEqual([`${A}.json`, `${B}.json`]);
    expect((await reconcileStartupJournal(journal)).status).toBe("UNRESOLVED_ACCEPTANCE");
  });

  it.each(["unexpected.txt", `${B.toUpperCase()}.json`, `${A}.abc.tmp`, `${A}.${"A".repeat(32)}.tmp`, "..\\escape.json", "../escape.json", `${A}\n.json`, `${tempName()}\n`])("refuses unexpected or traversal filename %s before reading it", async (name) => {
    const fs = { ...nodeJournalFileSystem, readDirectory: async () => [{ name, regularFile: true }] };
    const read = vi.fn(fs.readFile);
    const dependency = makeJournal({ ...fs, readFile: read });
    expect((await reconcileStartupJournal(dependency)).status).toBe("CORRUPT");
    expect(read).not.toHaveBeenCalled();
    await blocked("ACCEPTANCE_JOURNAL_CORRUPT", dependency);
  });

  it("fails closed on a directory or symlink posing as a record", async () => {
    await mkdir(final());
    expect((await reconcileStartupJournal(journal)).status).toBe("CORRUPT");
    const dependency = makeJournal({ ...nodeJournalFileSystem, readDirectory: async () => [{ name: `${A}.json`, regularFile: false }] });
    await blocked("ACCEPTANCE_JOURNAL_CORRUPT", dependency);
  });

  it("does not treat a discovered final disappearing during inspection as a clear scan", async () => {
    const dependency = { ...journal, enumerate: async () => [{ kind: "FINAL" as const, executionAttemptId: A }] };
    expect((await reconcileStartupJournal(dependency)).status).toBe("CORRUPT");
    await blocked("ACCEPTANCE_JOURNAL_CORRUPT", dependency);
  });

  it.each(["absent", "conflicting"])("never removes a valid temporary when its final is %s", async (state) => {
    await writeFile(temporary(), serializeAcceptanceRecord(record()));
    if (state === "conflicting") await journal.publish(record(A, "synthetic/operations/other"));
    await expect(journal.removePublishedTemporary(tempName())).rejects.toMatchObject({
      code: state === "absent" ? "ACCEPTANCE_JOURNAL_CORRUPT" : "ACCEPTANCE_JOURNAL_CONFLICT",
    });
    expect(await readFile(temporary(), "utf8")).toBe(serializeAcceptanceRecord(record()));
  });

  it("does not complete a valid temporary over a corrupt final", async () => {
    await writeFile(final(), "corrupt");
    await writeFile(temporary(), serializeAcceptanceRecord(record()));
    expect((await reconcileStartupJournal(journal)).status).toBe("CORRUPT");
    expect(await readFile(final(), "utf8")).toBe("corrupt");
    expect(await readFile(temporary(), "utf8")).toBe(serializeAcceptanceRecord(record()));
  });

  it.each(["scan", "read", "publication", "quarantine", "temporary cleanup"])("fails closed on %s I/O failure without raw error leakage", async (stage) => {
    const fail = async (): Promise<never> => { throw new Error("secret-token/provider-payload/absolute-path"); };
    if (stage === "read") await journal.publish(record());
    if (["publication", "temporary cleanup"].includes(stage)) await writeFile(temporary(), serializeAcceptanceRecord(record()));
    if (stage === "quarantine") await writeFile(temporary(), "partial");
    const dependency = { ...journal,
      ...(stage === "scan" ? { enumerate: fail } : {}), ...(stage === "read" ? { read: fail } : {}),
      ...(stage === "publication" ? { publish: fail } : {}), ...(stage === "quarantine" ? { quarantineInvalidTemporary: fail } : {}),
      ...(stage === "temporary cleanup" ? { removePublishedTemporary: fail } : {}),
    };
    const run = await blocked("ACCEPTANCE_JOURNAL_CORRUPT", dependency);
    expect(JSON.stringify(run.events)).not.toContain("secret-token");
  });

  it.each(["root absent", "link unsupported", "required directory sync"])("refuses startup when %s, before any lease or grant", async (failure) => {
    const fail = async (): Promise<never> => { throw new Error("secret-state-root"); };
    const fileSystem: JournalFileSystem = { ...nodeJournalFileSystem,
      ...(failure === "root absent" ? { isDirectory: async () => false } : {}),
      ...(failure === "link unsupported" ? { link: fail } : {}),
      ...(failure === "required directory sync" ? { openDirectory: fail } : {}),
    };
    const dependency = createAcceptanceJournal({ stateRoot, directorySync: "REQUIRED", fileSystem });
    await blocked("STATE_ROOT_UNSUITABLE", dependency);
  });

  it("keeps Windows development best-effort distinct from required durability", async () => {
    const fileSystem = { ...nodeJournalFileSystem, openDirectory: async (): Promise<never> => { throw new Error("unsupported"); } };
    const dependency = createAcceptanceJournal({ stateRoot, directorySync: "DEVELOPMENT_BEST_EFFORT", fileSystem });
    expect(await dependency.prepare()).toEqual({ directorySyncSupported: false });
    expect((await reconcileStartupJournal(dependency)).status).toBe("CLEAR");
  });

  it("has no lease request while preparation or reconciliation is still pending", async () => {
    const order: string[] = [];
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const dependency = { ...journal, prepare: async () => { order.push("prepare"); return journal.prepare(); }, enumerate: async () => {
      order.push("scan"); await wait; order.push("clear"); return journal.enumerate();
    } };
    const run = gated(dependency);
    run.client.leaseNextAttempt.mockImplementation(async () => { order.push("lease"); return null; });
    const pending = run.run();
    await vi.waitFor(() => expect(order).toContain("scan"));
    expect(run.client.leaseNextAttempt).not.toHaveBeenCalled();
    release();
    await pending;
    expect(order).toEqual(["prepare", "scan", "clear", "lease"]);
  });

  it("refuses a missing composition value instead of allowing a startup bypass", async () => {
    await blocked("STATE_ROOT_UNSUITABLE", null as unknown as AcceptanceJournal);
  });
});
