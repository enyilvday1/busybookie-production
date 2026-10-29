import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { EpisodeManifestSchema } from "../../src/schemas/episodeManifest.schema.js";
import { ProductionRulesSchema } from "../../src/schemas/productionRules.schema.js";
import { GoogleGenAiPolicySchema } from "../../src/schemas/googleGenAiPolicy.schema.js";
import { buildBoundEpisodePreflight } from "../../src/execution/buildBoundEpisodePreflight.js";
import { rawSha256, bindingDigest } from "../../src/execution/episodeInputBinding.js";
import type { RuntimeIdentity, ControlledEpisodeAutomationPlan, BoundEpisodeActionResult } from "../../src/execution/boundEpisodeProduction.types.js";
import { BoundEpisodeActionError } from "../../src/execution/boundEpisodeProduction.types.js";
import { createExecutionReservation } from "../../src/execution/createExecutionReservation.js";
import { createExecutionSubmission } from "../../src/execution/createExecutionSubmission.js";
import { createExecutionCompletion } from "../../src/execution/createExecutionCompletion.js";
import { createExecutionReservationPath } from "../../src/execution/executionReservationPath.js";
import { createExecutionSubmissionPath } from "../../src/execution/executionSubmissionPath.js";
import { createExecutionCompletionPath } from "../../src/execution/executionCompletionPath.js";
import { inspectExecutionLifecycle } from "../../src/execution/inspectExecutionLifecycle.js";
import { parseEpisodeAutomationPlan } from "../../src/execution/episodeAutomationPlan.schema.js";
import { runEpisodeAutomation } from "../../src/execution/runEpisodeAutomation.js";
import { coordinateEpisodeAction, episodeCoordinatorProductionDependencies, type CoordinateBoundEpisodeActionInput,
  type CoordinateEpisodeActionInput, type CoordinateEpisodeActionResult } from "../../src/execution/coordinateEpisodeAction.js";
import { createFreshEpisodeOperatorSession, episodeExecutionGuardPath } from "../../src/execution/episodeExecutionGuard.js";
import { runSingleShotExecutionCli, type RunSingleShotExecutionCliDependencies } from "../../src/execution/cli/runSingleShotExecutionCli.js";
import { createProductionSingleShotExecutionDependencies } from "../../src/execution/createProductionSingleShotExecutionDependencies.js";
import { executeSingleShot } from "../../src/execution/executeSingleShot.js";
import { runProductionExecutionReconcileCli } from "../../src/execution/cli/runProductionExecutionReconcileCli.js";
import { runExecutionReconcileCli, type RunExecutionReconcileCliDependencies } from "../../src/execution/cli/runExecutionReconcileCli.js";
import { reconcileExecutionLifecycle } from "../../src/execution/reconcileExecutionLifecycle.js";
import { reconcileGoogleGenAiExecutionLifecycle } from "../../src/execution/reconcileGoogleGenAiExecutionLifecycle.js";
import { GOOGLE_GENAI_ACTIVATION_LIMITS } from "../../src/googleGenai/googleGenAiActivationLimits.js";
import { createRunwayTaskLookupClient } from "../../src/runway/execution/createRunwayTaskLookupClient.js";
import { createVeoOperationLookupClient } from "../../src/veo/execution/createVeoOperationLookupClient.js";
import { createVeoFileDownloadClient } from "../../src/veo/output/createVeoFileDownloadClient.js";
import { recoverVeoOutput } from "../../src/veo/output/recoverVeoOutput.js";
import { recoverRunwayOutput } from "../../src/runway/output/recoverRunwayOutput.js";
import { createRunwayVideoOutputPath } from "../../src/runway/output/runwayOutputPath.js";
import { createVeoVideoOutputPath } from "../../src/veo/output/veoOutputPath.js";
import { buildRunwayGenerationRecord } from "../../src/runway/audit/buildRunwayGenerationRecord.js";
import { writeRunwayGenerationRecord } from "../../src/runway/audit/writeRunwayGenerationRecord.js";

export type Provider = "RUNWAY" | "VEO" | "GOOGLE_GENAI";
export type Fixture = { root: string; repositoryRoot: string; mediaRoot: string; runtimeIdentity: RuntimeIdentity; provider: Provider; shotIds: string[] };
export const video = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]),
  Buffer.from("isommp41"), Buffer.from([0, 0, 0, 12]), Buffer.from("mdatDATA")]);
