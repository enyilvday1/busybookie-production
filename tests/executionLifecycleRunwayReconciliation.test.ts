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
                  "1.1",

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
                    "https://example.test/reconciled-runway.mp4",
                  ]),
              });
            },
          );

        const dependencies:
          ExecutionLifecycleReconciliationDependencies =
          Object.freeze({
            inspectLifecycle,
            resumeRunwayTask,
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
          result,
        ).toEqual({
          lifecycleState:
            "SUBMITTED",

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
              "https://example.test/reconciled-runway.mp4",
            ],
          },
        });
      },
    );
  },);
