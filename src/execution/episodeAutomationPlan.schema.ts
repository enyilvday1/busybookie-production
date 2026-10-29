import {
  z,
} from "zod";
import { bindingDigest, freezeBoundCopy, assertBindingBundleOrder, requireSameBinding } from "./boundEpisodeProduction.types.js";
import type { ControlledEpisodeAutomationPlan } from "./boundEpisodeProduction.types.js";

import {
  DialogueReservationLineIdSchema,
  DialogueReservationSceneIdSchema,
  DialogueReservationShotIdSchema,
  dialogueReservationIdentityMatches,
} from "../dialogue/dialogueReservation.schema.js";

import type {
  EpisodeCoordinatorAction,
} from "./coordinateEpisodeAction.js";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "./executionReservation.schema.js";

// C7 operator plan: a strict, explicit list of C6b actions. It authorizes
// WHAT may be attempted; C6b still decides, per action and from fresh C4
// state, WHETHER it is admitted.

export const MAX_EPISODE_AUTOMATION_PLAN_BYTES =
  1048576;

export const MAX_EPISODE_AUTOMATION_ACTIONS =
  1000;

export type LegacyEpisodeAutomationPlan =
  Readonly<{
    schemaVersion: "1.0";
    episodeId: string;
    actions: readonly EpisodeCoordinatorAction[];
  }>;

export type EpisodeAutomationPlan = LegacyEpisodeAutomationPlan | ControlledEpisodeAutomationPlan;

const Digest = z.string().regex(/^[0-9a-f]{64}$/);
const SafeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const Provider = z.enum(["RUNWAY", "VEO", "GOOGLE_GENAI"]);
const Target = z.object({ episodeId: ExecutionReservationEpisodeIdSchema,
  sceneId: DialogueReservationSceneIdSchema, shotId: ExecutionReservationShotIdSchema,
  order: SafeInteger.min(1) }).strict();
const Scope = z.object({ kind: z.enum(["EPISODE_SCOPE", "SELECTED_SCOPE"]),
  shotIds: z.array(ExecutionReservationShotIdSchema).min(1) }).strict();
const FileBinding = z.object({ role: z.string().min(1), canonicalPath: z.string().min(1),
  exists: z.boolean(), rawSha256: Digest.nullable(), bytes: SafeInteger }).strict().superRefine((value, ctx) => {
    if (value.exists ? value.rawSha256 === null : value.rawSha256 !== null || value.bytes !== 0) {
      ctx.addIssue({ code: "custom", message: "Inconsistent file existence binding." });
    }
  });
const ReferenceBinding = z.object({ shotId: ExecutionReservationShotIdSchema, order: SafeInteger.min(1),
  assetId: z.string().min(1), mediaRootRelativePath: z.string().min(1), canonicalAbsolutePath: z.string().min(1),
  sha256: Digest, bytes: SafeInteger.min(1), contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  shotApprovalStatus: z.string().min(1), approvedAssetIds: z.array(z.string().min(1)).min(1) }).strict();
const RuntimeIdentity = z.object({ reviewedRevision: z.string().regex(/^[0-9a-f]{40}$/),
  repositoryRoot: z.string().min(1), mediaRoot: z.string().min(1), physicalMediaRoot: z.string().min(1),
  executableInputs: z.array(FileBinding).min(1), ffprobe: FileBinding.nullable() }).strict();
const InputBinding = z.object({ bindingVersion: z.literal("1.0"), episodeId: ExecutionReservationEpisodeIdSchema,
  scope: Scope, orderedTargets: z.array(Target).min(1), fileBindings: z.array(FileBinding).min(1),
  referenceBindings: z.array(ReferenceBinding), runtimeIdentity: RuntimeIdentity }).strict();
