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
  createExecutionCompletionPath,
} from "../src/execution/executionCompletionPath.js";

import {
  reconcileExecutionLifecycle,
  type ExecutionLifecycleReconciliationDependencies,
} from "../src/execution/reconcileExecutionLifecycle.js";

import {
  buildVeoGenerationRecord,
} from "../src/veo/audit/buildVeoGenerationRecord.js";

import {
  createVeoGenerationRecordPathFromIdentity,
} from "../src/veo/audit/writeVeoGenerationRecord.js";

describe(
  "Busybookie completed Veo reconciliation output-path fail-closed coverage",
  () => {
    it(
      "rejects a generation record whose durable output path is not the canonical Veo output path",
      async () => {
        const mediaRoot =
          "D:/Busybookie/Production";

        const generationRecordPath =
          createVeoGenerationRecordPathFromIdentity(
            mediaRoot,
            "EP91",
            "S06",
            "models/veo-3.1-fast-generate-preview/operations/completed-output-path-123",
          );

        const completionPath =
          createExecutionCompletionPath(
            mediaRoot,
            "EP91",
            "S06",
          );

        const durablePrompt =
          "Busybookie durable submission prompt.";

        const generationRecord =
          buildVeoGenerationRecord({
            recordedAt:
              "2026-09-25T21:30:00.000Z",

            episodeId:
              "EP91",

            shotId:
              "S06",

            operationName:
              "models/veo-3.1-fast-generate-preview/operations/completed-output-path-123",

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
                "Busybookie durable submission prompt.",

              sourceImagePath:
                "D:/Busybookie/Production/references/EP91/S06/reference.png",

              imageMimeType:
                "image/png",
            },

            costPolicy: {
              pricingReviewedOn:
                "2026-09-28",

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

                destinationPath:
                  "D:/Busybookie/Production/generated-video/EP91/S99/unrelated-output.mp4",

                bytes:
                  123,

                sha256:
                  "c".repeat(
                    64,
                  ),

                contentType:
                  "video/mp4",
              },
            ],
          });

        const completion =
          Object.freeze({
            schemaVersion:
              "1.0" as const,

            completedAt:
              "2026-09-25T21:31:00.000Z",

            status:
              "COMPLETED" as const,

            reservationId:
              "66666666-6666-4666-8666-666666666666",

            episodeId:
              "EP91",

            shotId:
              "S06",

            provider:
              "VEO" as const,

            providerExecutionId:
              "models/veo-3.1-fast-generate-preview/operations/completed-output-path-123",

            generationRecordPath,
          });

        const lifecycle:
          ExecutionLifecycleClassification =
          Object.freeze({
            state:
              "COMPLETED",

            reservation:
              Object.freeze({
                schemaVersion:
                  "1.0",

                reservationId:
                  "66666666-6666-4666-8666-666666666666",

                reservedAt:
                  "2026-09-25T21:00:00.000Z",

                status:
                  "RESERVED",

                episodeId:
                  "EP91",

                shotId:
                  "S06",

                provider:
                  "VEO",
              }),

            submission:
              Object.freeze({
                schemaVersion:
                  "1.3",

                submittedAt:
                  "2026-09-25T21:01:00.000Z",

                status:
                  "SUBMITTED",

                reservationId:
                  "66666666-6666-4666-8666-666666666666",

                episodeId:
                  "EP91",

                shotId:
                  "S06",

                provider:
                  "VEO",

                providerExecutionId:
                  "models/veo-3.1-fast-generate-preview/operations/completed-output-path-123",


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
                      durablePrompt,

                    sourceImagePath:
                      "D:/Busybookie/Production/references/EP91/S06/reference.png",

                    imageMimeType:
                      "image/png",
                  },

                  costPolicy: {
                    pricingReviewedOn:
                      "2026-09-28",

                    centsPerSecond:
                      10,

                    locallyExpectedCents:
                      40,
                  },
                } as const,
              }),

            completion,
          });

        const inspectLifecycle =
          vi.fn(
            async () =>
              lifecycle,
          );

        const readVeoGenerationRecord =
          vi.fn(
            async () =>
              generationRecord,
          );

        const resumeVeoOperation =
          vi.fn(
            async () => {
              throw new Error(
                "Completed reconciliation must not resume Veo.",
              );
            },
          );

        const recoverVeoOutput =
          vi.fn(
            async () => {
              throw new Error(
                "Completed reconciliation must not recover outputs.",
              );
            },
          );

        const recoverVeoGenerationRecord =
          vi.fn(
            async () => {
              throw new Error(
                "Completed reconciliation must not write generation evidence.",
              );
            },
          );

        const recoverExecutionCompletion =
          vi.fn(
            async () => {
              throw new Error(
                "Completed reconciliation must not write completion.",
              );
            },
          );

        const now =
          vi.fn(
            () =>
              "2099-01-01T00:00:00.000Z",
          );

        const dependencies:
          ExecutionLifecycleReconciliationDependencies =
          Object.freeze({
            inspectLifecycle,
            resumeVeoOperation,
            readVeoGenerationRecord,
            recoverVeoOutput,
            recoverVeoGenerationRecord,
            recoverExecutionCompletion,
            now,
          });

        await expect(
          reconcileExecutionLifecycle(
            {
              mediaRoot,

              episodeId:
                "EP91",

              shotId:
                "S06",
            },
            dependencies,
          ),
        ).rejects.toThrow(
          /durable Veo generation record output path does not match canonical output path/i,
        );

        expect(
          readVeoGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          resumeVeoOperation,
        ).not.toHaveBeenCalled();

        expect(
          recoverVeoOutput,
        ).not.toHaveBeenCalled();

        expect(
          recoverVeoGenerationRecord,
        ).not.toHaveBeenCalled();

        expect(
          recoverExecutionCompletion,
        ).not.toHaveBeenCalled();

        expect(
          now,
        ).not.toHaveBeenCalled();

        expect(
          completionPath,
        ).toBe(
          createExecutionCompletionPath(
            mediaRoot,
            "EP91",
            "S06",
          ),
        );
      },
    );
  },
);
