import {
  readFile,
} from "node:fs/promises";

import {
  createExecutionCompletionPath,
} from "./executionCompletionPath.js";

import {
  GoogleGenAiExecutionCompletionSchema,
  type GoogleGenAiExecutionCompletion,
} from "./googleGenAiExecutionCompletion.schema.js";

/**
 * Reads a Google GenAI 1.1 completion from the shared canonical
 * execution-completion path. Any other document at that path, including a
 * Runway/Veo 1.0 completion, is rejected.
 */
export async function readGoogleGenAiExecutionCompletion(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,
): Promise<GoogleGenAiExecutionCompletion | null> {
  const completionPath =
    createExecutionCompletionPath(
      mediaRoot,
      episodeId,
      shotId,
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
      `Google GenAI execution completion is not valid JSON: ${completionPath}`,
      {
        cause:
          error,
      },
    );
  }

  return GoogleGenAiExecutionCompletionSchema
    .parse(
      parsed,
    );
}
