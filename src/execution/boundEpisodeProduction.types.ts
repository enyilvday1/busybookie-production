import type { EpisodeCoordinatorAction, EpisodeCoordinatorRunner, CoordinateEpisodeActionResult } from "./coordinateEpisodeAction.js";
import type { EpisodeAutomationFailedActionOutcome } from "./runEpisodeAutomation.js";
import { createHash } from "node:crypto";
import type { ShotExecutionReadiness } from "../planning/executionReadiness.types.js";
import type { DurableShotDialogueCompositionState } from "../dialogue/resolveDurableShotDialogueCompositionState.js";

export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type VisualProvider = "RUNWAY" | "VEO" | "GOOGLE_GENAI";
export type NativeCostUnit = "RUNWAY_CREDITS" | "USD_CENTS" | "MICRO_USD";
export type Target = Readonly<{ episodeId: string; sceneId: string; shotId: string; order: number }>;
export type Scope = Readonly<{ kind: "EPISODE_SCOPE" | "SELECTED_SCOPE"; shotIds: readonly string[] }>;
export type FileBinding = Readonly<{ role: string; canonicalPath: string; exists: boolean; rawSha256: string | null; bytes: number }>;
export type ReferenceBinding = Readonly<{
  shotId: string; order: number; assetId: string; mediaRootRelativePath: string;
  canonicalAbsolutePath: string; sha256: string; bytes: number;
  contentType: "image/png" | "image/jpeg" | "image/webp";
  shotApprovalStatus: string; approvedAssetIds: readonly string[];
}>;
export type RuntimeIdentity = Readonly<{
  reviewedRevision: string; repositoryRoot: string; mediaRoot: string; physicalMediaRoot: string;
  executableInputs: readonly FileBinding[]; ffprobe: FileBinding | null;
}>;
export type InputBindingBundle = Readonly<{
  bindingVersion: "1.0"; episodeId: string; scope: Scope; orderedTargets: readonly Target[];
  fileBindings: readonly FileBinding[]; referenceBindings: readonly ReferenceBinding[]; runtimeIdentity: RuntimeIdentity;
}>;
export type ObservationBinding = Readonly<{
  target: Target; lifecycle: "NOTHING" | "RESERVED_ONLY" | "SUBMITTED" | "COMPLETED" | "INVALID" | "UNEVALUATED";
  reservationId: string | null; durableProvider: VisualProvider | null;
  reservationSha256: string | null; submissionSha256: string | null; completionSha256: string | null;
  generationRecordSha256: string | null;
  providerExecutionIdentitySha256: string | null; outputIdentitySha256: string | null;
}>;
export type EvidenceAdoption = Readonly<{ target: Target; manifestRawSha256: string; observationSha256: string }>;
export type KnownCost = Readonly<{
  status: "KNOWN"; unit: NativeCostUnit; modeledValue: number; perShotCap: number;
  policySha256: string; pricingSha256: string;
  normalizedMicroUsd: Readonly<{ status: "KNOWN"; value: number }> | Readonly<{ status: "UNAVAILABLE"; reason: string }>;
  billingKnown: false; costScope: "NEW_GENERATION_ESTIMATE"; includesReserve: boolean;
}>;
export type UnknownCost = Readonly<{ status: "UNKNOWN"; reason: string; unit: NativeCostUnit | null; billingKnown: false }>;
export type CostAuthority = Readonly<{ unit: NativeCostUnit; modeledValue: number; maxModeledValue: number; policySha256: string }>;
export type BoundVisualAction =
  | Readonly<Target & { kind: "VISUAL_GENERATE"; expectedLifecycle: "NOTHING"; resolvedProvider: VisualProvider;
      referenceBinding: ReferenceBinding; costAuthority: CostAuthority; confirmPaidGeneration: true }>
  | Readonly<Target & { kind: "VISUAL_RECONCILE"; expectedLifecycle: "SUBMITTED"; reservationId: string;
      durableProvider: VisualProvider; providerExecutionIdentitySha256: string; submissionSha256: string;
      reservationSha256: string; confirmReconciliation: true }>;
