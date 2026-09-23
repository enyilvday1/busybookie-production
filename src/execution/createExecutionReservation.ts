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
  ExecutionReservationInputSchema,
  ExecutionReservationSchema,
  type ExecutionReservation,
  type ExecutionReservationInput,
} from "./executionReservation.schema.js";

import {
  createExecutionReservationPath,
} from "./executionReservationPath.js";

export type ExecutionReservationDependencies =
  Readonly<{
    now?: () => string;
    createReservationId?: () => string;
  }>;

export type CreateExecutionReservationResult =
  Readonly<{
    record: ExecutionReservation;
    reservationPath: string;
  }>;

export async function createExecutionReservation(
  mediaRoot: string,
  input: ExecutionReservationInput,
  dependencies:
    ExecutionReservationDependencies = {},
): Promise<CreateExecutionReservationResult> {
  const validatedInput =
    ExecutionReservationInputSchema
      .parse(
        input,
      );

  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const createReservationId =
    dependencies.createReservationId ??
    randomUUID;

  const record =
    ExecutionReservationSchema
      .parse({
        schemaVersion:
          "1.0",

        reservationId:
          createReservationId(),

        reservedAt:
          now(),

        status:
          "RESERVED",

        episodeId:
          validatedInput.episodeId,

        shotId:
          validatedInput.shotId,

        provider:
          validatedInput.provider,
      });

  const reservationPath =
    createExecutionReservationPath(
      mediaRoot,
      record.episodeId,
      record.shotId,
    );

  await mkdir(
    dirname(
      reservationPath,
    ),
    {
      recursive: true,
    },
  );

  const temporaryPath =
    `${reservationPath}.part-${process.pid}-${randomUUID()}`;

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
        encoding: "utf8",
        flag: "wx",
      },
    );

    temporaryCreated =
      true;

    try {
      await copyFile(
        temporaryPath,
        reservationPath,
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
          `Execution reservation already exists: ${reservationPath}`,
        );
      }

      throw error;
    }

    return {
      record,
      reservationPath,
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
