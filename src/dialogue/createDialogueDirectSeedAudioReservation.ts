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
  DialogueReservationInputSchema,
  DialogueReservationSchema,
  type DialogueReservation,
  type DialogueReservationInput,
} from "./dialogueReservation.schema.js";

import {
  createDialogueDirectSeedAudioReservationPath,
} from "./dialogueDirectSeedAudioLifecyclePaths.js";

export type DialogueDirectSeedAudioReservationDependencies =
  Readonly<{
    now?:
      () => string;

    createReservationId?:
      () => string;
  }>;

export type CreateDialogueDirectSeedAudioReservationResult =
  Readonly<{
    record:
      DialogueReservation;

    reservationPath:
      string;
  }>;

export async function createDialogueDirectSeedAudioReservation(
  mediaRoot: string,
  input: DialogueReservationInput,
  dependencies:
    DialogueDirectSeedAudioReservationDependencies = {},
): Promise<
  CreateDialogueDirectSeedAudioReservationResult
> {
  const validatedInput =
    DialogueReservationInputSchema
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
    DialogueReservationSchema
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

        sceneId:
          validatedInput.sceneId,

        shotId:
          validatedInput.shotId,

        dialogueLineId:
          validatedInput.dialogueLineId,

        planKey:
          validatedInput.planKey,

        provider:
          validatedInput.provider,
      });

  const reservationPath =
    createDialogueDirectSeedAudioReservationPath(
      mediaRoot,
      record.episodeId,
      record.sceneId,
      record.shotId,
      record.dialogueLineId,
      record.planKey,
    );

  await mkdir(
    dirname(
      reservationPath,
    ),
    {
      recursive:
        true,
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
          `Dialogue direct SeedAudio reservation already exists: ${reservationPath}`,
        );
      }

      throw error;
    }

    return Object.freeze({
      record,
      reservationPath,
    });
  } finally {
    if (
      temporaryCreated
    ) {
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
