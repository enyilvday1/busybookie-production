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
  "Busybookie reserved-only lifecycle reconciliation fail-closed coverage",
 () => {
    it(
      "rejects RESERVED_ONLY without any provider resume call",
      async () => {
        const lifecycle:
          ExecutionLifecycleClassification =
          Object.freeze({
            state:
              "RESERVED_ONLY",

            reservation:
              Object.freeze({
                schemaVersion:
                  "1.0",

                reservationId:
                  "44444444-4444-4444-8444-444444444444",

                reservedAt:
                  "2026-09-25T20:00:00.000Z",

                status:
                  "RESERVED",

                episodeId:
                  "EP91",

                shotId:
                  "S04",

                provider:
                  "RUNWAY",
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
                "Runway resume must not be called for RESERVED_ONLY.",
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
                "S04",

              runwayWaitTimeoutMs:
                600_000,
            },
            {
              inspectLifecycle,
              resumeRunwayTask,
            },
          ),
        ).rejects.toThrow(
          /currently requires SUBMITTED state; received RESERVED_ONLY/i,
        );

        expect(
          resumeRunwayTask,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
