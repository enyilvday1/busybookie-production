import {
  readFile,
} from "node:fs/promises";

import {
  DialogueCompletionSchema,
  type DialogueCompletion,
} from "./dialogueCompletion.schema.js";

import {
  createDialogueCompletionPath,
} from "./dialogueCompletionPath.js";

export async function readDialogueCompletion(
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
): Promise<
  DialogueCompletion | null
> {
  const completionPath =
    createDialogueCompletionPath(
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      dialogueLineId,
    );

  let raw:
    string;

  try {
    raw =
      await readFile(
        completionPath,
        "utf8",
      );
  } catch (error) {
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
  } catch (error) {
    throw new Error(
      `Dialogue completion is not valid JSON: ${completionPath}`,
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
      dialogueLineId
  ) {
    throw new Error(
      `Dialogue completion identity does not match its deterministic path: ${completionPath}`,
    );
  }

  return record;
}
