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
  type ExecutionLifecycleReconciliationInput,
} from "../src/execution/reconcileExecutionLifecycle.js";

import type {
  VeoExecutionResult,
} from "../src/veo/execution/veoExecution.js";

const durableOperationName =
  "models/veo-3.1-fast-generate-preview/operations/durable-veo-guard-123";

function createLifecycle():
ExecutionLifecycleClassification {
  return Object.freeze({
    state:
      "SUBMITTED",

    reservation:
      Object.freeze({
        schemaVersion:
          "1.0",

        reservationId:
          "55555555-5555-4555-8555-555555555555",

        reservedAt:
          "2026-09-28T10:00:00.000Z",

        status:
          "RESERVED",

        episodeId:
          "EP91",

        shotId:
          "S05",

        provider:
          "VEO",
      }),

    submission:
      Object.freeze({
        schemaVersion:
          "1.3",

        submittedAt:
          "2026-09-28T10:01:00.000Z",

        status:
          "SUBMITTED",

        reservationId:
          "55555555-5555-4555-8555-555555555555",

        episodeId:
          "EP91",

        shotId:
          "S05",

        provider:
          "VEO",

        providerExecutionId:
          durableOperationName,

        recoveryMetadata: {
          request: {
            durationSeconds:
              4,

            aspectRatio:
              "16:9",

            resolution:
              "720p",

            numberOfVideos:
              1,

            nativeAudioExpected:
              true,

            expectedOutputFps:
              24,

            promptText:
              "Busybookie Veo lifecycle guard test.",

            sourceImagePath:
              "D:/Busybookie/Production/references/EP91/S05/reference.png",

            imageMimeType:
              "image/png",
          },

          costPolicy: {
            pricingReviewedOn:
              "2026-09-28",

            centsPerSecond:
              10,

            locallyExpectedCents:
              40,
          },
        } as const,
      }),
  });
}

const input:
  ExecutionLifecycleReconciliationInput =
  Object.freeze({
    mediaRoot:
      "D:/Busybookie/Production",

    episodeId:
      "EP91",

    shotId:
      "S05",

    veoPollIntervalMs:
      10_000,

    veoTimeoutMs:
      600_000,
  });

describe(
  "Busybookie Veo lifecycle reconciliation safety guards",
  () => {
    it(
      "fails closed when resumed Veo operation identity differs from the durable submission",
      async () => {
        const inspectLifecycle =
          vi.fn(
            async () =>
              createLifecycle(),
          );

        const providerExecution:
          VeoExecutionResult =
          Object.freeze({
            operationName:
              "models/veo-3.1-fast-generate-preview/operations/different-veo-456",

            generatedVideos:
              Object.freeze([
                Object.freeze({
                  video:
                    Object.freeze({
                      uri:
                        "https://example.test/should-not-recover.mp4",
                    }),
                }),
              ]),

            raiMediaFilteredCount:
              0,

            raiMediaFilteredReasons:
              Object.freeze([]),
          });

        const resumeVeoOperation =
          vi.fn(
            async () =>
              providerExecution,
          );

        const recoverVeoOutput =
          vi.fn();

        const dependencies:
          ExecutionLifecycleReconciliationDependencies =
          Object.freeze({
            inspectLifecycle,
            resumeVeoOperation,
            recoverVeoOutput,
          });

        await expect(
          reconcileExecutionLifecycle(
            input,
            dependencies,
          ),
        ).rejects.toThrow(
          /returned operation name .* but durable submission records/i,
        );

        expect(
          resumeVeoOperation,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverVeoOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when resumed Veo output count differs from durable recovery metadata",
      async () => {
        const inspectLifecycle =
          vi.fn(
            async () =>
              createLifecycle(),
          );

        const providerExecution:
          VeoExecutionResult =
          Object.freeze({
            operationName:
              durableOperationName,

            generatedVideos:
              Object.freeze([
                Object.freeze({
                  video:
                    Object.freeze({
                      uri:
                        "https://example.test/unexpected-01.mp4",
                    }),
                }),

                Object.freeze({
                  video:
                    Object.freeze({
                      uri:
                        "https://example.test/unexpected-02.mp4",
                    }),
                }),
              ]),

            raiMediaFilteredCount:
              0,

            raiMediaFilteredReasons:
              Object.freeze([]),
          });

        const resumeVeoOperation =
          vi.fn(
            async () =>
              providerExecution,
          );

        const recoverVeoOutput =
          vi.fn();

        const dependencies:
          ExecutionLifecycleReconciliationDependencies =
          Object.freeze({
            inspectLifecycle,
            resumeVeoOperation,
            recoverVeoOutput,
          });

        await expect(
          reconcileExecutionLifecycle(
            input,
            dependencies,
          ),
        ).rejects.toThrow(
          /output count does not match durable submission recovery metadata/i,
        );

        expect(
          resumeVeoOperation,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          recoverVeoOutput,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