const Observation = z.object({ target: Target,
  lifecycle: z.enum(["NOTHING", "RESERVED_ONLY", "SUBMITTED", "COMPLETED", "INVALID", "UNEVALUATED"]),
  reservationId: z.string().uuid().nullable(), durableProvider: Provider.nullable(),
  reservationSha256: Digest.nullable(), submissionSha256: Digest.nullable(), completionSha256: Digest.nullable(),
  generationRecordSha256: Digest.nullable(),
  providerExecutionIdentitySha256: Digest.nullable(), outputIdentitySha256: Digest.nullable() }).strict().superRefine((value, ctx) => {
    const empty = [value.reservationId, value.durableProvider, value.reservationSha256, value.submissionSha256,
      value.completionSha256, value.generationRecordSha256, value.providerExecutionIdentitySha256, value.outputIdentitySha256];
    const reserved = value.reservationId !== null && value.durableProvider !== null && value.reservationSha256 !== null;
    const submitted = reserved && value.submissionSha256 !== null && value.providerExecutionIdentitySha256 !== null;
    if ((value.lifecycle === "NOTHING" && empty.some(field => field !== null)) ||
        (value.lifecycle === "RESERVED_ONLY" && (!reserved || value.submissionSha256 !== null || value.completionSha256 !== null ||
          value.providerExecutionIdentitySha256 !== null || value.generationRecordSha256 !== null || value.outputIdentitySha256 !== null)) ||
        (value.lifecycle === "SUBMITTED" && (!submitted || value.completionSha256 !== null || value.generationRecordSha256 !== null || value.outputIdentitySha256 !== null)) ||
        (value.lifecycle === "COMPLETED" && (!submitted || value.completionSha256 === null || value.generationRecordSha256 === null || value.outputIdentitySha256 === null))) {
      ctx.addIssue({ code: "custom", message: "Inconsistent lifecycle observation binding." });
    }
  });
const CostAuthority = z.object({ unit: z.enum(["RUNWAY_CREDITS", "USD_CENTS", "MICRO_USD"]),
  modeledValue: SafeInteger, maxModeledValue: SafeInteger, policySha256: Digest }).strict();
const BoundGenerate = Target.extend({ kind: z.literal("VISUAL_GENERATE"), expectedLifecycle: z.literal("NOTHING"),
  resolvedProvider: Provider, referenceBinding: ReferenceBinding, costAuthority: CostAuthority,
  confirmPaidGeneration: z.literal(true) }).strict();
const BoundReconcile = Target.extend({ kind: z.literal("VISUAL_RECONCILE"), expectedLifecycle: z.literal("SUBMITTED"),
  reservationId: z.string().uuid(), durableProvider: Provider, providerExecutionIdentitySha256: Digest,
  submissionSha256: Digest, reservationSha256: Digest, confirmReconciliation: z.literal(true) }).strict();
const ControlledPlan = z.object({ schemaVersion: z.literal("2.0"), mode: z.literal("CONTROLLED_VISUAL"),
  episodeId: ExecutionReservationEpisodeIdSchema, scope: Scope, inputBinding: InputBinding,
  inputBindingSha256: Digest, observations: z.array(Observation).min(1), observationsSha256: Digest,
  evidenceAdoptions: z.array(z.object({ target: Target, manifestRawSha256: Digest, observationSha256: Digest }).strict()),
  maximumNewProviderCreates: z.union([z.literal(0), z.literal(1)]),
  operatingCondition: z.object({ singleOperator: z.literal(true), noConcurrentAuthoring: z.literal(true),
    noUnguardedRunners: z.literal(true) }).strict(),
  actions: z.tuple([z.discriminatedUnion("kind", [BoundGenerate, BoundReconcile])]),
}).strict();