export const googleId = "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";
export const jobId = (provider: Provider, shot: string) => provider === "GOOGLE_GENAI" ? googleId
  : provider === "VEO" ? `models/veo-3.1-fast-generate-preview/operations/b7d-${shot}` : `b7d-task-${shot}`;

export async function fixture(provider: Provider = "RUNWAY", count = 1): Promise<Fixture> {
  const root = await mkdtemp(join(process.cwd(), ".b7d-budget-"));
  const repositoryRoot = join(root, "repo"), mediaRoot = join(root, "media");
  await mkdir(join(repositoryRoot, "episodes/EP02"), { recursive: true }); await mkdir(join(repositoryRoot, "config"));
  await mkdir(join(mediaRoot, "references"), { recursive: true });
  const episode = EpisodeManifestSchema.parse(JSON.parse(await readFile("episodes/EP02/episode.json", "utf8")));
  episode.status = "IN_PRODUCTION"; episode.approvals.script = "APPROVED";
  episode.approvals.storyboard = "APPROVED"; episode.approvals.references = "APPROVED";
  const template = episode.scenes[0]!.shots[0]!;
  const shotIds = Array.from({ length: count }, (_, n) => `S0${n + 1}`);
  episode.scenes = [{ ...episode.scenes[0]!, id: "SC01", shots: shotIds.map((id, n) => ({ ...structuredClone(template),
    id, order: n + 1, durationSeconds: provider === "VEO" ? 4 : 5,
    references: { required: true, assetIds: ["ref"], approvalStatus: "APPROVED" as const },
    generation: { provider, nativeAudio: provider === "VEO", status: "APPROVED_FOR_GENERATION" as const } })) }];
  for (const name of ["characters.json", "provider-routing-policy.json", "runway-policy.json", "veo-policy.json", "google-genai-policy.json", "google-genai-activation-policy.json"])
    await writeFile(join(repositoryRoot, "config", name), await readFile(join("config", name)));
  const rules = ProductionRulesSchema.parse(JSON.parse(await readFile("config/production-rules.json", "utf8")));
  rules.storage.requireExternalMediaRoot = false;
  await writeFile(join(repositoryRoot, "config/production-rules.json"), JSON.stringify(rules));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZbQAAAABJRU5ErkJggg==", "base64");
  await writeFile(join(mediaRoot, "references/ref.png"), png);
  await writeFile(join(mediaRoot, "references/visual-reference-asset-registry.json"), JSON.stringify({ schemaVersion: "1.0", assets: [
    { assetId: "ref", mediaRootRelativePath: "references/ref.png", bytes: png.length, sha256: rawSha256(png), contentType: "image/png" }] }));
  await writeFile(join(repositoryRoot, "episodes/EP02/episode.json"), JSON.stringify(episode));
  await writeFile(join(repositoryRoot, "runtime.txt"), "synthetic-runtime");
  const runtimeIdentity: RuntimeIdentity = { reviewedRevision: "a".repeat(40), repositoryRoot, mediaRoot, physicalMediaRoot: mediaRoot,
    executableInputs: [{ role: "RUNTIME", canonicalPath: join(repositoryRoot, "runtime.txt"), exists: true,
      rawSha256: rawSha256("synthetic-runtime"), bytes: 17 }], ffprobe: null };
  return { root, repositoryRoot, mediaRoot, runtimeIdentity, provider, shotIds };
}
const input = (f: Fixture) => ({ episodeId: "EP02", mediaRoot: f.mediaRoot, runtimeIdentity: f.runtimeIdentity });
export async function reviewed(f: Fixture) {
  const first = await buildBoundEpisodePreflight(input(f));
  const manifestRawSha256 = first.binding!.fileBindings.find(b => b.role === "MANIFEST")!.rawSha256!;
  const evidenceAdoptions = first.observations.filter(o => ["SUBMITTED", "COMPLETED"].includes(o.lifecycle))
    .map(o => ({ target: o.target, manifestRawSha256, observationSha256: bindingDigest(o) }));
  return { report: await buildBoundEpisodePreflight({ ...input(f), evidenceAdoptions }), evidenceAdoptions };
}
export async function planFor(f: Fixture): Promise<ControlledEpisodeAutomationPlan | null> {
  const { report: r, evidenceAdoptions } = await reviewed(f), a = r.nextActionCandidate;
  if (!a) return null;
  const action = a.kind === "VISUAL_GENERATE" ? { ...a, resolvedProvider: a.provider, referenceBinding: a.referenceBinding,
    costAuthority: { unit: a.cost.unit, modeledValue: a.cost.modeledValue, maxModeledValue: a.cost.perShotCap, policySha256: a.cost.policySha256 } } : null;
  const target = { episodeId: a.episodeId, shotId: a.shotId, sceneId: a.sceneId, order: a.order };
  const parsed = parseEpisodeAutomationPlan({ schemaVersion: "2.0", mode: "CONTROLLED_VISUAL", episodeId: "EP02", scope: r.scope,
    inputBinding: r.binding, inputBindingSha256: r.bindingSha256, observations: r.observations, observationsSha256: r.observationsSha256,
    evidenceAdoptions, maximumNewProviderCreates: a.kind === "VISUAL_GENERATE" ? 1 : 0,
    operatingCondition: { singleOperator: true, noConcurrentAuthoring: true, noUnguardedRunners: true },
    actions: [action ? { ...target, kind: "VISUAL_GENERATE", expectedLifecycle: "NOTHING", resolvedProvider: action.resolvedProvider,
      referenceBinding: action.referenceBinding, costAuthority: action.costAuthority, confirmPaidGeneration: true }
      : a.kind === "VISUAL_RECONCILE" ? { ...target, kind: "VISUAL_RECONCILE", expectedLifecycle: "SUBMITTED", confirmReconciliation: true,
        reservationId: a.observation.reservationId, durableProvider: a.provider, reservationSha256: a.observation.reservationSha256,
        submissionSha256: a.observation.submissionSha256, providerExecutionIdentitySha256: a.observation.providerExecutionIdentitySha256 } : null] });
  assert.equal(parsed.schemaVersion, "2.0"); if (parsed.schemaVersion !== "2.0") throw Error("wrong plan"); return parsed;
}
export function runwayRequest(f: Fixture) { return { durationSeconds: 5, ratio: "1280:720", outputFormat: "mp4",
  promptText: "Synthetic B7D job.", sourceImagePath: join(f.mediaRoot, "references/ref.png"), assetStrategy: "DATA_URI" } as const; }
