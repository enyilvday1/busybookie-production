import type {
  CharacterBible,
} from "../schemas/character.schema.js";

import type {
  EpisodeManifest,
  Shot,
} from "../schemas/episodeManifest.schema.js";

import type {
  ProviderRoutingPolicy,
} from "../schemas/providerRoutingPolicy.schema.js";

import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

import {
  resolveDurableShotDialogueCompositionState,
  type DurableShotDialogueCompositionState,
} from "../dialogue/resolveDurableShotDialogueCompositionState.js";

import {
  resolveDurableShotVisualGenerationState,
  type DurableShotVisualGenerationState,
} from "./resolveDurableShotVisualGenerationState.js";

export type DurableEpisodeShotProductionState =
  Readonly<{
    order: number;
    sceneId: string;
    shotId: string;
    visualGenerationState: DurableShotVisualGenerationState;
    dialogueCompositionState: DurableShotDialogueCompositionState;
  }>;

export type DurableEpisodeProductionStateSummary =
  Readonly<{
    totalShots: number;
    visualGenerationStates:
      Readonly<Record<DurableShotVisualGenerationState["state"], number>>;
    dialogueCompositionStates:
      Readonly<Record<DurableShotDialogueCompositionState["state"], number>>;
  }>;

export type DurableEpisodeProductionState =
  Readonly<{
    episodeId: string;
    shots: readonly DurableEpisodeShotProductionState[];
    summary: DurableEpisodeProductionStateSummary;
  }>;

export type ResolveDurableEpisodeProductionStateInput =
  Readonly<{
    episode: EpisodeManifest;
    bible: CharacterBible;
    rules: ProductionRules;
    policy: ProviderRoutingPolicy;
    mediaRoot: string;
    ffprobeExecutable: string;
  }>;

export type ResolveDurableEpisodeProductionStateDependencies =
  Readonly<{
    resolveVisualGenerationState:
      typeof resolveDurableShotVisualGenerationState;

    resolveDialogueCompositionState:
      typeof resolveDurableShotDialogueCompositionState;
  }>;

// Both defaults are the read-only C2 and C3 authorities.
const defaultDependencies:
  ResolveDurableEpisodeProductionStateDependencies =
    Object.freeze({
      resolveVisualGenerationState:
        resolveDurableShotVisualGenerationState,

      resolveDialogueCompositionState:
        resolveDurableShotDialogueCompositionState,
    });

// Fixed key order = C2 union declaration order; every key always present.
function emptyVisualGenerationStateCounts():
  Record<DurableShotVisualGenerationState["state"], number> {
  return {
    RESERVED_ONLY_INTERVENTION_REQUIRED: 0,
    SUBMITTED_RECONCILIATION_REQUIRED: 0,
    LIFECYCLE_COMPLETED: 0,
    CANONICAL_NOT_EXECUTABLE: 0,
    VISUAL_AUTHORIZATION_REQUIRED: 0,
    REFERENCE_UNAVAILABLE: 0,
    REFERENCE_SELECTION_REQUIRED: 0,
    READY_FOR_GENERATION: 0,
  };
}

// Fixed key order = C3 union declaration order; every key always present.
function emptyDialogueCompositionStateCounts():
  Record<DurableShotDialogueCompositionState["state"], number> {
  return {
    NO_DIALOGUE: 0,
    DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED: 0,
    DIALOGUE_PLANNING_BLOCKED: 0,
    DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED: 0,
    DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED: 0,
    DIALOGUE_RECONCILIATION_REQUIRED: 0,
    DIALOGUE_AUDIO_REQUIRED: 0,
    PLACEMENT_REQUIRED: 0,
    COMPOSITION_AUDIO_RESOLVED: 0,
  };
}

// Unknown discriminants fail closed instead of adding an unlisted key.
function incrementStateCount<State extends string>(
  counts: Record<State, number>,
  state: State,
): void {
  if (
    !Object.hasOwn(
      counts,
      state,
    )
  ) {
    throw new Error(
      `Unknown durable shot state ${state} cannot be summarised.`,
    );
  }

  counts[state] += 1;
}

type EvaluationAxis =
  | "visual-generation"
  | "dialogue-composition";

