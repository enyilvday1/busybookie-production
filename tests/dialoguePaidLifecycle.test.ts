import {
  join,
} from "node:path";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  ShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import type {
  CreateDialogueReservationResult,
} from "../src/dialogue/createDialogueReservation.js";

import type {
  DialogueReservationInput,
} from "../src/dialogue/dialogueReservation.schema.js";

import type {
  CreateDialogueSubmissionResult,
} from "../src/dialogue/createDialogueSubmission.js";

import type {
  DialogueSubmissionInput,
} from "../src/dialogue/dialogueSubmission.schema.js";

import type {
  DialogueGenerationRecoveryMetadata,
  RunwayElevenV3DialogueTransactionInput,
  RunwayElevenV3DialogueTransactionResult,
} from "../src/dialogue/runRunwayElevenV3Transaction.js";

import type {
  DialogueCompletionInput,
} from "../src/dialogue/dialogueCompletion.schema.js";

import type {
  RecoverDialogueCompletionResult,
} from "../src/dialogue/recoverDialogueCompletion.js";

import {
  executeDialogueLine,
} from "../src/dialogue/executeDialogueLine.js";

import {
  loadDialogueVoicePolicy,
} from "../src/validation/loadDialogueVoicePolicy.js";

const mediaRoot =
  "D:/Busybookie/Production";

const reservationId =
  "11111111-1111-4111-8111-111111111111";

const planKey =
  "a".repeat(
    64,
  );

function createPlan():
  ShotDialoguePlan {
  return {
    schemaVersion:
      "1.0",

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    shotDurationSeconds:
      6,

    videoGeneration: {
      provider:
        "VEO",

      nativeAudio:
        true,
    },

    lines: [
      {
        lineNumber:
          1,

        dialogueLineId:
          "EP02_SC01_S02_L01",

        characterId:
          "OLLIE",

        characterName:
          "Ollie",

        text:
          "Look what I found!",

        deliveryNotes:
          "Curious, excited and gentle.",

        voice: {
          provider:
            "RUNWAY",

          voiceName:
            "Chad",

          deliveryTraits: [
            "young",
            "curious",
            "warm",
            "friendly",
            "natural",
          ],
        },
      },
    ],

    planKey,
  };
}

function createRecoveryMetadata():
  DialogueGenerationRecoveryMetadata {
  return {
    request: {
      model:
        "eleven_v3",

      promptText:
        "Look what I found!",

      voice: {
        type:
          "runway-preset",

        presetId:
          "Chad",
      },

      applyTextNormalization:
        "auto",

      languageCode:
        "en",

      seed:
        0,

      similarityBoost:
        0.75,

      speed:
        1,

      stability:
        0.5,

      style:
        0,

      useSpeakerBoost:
        true,
    },

    locallyExpectedCredits:
      1,

    plan: {
      planKey,

      episodeId:
        "EP02",

      sceneId:
        "SC01",

      shotId:
        "S02",

      dialogueLineId:
        "EP02_SC01_S02_L01",

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
        provider:
          "RUNWAY",

        voiceName:
          "Chad",

        deliveryTraits: [
          "young",
          "curious",
          "warm",
          "friendly",
          "natural",
        ],
      },
    },
  };
}

type SubmissionAcceptance =
  Readonly<{
    taskId:
      string;

    providerEstimatedCredits:
      number;

    recoveryMetadata:
      DialogueGenerationRecoveryMetadata;
  }>;

type SubmissionAcceptedHandler =
  (
    acceptance:
      SubmissionAcceptance,
  ) =>
    Promise<void>;

function createTransactionResult(
  taskId:
    string,
): RunwayElevenV3DialogueTransactionResult {
  return {
    record: {
      schemaVersion:
        "1.0",

      recordedAt:
        "2026-10-01T22:30:00.000Z",

      status:
        "SUCCEEDED",

      provider:
        "RUNWAY",

      providerExecutionId:
        taskId,

      providerModel:
        "eleven_v3",

      providerCreatedAt:
        "2026-10-01T22:29:30.000Z",

      request:
        createRecoveryMetadata()
          .request,

      credits: {
        locallyExpected:
          1,

        providerEstimated:
          1,

        providerFinal:
          1,
      },

      plan:
        createRecoveryMetadata()
          .plan,

      outputs: [
        {
          outputIndex:
            1,

          destinationPath:
            join(
              mediaRoot,
              "voices",
              "EP02",
              "S02",
              "EP02_SC01_S02_L01",
              `EP02_SC01_S02_L01_RUNWAY_${taskId}_01.audio`,
            ),

          bytes:
            123,

          sha256:
            "b".repeat(
              64,
            ),

          contentType:
            "audio/mpeg",
        },
      ],
    },

    recordPath:
      join(
        mediaRoot,
        "voices",
        "EP02",
        "S02",
        "EP02_SC01_S02_L01",
        `EP02_SC01_S02_L01_RUNWAY_${taskId}.dialogue-generation.json`,
      ),
  };
}

