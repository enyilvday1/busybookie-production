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
  resolve,
} from "node:path";

import {
  DialogueCompletionInputSchema,
  DialogueCompletionSchema,
  type DialogueCompletion,
  type DialogueCompletionInput,
} from "./dialogueCompletion.schema.js";

import {
  createDialogueCompletionPath,
} from "./dialogueCompletionPath.js";

import {
  createDialogueGenerationRecordPath,
} from "./dialogueGenerationRecordPath.js";

import {
  readDialogueGenerationRecord,
} from "./readDialogueGenerationRecord.js";

import {
  readDialogueReservation,
} from "./readDialogueReservation.js";

import {
  readDialogueSubmission,
} from "./readDialogueSubmission.js";

export type DialogueCompletionDependencies =
  Readonly<{
    now?:
      () => string;
  }>;

export type CreateDialogueCompletionResult =
  Readonly<{
    record:
      DialogueCompletion;

    completionPath:
      string;
  }>;

export async function createDialogueCompletion(
  mediaRoot:
    string,

  input:
    DialogueCompletionInput,

  dependencies:
    DialogueCompletionDependencies = {},
): Promise<
  CreateDialogueCompletionResult
> {
  const validatedInput =
    DialogueCompletionInputSchema
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
      `Dialogue completion requires an existing dialogue reservation for ${validatedInput.dialogueLineId}.`,
    );
  }

  if (
    reservation.reservationId !==
    validatedInput.reservationId
  ) {
    throw new Error(
      `Dialogue completion reservation ID does not match the durable reservation for ${validatedInput.dialogueLineId}.`,
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
      "Dialogue completion identity does not match the durable reservation.",
    );
  }

  if (
    reservation.provider !==
    validatedInput.provider
  ) {
    throw new Error(
      `Dialogue completion provider ${validatedInput.provider} does not match reservation provider ${reservation.provider}.`,
    );
  }

  if (
    reservation.planKey !==
    validatedInput.planKey
  ) {
    throw new Error(
      "Dialogue completion planKey does not match the durable reservation planKey.",
    );
  }

  const submission =
    await readDialogueSubmission(
      mediaRoot,
      validatedInput.episodeId,
      validatedInput.sceneId,
      validatedInput.shotId,
      validatedInput.dialogueLineId,
    );

  if (!submission) {
    throw new Error(
      `Dialogue completion requires an existing dialogue submission for ${validatedInput.dialogueLineId}.`,
    );
  }

  if (
    submission.reservationId !==
    reservation.reservationId
  ) {
    throw new Error(
      "Dialogue completion submission reservation ID does not match the durable reservation.",
    );
  }

  if (
    submission.episodeId !==
      reservation.episodeId ||
    submission.sceneId !==
      reservation.sceneId ||
    submission.shotId !==
      reservation.shotId ||
    submission.dialogueLineId !==
      reservation.dialogueLineId
  ) {
    throw new Error(
      "Dialogue completion submission identity does not match the durable reservation.",
    );
  }

  if (
    submission.provider !==
    reservation.provider
  ) {
    throw new Error(
      "Dialogue completion submission provider does not match the durable reservation.",
    );
  }

  if (
    submission.planKey !==
    reservation.planKey
  ) {
    throw new Error(
      "Dialogue completion submission planKey does not match the durable reservation planKey.",
    );
  }

  if (
    submission.providerExecutionId !==
    validatedInput.providerExecutionId
  ) {
    throw new Error(
      `Dialogue completion provider execution ID does not match the durable submission for ${validatedInput.dialogueLineId}.`,
    );
  }

  const expectedGenerationRecordPath =
    createDialogueGenerationRecordPath(
      mediaRoot,
      validatedInput.episodeId,
      validatedInput.shotId,
      validatedInput.dialogueLineId,
      validatedInput.provider,
      validatedInput.providerExecutionId,
    );

  if (
    resolve(
      validatedInput.generationRecordPath,
    ) !==
    resolve(
      expectedGenerationRecordPath,
    )
  ) {
    throw new Error(
      `Dialogue completion generation record path is not the canonical path for accepted task ${validatedInput.providerExecutionId}.`,
    );
  }

  const generationRecord =
    await readDialogueGenerationRecord(
      mediaRoot,
      validatedInput.episodeId,
      validatedInput.shotId,
      validatedInput.dialogueLineId,
      validatedInput.provider,
      validatedInput.providerExecutionId,
    );

  if (!generationRecord) {
    throw new Error(
      `Dialogue completion generation record does not exist: ${expectedGenerationRecordPath}`,
    );
  }

  if (
    generationRecord.plan.episodeId !==
      validatedInput.episodeId ||
    generationRecord.plan.sceneId !==
      validatedInput.sceneId ||
    generationRecord.plan.shotId !==
      validatedInput.shotId ||
    generationRecord.plan.dialogueLineId !==
      validatedInput.dialogueLineId
  ) {
    throw new Error(
      "Dialogue completion generation record identity does not match the durable lifecycle identity.",
    );
  }

  if (
    generationRecord.plan.planKey !==
    validatedInput.planKey
  ) {
    throw new Error(
      "Dialogue completion generation record planKey does not match the durable lifecycle planKey.",
    );
  }

  if (
    generationRecord.provider !==
      validatedInput.provider ||
    generationRecord.providerExecutionId !==
      validatedInput.providerExecutionId
  ) {
    throw new Error(
      "Dialogue completion generation record provider execution evidence does not match the durable submission.",
    );
  }

  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const record =
    DialogueCompletionSchema
      .parse({
        schemaVersion:
          "1.0",

        completedAt:
          now(),

        status:
          "COMPLETED",

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
          submission.providerExecutionId,

        generationRecordPath:
          expectedGenerationRecordPath,
      });

  const completionPath =
    createDialogueCompletionPath(
      mediaRoot,
      record.episodeId,
      record.sceneId,
      record.shotId,
      record.dialogueLineId,
    );

  await mkdir(
    dirname(
      completionPath,
    ),
    {
      recursive:
        true,
    },
  );

  const temporaryPath =
    `${completionPath}.part-${process.pid}-${randomUUID()}`;

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
        completionPath,
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
          `Dialogue completion already exists: ${completionPath}`,
        );
      }

      throw error;
    }

    return Object.freeze({
      record,
      completionPath,
    });
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
