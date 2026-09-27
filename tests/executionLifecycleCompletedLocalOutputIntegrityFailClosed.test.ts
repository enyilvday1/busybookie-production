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
  createRunwayGenerationRecordPathFromIdentity,
} from "../src/runway/audit/writeRunwayGenerationRecord.js";

import {
  createRunwayVideoOutputPath,
} from "../src/runway/output/runwayOutputPath.js";

describe(
  "Busybookie completed local Runway output integrity fail-closed coverage",
  () => {
    it(
      "rejects completed durable evidence when the local output SHA-256 no longer matches the generation record",
      async () => {
        const mediaRoot =
          "D:/Busybookie/Production";

        const generationRecordPath =
          createRunwayGenerationRecordPathFromIdentity(
            mediaRoot,
            "EP91",
            "S01",
            "task-durable-123",
          );

        const completionPath =
          createExecutionCompletionPath(
            mediaRoot,
            "EP91",
            "S01",
          );

        const outputPath =
          createRunwayVideoOutputPath(
            mediaRoot,
            "EP91",
            "S01",
            "task-durable-123",
            1,
          );

        const generationRecord =
          Object.freeze({
            schemaVersion:
              "1.0" as const,

            recordedAt:
              "2026-09-25T20:30:00.000Z",

            provider:
              "RUNWAY" as const,

            model:
              "gen4.5" as const,

            status:
              "SUCCEEDED" as const,

            episodeId:
              "EP91",

            shotId:
              "S01",

            taskId:
              "task-durable-123",

            request: {
              durationSeconds:
                5,

              ratio:
                "1280:720" as const,

              outputFormat:
                "mp4" as const,

              promptText:
                "Busybookie durable completion reconciliation test.",

              sourceImagePath:
                "D:/Busybookie/Production/references/EP91/S01/reference.png",

              assetStrategy:
                "DATA_URI" as const,
            },

            credits: {
              locallyExpected:
                60,

              providerEstimated:
                60,

              providerFinal:
                55,
            },

            outputs: [
              {
                outputIndex:
                  1,

                destinationPath:
                  outputPath,

                bytes:
                  123,

                sha256:
                  "a".repeat(
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
              "2026-09-25T20:31:00.000Z",

            status:
              "COMPLETED" as const,

            reservationId:
              "11111111-1111-4111-8111-111111111111",

            episodeId:
              "EP91",

            shotId:
              "S01",

            provider:
              "RUNWAY" as const,

            providerExecutionId:
              "task-durable-123",

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
                  "11111111-1111-4111-8111-111111111111",

                reservedAt:
                  "2026-09-25T20:00:00.000Z",

                status:
                  "RESERVED",

                episodeId:
                  "EP91",

                shotId:
                  "S01",

                provider:
                  "RUNWAY",
              }),

            submission:
              Object.freeze({
                schemaVersion:
                  "1.2",

                submittedAt:
                  "2026-09-25T20:01:00.000Z",

                status:
                  "SUBMITTED",

                reservationId:
                  "11111111-1111-4111-8111-111111111111",

                episodeId:
                  "EP91",

                shotId:
                  "S01",

                provider:
                  "RUNWAY",

                providerExecutionId:
                  "task-durable-123",

                providerEstimatedCredits:
                  60,

                recoveryMetadata: {
                  request: {
                    durationSeconds:
                      5,

                    ratio:
                      "1280:720",

                    outputFormat:
                      "mp4",

                    promptText:
                      "Busybookie durable completion reconciliation test.",

                    sourceImagePath:
                      "D:/Busybookie/Production/references/EP91/S01/reference.png",

                    assetStrategy:
                      "DATA_URI",
                  },

                  locallyExpectedCredits:
                    60,
                } as const,
              }),

            completion,
          });

        const inspectLifecycle =
          vi.fn(
            async () =>
              lifecycle,
          );

        const readRunwayGenerationRecord =
          vi.fn(
            async () =>
              generationRecord,
          );

        const inspectRunwayOutput =
          vi.fn(
            async () =>
              Object.freeze({
                bytes:
                  123,

                sha256:
                  "b".repeat(
                    64,
                  ),
              }),
          );

        const resumeRunwayTask =
          vi.fn(
            async () => {
              throw new Error(
                "Completed reconciliation must not resume Runway.",
              );
            },
          );

        const recoverRunwayOutput =
          vi.fn(
            async () => {
              throw new Error(
                "Completed reconciliation must not recover outputs.",
              );
            },
          );

        const recoverRunwayGenerationRecord =
          vi.fn(
            async () => {
              throw new Error(
                "Completed reconciliation must not recover or write a generation record.",
              );
            },
          );

        const recoverExecutionCompletion =
          vi.fn(
            async () => {
              throw new Error(
                "Completed reconciliation must not recover or write completion.",
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
            resumeRunwayTask,
            readRunwayGenerationRecord,
            inspectRunwayOutput,
            recoverRunwayOutput,
            recoverRunwayGenerationRecord,
            recoverExecutionCompletion,
            now,
          }) as unknown as
            ExecutionLifecycleReconciliationDependencies;

        await expect(
          reconcileExecutionLifecycle(
            {
              mediaRoot,

              episodeId:
                "EP91",

              shotId:
                "S01",

              runwayWaitTimeoutMs:
                600_000,
            },
            dependencies,
          ),
        ).rejects.toThrow(
          /durable Runway local output does not match generation record evidence/i,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          readRunwayGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          readRunwayGenerationRecord,
        ).toHaveBeenCalledWith(
          mediaRoot,
          "EP91",
          "S01",
          "task-durable-123",
        );

        expect(
          inspectRunwayOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectRunwayOutput,
        ).toHaveBeenCalledWith(
          outputPath,
        );

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();

        expect(
          recoverRunwayOutput,
        ).not.toHaveBeenCalled();

        expect(
          recoverRunwayGenerationRecord,
        ).not.toHaveBeenCalled();

        expect(
          recoverExecutionCompletion,
        ).not.toHaveBeenCalled();

        expect(
          now,
        ).not.toHaveBeenCalled();

      },
    );
  },
);