export type ControlledEpisodeAutomationPlan = DeepReadonly<{
  schemaVersion: "2.0"; mode: "CONTROLLED_VISUAL"; episodeId: string; scope: Scope;
  inputBinding: InputBindingBundle; inputBindingSha256: string; observations: readonly ObservationBinding[];
  observationsSha256: string; evidenceAdoptions: readonly EvidenceAdoption[];
  maximumNewProviderCreates: 0 | 1;
  operatingCondition: { singleOperator: true; noConcurrentAuthoring: true; noUnguardedRunners: true };
  actions: readonly [BoundVisualAction];
}>;
export const B7_ISSUE_CODES = [
  "INPUT_BINDING_DRIFT", "EPISODE_OWNERSHIP_CONFLICT", "INVALID_DURABLE_STATE",
  "RESERVED_ONLY_MANUAL_ADJUDICATION", "SUBMITTED_RECOVERY_REQUIRED", "PROVIDER_ACTIVATION_BLOCKED",
  "REFERENCE_SELECTION_REQUIRED", "REFERENCE_UNAVAILABLE", "REFERENCE_DRIFT", "PROVIDER_ADMISSION_BLOCKED",
  "COST_ADMISSION_BLOCKED", "LOCAL_COMPLETION_VERIFICATION_FAILED", "HANDOFF_UNSUPPORTED_FOR_PROVIDER",
  "MAX_CREATE_COUNT_REACHED", "ACTION_REJECTED", "POST_ACTION_STATE_UNRESOLVED", "UNEXPECTED_PROVIDER_RESULT",
  "EARLIER_EPISODE_WORK_UNRESOLVED", "LEGACY_VISUAL_PLAN_REQUIRES_CONVERSION", "OPERATING_CONDITION_UNESTABLISHED",
] as const;
export type IssueCode = typeof B7_ISSUE_CODES[number];
export type Issue = DeepReadonly<{
  target: Target | null; phase: "LOAD" | "OBSERVATION" | "ADMISSION" | "OWNERSHIP" | "DISPATCH" | "POST_ACTION" | "HANDOFF";
  code: IssueCode; detail: string; actionMayHaveEffects: boolean;
  lowerCause: { name: string; code: string | null; stage: string | null; stateChange: string | null } | null;
}>;
export class BoundEpisodeError extends Error {
  readonly code: IssueCode;
  constructor(code: IssueCode, options?: ErrorOptions) {
    super(`Controlled episode operation stopped (${code}).`, options);
    this.name = "BoundEpisodeError";
    this.code = code;
  }
}
export type Disposition = "ERROR" | "BLOCKED" | "COMPLETED" | "SUBMITTED" | "NOT_READY" | "READY";
export type BucketCounts = Readonly<Record<Disposition, number>>;
export type SafeAxisObservation = Readonly<{ state: string }> | Readonly<{ state: "ERROR"; issue: Issue }>;
export type ShotPreflight = DeepReadonly<Target & {
  inScope: boolean; manifestProvider: string; resolvedProvider: VisualProvider | null; durableProvider: VisualProvider | null;
  routing: ShotExecutionReadiness["routing"] | null;
  c2: SafeAxisObservation; c3: SafeAxisObservation;
  lifecycle: ObservationBinding; recordHashes: ObservationBinding;
  completionVerification: "NOT_APPLICABLE" | "VERIFIED" | "FAILED" | "REQUIRED";
  intentAlignment: "UNATTESTED_EXISTING_EVIDENCE" | "REVIEWED" | "NOT_APPLICABLE";
  readiness: ShotExecutionReadiness | null; providerAdmission: "PASSED" | "BLOCKED" | "NOT_APPLICABLE";
  referenceBindings: readonly ReferenceBinding[]; selectedReference: ReferenceBinding | null;
  currentReferenceIssues: readonly Issue[];
  cost: KnownCost | UnknownCost; activation: "ENABLED" | "DISABLED" | "NOT_APPLICABLE" | "UNKNOWN";
  disposition: Disposition; primaryReason: Issue | null; reasons: readonly Issue[];
  handoffCompatibility: "SUPPORTED_PROVIDER" | "HANDOFF_UNSUPPORTED_FOR_PROVIDER" | "UNKNOWN";
}>;
export type RemainingWorkRow = Readonly<Target & { inScope: boolean; disposition: Disposition; reason: IssueCode | null }>;
export type ActionCandidate =
  | Readonly<Target & { kind: "VISUAL_GENERATE"; expectedLifecycle: "NOTHING"; provider: VisualProvider;
      referenceBinding: ReferenceBinding; cost: KnownCost; observationSha256: string }>
  | Readonly<Target & { kind: "VISUAL_RECONCILE"; expectedLifecycle: "SUBMITTED"; provider: VisualProvider;
      observation: ObservationBinding; observationSha256: string }>;
