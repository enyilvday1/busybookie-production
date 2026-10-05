import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createDialogueAudioOutputPath,
} from "../src/dialogue/dialogueAudioOutputPath.js";

import {
  createDialogueCompletionPath,
} from "../src/dialogue/dialogueCompletionPath.js";

import type {
  DialogueCompletion,
} from "../src/dialogue/dialogueCompletion.schema.js";

import {
  createDialogueGenerationRecordPath,
} from "../src/dialogue/dialogueGenerationRecordPath.js";

import type {
  DialogueGenerationRecord,
} from "../src/dialogue/dialogueGenerationRecord.schema.js";

import type {
  DialogueLifecycleClassification,
} from "../src/dialogue/classifyDialogueLifecycle.js";

import {
  reconcileDialogueLifecycle,
  type DialogueLifecycleReconciliationDependencies,
} from "../src/dialogue/reconcileDialogueLifecycle.js";

import type {
  DialogueReservation,
} from "../src/dialogue/dialogueReservation.schema.js";

import type {
  DialogueSubmission,
} from "../src/dialogue/dialogueSubmission.schema.js";

const mediaRoot =
  "D:/Busybookie/Production";

const identity =
  Object.freeze({
    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    dialogueLineId:
      "EP02_SC01_S02_L01",
  });

const planKey =
  "a".repeat(
    64,
  );

const reservation:
  DialogueReservation = {
    schemaVersion:
      "1.0",

    reservationId:
      "11111111-1111-4111-8111-111111111111",

    reservedAt:
      "2026-10-02T08:00:00.000Z",

    status:
      "RESERVED",

    ...identity,

    planKey,

    provider:
      "RUNWAY",
  };

