import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fixture, seed, outputWindow, planFor, jobId, video, type Fixture, type Provider,
  type WorkerRequest, type Evidence } from "./helpers/controlledEpisodeBudgetRestartWorker.js";
import { parseEpisodeAutomationPlan } from "../src/execution/episodeAutomationPlan.schema.js";
import { inspectExecutionLifecycle } from "../src/execution/inspectExecutionLifecycle.js";
import { rawSha256 } from "../src/execution/episodeInputBinding.js";

// Evidence belongs to the test parent/report, never a production cursor or ledger.
const roots: string[] = [];
const evidencePaths = new Map<string, { scenarios: string; audits: string }>();
afterEach(async context => {
  const owned = roots.splice(0);
  if (context.task.result?.state === "fail") {
    console.error("B7D failed fixture evidence retained:", owned); return;
  }
  for (const root of owned) {
    const paths = evidencePaths.get(root)!;
    const audits = await readdir(paths.audits);
    let deniedAttempts = 0;
    for (const name of audits) {
      const audit = (await readFile(join(paths.audits, name), "utf8")).trim();
      if (audit) deniedAttempts += audit.split("\n").length;
    }
    const scenarios = (await readFile(paths.scenarios, "utf8")).trim();
    console.info("B7D1_TEST_OWNED_AUDIT", JSON.stringify({ root, children: audits.length, deniedAttempts,
      scenarioRows: scenarios ? scenarios.split("\n").length : 0 }));
    expect(deniedAttempts).toBe(0);
    expect(dirname(root)).toBe(process.cwd()); expect(root.startsWith(join(process.cwd(), ".b7d-budget-"))).toBe(true);
    await rm(root, { recursive: true });
    evidencePaths.delete(root);
  }
});
async function make(provider: Provider = "RUNWAY", count = 1) {
  const f = await fixture(provider, count); roots.push(f.root);
  const paths = { scenarios: join(f.root, "scenario-evidence.jsonl"), audits: join(f.root, "network-audits") };
  evidencePaths.set(f.root, paths);
  await mkdir(paths.audits); await writeFile(paths.scenarios, "", { flag: "wx" });
  return f;
}
function record(f: Fixture, value: unknown) {
  const paths = evidencePaths.get(f.root);
  if (!paths) throw Error("Missing test-owned fixture evidence paths");
  appendFileSync(paths.scenarios, JSON.stringify(value) + "\n");
}
async function child(request: WorkerRequest): Promise<Evidence> {
  const paths = evidencePaths.get(request.f.root)!;
  const auditPath = join(paths.audits, `${randomUUID()}.jsonl`);
  await writeFile(auditPath, "", { flag: "wx" });
  const env: NodeJS.ProcessEnv = { ...process.env, B7D_NETWORK_AUDIT: auditPath };
  // Child protection comes only from the committed startup helper.
  delete env.NODE_OPTIONS; delete env.B7D_BOOTSTRAP_INSTALLED; delete env.B7D_SCENARIO_EVIDENCE;
  const worker = fork(fileURLToPath(new URL("./helpers/controlledEpisodeBudgetRestartWorker.ts", import.meta.url)), ["--b7d-worker"],
    { execArgv: ["--import", new URL("./helpers/b7dOfflineBootstrap.mjs", import.meta.url).href, "--import", "tsx"],
      env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let output = "", stderr = "";
  worker.stdout!.on("data", chunk => { output += String(chunk); }); worker.stderr!.on("data", chunk => { stderr += String(chunk); });
  let evidence: Evidence | undefined, failure: unknown;
  worker.on("message", (message: { evidence?: Evidence; error?: unknown }) => { evidence = message.evidence; failure = message.error; });
  const exited = new Promise<number | null>((done, reject) => { worker.once("exit", done); worker.once("error", reject); });
  const timer = setTimeout(() => { failure = "B7D child timeout"; worker.kill(); }, 30000);
  worker.send(request);
  try {
    const code = await exited;
    const audit = (await readFile(auditPath, "utf8")).trim();
    const deniedAttempts = audit ? audit.split("\n").length : 0;
    if (code !== 0 || !evidence || failure) {
      record(request.f, { scenario: request.scenario, childPid: worker.pid, code, failure, stderr, output,
        networkAuditPath: auditPath, networkAuditCount: deniedAttempts, retainedRoot: request.f.root });
      throw Error(`B7D worker failed: ${JSON.stringify({ code, failure, stderr })}`);
    }
    const { plan: _plan, ...row } = evidence; record(request.f, { ...row, networkAuditPath: auditPath });
    expect(deniedAttempts).toBe(0);
    expect(evidence.childPid).not.toBe(process.pid);
    expect(evidence.forbiddenCreates).toBe(0); expect(evidence.fallback).toBe(0);
    expect(evidence.networkAuditCount).toBe(0); expect(evidence.guardResult).toBe("ABSENT");
    return evidence;
  } finally { clearTimeout(timer); if (worker.exitCode === null && worker.signalCode === null) worker.kill(); }
}
function counts(e: Evidence, creates: number, recoveries: number, r: number, s: number, c: number) {
  expect([e.createAttempts, e.recoveryDispatches, e.after.R, e.after.S, e.after.C]).toEqual([creates, recoveries, r, s, c]);
}
function unchanged(e: Evidence) { expect(e.after).toEqual(e.before); expect(e.createAttempts).toBe(0); expect(e.recoveryDispatches).toBe(0); }

describe("B7D fresh-process restart accounting through published secured execution", () => {
  it("three RESERVED_ONLY restarts preserve manual adjudication and cannot create or recover", async () => {
    const f = await make(); const staleGeneration = await planFor(f); expect(staleGeneration).not.toBeNull();
    await seed(f, "RESERVED_ONLY");
    const pids = new Set<number>(); let previous: Evidence["after"] | undefined;
    for (let n = 0; n < 3; n++) {
      const e = await child({ f, scenario: `B-reserved-restart-${n}`, mode: "replay", plan: staleGeneration! }); pids.add(e.childPid);
      counts(e, 0, 0, 1, 0, 0); unchanged(e); expect(e.frontierAfter).toBe("RESERVED_ONLY_MANUAL_ADJUDICATION");
      expect(e.generationAllowance).toBe(0); expect(e.recoveryAllowance).toBe(0);
      if (previous) expect(e.after).toEqual(previous); previous = e.after;
    }
    expect(pids.size).toBe(3);
  }, 120000);

  it.each(["RUNWAY", "VEO", "GOOGLE_GENAI"] as const)("%s recovery repeats only the exact existing job with a zero-create budget", async provider => {
    const f = await make(provider); await seed(f, "SUBMITTED");
    const recoveryPlan = await planFor(f); expect(recoveryPlan?.maximumNewProviderCreates).toBe(0);
    let previous: Evidence["after"] | undefined; const pids = new Set<number>();
    for (let n = 0; n < 3; n++) {
      const e = await child({ f, scenario: `C-K-${provider}-pending-${n}`, mode: "recover", pending: true }); pids.add(e.childPid);
      counts(e, 0, 1, 1, 1, 0); expect(e.after).toEqual(e.before);
      expect(e.lookedUp).toEqual([jobId(provider, "S01")]); expect(e.threw).toBe(true);
      expect(e.generationAllowance).toBe(0); expect(e.recoveryAllowance).toBe(1);
      if (previous) expect(e.after).toEqual(previous); previous = e.after;
    }
    expect(pids.size).toBe(3);
    const recovered = await child({ f, scenario: `C-K-M-${provider}-recover`, mode: "recover" });
    counts(recovered, 0, 1, 1, 1, 1); expect(recovered.lookedUp).toEqual([jobId(provider, "S01")]);
    expect(recovered.completion).toBe("VISUAL_PRODUCTION_COMPLETE"); expect(recovered.status).toBe("ACTION_COMPLETED");
    for (let n = 0; n < 3; n++) {
      const e = await child({ f, scenario: `F-${provider}-completed-stale-${n}`, mode: "replay", plan: recoveryPlan! });
      counts(e, 0, 0, 1, 1, 1); unchanged(e); expect(e.stopReason).toBe("INPUT_BINDING_DRIFT");
      expect(e.observations[0]).toMatchObject({ lifecycle: "COMPLETED", disposition: "COMPLETED", verification: "VERIFIED" });
    }
    const lifecycle = await inspectExecutionLifecycle(f.mediaRoot, "EP02", "S01");
    if (lifecycle.state !== "COMPLETED") throw Error("Missing completion");
    const generation = JSON.parse(await readFile(lifecycle.completion.generationRecordPath, "utf8")) as { outputs: { destinationPath: string }[] };
    await writeFile(generation.outputs[0]!.destinationPath, "corrupt-existing-completion");
    for (let n = 0; n < 3; n++) {
      const e = await child({ f, scenario: `G-${provider}-corrupt-restart-${n}`, mode: "inspect" });
      counts(e, 0, 0, 1, 1, 1); unchanged(e); expect(e.completion).toBe("INCOMPLETE");
      expect(e.observations[0]).toMatchObject({ lifecycle: "COMPLETED", disposition: "ERROR", verification: "FAILED" });
      expect(e.nextActionKind).toBeNull(); expect(e.generationMayBeAuthorized).toBe(false);
      expect(e.frontierAfter).not.toMatch(/VISUAL_GENERATE/);
    }
  }, 180000);

  it.each(["OUTPUT", "RECORD", "CONFLICT", "RECORD_CONFLICT"] as const)("E %s before completion is reused exactly or preserved on refusal", async window => {
    const f = await make(); await seed(f, "SUBMITTED"); const path = await outputWindow(f, window);
    const beforeOutput = rawSha256(await readFile(path));
    const e = await child({ f, scenario: `E-window-${window}`, mode: "recover" });
    const conflict = window === "CONFLICT" || window === "RECORD_CONFLICT";
    counts(e, 0, 1, 1, 1, conflict ? 0 : 1); expect(e.lookedUp).toEqual([jobId("RUNWAY", "S01")]);
    expect(rawSha256(await readFile(path))).toBe(beforeOutput);
    expect(e.threw).toBe(conflict); expect(e.observations[0]!.lifecycle).toBe(conflict ? "SUBMITTED" : "COMPLETED");
    if (!conflict) expect(await readFile(path)).toEqual(video);
    record(f, { scenario: `E-window-${window}-byte-preservation`, beforeOutput, afterOutput: rawSha256(await readFile(path)), conflict });
  }, 60000);

  it("M disabled Google blocks frontier matching with no create or cross-provider fallback", async () => {
    const f = await make("GOOGLE_GENAI");
    const e = await child({ f, scenario: "M-disabled-google-new-generation", mode: "denyGoogle" });
    counts(e, 0, 0, 0, 0, 0); unchanged(e); expect(e.status).toBe("REJECTED");
    expect(e.generationAllowance).toBe(0); expect(e.frontierAfter).toBe("PROVIDER_ACTIVATION_BLOCKED");
    expect(e.stopReason).toBe("EARLIER_EPISODE_WORK_UNRESOLVED");
    expect(JSON.parse(await readFile(join(f.repositoryRoot, "config/google-genai-activation-policy.json"), "utf8")).admission.newSubmissionsEnabled).toBe(false);
    expect(() => parseEpisodeAutomationPlan({ ...e.plan!, maximumNewProviderCreates: 0 })).toThrow();
  }, 60000);

  it("I rejects recovery with a generation budget and generation with a zero-create budget", async () => {
    const f = await make(); const generation = await planFor(f); expect(generation).not.toBeNull();
    expect(() => parseEpisodeAutomationPlan({ ...generation!, maximumNewProviderCreates: 0 })).toThrow();
    await seed(f, "SUBMITTED"); const recovery = await planFor(f); expect(recovery).not.toBeNull();
    expect(() => parseEpisodeAutomationPlan({ ...recovery!, maximumNewProviderCreates: 1 })).toThrow();
    const e = await child({ f, scenario: "I-parser-negatives-state-unchanged", mode: "inspect" }); unchanged(e); counts(e, 0, 0, 1, 1, 0);
  });

  it("A-D-J-L-O three fresh-process generations and recoveries account for exactly three durable jobs", async () => {
    const f = await make("RUNWAY", 3); let creates = 0, recoveries = 0;
    const allPids = new Set<number>(), ids = new Set<string>(), reservations = new Set<string>();
    for (let shot = 1; shot <= 3; shot++) {
      const id = `S0${shot}`;
      const generated = await child({ f, scenario: `O-${id}-reviewed-generation-D-post-submission-error`, mode: "generate" });
      allPids.add(generated.childPid); creates += generated.createAttempts;
      counts(generated, 1, 0, shot, shot, shot - 1); expect(generated.threw).toBe(true);
      expect(generated.generationAllowance).toBe(1); expect(generated.recoveryAllowance).toBe(0);
      expect(generated.frontierBefore).toBe(`${id}:VISUAL_GENERATE`); expect(generated.frontierAfter).toBe(`${id}:VISUAL_RECONCILE`);
      expect(generated.stopReason).toBe("SUBMITTED_RECOVERY_REQUIRED");
      expect([creates, recoveries, generated.after.R, generated.after.S, generated.after.C]).toEqual([shot, shot - 1, shot, shot, shot - 1]);
      for (let repeat = 0; repeat < 3; repeat++) {
        const replay = await child({ f, scenario: `O-${id}-unchanged-submission-replay-${repeat}`, mode: "replay", plan: generated.plan! });
        allPids.add(replay.childPid); unchanged(replay); expect(replay.after).toEqual(generated.after);
        expect(replay.stopReason).toBe("INPUT_BINDING_DRIFT"); expect(replay.generationAllowance).toBe(0);
      }
      const recovered = await child({ f, scenario: `O-${id}-reviewed-exact-job-recovery`, mode: "recover" });
      allPids.add(recovered.childPid); recoveries += recovered.recoveryDispatches;
      counts(recovered, 0, 1, shot, shot, shot); expect(recovered.lookedUp).toEqual([jobId("RUNWAY", id)]);
      expect(recovered.status).toBe("ACTION_COMPLETED"); expect(recovered.observations.slice(0, shot).every(o => o.verification === "VERIFIED")).toBe(true);
      expect([creates, recoveries, recovered.after.R, recovered.after.S, recovered.after.C]).toEqual([shot, shot, shot, shot, shot]);
      const replay = await child({ f, scenario: `O-${id}-completed-stale-action`, mode: "replay", plan: recovered.plan! });
      allPids.add(replay.childPid); unchanged(replay); expect(replay.after).toEqual(recovered.after);
      expect(replay.frontierAfter).toBe(shot === 3 ? "VISUAL_PRODUCTION_COMPLETE" : `S0${shot + 1}:VISUAL_GENERATE`);
      for (const row of recovered.after.rows) if (row.jobId) { ids.add(row.jobId); reservations.add(row.reservationId!); }
      expect(ids.size).toBe(shot); expect(reservations.size).toBe(shot);
      expect(recovered.after.rows.filter(r => r.state === "COMPLETED").map(r => r.shot)).toEqual(f.shotIds.slice(0, shot));
      expect(recovered.after.rows.filter(r => r.state !== "NOTHING").map(r => r.jobId)).toEqual(f.shotIds.slice(0, shot).map(s => jobId("RUNWAY", s)));
      record(f, { scenario: `O-${id}-cumulative`, creates, recoveries, R: shot, S: shot, C: shot,
        providerJobs: [...ids], reservationIds: [...reservations], completionSet: recovered.after.rows.filter(r => r.state === "COMPLETED").map(r => r.shot) });
    }
    expect([creates, recoveries, ids.size, reservations.size, allPids.size]).toEqual([3, 3, 3, 3, 18]);
  }, 240000);
});
