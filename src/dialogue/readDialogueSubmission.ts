import {
  readFile,
} from "node:fs/promises";

import {
  DialogueSubmissionSchema,
  type DialogueSubmission,
} from "./dialogueSubmission.schema.js";

import {
  createDialogueSubmissionPath,
} from "./dialogueSubmissionPath.js";

export async function readDialogueSubmission(
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
  DialogueSubmission | null
> {
  const submissionPath =
    createDialogueSubmissionPath(
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
        submissionPath,
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
      `Dialogue submission is not valid JSON: ${submissionPath}`,
      {
        cause:
          error,
      },
    );
  }

  const record =
    DialogueSubmissionSchema
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
      `Dialogue submission identity does not match its deterministic path: ${submissionPath}`,
    );
  }

  return record;
}
