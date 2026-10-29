export { EpisodeActionPostStateResolutionError } from "./boundEpisodeProduction.types.js";
import { EpisodeActionPostStateResolutionError } from "./boundEpisodeProduction.types.js";
import { BoundEpisodeError, BoundEpisodeActionError, freezeBoundCopy, requireSameBinding,
  type BoundEpisodeActionResult, type BoundVisualAction, type BoundEpisodePreflight, type IssueCode } from "./boundEpisodeProduction.types.js";
import { checkedEpisodeExecutionData, assertCheckedEpisodeAdmission, admitEpisodeCoordinatorDispatch,
  episodeInvocationCounts, type CheckedEpisodeExecutionContext } from "./episodeExecutionGuard.js";
import { episodeIssue, readSelectedVisualPostObservation } from "./buildBoundEpisodePreflight.js";
import {
  runDialogueGenerationCli,
} from "../dialogue/cli/runDialogueGenerationCli.js";

import {
  runDialogueReconcileCli,
} from "../dialogue/cli/runDialogueReconcileCli.js";

import {
  DialogueReservationEpisodeIdSchema,
  DialogueReservationLineIdSchema,
  DialogueReservationSceneIdSchema,
  DialogueReservationShotIdSchema,
  dialogueReservationIdentityMatches,
} from "../dialogue/dialogueReservation.schema.js";

import {
  loadCharacterBible,
} from "../validation/loadCharacterBible.js";

import {
  loadEnvironment,
} from "../validation/loadEnvironment.js";

import {
  loadEpisodeManifest,
} from "../validation/loadEpisodeManifest.js";

import {
  loadProductionRules,
} from "../validation/loadProductionRules.js";

import {
  loadProviderRoutingPolicy,
} from "../validation/loadProviderRoutingPolicy.js";

import {
  resolveAndValidateMediaRootPath,
} from "../validation/validateMediaRoot.js";

import {
  runProductionExecutionReconcileCli,
} from "./cli/runProductionExecutionReconcileCli.js";

import {
  runSingleShotExecutionCli,
} from "./cli/runSingleShotExecutionCli.js";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "./executionReservation.schema.js";

import {
  resolveDurableEpisodeProductionState,
  type DurableEpisodeProductionState,
  type DurableEpisodeShotProductionState,
  type ResolveDurableEpisodeProductionStateInput,
} from "./resolveDurableEpisodeProductionState.js";

// C6b guarded coordinator: exactly one explicitly requested, explicitly
// confirmed action per invocation, admitted only from the current C4 state
// and executed only through an existing secured runner. C4 is read, never a
// lock; the runners' own durable guards (and C6a for dialogue generation)
// remain the race backstops.

export type EpisodeCoordinatorAction =
  | Readonly<{
      kind: "VISUAL_GENERATE";
      sceneId: string;
      shotId: string;
      confirmPaidGeneration: true;
    }>
  | Readonly<{
      kind: "VISUAL_RECONCILE";
      sceneId: string;
      shotId: string;
      confirmReconciliation: true;
    }>
  | Readonly<{
      kind: "DIALOGUE_GENERATE";
      sceneId: string;
      shotId: string;
      dialogueLineId: string;
      confirmPaidGeneration: true;
    }>
  | Readonly<{
      kind: "DIALOGUE_RECONCILE";
      sceneId: string;
      shotId: string;
      dialogueLineId: string;
      confirmReconciliation: true;
    }>;

export type CoordinateEpisodeActionInput =
  Readonly<{
    episodeId: string;
    action: EpisodeCoordinatorAction;
  }>;
export type CoordinateBoundEpisodeActionInput = Readonly<{
  episodeId: string; action: BoundVisualAction; controlledContext: CheckedEpisodeExecutionContext;
}>;

export type EpisodeCoordinatorRunner =
  | "runSingleShotExecutionCli"
  | "runProductionExecutionReconcileCli"
  | "runDialogueGenerationCli"
  | "runDialogueReconcileCli";

export type CoordinateEpisodeActionResult =
  Readonly<{
    episodeId: string;
    action: EpisodeCoordinatorAction;
    runner: EpisodeCoordinatorRunner;
    beforeState: DurableEpisodeProductionState;
    afterState: DurableEpisodeProductionState;
  }>;

