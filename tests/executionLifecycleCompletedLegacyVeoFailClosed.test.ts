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
  createVeoGenerationRecordPathFromIdentity,
} from "../src/veo/audit/writeVeoGenerationRecord.js";

describe(
  "Busybookie completed legacy Veo reconciliation fail-closed coverage",
  () => {
    it(
      "rejects completed Veo 1.0 before reading generation evidence or calling provider/recovery paths",
      async () => {
        const mediaRoot =
          "D:/Busybookie/Production";

        const generationRecordPath =
          createVeoGenerationRecordPathFromIdentity(
            mediaRoot,
            "EP91",
            "S07",
            "operations/veo-completed-legacy-123",
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
                  "VEO",
              }),

            submission:
              Object.freeze({
                schemaVersion:
                  "1.0",

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
                  "VEO",

                providerExecutionId:
                  "operations/veo-completed-legacy-123",

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
                  "VEO",

                providerExecutionId:
                  "operations/veo-completed-legacy-123",

                generationRecordPath,
              }),
          });

        const inspectLifecycle =
          vi.fn(
            async () =>
              lifecycle,
          );

        const readVeoGenerationRecord =
          vi.fn(
            async () => {
              throw new Error(
                "Legacy completed reconciliation must fail before reading generation evidence.",
              );
            },
          );

        const resumeVeoOperation =
          vi.fn(
            async () => {
              throw new Error(
                "Legacy completed reconciliation must not resume Veo.",
              );
            },
          );

        const recoverVeoOutput =
          vi.fn();

        const recoverVeoGenerationRecord =
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
            resumeVeoOperation,
            readVeoGenerationRecord,
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
                "S07",
            },
            dependencies,
          ),
        ).rejects.toThrow(
          /completed Veo submission schema 1\.0 cannot be automatically reconciled because durable recovery metadata is unavailable/i,
        );

        expect(
          readVeoGenerationRecord,
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
      },
    );
  },
);
