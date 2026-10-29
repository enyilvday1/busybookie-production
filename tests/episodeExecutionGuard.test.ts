import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, access, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { acquireEpisodeExecutionGuard, assertEpisodeGuardOwner, releaseEpisodeExecutionGuard,
  episodeExecutionGuardPath, createEpisodeInvocation, admitEpisodeCoordinatorDispatch,
  consumeEpisodeGenerationAllowance, consumeEpisodeRecoveryDispatch, episodeInvocationCounts } from "../src/execution/episodeExecutionGuard.js";

const classifier = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("node:child_process", async importOriginal => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  classifier.query.mockImplementation(promisify(actual.execFile));
  return { ...actual, execFile: Object.assign(vi.fn(actual.execFile), { [promisify.custom]: classifier.query }) };
});

describe.skipIf(process.platform !== "win32")("exact Windows fixed-filesystem classification", () => {
  it.each(["Fixed:NTFS", "Fixed:ReFS", "Fixed:exFAT"])("accepts %j", async stdout => {
    const mediaRoot = await mkdtemp(join(process.cwd(), ".b7-classifier-"));
    classifier.query.mockResolvedValueOnce({ stdout, stderr: "" });
    try {
      const owner = await acquireEpisodeExecutionGuard({ mediaRoot, episodeId: "EP02", manifestRawSha256: "a".repeat(64), sessionId: randomUUID() });
      await assertEpisodeGuardOwner(owner, mediaRoot, "EP02");
      await releaseEpisodeExecutionGuard(owner);
      await expect(access(episodeExecutionGuardPath(mediaRoot, "EP02"))).rejects.toThrow();
    } finally { await rm(mediaRoot, { recursive: true, force: true }); }
  });
  it.each(["Removable:exFAT", "Fixed:FAT32", "Fixed:FAT", "Network:NTFS", "Unknown:exFAT", "", "invalid",
    "Fixed:exFAT\n", "Fixed:exFAT\r\n", " Fixed:exFAT", "Fixed:exfat", "Fixed:exFAT\nFixed:NTFS"])("refuses %j before publishing a guard", async stdout => {
    const mediaRoot = await mkdtemp(join(process.cwd(), ".b7-classifier-"));
    classifier.query.mockResolvedValueOnce({ stdout, stderr: "" });
    try {
      await expect(acquireEpisodeExecutionGuard({ mediaRoot, episodeId: "EP02", manifestRawSha256: "a".repeat(64), sessionId: randomUUID() }))
        .rejects.toMatchObject({ code: "EPISODE_OWNERSHIP_CONFLICT", cause: { message: "Unsupported guard filesystem." } });
      await expect(access(join(mediaRoot, "generated-video"))).rejects.toThrow();
    } finally { await rm(mediaRoot, { recursive: true, force: true }); }
  });
});