export type CoordinateEpisodeActionDependencies =
  Readonly<{
    loadEnvironment:
      typeof loadEnvironment;

    loadProductionRules:
      typeof loadProductionRules;

    loadCharacterBible:
      typeof loadCharacterBible;

    loadEpisodeManifest:
      typeof loadEpisodeManifest;

    loadProviderRoutingPolicy:
      typeof loadProviderRoutingPolicy;

    // Read-only path validation; validateMediaRoot would create directories
    // and write a probe file.
    resolveMediaRoot:
      typeof resolveAndValidateMediaRootPath;

    resolveEpisodeProductionState:
      typeof resolveDurableEpisodeProductionState;

    runSingleShotExecutionCli:
      typeof runSingleShotExecutionCli;

    runProductionExecutionReconcileCli:
      typeof runProductionExecutionReconcileCli;

    runDialogueGenerationCli:
      typeof runDialogueGenerationCli;

    runDialogueReconcileCli:
      typeof runDialogueReconcileCli;
  }>;

export const episodeCoordinatorProductionDependencies:
  CoordinateEpisodeActionDependencies =
    Object.freeze({
      loadEnvironment,
      loadProductionRules,
      loadCharacterBible,
      loadEpisodeManifest,
      loadProviderRoutingPolicy,

      resolveMediaRoot:
        resolveAndValidateMediaRootPath,

      resolveEpisodeProductionState:
        resolveDurableEpisodeProductionState,

      runSingleShotExecutionCli,
      runProductionExecutionReconcileCli,
      runDialogueGenerationCli,
      runDialogueReconcileCli,
    });
const defaultDependencies = episodeCoordinatorProductionDependencies;

// Only for: the secured runner resolved, then the post-action C4 resolution
// threw. The action has happened; no after-state exists.
// Runtime gate (callers can bypass the TypeScript literal types): a known
// kind and its literal-true confirmation, before any parsing or I/O. Returns
// a frozen copy of only the locked fields.
function requireConfirmedAction(
  action:
    unknown,
): EpisodeCoordinatorAction {
  if (
    typeof action !==
      "object" ||
    action ===
      null
  ) {
    throw new Error(
      "Episode coordinator requires exactly one action object.",
    );
  }

  const candidate =
    action as Record<string, unknown>;

  switch (
    candidate.kind
  ) {
    case "VISUAL_GENERATE":
      if (
        candidate.confirmPaidGeneration !==
        true
      ) {
        throw new Error(
          "VISUAL_GENERATE requires confirmPaidGeneration === true.",
        );
      }

      return Object.freeze({
        kind:
          "VISUAL_GENERATE",
        sceneId:
          candidate.sceneId as string,
        shotId:
          candidate.shotId as string,
        confirmPaidGeneration:
          true,
      });

    case "VISUAL_RECONCILE":
      if (
        candidate.confirmReconciliation !==
        true
      ) {
        throw new Error(
          "VISUAL_RECONCILE requires confirmReconciliation === true.",
        );
      }

      return Object.freeze({
        kind:
          "VISUAL_RECONCILE",
        sceneId:
          candidate.sceneId as string,
        shotId:
          candidate.shotId as string,
        confirmReconciliation:
          true,
      });

    case "DIALOGUE_GENERATE":
      if (
        candidate.confirmPaidGeneration !==
        true
      ) {
        throw new Error(
          "DIALOGUE_GENERATE requires confirmPaidGeneration === true.",
        );
      }

      return Object.freeze({
        kind:
          "DIALOGUE_GENERATE",
        sceneId:
          candidate.sceneId as string,
        shotId:
          candidate.shotId as string,
        dialogueLineId:
          candidate.dialogueLineId as string,
        confirmPaidGeneration:
          true,
      });

    case "DIALOGUE_RECONCILE":
      if (
        candidate.confirmReconciliation !==
        true
      ) {
        throw new Error(
          "DIALOGUE_RECONCILE requires confirmReconciliation === true.",
        );
      }

      return Object.freeze({
        kind:
          "DIALOGUE_RECONCILE",
        sceneId:
          candidate.sceneId as string,
        shotId:
          candidate.shotId as string,
        dialogueLineId:
          candidate.dialogueLineId as string,
        confirmReconciliation:
          true,
      });

    default:
      throw new Error(
        `Unsupported episode coordinator action kind: ${String(candidate.kind)}.`,
      );
  }
}

