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
  buildRunwayGenerationRecord,
} from "../src/runway/audit/buildRunwayGenerationRecord.js";

import {
  createRunwayGenerationRecordPathFromIdentity,
} from "../src/runway/audit/writeRunwayGenerationRecord.js";

import {
  createRunwayVideoOutputPath,
} from "../src/runway/output/runwayOutputPath.js";

describe(
  "Busybookie completed Runway reconciliation identity fail-closed coverage",
  () => {
    it(
      "rejects a generation record whose durable execution identity differs from the completed submission",
      async () => {
        const mediaRoot =
          "D:/Busybookie/Production";

        const generationRecordPath =
          createRunwayGenerationRecordPathFromIdentity(
            mediaRoot,
            "EP91",
            "S06",
            "task-completed-identity-123",
          );

        const completionPath =
          createExecutionCompletionPath(
            mediaRoot,
            "EP91",
            "S06",
          );

        const durablePrompt =
          "Busybookie durable submission prompt.";

        const wrongIdentityOutputPath =
          createRunwayVideoOutputPath(
            mediaRoot,
            "EP91",
            "S06",
            "task-wrong-identity-999",
            1,
          );

        const generationRecord =
          buildRunwayGenerationRecord({
            recordedAt:
              "2026-09-25T21:30:00.000Z",

            episodeId:
              "EP91",

            shotId:
              "S06",

            taskId:
              "task-wrong-identity-999",

            request: {
              durationSeconds:
                5,

              ratio:
                "1280:720",

              outputFormat:
                "mp4",

              promptText:
                "Busybookie durable submission prompt.",

              sourceImagePath:
                "D:/Busybookie/Production/references/EP91/S06/reference.png",

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

                destinationPath:
                  wrongIdentityOutputPath,

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
              "RUNWAY" as const,

            providerExecutionId:
              "task-completed-identity-123",

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
                  "RUNWAY",
              }),

            submission:
              Object.freeze({
                schemaVersion:
                  "1.2",

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
                  "RUNWAY",

                providerExecutionId:
                  "task-completed-identity-123",

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
                      durablePrompt,

                    sourceImagePath:
                      "D:/Busybookie/Production/references/EP91/S06/reference.png",

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
            resumeRunwayTask,
            readRunwayGenerationRecord,
            recoverRunwayOutput,
            recoverRunwayGenerationRecord,
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

              runwayWaitTimeoutMs:
                600_000,
            },
            dependencies,
          ),
        ).rejects.toThrow(
          /durable Runway generation record identity does not match completed submission identity/i,
        );

        expect(
          readRunwayGenerationRecord,
        ).toHaveBeenCalledTimes(
          1,
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
