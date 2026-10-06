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
  CreateDialogueDirectSeedAudioReservationResult,
} from "../src/dialogue/createDialogueDirectSeedAudioReservation.js";

import type {
  CreateDialogueDirectSeedAudioSubmissionResult,
} from "../src/dialogue/createDialogueDirectSeedAudioSubmission.js";

import {
  executeDialogueDirectSeedAudioLine,
  type ExecuteDialogueDirectSeedAudioLineDependencies,
} from "../src/dialogue/executeDialogueDirectSeedAudioLine.js";

import type {
  DialogueDirectSeedAudioSubmissionInput,
} from "../src/dialogue/dialogueSubmission.schema.js";

import type {
  RecoverDialogueDirectSeedAudioCompletionResult,
} from "../src/dialogue/recoverDialogueDirectSeedAudioCompletion.js";

import type {
  DialogueDirectSeedAudioGenerationRecoveryMetadata,
  RunwayDirectSeedAudioDialogueTransactionInput,
  RunwayDirectSeedAudioDialogueTransactionResult,
} from "../src/dialogue/runRunwayDirectSeedAudioDialogueTransaction.js";

const PLAN_KEY =
  "a".repeat(
    64,
  );

const RESERVATION_ID =
  "11111111-1111-4111-8111-111111111111";

const TASK_ID =
  "task-seed-audio-lifecycle-1";

const MEDIA_ROOT =
  "D:/Busybookie/Production";

const GENERATION_RECORD_PATH =
  "D:/Busybookie/Production/generated-dialogue/EP02/S02/generation-record.json";

function createReferenceAudio() {
  return {
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
  } as const;
}

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

          referenceAudio:
            createReferenceAudio(),
        },
      },
    ],

    planKey:
      PLAN_KEY,
  };
}

function createPlanSnapshot():
DialogueDirectSeedAudioGenerationRecoveryMetadata["plan"] {
  return {
    planKey:
      PLAN_KEY,

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

      referenceAudio:
        createReferenceAudio(),
    },
  };
}

function createRecoveryMetadata():
DialogueDirectSeedAudioGenerationRecoveryMetadata {
  return {
    request: {
      model:
        "seed_audio",

      promptText:
        "Look what I found!",

      voice: {
        type:
          "reference-audio",

        audioUri:
          "runway://ephemeral/ollie-reference-v1",
      },
    },

    localCreditCeiling:
      30,

    plan:
      createPlanSnapshot(),
  };
}

function createReservationResult():
CreateDialogueDirectSeedAudioReservationResult {
  return {
    record: {
      schemaVersion:
        "1.0",

      reservationId:
        RESERVATION_ID,

      reservedAt:
        "2026-10-06T13:00:00.000Z",

      status:
        "RESERVED",

      episodeId:
        "EP02",

      sceneId:
        "SC01",

      shotId:
        "S02",

      dialogueLineId:
        "EP02_SC01_S02_L01",

      planKey:
        PLAN_KEY,

      provider:
        "RUNWAY",
    },

    reservationPath:
      "D:/Busybookie/Production/dialogue-reservation.json",
  };
}

function createSubmissionResult(
  recoveryMetadata:
    DialogueDirectSeedAudioGenerationRecoveryMetadata,
):
CreateDialogueDirectSeedAudioSubmissionResult {
  return {
    record: {
      schemaVersion:
        "3.0",

      submittedAt:
        "2026-10-06T13:00:01.000Z",

      status:
        "SUBMITTED",

      reservationId:
        RESERVATION_ID,

      episodeId:
        "EP02",

      sceneId:
        "SC01",

      shotId:
        "S02",

      dialogueLineId:
        "EP02_SC01_S02_L01",

      planKey:
        PLAN_KEY,

      provider:
        "RUNWAY",

      providerExecutionId:
        TASK_ID,

      providerEstimatedCredits:
        5.25,

      recoveryMetadata,
    },

    submissionPath:
      "D:/Busybookie/Production/dialogue-submission.json",
  };
}