// Existing schemas only: the visual runner's execution ids, the dialogue
// runners' reservation ids and line identity rule. Rejects "--flag" values.
function requireValidTarget(
  episodeId:
    string,

  action:
    EpisodeCoordinatorAction,
): void {
  DialogueReservationSceneIdSchema
    .parse(
      action.sceneId,
    );

  switch (
    action.kind
  ) {
    case "VISUAL_GENERATE":
    case "VISUAL_RECONCILE":
      ExecutionReservationEpisodeIdSchema
        .parse(
          episodeId,
        );

      ExecutionReservationShotIdSchema
        .parse(
          action.shotId,
        );

      return;

    case "DIALOGUE_GENERATE":
    case "DIALOGUE_RECONCILE":
      DialogueReservationEpisodeIdSchema
        .parse(
          episodeId,
        );

      DialogueReservationShotIdSchema
        .parse(
          action.shotId,
        );

      DialogueReservationLineIdSchema
        .parse(
          action.dialogueLineId,
        );

      if (
        !dialogueReservationIdentityMatches(
          episodeId,
          action.sceneId,
          action.shotId,
          action.dialogueLineId,
        )
      ) {
        throw new Error(
          `Dialogue line ${action.dialogueLineId} does not belong to ${episodeId}/${action.sceneId}/${action.shotId}.`,
        );
      }

      return;
  }
}

function requireTargetShot(
  state:
    DurableEpisodeProductionState,

  action:
    EpisodeCoordinatorAction,
): DurableEpisodeShotProductionState {
  const matches =
    state.shots.filter(
      (shot) =>
        shot.shotId ===
          action.shotId &&
        shot.sceneId ===
          action.sceneId,
    );

  const [
    shot,
  ] = matches;

  if (
    shot ===
      undefined ||
    matches.length !==
      1
  ) {
    throw new Error(
      `Episode ${state.episodeId} has no exact durable shot ${action.sceneId}/${action.shotId}.`,
    );
  }

  return shot;
}

function notAdmitted(
  episodeId:
    string,

  action:
    EpisodeCoordinatorAction,

  axisState:
    string,

  detail =
    "",
): Error {
  return new Error(
    `${action.kind} is not admitted for ${episodeId}/${action.sceneId}/${action.shotId}: current state is ${axisState}${detail}.`,
  );
}

// Exactly one admission per kind; each kind reads only its own axis.
async function runAdmittedAction(
  dependencies:
    CoordinateEpisodeActionDependencies,

  episodeId:
    string,

  action:
    Exclude<EpisodeCoordinatorAction, { kind: "VISUAL_GENERATE" | "VISUAL_RECONCILE" }>,

  shot:
    DurableEpisodeShotProductionState,
): Promise<EpisodeCoordinatorRunner> {
  const visual =
    shot.visualGenerationState;

  const dialogue =
    shot.dialogueCompositionState;

  switch (
    action.kind
  ) {
    case "DIALOGUE_GENERATE":
      if (
        dialogue.state !==
        "DIALOGUE_AUDIO_REQUIRED"
      ) {
        throw notAdmitted(
          episodeId,
          action,
          dialogue.state,
        );
      }

      if (
        !dialogue.missingLineIds.includes(
          action.dialogueLineId,
        )
      ) {
        throw notAdmitted(
          episodeId,
          action,
          dialogue.state,
          ` and ${action.dialogueLineId} is not a missing line`,
        );
      }

      await dependencies
        .runDialogueGenerationCli([
          "--episode",
          episodeId,
          "--scene",
          action.sceneId,
          "--shot",
          action.shotId,
          "--line",
          action.dialogueLineId,
          "--confirm-paid-generation",
        ]);

      return "runDialogueGenerationCli";

    case "DIALOGUE_RECONCILE":
      if (
        dialogue.state !==
        "DIALOGUE_RECONCILIATION_REQUIRED"
      ) {
        throw notAdmitted(
          episodeId,
          action,
          dialogue.state,
        );
      }

      if (
        !dialogue.submittedLineIds.includes(
          action.dialogueLineId,
        )
      ) {
        throw notAdmitted(
          episodeId,
          action,
          dialogue.state,
          ` and ${action.dialogueLineId} is not a submitted line`,
        );
      }

      await dependencies
        .runDialogueReconcileCli([
          "--episode",
          episodeId,
          "--scene",
          action.sceneId,
          "--shot",
          action.shotId,
          "--line",
          action.dialogueLineId,
        ]);

      return "runDialogueReconcileCli";
  }
}

export function coordinateEpisodeAction(input: CoordinateBoundEpisodeActionInput,
  dependencies?: CoordinateEpisodeActionDependencies): Promise<BoundEpisodeActionResult>;
export function coordinateEpisodeAction(input: CoordinateEpisodeActionInput,
  dependencies?: CoordinateEpisodeActionDependencies): Promise<CoordinateEpisodeActionResult>;
