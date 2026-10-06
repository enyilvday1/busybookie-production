import {
  createDialogueDirectSeedAudioCompletion,
  type CreateDialogueDirectSeedAudioCompletionResult,
} from "./createDialogueDirectSeedAudioCompletion.js";

import {
  createDialogueDirectSeedAudioCompletionPath,
} from "./dialogueDirectSeedAudioLifecyclePaths.js";

import {
  DialogueCompletionInputSchema,
  type DialogueCompletion,
  type DialogueCompletionInput,
} from "./dialogueCompletion.schema.js";

import {
  readDialogueDirectSeedAudioCompletion,
} from "./readDialogueDirectSeedAudioCompletion.js";

export type RecoverDialogueDirectSeedAudioCompletionDependencies =
  Readonly<{
    readCompletion?:
      typeof readDialogueDirectSeedAudioCompletion;

    createCompletion?:
      typeof createDialogueDirectSeedAudioCompletion;
  }>;

export type RecoverDialogueDirectSeedAudioCompletionResult =
  CreateDialogueDirectSeedAudioCompletionResult;

function completionMatchesInput(
  completion:
    DialogueCompletion,

  input:
    DialogueCompletionInput,
): boolean {
  return (
    completion.reservationId ===
      input.reservationId &&
    completion.episodeId ===
      input.episodeId &&
    completion.sceneId ===
      input.sceneId &&
    completion.shotId ===
      input.shotId &&
    completion.dialogueLineId ===
      input.dialogueLineId &&
    completion.planKey ===
      input.planKey &&
    completion.provider ===
      input.provider &&
    completion.providerExecutionId ===
      input.providerExecutionId &&
    completion.generationRecordPath ===
      input.generationRecordPath
  );
}

function requireMatchingCompletion(
  completion:
    DialogueCompletion,

  input:
    DialogueCompletionInput,
): DialogueCompletion {
  if (
    !completionMatchesInput(
      completion,
      input,
    )
  ) {
    throw new Error(
      "Existing direct SeedAudio completion does not match recovered dialogue evidence.",
    );
  }

  return completion;
}

export async function recoverDialogueDirectSeedAudioCompletion(
  mediaRoot:
    string,

  input:
    DialogueCompletionInput,

  dependencies:
    RecoverDialogueDirectSeedAudioCompletionDependencies = {},
): Promise<
  RecoverDialogueDirectSeedAudioCompletionResult
> {
  const validatedInput =
    DialogueCompletionInputSchema
      .parse(
        input,
      );

  const readCompletion =
    dependencies.readCompletion ??
    readDialogueDirectSeedAudioCompletion;

  const createCompletion =
    dependencies.createCompletion ??
    createDialogueDirectSeedAudioCompletion;

  const completionPath =
    createDialogueDirectSeedAudioCompletionPath(
      mediaRoot,
      validatedInput.episodeId,
      validatedInput.sceneId,
      validatedInput.shotId,
      validatedInput.dialogueLineId,
      validatedInput.planKey,
    );

  const existing =
    await readCompletion(
      mediaRoot,
      validatedInput.episodeId,
      validatedInput.sceneId,
      validatedInput.shotId,
      validatedInput.dialogueLineId,
      validatedInput.planKey,
    );

  if (existing) {
    return Object.freeze({
      record:
        requireMatchingCompletion(
          existing,
          validatedInput,
        ),

      completionPath,
    });
  }

  try {
    return await createCompletion(
      mediaRoot,
      validatedInput,
    );
  } catch (
    createError:
      unknown
  ) {
    const concurrentWinner =
      await readCompletion(
        mediaRoot,
        validatedInput.episodeId,
        validatedInput.sceneId,
        validatedInput.shotId,
        validatedInput.dialogueLineId,
        validatedInput.planKey,
      );

    if (!concurrentWinner) {
      throw createError;
    }

    return Object.freeze({
      record:
        requireMatchingCompletion(
          concurrentWinner,
          validatedInput,
        ),

      completionPath,
    });
  }
}
