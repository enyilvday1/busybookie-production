import type {
  DialogueGenerationOutputRecord,
} from "./dialogueGenerationRecord.schema.js";

import {
  createDialogueDirectSeedAudioCompletionPath,
} from "./dialogueDirectSeedAudioLifecyclePaths.js";

import {
  inspectDialogueDirectSeedAudioLifecycle,
} from "./inspectDialogueDirectSeedAudioLifecycle.js";

import {
  reconcileDialogueLifecycle,
  type DialogueLifecycleReconciliationDependencies,
  type DialogueLifecycleReconciliationResult,
} from "./reconcileDialogueLifecycle.js";

import type {
  VerifiedCompletedDialogueLineForTiming,
  VerifyCompletedDialogueLineForTimingInput,
} from "./verifyCompletedDialogueLineForTiming.js";

export type VerifyCompletedDialogueDirectSeedAudioLineForTimingInput =
  Readonly<
    VerifyCompletedDialogueLineForTimingInput & {
      planKey:
        string;
    }
  >;

export type VerifyCompletedDialogueDirectSeedAudioLineForTimingDependencies =
  Readonly<{
    inspectLifecycle:
      typeof inspectDialogueDirectSeedAudioLifecycle;

    verifyLifecycle:
      typeof reconcileDialogueLifecycle;

    resolveCompletionPath:
      typeof createDialogueDirectSeedAudioCompletionPath;
  }>;

const defaultDependencies:
  VerifyCompletedDialogueDirectSeedAudioLineForTimingDependencies =
    Object.freeze({
      inspectLifecycle:
        inspectDialogueDirectSeedAudioLifecycle,

      verifyLifecycle:
        reconcileDialogueLifecycle,

      resolveCompletionPath:
        createDialogueDirectSeedAudioCompletionPath,
    });

function createCachedLifecycleInspector(
  input:
    VerifyCompletedDialogueDirectSeedAudioLineForTimingInput,

  lifecycle:
    Awaited<
      ReturnType<
        typeof inspectDialogueDirectSeedAudioLifecycle
      >
    >,
): DialogueLifecycleReconciliationDependencies[
  "inspectLifecycle"
] {
  return async (
    mediaRoot,
    episodeId,
    sceneId,
    shotId,
    dialogueLineId,
  ) => {
    if (
      mediaRoot !==
        input.mediaRoot ||
      episodeId !==
        input.episodeId ||
      sceneId !==
        input.sceneId ||
      shotId !==
        input.shotId ||
      dialogueLineId !==
        input.dialogueLineId
    ) {
      throw new Error(
        "Cached direct SeedAudio timing lifecycle inspection identity does not match the requested dialogue line.",
      );
    }

    return lifecycle;
  };
}

export async function verifyCompletedDialogueDirectSeedAudioLineForTiming(
  input:
    VerifyCompletedDialogueDirectSeedAudioLineForTimingInput,

  dependencies:
    VerifyCompletedDialogueDirectSeedAudioLineForTimingDependencies =
      defaultDependencies,
): Promise<
  VerifiedCompletedDialogueLineForTiming
> {
  const lifecycle =
    await dependencies
      .inspectLifecycle(
        input.mediaRoot,
        input.episodeId,
        input.sceneId,
        input.shotId,
        input.dialogueLineId,
        input.planKey,
      );

  if (
    lifecycle.state !==
    "COMPLETED"
  ) {
    throw new Error(
      `Direct SeedAudio dialogue timing admission requires COMPLETED lifecycle for ${input.dialogueLineId}; received ${lifecycle.state}.`,
    );
  }

  if (
    lifecycle.submission
      .schemaVersion !==
    "3.0"
  ) {
    throw new Error(
      `Direct SeedAudio dialogue timing admission requires durable v3 lifecycle evidence for ${input.dialogueLineId}.`,
    );
  }

  if (
    lifecycle.submission
      .planKey !==
    input.planKey
  ) {
    throw new Error(
      `Direct SeedAudio dialogue timing admission lifecycle planKey does not match the requested canonical plan for ${input.dialogueLineId}.`,
    );
  }

  const reconciliationInput:
    VerifyCompletedDialogueLineForTimingInput =
      Object.freeze({
        mediaRoot:
          input.mediaRoot,

        episodeId:
          input.episodeId,

        sceneId:
          input.sceneId,

        shotId:
          input.shotId,

        dialogueLineId:
          input.dialogueLineId,
      });

  const cachedInspectLifecycle =
    createCachedLifecycleInspector(
      input,
      lifecycle,
    );

  const verified:
    DialogueLifecycleReconciliationResult =
      await dependencies
        .verifyLifecycle(
          reconciliationInput,
          {
            inspectLifecycle:
              cachedInspectLifecycle,

            resolveCompletionPath:
              dependencies
                .resolveCompletionPath,
          },
        );

  if (
    verified.lifecycleState !==
      "COMPLETED" ||
    verified.reconciliationMode !==
      "DURABLE_COMPLETION"
  ) {
    throw new Error(
      `Direct SeedAudio dialogue timing admission requires DURABLE_COMPLETION verification for ${input.dialogueLineId}.`,
    );
  }

  if (
    verified.generationRecord
      .plan.planKey !==
    input.planKey
  ) {
    throw new Error(
      `Direct SeedAudio dialogue timing admission generation evidence planKey does not match the requested canonical plan for ${input.dialogueLineId}.`,
    );
  }

  const outputs =
    verified
      .generationRecord
      .outputs;

  if (
    outputs.length !==
    1
  ) {
    throw new Error(
      `Direct SeedAudio dialogue timing admission requires exactly one verified audio output for ${input.dialogueLineId}; received ${outputs.length}.`,
    );
  }

  const output:
    DialogueGenerationOutputRecord | undefined =
      outputs[0];

  if (!output) {
    throw new Error(
      `Direct SeedAudio dialogue timing admission verified audio output is missing for ${input.dialogueLineId}.`,
    );
  }

  return Object.freeze({
    ...verified,
    output,
  }) as
    VerifiedCompletedDialogueLineForTiming;
}
