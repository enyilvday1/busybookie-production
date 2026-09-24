import {
  readFile,
} from "node:fs/promises";

import {
  ExecutionCompletionSchema,
  type ExecutionCompletion,
} from "./executionCompletion.schema.js";

import {
  createExecutionCompletionPath,
} from "./executionCompletionPath.js";

export async function readExecutionCompletion(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
): Promise<ExecutionCompletion | null> {
  const completionPath =
    createExecutionCompletionPath(
      mediaRoot,
      episodeId,
      shotId,
    );

  let raw: string;

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

  let parsed: unknown;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch (error) {
    throw new Error(
      `Execution completion is not valid JSON: ${completionPath}`,
      {
        cause:
          error,
      },
    );
  }

  return ExecutionCompletionSchema
    .parse(
      parsed,
    );
}