export type VisualCompletion = "INCOMPLETE" | "VISUAL_PRODUCTION_COMPLETE" | "SELECTED_SCOPE_COMPLETE";
export type ReadonlyHandoffReport = DeepReadonly<{ issues: readonly Issue[]; editorialReady: false;
  e9Consumption: "NOT_INTEGRATED_IN_PAID_VISUAL_PATH" }>;
export type BoundEpisodePreflight = DeepReadonly<{
  schemaVersion: "2.0"; episodeId: string; title: string; binding: InputBindingBundle | null;
  bindingSha256: string | null; observationsSha256: string; observations: readonly ObservationBinding[];
  observedAt: string; runtimeIdentity: RuntimeIdentity; scope: Scope; totalIntended: number | null; scopeTotal: number | null;
  inventory: { complete: boolean; evaluatedIds: readonly string[]; unevaluatedIds: readonly string[]; fatalReasons: readonly Issue[] };
  shots: readonly ShotPreflight[]; counts: { episode: BucketCounts; scope: BucketCounts; unevaluated: number };
  costs: { readyByNativeUnit: readonly { unit: NativeCostUnit; value: number; count: number; complete: boolean }[];
    unknownCostShotIds: readonly string[]; unifiedTotal: { status: "UNAVAILABLE"; reason: string }; billingKnown: false };
  nextActionCandidate: ActionCandidate | null; remainingWork: readonly RemainingWorkRow[]; completion: VisualCompletion;
  intentAlignment: "REVIEW_REQUIRED" | "REVIEWED"; handoff: ReadonlyHandoffReport;
  generationMayBeAuthorized: boolean; recoveryMayBeAuthorized: boolean;
  ownership: { observed: "ABSENT" | "CONFLICT" | "UNKNOWN"; requiresAcquisition: true };
}>;
export type BoundEpisodeActionResult = DeepReadonly<{
  episodeId: string; action: BoundVisualAction | null; beforePlan: BoundEpisodePreflight; afterPlan: BoundEpisodePreflight | null;
  status: "NO_ACTION" | "ACTION_COMPLETED" | "STOPPED" | "REJECTED" | "UNRESOLVED";
  stopReason: IssueCode | null; dispatchAllowanceConsumed: 0 | 1; observedNewCreateCount: 0 | 1 | "UNKNOWN";
  recoveryDispatchCount: 0 | 1; visualCompletion: VisualCompletion; handoff: ReadonlyHandoffReport;
  selectedPostObservation?: ObservationBinding | null;
  remainingWork: readonly RemainingWorkRow[]; actionMayHaveEffects: boolean; issues: readonly Issue[];
}>;
export class BoundEpisodeActionError extends Error {
  readonly result: BoundEpisodeActionResult;
  readonly postObservationCause: unknown;
  constructor(result: BoundEpisodeActionResult, cause: unknown, postObservationCause?: unknown) {
    super("Controlled visual action failed; inspect the attached durable observation before further authority.", { cause });
    this.name = "BoundEpisodeActionError"; this.result = result; this.postObservationCause = postObservationCause;
  }
}

// Keep the full C3 authority internal. Public plans expose a safe observation,
// never audio URLs, provider identities or reader error prose.
export type InternalDialogueObservation = DurableShotDialogueCompositionState;

