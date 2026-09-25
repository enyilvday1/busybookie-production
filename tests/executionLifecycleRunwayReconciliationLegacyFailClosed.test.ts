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
  "Busybookie Runway lifecycle reconciliation fail-closed coverage",
  () => {
    it(
      "rejects legacy Runway 1.0 before provider resume",
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
                  "22222222-2222-4222-8222-222222222222",

                reservedAt:
                  "2026-09-25T20:00:00.000Z",

                status:
                  "RESERVED",

                episodeId:
                  "EP91",

                shotId:
                  "S02",

                provider:
                  "RUNWAY",
              }),

            submission:
              Object.freeze({
                schemaVersion:
                  "1.0",

                submittedAt:
                  "2026-09-25T20:01:00.000Z",

                status:
                  "SUBMITTED",

                reservationId:
                  "22222222-2222-4222-8222-222222222222",

                episodeId:
                  "EP91",

                shotId:
                  "S02",

                provider:
                  "RUNWAY",

                providerExecutionId:
                  "task-legacy-123",
              }),
          });

        const inspectLifecycle =
          vi.fn(
            async () =>
              lifecycle,
          );

        const resumeRunwayTask =
          vi.fn(
            async () => {
              throw new Error(
                "Runway resume must not be called for legacy 1.0 submissions.",
              );
            },
          );

        await expect(
          reconcileExecutionLifecycle(
            {
              mediaRoot:
                "D:/Busybookie/Production",

              episodeId:
                "EP91",

              shotId:
                "S02",

              runwayWaitTimeoutMs:
                600_000,
            },
            {
              inspectLifecycle,
              resumeRunwayTask,
            },
          ),
        ).rejects.toThrow(
          /Legacy Runway 1\.0 submissions require manual reconciliation/i,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
