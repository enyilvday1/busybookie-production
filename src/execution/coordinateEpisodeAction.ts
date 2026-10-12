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

const defaultDependencies:
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

// Only for: the secured runner resolved, then the post-action C4 resolution
// threw. The action has happened; no after-state exists.
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
    EpisodeCoordinatorAction,

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
    case "VISUAL_GENERATE":
      if (
        visual.state !==
        "READY_FOR_GENERATION"
      ) {
        throw notAdmitted(
          episodeId,
          action,
          visual.state,
        );
      }

      await dependencies
        .runSingleShotExecutionCli([
          "--episode",
          episodeId,
          "--shot",
          action.shotId,
          "--image",
          visual.reference.absolutePath,
          "--confirm-paid-generation",
        ]);

      return "runSingleShotExecutionCli";

    case "VISUAL_RECONCILE":
      if (
        visual.state !==
        "SUBMITTED_RECONCILIATION_REQUIRED"
      ) {
        throw notAdmitted(
          episodeId,
          action,
          visual.state,
        );
      }

      await dependencies
        .runProductionExecutionReconcileCli([
          "--episode",
          episodeId,
          "--shot",
          action.shotId,
        ]);

      return "runProductionExecutionReconcileCli";

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

export async function coordinateEpisodeAction(
  input:
    CoordinateEpisodeActionInput,

  dependencies:
    CoordinateEpisodeActionDependencies =
      defaultDependencies,
): Promise<CoordinateEpisodeActionResult> {
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