function parseControlledPlan(input: unknown): ControlledEpisodeAutomationPlan {
  const result = ControlledPlan.safeParse(input);
  if (!result.success) throw schemaError(result.error);
  const plan = result.data;
  const action = plan.actions[0];
  if (plan.episodeId !== plan.inputBinding.episodeId || action.episodeId !== plan.episodeId ||
      plan.maximumNewProviderCreates !== (action.kind === "VISUAL_GENERATE" ? 1 : 0)) {
    throw planError("Controlled action identity or create allowance is inconsistent.");
  }
  requireSameBinding(plan.scope, plan.inputBinding.scope);
  assertBindingBundleOrder(plan.inputBinding);
  if (bindingDigest(plan.inputBinding) !== plan.inputBindingSha256 || bindingDigest(plan.observations) !== plan.observationsSha256) {
    throw planError("Controlled binding payload digest does not match.");
  }
  const targets = plan.inputBinding.orderedTargets;
  if (new Set(targets.map(row => row.shotId)).size !== targets.length ||
      new Set(plan.scope.shotIds).size !== plan.scope.shotIds.length) throw planError("Duplicate controlled target.");
  const scopeTargets = targets.filter(row => plan.scope.shotIds.includes(row.shotId));
  requireSameBinding(scopeTargets.map(row => row.shotId), plan.scope.shotIds);
  if (plan.scope.kind === "EPISODE_SCOPE") requireSameBinding(plan.scope.shotIds, targets.map(row => row.shotId));
  if (plan.scope.kind === "SELECTED_SCOPE" && scopeTargets.length === targets.length) throw planError("Full scope must use EPISODE_SCOPE.");
  const target = targets.find(row => row.shotId === action.shotId);
  if (!target || !plan.scope.shotIds.includes(action.shotId)) throw planError("Action target is outside the reviewed scope.");
  requireSameBinding(target, { episodeId: action.episodeId, sceneId: action.sceneId, shotId: action.shotId, order: action.order });
  requireSameBinding(plan.observations.map(row => row.target), targets);
  const observed = plan.observations.find(row => row.target.shotId === action.shotId);
  if (!observed || observed.lifecycle !== action.expectedLifecycle) throw planError("Action observation does not match.");
  if (action.kind === "VISUAL_GENERATE") {
    if (action.referenceBinding.shotId !== action.shotId || action.referenceBinding.order !== action.order ||
        !action.referenceBinding.approvedAssetIds.includes(action.referenceBinding.assetId) ||
        action.referenceBinding.shotApprovalStatus !== "APPROVED" ||
        action.costAuthority.unit !== ({ RUNWAY: "RUNWAY_CREDITS", VEO: "USD_CENTS", GOOGLE_GENAI: "MICRO_USD" } as const)[action.resolvedProvider] ||
        action.costAuthority.modeledValue > action.costAuthority.maxModeledValue) throw planError("Generation reference or cost authority is inconsistent.");
    const reference = plan.inputBinding.referenceBindings.find(row => row.shotId === action.shotId && row.assetId === action.referenceBinding.assetId);
    requireSameBinding(reference ?? null, action.referenceBinding);
  } else {
    requireSameBinding([action.reservationId, action.durableProvider, action.reservationSha256, action.submissionSha256, action.providerExecutionIdentitySha256],
      [observed.reservationId, observed.durableProvider, observed.reservationSha256, observed.submissionSha256, observed.providerExecutionIdentitySha256]);
  }
  const adopted = new Set<string>();
  for (const adoption of plan.evidenceAdoptions) {
    const observation = plan.observations.find(row => row.target.shotId === adoption.target.shotId);
    if (!observation || !["SUBMITTED", "COMPLETED"].includes(observation.lifecycle) || adopted.has(adoption.target.shotId)) throw planError("Invalid evidence adoption.");
    requireSameBinding(observation.target, adoption.target);
    if (bindingDigest(observation) !== adoption.observationSha256) throw planError("Evidence adoption hash does not match.");
    const manifest = plan.inputBinding.fileBindings.find(row => row.role === "MANIFEST");
    if (manifest?.rawSha256 !== adoption.manifestRawSha256) throw planError("Evidence adoption manifest does not match.");
    adopted.add(adoption.target.shotId);
  }
  return freezeBoundCopy(plan);
}

// Canonical id schemas are reused exactly as C6b validates each kind.
const VisualGenerateActionSchema =
  z.object({
    kind:
      z.literal(
        "VISUAL_GENERATE",
      ),
    sceneId:
      DialogueReservationSceneIdSchema,
    shotId:
      ExecutionReservationShotIdSchema,
    confirmPaidGeneration:
      z.literal(
        true,
      ),
  })
    .strict();

