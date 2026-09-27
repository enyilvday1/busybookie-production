import {
  isDeepStrictEqual,
} from "node:util";

import {
  createExecutionCompletion,
  type CreateExecutionCompletionResult,
} from "./createExecutionCompletion.js";

import {
  ExecutionCompletionInputSchema,
  type ExecutionCompletion,
  type ExecutionCompletionInput,
} from "./executionCompletion.schema.js";

import {
  createExecutionCompletionPath,
} from "./executionCompletionPath.js";

import {
  readExecutionCompletion,
} from "./readExecutionCompletion.js";

export type RecoverExecutionCompletionResult =
  CreateExecutionCompletionResult;

export type RecoverExecutionCompletionDependencies =
  Readonly<{
    readCompletion:
      typeof readExecutionCompletion;

    createCompletion:
      typeof createExecutionCompletion;
  }>;

const defaultDependencies:
  RecoverExecutionCompletionDependencies =
  Object.freeze({
    readCompletion:
      readExecutionCompletion,

    createCompletion:
      createExecutionCompletion,
  });

function matchesRecoveredExecutionEvidence(
  existing:
    ExecutionCompletion,

  expected:
    ExecutionCompletionInput,
): boolean {
  return isDeepStrictEqual(
    {
      schemaVersion:
        existing.schemaVersion,

      status:
        existing.status,

      reservationId:
        existing.reservationId,

      episodeId:
        existing.episodeId,

      shotId:
        existing.shotId,

      provider:
        existing.provider,

      providerExecutionId:
        existing.providerExecutionId,

      generationRecordPath:
        existing.generationRecordPath,
    },
    {
      schemaVersion:
        "1.0",

      status:
        "COMPLETED",

      reservationId:
        expected.reservationId,

      episodeId:
        expected.episodeId,

      shotId:
        expected.shotId,

      provider:
        expected.provider,

      providerExecutionId:
        expected.providerExecutionId,

      generationRecordPath:
        expected.generationRecordPath,
    },
  );
}

function requireMatchingCompletion(
  existing:
    ExecutionCompletion,

  expected:
    ExecutionCompletionInput,

  completionPath:
    string,
): void {
  if (
    !matchesRecoveredExecutionEvidence(
      existing,
      expected,
    )
  ) {
    throw new Error(
      `Existing execution completion does not match recovered execution evidence: ${completionPath}`,
    );
  }
}

export async function recoverExecutionCompletion(
  mediaRoot:
    string,

  input:
    ExecutionCompletionInput,

  dependencies:
    RecoverExecutionCompletionDependencies =
      defaultDependencies,
): Promise<RecoverExecutionCompletionResult> {
  const validatedInput =
    ExecutionCompletionInputSchema
      .parse(
        input,
      );

  const completionPath =
    createExecutionCompletionPath(
      mediaRoot,
      validatedInput.episodeId,
      validatedInput.shotId,
    );

  const existing =
    await dependencies
      .readCompletion(
        mediaRoot,
        validatedInput.episodeId,
        validatedInput.shotId,
      );

  if (existing) {
    requireMatchingCompletion(
      existing,
      validatedInput,
      completionPath,
    );

    return Object.freeze({
      record:
        existing,

      completionPath,
    });
  }

  try {
    return await dependencies
      .createCompletion(
        mediaRoot,
        validatedInput,
      );
  } catch (createError) {
    const concurrentWinner =
      await dependencies
        .readCompletion(
          mediaRoot,
          validatedInput.episodeId,
          validatedInput.shotId,
        );

    if (!concurrentWinner) {
      throw createError;
    }

    requireMatchingCompletion(
      concurrentWinner,
      validatedInput,
      completionPath,
    );

    return Object.freeze({
      record:
        concurrentWinner,

      completionPath,
    });
  }
}
