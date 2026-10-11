import type {
  DialogueCompositionAudioPlan,
} from "./buildDialogueCompositionAudioPlan.js";

import type {
  ShotDialoguePlan,
} from "./buildShotDialoguePlan.js";

import {
  prepareVerifiedDialogueCompositionAudioPlan,
} from "./prepareVerifiedDialogueCompositionAudioPlan.js";

import {
  readLatestDialoguePlacementDecision,
} from "./readDialoguePlacementDecision.js";

export type ResolveDurableDialogueCompositionAudioPlanInput =
  Readonly<{
    mediaRoot:
      string;

    ffprobeExecutable:
      string;

    dialoguePlan:
      ShotDialoguePlan;
  }>;

export type ResolveDurableDialogueCompositionAudioPlanDependencies =
  Readonly<{
    readLatestDecision:
      typeof readLatestDialoguePlacementDecision;

    prepareAudioPlan:
      typeof prepareVerifiedDialogueCompositionAudioPlan;
  }>;

const defaultDependencies:
  ResolveDurableDialogueCompositionAudioPlanDependencies =
    Object.freeze({
      readLatestDecision:
        readLatestDialoguePlacementDecision,

      prepareAudioPlan:
        prepareVerifiedDialogueCompositionAudioPlan,
    });

export async function resolveDurableDialogueCompositionAudioPlan(
  input:
    ResolveDurableDialogueCompositionAudioPlanInput,
  dependencies:
    ResolveDurableDialogueCompositionAudioPlanDependencies =
      defaultDependencies,
): Promise<
  DialogueCompositionAudioPlan
> {
  const {
    dialoguePlan,
  } = input;

  const shotIdentity =
    `${dialoguePlan.episodeId}/${dialoguePlan.sceneId}/${dialoguePlan.shotId}`;

  // Reader integrity failures propagate unchanged: corruption is not absence.
  const decision =
    await dependencies
      .readLatestDecision(
        input.mediaRoot,
        dialoguePlan.episodeId,
        dialoguePlan.sceneId,
        dialoguePlan.shotId,
      );

  if (!decision) {
    throw new Error(
      `Durable dialogue composition requires a placement decision for ${shotIdentity}; none exists.`,
    );
  }

  const decisionLabel =
    `Durable dialogue placement decision revision ${decision.revision} for ${shotIdentity}`;

  // Cheap canonical checks run before the expensive timing/ffprobe pass.
  if (
    decision.dialoguePlanKey !==
    dialoguePlan.planKey
  ) {
    throw new Error(
      `${decisionLabel} is stale: dialoguePlanKey ${decision.dialoguePlanKey} does not match current canonical plan key ${dialoguePlan.planKey}.`,
    );
  }

  if (
    decision.placements.length !==
      dialoguePlan.lines.length ||
    decision.placements.some(
      (
        placement,
        index,
      ) =>
        placement.dialogueLineId !==
        dialoguePlan.lines[
          index
        ]?.dialogueLineId,
    )
  ) {
    throw new Error(
      `${decisionLabel} does not cover the canonical dialogue lines in order.`,
    );
  }

  // The helper owns the single fresh timing pass and re-applies the current
  // placement and composition rules to the durable human start times.
  const audioPlan =
    await dependencies
      .prepareAudioPlan({
        mediaRoot:
          input.mediaRoot,

        ffprobeExecutable:
          input.ffprobeExecutable,

        dialoguePlan,

        placements:
          decision.placements.map(
            ({
              dialogueLineId,
              startSeconds,
            }) => ({
              dialogueLineId,
              startSeconds,
            }),
          ),
      });

  if (
    audioPlan.lines.length !==
    decision.placements.length
  ) {
    throw new Error(
      `${decisionLabel} could not be confirmed fresh: verified audio covers ${audioPlan.lines.length} lines, expected ${decision.placements.length}.`,
    );
  }

  decision.placements.forEach(
    (
      placement,
      index,
    ) => {
      const verifiedLine =
        audioPlan.lines[
          index
        ];

      if (
        verifiedLine?.dialogueLineId !==
        placement.dialogueLineId
      ) {
        throw new Error(
          `${decisionLabel} could not be confirmed fresh: verified audio line order does not match durable line ${placement.dialogueLineId}.`,
        );
      }

      if (
        verifiedLine.sourceSha256 !==
        placement.sourceSha256
      ) {
        throw new Error(
          `${decisionLabel} is stale: source audio changed for ${placement.dialogueLineId} (stored ${placement.sourceSha256}, verified ${verifiedLine.sourceSha256}).`,
        );
      }
    },
  );

  return audioPlan;
}
