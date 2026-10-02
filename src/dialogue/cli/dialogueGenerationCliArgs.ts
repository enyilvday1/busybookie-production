import {
  DialogueReservationEpisodeIdSchema,
  DialogueReservationLineIdSchema,
  DialogueReservationSceneIdSchema,
  DialogueReservationShotIdSchema,
  dialogueReservationIdentityMatches,
} from "../dialogueReservation.schema.js";

export type DialogueGenerationCliOptions =
  Readonly<{
    episodeId:
      string;

    sceneId:
      string;

    shotId:
      string;

    dialogueLineId:
      string;

    confirmPaidGeneration:
      boolean;
  }>;

function requireValue(
  args:
    readonly string[],

  index:
    number,

  flag:
    string,
): string {
  const value =
    args[index + 1]
      ?.trim();

  if (
    !value ||
    value.startsWith(
      "--",
    )
  ) {
    throw new Error(
      `${flag} requires a value.`,
    );
  }

  return value;
}

export function parseDialogueGenerationCliArgs(
  args:
    readonly string[],
): DialogueGenerationCliOptions {
  let episodeId:
    string | undefined;

  let sceneId:
    string | undefined;

  let shotId:
    string | undefined;

  let dialogueLineId:
    string | undefined;

  let confirmPaidGeneration =
    false;

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const argument =
      args[index];

    switch (argument) {
      case "--episode":
        episodeId =
          requireValue(
            args,
            index,
            "--episode",
          );

        index += 1;
        break;

      case "--scene":
        sceneId =
          requireValue(
            args,
            index,
            "--scene",
          );

        index += 1;
        break;

      case "--shot":
        shotId =
          requireValue(
            args,
            index,
            "--shot",
          );

        index += 1;
        break;

      case "--line":
        dialogueLineId =
          requireValue(
            args,
            index,
            "--line",
          );

        index += 1;
        break;

      case "--confirm-paid-generation":
        confirmPaidGeneration =
          true;

        break;

      default:
        throw new Error(
          `Unknown dialogue generation CLI argument: ${argument}`,
        );
    }
  }

  if (!episodeId) {
    throw new Error(
      "--episode is required.",
    );
  }

  if (!sceneId) {
    throw new Error(
      "--scene is required.",
    );
  }

  if (!shotId) {
    throw new Error(
      "--shot is required.",
    );
  }

  if (!dialogueLineId) {
    throw new Error(
      "--line is required.",
    );
  }

  const validatedEpisodeId =
    DialogueReservationEpisodeIdSchema
      .parse(
        episodeId,
      );

  const validatedSceneId =
    DialogueReservationSceneIdSchema
      .parse(
        sceneId,
      );

  const validatedShotId =
    DialogueReservationShotIdSchema
      .parse(
        shotId,
      );

  const validatedDialogueLineId =
    DialogueReservationLineIdSchema
      .parse(
        dialogueLineId,
      );

  if (
    !dialogueReservationIdentityMatches(
      validatedEpisodeId,
      validatedSceneId,
      validatedShotId,
      validatedDialogueLineId,
    )
  ) {
    throw new Error(
      "Dialogue generation CLI line identity does not match the selected episode, scene, and shot.",
    );
  }

  return Object.freeze({
    episodeId:
      validatedEpisodeId,

    sceneId:
      validatedSceneId,

    shotId:
      validatedShotId,

    dialogueLineId:
      validatedDialogueLineId,

    confirmPaidGeneration,
  });
}
