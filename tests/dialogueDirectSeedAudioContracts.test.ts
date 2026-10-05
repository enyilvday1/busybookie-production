import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  DialogueSubmissionSchema,
} from "../src/dialogue/dialogueSubmission.schema.js";

import {
  DialogueGenerationRecordSchema,
} from "../src/dialogue/dialogueGenerationRecord.schema.js";
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
  DialogueLifecycleClassification,
} from "../src/dialogue/classifyDialogueLifecycle.js";

import {
  reconcileDialogueLifecycle,
  type DialogueLifecycleReconciliationDependencies,
} from "../src/dialogue/reconcileDialogueLifecycle.js";

import type {
  DialogueReservation,
} from "../src/dialogue/dialogueReservation.schema.js";

import {
  createRunwayDialogueProductionReconciler,
  type RunwayDialogueProductionReconcilerDependencies,
} from "../src/dialogue/createRunwayDialogueProductionReconciler.js";

import {
  loadDialogueVoicePolicy,
} from "../src/validation/loadDialogueVoicePolicy.js";

const PLAN_KEY =
  "a".repeat(
    64,
  );

const REFERENCE_AUDIO_SHA256 =
  "ad7bc6a50675bddc74a4885f290667fad1076c5cd3d9844eb7ff2d84b0f94a2f";

function createReferenceAudioPlan() {
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

      referenceAudio: {
        assetId:
          "OLLIE_VOICE_REFERENCE_V1",

        mediaRootRelativePath:
          "references/voices/OLLIE/ollie-reference-v1.mp3",

        bytes:
          231_593,

        sha256:
          REFERENCE_AUDIO_SHA256,

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
  };
}

function createDirectSeedAudioSubmission() {
  return {
    schemaVersion:
      "3.0",

    submittedAt:
      "2026-10-05T18:45:00.000Z",

    status:
      "SUBMITTED",

    reservationId:
      "11111111-1111-4111-8111-111111111111",

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
      "task-seed-audio-123",

    providerEstimatedCredits:
      2.5,

    recoveryMetadata: {
      request: {
        model:
          "seed_audio",

        promptText:
          "Look what I found!",

        outputFormat:
          "mp3",

        sampleRate:
          44_100,

        voice: {
          type:
            "reference-audio",

          audioUri:
            "runway://uploads/ollie-reference-v1",
        },
      },

      locallyExpectedCredits:
        2,

      plan:
        createReferenceAudioPlan(),
    },
  };
}

