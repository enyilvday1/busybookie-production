import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createRunwayDialogueProductionReconciler,
  type RunwayDialogueProductionReconcilerDependencies,
} from "../src/dialogue/createRunwayDialogueProductionReconciler.js";

import type {
  DialogueLifecycleClassification,
} from "../src/dialogue/classifyDialogueLifecycle.js";

import type {
  DialogueLifecycleReconciliationResult,
} from "../src/dialogue/reconcileDialogueLifecycle.js";

import type {
  DialogueReservation,
} from "../src/dialogue/dialogueReservation.schema.js";

import type {
  DialogueSubmission,
} from "../src/dialogue/dialogueSubmission.schema.js";

import type {
  ResumeRunwayReferenceAudioTaskInput,
  RunwayReferenceAudioTaskLookupClient,
  RunwayReferenceAudioTaskResumeResult,
} from "../src/dialogue/resumeRunwayReferenceAudioTask.js";

import type {
  DialogueVoicePolicy,
} from "../src/schemas/dialogueVoicePolicy.schema.js";

import type {
  RunwayCredentialSource,
} from "../src/runway/runway.types.js";

const credentialSource:
  RunwayCredentialSource = {
    RUNWAYML_API_SECRET:
      "test-runway-secret",
  };

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

const policy =
  Object.freeze({
    schemaVersion:
      "1.0" as const,

    pricingReviewedOn:
      "2026-10-01",

    generation: {
      model:
        "eleven_v3" as const,

      charactersPerCredit:
        50,

      minimumCredits:
        1,

      maxCreditsPerLine:
        10,

      maxPromptCharacters:
        500,

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

    task: {
      waitTimeoutMs:
        600_000,
    },
  }) satisfies
    DialogueVoicePolicy;

const durableResult =
  Object.freeze({
    lifecycleState:
      "COMPLETED",

    reconciliationMode:
      "DURABLE_COMPLETION",

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-dialogue-123",

    generationRecord:
      {},

    generationRecordPath:
      "D:/Busybookie/Production/example.dialogue-generation.json",

    completion:
      {},

    completionPath:
      "D:/Busybookie/Production/example.dialogue-completion.json",
  }) as unknown as
    DialogueLifecycleReconciliationResult;

const recoveredResult =
  Object.freeze({
    lifecycleState:
      "COMPLETED",

    reconciliationMode:
      "RECOVERED_SUBMISSION",

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-dialogue-123",

    providerExecution:
      {},

    generationRecord:
      {},

    generationRecordPath:
      "D:/Busybookie/Production/example.dialogue-generation.json",

    completion:
      {},

    completionPath:
      "D:/Busybookie/Production/example.dialogue-completion.json",
  }) as unknown as
    DialogueLifecycleReconciliationResult;

describe(
  "Busybookie Runway dialogue production reconciler",
  () => {
    it(
      "keeps COMPLETED dialogue reconciliation entirely local and does not prepare Runway recovery capability",
      async () => {
        const completedLifecycle =
          {
            state:
              "COMPLETED",
          } as unknown as
            DialogueLifecycleClassification;

        const inspectLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "inspectLifecycle"
            ]
          >(
            async () =>
              completedLifecycle,
          );

        const loadPolicy =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "loadPolicy"
            ]
          >(
            async () =>
              policy,
          );

        const createLookupClient =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "createLookupClient"
            ]
          >();

        const resumeRunwayTask =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "resumeRunwayTask"
            ]
          >();

        const reconcileLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "reconcileLifecycle"
            ]
          >(
            async (
              reconciliationInput,
              dependencies,
            ) => {
              expect(
                reconciliationInput,
              ).toEqual(
                input,
              );

              expect(
                await dependencies
                  .inspectLifecycle(
                    input.mediaRoot,
                    input.episodeId,
                    input.sceneId,
                    input.shotId,
                    input.dialogueLineId,
                  ),
              ).toBe(
                completedLifecycle,
              );

              expect(
                dependencies
                  .resumeRunwayTask,
              ).toBeUndefined();

              return durableResult;
            },
          );

        const reconcile =
          createRunwayDialogueProductionReconciler(
            credentialSource,
            {
              inspectLifecycle,
              loadPolicy,
              createLookupClient,
              resumeRunwayTask,
              reconcileLifecycle,
            },
          );

        const result =
          await reconcile(
            input,
          );

        expect(
          result,
        ).toBe(
          durableResult,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          loadPolicy,
        ).not.toHaveBeenCalled();

        expect(
          createLookupClient,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          reconcileLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "for SUBMITTED dialogue loads recovery policy and binds the lookup-only Runway client to same-task resume",
      async () => {
        const legacyPlanKey =
          "a".repeat(
            64,
          );

        const legacyReservation =
          {
            schemaVersion:
              "1.0",

            reservationId:
              "11111111-1111-4111-8111-111111111111",

            reservedAt:
              "2026-10-01T22:00:00.000Z",

            status:
              "RESERVED",

            episodeId:
              input.episodeId,

            sceneId:
              input.sceneId,

            shotId:
              input.shotId,

            dialogueLineId:
              input.dialogueLineId,

            planKey:
              legacyPlanKey,

            provider:
              "RUNWAY",
          } satisfies
            DialogueReservation;

        const legacySubmission =
          {
            schemaVersion:
              "1.0",

            submittedAt:
              "2026-10-01T22:01:00.000Z",

            status:
              "SUBMITTED",

            reservationId:
              legacyReservation
                .reservationId,

            episodeId:
              input.episodeId,

            sceneId:
              input.sceneId,

            shotId:
              input.shotId,

            dialogueLineId:
              input.dialogueLineId,

            planKey:
              legacyPlanKey,

            provider:
              "RUNWAY",

            providerExecutionId:
              "task-dialogue-123",

            providerEstimatedCredits:
              1,

            recoveryMetadata: {
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
                planKey:
                  legacyPlanKey,

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
            },
          } satisfies
            DialogueSubmission;

        const submittedLifecycle =
          {
            state:
              "SUBMITTED",

            reservation:
              legacyReservation,

            submission:
              legacySubmission,
          } satisfies
            DialogueLifecycleClassification;

        const inspectLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "inspectLifecycle"
            ]
          >(
            async () =>
              submittedLifecycle,
          );

        const loadPolicy =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "loadPolicy"
            ]
          >(
            async () =>
              policy,
          );

        const lookupClient =
          Object.freeze({
            tasks:
              Object.freeze({
                retrieve:
                  vi.fn(),
              }),
          });

        const createLookupClient =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "createLookupClient"
            ]
          >(
            () =>
              lookupClient as
                ReturnType<
                  RunwayDialogueProductionReconcilerDependencies[
                    "createLookupClient"
                  ]
                >,
          );

        const providerExecution =
          Object.freeze({
            taskId:
              "task-dialogue-123",

            providerCreatedAt:
              "2026-10-01T22:02:00.000Z",

            estimatedCredits:
              1,

            finalCredits:
              1,

            outputUrls: [
              "https://example.test/dialogue-output",
            ],
          });

        const resumeRunwayTask =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "resumeRunwayTask"
            ]
          >(
            async (
              client,
              resumeInput,
            ) => {
              expect(
                client,
              ).toBe(
                lookupClient,
              );

              expect(
                resumeInput,
              ).toEqual({
                taskId:
                  "task-dialogue-123",

                providerEstimatedCredits:
                  1,

                waitTimeoutMs:
                  600_000,
              });

              return providerExecution;
            },
          );

        const reconcileLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "reconcileLifecycle"
            ]
          >(
            async (
              reconciliationInput,
              dependencies,
            ) => {
              expect(
                reconciliationInput,
              ).toEqual({
                ...input,

                runwayWaitTimeoutMs:
                  policy.task
                    .waitTimeoutMs,
              });

              expect(
                await dependencies
                  .inspectLifecycle(
                    input.mediaRoot,
                    input.episodeId,
                    input.sceneId,
                    input.shotId,
                    input.dialogueLineId,
                  ),
              ).toBe(
                submittedLifecycle,
              );

              expect(
                dependencies
                  .resumeRunwayReferenceAudioTask,
              ).toBeUndefined();

              const resume =
                dependencies
                  .resumeRunwayTask;

              expect(
                resume,
              ).toBeDefined();

              expect(
                await resume?.({
                  taskId:
                    "task-dialogue-123",

                  providerEstimatedCredits:
                    1,

                  waitTimeoutMs:
                    600_000,
                }),
              ).toBe(
                providerExecution,
              );

              return recoveredResult;
            },
          );

        const reconcile =
          createRunwayDialogueProductionReconciler(
            credentialSource,
            {
              inspectLifecycle,
              loadPolicy,
              createLookupClient,
              resumeRunwayTask,
              reconcileLifecycle,
            },
          );

        const result =
          await reconcile(
            input,
          );

        expect(
          result,
        ).toBe(
          recoveredResult,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          loadPolicy,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createLookupClient,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createLookupClient,
        ).toHaveBeenCalledWith(
          credentialSource,
        );

        expect(
          resumeRunwayTask,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          reconcileLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "for SUBMITTED reference-audio v2 binds only the reference-audio same-task resume adapter",
      async () => {
        const planKey =
          "a".repeat(
            64,
          );

        const referenceAudioReservation =
          {
            schemaVersion:
              "1.0",

            reservationId:
              "11111111-1111-4111-8111-111111111111",

            reservedAt:
              "2026-10-05T08:59:00.000Z",

            status:
              "RESERVED",

            episodeId:
              input.episodeId,

            sceneId:
              input.sceneId,

            shotId:
              input.shotId,

            dialogueLineId:
              input.dialogueLineId,

            planKey,

            provider:
              "RUNWAY",
          } satisfies
            DialogueReservation;

        const referenceAudioSubmission =
          {
            schemaVersion:
              "2.0",

            submittedAt:
              "2026-10-05T09:00:00.000Z",

            status:
              "SUBMITTED",

            reservationId:
              referenceAudioReservation
                .reservationId,

            episodeId:
              input.episodeId,

            sceneId:
              input.sceneId,

            shotId:
              input.shotId,

            dialogueLineId:
              input.dialogueLineId,

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
            },
          } satisfies
            DialogueSubmission;

        const submittedLifecycle =
          {
            state:
              "SUBMITTED",

            reservation:
              referenceAudioReservation,

            submission:
              referenceAudioSubmission,
          } satisfies
            DialogueLifecycleClassification;

        const missingReferenceAudioInspectLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "inspectLifecycle"
            ]
          >(
            async () =>
              submittedLifecycle,
          );

        const missingReferenceAudioLoadPolicy =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "loadPolicy"
            ]
          >(
            async () =>
              policy,
          );

        const missingReferenceAudioLookupClient =
          Object.freeze({
            tasks:
              Object.freeze({
                retrieve:
                  vi.fn(),
              }),
          });

        const missingReferenceAudioCreateLookupClient =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "createLookupClient"
            ]
          >(
            () =>
              missingReferenceAudioLookupClient as
                ReturnType<
                  RunwayDialogueProductionReconcilerDependencies[
                    "createLookupClient"
                  ]
                >,
          );

        const missingReferenceAudioLegacyResume =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "resumeRunwayTask"
            ]
          >();

        const missingReferenceAudioReconcileLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "reconcileLifecycle"
            ]
          >(
            async () => {
              throw new Error(
                "V2_RECONCILIATION_MUST_NOT_START_WITHOUT_REFERENCE_AUDIO_RESUME",
              );
            },
          );

        const reconcileWithoutReferenceAudioResume =
          createRunwayDialogueProductionReconciler(
            credentialSource,
            {
              inspectLifecycle:
                missingReferenceAudioInspectLifecycle,

              loadPolicy:
                missingReferenceAudioLoadPolicy,

              createLookupClient:
                missingReferenceAudioCreateLookupClient,

              resumeRunwayTask:
                missingReferenceAudioLegacyResume,

              reconcileLifecycle:
                missingReferenceAudioReconcileLifecycle,
            },
          );

        await expect(
          reconcileWithoutReferenceAudioResume(
            input,
          ),
        ).rejects.toThrow(
          /requires resumeRunwayReferenceAudioTask.*reference-audio v2/i,
        );

        expect(
          missingReferenceAudioInspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          missingReferenceAudioLoadPolicy,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          missingReferenceAudioCreateLookupClient,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          missingReferenceAudioLegacyResume,
        ).not.toHaveBeenCalled();

        expect(
          missingReferenceAudioReconcileLifecycle,
        ).not.toHaveBeenCalled();

        const inspectLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "inspectLifecycle"
            ]
          >(
            async () =>
              submittedLifecycle,
          );

        const loadPolicy =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "loadPolicy"
            ]
          >(
            async () =>
              policy,
          );

        const lookupClient =
          Object.freeze({
            tasks:
              Object.freeze({
                retrieve:
                  vi.fn(),
              }),
          });

        const createLookupClient =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "createLookupClient"
            ]
          >(
            () =>
              lookupClient as
                ReturnType<
                  RunwayDialogueProductionReconcilerDependencies[
                    "createLookupClient"
                  ]
                >,
          );

        const legacyProviderExecution =
          Object.freeze({
            taskId:
              "LEGACY_PATH_MUST_NOT_RUN",

            providerCreatedAt:
              "2026-10-05T09:00:01.000Z",

            estimatedCredits:
              2,

            finalCredits:
              2,

            outputUrls:
              Object.freeze([
                "https://example.test/legacy-output",
              ]),
          });

        const resumeRunwayTask =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "resumeRunwayTask"
            ]
          >(
            async () =>
              legacyProviderExecution,
          );

        const referenceAudioProviderExecution =
          Object.freeze({
            taskId:
              referenceAudioSubmission
                .providerExecutionId,

            providerCreatedAt:
              "2026-10-05T09:00:01.000Z",

            estimatedCredits:
              referenceAudioSubmission
                .providerEstimatedCredits,

            finalCredits:
              1.75,

            outputUrls:
              Object.freeze([
                "https://example.test/reference-audio-output",
              ]),
          }) satisfies
            RunwayReferenceAudioTaskResumeResult;

        const resumeRunwayReferenceAudioTask =
          vi.fn(
            async (
              client:
                RunwayReferenceAudioTaskLookupClient,

              resumeInput:
                ResumeRunwayReferenceAudioTaskInput,
            ):
            Promise<
              RunwayReferenceAudioTaskResumeResult
            > => {
              expect(
                client,
              ).toBe(
                lookupClient,
              );

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
                  policy.task
                    .waitTimeoutMs,
              });

              return referenceAudioProviderExecution;
            },
          );

        const reconcileLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "reconcileLifecycle"
            ]
          >(
            async (
              reconciliationInput,
              dependencies,
            ) => {
              expect(
                reconciliationInput,
              ).toEqual({
                ...input,

                runwayWaitTimeoutMs:
                  policy.task
                    .waitTimeoutMs,
              });

              expect(
                await dependencies
                  .inspectLifecycle(
                    input.mediaRoot,
                    input.episodeId,
                    input.sceneId,
                    input.shotId,
                    input.dialogueLineId,
                  ),
              ).toBe(
                submittedLifecycle,
              );

              expect(
                dependencies
                  .resumeRunwayTask,
              ).toBeUndefined();

              const resume =
                dependencies
                  .resumeRunwayReferenceAudioTask;

              expect(
                resume,
              ).toBeDefined();

              expect(
                await resume?.({
                  taskId:
                    referenceAudioSubmission
                      .providerExecutionId,

                  providerEstimatedCredits:
                    referenceAudioSubmission
                      .providerEstimatedCredits,

                  waitTimeoutMs:
                    policy.task
                      .waitTimeoutMs,
                }),
              ).toBe(
                referenceAudioProviderExecution,
              );

              return recoveredResult;
            },
          );

        const dependencies =
          {
            inspectLifecycle,
            loadPolicy,
            createLookupClient,
            resumeRunwayTask,
            resumeRunwayReferenceAudioTask,
            reconcileLifecycle,
          } satisfies
            RunwayDialogueProductionReconcilerDependencies;

        const reconcile =
          createRunwayDialogueProductionReconciler(
            credentialSource,
            dependencies,
          );

        const result =
          await reconcile(
            input,
          );

        expect(
          result,
        ).toBe(
          recoveredResult,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          loadPolicy,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createLookupClient,
        ).toHaveBeenCalledTimes(
          1,
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
          reconcileLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it.each([
      "NOTHING",
      "RESERVED_ONLY",
    ] as const)(
      "does not prepare Runway recovery capability for lifecycle state %s",
      async (
        state,
      ) => {
        const lifecycle =
          {
            state,
          } as unknown as
            DialogueLifecycleClassification;

        const inspectLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "inspectLifecycle"
            ]
          >(
            async () =>
              lifecycle,
          );

        const loadPolicy =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "loadPolicy"
            ]
          >(
            async () =>
              policy,
          );

        const createLookupClient =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "createLookupClient"
            ]
          >();

        const resumeRunwayTask =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "resumeRunwayTask"
            ]
          >();

        const reconcileLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "reconcileLifecycle"
            ]
          >(
            async (
              _reconciliationInput,
              dependencies,
            ) => {
              expect(
                await dependencies
                  .inspectLifecycle(
                    input.mediaRoot,
                    input.episodeId,
                    input.sceneId,
                    input.shotId,
                    input.dialogueLineId,
                  ),
              ).toBe(
                lifecycle,
              );

              throw new Error(
                `Dialogue lifecycle reconciliation requires a SUBMITTED or COMPLETED lifecycle; found ${state}.`,
              );
            },
          );

        const reconcile =
          createRunwayDialogueProductionReconciler(
            credentialSource,
            {
              inspectLifecycle,
              loadPolicy,
              createLookupClient,
              resumeRunwayTask,
              reconcileLifecycle,
            },
          );

        await expect(
          reconcile(
            input,
          ),
        ).rejects.toThrow(
          /SUBMITTED|COMPLETED/i,
        );

        expect(
          loadPolicy,
        ).not.toHaveBeenCalled();

        expect(
          createLookupClient,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