const VisualReconcileActionSchema =
  z.object({
    kind:
      z.literal(
        "VISUAL_RECONCILE",
      ),
    sceneId:
      DialogueReservationSceneIdSchema,
    shotId:
      ExecutionReservationShotIdSchema,
    confirmReconciliation:
      z.literal(
        true,
      ),
  })
    .strict();

const DialogueGenerateActionSchema =
  z.object({
    kind:
      z.literal(
        "DIALOGUE_GENERATE",
      ),
    sceneId:
      DialogueReservationSceneIdSchema,
    shotId:
      DialogueReservationShotIdSchema,
    dialogueLineId:
      DialogueReservationLineIdSchema,
    confirmPaidGeneration:
      z.literal(
        true,
      ),
  })
    .strict();

const DialogueReconcileActionSchema =
  z.object({
    kind:
      z.literal(
        "DIALOGUE_RECONCILE",
      ),
    sceneId:
      DialogueReservationSceneIdSchema,
    shotId:
      DialogueReservationShotIdSchema,
    dialogueLineId:
      DialogueReservationLineIdSchema,
    confirmReconciliation:
      z.literal(
        true,
      ),
  })
    .strict();

const EpisodeAutomationPlanSchema =
  z.object({
    schemaVersion:
      z.literal(
        "1.0",
      ),
    episodeId:
      ExecutionReservationEpisodeIdSchema,
    actions:
      z.array(
        z.discriminatedUnion(
          "kind",
          [
            VisualGenerateActionSchema,
            VisualReconcileActionSchema,
            DialogueGenerateActionSchema,
            DialogueReconcileActionSchema,
          ],
        ),
      )
        .min(
          1,
        )
        .max(
          MAX_EPISODE_AUTOMATION_ACTIONS,
        ),
  })
    .strict();

// Rule names only; never input values or unknown field names.
const ISSUE_RULES:
  Readonly<Record<string, string>> =
    Object.freeze({
      invalid_type:
        "has the wrong type or is missing",
      invalid_value:
        "is not an allowed value",
      invalid_format:
        "has an invalid format",
      invalid_union:
        "is not one of the four supported action shapes",
      unrecognized_keys:
        "contains unsupported fields",
      too_small:
        "is empty or too small",
      too_big:
        "exceeds the allowed size",
    });

function describePath(
  path:
    readonly PropertyKey[],
): string {
  if (
    path.length ===
    0
  ) {
    return "plan";
  }

  return path
    .map(
      (segment) =>
        typeof segment ===
          "number"
          ? `[${segment}]`
          : `.${String(segment)}`,
    )
    .join(
      "",
    )
    .replace(
      /^\./,
      "",
    );
}

function planError(
  detail:
    string,
): Error {
  return new Error(
    `Episode automation plan is invalid: ${detail}`,
  );
}

function schemaError(
  error:
    z.ZodError,
): Error {
  const details =
    error.issues
      .slice(
        0,
        5,
      )
      .map(
        (issue) =>
          `${describePath(issue.path)} ${ISSUE_RULES[issue.code] ?? "is invalid"}`,
      );

  const more =
    error.issues.length >
    details.length
      ? ` (+${error.issues.length - details.length} more)`
      : "";

  return planError(
    `${details.join("; ")}${more}.`,
  );
}

function axisOf(
  action:
    EpisodeCoordinatorAction,
): "VISUAL" | "DIALOGUE" {
  return action.kind ===
      "VISUAL_GENERATE" ||
    action.kind ===
      "VISUAL_RECONCILE"
    ? "VISUAL"
    : "DIALOGUE";
}

// The target an action addresses on its axis (a dialogue line for dialogue).
function targetKey(
  action:
    EpisodeCoordinatorAction,
): string {
  return JSON.stringify(
    action.kind ===
      "DIALOGUE_GENERATE" ||
    action.kind ===
      "DIALOGUE_RECONCILE"
      ? [
          "DIALOGUE",
          action.sceneId,
          action.shotId,
          action.dialogueLineId,
        ]
      : [
          "VISUAL",
          action.sceneId,
          action.shotId,
        ],
  );
}

