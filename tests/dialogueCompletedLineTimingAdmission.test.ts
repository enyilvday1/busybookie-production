import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  DialogueLifecycleClassification,
} from "../src/dialogue/classifyDialogueLifecycle.js";

import type {
  DialogueGenerationRecord,
} from "../src/dialogue/dialogueGenerationRecord.schema.js";

import {
  type DialogueLifecycleReconciliationDependencies,
  type DialogueLifecycleReconciliationInput,
  type DialogueLifecycleReconciliationResult,
} from "../src/dialogue/reconcileDialogueLifecycle.js";

import {
  verifyCompletedDialogueLineForTiming,
} from "../src/dialogue/verifyCompletedDialogueLineForTiming.js";

const input =
  Object.freeze({
    mediaRoot:
      "D:/Busybookie/Production",

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    dialogueLineId:
      "EP02_SC01_S02_L01",
  });

function createGenerationRecord(
  outputCount:
    number =
      1,
): DialogueGenerationRecord {
  const outputs =
    Array.from(
      {
        length:
          outputCount,
      },
      (
        _value,
        index,
      ) => ({
        outputIndex:
          index +
          1,

        destinationPath:
          `D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_task-dialogue-123_${String(
            index + 1,
          ).padStart(
            2,
            "0",
          )}.audio`,

        bytes:
          123 +
          index,

        sha256:
          String(
            index + 1,
          ).repeat(
            64,
          ),

        contentType:
          "audio/mpeg",
      }),
    );

  return {
    outputs,
  } as unknown as
    DialogueGenerationRecord;
}

function createCompletedLifecycle():
DialogueLifecycleClassification {
  return {
    state:
      "COMPLETED",
  } as unknown as
    DialogueLifecycleClassification;
}

function createDurableVerification(
  generationRecord:
    DialogueGenerationRecord,
): DialogueLifecycleReconciliationResult {
  return {
    lifecycleState:
      "COMPLETED",

    reconciliationMode:
      "DURABLE_COMPLETION",

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-dialogue-123",

    generationRecord,

    generationRecordPath:
      "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_task-dialogue-123.dialogue-generation.json",

    completion:
      {},

    completionPath:
      "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01.dialogue-completion.json",
  } as unknown as
    DialogueLifecycleReconciliationResult;
}

