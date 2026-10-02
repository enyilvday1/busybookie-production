import {
  isDeepStrictEqual,
} from "node:util";

import {
  createDialogueCompletion,
  type CreateDialogueCompletionResult,
} from "./createDialogueCompletion.js";

import {
  DialogueCompletionInputSchema,
  type DialogueCompletion,
  type DialogueCompletionInput,
} from "./dialogueCompletion.schema.js";

import {
  createDialogueCompletionPath,
} from "./dialogueCompletionPath.js";

import {
  readDialogueCompletion,
} from "./readDialogueCompletion.js";

export type RecoverDialogueCompletionResult =
  CreateDialogueCompletionResult;

export type RecoverDialogueCompletionDependencies =
  Readonly<{
    readCompletion:
      typeof readDialogueCompletion;

    createCompletion:
      typeof createDialogueCompletion;
  }>;

const defaultDependencies:
  RecoverDialogueCompletionDependencies =
    Object.freeze({
      readCompletion:
        readDialogueCompletion,

      createCompletion:
        createDialogueCompletion,
    });

function matchesRecoveredDialogueEvidence(
  existing:
    DialogueCompletion,

  expected:
    DialogueCompletionInput,
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

      sceneId:
        existing.sceneId,

      shotId:
        existing.shotId,

      dialogueLineId:
        existing.dialogueLineId,

      planKey:
        existing.planKey,

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

      sceneId:
        expected.sceneId,

      shotId:
        expected.shotId,

      dialogueLineId:
        expected.dialogueLineId,

      planKey:
        expected.planKey,

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
    DialogueCompletion,

  expected:
    DialogueCompletionInput,

  completionPath:
    string,
): void {
  if (
    !matchesRecoveredDialogueEvidence(
      existing,
      expected,
    )
  ) {
    throw new Error(
      `Existing dialogue completion does not match recovered dialogue evidence: ${completionPath}`,
    );
  }
}

export async function recoverDialogueCompletion(
  mediaRoot:
    string,

  input:
    DialogueCompletionInput,

  dependencies:
    RecoverDialogueCompletionDependencies =
      defaultDependencies,
): Promise<
  RecoverDialogueCompletionResult
> {
  const validatedInput =
    DialogueCompletionInputSchema
      .parse(
        input,
      );

  const completionPath =
    createDialogueCompletionPath(
      mediaRoot,
      validatedInput.episodeId,
      validatedInput.sceneId,
      validatedInput.shotId,
      validatedInput.dialogueLineId,
    );

  const existing =
    await dependencies
      .readCompletion(
        mediaRoot,
        validatedInput.episodeId,
        validatedInput.sceneId,
        validatedInput.shotId,
        validatedInput.dialogueLineId,
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
          validatedInput.sceneId,
          validatedInput.shotId,
          validatedInput.dialogueLineId,
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
