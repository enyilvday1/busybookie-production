import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, vi } from "vitest";
import { EpisodeManifestSchema } from "../src/schemas/episodeManifest.schema.js";
import { ProductionRulesSchema } from "../src/schemas/productionRules.schema.js";
import { buildBoundEpisodePreflight } from "../src/execution/buildBoundEpisodePreflight.js";
import { rawSha256 } from "../src/execution/episodeInputBinding.js";
import { runEpisodeAutomation } from "../src/execution/runEpisodeAutomation.js";
import { coordinateEpisodeAction, episodeCoordinatorProductionDependencies,
  type CoordinateBoundEpisodeActionInput, type CoordinateEpisodeActionInput, type CoordinateEpisodeActionResult } from "../src/execution/coordinateEpisodeAction.js";
import { consumeEpisodeGenerationAllowance, checkedEpisodeExecutionData, createFreshEpisodeOperatorSession,
  episodeExecutionGuardPath, type CheckedEpisodeExecutionContext } from "../src/execution/episodeExecutionGuard.js";
import { createExecutionReservation } from "../src/execution/createExecutionReservation.js";
import { createExecutionSubmission } from "../src/execution/createExecutionSubmission.js";
import { runSingleShotExecutionCli, type RunSingleShotExecutionCliDependencies } from "../src/execution/cli/runSingleShotExecutionCli.js";
import { createProductionSingleShotExecutionDependencies } from "../src/execution/createProductionSingleShotExecutionDependencies.js";
import { executeSingleShot } from "../src/execution/executeSingleShot.js";
import { inspectExecutionLifecycle } from "../src/execution/inspectExecutionLifecycle.js";
import { assertGen45WithinBudget } from "../src/runway/runwayBudget.js";
import { createGoogleGenAiSingleShotSecureProductionRecovery } from "../src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.js";
import { BoundEpisodeActionError, type RuntimeIdentity, type BoundEpisodeActionResult, type ControlledEpisodeAutomationPlan } from "../src/execution/boundEpisodeProduction.types.js";
import { describe, expect, it } from "vitest";
import { parseEpisodeAutomationPlan } from "../src/execution/episodeAutomationPlan.schema.js";
import { bindingDigest } from "../src/execution/episodeInputBinding.js";

