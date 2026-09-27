import {
  readFile,
} from "node:fs/promises";

import {
  VeoGenerationRecordSchema,
  type VeoGenerationRecord,
} from "./veoGenerationRecord.schema.js";

import {
  createVeoGenerationRecordPathFromIdentity,
} from "./writeVeoGenerationRecord.js";

export async function readVeoGenerationRecord(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  operationName:
    string,
): Promise<
  VeoGenerationRecord | null
> {
  const recordPath =
    createVeoGenerationRecordPathFromIdentity(
      mediaRoot,
      episodeId,
      shotId,
      operationName,
    );

  let raw:
    string;

  try {
    raw =
      await readFile(
        recordPath,
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
      `Veo generation record is not valid JSON: ${recordPath}`,
      {
        cause:
          error,
      },
    );
  }

  const record =
    VeoGenerationRecordSchema
      .parse(
        parsed,
      );

  if (
    record.episodeId !==
      episodeId ||
    record.shotId !==
      shotId ||
    record.operationName !==
      operationName
  ) {
    throw new Error(
      `Veo generation record identity does not match requested execution ${episodeId}/${shotId}/${operationName}.`,
    );
  }

  return record;
}
