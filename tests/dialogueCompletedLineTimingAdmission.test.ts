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

    it(
      "admits a schema-validated v2 reference-audio durable completion without preparing provider recovery capability",
      async () => {
        const {
          DialogueGenerationRecordSchema,
        } =
          await import(
            "../src/dialogue/dialogueGenerationRecord.schema.js"
          );

        const lifecycle =
          createCompletedLifecycle();

        const generationRecord =
          DialogueGenerationRecordSchema
            .parse({
              schemaVersion:
                "2.0",

              recordedAt:
                "2026-10-05T13:01:00.000Z",

              status:
                "SUCCEEDED",

              provider:
                "RUNWAY",

              providerExecutionId:
                "task-reference-audio-123",

              providerModel:
                "test-reference-audio-model",

              providerCreatedAt:
                "2026-10-05T13:00:00.000Z",

              request: {
                configId:
                  "busybookie-reference-audio-test",

                input: {
                  type:
                    "speech",

                  promptText:
                    "Look what I found!",

                  voice: {
                    type:
                      "reference-audio",

                    audioUri:
                      "runway://uploads/reference-audio-test",
                  },
                },
              },

              routing: {
                configId:
                  "busybookie-reference-audio-test",

                model:
                  "test-reference-audio-model",

                provider:
                  "test-provider",

                estimatedCost: {
                  credits:
                    2,
                },

                resolvedInput: {
                  type:
                    "speech",

                  voice:
                    "reference-audio",
                },

                resolvedSettings: {
                  optimizeFor:
                    "quality",

                  priceCeiling:
                    10,
                },
              },

              credits: {
                locallyExpected:
                  2,

                providerEstimated:
                  2,

                providerFinal:
                  1.75,
              },

              plan: {
                planKey:
                  "a".repeat(
                    64,
                  ),

                episodeId:
                  input.episodeId,

                sceneId:
                  input.sceneId,

                shotId:
                  input.shotId,

                dialogueLineId:
                  input.dialogueLineId,

                lineNumber:
                  1,

                characterId:
                  "OLLIE",

                characterName:
                  "Ollie",

                text:
                  "Look what I found!",

                deliveryNotes:
                  "Curious, excited and gentle.",

                voice: {
                  selectionStatus:
                    "LOCKED",

                  provider:
                    "RUNWAY",

                  voiceName:
                    "Ollie",

                  deliveryTraits: [
                    "young",
                    "curious",
                    "warm",
                    "friendly",
                    "natural",
                  ],

                  executionMode:
                    "RUNWAY_REFERENCE_AUDIO",

                  referenceAudio: {
                    assetId:
                      "OLLIE_VOICE_REFERENCE_V1",

                    mediaRootRelativePath:
                      "references/voices/OLLIE/ollie-reference-v1.mp3",

                    bytes:
                      231_593,

                    sha256:
                      "ad7bc6a50675bddc74a4885f290667fad1076c5cd3d9844eb7ff2d84b0f94a2f",

                    contentType:
                      "audio/mpeg",

                    durationSeconds:
                      14.4,

                    codecName:
                      "mp3",

                    sampleRateHz:
                      44_100,

                    channels:
                      1,
                  },
                },
              },

              outputs: [
                {
                  outputIndex:
                    1,

                  destinationPath:
                    "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_task-reference-audio-123_01.audio",

                  bytes:
                    456,

                  sha256:
                    "c".repeat(
                      64,
                    ),

                  contentType:
                    "audio/mpeg",
                },
              ],
            });

        const verified =
          createDurableVerification(
            generationRecord,
          );

        const inspectLifecycle =
          vi.fn(
            async () =>
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
                  .resumeRunwayReferenceAudioTask,
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
          result
            .generationRecord
            .schemaVersion,
        ).toBe(
          "2.0",
        );

        expect(
          result
            .generationRecord,
        ).toBe(
          generationRecord,
        );

        expect(
          result.output,
        ).toBe(
          generationRecord
            .outputs[0],
        );

        expect(
          result.output
            .destinationPath,
        ).toContain(
          "task-reference-audio-123",
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          verifyLifecycle,
        ).toHaveBeenCalledTimes(
          1,
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
