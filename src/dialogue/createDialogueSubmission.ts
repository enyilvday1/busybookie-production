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
  DialogueSubmissionInputSchema,
  DialogueSubmissionSchema,
  type DialogueSubmission,
  type DialogueSubmissionInput,
} from "./dialogueSubmission.schema.js";

import {
  createDialogueSubmissionPath,
} from "./dialogueSubmissionPath.js";

import {
  readDialogueReservation,
} from "./readDialogueReservation.js";

export type DialogueSubmissionDependencies =
  Readonly<{
    now?:
      () => string;
  }>;

export type CreateDialogueSubmissionResult =
  Readonly<{
    record:
      DialogueSubmission;

    submissionPath:
      string;
  }>;

export async function createDialogueSubmission(
  mediaRoot:
    string,

  input:
    DialogueSubmissionInput,

  dependencies:
    DialogueSubmissionDependencies = {},
): Promise<
  CreateDialogueSubmissionResult
> {
  const validatedInput =
    DialogueSubmissionInputSchema
      .parse(
        input,
      );

  const reservation =
    await readDialogueReservation(
      mediaRoot,
      validatedInput.episodeId,
      validatedInput.sceneId,
      validatedInput.shotId,
      validatedInput.dialogueLineId,
    );

  if (!reservation) {
    throw new Error(
      `Dialogue submission requires an existing dialogue reservation for ${validatedInput.dialogueLineId}.`,
    );
  }

  if (
    reservation.reservationId !==
    validatedInput.reservationId
  ) {
    throw new Error(
      `Dialogue submission reservation ID does not match the durable reservation for ${validatedInput.dialogueLineId}.`,
    );
  }

  if (
    reservation.episodeId !==
      validatedInput.episodeId ||
    reservation.sceneId !==
      validatedInput.sceneId ||
    reservation.shotId !==
      validatedInput.shotId ||
    reservation.dialogueLineId !==
      validatedInput.dialogueLineId
  ) {
    throw new Error(
      "Dialogue submission identity does not match the durable reservation.",
    );
  }

  if (
    reservation.provider !==
    validatedInput.provider
  ) {
    throw new Error(
      `Dialogue submission provider ${validatedInput.provider} does not match reservation provider ${reservation.provider}.`,
    );
  }

  if (
    reservation.planKey !==
    validatedInput.planKey
  ) {
    throw new Error(
      "Dialogue submission planKey does not match the durable reservation planKey.",
    );
  }

  if (
    validatedInput.recoveryMetadata
      .plan.planKey !==
    reservation.planKey
  ) {
    throw new Error(
      "Dialogue submission recovery planKey does not match the durable reservation planKey.",
    );
  }

  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const record =
    DialogueSubmissionSchema
      .parse({
        schemaVersion:
          "1.0",

        submittedAt:
          now(),

        status:
          "SUBMITTED",

        reservationId:
          reservation.reservationId,

        episodeId:
          reservation.episodeId,

        sceneId:
          reservation.sceneId,

        shotId:
          reservation.shotId,

        dialogueLineId:
          reservation.dialogueLineId,

        planKey:
          reservation.planKey,

        provider:
          reservation.provider,

        providerExecutionId:
          validatedInput
            .providerExecutionId,

        providerEstimatedCredits:
          validatedInput
            .providerEstimatedCredits,

        recoveryMetadata:
          validatedInput
            .recoveryMetadata,
      });

  const submissionPath =
    createDialogueSubmissionPath(
      mediaRoot,
      record.episodeId,
      record.sceneId,
      record.shotId,
      record.dialogueLineId,
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
          `Dialogue submission already exists: ${submissionPath}`,
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
