import {
  classifyDialogueLifecycle,
  type DialogueLifecycleClassification,
} from "./classifyDialogueLifecycle.js";

import {
  readDialogueCompletion,
} from "./readDialogueCompletion.js";

import {
  readDialogueReservation,
} from "./readDialogueReservation.js";

import {
  readDialogueSubmission,
} from "./readDialogueSubmission.js";

export type InspectDialogueLifecycleDependencies =
  Readonly<{
    readReservation:
      typeof readDialogueReservation;

    readSubmission:
      typeof readDialogueSubmission;

    readCompletion:
      typeof readDialogueCompletion;

    classifyLifecycle:
      typeof classifyDialogueLifecycle;
  }>;

const defaultDependencies:
  InspectDialogueLifecycleDependencies =
    Object.freeze({
      readReservation:
        readDialogueReservation,

      readSubmission:
        readDialogueSubmission,

      readCompletion:
        readDialogueCompletion,

      classifyLifecycle:
        classifyDialogueLifecycle,
    });

export async function inspectDialogueLifecycle(
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

  dependencies:
    InspectDialogueLifecycleDependencies =
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
      );

  const submission =
    await dependencies
      .readSubmission(
        mediaRoot,
        episodeId,
        sceneId,
        shotId,
        dialogueLineId,
      );

  const completion =
    await dependencies
      .readCompletion(
        mediaRoot,
        episodeId,
        sceneId,
        shotId,
        dialogueLineId,
      );

  return dependencies
    .classifyLifecycle({
      reservation,
      submission,
      completion,
    });
}