function copyAction(
  action:
    EpisodeCoordinatorAction,
): EpisodeCoordinatorAction {
  switch (
    action.kind
  ) {
    case "VISUAL_GENERATE":
      return Object.freeze({
        kind:
          action.kind,
        sceneId:
          action.sceneId,
        shotId:
          action.shotId,
        confirmPaidGeneration:
          true,
      });

    case "VISUAL_RECONCILE":
      return Object.freeze({
        kind:
          action.kind,
        sceneId:
          action.sceneId,
        shotId:
          action.shotId,
        confirmReconciliation:
          true,
      });

    case "DIALOGUE_GENERATE":
      return Object.freeze({
        kind:
          action.kind,
        sceneId:
          action.sceneId,
        shotId:
          action.shotId,
        dialogueLineId:
          action.dialogueLineId,
        confirmPaidGeneration:
          true,
      });

    case "DIALOGUE_RECONCILE":
      return Object.freeze({
        kind:
          action.kind,
        sceneId:
          action.sceneId,
        shotId:
          action.shotId,
        dialogueLineId:
          action.dialogueLineId,
        confirmReconciliation:
          true,
      });
  }
}

// Pure, complete structural validation. Runtime admissibility is NOT checked
// here: that is C6b's responsibility for each action when it is reached.
export function parseEpisodeAutomationPlan(
  input:
    unknown,
): EpisodeAutomationPlan {
  if (input !== null && typeof input === "object" && "schemaVersion" in input && input.schemaVersion === "2.0") {
    return parseControlledPlan(input);
  }
  const parsed =
    EpisodeAutomationPlanSchema
      .safeParse(
        input,
      );

  if (!parsed.success) {
    throw schemaError(
      parsed.error,
    );
  }

  const {
    episodeId,
  } = parsed.data;

  const actions:
    EpisodeCoordinatorAction[] =
      parsed.data.actions.map(
        copyAction,
      );

  const sceneByShot =
    new Map<string, string>();

  const seenActions =
    new Set<string>();

  const reconciledTargets =
    new Set<string>();

  actions.forEach(
    (
      action,
      index,
    ) => {
      const position =
        `actions[${index}]`;

      if (
        (
          action.kind ===
            "DIALOGUE_GENERATE" ||
          action.kind ===
            "DIALOGUE_RECONCILE"
        ) &&
        !dialogueReservationIdentityMatches(
          episodeId,
          action.sceneId,
          action.shotId,
          action.dialogueLineId,
        )
      ) {
        throw planError(
          `${position}.dialogueLineId does not belong to the plan episode and the action's scene and shot.`,
        );
      }

      const knownScene =
        sceneByShot.get(
          action.shotId,
        );

      if (
        knownScene !==
          undefined &&
        knownScene !==
          action.sceneId
      ) {
        throw planError(
          `${position} assigns shot ${action.shotId} to a different scene than an earlier action.`,
        );
      }

      sceneByShot.set(
        action.shotId,
        action.sceneId,
      );

      const target =
        targetKey(
          action,
        );

      const identity =
        `${action.kind}:${target}`;

      if (
        seenActions.has(
          identity,
        )
      ) {
        throw planError(
          `${position} duplicates an earlier ${action.kind} action for the same target.`,
        );
      }

      seenActions.add(
        identity,
      );

      if (
        action.kind ===
          "VISUAL_RECONCILE" ||
        action.kind ===
          "DIALOGUE_RECONCILE"
      ) {
        reconciledTargets.add(
          target,
        );
      } else if (
        reconciledTargets.has(
          target,
        )
      ) {
        throw planError(
          `${position} requests ${axisOf(action)} generation after a reconciliation of the same target; generation must precede reconciliation.`,
        );
      }
    },
  );

  return Object.freeze({
    schemaVersion:
      "1.0",
    episodeId,
    actions:
      Object.freeze(
        actions,
      ),
  });
}
