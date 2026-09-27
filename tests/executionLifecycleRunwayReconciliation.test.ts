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
  buildRunwayGenerationRecord,
} from "../src/runway/audit/buildRunwayGenerationRecord.js";

import {
  createRunwayVideoOutputPath,
} from "../src/runway/output/runwayOutputPath.js";

import {
  reconcileExecutionLifecycle,
  type ExecutionLifecycleReconciliationDependencies,
} from "../src/execution/reconcileExecutionLifecycle.js";

describe(
  "Busybookie submitted execution lifecycle reconciliation",
  () => {
    it(
      "resumes the durable Runway task using durable acceptance metadata without any fresh-submission dependency",
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
                      "Busybookie Runway reconciliation recovery test.",

                    sourceImagePath:
                      "D:/Busybookie/Production/references/EP91/S01/reference.png",

                    assetStrategy:
                      "DATA_URI",
                  },

                  locallyExpectedCredits:
                    60,
                } as const,
              }),
          });

        const inspectLifecycle =
          vi.fn(
            async () =>
              lifecycle,
          );

        const resumeRunwayTask =
          vi.fn(
            async (
              input:
                Readonly<{
                  taskId: string;
                  providerEstimatedCredits: number;
                  waitTimeoutMs: number;
                }>,
            ) => {
              expect(
                input,
              ).toEqual({
                taskId:
                  "task-durable-123",

                providerEstimatedCredits:
                  60,

                waitTimeoutMs:
                  600_000,
              });

              return Object.freeze({
                taskId:
                  "task-durable-123",

                estimatedCredits:
                  60,

                finalCredits:
                  55,

                outputUrls:
                  Object.freeze([
                    "https://example.test/reconciled-runway-01.mp4",
                    "https://example.test/reconciled-runway-02.mp4",
                  ]),
              });
            },
          );

        const firstDestinationPath =
          createRunwayVideoOutputPath(
            "D:/Busybookie/Production",
            "EP91",
            "S01",
            "task-durable-123",
            1,
          );

        const secondDestinationPath =
          createRunwayVideoOutputPath(
            "D:/Busybookie/Production",
            "EP91",
            "S01",
            "task-durable-123",
            2,
          );

        const firstRecoveredOutput =
          Object.freeze({
            destinationPath:
              firstDestinationPath,

            bytes:
              123,

            sha256:
              "a".repeat(
                64,
              ),

            contentType:
              "video/mp4",
          });

        const secondRecoveredOutput =
          Object.freeze({
            destinationPath:
              secondDestinationPath,

            bytes:
              456,

            sha256:
              "b".repeat(
                64,
              ),

            contentType:
              "video/mp4",
          });

        const recoverRunwayOutput =
          vi.fn()
            .mockResolvedValueOnce(
              firstRecoveredOutput,
            )
            .mockResolvedValueOnce(
              secondRecoveredOutput,
            );

        const recoveredAt =
          "2026-09-25T20:30:00.000Z";

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
              "S01",

            taskId:
              "task-durable-123",

            request: {
              durationSeconds:
                5,

              ratio:
                "1280:720",

              outputFormat:
                "mp4",

              promptText:
                "Busybookie Runway reconciliation recovery test.",

              sourceImagePath:
                "D:/Busybookie/Production/references/EP91/S01/reference.png",

              assetStrategy:
                "DATA_URI",
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

                ...firstRecoveredOutput,
              },

              {
                outputIndex:
                  2,

                ...secondRecoveredOutput,
              },
            ],
          } satisfies Parameters<
            typeof buildRunwayGenerationRecord
          >[0];

        const generationRecord =
          buildRunwayGenerationRecord(
            generationRecordInput,
          );

        const generationRecordPath =
          "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_task-durable-123.runway-generation.json";

        const recoverRunwayGenerationRecord =
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
          "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01.execution-completion.json";

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
            resumeRunwayTask,
            recoverRunwayOutput,
            recoverRunwayGenerationRecord,
            recoverExecutionCompletion,
            now,
          });

        const result =
          await reconcileExecutionLifecycle(
            {
              mediaRoot:
                "D:/Busybookie/Production",

              episodeId:
                "EP91",

              shotId:
                "S01",

              runwayWaitTimeoutMs:
                600_000,
            },
            dependencies,
          );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledWith(
          "D:/Busybookie/Production",
          "EP91",
          "S01",
        );

        expect(
          resumeRunwayTask,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverRunwayOutput,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          recoverRunwayOutput,
        ).toHaveBeenNthCalledWith(
          1,
          "https://example.test/reconciled-runway-01.mp4",
          firstDestinationPath,
        );

        expect(
          recoverRunwayOutput,
        ).toHaveBeenNthCalledWith(
          2,
          "https://example.test/reconciled-runway-02.mp4",
          secondDestinationPath,
        );

        expect(
          now,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverRunwayGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverRunwayGenerationRecord,
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
              "11111111-1111-4111-8111-111111111111",

            episodeId:
              "EP91",

            shotId:
              "S01",

            provider:
              "RUNWAY",

            providerExecutionId:
              "task-durable-123",

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
            "RUNWAY",

          providerExecutionId:
            "task-durable-123",

          providerExecution: {
            taskId:
              "task-durable-123",

            estimatedCredits:
              60,

            finalCredits:
              55,

            outputUrls: [
              "https://example.test/reconciled-runway-01.mp4",
              "https://example.test/reconciled-runway-02.mp4",
            ],
          },

          generationRecord,

          generationRecordPath,

          completion,

          completionPath,
        });
      },
    );
  },);
