import {
  classifyDialogueLifecycle,
  type DialogueLifecycleClassification,
} from "./classifyDialogueLifecycle.js";

import {
  readDialogueDirectSeedAudioCompletion,
} from "./readDialogueDirectSeedAudioCompletion.js";

import {
  readDialogueDirectSeedAudioReservation,
} from "./readDialogueDirectSeedAudioReservation.js";

import {
  readDialogueDirectSeedAudioSubmission,
} from "./readDialogueDirectSeedAudioSubmission.js";

export type InspectDialogueDirectSeedAudioLifecycleDependencies =
  Readonly<{
    readReservation:
      typeof readDialogueDirectSeedAudioReservation;

    readSubmission:
      typeof readDialogueDirectSeedAudioSubmission;

    readCompletion:
      typeof readDialogueDirectSeedAudioCompletion;

    classifyLifecycle:
      typeof classifyDialogueLifecycle;
  }>;

const defaultDependencies:
  InspectDialogueDirectSeedAudioLifecycleDependencies =
    Object.freeze({
      readReservation:
        readDialogueDirectSeedAudioReservation,

      readSubmission:
        readDialogueDirectSeedAudioSubmission,

      readCompletion:
        readDialogueDirectSeedAudioCompletion,

      classifyLifecycle:
        classifyDialogueLifecycle,
    });

export async function inspectDialogueDirectSeedAudioLifecycle(
  mediaRoot:
    string,

  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,

  dialogueLineId:
    string,

  planKey:
    string,

  dependencies:
    InspectDialogueDirectSeedAudioLifecycleDependencies =
      defaultDependencies,
): Promise<
  DialogueLifecycleClassification
> {
  const reservation =
    await dependencies
      .readReservation(
        mediaRoot,
        episodeId,
        sceneId,
        shotId,
        dialogueLineId,
        planKey,
      );

  const submission =
    await dependencies
      .readSubmission(
        mediaRoot,
        episodeId,
        sceneId,
        shotId,
        dialogueLineId,
        planKey,
      );

  const completion =
    await dependencies
      .readCompletion(
        mediaRoot,
        episodeId,
        sceneId,
        shotId,
        dialogueLineId,
        planKey,
      );

  return dependencies
    .classifyLifecycle({
      reservation,
      submission,
      completion,
    });
}
