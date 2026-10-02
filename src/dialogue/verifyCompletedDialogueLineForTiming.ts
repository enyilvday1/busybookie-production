import type {
  DialogueGenerationOutputRecord,
} from "./dialogueGenerationRecord.schema.js";

import {
  inspectDialogueLifecycle,
} from "./inspectDialogueLifecycle.js";

import {
  reconcileDialogueLifecycle,
  type DialogueLifecycleReconciliationInput,
  type DialogueLifecycleReconciliationResult,
} from "./reconcileDialogueLifecycle.js";

export type VerifyCompletedDialogueLineForTimingInput =
  Omit<
    DialogueLifecycleReconciliationInput,
    "runwayWaitTimeoutMs"
  >;

type DurableDialogueLifecycleReconciliationResult =
  Extract<
    DialogueLifecycleReconciliationResult,
    Readonly<{
      reconciliationMode:
        "DURABLE_COMPLETION";
    }>
  >;

export type VerifiedCompletedDialogueLineForTiming =
  Readonly<
    DurableDialogueLifecycleReconciliationResult & {
      output:
        DialogueGenerationOutputRecord;
    }
  >;

export type VerifyCompletedDialogueLineForTimingDependencies =
  Readonly<{
    inspectLifecycle:
      typeof inspectDialogueLifecycle;

    verifyLifecycle:
      typeof reconcileDialogueLifecycle;
  }>;

const defaultDependencies:
  VerifyCompletedDialogueLineForTimingDependencies =
    Object.freeze({
      inspectLifecycle:
        inspectDialogueLifecycle,

      verifyLifecycle:
        reconcileDialogueLifecycle,
    });

export async function verifyCompletedDialogueLineForTiming(
  input:
    VerifyCompletedDialogueLineForTimingInput,

  dependencies:
    VerifyCompletedDialogueLineForTimingDependencies =
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
      );

  if (
    lifecycle.state !==
    "COMPLETED"
  ) {
    throw new Error(
      `Dialogue timing admission requires COMPLETED lifecycle for ${input.dialogueLineId}; received ${lifecycle.state}.`,
    );
  }

  const cachedInspectLifecycle:
    typeof inspectDialogueLifecycle =
      async () =>
        lifecycle;

  const verified =
    await dependencies
      .verifyLifecycle(
        input,
        {
          inspectLifecycle:
            cachedInspectLifecycle,
        },
      );

  if (
    verified.lifecycleState !==
      "COMPLETED" ||
    verified.reconciliationMode !==
      "DURABLE_COMPLETION"
  ) {
    throw new Error(
      `Dialogue timing admission requires DURABLE_COMPLETION verification for ${input.dialogueLineId}.`,
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
      `Dialogue timing admission requires exactly one verified audio output for ${input.dialogueLineId}; received ${outputs.length}.`,
    );
  }

  const output =
    outputs[0];

  if (!output) {
    throw new Error(
      `Dialogue timing admission verified audio output is missing for ${input.dialogueLineId}.`,
    );
  }

  return Object.freeze({
    ...verified,

    output,
  });
}
