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
  "Busybookie Veo lifecycle reconciliation fail-closed coverage",
  () => {
    it(
      "never sends a Veo submission to the Runway resume dependency",
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
                  "33333333-3333-4333-8333-333333333333",

                reservedAt:
                  "2026-09-25T20:00:00.000Z",

                status:
                  "RESERVED",

                episodeId:
                  "EP91",

                shotId:
                  "S03",

                provider:
                  "VEO",
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
                  "33333333-3333-4333-8333-333333333333",

                episodeId:
                  "EP91",

                shotId:
                  "S03",

                provider:
                  "VEO",

                providerExecutionId:
                  "operations/veo-durable-123",
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
                "Runway resume must not be called for Veo.",
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
                "S03",

              runwayWaitTimeoutMs:
                600_000,
            },
            {
              inspectLifecycle,
              resumeRunwayTask,
            },
          ),
        ).rejects.toThrow(
          /provider VEO is not implemented in this milestone/i,
        );

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
