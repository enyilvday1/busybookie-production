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
} from "../src/execution/reconcileExecutionLifecycle.js";

describe(
  "Busybookie Runway reconciliation task identity fail-closed coverage",
  () => {
    it(
      "rejects when resumed Runway task ID differs from the durable submitted provider execution ID",
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
                  "55555555-5555-4555-8555-555555555555",

                reservedAt:
                  "2026-09-25T20:00:00.000Z",

                status:
                  "RESERVED",

                episodeId:
                  "EP91",

                shotId:
                  "S05",

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
                  "55555555-5555-4555-8555-555555555555",

                episodeId:
                  "EP91",

                shotId:
                  "S05",

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
                      "Busybookie Runway task identity reconciliation test.",

                    sourceImagePath:
                      "D:/Busybookie/Production/references/EP91/S05/reference.png",

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
            async () =>
              Object.freeze({
                taskId:
                  "task-other-999",

                estimatedCredits:
                  60,

                finalCredits:
                  55,

                outputUrls:
                  Object.freeze([
                    "https://example.test/reconciled-runway.mp4",
                  ]),
              }),
          );

        await expect(
          reconcileExecutionLifecycle(
            {
              mediaRoot:
                "D:/Busybookie/Production",

              episodeId:
                "EP91",

              shotId:
                "S05",

              runwayWaitTimeoutMs:
                600_000,
            },
            {
              inspectLifecycle,
              resumeRunwayTask,
            },
          ),
        ).rejects.toThrow(
          /returned task ID task-other-999 but durable submission records task-durable-123/i,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          resumeRunwayTask,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);
