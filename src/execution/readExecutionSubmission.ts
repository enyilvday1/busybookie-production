import {
  readFile,
} from "node:fs/promises";

import {
  ExecutionSubmissionSchema,
  type ExecutionSubmission,
} from "./executionSubmission.schema.js";

import {
  createExecutionSubmissionPath,
} from "./executionSubmissionPath.js";

export async function readExecutionSubmission(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
): Promise<ExecutionSubmission | null> {
  const submissionPath =
    createExecutionSubmissionPath(
      mediaRoot,
      episodeId,
      shotId,
    );

  let raw: string;

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

  let parsed: unknown;

  try {
    parsed =
      JSON.parse(
        raw,
      );
  } catch (error) {
    throw new Error(
      `Execution submission is not valid JSON: ${submissionPath}`,
      {
        cause:
          error,
      },
    );
  }

  return ExecutionSubmissionSchema
    .parse(
      parsed,
    );
}