const recoveryMetadata =
  Object.freeze({
    request: {
      model:
        "eleven_v3" as const,

      promptText:
        "Look what I found!",

      voice: {
        type:
          "runway-preset" as const,

        presetId:
          "Chad" as const,
      },

      applyTextNormalization:
        "auto" as const,

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

      ...identity,

      lineNumber:
        1,

      characterId:
        "OLLIE" as const,

      characterName:
        "Ollie",

      text:
        "Look what I found!",

      deliveryNotes:
        "Curious, excited and gentle.",

      voice: {
        provider:
          "RUNWAY" as const,

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
  });

const submission:
  DialogueSubmission = {
    schemaVersion:
      "1.0",

    submittedAt:
      "2026-10-02T08:01:00.000Z",

    status:
      "SUBMITTED",

    reservationId:
      reservation.reservationId,

    ...identity,

    planKey,

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-dialogue-123",

    providerEstimatedCredits:
      1,

    recoveryMetadata,
  };

const referenceAudioSubmission:
  Extract<
    DialogueSubmission,
    { schemaVersion: "2.0" }
  > = {
    schemaVersion:
      "2.0",

    submittedAt:
      "2026-10-05T09:00:00.000Z",

    status:
      "SUBMITTED",

    reservationId:
      reservation.reservationId,

    ...identity,

    planKey,

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-reference-audio-123",

    providerEstimatedCredits:
      2,

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

    recoveryMetadata: {
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

      locallyExpectedCredits:
        2,

      plan: {
        planKey,

        ...identity,

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
    },
  };

const generationRecordPath =
  createDialogueGenerationRecordPath(
    mediaRoot,
    identity.episodeId,
    identity.shotId,
    identity.dialogueLineId,
    "RUNWAY",
    submission.providerExecutionId,
  );

const audioOutputPath =
  createDialogueAudioOutputPath(
    mediaRoot,
    identity.episodeId,
    identity.shotId,
    identity.dialogueLineId,
    "RUNWAY",
    submission.providerExecutionId,
    1,
  );

const completionPath =
  createDialogueCompletionPath(
    mediaRoot,
    identity.episodeId,
    identity.sceneId,
    identity.shotId,
    identity.dialogueLineId,
  );

const generationRecord:
  DialogueGenerationRecord = {
    schemaVersion:
      "1.0",

    recordedAt:
      "2026-10-02T08:03:00.000Z",

    status:
      "SUCCEEDED",

    provider:
      "RUNWAY",

    providerExecutionId:
      submission.providerExecutionId,

    providerModel:
      "eleven_v3",

    providerCreatedAt:
      "2026-10-02T08:02:00.000Z",

    request:
      recoveryMetadata.request,

    credits: {
      locallyExpected:
        recoveryMetadata
          .locallyExpectedCredits,

      providerEstimated:
        submission
          .providerEstimatedCredits,

      providerFinal:
        1,
    },

    plan:
      recoveryMetadata.plan,

    outputs: [
      {
        outputIndex:
          1,

        destinationPath:
          audioOutputPath,

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
  };

const completion:
  DialogueCompletion = {
    schemaVersion:
      "1.0",

    completedAt:
      "2026-10-02T08:04:00.000Z",

    status:
      "COMPLETED",

    reservationId:
      reservation.reservationId,

    ...identity,

    planKey,

    provider:
      "RUNWAY",

    providerExecutionId:
      submission.providerExecutionId,

    generationRecordPath,
  };

function completedLifecycle(
  completionRecord:
    DialogueCompletion =
      completion,
): DialogueLifecycleClassification {
  return {
    state:
      "COMPLETED",

    reservation,

    submission,

    completion:
      completionRecord,
  };
}

function submittedLifecycle():
  DialogueLifecycleClassification {
  return {
    state:
      "SUBMITTED",

    reservation,

    submission,
  };
}

function completedDependencies(
  record:
    DialogueGenerationRecord | null =
      generationRecord,

  inspected:
    Readonly<{
      bytes: number;
      sha256: string;
    }> = {
      bytes:
        123,

      sha256:
        "b".repeat(
          64,
        ),
    },

  completionRecord:
    DialogueCompletion =
      completion,
) {
  const inspectLifecycle =
    vi.fn(
      async () =>
        completedLifecycle(
          completionRecord,
        ),
    );

  const readGenerationRecord =
    vi.fn(
      async () =>
        record,
    );

  const inspectOutput =
    vi.fn(
      async () =>
        inspected,
    );

  const resumeRunwayTask =
    vi.fn(
      async () => {
        throw new Error(
          "Completed reconciliation must not contact Runway.",
        );
      },
    );

  const dependencies = {
    inspectLifecycle,
    readGenerationRecord,
    inspectOutput,
    resumeRunwayTask,
  } satisfies
    DialogueLifecycleReconciliationDependencies;

  return {
    dependencies,
    readGenerationRecord,
    inspectOutput,
    resumeRunwayTask,
  };
}

function submittedDependencies() {
  const inspectLifecycle =
    vi.fn(
      async () =>
        submittedLifecycle(),
    );

  const providerExecution =
    Object.freeze({
      taskId:
        submission
          .providerExecutionId,

      providerCreatedAt:
        "2026-10-02T08:02:00.000Z",

      estimatedCredits:
        submission
          .providerEstimatedCredits,

      finalCredits:
        1,

      outputUrls: [
        "https://example.test/dialogue-output",
      ],
    });

  const resumeRunwayTask =
    vi.fn(
      async () =>
        providerExecution,
    );

  const recoverOutput =
    vi.fn(
      async (
        _sourceUrl:
          string,

        destinationPath:
          string,
      ) => ({
        destinationPath,

        bytes:
          123,

        sha256:
          "b".repeat(
            64,
          ),

        contentType:
          "audio/mpeg",
      }),
    );

  const recoverGenerationRecord =
    vi.fn(
      async (
        _mediaRoot:
          string,

        inputRecord:
          DialogueGenerationRecord,
      ) => ({
        record:
          inputRecord,

        recordPath:
          generationRecordPath,
      }),
    );

  const recoverCompletion =
    vi.fn(
      async () => ({
        record:
          completion,

        completionPath,
      }),
    );

  const dependencies = {
    inspectLifecycle,
    resumeRunwayTask,
    recoverOutput,
    recoverGenerationRecord,
    recoverCompletion,

    now:
      () =>
        "2026-10-02T08:03:00.000Z",
  } satisfies
    DialogueLifecycleReconciliationDependencies;

  return {
    dependencies,
    providerExecution,
    resumeRunwayTask,
    recoverOutput,
    recoverGenerationRecord,
    recoverCompletion,
  };
}

function reconciliationInput() {
  return {
    mediaRoot,

    ...identity,

    runwayWaitTimeoutMs:
      600_000,
  };
}

function referenceAudioCompletedEvidence() {
  const generationRecordPath =
    createDialogueGenerationRecordPath(
      mediaRoot,
      identity.episodeId,
      identity.shotId,
      identity.dialogueLineId,
      "RUNWAY",
      referenceAudioSubmission
        .providerExecutionId,
    );

  const audioOutputPath =
    createDialogueAudioOutputPath(
      mediaRoot,
      identity.episodeId,
      identity.shotId,
      identity.dialogueLineId,
      "RUNWAY",
      referenceAudioSubmission
        .providerExecutionId,
      1,
    );

  const generationRecord:
    Extract<
      DialogueGenerationRecord,
      { schemaVersion: "2.0" }
    > = {
      schemaVersion:
        "2.0",

      recordedAt:
        "2026-10-05T13:01:00.000Z",

      status:
        "SUCCEEDED",

      provider:
        "RUNWAY",

      providerExecutionId:
        referenceAudioSubmission
          .providerExecutionId,

      providerModel:
        referenceAudioSubmission
          .routing
          .model,

      providerCreatedAt:
        "2026-10-05T13:00:00.000Z",

      request:
        referenceAudioSubmission
          .recoveryMetadata
          .request,

      routing:
        referenceAudioSubmission
          .routing,

      credits: {
        locallyExpected:
          referenceAudioSubmission
            .recoveryMetadata
            .locallyExpectedCredits,

        providerEstimated:
          referenceAudioSubmission
            .providerEstimatedCredits,

        providerFinal:
          1.75,
      },

      plan:
        referenceAudioSubmission
          .recoveryMetadata
          .plan,

      outputs: [
        {
          outputIndex:
            1,

          destinationPath:
            audioOutputPath,

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
    };

  const completion:
    DialogueCompletion = {
      schemaVersion:
        "1.0",

      completedAt:
        "2026-10-05T13:02:00.000Z",

      status:
        "COMPLETED",

      reservationId:
        reservation
          .reservationId,

      ...identity,

      planKey,

      provider:
        "RUNWAY",

      providerExecutionId:
        referenceAudioSubmission
          .providerExecutionId,

      generationRecordPath,
    };

  return Object.freeze({
    generationRecordPath,
    audioOutputPath,
    generationRecord,
    completion,
  });
}

describe(
  "Busybookie dialogue reconciliation fail-closed coverage",
  () => {
    it(
      "dispatches a SUBMITTED reference-audio v2 lifecycle only to the reference-audio same-task resume adapter",
      async () => {
        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "SUBMITTED",

                reservation,

                submission:
                  referenceAudioSubmission,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const resumeRunwayTask =
          vi.fn(
            async () => {
              throw new Error(
                "Runway Eleven v3 resume adapter must not be invoked for a reference-audio submission.",
              );
            },
          );

        const resumeRunwayReferenceAudioTask =
          vi.fn(
            async (
              resumeInput:
                Readonly<{
                  taskId: string;
                  providerEstimatedCredits: number;
                  waitTimeoutMs: number;
                }>,
            ) => {
              expect(
                resumeInput,
              ).toEqual({
                taskId:
                  referenceAudioSubmission
                    .providerExecutionId,

                providerEstimatedCredits:
                  referenceAudioSubmission
                    .providerEstimatedCredits,

                waitTimeoutMs:
                  600_000,
              });

              throw new Error(
                "REFERENCE_AUDIO_RESUME_DISPATCH_CONFIRMED",
              );
            },
          );

        const recoverOutput =
          vi.fn(
            async () => {
              throw new Error(
                "Reference-audio dispatch test must stop before output recovery.",
              );
            },
          );

        const recoverGenerationRecord =
          vi.fn(
            async () => {
              throw new Error(
                "Reference-audio dispatch test must stop before generation-record recovery.",
              );
            },
          );

        const recoverCompletion =
          vi.fn(
            async () => {
              throw new Error(
                "Reference-audio dispatch test must stop before completion recovery.",
              );
            },
          );

        const dependencies =
          {
            inspectLifecycle,
            resumeRunwayTask,
            resumeRunwayReferenceAudioTask,
            recoverOutput,
            recoverGenerationRecord,
            recoverCompletion,
          } satisfies
            DialogueLifecycleReconciliationDependencies;

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            dependencies,
          ),
        ).rejects.toThrow(
          "REFERENCE_AUDIO_RESUME_DISPATCH_CONFIRMED",
        );

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayReferenceAudioTask,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverOutput,
        ).not.toHaveBeenCalled();

        expect(
          recoverGenerationRecord,
        ).not.toHaveBeenCalled();

        expect(
          recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "requires the reference-audio resume dependency for a SUBMITTED v2 lifecycle and never falls back to Eleven v3",
      async () => {
        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "SUBMITTED",

                reservation,

                submission:
                  referenceAudioSubmission,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const resumeRunwayTask =
          vi.fn(
            async () => {
              throw new Error(
                "Eleven v3 resume must not be used as a fallback for reference-audio recovery.",
              );
            },
          );

        const recoverOutput =
          vi.fn();

        const dependencies =
          {
            inspectLifecycle,
            resumeRunwayTask,
            recoverOutput,
          } satisfies
            DialogueLifecycleReconciliationDependencies;

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            dependencies,
          ),
        ).rejects.toThrow(
          /requires resumeRunwayReferenceAudioTask for a durable SUBMITTED Runway reference-audio dialogue task/i,
        );

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          recoverOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "recovers a SUBMITTED reference-audio v2 lifecycle through canonical output, v2 generation record, and completion recovery",
      async () => {
        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "SUBMITTED",

                reservation,

                submission:
                  referenceAudioSubmission,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const resumeRunwayTask =
          vi.fn(
            async () => {
              throw new Error(
                "Eleven v3 resume must not be invoked for reference-audio recovery.",
              );
            },
          );

        const providerExecution =
          Object.freeze({
            taskId:
              referenceAudioSubmission
                .providerExecutionId,

            providerCreatedAt:
              "2026-10-05T13:00:00.000Z",

            estimatedCredits:
              referenceAudioSubmission
                .providerEstimatedCredits,

            finalCredits:
              1.75,

            outputUrls:
              Object.freeze([
                "https://example.test/reference-audio-output.mp3",
              ]),
          });

        const resumeRunwayReferenceAudioTask =
          vi.fn<
            NonNullable<
              DialogueLifecycleReconciliationDependencies[
                "resumeRunwayReferenceAudioTask"
              ]
            >
          >(
            async (
              resumeInput,
            ) => {
              expect(
                resumeInput,
              ).toEqual({
                taskId:
                  referenceAudioSubmission
                    .providerExecutionId,

                providerEstimatedCredits:
                  referenceAudioSubmission
                    .providerEstimatedCredits,

                waitTimeoutMs:
                  600_000,
              });

              return providerExecution;
            },
          );

        const referenceAudioGenerationRecordPath =
          createDialogueGenerationRecordPath(
            mediaRoot,
            identity.episodeId,
            identity.shotId,
            identity.dialogueLineId,
            "RUNWAY",
            referenceAudioSubmission
              .providerExecutionId,
          );

        const referenceAudioOutputPath =
          createDialogueAudioOutputPath(
            mediaRoot,
            identity.episodeId,
            identity.shotId,
            identity.dialogueLineId,
            "RUNWAY",
            referenceAudioSubmission
              .providerExecutionId,
            1,
          );

        const expectedGenerationRecord:
          DialogueGenerationRecord = {
            schemaVersion:
              "2.0",

            recordedAt:
              "2026-10-05T13:01:00.000Z",

            status:
              "SUCCEEDED",

            provider:
              "RUNWAY",

            providerExecutionId:
              referenceAudioSubmission
                .providerExecutionId,

            providerModel:
              referenceAudioSubmission
                .routing
                .model,

            providerCreatedAt:
              providerExecution
                .providerCreatedAt,

            request:
              referenceAudioSubmission
                .recoveryMetadata
                .request,

            routing:
              referenceAudioSubmission
                .routing,

            credits: {
              locallyExpected:
                referenceAudioSubmission
                  .recoveryMetadata
                  .locallyExpectedCredits,

              providerEstimated:
                referenceAudioSubmission
                  .providerEstimatedCredits,

              providerFinal:
                providerExecution
                  .finalCredits,
            },

            plan:
              referenceAudioSubmission
                .recoveryMetadata
                .plan,

            outputs: [
              {
                outputIndex:
                  1,

                destinationPath:
                  referenceAudioOutputPath,

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
          };

        const referenceAudioCompletion:
          DialogueCompletion = {
            schemaVersion:
              "1.0",

            completedAt:
              "2026-10-05T13:02:00.000Z",

            status:
              "COMPLETED",

            reservationId:
              reservation
                .reservationId,

            ...identity,

            planKey,

            provider:
              "RUNWAY",

            providerExecutionId:
              referenceAudioSubmission
                .providerExecutionId,

            generationRecordPath:
              referenceAudioGenerationRecordPath,
          };

        const recoverOutput =
          vi.fn<
            NonNullable<
              DialogueLifecycleReconciliationDependencies[
                "recoverOutput"
              ]
            >
          >(
            async (
              sourceUrl,
              destinationPath,
            ) => {
              expect(
                sourceUrl,
              ).toBe(
                providerExecution
                  .outputUrls[0],
              );

              expect(
                destinationPath,
              ).toBe(
                referenceAudioOutputPath,
              );

              return {
                destinationPath,

                bytes:
                  456,

                sha256:
                  "c".repeat(
                    64,
                  ),

                contentType:
                  "audio/mpeg",
              };
            },
          );

        const recoverGenerationRecord =
          vi.fn<
            NonNullable<
              DialogueLifecycleReconciliationDependencies[
                "recoverGenerationRecord"
              ]
            >
          >(
            async (
              recoveryMediaRoot,
              inputRecord,
            ) => {
              expect(
                recoveryMediaRoot,
              ).toBe(
                mediaRoot,
              );

              expect(
                inputRecord,
              ).toEqual(
                expectedGenerationRecord,
              );

              return {
                record:
                  inputRecord,

                recordPath:
                  referenceAudioGenerationRecordPath,
              };
            },
          );

        const recoverCompletion =
          vi.fn<
            NonNullable<
              DialogueLifecycleReconciliationDependencies[
                "recoverCompletion"
              ]
            >
          >(
            async (
              recoveryMediaRoot,
              completionInput,
            ) => {
              expect(
                recoveryMediaRoot,
              ).toBe(
                mediaRoot,
              );

              expect(
                completionInput,
              ).toEqual({
                reservationId:
                  reservation
                    .reservationId,

                ...identity,

                planKey,

                provider:
                  "RUNWAY",

                providerExecutionId:
                  referenceAudioSubmission
                    .providerExecutionId,

                generationRecordPath:
                  referenceAudioGenerationRecordPath,
              });

              return {
                record:
                  referenceAudioCompletion,

                completionPath,
              };
            },
          );

        const dependencies = {
          inspectLifecycle,
          resumeRunwayTask,
          resumeRunwayReferenceAudioTask,
          recoverOutput,
          recoverGenerationRecord,
          recoverCompletion,

          now:
            () =>
              "2026-10-05T13:01:00.000Z",
        } satisfies
          DialogueLifecycleReconciliationDependencies;

        const result =
          await reconcileDialogueLifecycle(
            reconciliationInput(),
            dependencies,
          );

        expect(
          result,
        ).toEqual({
          lifecycleState:
            "COMPLETED",

          reconciliationMode:
            "RECOVERED_SUBMISSION",

          provider:
            "RUNWAY",

          providerExecutionId:
            referenceAudioSubmission
              .providerExecutionId,

          providerExecution,

          generationRecord:
            expectedGenerationRecord,

          generationRecordPath:
            referenceAudioGenerationRecordPath,

          completion:
            referenceAudioCompletion,

          completionPath,
        });

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayReferenceAudioTask,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverCompletion,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "rejects a resumed reference-audio task whose task ID differs from the durable v2 submission",
      async () => {
        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "SUBMITTED",

                reservation,

                submission:
                  referenceAudioSubmission,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const resumeRunwayTask =
          vi.fn(
            async () => {
              throw new Error(
                "Eleven v3 resume must not be invoked for reference-audio recovery.",
              );
            },
          );

        const resumeRunwayReferenceAudioTask =
          vi.fn<
            NonNullable<
              DialogueLifecycleReconciliationDependencies[
                "resumeRunwayReferenceAudioTask"
              ]
            >
          >(
            async () => ({
              taskId:
                "task-reference-audio-conflict",

              providerCreatedAt:
                "2026-10-05T13:00:00.000Z",

              estimatedCredits:
                referenceAudioSubmission
                  .providerEstimatedCredits,

              finalCredits:
                1.75,

              outputUrls:
                Object.freeze([
                  "https://example.test/reference-audio-output.mp3",
                ]),
            }),
          );

        const recoverOutput =
          vi.fn();

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            {
              inspectLifecycle,
              resumeRunwayTask,
              resumeRunwayReferenceAudioTask,
              recoverOutput,
            },
          ),
        ).rejects.toThrow(
          /task ID.*durable submission task ID/i,
        );

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          recoverOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects resumed reference-audio estimated credits that differ from the durable v2 submission",
      async () => {
        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "SUBMITTED",

                reservation,

                submission:
                  referenceAudioSubmission,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const resumeRunwayReferenceAudioTask =
          vi.fn<
            NonNullable<
              DialogueLifecycleReconciliationDependencies[
                "resumeRunwayReferenceAudioTask"
              ]
            >
          >(
            async () => ({
              taskId:
                referenceAudioSubmission
                  .providerExecutionId,

              providerCreatedAt:
                "2026-10-05T13:00:00.000Z",

              estimatedCredits:
                2.5,

              finalCredits:
                1.75,

              outputUrls:
                Object.freeze([
                  "https://example.test/reference-audio-output.mp3",
                ]),
            }),
          );

        const recoverOutput =
          vi.fn();

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            {
              inspectLifecycle,
              resumeRunwayReferenceAudioTask,
              recoverOutput,
            },
          ),
        ).rejects.toThrow(
          /estimated credits.*durable submission/i,
        );

        expect(
          recoverOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a resumed reference-audio task that reports no output URLs",
      async () => {
        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "SUBMITTED",

                reservation,

                submission:
                  referenceAudioSubmission,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const resumeRunwayReferenceAudioTask =
          vi.fn<
            NonNullable<
              DialogueLifecycleReconciliationDependencies[
                "resumeRunwayReferenceAudioTask"
              ]
            >
          >(
            async () => ({
              taskId:
                referenceAudioSubmission
                  .providerExecutionId,

              providerCreatedAt:
                "2026-10-05T13:00:00.000Z",

              estimatedCredits:
                referenceAudioSubmission
                  .providerEstimatedCredits,

              finalCredits:
                1.75,

              outputUrls:
                Object.freeze([]),
            }),
          );

        const recoverOutput =
          vi.fn();

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            {
              inspectLifecycle,
              resumeRunwayReferenceAudioTask,
              recoverOutput,
            },
          ),
        ).rejects.toThrow(
          /no output URLs/i,
        );

        expect(
          recoverOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects recovered reference-audio output whose destination is not the canonical v2 path",
      async () => {
        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "SUBMITTED",

                reservation,

                submission:
                  referenceAudioSubmission,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const resumeRunwayReferenceAudioTask =
          vi.fn<
            NonNullable<
              DialogueLifecycleReconciliationDependencies[
                "resumeRunwayReferenceAudioTask"
              ]
            >
          >(
            async () => ({
              taskId:
                referenceAudioSubmission
                  .providerExecutionId,

              providerCreatedAt:
                "2026-10-05T13:00:00.000Z",

              estimatedCredits:
                referenceAudioSubmission
                  .providerEstimatedCredits,

              finalCredits:
                1.75,

              outputUrls:
                Object.freeze([
                  "https://example.test/reference-audio-output.mp3",
                ]),
            }),
          );

        const recoverOutput =
          vi.fn<
            NonNullable<
              DialogueLifecycleReconciliationDependencies[
                "recoverOutput"
              ]
            >
          >(
            async (
              _sourceUrl,
              destinationPath,
            ) => ({
              destinationPath:
                `${destinationPath}.wrong`,

              bytes:
                456,

              sha256:
                "c".repeat(
                  64,
                ),

              contentType:
                "audio/mpeg",
            }),
          );

        const recoverGenerationRecord =
          vi.fn();

        const recoverCompletion =
          vi.fn();

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            {
              inspectLifecycle,
              resumeRunwayReferenceAudioTask,
              recoverOutput,
              recoverGenerationRecord,
              recoverCompletion,
            },
          ),
        ).rejects.toThrow(
          /output path.*canonical/i,
        );

        expect(
          recoverOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverGenerationRecord,
        ).not.toHaveBeenCalled();

        expect(
          recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "reconciles a durable COMPLETED reference-audio v2 lifecycle from local durable evidence without contacting either resume adapter",
      async () => {
        const referenceAudioGenerationRecordPath =
          createDialogueGenerationRecordPath(
            mediaRoot,
            identity.episodeId,
            identity.shotId,
            identity.dialogueLineId,
            "RUNWAY",
            referenceAudioSubmission
              .providerExecutionId,
          );

        const referenceAudioOutputPath =
          createDialogueAudioOutputPath(
            mediaRoot,
            identity.episodeId,
            identity.shotId,
            identity.dialogueLineId,
            "RUNWAY",
            referenceAudioSubmission
              .providerExecutionId,
            1,
          );

        const referenceAudioGenerationRecord:
          DialogueGenerationRecord = {
            schemaVersion:
              "2.0",

            recordedAt:
              "2026-10-05T13:01:00.000Z",

            status:
              "SUCCEEDED",

            provider:
              "RUNWAY",

            providerExecutionId:
              referenceAudioSubmission
                .providerExecutionId,

            providerModel:
              referenceAudioSubmission
                .routing
                .model,

            providerCreatedAt:
              "2026-10-05T13:00:00.000Z",

            request:
              referenceAudioSubmission
                .recoveryMetadata
                .request,

            routing:
              referenceAudioSubmission
                .routing,

            credits: {
              locallyExpected:
                referenceAudioSubmission
                  .recoveryMetadata
                  .locallyExpectedCredits,

              providerEstimated:
                referenceAudioSubmission
                  .providerEstimatedCredits,

              providerFinal:
                1.75,
            },

            plan:
              referenceAudioSubmission
                .recoveryMetadata
                .plan,

            outputs: [
              {
                outputIndex:
                  1,

                destinationPath:
                  referenceAudioOutputPath,

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
          };

        const referenceAudioCompletion:
          DialogueCompletion = {
            schemaVersion:
              "1.0",

            completedAt:
              "2026-10-05T13:02:00.000Z",

            status:
              "COMPLETED",

            reservationId:
              reservation
                .reservationId,

            ...identity,

            planKey,

            provider:
              "RUNWAY",

            providerExecutionId:
              referenceAudioSubmission
                .providerExecutionId,

            generationRecordPath:
              referenceAudioGenerationRecordPath,
          };

        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "COMPLETED",

                reservation,

                submission:
                  referenceAudioSubmission,

                completion:
                  referenceAudioCompletion,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const readGenerationRecord =
          vi.fn<
            NonNullable<
              DialogueLifecycleReconciliationDependencies[
                "readGenerationRecord"
              ]
            >
          >(
            async (
              recoveryMediaRoot,
              episodeId,
              shotId,
              dialogueLineId,
              provider,
              providerExecutionId,
            ) => {
              expect(
                recoveryMediaRoot,
              ).toBe(
                mediaRoot,
              );

              expect({
                episodeId,
                shotId,
                dialogueLineId,
                provider,
                providerExecutionId,
              }).toEqual({
                episodeId:
                  identity.episodeId,

                shotId:
                  identity.shotId,

                dialogueLineId:
                  identity.dialogueLineId,

                provider:
                  "RUNWAY",

                providerExecutionId:
                  referenceAudioSubmission
                    .providerExecutionId,
              });

              return referenceAudioGenerationRecord;
            },
          );

        const inspectOutput =
          vi.fn<
            NonNullable<
              DialogueLifecycleReconciliationDependencies[
                "inspectOutput"
              ]
            >
          >(
            async (
              outputPath,
            ) => {
              expect(
                outputPath,
              ).toBe(
                referenceAudioOutputPath,
              );

              return {
                bytes:
                  456,

                sha256:
                  "c".repeat(
                    64,
                  ),
              };
            },
          );

        const resumeRunwayTask =
          vi.fn();

        const resumeRunwayReferenceAudioTask =
          vi.fn();

        const result =
          await reconcileDialogueLifecycle(
            reconciliationInput(),
            {
              inspectLifecycle,
              readGenerationRecord,
              inspectOutput,
              resumeRunwayTask,
              resumeRunwayReferenceAudioTask,
            },
          );

        expect(
          result,
        ).toEqual({
          lifecycleState:
            "COMPLETED",

          reconciliationMode:
            "DURABLE_COMPLETION",

          provider:
            "RUNWAY",

          providerExecutionId:
            referenceAudioSubmission
              .providerExecutionId,

          generationRecord:
            referenceAudioGenerationRecord,

          generationRecordPath:
            referenceAudioGenerationRecordPath,

          completion:
            referenceAudioCompletion,

          completionPath,
        });

        expect(
          readGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayReferenceAudioTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a durable COMPLETED reference-audio v2 lifecycle whose completion points to a non-canonical generation record",
      async () => {
        const evidence =
          referenceAudioCompletedEvidence();

        const corruptedCompletion:
          DialogueCompletion = {
            ...evidence.completion,

            generationRecordPath:
              `${evidence.generationRecordPath}.wrong`,
          };

        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "COMPLETED",

                reservation,

                submission:
                  referenceAudioSubmission,

                completion:
                  corruptedCompletion,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const readGenerationRecord =
          vi.fn();

        const resumeRunwayTask =
          vi.fn();

        const resumeRunwayReferenceAudioTask =
          vi.fn();

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            {
              inspectLifecycle,
              readGenerationRecord,
              resumeRunwayTask,
              resumeRunwayReferenceAudioTask,
            },
          ),
        ).rejects.toThrow(
          /completion generation record path.*canonical/i,
        );

        expect(
          readGenerationRecord,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayReferenceAudioTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a durable COMPLETED reference-audio v2 lifecycle whose generation record is missing",
      async () => {
        const evidence =
          referenceAudioCompletedEvidence();

        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "COMPLETED",

                reservation,

                submission:
                  referenceAudioSubmission,

                completion:
                  evidence.completion,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const readGenerationRecord =
          vi.fn(
            async () =>
              null,
          );

        const inspectOutput =
          vi.fn();

        const resumeRunwayTask =
          vi.fn();

        const resumeRunwayReferenceAudioTask =
          vi.fn();

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            {
              inspectLifecycle,
              readGenerationRecord,
              inspectOutput,
              resumeRunwayTask,
              resumeRunwayReferenceAudioTask,
            },
          ),
        ).rejects.toThrow(
          /missing generation record/i,
        );

        expect(
          inspectOutput,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayReferenceAudioTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects historical v1 generation evidence for a durable COMPLETED reference-audio v2 lifecycle",
      async () => {
        const evidence =
          referenceAudioCompletedEvidence();

        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "COMPLETED",

                reservation,

                submission:
                  referenceAudioSubmission,

                completion:
                  evidence.completion,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const readGenerationRecord =
          vi.fn(
            async () =>
              generationRecord,
          );

        const inspectOutput =
          vi.fn();

        const resumeRunwayTask =
          vi.fn();

        const resumeRunwayReferenceAudioTask =
          vi.fn();

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            {
              inspectLifecycle,
              readGenerationRecord,
              inspectOutput,
              resumeRunwayTask,
              resumeRunwayReferenceAudioTask,
            },
          ),
        ).rejects.toThrow(
          /schema version.*supported v2 reference-audio/i,
        );

        expect(
          inspectOutput,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayReferenceAudioTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects durable COMPLETED reference-audio v2 generation evidence whose immutable request differs from the submission",
      async () => {
        const evidence =
          referenceAudioCompletedEvidence();

        const corruptedRecord:
          Extract<
            DialogueGenerationRecord,
            { schemaVersion: "2.0" }
          > = {
            ...evidence.generationRecord,

            request: {
              ...referenceAudioSubmission
                .recoveryMetadata
                .request,

              input: {
                ...referenceAudioSubmission
                  .recoveryMetadata
                  .request
                  .input,

                promptText:
                  "Different durable dialogue text.",
              },
            },
          };

        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "COMPLETED",

                reservation,

                submission:
                  referenceAudioSubmission,

                completion:
                  evidence.completion,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const readGenerationRecord =
          vi.fn(
            async () =>
              corruptedRecord,
          );

        const inspectOutput =
          vi.fn();

        const resumeRunwayTask =
          vi.fn();

        const resumeRunwayReferenceAudioTask =
          vi.fn();

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            {
              inspectLifecycle,
              readGenerationRecord,
              inspectOutput,
              resumeRunwayTask,
              resumeRunwayReferenceAudioTask,
            },
          ),
        ).rejects.toThrow(
          /request.*immutable submission recovery request/i,
        );

        expect(
          inspectOutput,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayReferenceAudioTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects durable COMPLETED reference-audio v2 generation evidence whose routing differs from the accepted submission",
      async () => {
        const evidence =
          referenceAudioCompletedEvidence();

        const corruptedRecord:
          Extract<
            DialogueGenerationRecord,
            { schemaVersion: "2.0" }
          > = {
            ...evidence.generationRecord,

            routing: {
              ...referenceAudioSubmission
                .routing,

              provider:
                "different-provider",
            },
          };

        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "COMPLETED",

                reservation,

                submission:
                  referenceAudioSubmission,

                completion:
                  evidence.completion,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const readGenerationRecord =
          vi.fn(
            async () =>
              corruptedRecord,
          );

        const inspectOutput =
          vi.fn();

        const resumeRunwayTask =
          vi.fn();

        const resumeRunwayReferenceAudioTask =
          vi.fn();

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            {
              inspectLifecycle,
              readGenerationRecord,
              inspectOutput,
              resumeRunwayTask,
              resumeRunwayReferenceAudioTask,
            },
          ),
        ).rejects.toThrow(
          /routing evidence.*durable submission/i,
        );

        expect(
          inspectOutput,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayReferenceAudioTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a durable COMPLETED reference-audio v2 lifecycle when local audio integrity differs from durable generation evidence",
      async () => {
        const evidence =
          referenceAudioCompletedEvidence();

        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "COMPLETED",

                reservation,

                submission:
                  referenceAudioSubmission,

                completion:
                  evidence.completion,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const readGenerationRecord =
          vi.fn(
            async () =>
              evidence
                .generationRecord,
          );

        const inspectOutput =
          vi.fn(
            async (
              outputPath,
            ) => {
              expect(
                outputPath,
              ).toBe(
                evidence
                  .audioOutputPath,
              );

              return {
                bytes:
                  457,

                sha256:
                  "c".repeat(
                    64,
                  ),
              };
            },
          );

        const resumeRunwayTask =
          vi.fn();

        const resumeRunwayReferenceAudioTask =
          vi.fn();

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            {
              inspectLifecycle,
              readGenerationRecord,
              inspectOutput,
              resumeRunwayTask,
              resumeRunwayReferenceAudioTask,
            },
          ),
        ).rejects.toThrow(
          /audio output integrity.*generation record/i,
        );

        expect(
          inspectOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayReferenceAudioTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a completed lifecycle whose completion points to a non-canonical generation record",
      async () => {
        const corruptedCompletion:
          DialogueCompletion = {
            ...completion,

            generationRecordPath:
              `${generationRecordPath}.wrong`,
          };

        const harness =
          completedDependencies(
            generationRecord,
            undefined,
            corruptedCompletion,
          );

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /completion generation record path.*canonical/i,
        );

        expect(
          harness.readGenerationRecord,
        ).not.toHaveBeenCalled();

        expect(
          harness.resumeRunwayTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a completed lifecycle whose durable generation record is missing",
      async () => {
        const harness =
          completedDependencies(
            null,
          );

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /missing generation record/i,
        );

        expect(
          harness.inspectOutput,
        ).not.toHaveBeenCalled();

        expect(
          harness.resumeRunwayTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a completed generation record whose request differs from immutable submission recovery metadata",
      async () => {
        const corruptedRecord =
          {
            ...generationRecord,

            request: {
              ...generationRecord
                .request,

              promptText:
                "Different dialogue text.",
            },
          } as DialogueGenerationRecord;

        const harness =
          completedDependencies(
            corruptedRecord,
          );

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /generation record request.*immutable submission recovery request/i,
        );

        expect(
          harness.inspectOutput,
        ).not.toHaveBeenCalled();

        expect(
          harness.resumeRunwayTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a completed generation record whose audio output path is non-canonical",
      async () => {
        const corruptedRecord:
          DialogueGenerationRecord = {
            ...generationRecord,

            outputs: [
              {
                ...generationRecord
                  .outputs[0]!,

                destinationPath:
                  `${audioOutputPath}.wrong`,
              },
            ],
          };

        const harness =
          completedDependencies(
            corruptedRecord,
          );

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /output path.*canonical/i,
        );

        expect(
          harness.inspectOutput,
        ).not.toHaveBeenCalled();

        expect(
          harness.resumeRunwayTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a completed generation record whose output indexes are not canonical and contiguous",
      async () => {
        const corruptedRecord:
          DialogueGenerationRecord = {
            ...generationRecord,

            outputs: [
              {
                ...generationRecord
                  .outputs[0]!,

                outputIndex:
                  2,

                destinationPath:
                  createDialogueAudioOutputPath(
                    mediaRoot,
                    identity.episodeId,
                    identity.shotId,
                    identity.dialogueLineId,
                    "RUNWAY",
                    submission
                      .providerExecutionId,
                    2,
                  ),
              },
            ],
          };

        const harness =
          completedDependencies(
            corruptedRecord,
          );

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /contiguous canonical output indexes/i,
        );

        expect(
          harness.inspectOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a completed lifecycle when local audio bytes no longer match durable generation evidence",
      async () => {
        const harness =
          completedDependencies(
            generationRecord,
            {
              bytes:
                124,

              sha256:
                "b".repeat(
                  64,
                ),
            },
          );

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /audio output integrity.*generation record/i,
        );

        expect(
          harness.inspectOutput,
        ).toHaveBeenCalledWith(
          audioOutputPath,
        );

        expect(
          harness.resumeRunwayTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a completed lifecycle when local audio SHA-256 no longer matches durable generation evidence",
      async () => {
        const harness =
          completedDependencies(
            generationRecord,
            {
              bytes:
                123,

              sha256:
                "c".repeat(
                  64,
                ),
            },
          );

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /audio output integrity.*generation record/i,
        );

        expect(
          harness.resumeRunwayTask,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects resumed provider evidence whose estimated credits differ from the durable submission",
      async () => {
        const harness =
          submittedDependencies();

        harness
          .resumeRunwayTask
          .mockResolvedValue({
            ...harness
              .providerExecution,

            estimatedCredits:
              2,
          });

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /estimated credits.*durable submission/i,
        );

        expect(
          harness.recoverOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects a resumed provider task that reports no output URLs",
      async () => {
        const harness =
          submittedDependencies();

        harness
          .resumeRunwayTask
          .mockResolvedValue({
            ...harness
              .providerExecution,

            outputUrls:
              [],
          });

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /no output URLs/i,
        );

        expect(
          harness.recoverOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects recovered audio whose destination does not match the canonical output path",
      async () => {
        const harness =
          submittedDependencies();

        harness
          .recoverOutput
          .mockResolvedValue({
            destinationPath:
              `${audioOutputPath}.wrong`,

            bytes:
              123,

            sha256:
              "b".repeat(
                64,
              ),

            contentType:
              "audio/mpeg",
          });

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /recovered dialogue audio output path.*canonical/i,
        );

        expect(
          harness.recoverGenerationRecord,
        ).not.toHaveBeenCalled();

        expect(
          harness.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects recovered generation evidence that conflicts with the resumed provider execution",
      async () => {
        const harness =
          submittedDependencies();

        harness
          .recoverGenerationRecord
          .mockImplementation(
            async (
              _mediaRoot,
              inputRecord,
            ) => ({
              record: {
                ...inputRecord,

                credits: {
                  ...inputRecord
                    .credits,

                  providerFinal:
                    inputRecord
                      .credits
                      .providerFinal +
                    1,
                },
              },

              recordPath:
                generationRecordPath,
            }),
          );

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /generation record does not match.*resumed provider execution evidence/i,
        );

        expect(
          harness.recoverCompletion,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects recovered completion evidence that conflicts with the durable lifecycle",
      async () => {
        const harness =
          submittedDependencies();

        harness
          .recoverCompletion
          .mockResolvedValue({
            record: {
              ...completion,

              providerExecutionId:
                "task-dialogue-different",
            },

            completionPath,
          });

        await expect(
          reconcileDialogueLifecycle(
            reconciliationInput(),
            harness.dependencies,
          ),
        ).rejects.toThrow(
          /completion does not match.*durable lifecycle evidence/i,
        );
      },
    );
  },
);
