import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeManifestSchema } from "../src/schemas/episodeManifest.schema.js";
import { ProductionRulesSchema } from "../src/schemas/productionRules.schema.js";
import { buildBoundEpisodePreflight } from "../src/execution/buildBoundEpisodePreflight.js";
import { rawSha256, bindingDigest } from "../src/execution/episodeInputBinding.js";
import type { RuntimeIdentity, EvidenceAdoption } from "../src/execution/boundEpisodeProduction.types.js";
import { createExecutionReservation } from "../src/execution/createExecutionReservation.js";
import { createExecutionSubmission } from "../src/execution/createExecutionSubmission.js";
import { createExecutionCompletion } from "../src/execution/createExecutionCompletion.js";
import { buildRunwayGenerationRecord } from "../src/runway/audit/buildRunwayGenerationRecord.js";
import { writeRunwayGenerationRecord } from "../src/runway/audit/writeRunwayGenerationRecord.js";
import { createRunwayVideoOutputPath } from "../src/runway/output/runwayOutputPath.js";
import { GoogleGenAiPolicySchema } from "../src/schemas/googleGenAiPolicy.schema.js";
import { materializeGoogleGenAiSingleShotOutput } from "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js";
import { persistGoogleGenAiSingleShotCompletion } from "../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js";
import { runEpisodeAutomation } from "../src/execution/runEpisodeAutomation.js";
import { coordinateEpisodeAction, episodeCoordinatorProductionDependencies, type CoordinateBoundEpisodeActionInput,
  type CoordinateEpisodeActionInput, type CoordinateEpisodeActionResult } from "../src/execution/coordinateEpisodeAction.js";
