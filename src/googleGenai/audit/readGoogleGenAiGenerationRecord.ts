import {
  readFile,
} from "node:fs/promises";

import {
  GoogleGenAiGenerationRecordSchema,
  type GoogleGenAiGenerationRecord,
} from "./googleGenAiGenerationRecord.schema.js";

import {
  createGoogleGenAiGenerationRecordPath,
} from "./googleGenAiGenerationRecordPath.js";

export async function readGoogleGenAiGenerationRecord(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  providerExecutionId:
    string,
): Promise<GoogleGenAiGenerationRecord | null> {
  const recordPath =
    createGoogleGenAiGenerationRecordPath(
      mediaRoot,
      episodeId,
      shotId,
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
  } catch (error) {
    if (
      error !== null &&
      typeof error === "object" &&
      "code" in error &&
      error.code ===
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
      `Google GenAI generation record is not valid JSON: ${recordPath}`,
      {
        cause:
          error,
      },
    );
  }

  return GoogleGenAiGenerationRecordSchema
    .parse(
      parsed,
    );
}
