import {
  readFile,
} from "node:fs/promises";

import {
  ExecutionReservationSchema,
  type ExecutionReservation,
} from "./executionReservation.schema.js";

import {
  createExecutionReservationPath,
} from "./executionReservationPath.js";

export async function readExecutionReservation(
  mediaRoot: string,
  episodeId: string,
  shotId: string,
): Promise<ExecutionReservation | null> {
  const reservationPath =
    createExecutionReservationPath(
      mediaRoot,
      episodeId,
      shotId,
    );

  let raw: string;

  try {
    raw =
      await readFile(
        reservationPath,
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
      `Execution reservation is not valid JSON: ${reservationPath}`,
      {
        cause: error,
      },
    );
  }

  return ExecutionReservationSchema
    .parse(
      parsed,
    );
}
