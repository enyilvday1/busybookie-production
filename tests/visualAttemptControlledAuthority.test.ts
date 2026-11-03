import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EpisodeManifestSchema } from "../src/schemas/episodeManifest.schema.js";
import { ProductionRulesSchema } from "../src/schemas/productionRules.schema.js";
import { buildBoundEpisodePreflight, type BoundEpisodeReadDependencies } from "../src/execution/buildBoundEpisodePreflight.js";
import { readBoundFile, rawSha256, bindingDigest } from "../src/execution/episodeInputBinding.js";
import type { BoundEpisodePreflight, ControlledEpisodeAutomationPlan, EvidenceAdoption, RuntimeIdentity } from "../src/execution/boundEpisodeProduction.types.js";
import { parseEpisodeAutomationPlan } from "../src/execution/episodeAutomationPlan.schema.js";
import { acquireEpisodeExecutionGuard, admitEpisodeCoordinatorDispatch, assertCheckedEpisodeAdmission, assertReviewedEpisodeAction,
  createCheckedEpisodeExecutionContext, createEpisodeInvocation, createFreshEpisodeOperatorSession, episodeExecutionGuardPath,
  episodeInvocationCounts, releaseEpisodeExecutionGuard, type EpisodeGuardContext } from "../src/execution/episodeExecutionGuard.js";
import { coordinateEpisodeAction, type CoordinateEpisodeActionDependencies } from "../src/execution/coordinateEpisodeAction.js";
import { runEpisodeAutomation } from "../src/execution/runEpisodeAutomation.js";
import { parseSingleShotExecutionCliArgs } from "../src/execution/cli/singleShotExecutionCliArgs.js";
import { inspectExecutionLifecycle } from "../src/execution/inspectExecutionLifecycle.js";
import { inspectVisualAttemptExecutionLifecycle } from "../src/execution/inspectVisualAttemptExecutionLifecycle.js";
import { createVisualAttemptAdmission } from "../src/execution/createVisualAttemptAdmission.js";
import { createVisualAttemptExecutionReservation } from "../src/execution/createVisualAttemptExecutionReservation.js";
import { createVisualAttemptAdmissionPath } from "../src/execution/visualAttemptPaths.js";
import { createVisualAttemptExecutionReservationPath } from "../src/execution/visualAttemptExecutionPaths.js";
import { resolveDurableEpisodeProductionState } from "../src/execution/resolveDurableEpisodeProductionState.js";
import { resolveDurableShotVisualGenerationState } from "../src/execution/resolveDurableShotVisualGenerationState.js";
import { resolveDurableShotDialogueCompositionState } from "../src/dialogue/resolveDurableShotDialogueCompositionState.js";
import { verifyLocalCompletedVisualExecution } from "../src/execution/verifyLocalCompletedVisualExecution.js";
import { verifyApprovedVisualReferenceAsset } from "../src/execution/verifyApprovedVisualReferenceAsset.js";
import { createExecutionReservation } from "../src/execution/createExecutionReservation.js";
import { createExecutionSubmission } from "../src/execution/createExecutionSubmission.js";
import { createExecutionCompletion } from "../src/execution/createExecutionCompletion.js";
import { buildRunwayGenerationRecord } from "../src/runway/audit/buildRunwayGenerationRecord.js";
import { writeRunwayGenerationRecord } from "../src/runway/audit/writeRunwayGenerationRecord.js";
import { createRunwayVideoOutputPath } from "../src/runway/output/runwayOutputPath.js";

// B5 Slice-2I-A: explicit attempt selection -> exact ADMITTED_ONLY authority
// -> reviewed VISUAL_ATTEMPT_GENERATE -> genuine checked context, and nothing
// further. Synthetic temporary media roots only; no provider or network.

type AttemptLifecycle = Awaited<ReturnType<typeof inspectVisualAttemptExecutionLifecycle>>;

