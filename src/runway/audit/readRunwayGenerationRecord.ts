import {
  readFile,
} from "node:fs/promises";

import {
  RunwayGenerationRecordSchema,
  type RunwayGenerationRecord,
} from "./runwayGenerationRecord.schema.js";

import {
  createRunwayGenerationRecordPathFromIdentity,
} from "./writeRunwayGenerationRecord.js";

export async function readRunwayGenerationRecord(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
  taskId: string,
): Promise<RunwayGenerationRecord | null> {
  const recordPath =
    createRunwayGenerationRecordPathFromIdentity(
      mediaRoot,
      episodeId,
      shotId,
      taskId,
    );

  let raw: string;

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

  let parsed: unknown;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch (error) {
    throw new Error(
      `Runway generation record is not valid JSON: ${recordPath}`,
      {
        cause:
          error,
      },
    );
  }

  const record =
    RunwayGenerationRecordSchema
      .parse(
        parsed,
      );

  if (
    record.episodeId !==
      episodeId ||
    record.shotId !==
      shotId ||
    record.taskId !==
      taskId
  ) {
    throw new Error(
      `Runway generation record identity does not match requested execution ${episodeId}/${shotId}/${taskId}.`,
    );
  }

  return record;
}
