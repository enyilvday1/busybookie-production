import {
  randomUUID,
} from "node:crypto";

import {
  constants,
} from "node:fs";

import {
  copyFile,
  mkdir,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
  isAbsolute,
  resolve,
} from "node:path";

import {
  ExecutionCompletionInputSchema,
  ExecutionCompletionSchema,
  type ExecutionCompletion,
  type ExecutionCompletionInput,
} from "./executionCompletion.schema.js";

import {
  createExecutionCompletionPath,
} from "./executionCompletionPath.js";

import {
  readExecutionReservation,
} from "./readExecutionReservation.js";

import {
  readExecutionSubmission,
} from "./readExecutionSubmission.js";

export type ExecutionCompletionDependencies =
  Readonly<{
    now?: () => string;
  }>;

export type CreateExecutionCompletionResult =
  Readonly<{
    record:
      ExecutionCompletion;

    completionPath:
      string;
  }>;

function requireGenerationRecordSuffix(
  provider:
    ExecutionCompletionInput["provider"],
  generationRecordPath:
    string,
): void {
  const expectedSuffix =
    provider ===
    "RUNWAY"
      ? ".runway-generation.json"
      : ".veo-generation.json";

  if (
    !generationRecordPath
      .toLowerCase()
      .endsWith(
        expectedSuffix,
      )
  ) {
    throw new Error(
      `Execution completion generation record does not match provider ${provider}.`,
    );
  }
}

async function validateGenerationRecordPath(
  mediaRoot:
    string,

  input:
    ExecutionCompletionInput,
): Promise<string> {
  if (
    !isAbsolute(
      input.generationRecordPath,
    )
  ) {
    throw new Error(
      "Execution completion generation record path must be absolute.",
    );
  }

  const generationRecordPath =
    resolve(
      input.generationRecordPath,
    );

  requireGenerationRecordSuffix(
    input.provider,
    generationRecordPath,
  );

  let generationRecordStats;

  try {
    generationRecordStats =
      await stat(
        generationRecordPath,
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
      throw new Error(
        `Execution completion generation record does not exist: ${generationRecordPath}`,
        {
          cause:
            error,
        },
      );
    }

    throw error;
  }

  if (
    !generationRecordStats
      .isFile()
  ) {
    throw new Error(
      `Execution completion generation record is not a file: ${generationRecordPath}`,
    );
  }

  const expectedShotDirectory =
    resolve(
      mediaRoot,
      "generated-video",
      input.episodeId,
      input.shotId,
    );

  const [
    realShotDirectory,
    realGenerationRecordPath,
  ] =
    await Promise.all([
      realpath(
        expectedShotDirectory,
      ),

      realpath(
        generationRecordPath,
      ),
    ]);

  if (
    dirname(
      realGenerationRecordPath,
    ) !==
    realShotDirectory
  ) {
    throw new Error(
      `Execution completion generation record must be inside the selected shot directory: ${expectedShotDirectory}`,
    );
  }

  return generationRecordPath;
}

export async function createExecutionCompletion(
  mediaRoot: string,
  input: ExecutionCompletionInput,
  dependencies:
    ExecutionCompletionDependencies = {},
): Promise<CreateExecutionCompletionResult> {
  const validatedInput =
    ExecutionCompletionInputSchema
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
      `Execution completion requires an existing reservation for ${validatedInput.episodeId}/${validatedInput.shotId}.`,
    );
  }

  if (
    reservation.reservationId !==
    validatedInput.reservationId
  ) {
    throw new Error(
      `Execution completion reservation ID does not match the durable reservation for ${validatedInput.episodeId}/${validatedInput.shotId}.`,
    );
  }

  if (
    reservation.provider !==
    validatedInput.provider
  ) {
    throw new Error(
      `Execution completion provider ${validatedInput.provider} does not match reservation provider ${reservation.provider}.`,
    );
  }

  if (
    reservation.episodeId !==
      validatedInput.episodeId ||
    reservation.shotId !==
      validatedInput.shotId
  ) {
    throw new Error(
      "Execution completion identity does not match the durable reservation.",
    );
  }

  const submission =
    await readExecutionSubmission(
      mediaRoot,
      validatedInput.episodeId,
      validatedInput.shotId,
    );

  if (!submission) {
    throw new Error(
      `Execution completion requires an existing submission for ${validatedInput.episodeId}/${validatedInput.shotId}.`,
    );
  }

  if (
    submission.reservationId !==
    reservation.reservationId
  ) {
    throw new Error(
      "Execution completion submission reservation ID does not match the durable reservation.",
    );
  }

  if (
    submission.provider !==
    reservation.provider
  ) {
    throw new Error(
      "Execution completion submission provider does not match the durable reservation.",
    );
  }

  if (
    submission.episodeId !==
      reservation.episodeId ||
    submission.shotId !==
      reservation.shotId
  ) {
    throw new Error(
      "Execution completion submission identity does not match the durable reservation.",
    );
  }

  if (
    submission.providerExecutionId !==
    validatedInput.providerExecutionId
  ) {
    throw new Error(
      `Execution completion provider execution ID does not match the durable submission for ${validatedInput.episodeId}/${validatedInput.shotId}.`,
    );
  }

  const generationRecordPath =
    await validateGenerationRecordPath(
      mediaRoot,
      validatedInput,
    );

  const now =
    dependencies.now ??
    (() =>
      new Date()
        .toISOString());

  const record =
    ExecutionCompletionSchema
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

        shotId:
          reservation.shotId,

        provider:
          reservation.provider,

        providerExecutionId:
          submission.providerExecutionId,

        generationRecordPath,
      });

  const completionPath =
    createExecutionCompletionPath(
      mediaRoot,
      record.episodeId,
      record.shotId,
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
          `Execution completion already exists: ${completionPath}`,
        );
      }

      throw error;
    }

    return {
      record,
      completionPath,
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