export async function seed(f: Fixture, state: "RESERVED_ONLY" | "SUBMITTED", shot = "S01") {
  const reservation = await createExecutionReservation(f.mediaRoot, { episodeId: "EP02", shotId: shot, provider: f.provider });
  if (state === "RESERVED_ONLY") return;
  const common = { reservationId: reservation.record.reservationId, episodeId: "EP02", shotId: shot, providerExecutionId: jobId(f.provider, shot) };
  if (f.provider === "RUNWAY") await createExecutionSubmission(f.mediaRoot, { ...common, provider: "RUNWAY", providerEstimatedCredits: 60,
    recoveryMetadata: { request: runwayRequest(f), locallyExpectedCredits: 60 } });
  else if (f.provider === "VEO") await createExecutionSubmission(f.mediaRoot, { ...common, provider: "VEO", recoveryMetadata: {
    request: { durationSeconds: 4, aspectRatio: "16:9", resolution: "720p", numberOfVideos: 1, nativeAudioExpected: true, expectedOutputFps: 24,
      promptText: "Synthetic B7D Veo job.", sourceImagePath: join(f.mediaRoot, "references/ref.png"), imageMimeType: "image/png" },
    costPolicy: { pricingReviewedOn: "2026-10-01", centsPerSecond: 10, locallyExpectedCents: 40 } } });
  else await createExecutionSubmission(f.mediaRoot, { ...common, provider: "GOOGLE_GENAI", recoveryMetadata: {
    request: { model: "gemini-omni-1.1-flash", background: true, store: true, stream: false,
      promptText: "Synthetic B7D Google job.", sourceImagePath: join(f.mediaRoot, "references/ref.png") },
    policySnapshot: GoogleGenAiPolicySchema.parse(JSON.parse(await readFile(join(f.repositoryRoot, "config/google-genai-policy.json"), "utf8"))) } });
}
export async function outputWindow(f: Fixture, kind: "OUTPUT" | "RECORD" | "CONFLICT" | "RECORD_CONFLICT") {
  const id = jobId("RUNWAY", "S01"), path = createRunwayVideoOutputPath(f.mediaRoot, "EP02", "S01", id, 1);
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, kind === "CONFLICT" ? Buffer.from("conflicting-local-output") : video, { flag: "wx" });
  if (kind === "RECORD" || kind === "RECORD_CONFLICT") await writeRunwayGenerationRecord(f.mediaRoot, buildRunwayGenerationRecord({
    recordedAt: "2026-10-29T00:00:00.000Z", episodeId: "EP02", shotId: "S01", taskId: id, request: runwayRequest(f),
    credits: { locallyExpected: 60, providerEstimated: 60, providerFinal: 60 }, outputs: [{ outputIndex: 1, destinationPath: path,
      bytes: video.length, sha256: kind === "RECORD_CONFLICT" ? "0".repeat(64) : rawSha256(video), contentType: "video/mp4" }] }));
  return path;
}
async function inventory(f: Fixture) {
  const rows = [];
  for (const shot of f.shotIds) {
    const lifecycle = await inspectExecutionLifecycle(f.mediaRoot, "EP02", shot);
    const hashes: Record<string, string | null> = {};
    for (const [name, path] of [["R", createExecutionReservationPath(f.mediaRoot, "EP02", shot)],
      ["S", createExecutionSubmissionPath(f.mediaRoot, "EP02", shot)], ["C", createExecutionCompletionPath(f.mediaRoot, "EP02", shot)]]) {
      try { hashes[name!] = rawSha256(await readFile(path!)); } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; hashes[name!] = null;
      }
    }
    rows.push({ shot, state: lifecycle.state, reservationId: lifecycle.state === "NOTHING" ? null : lifecycle.reservation.reservationId,
      jobId: lifecycle.state === "SUBMITTED" || lifecycle.state === "COMPLETED" ? lifecycle.submission.providerExecutionId : null, hashes });
  }
  return { R: rows.filter(r => r.hashes.R).length, S: rows.filter(r => r.hashes.S).length, C: rows.filter(r => r.hashes.C).length, rows };
}
export type WorkerRequest = { f: Fixture; scenario: string; mode: "inspect" | "generate" | "recover" | "replay" | "denyGoogle";
  plan?: ControlledEpisodeAutomationPlan; pending?: boolean };