const roots: string[] = [];
const guards: EpisodeGuardContext[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const guard of guards.splice(0)) await releaseEpisodeExecutionGuard(guard).catch(() => undefined);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture(options: Readonly<{ provider?: "RUNWAY" | "GOOGLE_GENAI"; activation?: boolean }> = {}) {
  const provider = options.provider ?? "GOOGLE_GENAI";
  const root = await mkdtemp(join(process.cwd(), ".b5-2ia-")); roots.push(root);
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
  if (options.activation ?? true) {
    // Synthetic copy only; the repository activation policy stays default-off.
    const path = join(repositoryRoot, "config/google-genai-activation-policy.json");
    const policy = JSON.parse(await readFile(path, "utf8")); policy.admission.newSubmissionsEnabled = true;
    await writeFile(path, JSON.stringify(policy));
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
  return { episode, save, manifest, root, repositoryRoot, mediaRoot, runtimeIdentity,
    input: { episodeId: "EP02", mediaRoot, runtimeIdentity } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function admit(f: Fixture, overrides: Readonly<{ attemptNumber?: number; sceneId?: string; manifestRawSha256?: string }> = {}) {
  const attemptNumber = overrides.attemptNumber ?? 2;
  return createVisualAttemptAdmission(f.mediaRoot, { attemptNumber, episodeId: "EP02", sceneId: overrides.sceneId ?? "SC01", shotId: "S01",
    provider: "GOOGLE_GENAI", manifestRawSha256: overrides.manifestRawSha256 ?? rawSha256(await readFile(f.manifest)),
    promptIdentitySha256: "b".repeat(64), referenceIdentitySha256: "c".repeat(64),
    previousAttemptNumber: attemptNumber - 1, previousAttemptQcSha256: "d".repeat(64) });
}

function readers(inspectVisualAttempt: typeof inspectVisualAttemptExecutionLifecycle = inspectVisualAttemptExecutionLifecycle,
  readFile: typeof readBoundFile = readBoundFile): BoundEpisodeReadDependencies {
  return { readFile, inspectLifecycle: inspectExecutionLifecycle, resolveEpisode: resolveDurableEpisodeProductionState,
    resolveVisual: resolveDurableShotVisualGenerationState, resolveDialogue: resolveDurableShotDialogueCompositionState,
    verifyComplete: verifyLocalCompletedVisualExecution, verifyReference: verifyApprovedVisualReferenceAsset, inspectVisualAttempt };
}

function select(f: Fixture, attemptNumber = 2, extra: Readonly<{ evidenceAdoptions?: readonly EvidenceAdoption[] }> = {},
  dependencies?: BoundEpisodeReadDependencies): Promise<BoundEpisodePreflight> {
  return buildBoundEpisodePreflight({ ...f.input, visualAttemptSelection: { shotId: "S01", attemptNumber }, ...extra }, dependencies);
}

function syntheticLifecycle(patch: (lifecycle: Extract<AttemptLifecycle, { state: "ADMITTED_ONLY" }>) => object) {
  return vi.fn(async (...args: Parameters<typeof inspectVisualAttemptExecutionLifecycle>) => {
    const lifecycle = await inspectVisualAttemptExecutionLifecycle(...args);
    if (lifecycle.state !== "ADMITTED_ONLY") throw new Error("Synthetic lifecycle needs an admitted base.");
    return { ...lifecycle, ...patch(lifecycle) } as unknown as AttemptLifecycle;
  });
}

const OPERATING = { singleOperator: true, noConcurrentAuthoring: true, noUnguardedRunners: true } as const;
function attemptPlan(before: BoundEpisodePreflight, overrides: Readonly<Record<string, unknown>> = {},
  evidenceAdoptions: readonly EvidenceAdoption[] = []): ControlledEpisodeAutomationPlan {
  const candidate = before.nextActionCandidate;
  if (!before.binding || !before.bindingSha256 || candidate?.kind !== "VISUAL_ATTEMPT_GENERATE") throw new Error("Fixture needs an attempt candidate.");
  const plan = parseEpisodeAutomationPlan({ schemaVersion: "2.0", mode: "CONTROLLED_VISUAL", episodeId: "EP02", scope: before.scope,
    inputBinding: before.binding, inputBindingSha256: before.bindingSha256, observations: before.observations,
    observationsSha256: before.observationsSha256, evidenceAdoptions, maximumNewProviderCreates: 1, operatingCondition: OPERATING,
    actions: [{ episodeId: candidate.episodeId, sceneId: candidate.sceneId, shotId: candidate.shotId, order: candidate.order,
      kind: "VISUAL_ATTEMPT_GENERATE", attemptNumber: candidate.attemptNumber, expectedAttemptLifecycle: candidate.expectedAttemptLifecycle,
      resolvedProvider: candidate.provider, referenceBinding: candidate.referenceBinding,
      costAuthority: { unit: candidate.cost.unit, modeledValue: candidate.cost.modeledValue, maxModeledValue: candidate.cost.perShotCap,
        policySha256: candidate.cost.policySha256 }, confirmPaidGeneration: true, ...overrides }] });
  if (plan.schemaVersion !== "2.0") throw new Error("Wrong fixture schema.");
  return plan;
}

async function checked(f: Fixture, plan: ControlledEpisodeAutomationPlan, beforePlan: BoundEpisodePreflight) {
  const manifest = plan.inputBinding.fileBindings.find(file => file.role === "MANIFEST")!.rawSha256!;
  const guard = await acquireEpisodeExecutionGuard({ mediaRoot: f.mediaRoot, episodeId: "EP02", manifestRawSha256: manifest, sessionId: randomUUID() });
  guards.push(guard);
  const invocation = createEpisodeInvocation("EP02", 1);
  const verifyRuntime = vi.fn(async () => undefined);
  const preflight = vi.fn(buildBoundEpisodePreflight);
  const context = await createCheckedEpisodeExecutionContext({ plan, beforePlan, guard, invocation, preflight, verifyRuntime });
  return { context, guard, invocation, verifyRuntime, preflight };
}

function tripwires() {
  const trip = (name: string) => vi.fn(() => { throw new Error(`${name} must not be reached during Slice-2I-A.`); });
  const dependencies = { loadEnvironment: trip("loadEnvironment"), loadProductionRules: trip("loadProductionRules"),
    loadCharacterBible: trip("loadCharacterBible"), loadEpisodeManifest: trip("loadEpisodeManifest"),
    loadProviderRoutingPolicy: trip("loadProviderRoutingPolicy"), resolveMediaRoot: trip("resolveMediaRoot"),
    resolveEpisodeProductionState: trip("resolveEpisodeProductionState"), runSingleShotExecutionCli: trip("runSingleShotExecutionCli"),
    runProductionExecutionReconcileCli: trip("runProductionExecutionReconcileCli"), runDialogueGenerationCli: trip("runDialogueGenerationCli"),
    runDialogueReconcileCli: trip("runDialogueReconcileCli") };
  return { dependencies, typed: dependencies as unknown as CoordinateEpisodeActionDependencies,
    calls: () => Object.values(dependencies).reduce((total, fn) => total + fn.mock.calls.length, 0) };
}

async function accepted(f: Fixture, shotId: string) {
  const reservation = await createExecutionReservation(f.mediaRoot, { episodeId: "EP02", shotId, provider: "RUNWAY" });
  const request = { durationSeconds: 5, ratio: "1280:720", outputFormat: "mp4", promptText: "Synthetic attempt-1 evidence.",
    sourceImagePath: join(f.mediaRoot, "references/ref.png"), assetStrategy: "DATA_URI" } as const;
  const providerExecutionId = `synthetic-private-job-${shotId}`;
  await createExecutionSubmission(f.mediaRoot, { reservationId: reservation.record.reservationId, episodeId: "EP02", shotId,
    provider: "RUNWAY", providerExecutionId, providerEstimatedCredits: 60, recoveryMetadata: { request, locallyExpectedCredits: 60 } });
  return { reservation, request, providerExecutionId };
}
async function complete(f: Fixture, shotId: string, job: Awaited<ReturnType<typeof accepted>>) {
  const path = createRunwayVideoOutputPath(f.mediaRoot, "EP02", shotId, job.providerExecutionId, 1);
  await mkdir(dirname(path), { recursive: true }); const bytes = Buffer.from("synthetic-local-video-evidence"); await writeFile(path, bytes);
  const record = buildRunwayGenerationRecord({ recordedAt: "2026-11-03T12:00:00.000Z", episodeId: "EP02", shotId,
    taskId: job.providerExecutionId, request: job.request, credits: { locallyExpected: 60, providerEstimated: 60, providerFinal: 60 },
    outputs: [{ outputIndex: 1, destinationPath: path, bytes: bytes.length, sha256: rawSha256(bytes), contentType: "video/mp4" }] });
  const recordPath = await writeRunwayGenerationRecord(f.mediaRoot, record);
  await createExecutionCompletion(f.mediaRoot, { reservationId: job.reservation.record.reservationId, episodeId: "EP02", shotId,
    provider: "RUNWAY", providerExecutionId: job.providerExecutionId, generationRecordPath: recordPath });
}
async function reviewedEvidence(f: Fixture): Promise<readonly EvidenceAdoption[]> {
  const report = await buildBoundEpisodePreflight(f.input);
  const manifest = report.binding?.fileBindings.find(file => file.role === "MANIFEST")?.rawSha256;
  if (!manifest) throw new Error("Missing test manifest binding.");
  return report.observations.filter(observation => observation.lifecycle === "SUBMITTED" || observation.lifecycle === "COMPLETED")
    .map(observation => ({ target: observation.target, manifestRawSha256: manifest, observationSha256: bindingDigest(observation) }));
}
const codes = (report: BoundEpisodePreflight) => report.visualAttempt?.reasons.map(reason => reason.code);

describe("A. absent selection is exactly the legacy preflight", () => {
  it("never runs the attempt inspector and keeps fresh VISUAL_GENERATE (NOTHING) even with attempt evidence on disk", async () => {
    const f = await fixture();
    const baseline = await buildBoundEpisodePreflight(f.input);
    await admit(f);
    const inspector = vi.fn(inspectVisualAttemptExecutionLifecycle);
    const after = await buildBoundEpisodePreflight(f.input, readers(inspector));
    expect(inspector).not.toHaveBeenCalled();
    expect({ ...after, observedAt: "" }).toEqual({ ...baseline, observedAt: "" });
    expect("visualAttempt" in after).toBe(false);
    expect(after.nextActionCandidate).toMatchObject({ kind: "VISUAL_GENERATE", expectedLifecycle: "NOTHING", shotId: "S11", order: 1 });
  });
  it("keeps legacy VISUAL_RECONCILE exact-job recovery without consulting attempts", async () => {
    const f = await fixture({ provider: "RUNWAY" }); await accepted(f, "S11");
    const inspector = vi.fn(inspectVisualAttemptExecutionLifecycle);
    const report = await buildBoundEpisodePreflight({ ...f.input, evidenceAdoptions: await reviewedEvidence(f) }, readers(inspector));
    expect(report.nextActionCandidate).toMatchObject({ kind: "VISUAL_RECONCILE", expectedLifecycle: "SUBMITTED", shotId: "S11", provider: "RUNWAY" });
    expect(report.recoveryMayBeAuthorized).toBe(true);
    expect(inspector).not.toHaveBeenCalled();
  });
});

describe("B. explicit selection validation happens before any read", () => {
  const extra = ["episodeId", "sceneId", "provider", "admissionId", "admissionSha256", "manifestRawSha256", "promptIdentitySha256",
    "referenceIdentitySha256", "reservationId", "reservationSha256", "providerExecutionId", "submissionPath", "submissionSha256"];
  it.each([
    ["malformed shot", { shotId: "S1", attemptNumber: 2 }], ["flag shot", { shotId: "--shot", attemptNumber: 2 }],
    ["attempt 0", { shotId: "S01", attemptNumber: 0 }], ["attempt 1", { shotId: "S01", attemptNumber: 1 }],
    ["negative attempt", { shotId: "S01", attemptNumber: -2 }], ["fractional attempt", { shotId: "S01", attemptNumber: 2.5 }],
    ["NaN", { shotId: "S01", attemptNumber: Number.NaN }], ["Infinity", { shotId: "S01", attemptNumber: Number.POSITIVE_INFINITY }],
    ["-Infinity", { shotId: "S01", attemptNumber: Number.NEGATIVE_INFINITY }],
    ["above MAX_SAFE_INTEGER", { shotId: "S01", attemptNumber: Number.MAX_SAFE_INTEGER + 1 }],
    ["string attempt", { shotId: "S01", attemptNumber: "2" }], ["missing attempt", { shotId: "S01" }], ["missing shot", { attemptNumber: 2 }],
    ["null", null], ["array", [{ shotId: "S01", attemptNumber: 2 }]],
    ...extra.map(field => [`extra ${field}`, { shotId: "S01", attemptNumber: 2, [field]: field === "episodeId" ? "EP02" : "a".repeat(64) }] as const),
  ] as const)("rejects %s", async (_label, selection) => {
    const f = await fixture(); await admit(f);
    const inspector = vi.fn(inspectVisualAttemptExecutionLifecycle); const read = vi.fn(readBoundFile);
    await expect(buildBoundEpisodePreflight({ ...f.input, visualAttemptSelection: selection as never }, readers(inspector, read)))
      .rejects.toThrow(TypeError);
    expect(inspector).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
  it("a well-formed shot outside the episode binds nothing and inspects nothing", async () => {
    const f = await fixture(); await admit(f);
    const inspector = vi.fn(inspectVisualAttemptExecutionLifecycle);
    const report = await buildBoundEpisodePreflight({ ...f.input, visualAttemptSelection: { shotId: "S99", attemptNumber: 2 } }, readers(inspector));
    expect(inspector).not.toHaveBeenCalled();
    expect(report.visualAttempt).toMatchObject({ shotId: "S99", attemptNumber: 2, lifecycle: "UNEVALUATED" });
    expect(codes(report)).toEqual(["INPUT_BINDING_DRIFT"]); expect(report.nextActionCandidate).toBeNull();
  });
});

describe("C. exact attempt authority", () => {
  it.each([2, 5])("inspects exactly attempt %i once and binds only that attempt", async attemptNumber => {
    const f = await fixture(); await admit(f, { attemptNumber });
    const inspector = vi.fn(inspectVisualAttemptExecutionLifecycle);
    const report = await select(f, attemptNumber, {}, readers(inspector));
    expect(inspector.mock.calls).toEqual([[f.mediaRoot, "EP02", "S01", attemptNumber]]);
    expect(report.nextActionCandidate).toMatchObject({ kind: "VISUAL_ATTEMPT_GENERATE", shotId: "S01", attemptNumber });
  });
  it("never infers, increments or borrows a neighbouring admitted attempt", async () => {
    const f = await fixture(); await admit(f, { attemptNumber: 2 }); await admit(f, { attemptNumber: 4 });
    for (const attemptNumber of [3, 5]) {
      const inspector = vi.fn(inspectVisualAttemptExecutionLifecycle);
      const report = await select(f, attemptNumber, {}, readers(inspector));
      expect(inspector.mock.calls).toEqual([[f.mediaRoot, "EP02", "S01", attemptNumber]]);
      expect(report.visualAttempt).toMatchObject({ attemptNumber, lifecycle: "NOT_ADMITTED" });
      expect(report.nextActionCandidate).toBeNull();
    }
  });
  it("legacy Attempt-1 COMPLETED neither blocks an exact ADMITTED_ONLY attempt nor grants one, and stays intact", async () => {
    const f = await fixture(); await complete(f, "S01", await accepted(f, "S01"));
    const completionBefore = await inspectExecutionLifecycle(f.mediaRoot, "EP02", "S01");
    const evidenceAdoptions = await reviewedEvidence(f);
    const unadmitted = await select(f, 2, { evidenceAdoptions });
    expect(unadmitted.shots.find(row => row.shotId === "S01")).toMatchObject({ disposition: "COMPLETED", completionVerification: "VERIFIED" });
    expect(unadmitted.visualAttempt).toMatchObject({ lifecycle: "NOT_ADMITTED" }); expect(unadmitted.nextActionCandidate).toBeNull();
    await admit(f);
    const legacy = await buildBoundEpisodePreflight({ ...f.input, evidenceAdoptions });
    expect(legacy.nextActionCandidate).toMatchObject({ kind: "VISUAL_GENERATE", shotId: "S11" });
    const report = await select(f, 2, { evidenceAdoptions });
    expect(report.shots.find(row => row.shotId === "S01")).toMatchObject({ disposition: "COMPLETED", completionVerification: "VERIFIED" });
    expect(report.nextActionCandidate).toMatchObject({ kind: "VISUAL_ATTEMPT_GENERATE", shotId: "S01", attemptNumber: 2 });
    expect(await inspectExecutionLifecycle(f.mediaRoot, "EP02", "S01")).toEqual(completionBefore);
  });
  it("existing unattested legacy evidence still fails closed", async () => {
    const f = await fixture(); await complete(f, "S01", await accepted(f, "S01")); await admit(f);
    const report = await select(f);
    expect(report.intentAlignment).toBe("REVIEW_REQUIRED"); expect(report.nextActionCandidate).toBeNull();
  });
});

describe("D. only ADMITTED_ONLY yields a candidate", () => {
  it("ADMITTED_ONLY yields exactly one VISUAL_ATTEMPT_GENERATE, never a substituted fresh frontier", async () => {
    const f = await fixture(); await admit(f);
    const report = await select(f);
    expect(report.visualAttempt).toEqual({ shotId: "S01", attemptNumber: 2, lifecycle: "ADMITTED_ONLY", reasons: [] });
    expect(report.generationMayBeAuthorized).toBe(true);
    expect(report.nextActionCandidate?.kind).toBe("VISUAL_ATTEMPT_GENERATE");
  });
  it("NOT_ADMITTED yields no candidate even with a READY fresh frontier", async () => {
    const f = await fixture();
    const report = await select(f);
    expect(report.shots.find(row => row.shotId === "S11")?.disposition).toBe("READY");
    expect(report.visualAttempt).toMatchObject({ lifecycle: "NOT_ADMITTED" });
    expect(codes(report)).toEqual(["PROVIDER_ADMISSION_BLOCKED"]);
    expect(report.nextActionCandidate).toBeNull(); expect(report.generationMayBeAuthorized).toBe(false);
  });
  it("a durable RESERVED_ONLY attempt fails closed", async () => {
    const f = await fixture(); const admission = await admit(f);
    await createVisualAttemptExecutionReservation(f.mediaRoot, { episodeId: "EP02", sceneId: "SC01", shotId: "S01", attemptNumber: 2,
      provider: "GOOGLE_GENAI", expectedAdmissionId: admission.record.admissionId, expectedAdmissionSha256: admission.admissionSha256 });
    const report = await select(f);
    expect(report.visualAttempt).toMatchObject({ lifecycle: "RESERVED_ONLY" });
    expect(codes(report)).toContain("RESERVED_ONLY_MANUAL_ADJUDICATION"); expect(report.nextActionCandidate).toBeNull();
  });
  it.each([
    ["RESERVED_ONLY", "RESERVED_ONLY", "RESERVED_ONLY_MANUAL_ADJUDICATION"],
    ["SUBMITTED", "SUBMITTED", "SUBMITTED_RECOVERY_REQUIRED"],
    ["COMPLETED", "COMPLETED", null],
    ["RECONCILING", "INVALID", "INVALID_DURABLE_STATE"],
    [undefined, "INVALID", "INVALID_DURABLE_STATE"],
  ] as const)("synthetic %s fails closed as %s", async (state, lifecycle, code) => {
    const f = await fixture(); await admit(f);
    const report = await select(f, 2, {}, readers(syntheticLifecycle(() => ({ state }))));
    expect(report.visualAttempt).toMatchObject({ lifecycle });
    if (code) expect(codes(report)).toContain(code);
    expect(report.nextActionCandidate).toBeNull(); expect(report.generationMayBeAuthorized).toBe(false);
  });
  it("malformed durable admission evidence fails closed", async () => {
    const f = await fixture();
    const path = createVisualAttemptAdmissionPath(f.mediaRoot, "EP02", "S01", 2);
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, "{malformed-admission");
    const report = await select(f);
    expect(report.visualAttempt).toMatchObject({ lifecycle: "INVALID" });
    expect(codes(report)).toEqual(["INVALID_DURABLE_STATE"]); expect(report.nextActionCandidate).toBeNull();
  });
  it("ambiguous attempt evidence fails closed", async () => {
    const f = await fixture(); await admit(f);
    const ambiguous = vi.fn(async () => { throw new Error("Attempt-aware reservation exists without a durable admission."); });
    const report = await select(f, 2, {}, readers(ambiguous));
    expect(report.visualAttempt).toMatchObject({ lifecycle: "INVALID" }); expect(report.nextActionCandidate).toBeNull();
  });
  it("the default-off activation switch blocks the candidate", async () => {
    const f = await fixture({ activation: false }); await admit(f);
    const report = await select(f);
    expect(report.visualAttempt).toMatchObject({ lifecycle: "ADMITTED_ONLY" });
    expect(codes(report)).toContain("PROVIDER_ACTIVATION_BLOCKED"); expect(report.nextActionCandidate).toBeNull();
  });
});

describe("E. durable admission identity", () => {
  it.each([
    ["episode", () => ({ episodeId: "EP03" })], ["scene", () => ({ sceneId: "SC02" })], ["shot", () => ({ shotId: "S10" })],
    ["attempt number", () => ({ attemptNumber: 3 })], ["provider", () => ({ provider: "RUNWAY" })],
    ...(["episodeId", "sceneId", "shotId", "attemptNumber", "provider", "status"] as const).map(field => [`admission record ${field}`,
      (lifecycle: Extract<AttemptLifecycle, { state: "ADMITTED_ONLY" }>) => ({ admission: { ...lifecycle.admission, record: { ...lifecycle.admission.record,
        [field]: ({ episodeId: "EP03", sceneId: "SC02", shotId: "S10", attemptNumber: 3, provider: "RUNWAY", status: "REJECTED" } as const)[field] } } })] as const),
  ] as const)("refuses a mismatched %s", async (_label, patch) => {
    const f = await fixture(); await admit(f);
    const report = await select(f, 2, {}, readers(syntheticLifecycle(patch)));
    expect(report.visualAttempt).toMatchObject({ lifecycle: "INVALID" });
    expect(codes(report)).toEqual(["INVALID_DURABLE_STATE"]); expect(report.nextActionCandidate).toBeNull();
  });
  it("refuses a durable admission bound to another canonical scene", async () => {
    const f = await fixture(); await admit(f, { sceneId: "SC02" });
    const report = await select(f);
    expect(report.visualAttempt).toMatchObject({ lifecycle: "INVALID" }); expect(report.nextActionCandidate).toBeNull();
  });
  it("refuses an admitted manifest SHA that is not the reviewed MANIFEST binding", async () => {
    const f = await fixture(); await admit(f, { manifestRawSha256: "e".repeat(64) });
    const report = await select(f);
    expect(report.visualAttempt).toMatchObject({ lifecycle: "ADMITTED_ONLY" });
    expect(codes(report)).toEqual(["INPUT_BINDING_DRIFT"]); expect(report.nextActionCandidate).toBeNull();
  });
  it("refuses an admission after the raw manifest changed", async () => {
    const f = await fixture(); await admit(f);
    f.episode.title = "Authoring changed after admission."; await f.save();
    const report = await select(f);
    expect(codes(report)).toEqual(["INPUT_BINDING_DRIFT"]); expect(report.nextActionCandidate).toBeNull();
  });
});

const R37Y_ACTION_KEYS = ["attemptNumber", "confirmPaidGeneration", "costAuthority", "episodeId", "expectedAttemptLifecycle", "kind",
  "order", "referenceBinding", "resolvedProvider", "sceneId", "shotId"];
describe("F. reviewed action shape", () => {
  it("candidate and frozen action carry only the R37Y identity, reviewed reference and reviewed cost", async () => {
    const f = await fixture(); const admission = await admit(f);
    const before = await select(f);
    const candidate = before.nextActionCandidate;
    if (candidate?.kind !== "VISUAL_ATTEMPT_GENERATE") throw new Error("Missing attempt candidate.");
    expect(Object.keys(candidate).sort()).toEqual(["attemptNumber", "cost", "episodeId", "expectedAttemptLifecycle", "kind", "order",
      "provider", "referenceBinding", "sceneId", "shotId"]);
    expect(candidate).toMatchObject({ episodeId: "EP02", sceneId: "SC01", shotId: "S01", order: 2, attemptNumber: 2,
      expectedAttemptLifecycle: "ADMITTED_ONLY", provider: "GOOGLE_GENAI", cost: { status: "KNOWN", unit: "MICRO_USD" } });
    expect(candidate.referenceBinding).toEqual(before.binding?.referenceBindings.find(row => row.shotId === "S01"));
    expect(candidate.cost.policySha256).toBe(before.binding?.fileBindings.find(file => file.role === "GOOGLE_ACTIVATION")?.rawSha256);
    const plan = attemptPlan(before); const action = plan.actions[0];
    expect(Object.keys(action).sort()).toEqual(R37Y_ACTION_KEYS);
    expect(action).toMatchObject({ kind: "VISUAL_ATTEMPT_GENERATE", attemptNumber: 2, expectedAttemptLifecycle: "ADMITTED_ONLY",
      resolvedProvider: "GOOGLE_GENAI", confirmPaidGeneration: true });
    expect(Object.isFrozen(action)).toBe(true); expect(plan.maximumNewProviderCreates).toBe(1);
    const serialized = JSON.stringify([before, plan]);
    for (const lineage of [admission.record.admissionId, admission.admissionSha256, admission.record.promptIdentitySha256,
      admission.record.referenceIdentitySha256, admission.record.previousAttemptQcSha256]) expect(serialized).not.toContain(lineage);
  });
});

describe("H. genuine checked authority", () => {
  it("a real checked context accepts the exact reviewed attempt and re-inspects only that attempt", async () => {
    const f = await fixture(); await admit(f);
    const before = await select(f); const plan = attemptPlan(before);
    expect(() => assertReviewedEpisodeAction(plan, before)).not.toThrow();
    const { context, preflight } = await checked(f, plan, before);
    await expect(assertCheckedEpisodeAdmission(context)).resolves.toBeUndefined();
    expect(preflight).toHaveBeenCalledTimes(1);
    expect(preflight.mock.calls[0]![0]).toMatchObject({ episodeId: "EP02", visualAttemptSelection: { shotId: "S01", attemptNumber: 2 },
      expectedBinding: plan.inputBinding });
  });
  it("an attempt number changed after review fails closed", async () => {
    const f = await fixture(); await admit(f);
    const before = await select(f); const changed = attemptPlan(before, { attemptNumber: 3 });
    let drift: unknown = null;
    try { assertReviewedEpisodeAction(changed, before); } catch (cause) { drift = cause; }
    expect(drift).toMatchObject({ name: "BoundEpisodeError", code: "INPUT_BINDING_DRIFT" });
    // The checked re-preflight inspects the changed attempt, which was never admitted.
    const { context } = await checked(f, changed, before);
    await expect(assertCheckedEpisodeAdmission(context)).rejects.toMatchObject({ code: "EARLIER_EPISODE_WORK_UNRESOLVED" });
  });
  it("a caller action whose attempt differs from the frozen reviewed action is drift before anything else", async () => {
    const f = await fixture(); await admit(f);
    const before = await select(f); const plan = attemptPlan(before);
    const { context, preflight, verifyRuntime } = await checked(f, plan, before); const deps = tripwires();
    await expect(coordinateEpisodeAction({ episodeId: "EP02", action: { ...plan.actions[0], attemptNumber: 3 } as typeof plan.actions[0],
      controlledContext: context }, deps.typed)).rejects.toMatchObject({ code: "INPUT_BINDING_DRIFT" });
    expect(deps.calls()).toBe(0); expect(preflight).not.toHaveBeenCalled(); expect(verifyRuntime).not.toHaveBeenCalled();
  });
  it("a fabricated context remains invalid", async () => {
    const fabricated = Object.freeze({ episodeId: "EP02" });
    await expect(assertCheckedEpisodeAdmission(fabricated)).rejects.toMatchObject({ code: "OPERATING_CONDITION_UNESTABLISHED" });
  });
  it("manifest drift after review fails closed", async () => {
    const f = await fixture(); await admit(f);
    const before = await select(f); const { context } = await checked(f, attemptPlan(before), before);
    f.episode.title = "Reviewed authoring changed."; await f.save();
    await expect(assertCheckedEpisodeAdmission(context)).rejects.toMatchObject({ code: "INPUT_BINDING_DRIFT" });
  });
  it("reference drift after review fails closed", async () => {
    const f = await fixture(); await admit(f);
    const before = await select(f); const { context } = await checked(f, attemptPlan(before), before);
    await writeFile(join(f.mediaRoot, "references/ref.png"), Buffer.from("changed-reference"));
    const error: unknown = await assertCheckedEpisodeAdmission(context).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ name: "BoundEpisodeError" });
    expect(["REFERENCE_DRIFT", "INPUT_BINDING_DRIFT"]).toContain((error as { code: string }).code);
  });
});

describe("I. Slice-2I-A dormancy", () => {
  it("coordinateEpisodeAction refuses the genuine reviewed attempt before any I/O, runner, reservation or provider", async () => {
    const f = await fixture(); await admit(f);
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network tripwire."));
    const before = await select(f); const plan = attemptPlan(before);
    const { context, invocation, preflight, verifyRuntime } = await checked(f, plan, before); const deps = tripwires();
    const error: unknown = await coordinateEpisodeAction({ episodeId: "EP02", action: plan.actions[0], controlledContext: context }, deps.typed)
      .catch((cause: unknown) => cause);
    expect(error).toMatchObject({ name: "BoundEpisodeError", code: "ACTION_REJECTED" });
    expect((error as Error).cause).toBeInstanceOf(Error);
    expect(String(((error as Error).cause as Error).message)).toMatch(/not enabled in Slice-2I-A/);
    expect(deps.calls()).toBe(0); expect(preflight).not.toHaveBeenCalled(); expect(verifyRuntime).not.toHaveBeenCalled();
    expect(episodeInvocationCounts(invocation)).toEqual({ dispatchAllowanceConsumed: 0, recoveryDispatchCount: 0 });
    expect(() => admitEpisodeCoordinatorDispatch(invocation)).not.toThrow(); // The dispatch latch was never taken.
    expect((await inspectVisualAttemptExecutionLifecycle(f.mediaRoot, "EP02", "S01", 2)).state).toBe("ADMITTED_ONLY");
    await expect(readFile(createVisualAttemptExecutionReservationPath(f.mediaRoot, "EP02", "S01", 2))).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
  it.each(["GENERATION", "RECONCILIATION"] as const)("runEpisodeAutomation with a %s session never dispatches an attempt plan", async family => {
    const f = await fixture(); await admit(f);
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network tripwire."));
    const plan = attemptPlan(await select(f)); const deps = tripwires();
    const coordinateAction = vi.fn((...args: Parameters<typeof coordinateEpisodeAction>) => coordinateEpisodeAction(args[0] as never, deps.typed));
    const outcome: unknown = await runEpisodeAutomation(plan, { coordinateAction: coordinateAction as unknown as typeof coordinateEpisodeAction,
      verifyRuntime: vi.fn(async () => undefined), buildPreflight: buildBoundEpisodePreflight }, createFreshEpisodeOperatorSession(family, true))
      .catch((cause: unknown) => cause);
    if (outcome !== null && typeof outcome === "object" && "status" in outcome) {
      expect(outcome).toMatchObject({ status: "REJECTED", dispatchAllowanceConsumed: 0, actionMayHaveEffects: false });
    } else expect(outcome).toMatchObject({ name: "BoundEpisodeError" });
    expect(coordinateAction).not.toHaveBeenCalled(); expect(deps.calls()).toBe(0); expect(network).not.toHaveBeenCalled();
    await expect(readFile(episodeExecutionGuardPath(f.mediaRoot, "EP02"))).rejects.toThrow();
    expect((await inspectVisualAttemptExecutionLifecycle(f.mediaRoot, "EP02", "S01", 2)).state).toBe("ADMITTED_ONLY");
  });
  it("exposes no --attempt CLI surface", () => {
    expect(() => parseSingleShotExecutionCliArgs(["--episode", "EP02", "--shot", "S01", "--image", "C:/media/ref.png",
      "--attempt", "2", "--confirm-paid-generation"])).toThrow(/Unknown single-shot execution CLI argument: --attempt/);
  });
  it("the control-plane sources wire no attempt operator, production factory, reservation writer or CLI attempt", async () => {
    for (const path of ["src/execution/buildBoundEpisodePreflight.ts", "src/execution/episodeExecutionGuard.ts",
      "src/execution/coordinateEpisodeAction.ts", "src/execution/episodeAutomationPlan.schema.ts", "src/execution/boundEpisodeProduction.types.ts"]) {
      const code = (await readFile(path, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, path).not.toMatch(/executeGoogleGenAiVisualAttemptSingleShot|createProductionGoogleGenAiVisualAttemptExecutionDependencies|createVisualAttemptExecution(?:Reservation|Submission|Completion)|createVisualAttemptGenerationRecord|createVisualAttemptAdmission|--attempt|@google\/genai|process\.env/);
    }
  });
});