export async function coordinateEpisodeAction(
  input:
    CoordinateEpisodeActionInput | CoordinateBoundEpisodeActionInput,

  dependencies:
    CoordinateEpisodeActionDependencies =
      defaultDependencies,
): Promise<CoordinateEpisodeActionResult | BoundEpisodeActionResult> {
  if ("controlledContext" in input) return coordinateBoundEpisodeAction(input, dependencies);
  // 1. Known kind + literal-true confirmation, before anything else.
  const action =
    requireConfirmedAction(
      input.action,
    );

  const episodeId =
    input.episodeId;

  // 2. Target ids with the existing schemas, still before any I/O.
  requireValidTarget(
    episodeId,
    action,
  );

  if (action.kind === "VISUAL_GENERATE" || action.kind === "VISUAL_RECONCILE") {
    throw new BoundEpisodeError("LEGACY_VISUAL_PLAN_REQUIRES_CONVERSION");
  }

  // 3. Canonical read-only inputs, as execution:status loads them.
  const env =
    dependencies
      .loadEnvironment();

  const [
    rules,
    bible,
    episode,
    policy,
  ] =
    await Promise.all([
      dependencies
        .loadProductionRules(),

      dependencies
        .loadCharacterBible(),

      dependencies
        .loadEpisodeManifest(
          episodeId,
        ),

      dependencies
        .loadProviderRoutingPolicy(),
    ]);

  if (
    episode.episodeId !==
    episodeId
  ) {
    throw new Error(
      `Loaded episode identity ${episode.episodeId} does not match the requested episode ${episodeId}.`,
    );
  }

  const stateInput:
    ResolveDurableEpisodeProductionStateInput =
      Object.freeze({
        episode,
        bible,
        rules,
        policy,

        mediaRoot:
          dependencies
            .resolveMediaRoot(
              env,
              rules,
            ),

        ffprobeExecutable:
          env.BUSYBOOKIE_FFPROBE_PATH
            ?.trim() ||
          "ffprobe",
      });

  // 4. The sole state authority, once before the action.
  const beforeState =
    await dependencies
      .resolveEpisodeProductionState(
        stateInput,
      );

  const shot =
    requireTargetShot(
      beforeState,
      action,
    );

  // 5. Exactly one secured runner; its failure propagates unchanged.
  const runner =
    await runAdmittedAction(
      dependencies,
      episodeId,
      action,
      shot,
    );

  // 6. Exactly one post-action resolution from the same canonical input.
  let afterState:
    DurableEpisodeProductionState;

  try {
    afterState =
      await dependencies
        .resolveEpisodeProductionState(
          stateInput,
        );
  } catch (error) {
    throw new EpisodeActionPostStateResolutionError({
      episodeId,
      action,
      runner,
      cause:
        error,
    });
  }

  return Object.freeze({
    episodeId,
    action,
    runner,
    beforeState,
    afterState,
  });
}

