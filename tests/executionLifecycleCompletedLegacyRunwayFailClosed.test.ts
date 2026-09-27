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

import {
  createRunwayGenerationRecordPathFromIdentity,
} from "../src/runway/audit/writeRunwayGenerationRecord.js";

describe(
  "Busybookie completed legacy Runway reconciliation fail-closed coverage",
  () => {
    it(
      "rejects completed Runway 1.1 before reading generation evidence or calling provider/recovery paths",
      async () => {
        const mediaRoot =
          "D:/Busybookie/Production";

        const generationRecordPath =
          createRunwayGenerationRecordPathFromIdentity(
            mediaRoot,
            "EP91",
            "S07",
            "task-completed-legacy-123",
          );

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
                  "77777777-7777-4777-8777-777777777777",

                reservedAt:
                  "2026-09-25T22:00:00.000Z",

                status:
                  "RESERVED",

                episodeId:
                  "EP91",

                shotId:
                  "S07",

                provider:
                  "RUNWAY",
              }),

            submission:
              Object.freeze({
                schemaVersion:
                  "1.1",

                submittedAt:
                  "2026-09-25T22:01:00.000Z",

                status:
                  "SUBMITTED",

                reservationId:
                  "77777777-7777-4777-8777-777777777777",

                episodeId:
                  "EP91",

                shotId:
                  "S07",

                provider:
                  "RUNWAY",

                providerExecutionId:
                  "task-completed-legacy-123",

                providerEstimatedCredits:
                  60,
              }),

            completion:
              Object.freeze({
                schemaVersion:
                  "1.0",

                completedAt:
                  "2026-09-25T22:31:00.000Z",

                status:
                  "COMPLETED",

                reservationId:
                  "77777777-7777-4777-8777-777777777777",

                episodeId:
                  "EP91",

                shotId:
                  "S07",

                provider:
                  "RUNWAY",

                providerExecutionId:
                  "task-completed-legacy-123",

                generationRecordPath,
              }),
          });

        const inspectLifecycle =
          vi.fn(
            async () =>
              lifecycle,
          );

        const readRunwayGenerationRecord =
          vi.fn(
            async () => {
              throw new Error(
                "Legacy completed reconciliation must fail before reading generation evidence.",
              );
            },
          );

        const resumeRunwayTask =
          vi.fn(
            async () => {
              throw new Error(
                "Legacy completed reconciliation must not resume Runway.",
              );
            },
          );

        const recoverRunwayOutput =
          vi.fn();

        const recoverRunwayGenerationRecord =
          vi.fn();

        const recoverExecutionCompletion =
          vi.fn();

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
                "S07",

              runwayWaitTimeoutMs:
                600_000,
            },
            dependencies,
          ),
        ).rejects.toThrow(
          /completed Runway submission schema 1\.1 cannot be automatically reconciled because durable recovery metadata is unavailable/i,
        );

        expect(
          readRunwayGenerationRecord,
        ).not.toHaveBeenCalled();

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
