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
  createDialogueDirectSeedAudioCompletionPath,
} from "./dialogueDirectSeedAudioLifecyclePaths.js";

import {
  createDialogueGenerationRecordPath,
} from "./dialogueGenerationRecordPath.js";

import {
  readDialogueDirectSeedAudioReservation,
} from "./readDialogueDirectSeedAudioReservation.js";

import {
  readDialogueDirectSeedAudioSubmission,
} from "./readDialogueDirectSeedAudioSubmission.js";

import {
  readDialogueGenerationRecord,
} from "./readDialogueGenerationRecord.js";

export type DialogueDirectSeedAudioCompletionDependencies =
  Readonly<{
    now?:
      () => string;
  }>;

export type CreateDialogueDirectSeedAudioCompletionResult =
  Readonly<{
    record:
      DialogueCompletion;

    completionPath:
      string;
  }>;

export async function createDialogueDirectSeedAudioCompletion(
  mediaRoot:
    string,

  input:
    DialogueCompletionInput,

  dependencies:
    DialogueDirectSeedAudioCompletionDependencies = {},
): Promise<
  CreateDialogueDirectSeedAudioCompletionResult
> {
  const validatedInput =
    DialogueCompletionInputSchema
      .parse(
        input,
      );

  const reservation =
    await readDialogueDirectSeedAudioReservation(
      mediaRoot,
      validatedInput.episodeId,
      validatedInput.sceneId,
      validatedInput.shotId,
      validatedInput.dialogueLineId,
      validatedInput.planKey,
    );

  if (!reservation) {
    throw new Error(
      `Dialogue direct SeedAudio completion requires an existing plan-scoped SeedAudio reservation for ${validatedInput.dialogueLineId}.`,
    );
  }

  if (
    reservation.reservationId !==
    validatedInput.reservationId
  ) {
    throw new Error(
      `Dialogue direct SeedAudio completion reservation ID does not match the durable reservation for ${validatedInput.dialogueLineId}.`,
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
      "Dialogue direct SeedAudio completion identity does not match the durable reservation.",
    );
  }

  if (
    reservation.provider !==
    validatedInput.provider
  ) {
    throw new Error(
      `Dialogue direct SeedAudio completion provider ${validatedInput.provider} does not match reservation provider ${reservation.provider}.`,
    );
  }

  if (
    reservation.planKey !==
    validatedInput.planKey
  ) {
    throw new Error(
      "Dialogue direct SeedAudio completion planKey does not match the durable reservation planKey.",
    );
  }

  const submission =
    await readDialogueDirectSeedAudioSubmission(
      mediaRoot,
      validatedInput.episodeId,
      validatedInput.sceneId,
      validatedInput.shotId,
      validatedInput.dialogueLineId,
      validatedInput.planKey,
    );

  if (!submission) {
    throw new Error(
      `Dialogue direct SeedAudio completion requires an existing plan-scoped SeedAudio submission for ${validatedInput.dialogueLineId}.`,
    );
  }

  if (
    submission.reservationId !==
    reservation.reservationId
  ) {
    throw new Error(
      "Dialogue direct SeedAudio completion submission reservation ID does not match the durable reservation.",
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
      "Dialogue direct SeedAudio completion submission identity does not match the durable reservation.",
    );
  }

  if (
    submission.provider !==
    reservation.provider
  ) {
    throw new Error(
      "Dialogue direct SeedAudio completion submission provider does not match the durable reservation.",
    );
  }

  if (
    submission.planKey !==
    reservation.planKey
  ) {
    throw new Error(
      "Dialogue direct SeedAudio completion submission planKey does not match the durable reservation planKey.",
    );
  }

  if (
    submission.providerExecutionId !==
    validatedInput.providerExecutionId
  ) {
    throw new Error(
      `Dialogue direct SeedAudio completion provider execution ID does not match the durable submission for ${validatedInput.dialogueLineId}.`,
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
      `Dialogue direct SeedAudio completion generation record path is not the canonical path for accepted task ${validatedInput.providerExecutionId}.`,
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
      `Dialogue direct SeedAudio completion generation record does not exist: ${expectedGenerationRecordPath}`,
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
      "Dialogue direct SeedAudio completion generation record identity does not match the durable lifecycle identity.",
    );
  }

  if (
    generationRecord.plan.planKey !==
    validatedInput.planKey
  ) {
    throw new Error(
      "Dialogue direct SeedAudio completion generation record planKey does not match the durable lifecycle planKey.",
    );
  }

  if (
    generationRecord.provider !==
      validatedInput.provider ||
    generationRecord.providerExecutionId !==
      validatedInput.providerExecutionId
  ) {
    throw new Error(
      "Dialogue direct SeedAudio completion generation record provider execution evidence does not match the durable submission.",
    );
  }

  if (
    generationRecord.schemaVersion !==
      "3.0" ||
    generationRecord.providerModel !==
      "seed_audio"
  ) {
    throw new Error(
      "Dialogue direct SeedAudio completion requires a durable v3 seed_audio generation record.",
    );
  }

  if (
    generationRecord.credits
      .providerEstimated !==
    submission.providerEstimatedCredits
  ) {
    throw new Error(
      "Dialogue direct SeedAudio completion generation record provider-estimated credits do not match the durable submission.",
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
    createDialogueDirectSeedAudioCompletionPath(
      mediaRoot,
      record.episodeId,
      record.sceneId,
      record.shotId,
      record.dialogueLineId,
      record.planKey,
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
    } catch (
      error:
        unknown
    ) {
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
          `Dialogue direct SeedAudio completion already exists: ${completionPath}`,
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