describe("episode ownership and conservative allowance", () => {
  it("a killed owner leaves a guard that a fresh invocation cannot take over", async () => {
    const mediaRoot = await mkdtemp(join(process.cwd(), ".b7-guard-crash-"));
    const script = `const {acquireEpisodeExecutionGuard}=await import(process.argv[2]); await acquireEpisodeExecutionGuard({mediaRoot:process.argv[1],episodeId:'EP02',manifestRawSha256:'a'.repeat(64),sessionId:crypto.randomUUID()});process.stdout.write('OWNED');await new Promise(resolve=>process.stdin.once('data',resolve));`;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, mediaRoot,
      new URL("../src/execution/episodeExecutionGuard.ts", import.meta.url).href], { windowsHide: true });
    try {
      await new Promise<void>((resolve, reject) => { child.once("error", reject); child.stdout.once("data", () => resolve()); });
      const evidence = await readFile(episodeExecutionGuardPath(mediaRoot, "EP02"), "utf8");
      const exited = new Promise<void>(resolve => child.once("exit", () => resolve())); child.kill(); await exited;
      await expect(acquireEpisodeExecutionGuard({ mediaRoot, episodeId: "EP02", manifestRawSha256: "a".repeat(64), sessionId: randomUUID() }))
        .rejects.toMatchObject({ code: "EPISODE_OWNERSHIP_CONFLICT" });
      expect(await readFile(episodeExecutionGuardPath(mediaRoot, "EP02"), "utf8")).toBe(evidence);
    } finally { child.kill(); await rm(mediaRoot, { recursive: true, force: true }); }
  }, 15000);
  it("refuses path aliases and linked parent namespaces before publishing ownership", async () => {
    const mediaRoot = await mkdtemp(join(process.cwd(), ".b7-guard-link-"));
    try {
      const input = { mediaRoot, episodeId: "EP02", manifestRawSha256: "a".repeat(64), sessionId: randomUUID() };
      await expect(acquireEpisodeExecutionGuard({ ...input, mediaRoot: `${mediaRoot}\\..\\${mediaRoot.split("\\").at(-1)}` })).rejects.toThrow();
      await mkdir(join(mediaRoot, "foreign")); await mkdir(join(mediaRoot, "generated-video"));
      await symlink(join(mediaRoot, "foreign"), join(mediaRoot, "generated-video/EP02"), process.platform === "win32" ? "junction" : "dir");
      await expect(acquireEpisodeExecutionGuard(input)).rejects.toMatchObject({ code: "EPISODE_OWNERSHIP_CONFLICT" });
      await expect(access(join(mediaRoot, "foreign/.episode-execution-guard.json"))).rejects.toThrow();
    } finally { await rm(mediaRoot, { recursive: true, force: true }); }
  });
  it("two processes on different shots have one episode owner and one zero-create loser", async () => {
    const mediaRoot = await mkdtemp(join(process.cwd(), ".b7-guard-process-"));
    const worker = `
      const { acquireEpisodeExecutionGuard, releaseEpisodeExecutionGuard } = await import(process.argv[2]);
      let creates = 0;
      try {
        const owner = await acquireEpisodeExecutionGuard({mediaRoot:process.argv[1],episodeId:'EP02',manifestRawSha256:'a'.repeat(64),sessionId:crypto.randomUUID()});
        creates++;
        process.stdout.write(JSON.stringify({state:'OWNED',creates,shot:process.argv[3]})+'\\n');
        await new Promise(resolve=>process.stdin.once('data',resolve));
        await releaseEpisodeExecutionGuard(owner);
      } catch(error) { process.stdout.write(JSON.stringify({state:'CONFLICT',creates})+'\\n'); }
    `;
    const url = new URL("../src/execution/episodeExecutionGuard.ts", import.meta.url).href;
    const start = (shot: string) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", worker, mediaRoot, url, shot], { windowsHide: true });
      const first = new Promise<{ state: string; creates: number }>((resolve, reject) => {
        let output = "";
        child.on("error", reject);
        child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); if (output.includes("\n")) resolve(JSON.parse(output.split("\n")[0]!)); });
        child.on("exit", code => { if (!output) reject(new Error(`Guard worker exited ${code}.`)); });
      });
      const exited = new Promise<void>((resolve, reject) => child.once("exit", code => code === 0 ? resolve() : reject(new Error("Guard worker failed."))));
      return { child, first, exited };
    };
    const workers = [start("S01"), start("S02")];
    try {
      const results = await Promise.all(workers.map(worker => worker.first));
      expect(results.filter(row => row.state === "OWNED")).toHaveLength(1);
      expect(results.filter(row => row.state === "CONFLICT")).toEqual([{ state: "CONFLICT", creates: 0 }]);
      expect(results.reduce((sum, row) => sum + row.creates, 0)).toBe(1);
      for (const worker of workers) worker.child.stdin.end("release\n");
      await Promise.all(workers.map(worker => worker.exited));
    } finally { for (const worker of workers) worker.child.kill(); await rm(mediaRoot, { recursive: true, force: true }); }
  }, 15000);
  it("admits one owner, supports opaque adoption and releases only that owner", async () => {
    const mediaRoot = await mkdtemp(join(process.cwd(), ".b7-guard-"));
    try {
      const input = { mediaRoot, episodeId: "EP02", manifestRawSha256: "a".repeat(64), sessionId: randomUUID() };
      const first = await acquireEpisodeExecutionGuard(input);
      await assertEpisodeGuardOwner(first, mediaRoot, "EP02");
      await expect(assertEpisodeGuardOwner({ episodeId: "EP02" }, mediaRoot, "EP02")).rejects.toMatchObject({ code: "EPISODE_OWNERSHIP_CONFLICT" });
      await expect(acquireEpisodeExecutionGuard(input)).rejects.toMatchObject({ code: "EPISODE_OWNERSHIP_CONFLICT" });
      await expect(assertEpisodeGuardOwner(first, mediaRoot, "EP03")).rejects.toThrow();
      await releaseEpisodeExecutionGuard(first);
      await expect(access(episodeExecutionGuardPath(mediaRoot, "EP02"))).rejects.toThrow();
      await expect(releaseEpisodeExecutionGuard(first)).rejects.toThrow();
    } finally { await rm(mediaRoot, { recursive: true, force: true }); }
  });
  it("preserves altered, partial and apparently stale evidence", async () => {
    const mediaRoot = await mkdtemp(join(process.cwd(), ".b7-guard-"));
    try {
      const input = { mediaRoot, episodeId: "EP02", manifestRawSha256: "a".repeat(64), sessionId: randomUUID() };
      const owner = await acquireEpisodeExecutionGuard(input);
      const path = episodeExecutionGuardPath(mediaRoot, "EP02");
      const payload = JSON.parse(await readFile(path, "utf8"));
      payload.ownerNonce = randomUUID(); payload.createdAt = "2000-01-01T00:00:00.000Z"; payload.processId = 1;
      const foreign = JSON.stringify(payload);
      await writeFile(path, foreign);
      await expect(releaseEpisodeExecutionGuard(owner)).rejects.toThrow();
      expect(await readFile(path, "utf8")).toBe(foreign);
      await expect(acquireEpisodeExecutionGuard(input)).rejects.toThrow();
      await writeFile(path, "{");
      await expect(acquireEpisodeExecutionGuard(input)).rejects.toThrow();
      expect(await readFile(path, "utf8")).toBe("{");
    } finally { await rm(mediaRoot, { recursive: true, force: true }); }
  });
  it("never refunds the private generation latch and rejects reentry or forged contexts", () => {
    const context = createEpisodeInvocation("EP02", 1);
    admitEpisodeCoordinatorDispatch(context);
    consumeEpisodeGenerationAllowance(context);
    expect(episodeInvocationCounts(context)).toEqual({ dispatchAllowanceConsumed: 1, recoveryDispatchCount: 0 });
    expect(() => consumeEpisodeGenerationAllowance(context)).toThrow();
    expect(() => admitEpisodeCoordinatorDispatch(context)).toThrow();
    expect(() => consumeEpisodeGenerationAllowance({ episodeId: "EP02" })).toThrow();
    expect(() => consumeEpisodeRecoveryDispatch(context)).toThrow();
    const recovery = createEpisodeInvocation("EP02", 0);
    admitEpisodeCoordinatorDispatch(recovery);
    expect(() => consumeEpisodeGenerationAllowance(recovery)).toThrow();
    consumeEpisodeRecoveryDispatch(recovery);
    expect(() => consumeEpisodeRecoveryDispatch(recovery)).toThrow();
  });
});
