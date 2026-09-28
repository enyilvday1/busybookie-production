import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  ExecutionLifecycleClassification,
} from "../src/execution/classifyExecutionLifecycle.js";

import {
  reconcileExecutionLifecycle,
  type ExecutionLifecycleReconciliationDependencies,
  type ExecutionLifecycleReconciliationInput,
} from "../src/execution/reconcileExecutionLifecycle.js";

import {
  buildVeoGenerationRecord,
} from "../src/veo/audit/buildVeoGenerationRecord.js";

import {
  createVeoVideoOutputPath,
} from "../src/veo/output/veoOutputPath.js";

import type {
  VeoExecutionResult,
} from "../src/veo/execution/veoExecution.js";

describe(
  "Busybookie submitted Veo execution lifecycle reconciliation",
  () => {
    it(
      "resumes only the durable Veo operation and recovers its already-generated evidence without a fresh submission path",
      async () => {
        const lifecycle:
          ExecutionLifecycleClassification =
          Object.freeze({
            state:
              "SUBMITTED",

            reservation:
              Object.freeze({
                schemaVersion:
                  "1.0",

                reservationId:
                  "44444444-4444-4444-8444-444444444444",

                reservedAt:
                  "2026-09-27T20:00:00.000Z",

                status:
                  "RESERVED",

                episodeId:
                  "EP91",

                shotId:
                  "S04",

                provider:
                  "VEO",
              }),

            submission:
              Object.freeze({
                schemaVersion:
                  "1.3",

                submittedAt:
                  "2026-09-27T20:01:00.000Z",

                status:
                  "SUBMITTED",

                reservationId:
                  "44444444-4444-4444-8444-444444444444",

                episodeId:
                  "EP91",

                shotId:
                  "S04",

                provider:
                  "VEO",

                providerExecutionId:
                  "models/veo-3.1-fast-generate-preview/operations/durable-veo-123",

                recoveryMetadata: {
                  request: {
                    durationSeconds:
                      4,

                    aspectRatio:
                      "16:9",

                    resolution:
                      "720p",

                    numberOfVideos:
                      1,

                    nativeAudioExpected:
                      true,

                    expectedOutputFps:
                      24,

                    promptText:
                      "Busybookie Veo lifecycle reconciliation recovery test.",

                    sourceImagePath:
                      "D:/Busybookie/Production/references/EP91/S04/reference.png",

                    imageMimeType:
                      "image/png",
                  },

                  costPolicy: {
                    pricingReviewedOn:
                      "2026-09-27",

                    centsPerSecond:
                      10,

                    locallyExpectedCents:
                      40,
                  },
                } as const,
              }),
          });

        const inspectLifecycle =
          vi.fn(
            async () =>
              lifecycle,
          );

        const generatedVideo =
          Object.freeze({
            video:
              Object.freeze({
                uri:
                  "https://example.test/reconciled-veo-01.mp4",

                mimeType:
                  "video/mp4",
              }),
          });

        const providerExecution:
          VeoExecutionResult =
          Object.freeze({
            operationName:
              "models/veo-3.1-fast-generate-preview/operations/durable-veo-123",

            generatedVideos:
              Object.freeze([
                generatedVideo,
              ]),

            raiMediaFilteredCount:
              0,

            raiMediaFilteredReasons:
              Object.freeze([]),
          });

        const resumeVeoOperation =
          vi.fn(
            async (
              input:
                Readonly<{
                  operationName:
                    string;

                  pollIntervalMs:
                    number;

                  timeoutMs:
                    number;
                }>,
            ) => {
              expect(
                input,
              ).toEqual({
                operationName:
                  "models/veo-3.1-fast-generate-preview/operations/durable-veo-123",

                pollIntervalMs:
                  10_000,

                timeoutMs:
                  600_000,
              });

              return providerExecution;
            },
          );

        const destinationPath =
          createVeoVideoOutputPath(
            "D:/Busybookie/Production",
            "EP91",
            "S04",
            "models/veo-3.1-fast-generate-preview/operations/durable-veo-123",
            1,
          );

        const recoveredOutput =
          Object.freeze({
            destinationPath,

            bytes:
              321,

            sha256:
              "c".repeat(
                64,
              ),

            contentType:
              "video/mp4",
          });

        const recoverVeoOutput =
          vi.fn(
            async () =>
              recoveredOutput,
          );

        const recoveredAt =
          "2026-09-27T20:30:00.000Z";

        const now =
          vi.fn(
            () =>
              recoveredAt,
          );

        const generationRecordInput =
          {
            recordedAt:
              recoveredAt,

            episodeId:
              "EP91",

            shotId:
              "S04",

            operationName:
              "models/veo-3.1-fast-generate-preview/operations/durable-veo-123",

            request: {
              durationSeconds:
                4,

              aspectRatio:
                "16:9",

              resolution:
                "720p",

              numberOfVideos:
                1,

              nativeAudioExpected:
                true,

              expectedOutputFps:
                24,

              promptText:
                "Busybookie Veo lifecycle reconciliation recovery test.",

              sourceImagePath:
                "D:/Busybookie/Production/references/EP91/S04/reference.png",

              imageMimeType:
                "image/png",
            },

            costPolicy: {
              pricingReviewedOn:
                "2026-09-27",

              centsPerSecond:
                10,

              locallyExpectedCents:
                40,
            },

            safety: {
              raiMediaFilteredCount:
                0,

              raiMediaFilteredReasons:
                [],
            },

            outputs: [
              {
                outputIndex:
                  1,

                ...recoveredOutput,
              },
            ],
          } satisfies Parameters<
            typeof buildVeoGenerationRecord
          >[0];

        const generationRecord =
          buildVeoGenerationRecord(
            generationRecordInput,
          );

        const generationRecordPath =
          "D:/Busybookie/Production/generated-video/EP91/S04/EP91_S04_durable-veo-123.veo-generation.json";

        const recoverVeoGenerationRecord =
          vi.fn(
            async () =>
              Object.freeze({
                record:
                  generationRecord,

                recordPath:
                  generationRecordPath,
              }),
          );

        const completionPath =
          "D:/Busybookie/Production/generated-video/EP91/S04/EP91_S04.execution-completion.json";

        const completion =
          Object.freeze({
            schemaVersion:
              "1.0" as const,

            completedAt:
              "2026-09-27T20:31:00.000Z",

            status:
              "COMPLETED" as const,

            reservationId:
              "44444444-4444-4444-8444-444444444444",

            episodeId:
              "EP91",

            shotId:
              "S04",

            provider:
              "VEO" as const,

            providerExecutionId:
              "models/veo-3.1-fast-generate-preview/operations/durable-veo-123",

            generationRecordPath,
          });

        const recoverExecutionCompletion =
          vi.fn(
            async () =>
              Object.freeze({
                record:
                  completion,

                completionPath,
              }),
          );

        const dependencies:
          ExecutionLifecycleReconciliationDependencies =
          Object.freeze({
            inspectLifecycle,
            resumeVeoOperation,
            recoverVeoOutput,
            recoverVeoGenerationRecord,
            recoverExecutionCompletion,
            now,
          });

        const input:
          ExecutionLifecycleReconciliationInput =
          Object.freeze({
            mediaRoot:
              "D:/Busybookie/Production",

            episodeId:
              "EP91",

            shotId:
              "S04",

            veoPollIntervalMs:
              10_000,

            veoTimeoutMs:
              600_000,
          });

        const result =
          await reconcileExecutionLifecycle(
            input,
            dependencies,
          );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          resumeVeoOperation,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverVeoOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverVeoOutput,
        ).toHaveBeenCalledWith(
          generatedVideo,
          destinationPath,
        );

        expect(
          now,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverVeoGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverVeoGenerationRecord,
        ).toHaveBeenCalledWith(
          "D:/Busybookie/Production",
          generationRecordInput,
        );

        expect(
          recoverExecutionCompletion,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverExecutionCompletion,
        ).toHaveBeenCalledWith(
          "D:/Busybookie/Production",
          {
            reservationId:
              "44444444-4444-4444-8444-444444444444",

            episodeId:
              "EP91",

            shotId:
              "S04",

            provider:
              "VEO",

            providerExecutionId:
              "models/veo-3.1-fast-generate-preview/operations/durable-veo-123",

            generationRecordPath,
          },
        );

        expect(
          result,
        ).toEqual({
          lifecycleState:
            "COMPLETED",

          reconciliationMode:
            "RECOVERED_SUBMISSION",

          provider:
            "VEO",

          providerExecutionId:
            "models/veo-3.1-fast-generate-preview/operations/durable-veo-123",

          providerExecution,

          generationRecord,

          generationRecordPath,

          completion,

          completionPath,
        });
      },
    );
  },
);