describe(
  "BusyBookie direct SeedAudio durable contracts",
  () => {
    it(
      "accepts a v3 durable Runway direct-SeedAudio submission without Model Router evidence",
      () => {
        const parsed =
          DialogueSubmissionSchema.safeParse(
            createDirectSeedAudioSubmission(),
          );

        if (!parsed.success) {
          throw parsed.error;
        }

        expect(
          parsed.data.schemaVersion,
        ).toBe(
          "3.0",
        );

        expect(
          "routing" in parsed.data,
        ).toBe(
          false,
        );

        expect(
          parsed.data.recoveryMetadata
            .request,
        ).toEqual({
          model:
            "seed_audio",

          promptText:
            "Look what I found!",

          outputFormat:
            "mp3",

          sampleRate:
            44_100,

          voice: {
            type:
              "reference-audio",

            audioUri:
              "runway://uploads/ollie-reference-v1",
          },
        });
      },
    );

    it(
      "rejects Model Router evidence on a v3 direct-SeedAudio submission",
      () => {
        const candidate = {
          ...createDirectSeedAudioSubmission(),

          routing: {
            configId:
              "must-not-exist",

            model:
              "seed_audio",

            provider:
              "test-provider",

            estimatedCost: {
              credits:
                2.5,
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
        };

        expect(
          DialogueSubmissionSchema.safeParse(
            candidate,
          ).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a direct reference-audio submission using any model other than seed_audio",
      () => {
        const candidate =
          createDirectSeedAudioSubmission();

        candidate.recoveryMetadata.request.model =
          "eleven_v3";

        expect(
          DialogueSubmissionSchema.safeParse(
            candidate,
          ).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects direct SeedAudio when request text differs from the immutable dialogue plan",
      () => {
        const candidate =
          createDirectSeedAudioSubmission();

        candidate.recoveryMetadata.request.promptText =
          "Different dialogue.";

        expect(
          DialogueSubmissionSchema.safeParse(
            candidate,
          ).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects direct SeedAudio when the reference voice is not a Runway upload URI",
      () => {
        const candidate =
          createDirectSeedAudioSubmission();

        candidate.recoveryMetadata.request.voice.audioUri =
          "https://example.com/ollie.mp3";

        expect(
          DialogueSubmissionSchema.safeParse(
            candidate,
          ).success,
        ).toBe(
          false,
        );
      },
    );
  },
);


function createDirectSeedAudioGenerationRecord() {
  return {
    schemaVersion:
      "3.0",

    recordedAt:
      "2026-10-05T18:46:00.000Z",

    status:
      "SUCCEEDED",

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-seed-audio-123",

    providerModel:
      "seed_audio",

    providerCreatedAt:
      "2026-10-05T18:45:30.000Z",

    request: {
      model:
        "seed_audio",

      promptText:
        "Look what I found!",

      outputFormat:
        "mp3",

      sampleRate:
        44_100,

      voice: {
        type:
          "reference-audio",

        audioUri:
          "runway://uploads/ollie-reference-v1",
      },
    },

    credits: {
      locallyExpected:
        2,

      providerEstimated:
        2.5,

      providerFinal:
        2.25,
    },

    plan:
      createReferenceAudioPlan(),

    outputs: [
      {
        outputIndex:
          1,

        destinationPath:
          "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_task-seed-audio-123_01.audio",

        bytes:
          123_456,

        sha256:
          "b".repeat(
            64,
          ),

        contentType:
          "audio/mpeg",
      },
    ],
  };
}

describe(
  "BusyBookie direct SeedAudio generation-record contracts",
  () => {
    it(
      "accepts a v3 successful direct SeedAudio generation record without Model Router evidence",
      () => {
        const parsed =
          DialogueGenerationRecordSchema.safeParse(
            createDirectSeedAudioGenerationRecord(),
          );

        if (!parsed.success) {
          throw parsed.error;
        }

        expect(
          parsed.data.schemaVersion,
        ).toBe(
          "3.0",
        );

        expect(
          parsed.data.providerModel,
        ).toBe(
          "seed_audio",
        );

        expect(
          "routing" in parsed.data,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects Model Router evidence on a v3 direct SeedAudio generation record",
      () => {
        const candidate = {
          ...createDirectSeedAudioGenerationRecord(),

          routing: {
            configId:
              "must-not-exist",

            model:
              "seed_audio",

            provider:
              "test-provider",

            estimatedCost: {
              credits:
                2.5,
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
        };

        expect(
          DialogueGenerationRecordSchema.safeParse(
            candidate,
          ).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a v3 generation record whose provider model is not seed_audio",
      () => {
        const candidate =
          createDirectSeedAudioGenerationRecord();

        candidate.providerModel =
          "eleven_v3";

        expect(
          DialogueGenerationRecordSchema.safeParse(
            candidate,
          ).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a v3 generation record when request text differs from the immutable dialogue plan",
      () => {
        const candidate =
          createDirectSeedAudioGenerationRecord();

        candidate.request.promptText =
          "Different dialogue.";

        expect(
          DialogueGenerationRecordSchema.safeParse(
            candidate,
          ).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a v3 generation record using a non-Runway reference-audio URI",
      () => {
        const candidate =
          createDirectSeedAudioGenerationRecord();

        candidate.request.voice.audioUri =
          "https://example.com/ollie.mp3";

        expect(
          DialogueGenerationRecordSchema.safeParse(
            candidate,
          ).success,
        ).toBe(
          false,
        );
      },
    );
  },
);


function createParsedDirectSeedAudioSubmission() {
  const parsed =
    DialogueSubmissionSchema.parse(
      createDirectSeedAudioSubmission(),
    );

  if (
    parsed.schemaVersion !==
    "3.0"
  ) {
    throw new Error(
      "Expected a v3 direct SeedAudio submission fixture.",
    );
  }

  return parsed;
}

function createDirectSeedAudioReservation(
  submission:
    ReturnType<
      typeof createParsedDirectSeedAudioSubmission
    >,
): DialogueReservation {
  return {
    schemaVersion:
      "1.0",

    reservationId:
      submission.reservationId,

    reservedAt:
      "2026-10-05T18:44:00.000Z",

    status:
      "RESERVED",

    episodeId:
      submission.episodeId,

    sceneId:
      submission.sceneId,

    shotId:
      submission.shotId,

    dialogueLineId:
      submission.dialogueLineId,

    planKey:
      submission.planKey,

    provider:
      submission.provider,
  };
}

describe(
  "BusyBookie direct SeedAudio reconciliation contracts",
  () => {
    it(
      "recovers a SUBMITTED v3 direct SeedAudio lifecycle without entering the Eleven v3 path",
      async () => {
        const mediaRoot =
          "D:/Busybookie/Production";

        const submission =
          createParsedDirectSeedAudioSubmission();

        const reservation =
          createDirectSeedAudioReservation(
            submission,
          );

        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "SUBMITTED",

                reservation,

                submission,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const resumeRunwayTask =
          vi.fn(
            async () => {
              throw new Error(
                "LEGACY_ELEVEN_V3_PATH_MUST_NOT_RUN_FOR_DIRECT_SEEDAUDIO",
              );
            },
          );

        const providerExecution =
          Object.freeze({
            taskId:
              submission.providerExecutionId,

            providerCreatedAt:
              "2026-10-05T18:45:30.000Z",

            estimatedCredits:
              submission.providerEstimatedCredits,

            finalCredits:
              2.25,

            outputUrls:
              Object.freeze([
                "https://example.test/direct-seed-audio-output.mp3",
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
                  submission.providerExecutionId,

                providerEstimatedCredits:
                  submission.providerEstimatedCredits,

                waitTimeoutMs:
                  600_000,
              });

              return providerExecution;
            },
          );

        const outputPath =
          createDialogueAudioOutputPath(
            mediaRoot,
            submission.episodeId,
            submission.shotId,
            submission.dialogueLineId,
            submission.provider,
            submission.providerExecutionId,
            1,
          );

        const generationRecordPath =
          createDialogueGenerationRecordPath(
            mediaRoot,
            submission.episodeId,
            submission.shotId,
            submission.dialogueLineId,
            submission.provider,
            submission.providerExecutionId,
          );

        const completionPath =
          createDialogueCompletionPath(
            mediaRoot,
            submission.episodeId,
            submission.sceneId,
            submission.shotId,
            submission.dialogueLineId,
          );

        const expectedGenerationRecord =
          DialogueGenerationRecordSchema.parse({
            ...createDirectSeedAudioGenerationRecord(),

            recordedAt:
              "2026-10-05T18:46:00.000Z",

            providerExecutionId:
              submission.providerExecutionId,

            providerCreatedAt:
              providerExecution.providerCreatedAt,

            request:
              submission.recoveryMetadata
                .request,

            credits: {
              locallyExpected:
                submission.recoveryMetadata
                  .locallyExpectedCredits,

              providerEstimated:
                submission.providerEstimatedCredits,

              providerFinal:
                providerExecution.finalCredits,
            },

            plan:
              submission.recoveryMetadata
                .plan,

            outputs: [
              {
                outputIndex:
                  1,

                destinationPath:
                  outputPath,

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

        const completion:
          DialogueCompletion = {
            schemaVersion:
              "1.0",

            completedAt:
              "2026-10-05T18:47:00.000Z",

            status:
              "COMPLETED",

            reservationId:
              reservation.reservationId,

            episodeId:
              submission.episodeId,

            sceneId:
              submission.sceneId,

            shotId:
              submission.shotId,

            dialogueLineId:
              submission.dialogueLineId,

            planKey:
              submission.planKey,

            provider:
              submission.provider,

            providerExecutionId:
              submission.providerExecutionId,

            generationRecordPath,
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
                outputPath,
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

              expect(
                inputRecord.schemaVersion,
              ).toBe(
                "3.0",
              );

              expect(
                "routing" in inputRecord,
              ).toBe(
                false,
              );

              return {
                record:
                  inputRecord,

                recordPath:
                  generationRecordPath,
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
                  reservation.reservationId,

                episodeId:
                  submission.episodeId,

                sceneId:
                  submission.sceneId,

                shotId:
                  submission.shotId,

                dialogueLineId:
                  submission.dialogueLineId,

                planKey:
                  submission.planKey,

                provider:
                  submission.provider,

                providerExecutionId:
                  submission.providerExecutionId,

                generationRecordPath,
              });

              return {
                record:
                  completion,

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
              "2026-10-05T18:46:00.000Z",
        } satisfies
          DialogueLifecycleReconciliationDependencies;

        const result =
          await reconcileDialogueLifecycle(
            {
              mediaRoot,

              episodeId:
                submission.episodeId,

              sceneId:
                submission.sceneId,

              shotId:
                submission.shotId,

              dialogueLineId:
                submission.dialogueLineId,

              runwayWaitTimeoutMs:
                600_000,
            },
            dependencies,
          );

        expect(
          result.reconciliationMode,
        ).toBe(
          "RECOVERED_SUBMISSION",
        );

        expect(
          result.generationRecord,
        ).toEqual(
          expectedGenerationRecord,
        );

        expect(
          result.generationRecord.schemaVersion,
        ).toBe(
          "3.0",
        );

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayReferenceAudioTask,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "production reconciliation dispatches a SUBMITTED v3 direct SeedAudio lifecycle only through the reference-audio resume adapter",
      async () => {
        const submission =
          createParsedDirectSeedAudioSubmission();

        const reservation =
          createDirectSeedAudioReservation(
            submission,
          );

        const submittedLifecycle =
          {
            state:
              "SUBMITTED",

            reservation,

            submission,
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

        const lookupClient =
          Object.freeze({
            tasks:
              Object.freeze({
                retrieve:
                  vi.fn(),
              }),
          }) as ReturnType<
            RunwayDialogueProductionReconcilerDependencies[
              "createLookupClient"
            ]
          >;

        const createLookupClient =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "createLookupClient"
            ]
          >(
            () =>
              lookupClient,
          );

        const resumeRunwayTask =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "resumeRunwayTask"
            ]
          >(
            async () => {
              throw new Error(
                "PRODUCTION_LEGACY_ELEVEN_V3_PATH_MUST_NOT_RUN_FOR_DIRECT_SEEDAUDIO",
              );
            },
          );

        const providerExecution =
          Object.freeze({
            taskId:
              submission.providerExecutionId,

            providerCreatedAt:
              "2026-10-05T18:45:30.000Z",

            estimatedCredits:
              submission.providerEstimatedCredits,

            finalCredits:
              2.25,

            outputUrls:
              Object.freeze([
                "https://example.test/direct-seed-audio-output.mp3",
              ]),
          });

        const resumeRunwayReferenceAudioTask =
          vi.fn<
            NonNullable<
              RunwayDialogueProductionReconcilerDependencies[
                "resumeRunwayReferenceAudioTask"
              ]
            >
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
                resumeInput.taskId,
              ).toBe(
                submission.providerExecutionId,
              );

              expect(
                resumeInput.providerEstimatedCredits,
              ).toBe(
                submission.providerEstimatedCredits,
              );

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
                dependencies
                  .resumeRunwayTask,
              ).toBeUndefined();

              const resume =
                dependencies
                  .resumeRunwayReferenceAudioTask;

              expect(
                resume,
              ).toBeDefined();

              await resume?.({
                taskId:
                  submission.providerExecutionId,

                providerEstimatedCredits:
                  submission.providerEstimatedCredits,

                waitTimeoutMs:
                  reconciliationInput
                    .runwayWaitTimeoutMs ??
                  600_000,
              });

              throw new Error(
                "V3_PRODUCTION_REFERENCE_AUDIO_DISPATCH_CONFIRMED",
              );
            },
          );

        const reconcile =
          createRunwayDialogueProductionReconciler(
            {
              RUNWAYML_API_SECRET:
                "test-runway-secret",
            },
            {
              inspectLifecycle,
              loadPolicy:
                loadDialogueVoicePolicy,
              createLookupClient,
              resumeRunwayTask,
              resumeRunwayReferenceAudioTask,
              reconcileLifecycle,
            },
          );

        await expect(
          reconcile({
            mediaRoot:
              "D:/Busybookie/Production",

            episodeId:
              submission.episodeId,

            sceneId:
              submission.sceneId,

            shotId:
              submission.shotId,

            dialogueLineId:
              submission.dialogueLineId,
          }),
        ).rejects.toThrow(
          "V3_PRODUCTION_REFERENCE_AUDIO_DISPATCH_CONFIRMED",
        );

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayReferenceAudioTask,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);

describe(
  "BusyBookie direct SeedAudio durable-completion reconciliation",
  () => {
    it(
      "reconciles a COMPLETED v3 direct SeedAudio lifecycle entirely from durable local evidence",
      async () => {
        const mediaRoot =
          "D:/Busybookie/Production";

        const submission =
          createParsedDirectSeedAudioSubmission();

        const reservation =
          createDirectSeedAudioReservation(
            submission,
          );

        const outputPath =
          createDialogueAudioOutputPath(
            mediaRoot,
            submission.episodeId,
            submission.shotId,
            submission.dialogueLineId,
            submission.provider,
            submission.providerExecutionId,
            1,
          );

        const generationRecordPath =
          createDialogueGenerationRecordPath(
            mediaRoot,
            submission.episodeId,
            submission.shotId,
            submission.dialogueLineId,
            submission.provider,
            submission.providerExecutionId,
          );

        const completionPath =
          createDialogueCompletionPath(
            mediaRoot,
            submission.episodeId,
            submission.sceneId,
            submission.shotId,
            submission.dialogueLineId,
          );

        const generationRecord =
          DialogueGenerationRecordSchema.parse({
            ...createDirectSeedAudioGenerationRecord(),

            providerExecutionId:
              submission.providerExecutionId,

            request:
              submission.recoveryMetadata
                .request,

            credits: {
              locallyExpected:
                submission.recoveryMetadata
                  .locallyExpectedCredits,

              providerEstimated:
                submission.providerEstimatedCredits,

              providerFinal:
                2.25,
            },

            plan:
              submission.recoveryMetadata
                .plan,

            outputs: [
              {
                outputIndex:
                  1,

                destinationPath:
                  outputPath,

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

        const completion:
          DialogueCompletion = {
            schemaVersion:
              "1.0",

            completedAt:
              "2026-10-05T18:47:00.000Z",

            status:
              "COMPLETED",

            reservationId:
              reservation.reservationId,

            episodeId:
              submission.episodeId,

            sceneId:
              submission.sceneId,

            shotId:
              submission.shotId,

            dialogueLineId:
              submission.dialogueLineId,

            planKey:
              submission.planKey,

            provider:
              submission.provider,

            providerExecutionId:
              submission.providerExecutionId,

            generationRecordPath,
          };

        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "COMPLETED",

                reservation,

                submission,

                completion,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const resumeRunwayTask =
          vi.fn(
            async () => {
              throw new Error(
                "LEGACY_PROVIDER_RESUME_MUST_NOT_RUN_FOR_V3_DURABLE_COMPLETION",
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
            async () => {
              throw new Error(
                "REFERENCE_AUDIO_PROVIDER_RESUME_MUST_NOT_RUN_FOR_V3_DURABLE_COMPLETION",
              );
            },
          );

        const readGenerationRecord =
          vi.fn<
            NonNullable<
              DialogueLifecycleReconciliationDependencies[
                "readGenerationRecord"
              ]
            >
          >(
            async () =>
              generationRecord,
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
              filePath,
            ) =>
              ({
                filePath,

                bytes:
                  456,

                sha256:
                  "c".repeat(
                    64,
                  ),
              }) as Awaited<
                ReturnType<
                  NonNullable<
                    DialogueLifecycleReconciliationDependencies[
                      "inspectOutput"
                    ]
                  >
                >
              >,
          );

        const result =
          await reconcileDialogueLifecycle(
            {
              mediaRoot,

              episodeId:
                submission.episodeId,

              sceneId:
                submission.sceneId,

              shotId:
                submission.shotId,

              dialogueLineId:
                submission.dialogueLineId,
            },
            {
              inspectLifecycle,
              resumeRunwayTask,
              resumeRunwayReferenceAudioTask,
              readGenerationRecord,
              inspectOutput,
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
            submission.providerExecutionId,

          generationRecord,

          generationRecordPath,

          completion,

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
  },
);

describe(
  "BusyBookie direct SeedAudio reconciliation fail-closed contracts",
  () => {
    it(
      "fails closed when SUBMITTED v3 recovery has no reference-audio resume adapter",
      async () => {
        const mediaRoot =
          "D:/Busybookie/Production";

        const submission =
          createParsedDirectSeedAudioSubmission();

        const reservation =
          createDirectSeedAudioReservation(
            submission,
          );

        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "SUBMITTED",

                reservation,

                submission,
              }) satisfies
                DialogueLifecycleClassification,
          );

        const resumeRunwayTask =
          vi.fn(
            async () => {
              throw new Error(
                "LEGACY_ELEVEN_V3_FALLBACK_MUST_NOT_RUN",
              );
            },
          );

        const recoverOutput =
          vi.fn(
            async () => {
              throw new Error(
                "OUTPUT_RECOVERY_MUST_NOT_START_WITHOUT_REFERENCE_AUDIO_RESUME",
              );
            },
          );

        await expect(
          reconcileDialogueLifecycle(
            {
              mediaRoot,

              episodeId:
                submission.episodeId,

              sceneId:
                submission.sceneId,

              shotId:
                submission.shotId,

              dialogueLineId:
                submission.dialogueLineId,
            },
            {
              inspectLifecycle,
              resumeRunwayTask,
              recoverOutput,
            },
          ),
        ).rejects.toThrow(
          /requires resumeRunwayReferenceAudioTask.*reference-audio dialogue task/i,
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
      "production reconciliation fails closed for SUBMITTED v3 when the reference-audio adapter is unavailable",
      async () => {
        const submission =
          createParsedDirectSeedAudioSubmission();

        const reservation =
          createDirectSeedAudioReservation(
            submission,
          );

        const submittedLifecycle =
          {
            state:
              "SUBMITTED",

            reservation,

            submission,
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

        const createLookupClient =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "createLookupClient"
            ]
          >(
            () =>
              ({
                tasks: {
                  retrieve:
                    vi.fn(),
                },
              }) as ReturnType<
                RunwayDialogueProductionReconcilerDependencies[
                  "createLookupClient"
                ]
              >,
          );

        const resumeRunwayTask =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "resumeRunwayTask"
            ]
          >(
            async () => {
              throw new Error(
                "PRODUCTION_LEGACY_ELEVEN_V3_FALLBACK_MUST_NOT_RUN",
              );
            },
          );

        const reconcileLifecycle =
          vi.fn<
            RunwayDialogueProductionReconcilerDependencies[
              "reconcileLifecycle"
            ]
          >(
            async () => {
              throw new Error(
                "CORE_RECONCILIATION_MUST_NOT_START_WITHOUT_REFERENCE_AUDIO_ADAPTER",
              );
            },
          );

        const reconcile =
          createRunwayDialogueProductionReconciler(
            {
              RUNWAYML_API_SECRET:
                "test-runway-secret",
            },
            {
              inspectLifecycle,
              loadPolicy:
                loadDialogueVoicePolicy,
              createLookupClient,
              resumeRunwayTask,
              reconcileLifecycle,
            },
          );

        await expect(
          reconcile({
            mediaRoot:
              "D:/Busybookie/Production",

            episodeId:
              submission.episodeId,

            sceneId:
              submission.sceneId,

            shotId:
              submission.shotId,

            dialogueLineId:
              submission.dialogueLineId,
          }),
        ).rejects.toThrow(
          /requires resumeRunwayReferenceAudioTask.*reference-audio v2\/v3 lifecycle/i,
        );

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          reconcileLifecycle,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "rejects corrupted durable v3 generation evidence before output verification",
      async () => {
        const mediaRoot =
          "D:/Busybookie/Production";

        const submission =
          createParsedDirectSeedAudioSubmission();

        const reservation =
          createDirectSeedAudioReservation(
            submission,
          );

        const outputPath =
          createDialogueAudioOutputPath(
            mediaRoot,
            submission.episodeId,
            submission.shotId,
            submission.dialogueLineId,
            submission.provider,
            submission.providerExecutionId,
            1,
          );

        const generationRecordPath =
          createDialogueGenerationRecordPath(
            mediaRoot,
            submission.episodeId,
            submission.shotId,
            submission.dialogueLineId,
            submission.provider,
            submission.providerExecutionId,
          );

        const completion:
          DialogueCompletion = {
            schemaVersion:
              "1.0",

            completedAt:
              "2026-10-05T18:47:00.000Z",

            status:
              "COMPLETED",

            reservationId:
              reservation.reservationId,

            episodeId:
              submission.episodeId,

            sceneId:
              submission.sceneId,

            shotId:
              submission.shotId,

            dialogueLineId:
              submission.dialogueLineId,

            planKey:
              submission.planKey,

            provider:
              submission.provider,

            providerExecutionId:
              submission.providerExecutionId,

            generationRecordPath,
          };

        const validGenerationRecord =
          DialogueGenerationRecordSchema.parse({
            ...createDirectSeedAudioGenerationRecord(),

            providerExecutionId:
              submission.providerExecutionId,

            request:
              submission.recoveryMetadata
                .request,

            credits: {
              locallyExpected:
                submission.recoveryMetadata
                  .locallyExpectedCredits,

              providerEstimated:
                submission.providerEstimatedCredits,

              providerFinal:
                2.25,
            },

            plan:
              submission.recoveryMetadata
                .plan,

            outputs: [
              {
                outputIndex:
                  1,

                destinationPath:
                  outputPath,

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

        const corruptedGenerationRecord = {
          ...validGenerationRecord,

          providerExecutionId:
            "task-seed-audio-corrupted",
        };

        const inspectLifecycle =
          vi.fn(
            async () =>
              ({
                state:
                  "COMPLETED",

                reservation,

                submission,

                completion,
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
            async () =>
              corruptedGenerationRecord,
          );

        const inspectOutput =
          vi.fn<
            NonNullable<
              DialogueLifecycleReconciliationDependencies[
                "inspectOutput"
              ]
            >
          >(
            async () => {
              throw new Error(
                "OUTPUT_VERIFICATION_MUST_NOT_START_AFTER_CORRUPTED_V3_EVIDENCE",
              );
            },
          );

        await expect(
          reconcileDialogueLifecycle(
            {
              mediaRoot,

              episodeId:
                submission.episodeId,

              sceneId:
                submission.sceneId,

              shotId:
                submission.shotId,

              dialogueLineId:
                submission.dialogueLineId,
            },
            {
              inspectLifecycle,
              readGenerationRecord,
              inspectOutput,
            },
          ),
        ).rejects.toThrow(
          /direct SeedAudio generation record provider execution identity does not match/i,
        );

        expect(
          inspectOutput,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