async function coordinateBoundEpisodeAction(input: CoordinateBoundEpisodeActionInput,
  dependencies: CoordinateEpisodeActionDependencies): Promise<BoundEpisodeActionResult> {
  const data = checkedEpisodeExecutionData(input.controlledContext);
  requireSameBinding(input.action, data.plan.actions[0]);
  if (input.episodeId !== data.plan.episodeId) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
  const action = data.plan.actions[0];
  // Known exact kind, literal confirmation and target before I/O.
  requireConfirmedAction(action); requireValidTarget(input.episodeId, action);
  const target = { episodeId: action.episodeId, sceneId: action.sceneId, shotId: action.shotId, order: action.order };
  let before = data.beforePlan;
  const preflightInput = { episodeId: input.episodeId, scope: data.plan.scope,
    mediaRoot: data.plan.inputBinding.runtimeIdentity.mediaRoot, runtimeIdentity: data.plan.inputBinding.runtimeIdentity,
    evidenceAdoptions: data.plan.evidenceAdoptions,
    ...(data.plan.inputBinding.runtimeIdentity.ffprobe ? { ffprobeExecutable: data.plan.inputBinding.runtimeIdentity.ffprobe.canonicalPath } : {}) };
  try {
    await assertCheckedEpisodeAdmission(input.controlledContext);
    before = await data.preflight({ ...preflightInput, expectedBinding: data.plan.inputBinding });
    admitEpisodeCoordinatorDispatch(data.invocation);
  } catch (cause) {
    if (!(cause instanceof BoundEpisodeError)) throw cause;
    return freezeBoundCopy({ episodeId: input.episodeId, action, beforePlan: before, afterPlan: null, status: "REJECTED",
      stopReason: cause.code, ...episodeInvocationCounts(data.invocation), observedNewCreateCount: 0,
      visualCompletion: before.completion, handoff: before.handoff, remainingWork: before.remainingWork,
      actionMayHaveEffects: false, issues: [episodeIssue(cause.code, target, "ADMISSION", cause)] });
  }
  let lowerCause: unknown; let lowerFailed = false;
  try {
    if (action.kind === "VISUAL_GENERATE") {
      await dependencies.runSingleShotExecutionCli(["--episode", action.episodeId, "--shot", action.shotId,
        "--image", action.referenceBinding.canonicalAbsolutePath, "--confirm-paid-generation"], undefined, input.controlledContext);
    } else {
      await dependencies.runProductionExecutionReconcileCli(["--episode", action.episodeId, "--shot", action.shotId], undefined, input.controlledContext);
    }
  } catch (cause) { lowerCause = cause; lowerFailed = true; }
  // Always attempt observation after the runner settles, including throws.
  // Omit expectedBinding so drift can be reported alongside useful fresh
  // durable evidence instead of preventing that evidence from being read.
  let after: BoundEpisodePreflight | null = null; let postCause: unknown;
  try { after = await data.preflight(preflightInput); }
  catch (cause) { postCause = cause; }
  const counts = episodeInvocationCounts(data.invocation);
  const effects = counts.dispatchAllowanceConsumed === 1 || counts.recoveryDispatchCount === 1;
  const row = after?.shots.find(row => row.shotId === action.shotId && row.sceneId === action.sceneId);
  let selectedPostObservation = row?.lifecycle ?? null;
  let selectedObservationCause: unknown;
  if (!row) {
    try { selectedPostObservation = await readSelectedVisualPostObservation(preflightInput.mediaRoot, target); }
    catch (cause) { selectedObservationCause = cause; }
  }
  let status: BoundEpisodeActionResult["status"] = "UNRESOLVED";
  let stopReason: IssueCode | null = "POST_ACTION_STATE_UNRESOLVED";
  if (after?.bindingSha256 !== data.plan.inputBindingSha256 && after !== null) stopReason = "INPUT_BINDING_DRIFT";
  else if (row?.completionVerification === "FAILED") stopReason = "LOCAL_COMPLETION_VERIFICATION_FAILED";
  else if (row?.disposition === "COMPLETED" && row.completionVerification === "VERIFIED") {
    status = lowerFailed ? "STOPPED" : "ACTION_COMPLETED";
    stopReason = lowerFailed ? "ACTION_REJECTED" : action.kind === "VISUAL_GENERATE" && after?.completion === "INCOMPLETE" ? "MAX_CREATE_COUNT_REACHED" : null;
  } else if (row?.lifecycle.lifecycle === "SUBMITTED") { status = "STOPPED"; stopReason = "SUBMITTED_RECOVERY_REQUIRED"; }
  else if (row?.lifecycle.lifecycle === "RESERVED_ONLY") {
    status = "STOPPED"; stopReason = action.kind === "VISUAL_GENERATE" ? "RESERVED_ONLY_MANUAL_ADJUDICATION" : "INVALID_DURABLE_STATE";
  } else if (row?.lifecycle.lifecycle === "NOTHING") {
    status = "REJECTED"; stopReason = action.kind === "VISUAL_RECONCILE" ? "INVALID_DURABLE_STATE"
      : lowerFailed ? "ACTION_REJECTED" : "UNEXPECTED_PROVIDER_RESULT";
  }
  if (!after?.inventory.complete && status === "ACTION_COMPLETED") { status = "UNRESOLVED"; stopReason = "POST_ACTION_STATE_UNRESOLVED"; }
  const result: BoundEpisodeActionResult = freezeBoundCopy({ episodeId: input.episodeId, action, beforePlan: before,
    afterPlan: after, selectedPostObservation, status, stopReason, ...counts, observedNewCreateCount: counts.dispatchAllowanceConsumed === 0 ? 0 : "UNKNOWN",
    visualCompletion: after?.completion ?? "INCOMPLETE", handoff: after?.handoff ?? before.handoff,
    remainingWork: after?.remainingWork ?? before.remainingWork, actionMayHaveEffects: effects,
    issues: status === "ACTION_COMPLETED" ? [] : [episodeIssue(stopReason ?? "ACTION_REJECTED", target, "POST_ACTION", lowerCause ?? postCause, effects),
      ...(selectedObservationCause === undefined ? [] : [episodeIssue("POST_ACTION_STATE_UNRESOLVED", target, "POST_ACTION", selectedObservationCause, effects)])] });
  if (lowerFailed || postCause !== undefined) throw new BoundEpisodeActionError(result, lowerFailed ? lowerCause : postCause, postCause);
  return result;
}
