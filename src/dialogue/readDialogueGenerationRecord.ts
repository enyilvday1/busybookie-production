import {
  readFile,
} from "node:fs/promises";

import {
  DialogueGenerationRecordSchema,
  type DialogueGenerationRecord,
} from "./dialogueGenerationRecord.schema.js";

import {
  createDialogueGenerationRecordPath,
  type DialogueVoiceProvider,
} from "./dialogueGenerationRecordPath.js";

function hasErrorCode(
  error:
    unknown,

  expectedCode:
    string,
): boolean {
  return (
    typeof error ===
      "object" &&
    error !==
      null &&
    "code" in
      error &&
    (
      error as {
        code?: unknown;
      }
    ).code ===
      expectedCode
  );
}

export async function readDialogueGenerationRecord(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  dialogueLineId:
    string,

  provider:
    DialogueVoiceProvider,

  providerExecutionId:
    string,
): Promise<
  DialogueGenerationRecord | null
> {
  const recordPath =
    createDialogueGenerationRecordPath(
      mediaRoot,
      episodeId,
      shotId,
      dialogueLineId,
      provider,
      providerExecutionId,
    );

  let raw:
    string;

  try {
    raw =
      await readFile(
        recordPath,
        "utf8",
      );
  } catch (
    error:
      unknown
  ) {
    if (
      hasErrorCode(
        error,
        "ENOENT",
      )
    ) {
      return null;
    }

    throw error;
  }

  let parsedJson:
    unknown;

  try {
    parsedJson =
      JSON.parse(
        raw,
      );
  } catch (
    error:
      unknown
  ) {
    throw new Error(
      `Malformed dialogue generation record JSON: ${recordPath}`,
      {
        cause:
          error,
      },
    );
  }

  const record =
    DialogueGenerationRecordSchema.parse(
      parsedJson,
    );

  const identityMatches =
    record.plan.episodeId ===
      episodeId &&
    record.plan.shotId ===
      shotId &&
    record.plan.dialogueLineId ===
      dialogueLineId &&
    record.provider ===
      provider &&
    record.providerExecutionId ===
      providerExecutionId;

  if (
    !identityMatches
  ) {
    throw new Error(
      "Durable dialogue generation record identity does not match the canonical lookup identity.",
    );
  }

  return record;
}