function createProviderExecution(
  recoveryMetadata:
    DialogueDirectSeedAudioGenerationRecoveryMetadata,
):
RunwayDirectSeedAudioDialogueTransactionResult {
  return {
    record: {
      schemaVersion:
        "3.0",

      recordedAt:
        "2026-10-06T13:00:02.000Z",

      status:
        "SUCCEEDED",

      provider:
        "RUNWAY",

      providerExecutionId:
        TASK_ID,

      providerModel:
        "seed_audio",

      providerCreatedAt:
        "2026-10-06T13:00:01.000Z",

      request:
        recoveryMetadata.request,

      credits: {
        localCeiling:
          30,

        providerEstimated:
          5.25,

        providerFinal:
          4.75,
      },

      plan:
        recoveryMetadata.plan,

      outputs: [
        {
          outputIndex:
            1,

          destinationPath:
            "D:/Busybookie/Production/generated-dialogue/EP02/S02/EP02_SC01_S02_L01_RUNWAY_task-seed-audio-lifecycle-1_01.audio",

          bytes:
            1_234,

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
      GENERATION_RECORD_PATH,
  };
}

function createCompletionResult():
RecoverDialogueDirectSeedAudioCompletionResult {
  return {
    record: {
      schemaVersion:
        "1.0",

      completedAt:
        "2026-10-06T13:00:03.000Z",

      status:
        "COMPLETED",

      reservationId:
        RESERVATION_ID,

      episodeId:
        "EP02",

      sceneId:
        "SC01",

      shotId:
        "S02",

      dialogueLineId:
        "EP02_SC01_S02_L01",

      planKey:
        PLAN_KEY,

      provider:
        "RUNWAY",

      providerExecutionId:
        TASK_ID,

      generationRecordPath:
        GENERATION_RECORD_PATH,
    },

    completionPath:
      "D:/Busybookie/Production/dialogue-completion.json",
  };
}

type SubmissionAcceptedHandler =
  (
    acceptance:
      Readonly<{
        taskId:
          string;

        providerEstimatedCredits:
          number;

        recoveryMetadata:
          DialogueDirectSeedAudioGenerationRecoveryMetadata;
      }>,
  ) =>
    Promise<void>;

function createHarness() {
  const callOrder:
    string[] = [];

  const recoveryMetadata =
    createRecoveryMetadata();

  const reservation =
    createReservationResult();

  const submission =
    createSubmissionResult(
      recoveryMetadata,
    );

  const providerExecution =
    createProviderExecution(
      recoveryMetadata,
    );

  const completion =
    createCompletionResult();

  const createReservation =
    vi.fn(
      async () => {
        callOrder.push(
          "reservation",
        );

        return reservation;
      },
    );

  const createSubmission =
    vi.fn(
      async (
        _mediaRoot:
          string,

        input:
          DialogueDirectSeedAudioSubmissionInput,
      ) => {
        callOrder.push(
          "submission",
        );

        expect(
          input,
        ).toEqual({
          reservationId:
            RESERVATION_ID,

          episodeId:
            "EP02",

          sceneId:
            "SC01",

          shotId:
            "S02",

          dialogueLineId:
            "EP02_SC01_S02_L01",

          planKey:
            PLAN_KEY,

          provider:
            "RUNWAY",

          providerExecutionId:
            TASK_ID,

          providerEstimatedCredits:
            5.25,

          recoveryMetadata,
        });

        return submission;
      },
    );

  const runTransaction =
    vi.fn(
      async (
        input:
          RunwayDirectSeedAudioDialogueTransactionInput,

        onSubmissionAccepted:
          SubmissionAcceptedHandler,
      ) => {
        callOrder.push(
          "transaction",
        );

        expect(
          input,
        ).toEqual({
          plan:
            createPlan(),

          dialogueLineId:
            "EP02_SC01_S02_L01",

          mediaRoot:
            MEDIA_ROOT,

          ffprobeExecutable:
            "ffprobe",

          localCreditCeiling:
            30,

          waitTimeoutMs:
            600_000,
        });

        await onSubmissionAccepted({
          taskId:
            TASK_ID,

          providerEstimatedCredits:
            5.25,

          recoveryMetadata,
        });

        return providerExecution;
      },
    );

  const recoverCompletion =
    vi.fn(
      async () => {
        callOrder.push(
          "completion",
        );

        return completion;
      },
    );

  const dependencies = {
    createReservation,
    createSubmission,
    runTransaction,
    recoverCompletion,
  } satisfies
    ExecuteDialogueDirectSeedAudioLineDependencies;

  return {
    callOrder,
    recoveryMetadata,
    reservation,
    submission,
    providerExecution,
    completion,
    dependencies,
    createReservation,
    createSubmission,
    runTransaction,
    recoverCompletion,
  };
}

describe(
  "BusyBookie direct SeedAudio paid dialogue lifecycle",
  () => {
    it(
      "creates reservation, durably records accepted v3 submission before transaction completion, then writes completion",
      async () => {
        const harness =
          createHarness();

        const plan =
          createPlan();

        const result =
          await executeDialogueDirectSeedAudioLine(
            {
              plan,

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,

              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          );

        expect(
          harness.callOrder,
        ).toEqual([
          "reservation",
          "transaction",
          "submission",
          "completion",
        ]);

        expect(
          harness.createReservation,
        ).toHaveBeenCalledWith(
          MEDIA_ROOT,
          {
            episodeId:
              "EP02",

            sceneId:
              "SC01",

            shotId:
              "S02",

            dialogueLineId:
              "EP02_SC01_S02_L01",

            planKey:
              PLAN_KEY,

            provider:
              "RUNWAY",
          },
        );

        expect(
          harness.createSubmission,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.recoverCompletion,
        ).toHaveBeenCalledWith(
          MEDIA_ROOT,
          {
            reservationId:
              RESERVATION_ID,

            episodeId:
              "EP02",

            sceneId:
              "SC01",

            shotId:
              "S02",

            dialogueLineId:
              "EP02_SC01_S02_L01",

            planKey:
              PLAN_KEY,

            provider:
              "RUNWAY",

            providerExecutionId:
              TASK_ID,

            generationRecordPath:
              GENERATION_RECORD_PATH,
          },
        );

        expect(
          result,
        ).toEqual({
          reservation:
            harness.reservation,

          submission:
            harness.submission,

          providerExecution:
            harness.providerExecution,

          completion:
            harness.completion,
        });
      },
    );

    it(
      "requires explicit paid-generation confirmation before creating a reservation",
      async () => {
        const harness =
          createHarness();

        await expect(
          executeDialogueDirectSeedAudioLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,

              confirmPaidGeneration:
                false,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /paid-generation confirmation.*before creating.*reservation/i,
        );

        expect(
          harness.createReservation,
        ).not.toHaveBeenCalled();

        expect(
          harness.runTransaction,
        ).not.toHaveBeenCalled();

        expect(
          harness.createSubmission,
        ).not.toHaveBeenCalled();

        expect(
          harness.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a non-reference-audio voice before creating a reservation",
      async () => {
        const harness =
          createHarness();

        const plan =
          createPlan();

        const invalidPlan = {
          ...plan,

          lines: [
            {
              ...plan.lines[0]!,

              voice: {
                provider:
                  "RUNWAY" as const,

                voiceName:
                  "Chad",

                deliveryTraits: [
                  "young",
                  "curious",
                  "warm",
                ],
              },
            },
          ],
        } satisfies
          ShotDialoguePlan;

        await expect(
          executeDialogueDirectSeedAudioLine(
            {
              plan:
                invalidPlan,

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,

              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /RUNWAY_REFERENCE_AUDIO|reference-audio/i,
        );

        expect(
          harness.createReservation,
        ).not.toHaveBeenCalled();

        expect(
          harness.runTransaction,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when provider execution completes without durable submission acceptance",
      async () => {
        const harness =
          createHarness();

        harness
          .runTransaction
          .mockImplementationOnce(
            async () =>
              harness.providerExecution,
          );

        await expect(
          executeDialogueDirectSeedAudioLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,

              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /without durable submission acceptance/i,
        );

        expect(
          harness.createSubmission,
        ).not.toHaveBeenCalled();

        expect(
          harness.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when completed provider execution ID differs from the durably accepted task ID",
      async () => {
        const harness =
          createHarness();

        harness
          .runTransaction
          .mockImplementationOnce(
            async (
              _input,
              onSubmissionAccepted,
            ) => {
              await onSubmissionAccepted({
                taskId:
                  TASK_ID,

                providerEstimatedCredits:
                  5.25,

                recoveryMetadata:
                  harness
                    .recoveryMetadata,
              });

              return {
                ...harness
                  .providerExecution,

                record: {
                  ...harness
                    .providerExecution
                    .record,

                  providerExecutionId:
                    "different-task-id",
                },
              };
            },
          );

        await expect(
          executeDialogueDirectSeedAudioLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,

              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /does not match accepted submission ID/i,
        );

        expect(
          harness.createSubmission,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );
    it(
      "rejects an empty accepted provider task ID before durable submission",
      async () => {
        const harness =
          createHarness();

        harness
          .runTransaction
          .mockImplementationOnce(
            async (
              _input,
              onSubmissionAccepted,
            ) => {
              await onSubmissionAccepted({
                taskId:
                  "   ",

                providerEstimatedCredits:
                  5.25,

                recoveryMetadata:
                  harness
                    .recoveryMetadata,
              });

              return harness
                .providerExecution;
            },
          );

        await expect(
          executeDialogueDirectSeedAudioLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,

              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /empty task ID/i,
        );

        expect(
          harness.createSubmission,
        ).not.toHaveBeenCalled();

        expect(
          harness.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a nonfinite accepted provider estimate before durable submission",
      async () => {
        const harness =
          createHarness();

        harness
          .runTransaction
          .mockImplementationOnce(
            async (
              _input,
              onSubmissionAccepted,
            ) => {
              await onSubmissionAccepted({
                taskId:
                  TASK_ID,

                providerEstimatedCredits:
                  Number.NaN,

                recoveryMetadata:
                  harness
                    .recoveryMetadata,
              });

              return harness
                .providerExecution;
            },
          );

        await expect(
          executeDialogueDirectSeedAudioLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,

              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /estimated credits.*finite and nonnegative/i,
        );

        expect(
          harness.createSubmission,
        ).not.toHaveBeenCalled();

        expect(
          harness.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects duplicate provider submission acceptance without writing a second durable submission",
      async () => {
        const harness =
          createHarness();

        harness
          .runTransaction
          .mockImplementationOnce(
            async (
              _input,
              onSubmissionAccepted,
            ) => {
              const acceptance = {
                taskId:
                  TASK_ID,

                providerEstimatedCredits:
                  5.25,

                recoveryMetadata:
                  harness
                    .recoveryMetadata,
              };

              await onSubmissionAccepted(
                acceptance,
              );

              await onSubmissionAccepted(
                acceptance,
              );

              return harness
                .providerExecution;
            },
          );

        await expect(
          executeDialogueDirectSeedAudioLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,

              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /acceptance was received more than once/i,
        );

        expect(
          harness.createSubmission,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "propagates durable submission persistence failure and never writes completion",
      async () => {
        const harness =
          createHarness();

        harness
          .createSubmission
          .mockRejectedValueOnce(
            new Error(
              "durable submission write failed",
            ),
          );

        await expect(
          executeDialogueDirectSeedAudioLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,

              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /durable submission write failed/i,
        );

        expect(
          harness.createSubmission,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects provider estimated-credit drift after durable acceptance",
      async () => {
        const harness =
          createHarness();

        harness
          .runTransaction
          .mockImplementationOnce(
            async (
              _input,
              onSubmissionAccepted,
            ) => {
              await onSubmissionAccepted({
                taskId:
                  TASK_ID,

                providerEstimatedCredits:
                  5.25,

                recoveryMetadata:
                  harness
                    .recoveryMetadata,
              });

              return {
                ...harness
                  .providerExecution,

                record: {
                  ...harness
                    .providerExecution
                    .record,

                  credits: {
                    ...harness
                      .providerExecution
                      .record
                      .credits,

                    providerEstimated:
                      5.5,
                  },
                },
              };
            },
          );

        await expect(
          executeDialogueDirectSeedAudioLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,

              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /estimated credits do not match the durable submission/i,
        );

        expect(
          harness.createSubmission,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects generation-record canonical identity drift before completion",
      async () => {
        const harness =
          createHarness();

        harness
          .runTransaction
          .mockImplementationOnce(
            async (
              _input,
              onSubmissionAccepted,
            ) => {
              await onSubmissionAccepted({
                taskId:
                  TASK_ID,

                providerEstimatedCredits:
                  5.25,

                recoveryMetadata:
                  harness
                    .recoveryMetadata,
              });

              return {
                ...harness
                  .providerExecution,

                record: {
                  ...harness
                    .providerExecution
                    .record,

                  plan: {
                    ...harness
                      .providerExecution
                      .record
                      .plan,

                    shotId:
                      "S03",
                  },
                },
              };
            },
          );

        await expect(
          executeDialogueDirectSeedAudioLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,

              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /generation record identity does not match the reserved canonical plan/i,
        );

        expect(
          harness.createSubmission,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects an empty durable generation-record path before completion",
      async () => {
        const harness =
          createHarness();

        harness
          .runTransaction
          .mockImplementationOnce(
            async (
              _input,
              onSubmissionAccepted,
            ) => {
              await onSubmissionAccepted({
                taskId:
                  TASK_ID,

                providerEstimatedCredits:
                  5.25,

                recoveryMetadata:
                  harness
                    .recoveryMetadata,
              });

              return {
                ...harness
                  .providerExecution,

                recordPath:
                  "   ",
              };
            },
          );

        await expect(
          executeDialogueDirectSeedAudioLine(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,

              confirmPaidGeneration:
                true,
            },
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /empty generation record path/i,
        );

        expect(
          harness.createSubmission,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          harness.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

  },
);
