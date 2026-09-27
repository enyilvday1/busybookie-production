import {
  randomUUID,
} from "node:crypto";

import {
  constants,
} from "node:fs";

import {
  copyFile,
  mkdir,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
} from "node:path";

import {
  ExecutionSubmissionInputSchema,
  ExecutionSubmissionSchema,
  type ExecutionSubmission,
  type ExecutionSubmissionInput,
} from "./executionSubmission.schema.js";

import {
  createExecutionSubmissionPath,
} from "./executionSubmissionPath.js";

import {
  readExecutionReservation,
} from "./readExecutionReservation.js";

export type ExecutionSubmissionDependencies =
  Readonly<{
    now?: () => string;
  }>;

export type CreateExecutionSubmissionResult =
  Readonly<{
    record:
      ExecutionSubmission;

    submissionPath:
      string;
  }>;

export async function createExecutionSubmission(
  mediaRoot: string,
  input: ExecutionSubmissionInput,
  dependencies:
    ExecutionSubmissionDependencies = {},
): Promise<CreateExecutionSubmissionResult> {
  const validatedInput =
    ExecutionSubmissionInputSchema
      .parse(
        input,
      );

  const reservation =
    await readExecutionReservation(
      mediaRoot,
      validatedInput.episodeId,
      validatedInput.shotId,
    );

  if (!reservation) {
    throw new Error(
      `Execution submission requires an existing reservation for ${validatedInput.episodeId}/${validatedInput.shotId}.`,
    );
  }

  if (
    reservation.reservationId !==
    validatedInput.reservationId
  ) {
    throw new Error(
      `Execution submission reservation ID does not match the durable reservation for ${validatedInput.episodeId}/${validatedInput.shotId}.`,
    );
  }

  if (
    reservation.provider !==
    validatedInput.provider
  ) {
    throw new Error(
      `Execution submission provider ${validatedInput.provider} does not match reservation provider ${reservation.provider}.`,
    );
  }

  if (
    reservation.episodeId !==
      validatedInput.episodeId ||
    reservation.shotId !==
      validatedInput.shotId
  ) {
    throw new Error(
      "Execution submission identity does not match the durable reservation.",
    );
  }

  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const submittedAt =
    now();

  const record =
    validatedInput.provider ===
      "RUNWAY"
      ? ExecutionSubmissionSchema
          .parse({
            schemaVersion:
              "1.2",

            submittedAt,

            status:
              "SUBMITTED",

            reservationId:
              reservation.reservationId,

            episodeId:
              reservation.episodeId,

            shotId:
              reservation.shotId,

            provider:
              "RUNWAY",

            providerExecutionId:
              validatedInput
                .providerExecutionId,

            providerEstimatedCredits:
              validatedInput
                .providerEstimatedCredits,

            recoveryMetadata:
              validatedInput
                .recoveryMetadata,
          })
      : ExecutionSubmissionSchema
          .parse({
            schemaVersion:
              "1.3",

            submittedAt,

            status:
              "SUBMITTED",

            reservationId:
              reservation.reservationId,

            episodeId:
              reservation.episodeId,

            shotId:
              reservation.shotId,

            provider:
              "VEO",

            providerExecutionId:
              validatedInput
                .providerExecutionId,

            recoveryMetadata:
              validatedInput
                .recoveryMetadata,
          });

  const submissionPath =
    createExecutionSubmissionPath(
      mediaRoot,
      record.episodeId,
      record.shotId,
    );

  await mkdir(
    dirname(
      submissionPath,
    ),
    {
      recursive:
        true,
    },
  );

  const temporaryPath =
    `${submissionPath}.part-${process.pid}-${randomUUID()}`;

  let temporaryCreated =
    false;

  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(
        record,
        null,
        2,
      )}\n`,
      {
        encoding:
          "utf8",

        flag:
          "wx",
      },
    );

    temporaryCreated =
      true;

    try {
      await copyFile(
        temporaryPath,
        submissionPath,
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      const code =
        (
          error as
            NodeJS.ErrnoException
        ).code;

      if (
        code ===
        "EEXIST"
      ) {
        throw new Error(
          `Execution submission already exists: ${submissionPath}`,
        );
      }

      throw error;
    }

    return {
      record,
      submissionPath,
    };
  } finally {
    if (temporaryCreated) {
      try {
        await unlink(
          temporaryPath,
        );
      } catch {
        // Preserve the original result or failure.
      }
    }
  }
}
