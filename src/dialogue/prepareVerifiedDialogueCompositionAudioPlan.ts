import {
  buildDialogueCompositionAudioPlan,
  type DialogueCompositionAudioPlan,
} from "./buildDialogueCompositionAudioPlan.js";

import {
  buildDialoguePlacementPlan,
  type DialoguePlacementInputLine,
} from "./buildDialoguePlacementPlan.js";

import type {
  ShotDialoguePlan,
} from "./buildShotDialoguePlan.js";

import {
  verifyShotDialogueAudioTiming,
} from "./verifyShotDialogueAudioTiming.js";

export type PrepareVerifiedDialogueCompositionAudioPlanInput =
  Readonly<{
    mediaRoot:
      string;

    ffprobeExecutable:
      string;

    dialoguePlan:
      ShotDialoguePlan;

    placements:
      readonly DialoguePlacementInputLine[];
  }>;

export type PrepareVerifiedDialogueCompositionAudioPlanDependencies =
  Readonly<{
    verifyAudioTiming:
      typeof verifyShotDialogueAudioTiming;

    buildPlacementPlan:
      typeof buildDialoguePlacementPlan;

    buildAudioPlan:
      typeof buildDialogueCompositionAudioPlan;
  }>;

const defaultDependencies:
  PrepareVerifiedDialogueCompositionAudioPlanDependencies =
    Object.freeze({
      verifyAudioTiming:
        verifyShotDialogueAudioTiming,

      buildPlacementPlan:
        buildDialoguePlacementPlan,

      buildAudioPlan:
        buildDialogueCompositionAudioPlan,
    });

export async function prepareVerifiedDialogueCompositionAudioPlan(
  input:
    PrepareVerifiedDialogueCompositionAudioPlanInput,

  dependencies:
    PrepareVerifiedDialogueCompositionAudioPlanDependencies =
      defaultDependencies,
): Promise<
  DialogueCompositionAudioPlan
> {
  const timing =
    await dependencies
      .verifyAudioTiming({
        mediaRoot:
          input.mediaRoot,

        ffprobeExecutable:
          input.ffprobeExecutable,

        plan:
          input.dialoguePlan,
      });

  const placementPlan =
    dependencies
      .buildPlacementPlan({
        dialoguePlan:
          input.dialoguePlan,

        timing,

        placements:
          input.placements,
      });

  return dependencies
    .buildAudioPlan({
      dialoguePlan:
        input.dialoguePlan,

      placementPlan,
    });
}
