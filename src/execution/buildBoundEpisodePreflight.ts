import { lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { EpisodeManifestSchema, type EpisodeManifest, type Shot } from "../schemas/episodeManifest.schema.js";
import { CharacterBibleSchema } from "../schemas/character.schema.js";
import { ProductionRulesSchema } from "../schemas/productionRules.schema.js";
import { ProviderRoutingPolicySchema } from "../schemas/providerRoutingPolicy.schema.js";
import { RunwayPolicySchema } from "../schemas/runwayPolicy.schema.js";
import { VeoPolicySchema } from "../schemas/veoPolicy.schema.js";
import { GoogleGenAiPolicySchema } from "../schemas/googleGenAiPolicy.schema.js";
import { GoogleGenAiActivationPolicySchema } from "../schemas/googleGenAiActivationPolicy.schema.js";
import { resolveAndValidateMediaRootPath } from "../validation/validateMediaRoot.js";
import { resolveDurableShotDialogueCompositionState } from "../dialogue/resolveDurableShotDialogueCompositionState.js";
import { resolveDurableEpisodeProductionState } from "./resolveDurableEpisodeProductionState.js";
import { resolveDurableShotVisualGenerationState } from "./resolveDurableShotVisualGenerationState.js";
import { resolveDurableShotExecutionReadiness } from "./resolveDurableShotExecutionReadiness.js";
import { inspectExecutionLifecycle } from "./inspectExecutionLifecycle.js";
import { verifyLocalCompletedVisualExecution } from "./verifyLocalCompletedVisualExecution.js";
import { VisualReferenceAssetRegistrySchema } from "./visualReferenceAsset.schema.js";
import { verifyApprovedVisualReferenceAsset } from "./verifyApprovedVisualReferenceAsset.js";
import { createDialogueVisualAuthorizationPath } from "./dialogueVisualAuthorizationPath.js";
import { DialogueVisualAuthorizationSchema } from "./dialogueVisualAuthorization.schema.js";
import { createExecutionReservationPath } from "./executionReservationPath.js";
import { createExecutionSubmissionPath } from "./executionSubmissionPath.js";
import { createExecutionCompletionPath } from "./executionCompletionPath.js";
import { ExecutionReservationEpisodeIdSchema } from "./executionReservation.schema.js";
import { evaluateGoogleGenAiLocalAdmission, GoogleGenAiOperatorError } from "./evaluateGoogleGenAiLocalAdmission.js";
import { buildGoogleGenAiSingleShotPrompt } from "./providers/buildGoogleGenAiSingleShotPrompt.js";
import { computeGoogleGenAiExpectedCost } from "../googleGenai/googleGenAiExpectedCost.js";
import { readGoogleGenAiReferenceImage } from "../googleGenai/assets/readGoogleGenAiReferenceImage.js";
import { classifyRunwayImageAsset } from "../runway/assets/runwayImageAsset.js";
import { buildRunwayGen45Prompt } from "../runway/cli/buildRunwayGen45Prompt.js";
import { buildGen45Request } from "../runway/gen45/buildGen45Request.js";
import { assertGen45WithinBudget } from "../runway/runwayBudget.js";
import { assertVeoWithinBudget } from "../veo/veoBudget.js";
import { buildVeoPrompt } from "../veo/cli/buildVeoPrompt.js";
import { buildVeoGenerateRequest } from "../veo/generation/buildVeoGenerateRequest.js";
import { readBoundFile, parseBoundJson, requireLinkSafeContainedPath } from "./episodeInputBinding.js";
import { bindingDigest, freezeBoundCopy, requireSameBinding, BoundEpisodeError,
  type ActionCandidate, type BoundEpisodePreflight, type BucketCounts, type EvidenceAdoption, type FileBinding,
  type InputBindingBundle, type Issue, type IssueCode, type KnownCost, type ObservationBinding,
  type ReferenceBinding, type RuntimeIdentity, type Scope, type ShotPreflight, type Target, type VisualProvider,
} from "./boundEpisodeProduction.types.js";

// Only local readers, pure authorities and local completion verification.
// No environment parser, credential, client, transaction, recovery or writer.
export type BoundEpisodeReadDependencies = Readonly<{
  readFile: typeof readBoundFile; inspectLifecycle: typeof inspectExecutionLifecycle;
  resolveEpisode: typeof resolveDurableEpisodeProductionState;
  resolveVisual: typeof resolveDurableShotVisualGenerationState;
  resolveDialogue: typeof resolveDurableShotDialogueCompositionState;
  verifyComplete: typeof verifyLocalCompletedVisualExecution;
  verifyReference: typeof verifyApprovedVisualReferenceAsset;
}>;
const localReaders: BoundEpisodeReadDependencies = Object.freeze({ readFile: readBoundFile,
  inspectLifecycle: inspectExecutionLifecycle, resolveEpisode: resolveDurableEpisodeProductionState,
  resolveVisual: resolveDurableShotVisualGenerationState, resolveDialogue: resolveDurableShotDialogueCompositionState,
  verifyComplete: verifyLocalCompletedVisualExecution, verifyReference: verifyApprovedVisualReferenceAsset });
export type BoundEpisodePreflightInput = Readonly<{
  episodeId: string; scope?: Scope; mediaRoot: string; ffprobeExecutable?: string;
  runtimeIdentity: RuntimeIdentity; expectedBinding?: InputBindingBundle;
  evidenceAdoptions?: readonly EvidenceAdoption[];
}>;
export function episodeIssue(code: IssueCode, target: Target | null, phase: Issue["phase"], cause?: unknown,
  actionMayHaveEffects = false): Issue {
  const field = (key: string): string | null => {
    const value: unknown = cause instanceof Error && key in cause ? Reflect.get(cause, key) : null;
    return typeof value === "string" && /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : null;
  };
  // Error prose and SDK payloads never enter a public plan.
  return freezeBoundCopy({ target, phase, code, detail: code, actionMayHaveEffects,
    lowerCause: cause instanceof Error ? { name: ["Error", "TypeError", "RangeError", "ZodError", "BoundEpisodeError", "GoogleGenAiOperatorError",
      "GoogleGenAiExpectedCostRejectedError"].includes(cause.name) ? cause.name : "Error", code: field("code"), stage: field("stage"), stateChange: field("stateChange") } : null });
}
const emptyCounts = (): Record<keyof BucketCounts, number> => ({ ERROR: 0, BLOCKED: 0, COMPLETED: 0, SUBMITTED: 0, NOT_READY: 0, READY: 0 });
function paidProvider(value: string | null): VisualProvider | null {
  return value === "RUNWAY" || value === "VEO" || value === "GOOGLE_GENAI" ? value : null;
}
function checked(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new BoundEpisodeError("COST_ADMISSION_BLOCKED");
  return value;
}

// A failed manifest read makes the episode inventory unknown. After a paid
// dispatch, retain separately the selected target's available durable evidence
// using the same canonical inspector; this never invents an episode inventory
// or grants continuation authority.
export async function readSelectedVisualPostObservation(mediaRoot: string, target: Target): Promise<ObservationBinding> {
  const records = await Promise.all([
    ["RESERVATION", createExecutionReservationPath(mediaRoot, target.episodeId, target.shotId)],
    ["SUBMISSION", createExecutionSubmissionPath(mediaRoot, target.episodeId, target.shotId)],
    ["COMPLETION", createExecutionCompletionPath(mediaRoot, target.episodeId, target.shotId)],
  ].map(async ([role, path]) => readBoundFile({ root: mediaRoot, canonicalPath: path!, role: role!, maxBytes: 1048576, optional: true })));
  const lifecycle = await inspectExecutionLifecycle(mediaRoot, target.episodeId, target.shotId);
  for (const record of records) await readBoundFile({ root: mediaRoot, canonicalPath: record.binding.canonicalPath,
    role: record.binding.role, maxBytes: 1048576, optional: true, expected: record.binding });
  return freezeBoundCopy({ target, lifecycle: lifecycle.state,
    reservationId: lifecycle.state === "NOTHING" ? null : lifecycle.reservation.reservationId,
    durableProvider: lifecycle.state === "NOTHING" ? null : paidProvider(lifecycle.reservation.provider),
    reservationSha256: records[0]!.binding.rawSha256, submissionSha256: records[1]!.binding.rawSha256,
    completionSha256: records[2]!.binding.rawSha256, generationRecordSha256: null, outputIdentitySha256: null,
    providerExecutionIdentitySha256: lifecycle.state === "SUBMITTED" || lifecycle.state === "COMPLETED"
      ? bindingDigest([lifecycle.submission.provider, lifecycle.submission.providerExecutionId]) : null });
}

export async function buildBoundEpisodePreflight(input: BoundEpisodePreflightInput,
  dependencies: BoundEpisodeReadDependencies = localReaders): Promise<BoundEpisodePreflight> {
  const episodeId = ExecutionReservationEpisodeIdSchema.parse(input.episodeId);
  const root = input.runtimeIdentity.repositoryRoot;
  if (resolve(root) !== root || input.runtimeIdentity.mediaRoot !== input.mediaRoot) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
  if (input.ffprobeExecutable && input.ffprobeExecutable !== input.runtimeIdentity.ffprobe?.canonicalPath) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
  const ffprobeExecutable = input.runtimeIdentity.ffprobe?.canonicalPath ?? "";
  const files: FileBinding[] = [];
  const fileReads: { root: string; binding: FileBinding; maxBytes: number }[] = [];
  const fatal: Issue[] = [];
  const supportedRecoveryTargets = new Set<string>();
  const completedInspections = new Map<string, Extract<Awaited<ReturnType<typeof inspectExecutionLifecycle>>, { state: "COMPLETED" }>>();
  async function load<T>(path: string, role: string, parse: (value: unknown) => T, optional = false,
    fileRoot = root): Promise<T | null> {
    try {
    const expected = input.expectedBinding?.fileBindings.find(file => file.role === role && file.canonicalPath === path);
    const loaded = await dependencies.readFile({ root: fileRoot, canonicalPath: path, role, maxBytes: 1048576, optional,
      ...(expected ? { expected } : {}) });
    files.push(loaded.binding); fileReads.push({ root: fileRoot, binding: loaded.binding, maxBytes: 1048576 });
    return loaded.bytes === null ? null : parseBoundJson(loaded.bytes, parse);
    } catch (cause) { throw new BoundEpisodeError("INPUT_BINDING_DRIFT", { cause }); }
  }
  function required<T>(value: T | null): T { if (value === null) throw new BoundEpisodeError("INPUT_BINDING_DRIFT"); return value; }
  const manifestPath = resolve(root, "episodes", episodeId, "episode.json");
  let episode: EpisodeManifest;
  try {
    episode = required(await load(manifestPath, "MANIFEST", value => EpisodeManifestSchema.parse(value)));
    if (episode.episodeId !== episodeId) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
  } catch (error) {
    return finish([], null, [], [episodeIssue("INPUT_BINDING_DRIFT", null, "LOAD", error)], null,
      input.scope ?? { kind: "EPISODE_SCOPE", shotIds: [] });
  }
  const entries = episode.scenes.flatMap(scene => scene.shots.map(shot => ({ shot,
    target: { episodeId, sceneId: scene.id, shotId: shot.id, order: shot.order } }))).sort((a, b) => a.target.order - b.target.order);
  const targets = entries.map(row => row.target);
  const allIds = targets.map(row => row.shotId);
  let scope: Scope = input.scope ?? { kind: "EPISODE_SCOPE", shotIds: allIds };
  if (!scope.shotIds.length || new Set(scope.shotIds).size !== scope.shotIds.length) throw new TypeError("Invalid selected scope.");
  requireSameBinding(scope.shotIds, allIds.filter(id => scope.shotIds.includes(id)));
  if (scope.kind === "EPISODE_SCOPE") requireSameBinding(scope.shotIds, allIds);
  if (scope.shotIds.length === allIds.length) scope = { kind: "EPISODE_SCOPE", shotIds: allIds };
  const rows: ShotPreflight[] = [];
  const observations: ObservationBinding[] = [];
  let bible; let rules; let policy;
  try {
    bible = required(await load(resolve(root, "config/characters.json"), "CHARACTERS", value => CharacterBibleSchema.parse(value)));
    rules = required(await load(resolve(root, "config/production-rules.json"), "PRODUCTION_RULES", value => ProductionRulesSchema.parse(value)));
    policy = required(await load(resolve(root, "config/provider-routing-policy.json"), "ROUTING", value => ProviderRoutingPolicySchema.parse(value)));
    requireSameBinding(resolveAndValidateMediaRootPath({ BUSYBOOKIE_MEDIA_ROOT: input.mediaRoot }, rules), input.mediaRoot);
    await requireLinkSafeContainedPath(input.mediaRoot, input.mediaRoot, true);
    // Every executable input is independently re-read, including package lock.
    for (const executable of input.runtimeIdentity.executableInputs) {
      await dependencies.readFile({ root, canonicalPath: executable.canonicalPath, role: executable.role,
        maxBytes: 32 * 1024 * 1024, expected: executable });
    }
    if (input.runtimeIdentity.ffprobe) {
      const probe = input.runtimeIdentity.ffprobe;
      await dependencies.readFile({ root: dirname(probe.canonicalPath), canonicalPath: probe.canonicalPath, role: probe.role,
        maxBytes: 256 * 1024 * 1024, expected: probe });
      fileReads.push({ root: dirname(probe.canonicalPath), binding: probe, maxBytes: 256 * 1024 * 1024 });
    }
  } catch (error) {
    return finish([], targets, [], [episodeIssue("INPUT_BINDING_DRIFT", null, "LOAD", error)], null, scope);
  }
  const context = { episode, bible, rules, policy, mediaRoot: input.mediaRoot };
  const auth = new Map<string, Awaited<ReturnType<typeof loadAuthorization>>>();
  async function loadAuthorization(shotId: string) {
    return load(createDialogueVisualAuthorizationPath(input.mediaRoot, episodeId, shotId), `AUTHORIZATION:${shotId}`,
      value => DialogueVisualAuthorizationSchema.parse(value), true, input.mediaRoot);
  }
  for (const { target } of entries) {
    try { auth.set(target.shotId, await loadAuthorization(target.shotId)); }
    catch (error) { fatal.push(episodeIssue("INPUT_BINDING_DRIFT", target, "LOAD", error)); }
  }
  const readAuthorization = async (_root: string, _episode: string, shotId: string) => {
    if (!auth.has(shotId)) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
    return auth.get(shotId) ?? null;
  };
  let registry: ReturnType<typeof VisualReferenceAssetRegistrySchema.parse> | null = null;
  let registryError: unknown;
  try { registry = required(await load(resolve(input.mediaRoot, "references/visual-reference-asset-registry.json"), "REFERENCE_REGISTRY",
    value => VisualReferenceAssetRegistrySchema.parse(value), false, input.mediaRoot)); }
  catch (error) { registryError = error; }
  const readRegistry = async () => { if (!registry) throw registryError; return registry; };
  const visualDeps = { inspectLifecycle: dependencies.inspectLifecycle, readDialogueVisualAuthorization: readAuthorization,
    readRegistry, verifyReference: dependencies.verifyReference };
  let c4: Awaited<ReturnType<typeof resolveDurableEpisodeProductionState>> | null = null;
  try {
    c4 = await dependencies.resolveEpisode({ ...context, ffprobeExecutable }, {
      resolveVisualGenerationState: args => dependencies.resolveVisual(args, visualDeps),
      resolveDialogueCompositionState: dependencies.resolveDialogue,
    });
  } catch (error) { fatal.push(episodeIssue("INVALID_DURABLE_STATE", null, "OBSERVATION", error)); }

  for (const { shot, target } of entries) {
    const reasons: Issue[] = [];
    const add = (code: IssueCode, phase: Issue["phase"], error?: unknown) => reasons.push(episodeIssue(code, target, phase, error));
    let readiness: Awaited<ReturnType<typeof resolveDurableShotExecutionReadiness>> | null = null;
    let c2: ShotPreflight["c2"] = { state: "ERROR", issue: episodeIssue("INVALID_DURABLE_STATE", target, "OBSERVATION") };
    let c3: ShotPreflight["c3"] = c2;
    try {
      const existing = c4?.shots.find(row => row.shotId === target.shotId);
      const visual = existing?.visualGenerationState ?? await dependencies.resolveVisual({ ...context, shot }, visualDeps);
      c2 = { state: visual.state };
    } catch (error) { add("INVALID_DURABLE_STATE", "OBSERVATION", error); }
    try {
      const existing = c4?.shots.find(row => row.shotId === target.shotId);
      const dialogue = existing?.dialogueCompositionState ?? await dependencies.resolveDialogue({ episode, bible,
        shotId: target.shotId, mediaRoot: input.mediaRoot, ffprobeExecutable });
      c3 = { state: dialogue.state };
    } catch (error) { add("INVALID_DURABLE_STATE", "OBSERVATION", error); }
    const refs: ReferenceBinding[] = [];
    // Inventory every declaration, even on blocked and already generated rows.
    for (const assetId of shot.references.assetIds) {
      try {
        const asset = registry?.assets.find(row => row.assetId === assetId);
        if (!registry || !asset) throw registryError ?? new BoundEpisodeError("REFERENCE_UNAVAILABLE");
        const path = resolve(input.mediaRoot, asset.mediaRootRelativePath);
        await requireLinkSafeContainedPath(input.mediaRoot, path);
        const verified = await dependencies.verifyReference({ mediaRoot: input.mediaRoot, sourceImagePath: path,
          approvedAssetIds: shot.references.assetIds, registry });
        const bound = await dependencies.readFile({ root: input.mediaRoot, canonicalPath: verified.absolutePath,
          role: `REFERENCE:${target.shotId}:${assetId}`, maxBytes: Math.min(checked(asset.bytes) + 1, 32 * 1024 * 1024) });
        if (bound.binding.rawSha256 !== asset.sha256 || bound.binding.bytes !== asset.bytes) throw new BoundEpisodeError("REFERENCE_DRIFT");
        refs.push({ shotId: target.shotId, order: target.order, assetId, mediaRootRelativePath: asset.mediaRootRelativePath,
          canonicalAbsolutePath: verified.absolutePath, sha256: asset.sha256, bytes: asset.bytes, contentType: asset.contentType,
          shotApprovalStatus: shot.references.approvalStatus, approvedAssetIds: [...shot.references.assetIds] });
        fileReads.push({ root: input.mediaRoot, binding: bound.binding, maxBytes: Math.min(asset.bytes + 1, 32 * 1024 * 1024) });
      } catch (error) { add("REFERENCE_UNAVAILABLE", "ADMISSION", error); }
    }
    let lifecycle: Awaited<ReturnType<typeof inspectExecutionLifecycle>> | null = null;
    let observation: ObservationBinding = { target, lifecycle: "INVALID", reservationId: null, durableProvider: null,
      reservationSha256: null, submissionSha256: null, completionSha256: null, generationRecordSha256: null, providerExecutionIdentitySha256: null, outputIdentitySha256: null };
    let verification: ShotPreflight["completionVerification"] = "NOT_APPLICABLE";
    let disposition: ShotPreflight["disposition"] = "ERROR";
    try {
      const recordBindings: FileBinding[] = [];
      for (const [role, path] of [
        ["RESERVATION", createExecutionReservationPath(input.mediaRoot, episodeId, shot.id)],
        ["SUBMISSION", createExecutionSubmissionPath(input.mediaRoot, episodeId, shot.id)],
        ["COMPLETION", createExecutionCompletionPath(input.mediaRoot, episodeId, shot.id)],
      ] as const) {
        const read = await dependencies.readFile({ root: input.mediaRoot, canonicalPath: path, role, maxBytes: 1048576, optional: true });
        recordBindings.push(read.binding);
        fileReads.push({ root: input.mediaRoot, binding: read.binding, maxBytes: 1048576 });
      }
      lifecycle = await dependencies.inspectLifecycle(input.mediaRoot, episodeId, shot.id);
      observation = { ...observation, lifecycle: lifecycle.state,
        reservationId: lifecycle.state === "NOTHING" ? null : lifecycle.reservation.reservationId,
        durableProvider: lifecycle.state === "NOTHING" ? null : paidProvider(lifecycle.reservation.provider),
        reservationSha256: recordBindings[0]?.rawSha256 ?? null, submissionSha256: recordBindings[1]?.rawSha256 ?? null,
        completionSha256: recordBindings[2]?.rawSha256 ?? null,
        providerExecutionIdentitySha256: lifecycle.state === "SUBMITTED" || lifecycle.state === "COMPLETED"
          ? bindingDigest([lifecycle.submission.provider, lifecycle.submission.providerExecutionId]) : null };
      if (lifecycle.state === "COMPLETED") {
        verification = "REQUIRED";
        try {
          const complete = await dependencies.verifyComplete({ mediaRoot: input.mediaRoot, episodeId, shotId: shot.id }, lifecycle);
          const generation = await dependencies.readFile({ root: input.mediaRoot, canonicalPath: complete.generationRecordPath,
            role: "GENERATION_RECORD", maxBytes: 1048576 });
          fileReads.push({ root: input.mediaRoot, binding: generation.binding, maxBytes: 1048576 });
          // The digest, rather than generation records or provider IDs, is public.
          observation = { ...observation, generationRecordSha256: generation.binding.rawSha256, outputIdentitySha256: bindingDigest(
            "outputPath" in complete ? [complete.outputPath, complete.bytes, complete.sha256] : complete.generationRecord.outputs) };
          verification = "VERIFIED"; disposition = "COMPLETED";
          completedInspections.set(shot.id, lifecycle);
        } catch (error) { verification = "FAILED"; add("LOCAL_COMPLETION_VERIFICATION_FAILED", "OBSERVATION", error); }
      } else if (lifecycle.state === "SUBMITTED") {
        disposition = "SUBMITTED"; add("SUBMITTED_RECOVERY_REQUIRED", "ADMISSION");
        if ((lifecycle.submission.provider === "RUNWAY" && lifecycle.submission.schemaVersion === "1.2") ||
            (lifecycle.submission.provider === "VEO" && lifecycle.submission.schemaVersion === "1.3") || lifecycle.submission.provider === "GOOGLE_GENAI") supportedRecoveryTargets.add(shot.id);
      }
      else if (lifecycle.state === "RESERVED_ONLY") { disposition = "BLOCKED"; add("RESERVED_ONLY_MANUAL_ADJUDICATION", "ADMISSION"); }
    } catch (error) { add("INVALID_DURABLE_STATE", "OBSERVATION", error); }
    let resolvedProvider: VisualProvider | null = null;
    let activation: ShotPreflight["activation"] = shot.generation.provider === "GOOGLE_GENAI" ? "UNKNOWN" : "NOT_APPLICABLE";
    let cost: ShotPreflight["cost"] = { status: "UNKNOWN", reason: "NOT_EVALUATED", unit: null, billingKnown: false };
    const selectedReference = refs.length === 1 && shot.references.assetIds.length === 1 ? refs[0] ?? null : null;
    try {
      readiness = await resolveDurableShotExecutionReadiness({ ...context, shot }, { readDialogueVisualAuthorization: readAuthorization });
      resolvedProvider = paidProvider(readiness.executionProvider);
      if (readiness.disposition !== "EXECUTABLE" && lifecycle?.state === "NOTHING") {
        add("PROVIDER_ADMISSION_BLOCKED", "ADMISSION");
      }
    } catch (error) { if (lifecycle?.state === "NOTHING") add("INVALID_DURABLE_STATE", "OBSERVATION", error); }
    // Policy errors on unstarted later rows block those rows, not an earlier
    // valid frontier. Recovery remains governed by accepted durable lineage.
    try {
      const provider = observation.durableProvider ?? resolvedProvider ?? paidProvider(shot.generation.provider);
      if (provider === "RUNWAY") {
        const p = required(await load(resolve(root, "config/runway-policy.json"), "RUNWAY_POLICY", v => RunwayPolicySchema.parse(v), true));
        const hash = files[files.length - 1]!.rawSha256!;
        const value = checked(assertGen45WithinBudget(shot.durationSeconds, p));
        const cap = checked(p.gen45.maxCreditsPerGeneration);
        cost = { status: "KNOWN", unit: "RUNWAY_CREDITS", modeledValue: value, perShotCap: cap, policySha256: hash, pricingSha256: hash,
          normalizedMicroUsd: { status: "UNAVAILABLE", reason: "NO_REVIEWED_RUNWAY_USD_RATE" }, billingKnown: false,
          costScope: "NEW_GENERATION_ESTIMATE", includesReserve: false };
        buildRunwayGen45Prompt(shot);
        if (selectedReference && lifecycle?.state === "NOTHING") {
          const asset = await classifyRunwayImageAsset(selectedReference.canonicalAbsolutePath);
          buildGen45Request({ promptImage: asset.strategy === "DATA_URI" ? `data:${asset.mimeType};base64,AA==` : "runway://review-only",
            promptText: buildRunwayGen45Prompt(shot), durationSeconds: shot.durationSeconds });
        }
      } else if (provider === "VEO") {
        const p = required(await load(resolve(root, "config/veo-policy.json"), "VEO_POLICY", v => VeoPolicySchema.parse(v), true));
        const hash = files[files.length - 1]!.rawSha256!;
        const value = checked(assertVeoWithinBudget(shot.durationSeconds, p));
        cost = { status: "KNOWN", unit: "USD_CENTS", modeledValue: value, perShotCap: checked(p.generation.maxCentsPerGeneration),
          policySha256: hash, pricingSha256: hash, normalizedMicroUsd: { status: "KNOWN", value: checked(value * 10000) },
          billingKnown: false, costScope: "NEW_GENERATION_ESTIMATE", includesReserve: false };
        buildVeoGenerateRequest({ promptText: buildVeoPrompt(shot), durationSeconds: shot.durationSeconds }, p);
        if (selectedReference && selectedReference.bytes > p.generation.maxImageBytes) throw new BoundEpisodeError("PROVIDER_ADMISSION_BLOCKED");
      } else if (provider === "GOOGLE_GENAI") {
        const p = required(await load(resolve(root, "config/google-genai-policy.json"), "GOOGLE_POLICY", v => GoogleGenAiPolicySchema.parse(v), true));
        const pricingHash = files[files.length - 1]!.rawSha256!;
        const a = required(await load(resolve(root, "config/google-genai-activation-policy.json"), "GOOGLE_ACTIVATION", v => GoogleGenAiActivationPolicySchema.parse(v), true));
        const hash = files[files.length - 1]!.rawSha256!;
        activation = a.admission.newSubmissionsEnabled ? "ENABLED" : "DISABLED";
        const expected = computeGoogleGenAiExpectedCost({ resolution: "720p", pricing: p.pricing, cost: a.cost });
        cost = { status: "KNOWN", unit: "MICRO_USD", modeledValue: checked(expected.expectedMicroUsd), perShotCap: checked(expected.maxExpectedCostMicroUsd),
          policySha256: hash, pricingSha256: pricingHash, normalizedMicroUsd: { status: "KNOWN", value: expected.expectedMicroUsd },
          billingKnown: false, costScope: "NEW_GENERATION_ESTIMATE", includesReserve: true };
        if (lifecycle?.state === "NOTHING") {
          if (activation === "DISABLED") add("PROVIDER_ACTIVATION_BLOCKED", "ADMISSION", new GoogleGenAiOperatorError("NEW_SUBMISSIONS_DISABLED", "ADMISSION"));
          await evaluateGoogleGenAiLocalAdmission(context, shot, a);
          buildGoogleGenAiSingleShotPrompt(shot);
          if (shot.generation.provider !== "GOOGLE_GENAI") throw new BoundEpisodeError("PROVIDER_ADMISSION_BLOCKED");
          if (selectedReference) await readGoogleGenAiReferenceImage({ mediaRoot: input.mediaRoot,
            sourceImagePath: selectedReference.canonicalAbsolutePath, expectedMimeType: selectedReference.contentType,
            maxBytes: a.limits.maxReferenceImageBytes });
        }
      }
    } catch (error) {
      if (lifecycle?.state === "NOTHING") {
        if (error instanceof BoundEpisodeError && error.code === "INPUT_BINDING_DRIFT") add("INPUT_BINDING_DRIFT", "OBSERVATION", error);
        else add(error instanceof GoogleGenAiOperatorError ? "PROVIDER_ADMISSION_BLOCKED" : "COST_ADMISSION_BLOCKED", "ADMISSION", error);
      }
    }
    if (lifecycle?.state === "NOTHING") {
      if (!selectedReference) add(refs.length > 1 ? "REFERENCE_SELECTION_REQUIRED" : "REFERENCE_UNAVAILABLE", "ADMISSION");
      if (cost.status === "UNKNOWN") add("COST_ADMISSION_BLOCKED", "ADMISSION");
      const ordinaryNotReady = readiness?.disposition === "NOT_READY" || reasons.some(reason =>
        ["EPISODE_STATUS_NOT_LIVE", "APPROVALS_MISSING", "SHOT_STATUS_NOT_APPROVED"].includes(reason.lowerCause?.code ?? ""));
      disposition = reasons.some(reason => reason.code === "INVALID_DURABLE_STATE" || (reason.code === "INPUT_BINDING_DRIFT" && reason.phase === "OBSERVATION")) ? "ERROR"
        : reasons.some(reason => reason.code !== "PROVIDER_ADMISSION_BLOCKED") ? "BLOCKED"
        : ordinaryNotReady ? "NOT_READY" : reasons.length ? "BLOCKED" : "READY";
    }
    if (c2.state === "ERROR" || c3.state === "ERROR") disposition = "ERROR";
    const manifestHash = files.find(file => file.role === "MANIFEST")?.rawSha256;
    const adopted = input.evidenceAdoptions?.some(adoption => bindingDigest(adoption.target) === bindingDigest(target)
      && adoption.manifestRawSha256 === manifestHash && adoption.observationSha256 === bindingDigest(observation)) ?? false;
    const durable = lifecycle?.state === "COMPLETED" || lifecycle?.state === "SUBMITTED";
    const precedence: readonly IssueCode[] = ["INPUT_BINDING_DRIFT", "INVALID_DURABLE_STATE", "LOCAL_COMPLETION_VERIFICATION_FAILED",
      "RESERVED_ONLY_MANUAL_ADJUDICATION", "SUBMITTED_RECOVERY_REQUIRED", "REFERENCE_DRIFT", "REFERENCE_UNAVAILABLE",
      "REFERENCE_SELECTION_REQUIRED", "PROVIDER_ACTIVATION_BLOCKED", "PROVIDER_ADMISSION_BLOCKED", "COST_ADMISSION_BLOCKED"];
    reasons.sort((a, b) => precedence.indexOf(a.code) - precedence.indexOf(b.code));
    const publicReasons = lifecycle?.state !== "NOTHING" ? reasons.filter(reason => reason.phase === "OBSERVATION" ||
      reason.code === "RESERVED_ONLY_MANUAL_ADJUDICATION" || reason.code === "SUBMITTED_RECOVERY_REQUIRED") : reasons;
    observations.push(observation);
    rows.push({ ...target, inScope: scope.shotIds.includes(shot.id), manifestProvider: shot.generation.provider, resolvedProvider,
      durableProvider: observation.durableProvider, routing: readiness?.routing ?? null, c2, c3, lifecycle: observation, recordHashes: observation,
      completionVerification: verification, intentAlignment: durable ? adopted ? "REVIEWED" : "UNATTESTED_EXISTING_EVIDENCE" : "NOT_APPLICABLE",
      readiness, providerAdmission: readiness?.disposition === "EXECUTABLE" && !publicReasons.length ? "PASSED" : "BLOCKED",
      referenceBindings: refs, selectedReference,
      currentReferenceIssues: reasons.filter(reason => ["REFERENCE_UNAVAILABLE", "REFERENCE_DRIFT", "REFERENCE_SELECTION_REQUIRED"].includes(reason.code)),
      cost, activation, disposition, primaryReason: publicReasons[0] ?? null, reasons: publicReasons,
      handoffCompatibility: (observation.durableProvider ?? resolvedProvider) === "GOOGLE_GENAI" ? "HANDOFF_UNSUPPORTED_FOR_PROVIDER"
        : (observation.durableProvider ?? resolvedProvider) ? "SUPPORTED_PROVIDER" : "UNKNOWN" });
  }
  // A second read detects observed drift; it is not a claim of hostile-writer
  // resistance or immutable path handles. Controlled no-edit ownership remains
  // an independent execution prerequisite.
  for (const file of fileReads) {
    try { await dependencies.readFile({ root: file.root, canonicalPath: file.binding.canonicalPath, role: file.binding.role,
      maxBytes: file.maxBytes, optional: !file.binding.exists, expected: file.binding }); }
    catch (error) { fatal.push(episodeIssue("INPUT_BINDING_DRIFT", null, "LOAD", error)); }
  }
  for (const [index, row] of rows.entries()) {
    const completed = completedInspections.get(row.shotId);
    if (!completed) continue;
    try {
      const verified = await dependencies.verifyComplete({ mediaRoot: input.mediaRoot, episodeId, shotId: row.shotId }, completed);
      const identity = bindingDigest("outputPath" in verified ? [verified.outputPath, verified.bytes, verified.sha256] : verified.generationRecord.outputs);
      if (identity !== row.lifecycle.outputIdentitySha256) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
    } catch (error) {
      const issue = episodeIssue("LOCAL_COMPLETION_VERIFICATION_FAILED", { episodeId, sceneId: row.sceneId, shotId: row.shotId, order: row.order }, "OBSERVATION", error);
      fatal.push(issue);
      rows[index] = { ...row, disposition: "ERROR", completionVerification: "FAILED", primaryReason: issue,
        reasons: [issue, ...row.reasons] };
    }
  }
  const uniqueFiles = [...new Map(files.map(file => [`${file.role}:${file.canonicalPath}`, file])).values()]
    .sort((a, b) => a.role < b.role ? -1 : a.role > b.role ? 1 : a.canonicalPath < b.canonicalPath ? -1 : a.canonicalPath > b.canonicalPath ? 1 : 0);
  const binding: InputBindingBundle = { bindingVersion: "1.0", episodeId, scope, orderedTargets: targets,
    fileBindings: uniqueFiles, referenceBindings: rows.flatMap(row => [...row.referenceBindings]).sort((a, b) => a.order - b.order || (a.assetId < b.assetId ? -1 : 1)),
    runtimeIdentity: input.runtimeIdentity };
  if (input.expectedBinding) {
    try { requireSameBinding(binding, input.expectedBinding); }
    catch (error) { fatal.push(episodeIssue("INPUT_BINDING_DRIFT", null, "LOAD", error)); }
  }
  return finish(rows, targets, observations, fatal, binding, scope);

  async function finish(shots: readonly ShotPreflight[], targets: readonly Target[] | null,
    observed: readonly ObservationBinding[], fatalReasons: readonly Issue[], binding: InputBindingBundle | null,
    scope: Scope): Promise<BoundEpisodePreflight> {
    const counts = emptyCounts(); const selected = emptyCounts();
    for (const shot of shots) { counts[shot.disposition]++; if (shot.inScope) selected[shot.disposition]++; }
    const unevaluated = targets?.filter(target => !shots.some(shot => shot.shotId === target.shotId)).map(target => target.shotId) ?? [];
    const complete = targets !== null && !unevaluated.length && !fatalReasons.length;
    const alignment = !shots.some(shot => shot.intentAlignment === "UNATTESTED_EXISTING_EVIDENCE");
    const frontier = shots.find(shot => shot.disposition !== "COMPLETED");
    const ambiguity = shots.some(shot => ["ERROR", "SUBMITTED"].includes(shot.disposition) || shot.lifecycle.lifecycle === "RESERVED_ONLY");
    let candidate: ActionCandidate | null = null;
    let ownership: BoundEpisodePreflight["ownership"]["observed"] = "ABSENT";
    try {
      await lstat(resolve(input.mediaRoot, "generated-video", episodeId, ".episode-execution-guard.json")); ownership = "CONFLICT";
    } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) ownership = "UNKNOWN"; }
    if (complete && alignment && frontier?.inScope && !shots.some(shot => shot.disposition === "ERROR")) {
      const target = { episodeId, sceneId: frontier.sceneId, shotId: frontier.shotId, order: frontier.order };
      if (frontier.disposition === "READY" && !ambiguity && frontier.selectedReference && frontier.resolvedProvider && frontier.cost.status === "KNOWN") {
        candidate = { ...target, kind: "VISUAL_GENERATE", expectedLifecycle: "NOTHING", provider: frontier.resolvedProvider,
          referenceBinding: frontier.selectedReference, cost: frontier.cost, observationSha256: bindingDigest(frontier.lifecycle) };
      } else if (frontier.disposition === "SUBMITTED" && frontier.durableProvider && frontier.lifecycle.submissionSha256 && frontier.lifecycle.reservationSha256) {
        // Existing secured recovery refuses legacy metadata; the planner does
        // not turn an unsupported accepted job into an unstarted generation.
        if (supportedRecoveryTargets.has(frontier.shotId)) {
          candidate = { ...target, kind: "VISUAL_RECONCILE", expectedLifecycle: "SUBMITTED", provider: frontier.durableProvider,
            observation: frontier.lifecycle, observationSha256: bindingDigest(frontier.lifecycle) };
        }
      }
    }
    const ready = new Map<KnownCost["unit"], { unit: KnownCost["unit"]; value: number; count: number; complete: boolean }>();
    for (const shot of shots) if (shot.inScope && shot.disposition === "READY" && shot.cost.status === "KNOWN") {
      const total = ready.get(shot.cost.unit) ?? { unit: shot.cost.unit, value: 0, count: 0, complete: true };
      const next = total.value + shot.cost.modeledValue;
      if (!Number.isSafeInteger(next)) total.complete = false; else total.value = next;
      total.count++; ready.set(total.unit, total);
    }
    const handoff = { issues: shots.filter(shot => shot.handoffCompatibility === "HANDOFF_UNSUPPORTED_FOR_PROVIDER")
      .map(shot => episodeIssue("HANDOFF_UNSUPPORTED_FOR_PROVIDER", { episodeId, sceneId: shot.sceneId, shotId: shot.shotId, order: shot.order }, "HANDOFF")),
      editorialReady: false as const, e9Consumption: "NOT_INTEGRATED_IN_PAID_VISUAL_PATH" as const };
    return freezeBoundCopy({ schemaVersion: "2.0", episodeId, title: typeof episode === "undefined" ? "" : episode.title,
      binding, bindingSha256: binding ? bindingDigest(binding) : null, observationsSha256: bindingDigest(observed), observations: observed,
      observedAt: new Date().toISOString(), runtimeIdentity: input.runtimeIdentity, scope,
      totalIntended: targets?.length ?? null, scopeTotal: targets === null ? null : scope.shotIds.length,
      inventory: { complete, evaluatedIds: shots.map(shot => shot.shotId), unevaluatedIds: unevaluated, fatalReasons },
      shots, counts: { episode: counts, scope: selected, unevaluated: unevaluated.length },
      costs: { readyByNativeUnit: [...ready.values()], unknownCostShotIds: shots.filter(shot => shot.cost.status === "UNKNOWN").map(shot => shot.shotId),
        unifiedTotal: { status: "UNAVAILABLE", reason: "NATIVE_UNITS_SEPARATE_NO_BILLING_CLAIM" }, billingKnown: false },
      nextActionCandidate: candidate, remainingWork: shots.map(shot => ({ episodeId, sceneId: shot.sceneId, shotId: shot.shotId, order: shot.order,
        inScope: shot.inScope, disposition: shot.disposition,
        reason: shot === frontier && !shot.inScope ? "EARLIER_EPISODE_WORK_UNRESOLVED" : shot.primaryReason?.code ?? null })),
      completion: complete && alignment && shots.filter(shot => shot.inScope).every(shot => shot.disposition === "COMPLETED")
        ? scope.kind === "EPISODE_SCOPE" ? "VISUAL_PRODUCTION_COMPLETE" : "SELECTED_SCOPE_COMPLETE" : "INCOMPLETE",
      intentAlignment: alignment ? "REVIEWED" : "REVIEW_REQUIRED", handoff,
      generationMayBeAuthorized: candidate?.kind === "VISUAL_GENERATE" && ownership === "ABSENT",
      recoveryMayBeAuthorized: candidate?.kind === "VISUAL_RECONCILE" && ownership === "ABSENT",
      ownership: { observed: ownership, requiresAcquisition: true } });
  }
}
