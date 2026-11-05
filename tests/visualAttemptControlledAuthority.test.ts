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
import { runSingleShotExecutionCli, type RunSingleShotExecutionCliDependencies } from "../src/execution/cli/runSingleShotExecutionCli.js";
import { executeProductionVisualAttemptSingleShot } from "../src/execution/createProductionSingleShotExecutionDependencies.js";
import { buildGoogleGenAiSingleShotPrompt } from "../src/execution/providers/buildGoogleGenAiSingleShotPrompt.js";
import { BoundEpisodeActionError, type BoundEpisodeActionResult } from "../src/execution/boundEpisodeProduction.types.js";
import { verifyVisualAttemptDurableCompletion, type VisualAttemptDurableCompletionVerification } from "../src/execution/verifyVisualAttemptDurableCompletion.js";

// B5 Slice-2I-A: explicit attempt selection -> exact ADMITTED_ONLY authority
// -> reviewed VISUAL_ATTEMPT_GENERATE -> genuine checked context.
// B5 Slice-2I-B: -> fresh GENERATION session -> coordinator -> secured CLI
// transport -> shared seam -> attempt operator, stopping at SUBMITTED.
// Synthetic temporary media roots only; the SDK is a tripwire, network is
// rejected and every provider interaction is a synthetic in-process fake.
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(() => { throw new Error("The real Google SDK must never be constructed by the Slice-2I tests."); }),
}));

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
  {
    // Synthetic fixture owns its activation value explicitly. Repository
    // activation state must never leak into this test contract.
    const path = join(repositoryRoot, "config/google-genai-activation-policy.json");
    const policy = JSON.parse(await readFile(path, "utf8"));
    policy.admission.newSubmissionsEnabled = options.activation ?? true;
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

async function admit(f: Fixture, overrides: Readonly<{ attemptNumber?: number; sceneId?: string; manifestRawSha256?: string;
  promptIdentitySha256?: string; referenceIdentitySha256?: string }> = {}) {
  const attemptNumber = overrides.attemptNumber ?? 2;
  return createVisualAttemptAdmission(f.mediaRoot, { attemptNumber, episodeId: "EP02", sceneId: overrides.sceneId ?? "SC01", shotId: "S01",
    provider: "GOOGLE_GENAI", manifestRawSha256: overrides.manifestRawSha256 ?? rawSha256(await readFile(f.manifest)),
    promptIdentitySha256: overrides.promptIdentitySha256 ?? "b".repeat(64), referenceIdentitySha256: overrides.referenceIdentitySha256 ?? "c".repeat(64),
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

function syntheticAttemptLifecycle(
  lifecycle:
    Extract<AttemptLifecycle, { state: "ADMITTED_ONLY" }>,

  patch:
    Readonly<Record<string, unknown>>,
): AttemptLifecycle {
  const next:
    Readonly<Record<string, unknown>> = {
      ...lifecycle,
      ...patch,
    };

  if (next.state !== "SUBMITTED") {
    return next as unknown as AttemptLifecycle;
  }

  return {
    ...next,

    reservationId:
      "b5-synthetic-attempt2-reservation",

    reservation: {
      reservationSha256:
        "e".repeat(64),
    },

    submission: {
      submissionSha256:
        "f".repeat(64),

      record: {
        provider:
          "GOOGLE_GENAI",

        providerExecutionId:
          "v1_b5-synthetic-attempt2-interaction",
      },
    },
  } as unknown as AttemptLifecycle;
}

function syntheticLifecycle(
  patch:
    (
      lifecycle:
        Extract<AttemptLifecycle, { state: "ADMITTED_ONLY" }>,
    ) => Readonly<Record<string, unknown>>,
) {
  return vi.fn(async (...args: Parameters<typeof inspectVisualAttemptExecutionLifecycle>) => {
    const lifecycle = await inspectVisualAttemptExecutionLifecycle(...args);

    if (lifecycle.state !== "ADMITTED_ONLY") {
      throw new Error(
        "Synthetic lifecycle needs an admitted base.",
      );
    }

    return syntheticAttemptLifecycle(
      lifecycle,
      patch(lifecycle),
    );
  });
}

const OPERATING = { singleOperator: true, noConcurrentAuthoring: true, noUnguardedRunners: true } as const;
// The parsed (frozen) attempt fixture, refined only after runtime validation of its single action.
type VisualAttemptAction = Extract<ControlledEpisodeAutomationPlan["actions"][number], { kind: "VISUAL_ATTEMPT_GENERATE" }>;
type VisualAttemptPlan = Omit<ControlledEpisodeAutomationPlan, "actions"> & Readonly<{ actions: readonly [VisualAttemptAction] }>;
function isVisualAttemptPlan(plan: ControlledEpisodeAutomationPlan): plan is VisualAttemptPlan {
  return plan.actions.length === 1 && plan.actions[0].kind === "VISUAL_ATTEMPT_GENERATE";
}
function attemptPlan(before: BoundEpisodePreflight, overrides: Readonly<Record<string, unknown>> = {},
  evidenceAdoptions: readonly EvidenceAdoption[] = []): VisualAttemptPlan {
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
  if (!isVisualAttemptPlan(plan)) throw new Error("Fixture needs a VISUAL_ATTEMPT_GENERATE action.");
  return plan;
}

async function checked(f: Fixture, plan: ControlledEpisodeAutomationPlan, beforePlan: BoundEpisodePreflight,
  preflight = vi.fn(buildBoundEpisodePreflight)) {
  const manifest = plan.inputBinding.fileBindings.find(file => file.role === "MANIFEST")!.rawSha256!;
  const guard = await acquireEpisodeExecutionGuard({ mediaRoot: f.mediaRoot, episodeId: "EP02", manifestRawSha256: manifest, sessionId: randomUUID() });
  guards.push(guard);
  const invocation = createEpisodeInvocation("EP02", 1);
  const verifyRuntime = vi.fn(async () => undefined);
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
    runDialogueReconcileCli: trip("runDialogueReconcileCli"), verifyVisualAttemptDurableCompletion: trip("verifyVisualAttemptDurableCompletion") };
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

  it("legacy Attempt-1 COMPLETED without evidence adoption does not block exact Attempt-2 SUBMITTED recovery", async () => {
    const f = await fixture();

    await complete(
      f,
      "S01",
      await accepted(
        f,
        "S01",
      ),
    );

    await admit(f);

    const report =
      await select(
        f,
        2,
        {},
        readers(
          syntheticLifecycle(
            () => ({
              state:
                "SUBMITTED",
            }),
          ),
        ),
      );

    expect(
      report.shots.find(
        row =>
          row.shotId === "S01",
      ),
    ).toMatchObject({
      disposition:
        "COMPLETED",

      completionVerification:
        "VERIFIED",

      intentAlignment:
        "UNATTESTED_EXISTING_EVIDENCE",
    });

    expect(
      report.visualAttempt,
    ).toMatchObject({
      shotId:
        "S01",

      attemptNumber:
        2,

      lifecycle:
        "SUBMITTED",
    });

    expect(
      report.nextActionCandidate,
    ).toMatchObject({
      episodeId:
        "EP02",

      sceneId:
        "SC01",

      shotId:
        "S01",

      attemptNumber:
        2,

      kind:
        "VISUAL_ATTEMPT_RECONCILE",

      expectedAttemptLifecycle:
        "SUBMITTED",

      provider:
        "GOOGLE_GENAI",
    });

    expect(
      report.intentAlignment,
    ).toBe(
      "REVIEW_REQUIRED",
    );

    expect(
      report.recoveryMayBeAuthorized,
    ).toBe(true);

    expect(
      report.generationMayBeAuthorized,
    ).toBe(false);
  });

  it("a valid synthetic SUBMITTED attempt yields exactly one zero-create recovery candidate", async () => {
    const f = await fixture();
    await admit(f);

    const report =
      await select(
        f,
        2,
        {},
        readers(
          syntheticLifecycle(
            () => ({
              state:
                "SUBMITTED",
            }),
          ),
        ),
      );

    expect(
      report.visualAttempt,
    ).toMatchObject({
      shotId:
        "S01",

      attemptNumber:
        2,

      lifecycle:
        "SUBMITTED",
    });

    expect(
      codes(
        report,
      ),
    ).toContain(
      "SUBMITTED_RECOVERY_REQUIRED",
    );

    expect(
      report.nextActionCandidate,
    ).toEqual({
      episodeId:
        "EP02",

      sceneId:
        "SC01",

      shotId:
        "S01",

      order:
        2,

      kind:
        "VISUAL_ATTEMPT_RECONCILE",

      attemptNumber:
        2,

      expectedAttemptLifecycle:
        "SUBMITTED",

      provider:
        "GOOGLE_GENAI",

      reservationId:
        "b5-synthetic-attempt2-reservation",

      reservationSha256:
        "e".repeat(64),

      submissionSha256:
        "f".repeat(64),

      providerExecutionIdentitySha256:
        rawSha256(
          JSON.stringify([
            "GOOGLE_GENAI",
            "v1_b5-synthetic-attempt2-interaction",
          ]),
        ),
    });

    expect(
      report.generationMayBeAuthorized,
    ).toBe(
      false,
    );

    expect(
      report.recoveryMayBeAuthorized,
    ).toBe(
      true,
    );
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

// ---------------------------------------------------------------------------
// B5 Slice-2I-B controlled dispatch.

const ATTEMPT_SELECTION = { shotId: "S01", attemptNumber: 2 } as const;
const INTERACTION_ID = "v1_b5-2ib-synthetic-attempt2-interaction";
const tripwireNetwork = () => vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network tripwire."));
const attemptState = async (f: Fixture) => (await inspectVisualAttemptExecutionLifecycle(f.mediaRoot, "EP02", "S01", 2)).state;

function shotS01(f: Fixture) {
  return f.episode.scenes.flatMap(scene => scene.shots).find(shot => shot.id === "S01")!;
}
// Admission identities equal to what the real attempt operator will derive.
async function admitExact(f: Fixture, overrides: Readonly<{ promptIdentitySha256?: string; referenceIdentitySha256?: string }> = {}) {
  return admit(f, { promptIdentitySha256: overrides.promptIdentitySha256 ?? rawSha256(buildGoogleGenAiSingleShotPrompt(shotS01(f))),
    referenceIdentitySha256: overrides.referenceIdentitySha256 ?? rawSha256(await readFile(join(f.mediaRoot, "references/ref.png"))) });
}

function legacyPlan(before: BoundEpisodePreflight, evidenceAdoptions: readonly EvidenceAdoption[] = []): ControlledEpisodeAutomationPlan {
  const candidate = before.nextActionCandidate;
  if (!before.binding || !before.bindingSha256 || !candidate || candidate.kind === "VISUAL_ATTEMPT_GENERATE" || candidate.kind === "VISUAL_ATTEMPT_RECONCILE") throw new Error("Fixture needs a legacy candidate.");
  const target = { episodeId: candidate.episodeId, sceneId: candidate.sceneId, shotId: candidate.shotId, order: candidate.order };
  const action = candidate.kind === "VISUAL_GENERATE"
    ? { ...target, kind: candidate.kind, expectedLifecycle: candidate.expectedLifecycle, resolvedProvider: candidate.provider,
      referenceBinding: candidate.referenceBinding, costAuthority: { unit: candidate.cost.unit, modeledValue: candidate.cost.modeledValue,
        maxModeledValue: candidate.cost.perShotCap, policySha256: candidate.cost.policySha256 }, confirmPaidGeneration: true }
    : { ...target, kind: candidate.kind, expectedLifecycle: candidate.expectedLifecycle, reservationId: candidate.observation.reservationId,
      durableProvider: candidate.observation.durableProvider, providerExecutionIdentitySha256: candidate.observation.providerExecutionIdentitySha256,
      submissionSha256: candidate.observation.submissionSha256, reservationSha256: candidate.observation.reservationSha256, confirmReconciliation: true };
  const plan = parseEpisodeAutomationPlan({ schemaVersion: "2.0", mode: "CONTROLLED_VISUAL", episodeId: "EP02", scope: before.scope,
    inputBinding: before.binding, inputBindingSha256: before.bindingSha256, observations: before.observations,
    observationsSha256: before.observationsSha256, evidenceAdoptions, maximumNewProviderCreates: candidate.kind === "VISUAL_GENERATE" ? 1 : 0,
    operatingCondition: OPERATING, actions: [action] });
  if (plan.schemaVersion !== "2.0") throw new Error("Wrong fixture schema.");
  return plan;
}

function sessionProbe() {
  const coordinateAction = vi.fn(async () => ({ status: "STOPPED" }) as unknown as BoundEpisodeActionResult);
  return { coordinateAction, typed: coordinateAction as unknown as typeof coordinateEpisodeAction };
}

// Every shared-CLI dependency is a tripwire except, where given, the synthetic environment,
// media-root validation and the shared attempt composition point.
function cliDependencies(f: Fixture, live: Readonly<{ executeVisualAttempt?: RunSingleShotExecutionCliDependencies["executeVisualAttempt"] }> = {}) {
  const trip = (name: string) => vi.fn(() => { throw new Error(`${name} must not be reached.`); });
  const dependencies = { loadEnvironment: live.executeVisualAttempt ? vi.fn(() => ({ GEMINI_API_KEY: "synthetic-b5-2ib-credential" })) : trip("loadEnvironment"),
    loadEpisodeManifest: trip("loadEpisodeManifest"), loadCharacterBible: trip("loadCharacterBible"), loadProductionRules: trip("loadProductionRules"),
    loadProviderRoutingPolicy: trip("loadProviderRoutingPolicy"), validateEpisodeProduction: trip("validateEpisodeProduction"),
    validateMediaRoot: live.executeVisualAttempt ? vi.fn(async () => f.mediaRoot) : trip("validateMediaRoot"),
    inspectExecutionLifecycle: trip("inspectExecutionLifecycle"), createDependencies: trip("createDependencies"),
    executeSingleShot: trip("executeSingleShot"), executeVisualAttempt: live.executeVisualAttempt ? vi.fn(live.executeVisualAttempt) : trip("executeVisualAttempt") };
  return { dependencies, typed: dependencies as unknown as RunSingleShotExecutionCliDependencies,
    calls: () => Object.values(dependencies).reduce((total, fn) => total + fn.mock.calls.length, 0) };
}
const attemptArgs = (overrides: Readonly<{ episode?: string; shot?: string; image?: string; attempt?: string }> = {}, image = "") => [
  "--episode", overrides.episode ?? "EP02", "--shot", overrides.shot ?? "S01", "--image", overrides.image ?? image,
  "--attempt", overrides.attempt ?? "2", "--confirm-paid-generation"];

describe("I. Slice-2I-B unbound and fabricated attempts stay closed", () => {
  it("the unbound coordinator path still refuses VISUAL_ATTEMPT_GENERATE before any I/O", async () => {
    const deps = tripwires();
    await expect(coordinateEpisodeAction({ episodeId: "EP02", action: { kind: "VISUAL_ATTEMPT_GENERATE", sceneId: "SC01", shotId: "S01",
      attemptNumber: 2, confirmPaidGeneration: true } as never }, deps.typed)).rejects.toThrow(/Unsupported episode coordinator action kind/);
    expect(deps.calls()).toBe(0);
  });
  it("a fabricated controlled context fails closed before any I/O", async () => {
    const f = await fixture(); await admit(f);
    const plan = attemptPlan(await select(f)); const deps = tripwires();
    await expect(coordinateEpisodeAction({ episodeId: "EP02", action: plan.actions[0], controlledContext: Object.freeze({ episodeId: "EP02" }) }, deps.typed))
      .rejects.toMatchObject({ code: "OPERATING_CONDITION_UNESTABLISHED" });
    expect(deps.calls()).toBe(0); expect(await attemptState(f)).toBe("ADMITTED_ONLY");
  });
});

describe("J. fresh operator session family", () => {
  it("VISUAL_ATTEMPT_GENERATE consumes a single-use GENERATION session and preflights exactly the frozen attempt", async () => {
    const f = await fixture(); await admit(f); const network = tripwireNetwork();
    const plan = attemptPlan(await select(f)); const probe = sessionProbe(); const buildPreflight = vi.fn(buildBoundEpisodePreflight);
    const deps = { coordinateAction: probe.typed, verifyRuntime: vi.fn(async () => undefined), buildPreflight };
    const session = createFreshEpisodeOperatorSession("GENERATION", true);
    await expect(runEpisodeAutomation(plan, deps, session)).resolves.toMatchObject({ status: "STOPPED" });
    expect(probe.coordinateAction).toHaveBeenCalledTimes(1);
    const [input] = buildPreflight.mock.calls[0]!;
    expect(input).toMatchObject({ episodeId: "EP02", expectedBinding: plan.inputBinding, visualAttemptSelection: ATTEMPT_SELECTION });
    expect(input.visualAttemptSelection).toEqual(ATTEMPT_SELECTION);
    await expect(runEpisodeAutomation(plan, deps, session)).rejects.toMatchObject({ code: "OPERATING_CONDITION_UNESTABLISHED" });
    expect(probe.coordinateAction).toHaveBeenCalledTimes(1); expect(network).not.toHaveBeenCalled();
    await expect(readFile(episodeExecutionGuardPath(f.mediaRoot, "EP02"))).rejects.toThrow();
  });
  it("a RECONCILIATION session never authorizes attempt generation", async () => {
    const f = await fixture(); await admit(f); const network = tripwireNetwork();
    const plan = attemptPlan(await select(f)); const probe = sessionProbe(); const buildPreflight = vi.fn(buildBoundEpisodePreflight);
    await expect(runEpisodeAutomation(plan, { coordinateAction: probe.typed, verifyRuntime: vi.fn(async () => undefined), buildPreflight },
      createFreshEpisodeOperatorSession("RECONCILIATION", true))).rejects.toMatchObject({ name: "BoundEpisodeError", code: "OPERATING_CONDITION_UNESTABLISHED" });
    expect(probe.coordinateAction).not.toHaveBeenCalled(); expect(buildPreflight).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
    await expect(readFile(episodeExecutionGuardPath(f.mediaRoot, "EP02"))).rejects.toThrow();
    expect(await attemptState(f)).toBe("ADMITTED_ONLY");
  });
  it("legacy VISUAL_GENERATE keeps GENERATION and VISUAL_RECONCILE keeps RECONCILIATION, with no attempt selection", async () => {
    const g = await fixture(); const generate = legacyPlan(await buildBoundEpisodePreflight(g.input));
    const r = await fixture({ provider: "RUNWAY" }); await accepted(r, "S11"); const adoptions = await reviewedEvidence(r);
    const reconcile = legacyPlan(await buildBoundEpisodePreflight({ ...r.input, evidenceAdoptions: adoptions }), adoptions);
    for (const [plan, family, wrong] of [[generate, "GENERATION", "RECONCILIATION"], [reconcile, "RECONCILIATION", "GENERATION"]] as const) {
      const probe = sessionProbe(); const buildPreflight = vi.fn(buildBoundEpisodePreflight);
      const deps = { coordinateAction: probe.typed, verifyRuntime: vi.fn(async () => undefined), buildPreflight };
      await expect(runEpisodeAutomation(plan, deps, createFreshEpisodeOperatorSession(wrong, true))).rejects.toMatchObject({ code: "OPERATING_CONDITION_UNESTABLISHED" });
      expect(probe.coordinateAction).not.toHaveBeenCalled();
      await runEpisodeAutomation(plan, deps, createFreshEpisodeOperatorSession(family, true));
      expect(probe.coordinateAction).toHaveBeenCalledTimes(1);
      expect("visualAttemptSelection" in buildPreflight.mock.calls[0]![0]).toBe(false);
    }
  });
});

describe("K. shared CLI: --attempt is transport, never authority", () => {
  it("a direct --attempt invocation without a checked context fails before environment, composition or provider work", async () => {
    const f = await fixture(); await admit(f); const network = tripwireNetwork(); const cli = cliDependencies(f);
    await expect(runSingleShotExecutionCli(attemptArgs({}, join(f.mediaRoot, "references/ref.png")), cli.typed))
      .rejects.toMatchObject({ name: "BoundEpisodeError", code: "OPERATING_CONDITION_UNESTABLISHED" });
    expect(cli.calls()).toBe(0); expect(network).not.toHaveBeenCalled(); expect(await attemptState(f)).toBe("ADMITTED_ONLY");
  });
  it("a fabricated checked context fails closed", async () => {
    const f = await fixture(); await admit(f); const cli = cliDependencies(f);
    await expect(runSingleShotExecutionCli(attemptArgs({}, join(f.mediaRoot, "references/ref.png")), cli.typed, Object.freeze({ episodeId: "EP02" })))
      .rejects.toMatchObject({ code: "OPERATING_CONDITION_UNESTABLISHED" });
    expect(cli.calls()).toBe(0);
  });
  it.each([
    ["attempt", { attempt: "3" }], ["episode", { episode: "EP03" }], ["shot", { shot: "S11" }], ["image", { image: "C:/elsewhere/ref.png" }],
  ] as const)("a transport %s differing from the reviewed action is drift before any work", async (_label, overrides) => {
    const f = await fixture(); await admit(f);
    const before = await select(f); const plan = attemptPlan(before);
    const { context, preflight, verifyRuntime, invocation } = await checked(f, plan, before); const cli = cliDependencies(f);
    await expect(runSingleShotExecutionCli(attemptArgs(overrides, plan.actions[0].referenceBinding.canonicalAbsolutePath), cli.typed, context))
      .rejects.toMatchObject({ code: "INPUT_BINDING_DRIFT" });
    expect(cli.calls()).toBe(0); expect(preflight).not.toHaveBeenCalled(); expect(verifyRuntime).not.toHaveBeenCalled();
    expect(episodeInvocationCounts(invocation)).toEqual({ dispatchAllowanceConsumed: 0, recoveryDispatchCount: 0 });
  });
  it("an attempt context cannot run the legacy path, a legacy context cannot run an attempt, and confirmation stays literal", async () => {
    const f = await fixture(); await admit(f);
    const before = await select(f); const plan = attemptPlan(before); const image = plan.actions[0].referenceBinding.canonicalAbsolutePath;
    const { context } = await checked(f, plan, before); const cli = cliDependencies(f);
    await expect(runSingleShotExecutionCli(["--episode", "EP02", "--shot", "S01", "--image", image, "--confirm-paid-generation"], cli.typed, context))
      .rejects.toMatchObject({ code: "INPUT_BINDING_DRIFT" });
    await expect(runSingleShotExecutionCli(["--episode", "EP02", "--shot", "S01", "--image", image, "--attempt", "2"], cli.typed, context))
      .rejects.toMatchObject({ code: "ACTION_REJECTED" });
    const g = await fixture(); const legacyBefore = await buildBoundEpisodePreflight(g.input); const legacy = legacyPlan(legacyBefore);
    const { context: legacyContext } = await checked(g, legacy, legacyBefore);
    const legacyAction = legacy.actions[0];
    if (legacyAction.kind !== "VISUAL_GENERATE") throw new Error("Fixture needs VISUAL_GENERATE.");
    await expect(runSingleShotExecutionCli(["--episode", "EP02", "--shot", legacyAction.shotId, "--image", legacyAction.referenceBinding.canonicalAbsolutePath,
      "--attempt", "2", "--confirm-paid-generation"], cli.typed, legacyContext)).rejects.toMatchObject({ code: "INPUT_BINDING_DRIFT" });
    expect(cli.calls()).toBe(0);
  });
});

describe("L. coordinator dispatch and attempt-aware post-action adjudication", () => {
  // The checked preflight observes exactly the selected attempt; after the runner settles the
  // attempt inspector reports the synthetic post-state.
  async function dispatch(f: Fixture, post: (() => Promise<void>) | Readonly<{ state: string }> | null, evidenceAdoptions: readonly EvidenceAdoption[] = [],
    options: Readonly<{ verifier?: (...args: Parameters<typeof verifyVisualAttemptDurableCompletion>) => Promise<unknown>; runnerFails?: boolean }> = {}) {
    const before = await select(f, 2, { evidenceAdoptions }); const plan = attemptPlan(before, {}, evidenceAdoptions);
    let settled = false;
    const inspector = vi.fn(async (...args: Parameters<typeof inspectVisualAttemptExecutionLifecycle>) => {
      const lifecycle = await inspectVisualAttemptExecutionLifecycle(...args);
      if (
        settled &&
        post &&
        "state" in post
      ) {
        if (lifecycle.state !== "ADMITTED_ONLY") {
          throw new Error(
            "Synthetic post-state needs an admitted Attempt base.",
          );
        }

        return syntheticAttemptLifecycle(
          lifecycle,
          post,
        );
      }

      return lifecycle;
    });
    const preflight = vi.fn(buildBoundEpisodePreflight);
    preflight.mockImplementation(input => buildBoundEpisodePreflight(input, readers(inspector)));
    const issued = await checked(f, plan, before, preflight); const deps = tripwires();
    const runner = vi.fn(async () => {
      if (typeof post === "function") await post(); settled = true;
      if (options.runnerFails) throw new Error("Synthetic lower-runner failure after settling.");
    });
    deps.dependencies.runSingleShotExecutionCli = runner as never;
    if (options.verifier) deps.dependencies.verifyVisualAttemptDurableCompletion = vi.fn(options.verifier) as never;
    const outcome: unknown = await coordinateEpisodeAction({ episodeId: "EP02", action: plan.actions[0], controlledContext: issued.context }, deps.typed)
      .catch((cause: unknown) => cause);
    if (outcome instanceof Error && !options.runnerFails) throw outcome;
    const result = outcome instanceof BoundEpisodeActionError ? outcome.result : outcome as BoundEpisodeActionResult;
    return { ...issued, plan, runner, deps, result, outcome, verifier: deps.dependencies.verifyVisualAttemptDurableCompletion };
  }
  // A synthetic verification shaped like the durable verifier's result, for exactly EP02/SC01/S01/a2.
  function verification(patch: Readonly<Record<string, unknown>> = {}, lifecyclePatch: Readonly<Record<string, unknown>> = {}) {
    const identity = { episodeId: "EP02", sceneId: "SC01", shotId: "S01", attemptNumber: 2 };
    return { ...identity, provider: "GOOGLE_GENAI", lifecycle: { ...identity, state: "COMPLETED", ...lifecyclePatch }, ...patch } as unknown as
      VisualAttemptDurableCompletionVerification;
  }
  function expectExactSelection(preflight: Readonly<{ mock: Readonly<{ calls: readonly (readonly unknown[])[] }> }>, plan: ControlledEpisodeAutomationPlan) {
    const inputs = preflight.mock.calls.map(call => call[0] as Record<string, unknown>);
    expect(inputs.length).toBeGreaterThanOrEqual(3);
    for (const input of inputs) expect(input.visualAttemptSelection).toEqual(ATTEMPT_SELECTION);
    expect(inputs.at(-2)).toMatchObject({ expectedBinding: plan.inputBinding });
    expect("expectedBinding" in inputs.at(-1)!).toBe(false);
  }

  it("delegates exactly once through the secured runner with the exact reviewed transport and stops SUBMITTED for recovery", async () => {
    const f = await fixture(); await admit(f); const network = tripwireNetwork();
    const { runner, preflight, plan, invocation, result, context, deps } = await dispatch(f, { state: "SUBMITTED" });
    expect(runner).toHaveBeenCalledTimes(1);
    expect(runner.mock.calls[0]).toEqual([["--episode", "EP02", "--shot", "S01", "--image", plan.actions[0].referenceBinding.canonicalAbsolutePath,
      "--attempt", "2", "--confirm-paid-generation"], undefined, context]);
    expect(deps.dependencies.runProductionExecutionReconcileCli).not.toHaveBeenCalled();
    expect(deps.dependencies.verifyVisualAttemptDurableCompletion).not.toHaveBeenCalled();
    expectExactSelection(preflight, plan);
    expect(result).toMatchObject({ status: "STOPPED", stopReason: "SUBMITTED_RECOVERY_REQUIRED", selectedPostObservation: null,
      afterPlan: { visualAttempt: { shotId: "S01", attemptNumber: 2, lifecycle: "SUBMITTED" } } });
    expect(() => admitEpisodeCoordinatorDispatch(invocation)).toThrow(); // The exactly-once latch was taken.
    expect(network).not.toHaveBeenCalled();
  });
  it("a durable RESERVED_ONLY attempt stops for manual adjudication without retry or fallback", async () => {
    const f = await fixture(); const admission = await admit(f);
    const { runner, result, deps } = await dispatch(f, async () => {
      await createVisualAttemptExecutionReservation(f.mediaRoot, { episodeId: "EP02", sceneId: "SC01", shotId: "S01", attemptNumber: 2,
        provider: "GOOGLE_GENAI", expectedAdmissionId: admission.record.admissionId, expectedAdmissionSha256: admission.admissionSha256 });
    });
    expect(result).toMatchObject({ status: "STOPPED", stopReason: "RESERVED_ONLY_MANUAL_ADJUDICATION", afterPlan: { visualAttempt: { lifecycle: "RESERVED_ONLY" } } });
    expect(runner).toHaveBeenCalledTimes(1); expect(deps.dependencies.runProductionExecutionReconcileCli).not.toHaveBeenCalled();
    expect(deps.dependencies.verifyVisualAttemptDurableCompletion).not.toHaveBeenCalled();
    expect(await attemptState(f)).toBe("RESERVED_ONLY");
  });
  it("legacy Attempt-1 COMPLETED never masquerades as Attempt-2 completion", async () => {
    const f = await fixture(); await complete(f, "S01", await accepted(f, "S01")); await admit(f);
    const attempt1 = await inspectExecutionLifecycle(f.mediaRoot, "EP02", "S01");
    // Even an injected verifier that would vouch for Attempt 2 is never consulted while it is ADMITTED_ONLY.
    const { result, preflight, plan, verifier } = await dispatch(f, null, await reviewedEvidence(f), { verifier: async () => verification() });
    expect(verifier).not.toHaveBeenCalled();
    expect(result.afterPlan?.shots.find(row => row.shotId === "S01")).toMatchObject({ disposition: "COMPLETED", completionVerification: "VERIFIED" });
    expect(result).toMatchObject({ status: "REJECTED", stopReason: "UNEXPECTED_PROVIDER_RESULT", selectedPostObservation: null,
      afterPlan: { visualAttempt: { lifecycle: "ADMITTED_ONLY" } } });
    expect(result.status).not.toBe("ACTION_COMPLETED");
    expectExactSelection(preflight, plan);
    expect(await inspectExecutionLifecycle(f.mediaRoot, "EP02", "S01")).toEqual(attempt1);
  });
  it.each([
    ["NOT_ADMITTED", "UNRESOLVED", "POST_ACTION_STATE_UNRESOLVED"],
    ["RECONCILING", "UNRESOLVED", "INVALID_DURABLE_STATE"],
  ] as const)("an attempt post-state %s is never success (%s)", async (state, status, stopReason) => {
    const f = await fixture(); await admit(f);
    const { result, deps } = await dispatch(f, { state });
    expect(result).toMatchObject({ status, stopReason });
    expect(deps.dependencies.verifyVisualAttemptDurableCompletion).not.toHaveBeenCalled();
  });
  it("ADMITTED_ONLY after a normal return never consults the completion verifier", async () => {
    const f = await fixture(); await admit(f);
    const { result, verifier } = await dispatch(f, null, [], { verifier: async () => verification() });
    expect(result).toMatchObject({ status: "REJECTED", stopReason: "UNEXPECTED_PROVIDER_RESULT", afterPlan: { visualAttempt: { lifecycle: "ADMITTED_ONLY" } } });
    expect(verifier).not.toHaveBeenCalled();
  });
  it("a fabricated COMPLETED lifecycle is refused by the real durable verifier", async () => {
    const f = await fixture(); await admit(f); const network = tripwireNetwork();
    // The synthetic post-state says COMPLETED; the real read-only verifier inspects the durable attempt (still ADMITTED_ONLY).
    const { result, verifier, runner, deps } = await dispatch(f, { state: "COMPLETED" }, [], { verifier: verifyVisualAttemptDurableCompletion });
    expect(verifier).toHaveBeenCalledTimes(1);
    expect(vi.mocked(verifier).mock.calls[0]).toEqual([f.mediaRoot, "EP02", "S01", 2]);
    expect(result).toMatchObject({ status: "UNRESOLVED", stopReason: "LOCAL_COMPLETION_VERIFICATION_FAILED",
      afterPlan: { visualAttempt: { lifecycle: "COMPLETED" } } });
    expect(result.status).not.toBe("ACTION_COMPLETED");
    expect(result.issues[0]).toMatchObject({ code: "LOCAL_COMPLETION_VERIFICATION_FAILED", phase: "POST_ACTION", lowerCause: { name: "Error" } });
    expect(runner).toHaveBeenCalledTimes(1); expect(deps.calls()).toBe(2);
    expect(await attemptState(f)).toBe("ADMITTED_ONLY"); expect(network).not.toHaveBeenCalled();
  });
  it("an exact selected COMPLETED attempt proven by the injected durable verifier is ACTION_COMPLETED, without retry or recovery", async () => {
    const f = await fixture(); await admit(f); const network = tripwireNetwork();
    const { result, verifier, runner, deps, invocation } = await dispatch(f, { state: "COMPLETED" }, [], { verifier: async () => verification() });
    expect(result).toMatchObject({ status: "ACTION_COMPLETED", stopReason: null, issues: [],
      afterPlan: { visualAttempt: { shotId: "S01", attemptNumber: 2, lifecycle: "COMPLETED" } } });
    expect(vi.mocked(verifier).mock.calls).toEqual([[f.mediaRoot, "EP02", "S01", 2]]);
    // Exactly the one runner dispatch and the one read-only verification: no retry, fallback or recovery runner.
    expect(runner).toHaveBeenCalledTimes(1); expect(deps.calls()).toBe(2);
    expect(deps.dependencies.runProductionExecutionReconcileCli).not.toHaveBeenCalled();
    expect(() => admitEpisodeCoordinatorDispatch(invocation)).toThrow(); // The exactly-once latch was taken.
    expect(network).not.toHaveBeenCalled();
  });
  it.each([
    ["episodeId", () => verification({ episodeId: "EP03" })], ["sceneId", () => verification({ sceneId: "SC02" })],
    ["shotId", () => verification({ shotId: "S10" })], ["attemptNumber", () => verification({ attemptNumber: 3 })],
    ["lifecycle episodeId", () => verification({}, { episodeId: "EP03" })], ["lifecycle sceneId", () => verification({}, { sceneId: "SC02" })],
    ["lifecycle shotId", () => verification({}, { shotId: "S10" })], ["lifecycle attemptNumber", () => verification({}, { attemptNumber: 3 })],
    ["lifecycle state", () => verification({}, { state: "SUBMITTED" })], ["missing lifecycle", () => verification({ lifecycle: null })],
    ["null verification", () => null], ["string verification", () => "COMPLETED"],
  ] as ReadonlyArray<readonly [string, () => unknown]>)("a verification with a mismatched or malformed %s fails closed", async (_label, make) => {
    const f = await fixture(); await admit(f);
    const { result, verifier } = await dispatch(f, { state: "COMPLETED" }, [], { verifier: async () => make() });
    expect(verifier).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "UNRESOLVED", stopReason: "LOCAL_COMPLETION_VERIFICATION_FAILED" });
    expect(result.status).not.toBe("ACTION_COMPLETED");
  });
  it("a throwing durable verifier fails closed with its sanitized cause", async () => {
    const f = await fixture(); await admit(f);
    const { result, verifier } = await dispatch(f, { state: "COMPLETED" }, [], {
      verifier: async () => { throw Object.assign(new Error("Synthetic durable output drift."), { code: "OUTPUT_DRIFT" }); } });
    expect(verifier).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "UNRESOLVED", stopReason: "LOCAL_COMPLETION_VERIFICATION_FAILED",
      issues: [{ code: "LOCAL_COMPLETION_VERIFICATION_FAILED", lowerCause: { name: "Error", code: "OUTPUT_DRIFT" } }] });
    expect(JSON.stringify(result)).not.toContain("Synthetic durable output drift.");
  });
  it("a lower-runner failure is never turned into a normal success by a verified COMPLETED attempt", async () => {
    const f = await fixture(); await admit(f);
    const { outcome, result, verifier, runner } = await dispatch(f, { state: "COMPLETED" }, [], { verifier: async () => verification(), runnerFails: true });
    expect(outcome).toBeInstanceOf(BoundEpisodeActionError);
    expect(result).toMatchObject({ status: "STOPPED", stopReason: "ACTION_REJECTED" });
    expect(verifier).toHaveBeenCalledTimes(1); expect(runner).toHaveBeenCalledTimes(1);
  });
  it("a runner failure with the attempt still ADMITTED_ONLY is rejected and rethrown with the observation", async () => {
    const f = await fixture(); await admit(f);
    const before = await select(f); const plan = attemptPlan(before);
    const { context } = await checked(f, plan, before); const deps = tripwires();
    const runner = vi.fn(async () => { throw new Error("Synthetic lower-runner refusal."); });
    deps.dependencies.runSingleShotExecutionCli = runner as never;
    const error: unknown = await coordinateEpisodeAction({ episodeId: "EP02", action: plan.actions[0], controlledContext: context }, deps.typed)
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BoundEpisodeActionError);
    expect((error as BoundEpisodeActionError).result).toMatchObject({ status: "REJECTED", stopReason: "ACTION_REJECTED" });
    expect(runner).toHaveBeenCalledTimes(1);
  });
});

describe("M. end to end through the secured CLI, shared seam and existing attempt operator (synthetic provider)", () => {
  async function run(f: Fixture) {
    const network = tripwireNetwork();
    const plan = attemptPlan(await select(f));
    const createInteraction = vi.fn(async () => ({ id: INTERACTION_ID }));
    const executeVisualAttempt: NonNullable<RunSingleShotExecutionCliDependencies["executeVisualAttempt"]> = (credentials, request, context) =>
      executeProductionVisualAttemptSingleShot(credentials, request, context, { prepareGoogleInteraction: (() => ({ createInteraction })) as never });
    const cli = cliDependencies(f, { executeVisualAttempt }); const coordinator = tripwires();
    const runner = vi.fn((args: readonly string[], _dependencies: unknown, context: unknown) =>
      runSingleShotExecutionCli(args, cli.typed, context as never));
    coordinator.dependencies.runSingleShotExecutionCli = runner as never;
    const coordinateAction = vi.fn((input: Parameters<typeof coordinateEpisodeAction>[0]) => coordinateEpisodeAction(input as never, coordinator.typed));
    const buildPreflight = vi.fn(buildBoundEpisodePreflight);
    const outcome: unknown = await runEpisodeAutomation(plan, { coordinateAction: coordinateAction as unknown as typeof coordinateEpisodeAction,
      verifyRuntime: vi.fn(async () => undefined), buildPreflight }, createFreshEpisodeOperatorSession("GENERATION", true))
      .catch((cause: unknown) => cause);
    return { network, plan, createInteraction, cli, coordinator, runner, coordinateAction, buildPreflight, outcome };
  }

  it("creates exactly one synthetic provider job, persists only the attempt reservation/submission and stops SUBMITTED", async () => {
    const f = await fixture(); await admitExact(f);
    const { network, createInteraction, cli, coordinator, runner, coordinateAction, buildPreflight, outcome } = await run(f);
    expect(outcome).toMatchObject({ status: "STOPPED", stopReason: "SUBMITTED_RECOVERY_REQUIRED", dispatchAllowanceConsumed: 1,
      actionMayHaveEffects: true, afterPlan: { visualAttempt: { shotId: "S01", attemptNumber: 2, lifecycle: "SUBMITTED" } } });
    expect(coordinateAction).toHaveBeenCalledTimes(1); expect(runner).toHaveBeenCalledTimes(1);
    expect(cli.dependencies.executeVisualAttempt).toHaveBeenCalledTimes(1); expect(createInteraction).toHaveBeenCalledTimes(1);
    for (const name of ["inspectExecutionLifecycle", "createDependencies", "executeSingleShot"] as const) expect(cli.dependencies[name]).not.toHaveBeenCalled();
    expect(coordinator.dependencies.runProductionExecutionReconcileCli).not.toHaveBeenCalled();
    for (const [input] of buildPreflight.mock.calls) expect(input.visualAttemptSelection).toEqual(ATTEMPT_SELECTION);
    expect(await attemptState(f)).toBe("SUBMITTED");
    expect((await inspectExecutionLifecycle(f.mediaRoot, "EP02", "S01")).state).toBe("NOTHING");
    expect(network).not.toHaveBeenCalled();
    await expect(readFile(episodeExecutionGuardPath(f.mediaRoot, "EP02"))).rejects.toThrow();
  });
  it.each([
    ["prompt", { promptIdentitySha256: "b".repeat(64) }, "PROMPT_INVALID"],
    ["reference", { referenceIdentitySha256: "c".repeat(64) }, "REFERENCE_IMAGE_REJECTED"],
  ] as const)("keeps the 2H-B admitted %s identity gate active: no reservation, no create", async (_label, overrides, code) => {
    const f = await fixture(); await admitExact(f, overrides);
    const { createInteraction, runner, outcome } = await run(f);
    expect(outcome).toBeInstanceOf(BoundEpisodeActionError);
    const result = (outcome as BoundEpisodeActionError).result;
    expect(result).toMatchObject({ status: "REJECTED", stopReason: "ACTION_REJECTED", afterPlan: { visualAttempt: { lifecycle: "ADMITTED_ONLY" } } });
    expect(result.issues[0]?.lowerCause).toMatchObject({ name: "GoogleGenAiOperatorError", code });
    expect(runner).toHaveBeenCalledTimes(1); expect(createInteraction).not.toHaveBeenCalled();
    expect(await attemptState(f)).toBe("ADMITTED_ONLY");
    await expect(readFile(createVisualAttemptExecutionReservationPath(f.mediaRoot, "EP02", "S01", 2))).rejects.toThrow();
  });
  it("the control plane names no attempt operator, writer or provider authority", async () => {
    for (const path of ["src/execution/buildBoundEpisodePreflight.ts", "src/execution/episodeExecutionGuard.ts", "src/execution/runEpisodeAutomation.ts",
      "src/execution/coordinateEpisodeAction.ts", "src/execution/episodeAutomationPlan.schema.ts", "src/execution/boundEpisodeProduction.types.ts",
      "src/execution/cli/runSingleShotExecutionCli.ts"]) {
      const code = (await readFile(path, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, path).not.toMatch(/executeGoogleGenAiVisualAttemptSingleShot|createVisualAttemptExecution(?:Reservation|Submission|Completion)|createVisualAttemptGenerationRecord|createVisualAttemptAdmission|FromReservationIdentity|@google\/genai|process\.env/);
    }
    // The read-only attempt completion verifier is reached only through the dependency seam, behind the unchanged inventory gate.
    const coordinator = (await readFile("src/execution/coordinateEpisodeAction.ts", "utf8")).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(coordinator.match(/dependencies\.verifyVisualAttemptDurableCompletion\(/g)).toHaveLength(1);
    expect(coordinator.match(/verifyVisualAttemptDurableCompletion\(/g)).toHaveLength(1);
    expect(coordinator).toContain('if (!after?.inventory.complete && status === "ACTION_COMPLETED") { status = "UNRESOLVED"; stopReason = "POST_ACTION_STATE_UNRESOLVED"; }');
    // Only the coordinator emits the --attempt transport; only the shared CLI parser accepts it.
    for (const path of ["src/execution/buildBoundEpisodePreflight.ts", "src/execution/episodeExecutionGuard.ts", "src/execution/runEpisodeAutomation.ts",
      "src/execution/episodeAutomationPlan.schema.ts", "src/execution/boundEpisodeProduction.types.ts"]) {
      expect(await readFile(path, "utf8"), path).not.toMatch(/--attempt/);
    }
  });
});