// Shared producer/consumer encoding. Reject lossy JSON values rather than
// letting JSON.stringify silently drop or round reviewed authority.
export function canonicalBindingJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("Binding numbers must be finite safe integers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) throw new TypeError("Sparse binding array.");
      parts.push(canonicalBindingJson(value[index]));
    }
    return `[${parts.join(",")}]`;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("Binding values must be plain JSON data.");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== "string")) throw new TypeError("Symbol binding key.");
  return `{${Object.keys(descriptors).sort().map(key => {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) throw new TypeError("Non-data binding property.");
    return `${JSON.stringify(key)}:${canonicalBindingJson(descriptor.value)}`;
  }).join(",")}}`;
}
export function rawSha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function bindingDigest(value: unknown): string { return rawSha256(canonicalBindingJson(value)); }
export function freezeBoundCopy<T>(value: T): DeepReadonly<T> {
  const copy = structuredClone(value);
  function freeze(item: unknown): void {
    if (item !== null && typeof item === "object") {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  }
  freeze(copy);
  // The only assertion is the structural recursive readonly view of the
  // independently cloned and recursively frozen value.
  return copy as DeepReadonly<T>;
}
export function requireSameBinding(actual: unknown, expected: unknown): void {
  if (canonicalBindingJson(actual) !== canonicalBindingJson(expected)) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
}
export function assertBindingBundleOrder(bundle: InputBindingBundle): void {
  const targets = [...bundle.orderedTargets].sort((a, b) => a.order - b.order);
  requireSameBinding(bundle.orderedTargets, targets);
  targets.forEach((target, index) => {
    if (target.order !== index + 1 || target.episodeId !== bundle.episodeId) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
  });
  const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
  requireSameBinding(bundle.fileBindings, [...bundle.fileBindings].sort((a, b) => compare(a.role, b.role) || compare(a.canonicalPath, b.canonicalPath)));
  requireSameBinding(bundle.referenceBindings, [...bundle.referenceBindings].sort((a, b) => a.order - b.order || compare(a.assetId, b.assetId)));
}

export class EpisodeActionPostStateResolutionError extends Error {
  readonly actionCompleted:
    true =
      true;

  readonly episodeId:
    string;

  readonly action:
    EpisodeCoordinatorAction;

  readonly runner:
    EpisodeCoordinatorRunner;

  constructor(
    input:
      Readonly<{
        episodeId: string;
        action: EpisodeCoordinatorAction;
        runner: EpisodeCoordinatorRunner;
        cause: unknown;
      }>,
  ) {
    super(
      `Episode action ${input.action.kind} for ${input.episodeId} completed via ${input.runner}, but the resulting durable episode state could not be resolved.`,
      {
        cause:
          input.cause,
      },
    );

    this.name =
      "EpisodeActionPostStateResolutionError";

    this.episodeId =
      input.episodeId;

    this.action =
      input.action;

    this.runner =
      input.runner;
  }
}


export class EpisodeAutomationError extends Error {
  readonly episodeId:
    string;

  readonly failedActionIndex:
    number;

  readonly failedAction:
    EpisodeCoordinatorAction;

  readonly completedResults:
    readonly CoordinateEpisodeActionResult[];

  readonly failedActionOutcome:
    EpisodeAutomationFailedActionOutcome;

  constructor(
    input:
      Readonly<{
        episodeId: string;
        failedActionIndex: number;
        failedAction: EpisodeCoordinatorAction;
        completedResults: readonly CoordinateEpisodeActionResult[];
        cause: unknown;
      }>,
  ) {
    const failedActionOutcome:
      EpisodeAutomationFailedActionOutcome =
        input.cause instanceof
          EpisodeActionPostStateResolutionError
          ? "COMPLETED_STATE_UNRESOLVED"
          : "UNKNOWN";

    super(
      `Episode automation for ${input.episodeId} stopped at action index ${input.failedActionIndex} (zero-based, ${input.failedAction.kind}); outcome ${failedActionOutcome}; later actions were not attempted.`,
      {
        cause:
          input.cause,
      },
    );

    this.name =
      "EpisodeAutomationError";

    this.episodeId =
      input.episodeId;

    this.failedActionIndex =
      input.failedActionIndex;

    this.failedAction =
      input.failedAction;

    this.completedResults =
      Object.freeze([
        ...input.completedResults,
      ]);

    this.failedActionOutcome =
      failedActionOutcome;
  }
}