export async function execute(request: WorkerRequest) {
  assert.equal(process.env.B7D_BOOTSTRAP_INSTALLED, "YES");
  for (const key of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "RUNWAYML_API_SECRET"]) assert.equal(process.env[key], "");
  const { f } = request, before = await inventory(f), pre = (await reviewed(f)).report;
  let createAttempts = 0, recoveryDispatches = 0, forbiddenCreates = 0, fallback = 0;
  const lookedUp: string[] = [];
  const forbidden = async (): Promise<never> => { forbiddenCreates++; throw Error("B7D forbidden creation/unchecked capability"); };
  const unchecked = async (): Promise<never> => { throw Error("B7D unchecked canonical loader"); };
  const generate: RunSingleShotExecutionCliDependencies = {
    loadEnvironment: () => ({ BUSYBOOKIE_MEDIA_ROOT: f.mediaRoot, RUNWAYML_API_SECRET: "synthetic-only" }),
    loadEpisodeManifest: unchecked, loadCharacterBible: unchecked, loadProductionRules: unchecked, loadProviderRoutingPolicy: unchecked,
    validateEpisodeProduction: () => undefined, validateMediaRoot: async () => f.mediaRoot, inspectExecutionLifecycle, executeSingleShot,
    createDependencies: (credentials, _composition, context) => createProductionSingleShotExecutionDependencies(credentials, {
      createReservation: createExecutionReservation, createSubmission: createExecutionSubmission, createCompletion: createExecutionCompletion,
      prepareRunwayExecutor: async (_key, preparation) => {
        if (f.provider !== "RUNWAY") { fallback++; return forbidden(); }
        assert.ok(preparation); await preparation.loadPolicy();
        return async args => { createAttempts++; const id = jobId("RUNWAY", args.shot.id);
          await args.onSubmissionAccepted({ provider: "RUNWAY", providerExecutionId: id, providerEstimatedCredits: 60,
            recoveryMetadata: { request: runwayRequest(f), locallyExpectedCredits: 60 } });
          throw Error("B7D synthetic provider error AFTER durable submission"); };
      },
      prepareVeoExecutor: async () => { fallback++; return forbidden(); }, prepareGoogleInteraction: () => { forbiddenCreates++; throw Error("Google create forbidden"); },
    }, context),
  };
  const lookup = (id: string, provider: Provider) => { assert.equal(provider, f.provider); assert.equal(id, jobId(f.provider, "S01"));
    lookedUp.push(id); if (request.pending) throw Error("B7D synthetic same-job pending/error; no progress"); };
  const cli: RunExecutionReconcileCliDependencies = {
    loadEnvironment: () => ({ BUSYBOOKIE_MEDIA_ROOT: f.mediaRoot, RUNWAYML_API_SECRET: "synthetic-only", GEMINI_API_KEY: "synthetic-only" }),
    loadProductionRules: unchecked, resolveMediaRoot: () => f.mediaRoot, inspectLifecycle: inspectExecutionLifecycle,
    createRunwayTaskLookupClient, createVeoOperationLookupClient, createVeoFileDownloadClient,
    resumeRunwayTask: async (_client, args) => {
      assert.equal(f.provider, "RUNWAY"); lookedUp.push(args.taskId); assert.ok(f.shotIds.some(shot => jobId(f.provider, shot) === args.taskId));
      if (request.pending) throw Error("B7D synthetic same-task pending/error");
      return { taskId: args.taskId, estimatedCredits: 60, finalCredits: 60, outputUrls: ["https://offline.invalid/b7d.mp4"] };
    },
    resumeVeoOperation: async (_client, args) => { lookup(args.operationName, "VEO"); return { operationName: args.operationName,
      generatedVideos: [{ video: { videoBytes: video.toString("base64"), mimeType: "video/mp4" } }], raiMediaFilteredCount: 0, raiMediaFilteredReasons: [] }; },
    recoverVeoOutput,
    reconcileLifecycle: async (args, deps) => { recoveryDispatches++; return reconcileExecutionLifecycle(args, { ...deps,
      recoverRunwayOutput: (url, path) => recoverRunwayOutput(url, path, async () => new Response(video, { headers: { "content-type": "video/mp4" } })) }); },
    reconcileGoogleLifecycle: async (args, deps) => { recoveryDispatches++; return reconcileGoogleGenAiExecutionLifecycle(args, deps); },
    createGoogleSubmittedRecovery: () => ({ policy: GOOGLE_GENAI_ACTIVATION_LIMITS,
      replayInteraction: async id => { lookup(id, "GOOGLE_GENAI"); return { id, status: "completed", outputVideo: {
        type: "video", mime_type: "video/mp4", uri: "https://generativelanguage.googleapis.com/v1beta/files/b7d-output:download?alt=media" } }; },
      prepareUri: async ({ uri }) => ({ resource: { fileId: "b7d-output", name: "files/b7d-output", downloadUri: uri },
        byteCount: video.length, sha256: rawSha256(video), mimeType: "video/mp4", expirationTime: "2099-01-01T00:00:00.000Z",
        expirationTimeMs: Date.parse("2099-01-01T00:00:00.000Z") }),
      downloadUri: async (_metadata, sink) => { await sink.writeChunk(video);
        return { byteCount: video.length, sha256: rawSha256(video), mimeType: "video/mp4" }; },
    }),
  };
  const runners = { ...episodeCoordinatorProductionDependencies,
    runSingleShotExecutionCli: (args: readonly string[] | undefined, _deps: unknown, context?: Parameters<typeof runSingleShotExecutionCli>[2]) =>
      request.mode === "recover" ? forbidden() : runSingleShotExecutionCli(args, generate, context),
    runProductionExecutionReconcileCli: (args: readonly string[] | undefined, _deps: unknown, context?: Parameters<typeof runProductionExecutionReconcileCli>[2]) =>
      runProductionExecutionReconcileCli(args, { createDependencies: () => cli, runCli: runExecutionReconcileCli }, context),
  };
  function coordinate(args: CoordinateBoundEpisodeActionInput): Promise<BoundEpisodeActionResult>;
  function coordinate(args: CoordinateEpisodeActionInput): Promise<CoordinateEpisodeActionResult>;
  function coordinate(args: CoordinateBoundEpisodeActionInput | CoordinateEpisodeActionInput) {
    return "controlledContext" in args ? coordinateEpisodeAction(args, runners) : coordinateEpisodeAction(args, runners);
  }
  let usedPlan = request.plan ?? await planFor(f);
  // A denied fresh Google action still needs a structurally valid reviewed request;
  // it must fail actual admission, never invent an activation-enabled fixture.
  if (request.mode === "denyGoogle" && !usedPlan) {
    const row = pre.shots[0]!; assert.ok(pre.binding); assert.ok(row.selectedReference); assert.equal(row.cost.status, "KNOWN");
    if (row.cost.status !== "KNOWN") throw Error("missing cost");
    usedPlan = parseEpisodeAutomationPlan({ schemaVersion: "2.0", mode: "CONTROLLED_VISUAL", episodeId: "EP02", scope: pre.scope,
      inputBinding: pre.binding, inputBindingSha256: pre.bindingSha256, observations: pre.observations, observationsSha256: pre.observationsSha256,
      evidenceAdoptions: [], maximumNewProviderCreates: 1, operatingCondition: { singleOperator: true, noConcurrentAuthoring: true, noUnguardedRunners: true },
      actions: [{ episodeId: "EP02", sceneId: row.sceneId, shotId: row.shotId, order: row.order, kind: "VISUAL_GENERATE", expectedLifecycle: "NOTHING",
        resolvedProvider: "GOOGLE_GENAI", referenceBinding: row.selectedReference,
        costAuthority: { unit: row.cost.unit, modeledValue: row.cost.modeledValue, maxModeledValue: row.cost.perShotCap, policySha256: row.cost.policySha256 }, confirmPaidGeneration: true }] }) as ControlledEpisodeAutomationPlan;
  }
  let result: BoundEpisodeActionResult | null = null, errorCode: string | null = null, threw = false;
  if (request.mode !== "inspect" && usedPlan) {
    try {
      const response = await runEpisodeAutomation(usedPlan, { coordinateAction: coordinate, verifyRuntime: async () => undefined },
        createFreshEpisodeOperatorSession(usedPlan.actions[0].kind === "VISUAL_GENERATE" ? "GENERATION" : "RECONCILIATION", true));
      assert.ok(!("results" in response)); if (!("results" in response)) result = response;
    } catch (error) {
      threw = true;
      if (error instanceof BoundEpisodeActionError) result = error.result;
      else if (error instanceof Error && "code" in error) errorCode = String(error.code);
      else throw error;
    }
  }
  const after = await inventory(f), post = (await reviewed(f)).report;
  let guardResult = "ABSENT"; try { await access(episodeExecutionGuardPath(f.mediaRoot, "EP02")); guardResult = "RETAINED"; } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
  }
  // The parent owns this per-child path and the startup helper sets the marker.
  const audit = await readFile(process.env.B7D_NETWORK_AUDIT!, "utf8");
  const frontier = (r: typeof pre) => r.completion === "VISUAL_PRODUCTION_COMPLETE" ? r.completion
    : r.nextActionCandidate ? `${r.nextActionCandidate.shotId}:${r.nextActionCandidate.kind}` : r.shots.find(s => s.disposition !== "COMPLETED")?.primaryReason?.code ?? "BLOCKED";
  return { scenario: request.scenario, provider: f.provider, childPid: process.pid, createAttempts, recoveryDispatches, forbiddenCreates, fallback, lookedUp,
    before, after, frontierBefore: frontier(pre), frontierAfter: frontier(post), generationAllowance: result?.dispatchAllowanceConsumed ?? 0,
    recoveryAllowance: result?.recoveryDispatchCount ?? 0, guardResult, stopReason: result?.stopReason ?? errorCode ?? post.shots[0]?.primaryReason?.code ?? null,
    networkAuditCount: audit.trim() ? audit.trim().split("\n").length : 0, status: result?.status ?? "NO_DISPATCH", threw, plan: usedPlan,
    completion: post.completion, nextActionKind: post.nextActionCandidate?.kind ?? null, generationMayBeAuthorized: post.generationMayBeAuthorized,
    observations: post.shots.map(s => ({ shot: s.shotId, lifecycle: s.lifecycle.lifecycle,
      disposition: s.disposition, verification: s.completionVerification })), observationDigest: post.observationsSha256 };
}
export type Evidence = Awaited<ReturnType<typeof execute>>;
if (process.argv[2] === "--b7d-worker") {
  process.once("message", async (request: WorkerRequest) => {
    try { process.send!({ evidence: await execute(request) }); }
    catch (error) { process.send!({ error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error) }); process.exitCode = 1; }
    finally { process.disconnect!(); }
  });
}