describe(
  "Busybookie completed dialogue line timing admission",
  () => {
    it(
      "admits an already-COMPLETED line using cached local lifecycle verification and returns its sole verified audio output",
      async () => {
        const lifecycle =
          createCompletedLifecycle();

        const generationRecord =
          createGenerationRecord();

        const verified =
          createDurableVerification(
            generationRecord,
          );

        const inspectLifecycle =
          vi.fn(
            async (
              _mediaRoot:
                string,

              _episodeId:
                string,

              _sceneId:
                string,

              _shotId:
                string,

              _dialogueLineId:
                string,
            ):
            Promise<
              DialogueLifecycleClassification
            > =>
              lifecycle,
          );

        const verifyLifecycle =
          vi.fn(
            async (
              verificationInput:
                DialogueLifecycleReconciliationInput,

              dependencies:
                DialogueLifecycleReconciliationDependencies,
            ):
            Promise<
              DialogueLifecycleReconciliationResult
            > => {
              expect(
                verificationInput,
              ).toEqual(
                input,
              );

              expect(
                dependencies
                  .resumeRunwayTask,
              ).toBeUndefined();

              expect(
                dependencies
                  .recoverOutput,
              ).toBeUndefined();

              expect(
                dependencies
                  .recoverGenerationRecord,
              ).toBeUndefined();

              expect(
                dependencies
                  .recoverCompletion,
              ).toBeUndefined();

              const cached =
                await dependencies
                  .inspectLifecycle(
                    input.mediaRoot,
                    input.episodeId,
                    input.sceneId,
                    input.shotId,
                    input.dialogueLineId,
                  );

              expect(
                cached,
              ).toBe(
                lifecycle,
              );

              return verified;
            },
          );

        const result =
          await verifyCompletedDialogueLineForTiming(
            input,
            {
              inspectLifecycle:
                inspectLifecycle as never,

              verifyLifecycle:
                verifyLifecycle as never,
            },
          );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledWith(
          input.mediaRoot,
          input.episodeId,
          input.sceneId,
          input.shotId,
          input.dialogueLineId,
        );

        expect(
          verifyLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result,
        ).toEqual({
          ...verified,

          output:
            generationRecord
              .outputs[0],
        });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(
          true,
        );
      },
    );

    it.each([
      "NOTHING",
      "RESERVED_ONLY",
      "SUBMITTED",
    ] as const)(
      "rejects %s before local verification",
      async (
        state,
      ) => {
        const inspectLifecycle =
          vi.fn(
            async (
              _mediaRoot:
                string,

              _episodeId:
                string,

              _sceneId:
                string,

              _shotId:
                string,

              _dialogueLineId:
                string,
            ):
            Promise<
              DialogueLifecycleClassification
            > =>
              ({
                state,
              }) as
                DialogueLifecycleClassification,
          );

        const verifyLifecycle =
          vi.fn();

        await expect(
          verifyCompletedDialogueLineForTiming(
            input,
            {
              inspectLifecycle:
                inspectLifecycle as never,

              verifyLifecycle:
                verifyLifecycle as never,
            },
          ),
        ).rejects.toThrow(
          /requires COMPLETED.*lifecycle/i,
        );

        expect(
          verifyLifecycle,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects verified dialogue provenance containing more than one audio output instead of silently choosing output 1",
      async () => {
        const lifecycle =
          createCompletedLifecycle();

        const generationRecord =
          createGenerationRecord(
            2,
          );

        const verified =
          createDurableVerification(
            generationRecord,
          );

        const inspectLifecycle =
          vi.fn(
            async (
              _mediaRoot:
                string,

              _episodeId:
                string,

              _sceneId:
                string,

              _shotId:
                string,

              _dialogueLineId:
                string,
            ):
            Promise<
              DialogueLifecycleClassification
            > =>
              lifecycle,
          );

        const verifyLifecycle =
          vi.fn(
            async (
              _verificationInput:
                DialogueLifecycleReconciliationInput,

              _dependencies:
                DialogueLifecycleReconciliationDependencies,
            ):
            Promise<
              DialogueLifecycleReconciliationResult
            > =>
              verified,
          );

        await expect(
          verifyCompletedDialogueLineForTiming(
            input,
            {
              inspectLifecycle:
                inspectLifecycle as never,

              verifyLifecycle:
                verifyLifecycle as never,
            },
          ),
        ).rejects.toThrow(
          /exactly one verified.*audio output|exactly one.*output/i,
        );
      },
    );

    it(
      "rejects a verification result that is not DURABLE_COMPLETION",
      async () => {
        const lifecycle =
          createCompletedLifecycle();

        const durable =
          createDurableVerification(
            createGenerationRecord(),
          );

        const recovered =
          {
            ...durable,

            reconciliationMode:
              "RECOVERED_SUBMISSION",
          } as unknown as
            DialogueLifecycleReconciliationResult;

        const inspectLifecycle =
          vi.fn(
            async (
              _mediaRoot:
                string,

              _episodeId:
                string,

              _sceneId:
                string,

              _shotId:
                string,

              _dialogueLineId:
                string,
            ):
            Promise<
              DialogueLifecycleClassification
            > =>
              lifecycle,
          );

        const verifyLifecycle =
          vi.fn(
            async (
              _verificationInput:
                DialogueLifecycleReconciliationInput,

              _dependencies:
                DialogueLifecycleReconciliationDependencies,
            ):
            Promise<
              DialogueLifecycleReconciliationResult
            > =>
              recovered,
          );

        await expect(
          verifyCompletedDialogueLineForTiming(
            input,
            {
              inspectLifecycle:
                inspectLifecycle as never,

              verifyLifecycle:
                verifyLifecycle as never,
            },
          ),
        ).rejects.toThrow(
          /DURABLE_COMPLETION/i,
        );
      },
    );
  },
);
