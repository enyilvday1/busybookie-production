import {
  readFile,
} from "node:fs/promises";

import {
  DialogueCompletionSchema,
  type DialogueCompletion,
} from "./dialogueCompletion.schema.js";

import {
  createDialogueDirectSeedAudioCompletionPath,
} from "./dialogueDirectSeedAudioLifecyclePaths.js";

export async function readDialogueDirectSeedAudioCompletion(
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
): Promise<
  DialogueCompletion | null
> {
  const completionPath =
    createDialogueDirectSeedAudioCompletionPath(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      dialogueLineId,
      planKey,
    );

  let raw:
    string;

  try {
    raw =
      await readFile(
        completionPath,
        "utf8",
      );
  } catch (
    error:
      unknown
  ) {
    const code =
      (
        error as
          NodeJS.ErrnoException
      ).code;

    if (
      code ===
      "ENOENT"
    ) {
      return null;
    }

    throw error;
  }

  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch (
    error:
      unknown
  ) {
    throw new Error(
      `Dialogue direct SeedAudio completion is not valid JSON: ${completionPath}`,
      {
        cause:
          error,
      },
    );
  }

  const record =
    DialogueCompletionSchema
      .parse(
        parsed,
      );

  if (
    record.episodeId !==
      episodeId ||
    record.sceneId !==
      sceneId ||
    record.shotId !==
      shotId ||
    record.dialogueLineId !==
      dialogueLineId ||
    record.planKey !==
      planKey
  ) {
    throw new Error(
      `Dialogue direct SeedAudio completion identity does not match its deterministic plan-scoped path: ${completionPath}`,
    );
  }

  return record;
}