function reviewedPlan() {
  const hash = "a".repeat(64);
  const target = { episodeId: "EP02", sceneId: "SC01", shotId: "S01", order: 1 };
  const scope = { kind: "EPISODE_SCOPE", shotIds: ["S01"] } as const;
  const file = { role: "MANIFEST", canonicalPath: "C:\\repo\\episodes\\EP02\\episode.json", exists: true, rawSha256: hash, bytes: 20 };
  const reference = { shotId: "S01", order: 1, assetId: "ref", mediaRootRelativePath: "references/ref.png",
    canonicalAbsolutePath: "D:\\media\\references\\ref.png", sha256: hash, bytes: 8,
    contentType: "image/png", shotApprovalStatus: "APPROVED", approvedAssetIds: ["ref"] };
  const inputBinding = { bindingVersion: "1.0", episodeId: "EP02", scope, orderedTargets: [target], fileBindings: [file],
    referenceBindings: [reference], runtimeIdentity: { reviewedRevision: "a".repeat(40), repositoryRoot: "C:\\repo",
      mediaRoot: "D:\\media", physicalMediaRoot: "D:\\media", executableInputs: [file], ffprobe: null } };
  const observations = [{ target, lifecycle: "NOTHING", reservationId: null, durableProvider: null,
    reservationSha256: null, submissionSha256: null, completionSha256: null, generationRecordSha256: null, providerExecutionIdentitySha256: null, outputIdentitySha256: null }];
  return { schemaVersion: "2.0", mode: "CONTROLLED_VISUAL", episodeId: "EP02", scope, inputBinding,
    inputBindingSha256: bindingDigest(inputBinding), observations, observationsSha256: bindingDigest(observations), evidenceAdoptions: [],
    maximumNewProviderCreates: 1, operatingCondition: { singleOperator: true, noConcurrentAuthoring: true, noUnguardedRunners: true },
    actions: [{ ...target, kind: "VISUAL_GENERATE", expectedLifecycle: "NOTHING", resolvedProvider: "RUNWAY",
      referenceBinding: reference, costAuthority: { unit: "RUNWAY_CREDITS", modeledValue: 60, maxModeledValue: 60, policySha256: hash },
      confirmPaidGeneration: true }] };
}
describe("controlled visual authority structure", () => {
  it("retains a defensively frozen exact single action and binding", () => {
    const input = reviewedPlan();
    const result = parseEpisodeAutomationPlan(input);
    expect(result.schemaVersion).toBe("2.0");
    input.actions[0]!.referenceBinding.approvedAssetIds.push("later");
    expect(Object.isFrozen(result.actions[0])).toBe(true);
    if (result.schemaVersion !== "2.0") throw new Error("wrong version");
    expect(result.inputBinding.referenceBindings[0]!.approvedAssetIds).toEqual(["ref"]);
  });
  it.each([
    (plan: ReturnType<typeof reviewedPlan>) => { plan.actions.push(plan.actions[0]!); },
    (plan: ReturnType<typeof reviewedPlan>) => { plan.maximumNewProviderCreates = 2; },
    (plan: ReturnType<typeof reviewedPlan>) => { plan.actions[0]!.confirmPaidGeneration = false; },
    (plan: ReturnType<typeof reviewedPlan>) => { plan.operatingCondition.noConcurrentAuthoring = false; },
    (plan: ReturnType<typeof reviewedPlan>) => { plan.actions[0]!.order = 2; },
    (plan: ReturnType<typeof reviewedPlan>) => { plan.inputBinding.fileBindings[0]!.bytes++; },
    (plan: ReturnType<typeof reviewedPlan>) => { plan.observations[0]!.lifecycle = "SUBMITTED"; },
    (plan: ReturnType<typeof reviewedPlan>) => { plan.actions[0]!.costAuthority.maxModeledValue = 59; },
  ])("rejects inconsistent or expanded authority before runtime", mutate => {
    const input = reviewedPlan(); mutate(input);
    expect(() => parseEpisodeAutomationPlan(input)).toThrow();
  });
  it("rejects unknown fields at every nested boundary and dialogue/mixed shapes", () => {
    for (const location of ["envelope", "action", "reference", "binding", "observation", "runtime"]) {
      const input = reviewedPlan();
      const subject = location === "envelope" ? input : location === "action" ? input.actions[0]!
        : location === "reference" ? input.actions[0]!.referenceBinding : location === "binding" ? input.inputBinding
        : location === "observation" ? input.observations[0]! : input.inputBinding.runtimeIdentity;
      Object.assign(subject, { force: true });
      expect(() => parseEpisodeAutomationPlan(input)).toThrow();
    }
    expect(() => parseEpisodeAutomationPlan({ ...reviewedPlan(), actions: [{ kind: "DIALOGUE_GENERATE" }] })).toThrow();
  });
});

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function runtimeFixture(provider: "RUNWAY" | "GOOGLE_GENAI" = "RUNWAY") {
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

async function authorize(f: Awaited<ReturnType<typeof runtimeFixture>>): Promise<ControlledEpisodeAutomationPlan> {
  const before = await buildBoundEpisodePreflight(f.input);
  const candidate = before.nextActionCandidate;
  if (!before.binding || !before.bindingSha256 || candidate?.kind !== "VISUAL_GENERATE") throw new Error("Fixture needs a generation frontier.");
  const plan = parseEpisodeAutomationPlan({ schemaVersion: "2.0", mode: "CONTROLLED_VISUAL", episodeId: "EP02",
    scope: before.scope, inputBinding: before.binding, inputBindingSha256: before.bindingSha256,
    observations: before.observations, observationsSha256: before.observationsSha256, evidenceAdoptions: [],
    maximumNewProviderCreates: 1, operatingCondition: { singleOperator: true, noConcurrentAuthoring: true, noUnguardedRunners: true },
    actions: [{ episodeId: candidate.episodeId, sceneId: candidate.sceneId, shotId: candidate.shotId, order: candidate.order,
      kind: "VISUAL_GENERATE", expectedLifecycle: "NOTHING", resolvedProvider: candidate.provider, referenceBinding: candidate.referenceBinding,
      costAuthority: { unit: candidate.cost.unit, modeledValue: candidate.cost.modeledValue, maxModeledValue: candidate.cost.perShotCap,
        policySha256: candidate.cost.policySha256 }, confirmPaidGeneration: true }] });
  if (plan.schemaVersion !== "2.0") throw new Error("Wrong fixture schema.");
  return plan;
}
function controlledHarness(f: Awaited<ReturnType<typeof runtimeFixture>>, options: Readonly<{
  throwAfterSubmission?: Error; reserveOnly?: boolean; throwPostRead?: boolean;
  runGeneration?: typeof runSingleShotExecutionCli; reenter?: boolean; corruptManifestAfterSubmission?: boolean; alterGuard?: boolean;
}> = {}) {
  let actualCreates = 0; let dispatched = 0; let recoveryCalls = 0; let settled = false;
  const runner = vi.fn(async (_args: readonly string[] | undefined, _deps: unknown, context?: CheckedEpisodeExecutionContext) => {
    if (!context) throw new Error("Missing internal binding in synthetic runner.");
    dispatched++;
    const data = checkedEpisodeExecutionData(context);
    consumeEpisodeGenerationAllowance(data.invocation);
    const action = data.plan.actions[0];
    if (action.kind !== "VISUAL_GENERATE") throw new Error("Wrong fixture family.");
    if (options.reenter) {
      const second = await coordinateEpisodeAction({ episodeId: action.episodeId, action, controlledContext: context }, runners);
      expect(second).toMatchObject({ status: "REJECTED", stopReason: "MAX_CREATE_COUNT_REACHED" });
    }
    const reserved = await createExecutionReservation(f.mediaRoot, { episodeId: "EP02", shotId: action.shotId, provider: "RUNWAY" });
    if (!options.reserveOnly) {
      actualCreates++;
      await createExecutionSubmission(f.mediaRoot, { reservationId: reserved.record.reservationId, episodeId: "EP02", shotId: action.shotId,
        provider: "RUNWAY", providerExecutionId: "synthetic-private-provider-identity", providerEstimatedCredits: 60,
        recoveryMetadata: { request: { durationSeconds: 5, ratio: "1280:720", outputFormat: "mp4", promptText: "Synthetic reviewed prompt.",
          sourceImagePath: action.referenceBinding.canonicalAbsolutePath, assetStrategy: "DATA_URI" }, locallyExpectedCredits: 60 } });
    }
    settled = true;
    if (options.corruptManifestAfterSubmission) await writeFile(f.manifest, "{invalid-after-paid-dispatch");
    if (options.alterGuard) await writeFile(episodeExecutionGuardPath(f.mediaRoot, "EP02"), "foreign-owner-evidence");
    if (options.throwAfterSubmission) throw options.throwAfterSubmission;
  });
  const runners = { ...episodeCoordinatorProductionDependencies, runSingleShotExecutionCli: options.runGeneration ?? runner,
    runProductionExecutionReconcileCli: vi.fn(async () => { recoveryCalls++; throw new Error("Unrequested recovery tripwire."); }) };
  function coordinate(input: CoordinateBoundEpisodeActionInput): Promise<BoundEpisodeActionResult>;
  function coordinate(input: CoordinateEpisodeActionInput): Promise<CoordinateEpisodeActionResult>;
  function coordinate(input: CoordinateEpisodeActionInput | CoordinateBoundEpisodeActionInput) {
    return "controlledContext" in input ? coordinateEpisodeAction(input, runners) : coordinateEpisodeAction(input, runners);
  }
  return { runner, counts: () => ({ actualCreates, dispatched, recoveryCalls }), dependencies: {
    coordinateAction: coordinate, verifyRuntime: vi.fn(async () => undefined),
    buildPreflight: async (...args: Parameters<typeof buildBoundEpisodePreflight>) => {
      if (settled && options.throwPostRead) throw new Error("Synthetic post-state read failure.");
      return buildBoundEpisodePreflight(...args);
    },
  } };
}
describe("controlled C7 -> C6b single-action execution", () => {
  it("a structurally valid but mismatched native cost ceiling is rejected before dispatch", async () => {
    const f = await runtimeFixture(); const original = await authorize(f);
    const action = original.actions[0]; if (action.kind !== "VISUAL_GENERATE") throw new Error("Wrong family.");
    const reviewed = { ...original, actions: [{ ...action, costAuthority: { ...action.costAuthority, modeledValue: action.costAuthority.modeledValue - 1 } }] };
    const harness = controlledHarness(f);
    const result = await runEpisodeAutomation(reviewed, harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true));
    expect(result).toMatchObject({ status: "REJECTED", stopReason: "COST_ADMISSION_BLOCKED", dispatchAllowanceConsumed: 0 });
    expect(harness.runner).not.toHaveBeenCalled();
  });
  it("retains selected durable evidence when post-action manifest parsing fails", async () => {
    const f = await runtimeFixture(); const harness = controlledHarness(f, { corruptManifestAfterSubmission: true });
    const result = await runEpisodeAutomation(await authorize(f), harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true));
    expect(result).toMatchObject({ status: "UNRESOLVED", stopReason: "INPUT_BINDING_DRIFT", actionMayHaveEffects: true,
      selectedPostObservation: { lifecycle: "SUBMITTED", durableProvider: "RUNWAY" } });
    expect(JSON.stringify(result)).not.toContain("synthetic-private-provider-identity");
    expect(harness.counts().actualCreates).toBe(1);
  });
  it("owner release failure retains the action observation and foreign guard evidence", async () => {
    const f = await runtimeFixture(); const harness = controlledHarness(f, { alterGuard: true });
    const error = await runEpisodeAutomation(await authorize(f), harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true)).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BoundEpisodeActionError);
    if (!(error instanceof BoundEpisodeActionError)) throw new Error("Wrong error family.");
    expect(error.result).toMatchObject({ status: "UNRESOLVED", stopReason: "EPISODE_OWNERSHIP_CONFLICT", dispatchAllowanceConsumed: 1,
      selectedPostObservation: { lifecycle: "SUBMITTED" } });
    expect(await readFile(episodeExecutionGuardPath(f.mediaRoot, "EP02"), "utf8")).toBe("foreign-owner-evidence");
    expect(harness.counts().actualCreates).toBe(1);
  });
  it("a reentrant C6b call cannot dispatch or create a second job", async () => {
    const f = await runtimeFixture(); const harness = controlledHarness(f, { reenter: true });
    await runEpisodeAutomation(await authorize(f), harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true));
    expect(harness.counts()).toEqual({ actualCreates: 1, dispatched: 1, recoveryCalls: 0 });
  });
  it.each(["MANIFEST", "PRODUCTION_RULES", "ROUTING", "CHARACTERS", "RUNWAY_POLICY", "VEO_POLICY", "GOOGLE_POLICY", "GOOGLE_ACTIVATION", "REFERENCE_REGISTRY", "REFERENCE_BYTES", "AUTHORIZATION"])(
    "%s raw-byte drift rejects the reviewed invocation before any runner", async role => {
      const f = await runtimeFixture();
      const later = f.episode.scenes[0]!.shots[0]!;
      if (role === "VEO_POLICY") { later.generation.provider = "VEO"; later.generation.nativeAudio = true; later.durationSeconds = 4; }
      if (role === "GOOGLE_POLICY" || role === "GOOGLE_ACTIVATION") later.generation.provider = "GOOGLE_GENAI";
      await f.save();
      const plan = await authorize(f); const harness = controlledHarness(f);
      const binding = plan.inputBinding.fileBindings.find(file => file.role === role);
      if (role === "REFERENCE_BYTES") {
        await writeFile(join(f.mediaRoot, "references/ref.png"), Buffer.from("changed-reference"));
      } else if (role === "AUTHORIZATION") {
        const absent = plan.inputBinding.fileBindings.find(file => file.role.startsWith("AUTHORIZATION:"));
        if (!absent) throw new Error("Missing optional authorization fixture.");
        await mkdir(join(f.mediaRoot, "generated-video/EP02", absent.role.split(":")[1]!), { recursive: true });
        await writeFile(absent.canonicalPath, "{}");
      } else {
        if (!binding) throw new Error("Missing intended policy binding.");
        await writeFile(binding.canonicalPath, Buffer.concat([await readFile(binding.canonicalPath), Buffer.from("\n")]));
      }
      const result = await runEpisodeAutomation(plan, harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true));
      expect(result).toMatchObject({ status: "REJECTED", stopReason: "INPUT_BINDING_DRIFT", dispatchAllowanceConsumed: 0 });
      expect(harness.runner).not.toHaveBeenCalled();
    },
  );
  it("stops on a durable submission, releases ownership, and emits no raw provider identity", async () => {
    const f = await runtimeFixture(); const plan = await authorize(f); const harness = controlledHarness(f);
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real network tripwire."));
    const result = await runEpisodeAutomation(plan, harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true));
    if ("results" in result) throw new Error("Wrong result family.");
    expect(result).toMatchObject({ status: "STOPPED", stopReason: "SUBMITTED_RECOVERY_REQUIRED", dispatchAllowanceConsumed: 1,
      observedNewCreateCount: "UNKNOWN", recoveryDispatchCount: 0, actionMayHaveEffects: true, visualCompletion: "INCOMPLETE" });
    expect(result.afterPlan?.shots[0]!.disposition).toBe("SUBMITTED");
    expect(harness.counts()).toEqual({ actualCreates: 1, dispatched: 1, recoveryCalls: 0 });
    expect(JSON.stringify(result)).not.toContain("synthetic-private-provider-identity");
    await expect(readFile(episodeExecutionGuardPath(f.mediaRoot, "EP02"))).rejects.toThrow(); expect(network).not.toHaveBeenCalled();
  });
  it("retains a thrown runner cause and fresh SUBMITTED evidence without any retry", async () => {
    const f = await runtimeFixture(); const plan = await authorize(f); const cause = new Error("Synthetic accepted-create timeout.");
    const harness = controlledHarness(f, { throwAfterSubmission: cause });
    const error = await runEpisodeAutomation(plan, harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true)).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(BoundEpisodeActionError);
    if (!(error instanceof BoundEpisodeActionError)) throw new Error("Wrong error family.");
    expect(error.cause).toBe(cause); expect(error.result.stopReason).toBe("SUBMITTED_RECOVERY_REQUIRED");
    expect(error.result.afterPlan?.shots[0]!.lifecycle.lifecycle).toBe("SUBMITTED"); expect(harness.counts().actualCreates).toBe(1);
  });
  it("retains RESERVED_ONLY ambiguity without refund, recovery or another create", async () => {
    const f = await runtimeFixture(); const harness = controlledHarness(f, { reserveOnly: true });
    const result = await runEpisodeAutomation(await authorize(f), harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true));
    expect(result).toMatchObject({ status: "STOPPED", stopReason: "RESERVED_ONLY_MANUAL_ADJUDICATION", dispatchAllowanceConsumed: 1 });
    expect(harness.counts()).toEqual({ actualCreates: 0, dispatched: 1, recoveryCalls: 0 });
  });
  it("post-state failure returns no success and preserves the consumed allowance", async () => {
    const f = await runtimeFixture(); const harness = controlledHarness(f, { throwPostRead: true });
    const error = await runEpisodeAutomation(await authorize(f), harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true)).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(BoundEpisodeActionError);
    if (!(error instanceof BoundEpisodeActionError)) throw new Error("Wrong error family.");
    expect(error.result).toMatchObject({ status: "UNRESOLVED", stopReason: "POST_ACTION_STATE_UNRESOLVED", dispatchAllowanceConsumed: 1 });
    expect(harness.counts().actualCreates).toBe(1);
  });
  it("a plan file supplies no fresh operator session and a session cannot be reused", async () => {
    const f = await runtimeFixture(); const plan = await authorize(f); const harness = controlledHarness(f);
    await expect(runEpisodeAutomation(plan, harness.dependencies)).rejects.toMatchObject({ code: "OPERATING_CONDITION_UNESTABLISHED" });
    const session = createFreshEpisodeOperatorSession("GENERATION", true);
    await runEpisodeAutomation(plan, harness.dependencies, session);
    await expect(runEpisodeAutomation(plan, harness.dependencies, session)).rejects.toMatchObject({ code: "OPERATING_CONDITION_UNESTABLISHED" });
    expect(harness.runner).toHaveBeenCalledTimes(1);
  });
  it("stale input binding rejects without silently advancing the frontier or dispatching", async () => {
    const f = await runtimeFixture(); const plan = await authorize(f); const harness = controlledHarness(f);
    f.episode.title = "Reviewed authoring changed."; await f.save();
    const result = await runEpisodeAutomation(plan, harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true));
    expect(result).toMatchObject({ status: "REJECTED", stopReason: "INPUT_BINDING_DRIFT", dispatchAllowanceConsumed: 0 });
    expect(harness.runner).not.toHaveBeenCalled();
  });
});