import { createFreshEpisodeOperatorSession, acquireEpisodeExecutionGuard, episodeExecutionGuardPath } from "../src/execution/episodeExecutionGuard.js";
import { parseEpisodeAutomationPlan } from "../src/execution/episodeAutomationPlan.schema.js";
import { runProductionExecutionReconcileCli } from "../src/execution/cli/runProductionExecutionReconcileCli.js";
import { runExecutionReconcileCli, type RunExecutionReconcileCliDependencies } from "../src/execution/cli/runExecutionReconcileCli.js";
import { reconcileExecutionLifecycle } from "../src/execution/reconcileExecutionLifecycle.js";
import { createRunwayTaskLookupClient } from "../src/runway/execution/createRunwayTaskLookupClient.js";
import { inspectExecutionLifecycle } from "../src/execution/inspectExecutionLifecycle.js";
import type { BoundEpisodeActionResult } from "../src/execution/boundEpisodeProduction.types.js";
import { resolveDurableEpisodeProductionState } from "../src/execution/resolveDurableEpisodeProductionState.js";
import { resolveDurableShotVisualGenerationState } from "../src/execution/resolveDurableShotVisualGenerationState.js";
import { resolveDurableShotDialogueCompositionState } from "../src/dialogue/resolveDurableShotDialogueCompositionState.js";
import { verifyLocalCompletedVisualExecution } from "../src/execution/verifyLocalCompletedVisualExecution.js";
import { verifyApprovedVisualReferenceAsset } from "../src/execution/verifyApprovedVisualReferenceAsset.js";
import { readBoundFile } from "../src/execution/episodeInputBinding.js";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(provider: "RUNWAY" | "GOOGLE_GENAI" = "RUNWAY") {
  const root = await mkdtemp(join(process.cwd(), ".b7-plan-")); roots.push(root);
  const repositoryRoot = join(root, "repo"); const mediaRoot = join(root, "media");
  await mkdir(join(repositoryRoot, "episodes/EP02"), { recursive: true });
  await mkdir(join(repositoryRoot, "config"), { recursive: true });
  await mkdir(join(mediaRoot, "references"), { recursive: true });
  const episode = EpisodeManifestSchema.parse(JSON.parse(await readFile("episodes/EP02/episode.json", "utf8")));
  episode.status = "IN_PRODUCTION"; episode.approvals.script = "APPROVED";
  episode.approvals.storyboard = "APPROVED"; episode.approvals.references = "APPROVED";
  const template = episode.scenes[0]!.shots[0]!;
  const shot = (id: string, order: number) => ({ ...structuredClone(template), id, order,
    references: { required: true, assetIds: ["ref"], approvalStatus: "APPROVED" as const },
    generation: { provider, nativeAudio: false, status: "APPROVED_FOR_GENERATION" as const } });
  episode.scenes = [{ ...episode.scenes[0]!, id: "SC02", shots: [shot("S10", 3), shot("S11", 1)] },
    { ...episode.scenes[0]!, id: "SC01", shots: [shot("S01", 2)] }];
  for (const name of ["characters.json", "provider-routing-policy.json", "runway-policy.json", "veo-policy.json", "google-genai-policy.json", "google-genai-activation-policy.json"]) {
    await writeFile(join(repositoryRoot, "config", name), await readFile(join("config", name)));
  }
  const rules = ProductionRulesSchema.parse(JSON.parse(await readFile("config/production-rules.json", "utf8")));
  rules.storage.requireExternalMediaRoot = false;
  await writeFile(join(repositoryRoot, "config/production-rules.json"), JSON.stringify(rules));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbQAAAABJRU5ErkJggg==", "base64");
  await writeFile(join(mediaRoot, "references/ref.png"), png);
  const asset = { assetId: "ref", mediaRootRelativePath: "references/ref.png", bytes: png.length, sha256: rawSha256(png), contentType: "image/png" };
  await writeFile(join(mediaRoot, "references/visual-reference-asset-registry.json"), JSON.stringify({ schemaVersion: "1.0", assets: [asset] }));
  await writeFile(join(repositoryRoot, "runtime.txt"), "reviewed-runtime");
  const runtimeIdentity: RuntimeIdentity = { reviewedRevision: "a".repeat(40), repositoryRoot, mediaRoot, physicalMediaRoot: mediaRoot,
    executableInputs: [{ role: "RUNTIME", canonicalPath: join(repositoryRoot, "runtime.txt"), exists: true,
      rawSha256: rawSha256("reviewed-runtime"), bytes: 16 }], ffprobe: null };
  const manifest = join(repositoryRoot, "episodes/EP02/episode.json");
  const save = () => writeFile(manifest, JSON.stringify(episode)); await save();
  return { episode, save, manifest, root, repositoryRoot, mediaRoot, runtimeIdentity, asset,
    input: { episodeId: "EP02", mediaRoot, runtimeIdentity } };
}
async function accepted(f: Awaited<ReturnType<typeof fixture>>, shotId: string) {
  const reservation = await createExecutionReservation(f.mediaRoot, { episodeId: "EP02", shotId, provider: "RUNWAY" });
  const request = { durationSeconds: 5, ratio: "1280:720", outputFormat: "mp4", promptText: "Synthetic restart evidence.",
    sourceImagePath: join(f.mediaRoot, "references/ref.png"), assetStrategy: "DATA_URI" } as const;
  const providerExecutionId = `synthetic-private-job-${shotId}`;
  await createExecutionSubmission(f.mediaRoot, { reservationId: reservation.record.reservationId, episodeId: "EP02", shotId,
    provider: "RUNWAY", providerExecutionId, providerEstimatedCredits: 60, recoveryMetadata: { request, locallyExpectedCredits: 60 } });
  return { reservation, request, providerExecutionId };
}
async function complete(f: Awaited<ReturnType<typeof fixture>>, shotId: string, acceptedJob: Awaited<ReturnType<typeof accepted>>) {
  const path = createRunwayVideoOutputPath(f.mediaRoot, "EP02", shotId, acceptedJob.providerExecutionId, 1);
  await mkdir(dirname(path), { recursive: true }); const bytes = Buffer.from("synthetic-local-video-evidence"); await writeFile(path, bytes);
  const record = buildRunwayGenerationRecord({ recordedAt: "2026-10-28T12:00:00.000Z", episodeId: "EP02", shotId,
    taskId: acceptedJob.providerExecutionId, request: acceptedJob.request, credits: { locallyExpected: 60, providerEstimated: 60, providerFinal: 60 },
    outputs: [{ outputIndex: 1, destinationPath: path, bytes: bytes.length, sha256: rawSha256(bytes), contentType: "video/mp4" }] });
  const recordPath = await writeRunwayGenerationRecord(f.mediaRoot, record);
  await createExecutionCompletion(f.mediaRoot, { reservationId: acceptedJob.reservation.record.reservationId, episodeId: "EP02", shotId,
    provider: "RUNWAY", providerExecutionId: acceptedJob.providerExecutionId, generationRecordPath: recordPath });
  return path;
}
async function restartFixture() {
  const f = await fixture(); const template = f.episode.scenes[0]!.shots[0]!;
  f.episode.scenes = [{ ...f.episode.scenes[0]!, id: "SC01", shots: Array.from({ length: 5 }, (_, index) => ({
    ...structuredClone(template), id: `S0${index + 1}`, order: index + 1 })) }];
  await f.save(); return f;
}
async function reviewedEvidence(f: Awaited<ReturnType<typeof fixture>>): Promise<readonly EvidenceAdoption[]> {
  const report = await buildBoundEpisodePreflight(f.input);
  const manifest = report.binding?.fileBindings.find(file => file.role === "MANIFEST")?.rawSha256;
  if (!manifest) throw new Error("Missing test manifest binding.");
  return report.observations.filter(observation => observation.lifecycle === "SUBMITTED" || observation.lifecycle === "COMPLETED")
    .map(observation => ({ target: observation.target, manifestRawSha256: manifest, observationSha256: bindingDigest(observation) }));
}
describe("fresh restart derives continuation only from verified durable evidence", () => {
  it("current reference failures remain visible without erasing verified completed lineage", async () => {
    const f = await restartFixture(); await complete(f, "S01", await accepted(f, "S01"));
    await rm(join(f.mediaRoot, "references/ref.png"));
    const report = await buildBoundEpisodePreflight(f.input);
    expect(report.shots[0]).toMatchObject({ disposition: "COMPLETED", completionVerification: "VERIFIED",
      currentReferenceIssues: [expect.objectContaining({ code: "REFERENCE_UNAVAILABLE" })] });
  });
  it.each(["BEFORE_DISPATCH", "AFTER_RESERVATION", "AFTER_ACCEPTANCE", "AFTER_SUBMISSION", "AFTER_OUTPUT", "AFTER_COMPLETION", "BEFORE_POST_STATE"])(
    "a killed owner at %s preserves durable evidence and cannot grant automatic continuation", async stage => {
      const f = await restartFixture();
      const script = `const {acquireEpisodeExecutionGuard}=await import(process.argv[2]); await acquireEpisodeExecutionGuard({mediaRoot:process.argv[1],episodeId:'EP02',manifestRawSha256:'a'.repeat(64),sessionId:crypto.randomUUID()}); console.log('OWNED'); await new Promise(resolve=>process.stdin.once('data',resolve));`;
      const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, f.mediaRoot,
        new URL("../src/execution/episodeExecutionGuard.ts", import.meta.url).href], { windowsHide: true });
      try {
        await new Promise<void>((resolve, reject) => { child.once("error", reject); child.stdout.once("data", () => resolve());
          child.once("exit", code => { if (code) reject(new Error("Synthetic owner failed before crash boundary.")); }); });
        if (["AFTER_RESERVATION", "AFTER_ACCEPTANCE"].includes(stage)) {
          await createExecutionReservation(f.mediaRoot, { episodeId: "EP02", shotId: "S01", provider: "RUNWAY" });
        } else if (stage !== "BEFORE_DISPATCH") {
          const job = await accepted(f, "S01");
          if (["AFTER_COMPLETION", "BEFORE_POST_STATE"].includes(stage)) await complete(f, "S01", job);
          else if (stage === "AFTER_OUTPUT") {
            const path = createRunwayVideoOutputPath(f.mediaRoot, "EP02", "S01", job.providerExecutionId, 1);
            await mkdir(dirname(path), { recursive: true }); await writeFile(path, "synthetic-output-before-record");
          }
        }
        const retainedGuard = await readFile(episodeExecutionGuardPath(f.mediaRoot, "EP02"));
        const exited = new Promise<void>(resolve => child.once("exit", () => resolve())); child.kill(); await exited;
        const report = await buildBoundEpisodePreflight(f.input);
        const lifecycle = stage === "BEFORE_DISPATCH" ? "NOTHING" : ["AFTER_RESERVATION", "AFTER_ACCEPTANCE"].includes(stage)
          ? "RESERVED_ONLY" : ["AFTER_COMPLETION", "BEFORE_POST_STATE"].includes(stage) ? "COMPLETED" : "SUBMITTED";
        expect(report.shots[0]!.lifecycle.lifecycle).toBe(lifecycle);
        expect(report.ownership.observed).toBe("CONFLICT"); expect(report.generationMayBeAuthorized).toBe(false);
        await expect(acquireEpisodeExecutionGuard({ mediaRoot: f.mediaRoot, episodeId: "EP02", manifestRawSha256: "a".repeat(64),
          sessionId: crypto.randomUUID() })).rejects.toMatchObject({ code: "EPISODE_OWNERSHIP_CONFLICT" });
        expect(await readFile(episodeExecutionGuardPath(f.mediaRoot, "EP02"))).toEqual(retainedGuard);
        expect((await inspectExecutionLifecycle(f.mediaRoot, "EP02", "S01")).state).toBe(lifecycle);
      } finally { child.kill(); }
    }, 30000);
  it("a failed second local verification replaces COMPLETED with ERROR and cannot count complete", async () => {
    const f = await restartFixture(); await complete(f, "S01", await accepted(f, "S01"));
    let verifications = 0;
    const result = await buildBoundEpisodePreflight(f.input, { readFile: readBoundFile, inspectLifecycle: inspectExecutionLifecycle,
      resolveEpisode: resolveDurableEpisodeProductionState, resolveVisual: resolveDurableShotVisualGenerationState,
      resolveDialogue: resolveDurableShotDialogueCompositionState, verifyReference: verifyApprovedVisualReferenceAsset,
      verifyComplete: async (...args) => { if (++verifications > 1) throw new Error("Synthetic completion disappeared on final verification.");
        return verifyLocalCompletedVisualExecution(...args); } });
    expect(result.shots[0]).toMatchObject({ disposition: "ERROR", completionVerification: "FAILED" });
    expect(result.counts.episode.COMPLETED).toBe(0); expect(result.nextActionCandidate).toBeNull();
  });
  it("C7 and C6b use the same secured recovery CLI exactly once, with zero new creates, and stop after completion", async () => {
    const f = await restartFixture();
    await complete(f, "S01", await accepted(f, "S01")); await complete(f, "S02", await accepted(f, "S02"));
    const third = await accepted(f, "S03"); const adoptions = await reviewedEvidence(f);
    const reviewed = await buildBoundEpisodePreflight({ ...f.input, evidenceAdoptions: adoptions });
    const observation = reviewed.observations[2]!;
    const plan = parseEpisodeAutomationPlan({ schemaVersion: "2.0", mode: "CONTROLLED_VISUAL", episodeId: "EP02",
      scope: reviewed.scope, inputBinding: reviewed.binding, inputBindingSha256: reviewed.bindingSha256,
      observations: reviewed.observations, observationsSha256: reviewed.observationsSha256, evidenceAdoptions: adoptions,
      maximumNewProviderCreates: 0, operatingCondition: { singleOperator: true, noConcurrentAuthoring: true, noUnguardedRunners: true },
      actions: [{ ...observation.target, kind: "VISUAL_RECONCILE", expectedLifecycle: "SUBMITTED", confirmReconciliation: true,
        reservationId: observation.reservationId, durableProvider: observation.durableProvider, reservationSha256: observation.reservationSha256,
        submissionSha256: observation.submissionSha256, providerExecutionIdentitySha256: observation.providerExecutionIdentitySha256 }] });
    let recoveryCalls = 0;
    const generate = vi.fn(async () => { throw new Error("New create tripwire during recovery."); });
    const cli: RunExecutionReconcileCliDependencies = {
      loadEnvironment: () => ({ BUSYBOOKIE_MEDIA_ROOT: f.mediaRoot, RUNWAYML_API_SECRET: "synthetic-recovery-credential" }),
      loadProductionRules: async () => { throw new Error("Unchecked rules tripwire."); }, resolveMediaRoot: () => f.mediaRoot,
      inspectLifecycle: inspectExecutionLifecycle, createRunwayTaskLookupClient,
      resumeRunwayTask: async (_client, input) => {
        recoveryCalls++; expect(input.taskId).toBe(third.providerExecutionId);
        return { taskId: input.taskId, estimatedCredits: 60, finalCredits: 60, outputUrls: ["https://offline.invalid/video.mp4"] };
      },
      reconcileLifecycle: (input, dependencies) => reconcileExecutionLifecycle(input, { ...dependencies,
        recoverRunwayOutput: async (_url, path) => { const bytes = Buffer.from("synthetic-recovered-output");
          await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes);
          return { destinationPath: path, bytes: bytes.length, sha256: rawSha256(bytes), contentType: "video/mp4" }; },
      }),
    };
    const runners = { ...episodeCoordinatorProductionDependencies, runSingleShotExecutionCli: generate,
      runProductionExecutionReconcileCli: (args: readonly string[] | undefined, _deps: unknown, context?: Parameters<typeof runProductionExecutionReconcileCli>[2]) =>
        runProductionExecutionReconcileCli(args, { createDependencies: () => cli, runCli: runExecutionReconcileCli }, context) };
    function coordinate(input: CoordinateBoundEpisodeActionInput): Promise<BoundEpisodeActionResult>;
    function coordinate(input: CoordinateEpisodeActionInput): Promise<CoordinateEpisodeActionResult>;
    function coordinate(input: CoordinateBoundEpisodeActionInput | CoordinateEpisodeActionInput) {
      return "controlledContext" in input ? coordinateEpisodeAction(input, runners) : coordinateEpisodeAction(input, runners);
    }
    const result = await runEpisodeAutomation(plan, { coordinateAction: coordinate, verifyRuntime: async () => undefined },
      createFreshEpisodeOperatorSession("RECONCILIATION", true));
    expect(result).toMatchObject({ status: "ACTION_COMPLETED", stopReason: null, dispatchAllowanceConsumed: 0,
      observedNewCreateCount: 0, recoveryDispatchCount: 1, selectedPostObservation: { lifecycle: "COMPLETED" } });
    expect(recoveryCalls).toBe(1); expect(generate).not.toHaveBeenCalled();
    expect(await inspectExecutionLifecycle(f.mediaRoot, "EP02", "S04")).toEqual({ state: "NOTHING" });
    const stale = await runEpisodeAutomation(plan, { coordinateAction: coordinate, verifyRuntime: async () => undefined },
      createFreshEpisodeOperatorSession("RECONCILIATION", true));
    expect(stale).toMatchObject({ status: "REJECTED", stopReason: "INPUT_BINDING_DRIFT", recoveryDispatchCount: 0 });
    expect(recoveryCalls).toBe(1); expect(generate).not.toHaveBeenCalled();
  }, 30000);
  it("disabled Google retains exact-job recovery and verified visual completion while editorial handoff stays unsupported", async () => {
    const f = await fixture("GOOGLE_GENAI");
    f.episode.scenes = [{ ...f.episode.scenes[0]!, id: "SC01", shots: [{ ...f.episode.scenes[0]!.shots[0]!, id: "S01", order: 1 }] }];
    await f.save();
    const reservation = await createExecutionReservation(f.mediaRoot, { episodeId: "EP02", shotId: "S01", provider: "GOOGLE_GENAI" });
    const policySnapshot = GoogleGenAiPolicySchema.parse(JSON.parse(await readFile(join(f.repositoryRoot, "config/google-genai-policy.json"), "utf8")));
    await createExecutionSubmission(f.mediaRoot, { reservationId: reservation.record.reservationId, episodeId: "EP02", shotId: "S01", provider: "GOOGLE_GENAI",
      providerExecutionId: "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM", recoveryMetadata: { request: { model: "gemini-omni-1.1-flash",
        background: true, store: true, stream: false, promptText: "Synthetic offline existing Google evidence.", sourceImagePath: join(f.mediaRoot, "references/ref.png") }, policySnapshot } });
    const submitted = await buildBoundEpisodePreflight({ ...f.input, evidenceAdoptions: await reviewedEvidence(f) });
    expect(submitted.shots[0]).toMatchObject({ disposition: "SUBMITTED", activation: "DISABLED" });
    expect(submitted.nextActionCandidate).toMatchObject({ kind: "VISUAL_RECONCILE", provider: "GOOGLE_GENAI", shotId: "S01" });
    const bytes = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isommp41"),
      Buffer.from([0, 0, 0, 12]), Buffer.from("mdatDATA")]);
    const materializedOutput = await materializeGoogleGenAiSingleShotOutput({ mediaRoot: f.mediaRoot, episodeId: "EP02", shotId: "S01", maxOutputBytes: 4096 }, {
      retrieveOutput: async id => ({ id, status: "completed", outputVideo: { type: "video", mime_type: "video/mp4", data: bytes.toString("base64") } }),
      downloadUri: async () => { throw new Error("Provider download tripwire."); },
    });
    await persistGoogleGenAiSingleShotCompletion({ mediaRoot: f.mediaRoot, episodeId: "EP02", shotId: "S01", materializedOutput });
    // Mutable routing and stale authoring cannot hide the completed Google lineage.
    f.episode.scenes[0]!.shots[0]!.generation.provider = "RUNWAY";
    f.episode.scenes[0]!.shots[0]!.generation.status = "PLANNED"; await f.save();
    const completed = await buildBoundEpisodePreflight({ ...f.input, evidenceAdoptions: await reviewedEvidence(f) });
    expect(completed.completion).toBe("VISUAL_PRODUCTION_COMPLETE");
    expect(completed.shots[0]).toMatchObject({ disposition: "COMPLETED", completionVerification: "VERIFIED", durableProvider: "GOOGLE_GENAI",
      handoffCompatibility: "HANDOFF_UNSUPPORTED_FOR_PROVIDER" });
    expect(completed.handoff).toMatchObject({ editorialReady: false, issues: [expect.objectContaining({ code: "HANDOFF_UNSUPPORTED_FOR_PROVIDER" })] });
    expect(JSON.stringify(completed)).not.toContain("v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM");
  });
  it("verifies completed 1-2, proposes only exact-job recovery 3, then requires fresh evidence review before 4", async () => {
    const f = await restartFixture();
    await complete(f, "S01", await accepted(f, "S01")); await complete(f, "S02", await accepted(f, "S02"));
    const third = await accepted(f, "S03");
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network tripwire."));
    const unadopted = await buildBoundEpisodePreflight(f.input);
    expect(unadopted.shots.map(row => row.disposition)).toEqual(["COMPLETED", "COMPLETED", "SUBMITTED", "READY", "READY"]);
    expect(unadopted.intentAlignment).toBe("REVIEW_REQUIRED"); expect(unadopted.nextActionCandidate).toBeNull();
    const reviewed = await buildBoundEpisodePreflight({ ...f.input, evidenceAdoptions: await reviewedEvidence(f) });
    expect(reviewed.nextActionCandidate).toMatchObject({ kind: "VISUAL_RECONCILE", shotId: "S03", order: 3,
      observation: { reservationId: third.reservation.record.reservationId, durableProvider: "RUNWAY" } });
    expect(reviewed.shots.slice(0, 2).every(row => row.completionVerification === "VERIFIED")).toBe(true);
    const childScript = `const {buildBoundEpisodePreflight}=await import(process.argv[1]); const report=await buildBoundEpisodePreflight(JSON.parse(process.argv[2])); console.log(JSON.stringify({states:report.shots.map(row=>row.disposition),candidate:report.nextActionCandidate?.shotId,kind:report.nextActionCandidate?.kind}));`;
    const child = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", childScript,
      new URL("../src/execution/buildBoundEpisodePreflight.ts", import.meta.url).href,
      JSON.stringify({ ...f.input, evidenceAdoptions: await reviewedEvidence(f) })], { windowsHide: true, timeout: 20000 });
    expect(JSON.parse(child.stdout)).toEqual({ states: ["COMPLETED", "COMPLETED", "SUBMITTED", "READY", "READY"],
      candidate: "S03", kind: "VISUAL_RECONCILE" });
    expect(JSON.stringify(reviewed)).not.toContain("synthetic-private-job-");
    await complete(f, "S03", third);
    const stale = await buildBoundEpisodePreflight({ ...f.input, evidenceAdoptions: await reviewedEvidence(f) });
    expect(stale.nextActionCandidate).toMatchObject({ kind: "VISUAL_GENERATE", shotId: "S04", order: 4 });
    expect(network).not.toHaveBeenCalled();
  }, 30000);
  it("corrupt completed bytes never become NOTHING or permission to create", async () => {
    const f = await restartFixture(); const path = await complete(f, "S01", await accepted(f, "S01"));
    await writeFile(path, "corrupt");
    const result = await buildBoundEpisodePreflight(f.input);
    expect(result.shots[0]).toMatchObject({ disposition: "ERROR", completionVerification: "FAILED", lifecycle: { lifecycle: "COMPLETED" } });
    expect(result.nextActionCandidate).toBeNull(); expect(result.completion).toBe("INCOMPLETE");
  });
  it("a reservation or submitted job outside selected scope blocks all new generation", async () => {
    const f = await restartFixture();
    await createExecutionReservation(f.mediaRoot, { episodeId: "EP02", shotId: "S05", provider: "RUNWAY" });
    const result = await buildBoundEpisodePreflight({ ...f.input, scope: { kind: "SELECTED_SCOPE", shotIds: ["S01"] } });
    expect(result.shots[4]).toMatchObject({ disposition: "BLOCKED", lifecycle: { lifecycle: "RESERVED_ONLY" } });
    expect(result.nextActionCandidate).toBeNull();
  });
  it("never reports whole episode completion for a proper selected subset", async () => {
    const f = await restartFixture(); await complete(f, "S01", await accepted(f, "S01"));
    const result = await buildBoundEpisodePreflight({ ...f.input, scope: { kind: "SELECTED_SCOPE", shotIds: ["S01"] }, evidenceAdoptions: await reviewedEvidence(f) });
    expect(result.completion).toBe("SELECTED_SCOPE_COMPLETE"); expect(result.totalIntended).toBe(5); expect(result.scopeTotal).toBe(1);
  });
});
