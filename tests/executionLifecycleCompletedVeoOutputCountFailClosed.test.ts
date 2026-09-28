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
} from "../src/execution/reconcileExecutionLifecycle.js";

import {
  buildVeoGenerationRecord,
} from "../src/veo/audit/buildVeoGenerationRecord.js";

import {
  createVeoGenerationRecordPathFromIdentity,
} from "../src/veo/audit/writeVeoGenerationRecord.js";

import {
  createVeoVideoOutputPath,
} from "../src/veo/output/veoOutputPath.js";

describe(
  "Busybookie completed Veo output-count fail-closed coverage",
  () => {
    it(
      "rejects completed Veo evidence when generation-record output count differs from durable recovery metadata",
      async () => {
        const mediaRoot =
          "D:/Busybookie/Production";

        const operationName =
          "models/veo-3.1-fast-generate-preview/operations/durable-veo-completed-123";

        const generationRecordPath =
          createVeoGenerationRecordPathFromIdentity(
            mediaRoot,
            "EP91",
            "S06",
            operationName,
          );

        const completionPath =
          createExecutionCompletionPath(
            mediaRoot,
            "EP91",
            "S06",
          );

        const outputPath =
          createVeoVideoOutputPath(
            mediaRoot,
            "EP91",
            "S06",
            operationName,
            1,
          );

        const request =
          Object.freeze({
            durationSeconds:
              4 as const,

            aspectRatio:
              "16:9" as const,

            resolution:
              "720p" as const,

            numberOfVideos:
              1 as const,

            nativeAudioExpected:
              true as const,

            expectedOutputFps:
              24 as const,

            promptText:
              "Busybookie durable completed Veo reconciliation test.",

            sourceImagePath:
              "D:/Busybookie/Production/references/EP91/S06/reference.png",

            imageMimeType:
              "image/png" as const,
          });

        const costPolicy =
          Object.freeze({
            pricingReviewedOn:
              "2026-09-28",

            centsPerSecond:
              10,

            locallyExpectedCents:
              40,
          });

        const generationRecord =
          buildVeoGenerationRecord({
            recordedAt:
              "2026-09-28T11:30:00.000Z",

            episodeId:
              "EP91",

            shotId:
              "S06",

            operationName,

            request,

            costPolicy,

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
                  outputPath,

                bytes:
                  654,

                sha256:
                  "d".repeat(
                    64,
                  ),

                contentType:
                  "video/mp4",
              },

              {
                outputIndex:
                  2,

                destinationPath:
                  createVeoVideoOutputPath(
                    mediaRoot,
                    "EP91",
                    "S06",
                    operationName,
                    2,
                  ),

                bytes:
                  655,

                sha256:
                  "e".repeat(
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
              "2026-09-28T11:31:00.000Z",

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
              operationName,

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
                  "2026-09-28T11:00:00.000Z",

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
                  "2026-09-28T11:01:00.000Z",

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
                  operationName,

                recoveryMetadata: {
                  request,

                  costPolicy,
                },
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

        const inspectVeoOutput =
          vi.fn(
            async () =>
              Object.freeze({
                bytes:
                  654,

                sha256:
                  "d".repeat(
                    64,
                  ),
              }),
          );

        const resumeRunwayTask =
          vi.fn(
            async () => {
              throw new Error(
                "Completed Veo reconciliation must not resume Runway.",
              );
            },
          );

        const resumeVeoOperation =
          vi.fn(
            async () => {
              throw new Error(
                "Completed Veo reconciliation must not contact Veo.",
              );
            },
          );

        const recoverVeoOutput =
          vi.fn(
            async () => {
              throw new Error(
                "Completed Veo reconciliation must not recover or download outputs.",
              );
            },
          );

        const recoverVeoGenerationRecord =
          vi.fn(
            async () => {
              throw new Error(
                "Completed Veo reconciliation must not recover or write a generation record.",
              );
            },
          );

        const recoverExecutionCompletion =
          vi.fn(
            async () => {
              throw new Error(
                "Completed Veo reconciliation must not recover or write completion.",
              );
            },
          );

        const now =
          vi.fn(
            () =>
              "2099-01-01T00:00:00.000Z",
          );

        const dependencies =
          Object.freeze({
            inspectLifecycle,
            readVeoGenerationRecord,
            inspectVeoOutput,
            resumeRunwayTask,
            resumeVeoOperation,
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
          /output count does not match durable submission recovery metadata/i,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          readVeoGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          readVeoGenerationRecord,
        ).toHaveBeenCalledWith(
          mediaRoot,
          "EP91",
          "S06",
          operationName,
        );

        expect(
          inspectVeoOutput,
        ).not.toHaveBeenCalled();

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

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