function createMocks(
  events:
    string[],
) {
  const createReservation =
    vi.fn(
      async (
        root:
          string,

        input:
          DialogueReservationInput,
      ): Promise<
        CreateDialogueReservationResult
      > => {
        events.push(
          "reservation",
        );

        return {
          record: {
            schemaVersion:
              "1.0",

            reservationId,

            reservedAt:
              "2026-10-01T22:28:00.000Z",

            status:
              "RESERVED",

            ...input,
          },

          reservationPath:
            join(
              root,
              "voices",
              input.episodeId,
              input.shotId,
              input.dialogueLineId,
              `${input.dialogueLineId}.dialogue-reservation.json`,
            ),
        };
      },
    );

  const createSubmission =
    vi.fn(
      async (
        root:
          string,

        input:
          DialogueSubmissionInput,
      ): Promise<
        CreateDialogueSubmissionResult
      > => {
        events.push(
          "submission",
        );

        return {
          record: {
            schemaVersion:
              "1.0",

            submittedAt:
              "2026-10-01T22:29:00.000Z",

            status:
              "SUBMITTED",

            ...input,
          },

          submissionPath:
            join(
              root,
              "voices",
              input.episodeId,
              input.shotId,
              input.dialogueLineId,
              `${input.dialogueLineId}.dialogue-submission.json`,
            ),
        };
      },
    );

  const runTransaction =
    vi.fn(
      async (
        _input:
          RunwayElevenV3DialogueTransactionInput,

        onSubmissionAccepted:
          SubmissionAcceptedHandler,
      ): Promise<
        RunwayElevenV3DialogueTransactionResult
      > => {
        events.push(
          "provider-accepted",
        );

        await onSubmissionAccepted({
          taskId:
            "task-dialogue-123",

          providerEstimatedCredits:
            1,

          recoveryMetadata:
            createRecoveryMetadata(),
        });

        events.push(
          "provider-complete",
        );

        return createTransactionResult(
          "task-dialogue-123",
        );
      },
    );

  const recoverCompletion =
    vi.fn(
      async (
        root:
          string,

        input:
          DialogueCompletionInput,
      ): Promise<
        RecoverDialogueCompletionResult
      > => {
        events.push(
          "completion",
        );

        return {
          record: {
            schemaVersion:
              "1.0",

            completedAt:
              "2026-10-01T22:31:00.000Z",

            status:
              "COMPLETED",

            ...input,
          },

          completionPath:
            join(
              root,
              "voices",
              input.episodeId,
              input.shotId,
              input.dialogueLineId,
              `${input.dialogueLineId}.dialogue-completion.json`,
            ),
        };
      },
    );

  return {
    createReservation,
    createSubmission,
    runTransaction,
    recoverCompletion,
  };
}