function securedSyntheticRunner(f: Awaited<ReturnType<typeof runtimeFixture>>, mutateNestedPolicy: boolean | "AFTER_POLICY_READ" = false) {
  let creates = 0; let boundPrice: number | null = null;
  const timeout = new Error("Synthetic accepted-job timeout.");
  const unusedLoader = async () => { throw new Error("Unchecked canonical loader tripwire."); };
  const cliDependencies: RunSingleShotExecutionCliDependencies = {
    loadEnvironment: () => ({ BUSYBOOKIE_MEDIA_ROOT: f.mediaRoot, RUNWAYML_API_SECRET: "synthetic-credential" }),
    loadEpisodeManifest: unusedLoader, loadCharacterBible: unusedLoader, loadProductionRules: unusedLoader, loadProviderRoutingPolicy: unusedLoader,
    validateEpisodeProduction: () => { throw new Error("Controlled admission must check the exact selected shot."); },
    validateMediaRoot: async () => f.mediaRoot, inspectExecutionLifecycle, executeSingleShot,
    createDependencies: (credentials, _composition, context) => createProductionSingleShotExecutionDependencies(credentials, {
      createReservation: createExecutionReservation, createSubmission: createExecutionSubmission,
      createCompletion: async () => { throw new Error("Unrequested completion tripwire."); },
      prepareVeoExecutor: async () => { throw new Error("Cross-provider fallback tripwire."); },
      prepareRunwayExecutor: async (_credentials, preparation) => {
        if (!preparation) throw new Error("Missing bound preparation dependencies.");
        if (mutateNestedPolicy === true) await writeFile(join(f.repositoryRoot, "config/runway-policy.json"), "{}");
        const policy = await preparation.loadPolicy(); boundPrice = policy.gen45.creditsPerSecond;
        if (mutateNestedPolicy === "AFTER_POLICY_READ") await writeFile(f.manifest, Buffer.concat([await readFile(f.manifest), Buffer.from("\n")]));
        return async input => {
          assertGen45WithinBudget(input.shot.durationSeconds, policy);
          creates++;
          await input.onSubmissionAccepted({ provider: "RUNWAY", providerExecutionId: "synthetic-nested-provider-identity", providerEstimatedCredits: 60,
            recoveryMetadata: { request: { durationSeconds: 5, ratio: "1280:720", outputFormat: "mp4", promptText: "Synthetic checked-buffer request.",
              sourceImagePath: input.sourceImagePath, assetStrategy: "DATA_URI" }, locallyExpectedCredits: 60 } });
          throw timeout;
        };
      },
    }, context),
  };
  return { runner: (args: readonly string[] | undefined, _dependencies: unknown, context?: CheckedEpisodeExecutionContext) =>
    runSingleShotExecutionCli(args, cliDependencies, context), counts: () => ({ creates, boundPrice }), timeout };
}
describe("expected binding inside the same secured generation CLI", () => {
  it("the final pre-reservation check catches manifest drift after nested policy preparation", async () => {
    const f = await runtimeFixture(); const secured = securedSyntheticRunner(f, "AFTER_POLICY_READ");
    const harness = controlledHarness(f, { runGeneration: secured.runner });
    const error = await runEpisodeAutomation(await authorize(f), harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true)).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BoundEpisodeActionError);
    if (!(error instanceof BoundEpisodeActionError)) throw new Error("Wrong error family.");
    expect(error.result).toMatchObject({ status: "UNRESOLVED", stopReason: "INPUT_BINDING_DRIFT", dispatchAllowanceConsumed: 1 });
    expect(secured.counts()).toEqual({ creates: 0, boundPrice: 12 });
    expect(await inspectExecutionLifecycle(f.mediaRoot, "EP02", "S11")).toEqual({ state: "NOTHING" });
  });
  it.each(["SUBMITTED", "CREATE_TIMEOUT", "SUBMISSION_WRITE_FAILURE"])("synthetic Google %s stops C7 with one create, no refund, recovery or fallback", async outcome => {
    const f = await runtimeFixture("GOOGLE_GENAI");
    const path = join(f.repositoryRoot, "config/google-genai-activation-policy.json");
    const policy = JSON.parse(await readFile(path, "utf8")); policy.admission.newSubmissionsEnabled = true;
    await writeFile(path, JSON.stringify(policy));
    let creates = 0;
    const unchecked = async () => { throw new Error("Unchecked loader tripwire."); };
    const cli: RunSingleShotExecutionCliDependencies = {
      loadEnvironment: () => ({ BUSYBOOKIE_MEDIA_ROOT: f.mediaRoot, GEMINI_API_KEY: `AQ.${"a".repeat(48)}` }),
      loadEpisodeManifest: unchecked, loadCharacterBible: unchecked, loadProductionRules: unchecked, loadProviderRoutingPolicy: unchecked,
      validateEpisodeProduction: () => undefined, validateMediaRoot: async () => f.mediaRoot, inspectExecutionLifecycle, executeSingleShot,
      createDependencies: (credentials, _composition, context) => createProductionSingleShotExecutionDependencies(credentials, {
        createReservation: createExecutionReservation, createSubmission: async (...args) => {
          if (outcome === "SUBMISSION_WRITE_FAILURE") throw new Error("Synthetic durable submission failure after acceptance.");
          return createExecutionSubmission(...args);
        },
        createCompletion: unchecked, prepareRunwayExecutor: unchecked, prepareVeoExecutor: unchecked,
        prepareGoogleInteraction: key => ({ submittedRecovery: createGoogleGenAiSingleShotSecureProductionRecovery(key),
          createInteraction: async () => { creates++; if (outcome === "CREATE_TIMEOUT") throw new Error("Synthetic accepted-create timeout.");
            return { id: "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM" }; } }),
      }, context),
    };
    const harness = controlledHarness(f, { runGeneration: (args, _dependencies, context) => runSingleShotExecutionCli(args, cli, context) });
    const response = await runEpisodeAutomation(await authorize(f), harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true))
      .catch((cause: unknown) => cause);
    if (outcome !== "SUBMITTED") expect(response).toBeInstanceOf(BoundEpisodeActionError);
    const result: unknown = response instanceof BoundEpisodeActionError ? response.result : response;
    expect(result).toMatchObject({ status: "STOPPED", stopReason: outcome === "SUBMITTED" ? "SUBMITTED_RECOVERY_REQUIRED" : "RESERVED_ONLY_MANUAL_ADJUDICATION", dispatchAllowanceConsumed: 1,
      recoveryDispatchCount: 0, selectedPostObservation: { lifecycle: outcome === "SUBMITTED" ? "SUBMITTED" : "RESERVED_ONLY", durableProvider: "GOOGLE_GENAI" } });
    expect(creates).toBe(1); expect(harness.counts().recoveryCalls).toBe(0);
  }, 30000);
  it("uses checked canonical buffers and a checked nested policy through the existing executor", async () => {
    const f = await runtimeFixture(); const secured = securedSyntheticRunner(f);
    const harness = controlledHarness(f, { runGeneration: secured.runner });
    const error = await runEpisodeAutomation(await authorize(f), harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true)).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(BoundEpisodeActionError);
    if (!(error instanceof BoundEpisodeActionError)) throw new Error("Wrong error family.");
    expect(error.result).toMatchObject({ status: "STOPPED", stopReason: "SUBMITTED_RECOVERY_REQUIRED", dispatchAllowanceConsumed: 1 });
    expect(error.result.afterPlan?.shots[0]!.lifecycle.lifecycle).toBe("SUBMITTED");
    expect(secured.counts()).toEqual({ creates: 1, boundPrice: 12 });
    expect(error.cause).toMatchObject({ cause: secured.timeout });
    expect(JSON.stringify(error.result)).not.toMatch(/synthetic-credential|synthetic-nested-provider-identity/);
  });
  it("nested policy drift cannot reach a provider create or refund its consumed dispatch allowance", async () => {
    const f = await runtimeFixture(); const secured = securedSyntheticRunner(f, true);
    const harness = controlledHarness(f, { runGeneration: secured.runner });
    const error = await runEpisodeAutomation(await authorize(f), harness.dependencies, createFreshEpisodeOperatorSession("GENERATION", true)).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(BoundEpisodeActionError);
    if (!(error instanceof BoundEpisodeActionError)) throw new Error("Wrong error family.");
    expect(error.result).toMatchObject({ status: "UNRESOLVED", stopReason: "INPUT_BINDING_DRIFT", dispatchAllowanceConsumed: 1 });
    expect(secured.counts()).toEqual({ creates: 0, boundPrice: null });
  });
});