// The underlying message is embedded for operator display only; it is never
// inspected, and the original error is kept as the cause.
function wrapEvaluationError(
  episodeId: string,
  sceneId: string,
  shotId: string,
  axis: EvaluationAxis,
  error: unknown,
): Error {
  const detail =
    error instanceof Error
      ? error.message
      : String(error);

  return new Error(
    `Durable episode evaluation failed for ${episodeId}/${sceneId}/${shotId} (${axis}): ${detail}`,
    {
      cause:
        error,
    },
  );
}

type CanonicalShotEntry =
  Readonly<{
    sceneId: string;
    shot: Shot;
  }>;

export async function resolveDurableEpisodeProductionState(
  input:
    ResolveDurableEpisodeProductionStateInput,

  dependencies:
    ResolveDurableEpisodeProductionStateDependencies =
      defaultDependencies,
): Promise<DurableEpisodeProductionState> {
  const episodeId =
    input.episode.episodeId;

  const entries:
    CanonicalShotEntry[] =
      input.episode.scenes.flatMap(
        (scene) =>
          scene.shots.map(
            (shot) => ({
              sceneId:
                scene.id,
              shot,
            }),
          ),
      );

  // Identity and ordering are the two invariants C4 itself relies on; check
  // them before any durable evidence is read.
  const shotIds =
    new Set<string>();

  const shotOrders =
    new Set<number>();

  for (
    const entry
    of entries
  ) {
    if (
      shotIds.has(
        entry.shot.id,
      )
    ) {
      throw new Error(
        `Episode ${episodeId} has duplicate shot id ${entry.shot.id}.`,
      );
    }

    if (
      shotOrders.has(
        entry.shot.order,
      )
    ) {
      throw new Error(
        `Episode ${episodeId} has duplicate shot order ${entry.shot.order}.`,
      );
    }

    shotIds.add(
      entry.shot.id,
    );

    shotOrders.add(
      entry.shot.order,
    );
  }

  const orderedEntries =
    [...entries].sort(
      (
        left,
        right,
      ) =>
        left.shot.order -
        right.shot.order,
    );

  const shots:
    DurableEpisodeShotProductionState[] =
      [];

  // Strictly sequential: both axes of a shot settle before the next shot.
  for (
    const entry
    of orderedEntries
  ) {
    let visualGenerationState:
      DurableShotVisualGenerationState;

    try {
      visualGenerationState =
        await dependencies
          .resolveVisualGenerationState({
            episode:
              input.episode,
            shot:
              entry.shot,
            bible:
              input.bible,
            rules:
              input.rules,
            policy:
              input.policy,
            mediaRoot:
              input.mediaRoot,
          });
    } catch (error) {
      throw wrapEvaluationError(
        episodeId,
        entry.sceneId,
        entry.shot.id,
        "visual-generation",
        error,
      );
    }

    let dialogueCompositionState:
      DurableShotDialogueCompositionState;

    try {
      dialogueCompositionState =
        await dependencies
          .resolveDialogueCompositionState({
            episode:
              input.episode,
            shotId:
              entry.shot.id,
            bible:
              input.bible,
            mediaRoot:
              input.mediaRoot,
            ffprobeExecutable:
              input.ffprobeExecutable,
          });
    } catch (error) {
      throw wrapEvaluationError(
        episodeId,
        entry.sceneId,
        entry.shot.id,
        "dialogue-composition",
        error,
      );
    }

    shots.push(
      Object.freeze({
        order:
          entry.shot.order,
        sceneId:
          entry.sceneId,
        shotId:
          entry.shot.id,
        visualGenerationState,
        dialogueCompositionState,
      }),
    );
  }

  const visualGenerationStates =
    emptyVisualGenerationStateCounts();

  const dialogueCompositionStates =
    emptyDialogueCompositionStateCounts();

  for (
    const shot
    of shots
  ) {
    incrementStateCount(
      visualGenerationStates,
      shot.visualGenerationState.state,
    );

    incrementStateCount(
      dialogueCompositionStates,
      shot.dialogueCompositionState.state,
    );
  }

  return Object.freeze({
    episodeId,
    shots:
      Object.freeze(
        shots,
      ),
    summary:
      Object.freeze({
        totalShots:
          shots.length,
        visualGenerationStates:
          Object.freeze(
            visualGenerationStates,
          ),
        dialogueCompositionStates:
          Object.freeze(
            dialogueCompositionStates,
          ),
      }),
  });
}