describe(
  "Busybookie dialogue paid-generation lifecycle",
  () => {
    it(
      "orders reservation, accepted-task persistence, provider completion, and completion receipt",
      async () => {
        const events:
          string[] = [];

        const mocks =
          createMocks(
            events,
          );

        const policy =
          await loadDialogueVoicePolicy();

        const result =
          await executeDialogueLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot,

              policy,

              confirmPaidGeneration:
                true,
            },
            mocks,
          );

        expect(
          events,
        ).toEqual([
          "reservation",
          "provider-accepted",
          "submission",
          "provider-complete",
          "completion",
        ]);

        expect(
          mocks.createReservation,
        ).toHaveBeenCalledWith(
          mediaRoot,
          {
            episodeId:
              "EP02",

            sceneId:
              "SC01",

            shotId:
              "S02",

            dialogueLineId:
              "EP02_SC01_S02_L01",

            planKey,

            provider:
              "RUNWAY",
          },
        );

        expect(
          mocks.createSubmission,
        ).toHaveBeenCalledWith(
          mediaRoot,
          expect.objectContaining({
            reservationId,

            episodeId:
              "EP02",

            sceneId:
              "SC01",

            shotId:
              "S02",

            dialogueLineId:
              "EP02_SC01_S02_L01",

            planKey,

            provider:
              "RUNWAY",

            providerExecutionId:
              "task-dialogue-123",

            providerEstimatedCredits:
              1,

            recoveryMetadata:
              createRecoveryMetadata(),
          }),
        );

        expect(
          mocks.recoverCompletion,
        ).toHaveBeenCalledWith(
          mediaRoot,
          {
            reservationId,

            episodeId:
              "EP02",

            sceneId:
              "SC01",

            shotId:
              "S02",

            dialogueLineId:
              "EP02_SC01_S02_L01",

            planKey,

            provider:
              "RUNWAY",

            providerExecutionId:
              "task-dialogue-123",

            generationRecordPath:
              result.providerExecution
                .recordPath,
          },
        );

        expect(
          result.submission.record
            .providerExecutionId,
        ).toBe(
          result.providerExecution
            .record
            .providerExecutionId,
        );
      },
    );

    it(
      "blocks before reservation when paid generation is not explicitly confirmed",
      async () => {
        const events:
          string[] = [];

        const mocks =
          createMocks(
            events,
          );

        const policy =
          await loadDialogueVoicePolicy();

        await expect(
          executeDialogueLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot,

              policy,

              confirmPaidGeneration:
                false,
            },
            mocks,
          ),
        ).rejects.toThrow(
          /paid-generation confirmation/i,
        );

        expect(
          mocks.createReservation,
        ).not.toHaveBeenCalled();

        expect(
          mocks.runTransaction,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed before provider continuation when durable submission persistence fails",
      async () => {
        const events:
          string[] = [];

        const mocks =
          createMocks(
            events,
          );

        mocks.createSubmission
          .mockImplementationOnce(
            async () => {
              events.push(
                "submission",
              );

              throw new Error(
                "Mock dialogue submission persistence failure.",
              );
            },
          );

        const policy =
          await loadDialogueVoicePolicy();

        await expect(
          executeDialogueLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot,

              policy,

              confirmPaidGeneration:
                true,
            },
            mocks,
          ),
        ).rejects.toThrow(
          /submission persistence failure/i,
        );

        expect(
          events,
        ).toEqual([
          "reservation",
          "provider-accepted",
          "submission",
        ]);

        expect(
          mocks.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when provider execution completes without durable submission acceptance",
      async () => {
        const events:
          string[] = [];

        const mocks =
          createMocks(
            events,
          );

        mocks.runTransaction
          .mockImplementationOnce(
            async () => {
              events.push(
                "provider-complete",
              );

              return createTransactionResult(
                "task-dialogue-123",
              );
            },
          );

        const policy =
          await loadDialogueVoicePolicy();

        await expect(
          executeDialogueLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot,

              policy,

              confirmPaidGeneration:
                true,
            },
            mocks,
          ),
        ).rejects.toThrow(
          /without durable submission acceptance/i,
        );

        expect(
          mocks.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when completed provider task ID differs from the durably accepted task ID",
      async () => {
        const events:
          string[] = [];

        const mocks =
          createMocks(
            events,
          );

        mocks.runTransaction
          .mockImplementationOnce(
            async (
              _input,
              onSubmissionAccepted,
            ) => {
              events.push(
                "provider-accepted",
              );

              await onSubmissionAccepted({
                taskId:
                  "task-dialogue-123",

                providerEstimatedCredits:
                  1,

                recoveryMetadata:
                  createRecoveryMetadata(),
              });

              events.push(
                "provider-complete",
              );

              return createTransactionResult(
                "task-dialogue-conflict",
              );
            },
          );

        const policy =
          await loadDialogueVoicePolicy();

        await expect(
          executeDialogueLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot,

              policy,

              confirmPaidGeneration:
                true,
            },
            mocks,
          ),
        ).rejects.toThrow(
          /does not match accepted submission ID/i,
        );

        expect(
          mocks.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
