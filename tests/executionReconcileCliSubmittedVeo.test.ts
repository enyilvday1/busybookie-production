import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  ExecutionLifecycleClassification,
} from "../src/execution/classifyExecutionLifecycle.js";

import type {
  ExecutionLifecycleReconciliationResult,
} from "../src/execution/reconcileExecutionLifecycle.js";

import {
  buildVeoGenerationRecord,
} from "../src/veo/audit/buildVeoGenerationRecord.js";

import {
  createVeoOperationLookupClient as createVeoOperationLookupClientProduction,
} from "../src/veo/execution/createVeoOperationLookupClient.js";

import {
  resumeVeoOperation,
} from "../src/veo/execution/resumeVeoOperation.js";

import type {
  VeoExecutionResult,
} from "../src/veo/execution/veoExecution.js";

import {
  runExecutionReconcileCli,
} from "../src/execution/cli/runExecutionReconcileCli.js";

describe(
  "Busybookie execution reconciliation CLI submitted Veo lifecycle",
  () => {
    it(
      "routes durable SUBMITTED Veo execution through lookup-only same-operation recovery",
      async () => {
        const mediaRoot =
          "D:/Busybookie/Production";

        const operationName =
          "models/veo-3.1-fast-generate-preview/operations/durable-veo-123";

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
                  "44444444-4444-4444-8444-444444444444",

                reservedAt:
                  "2026-09-27T20:00:00.000Z",

                status:
                  "RESERVED",

                episodeId:
                  "EP91",

                shotId:
                  "S04",

                provider:
                  "VEO",
              }),

            submission:
              Object.freeze({
                schemaVersion:
                  "1.3",

                submittedAt:
                  "2026-09-27T20:01:00.000Z",

                status:
                  "SUBMITTED",

                reservationId:
                  "44444444-4444-4444-8444-444444444444",

                episodeId:
                  "EP91",

                shotId:
                  "S04",

                provider:
                  "VEO",

                providerExecutionId:
                  operationName,

                recoveryMetadata:
                  Object.freeze({
                    request:
                      Object.freeze({
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
                          "Busybookie Veo lifecycle reconciliation recovery test.",

                        sourceImagePath:
                          "D:/Busybookie/Production/references/EP91/S04/reference.png",

                        imageMimeType:
                          "image/png",
                      }),

                    costPolicy:
                      Object.freeze({
                        pricingReviewedOn:
                          "2026-09-27",

                        centsPerSecond:
                          10,

                        locallyExpectedCents:
                          40,
                      }),
                  }),
              }),
          });

        const loadEnvironment =
          vi.fn(
            () =>
              Object.freeze({
                BUSYBOOKIE_MEDIA_ROOT:
                  mediaRoot,

                GEMINI_API_KEY:
                  "test-gemini-key",
              }),
          );

        const loadProductionRules =
          vi.fn(
            async () =>
              Object.freeze({
                schemaVersion:
                  "1.0" as const,

                brand:
                  Object.freeze({
                    brandName:
                      "Busybookie",

                    showName:
                      "Ollie, Kacey & Mont",

                    setting:
                      "Littleleaf Valley",

                    tagline:
                      "Little stories. Big imaginations.",
                  }),

                postProduction:
                  Object.freeze({
                    aspectRatio:
                      "16:9" as const,

                    width:
                      1920,

                    height:
                      1080,

                    timelineFps:
                      25,

                    audioSampleRateHz:
                      48_000,
                  }),

                storage:
                  Object.freeze({
                    mediaRootEnvVar:
                      "BUSYBOOKIE_MEDIA_ROOT" as const,

                    requireExternalMediaRoot:
                      true,
                  }),

                approvals:
                  Object.freeze({
                    requireScriptApproval:
                      true,

                    requireStoryboardApproval:
                      true,

                    requireReferenceApproval:
                      true,

                    requireRoughCutApproval:
                      true,

                    requireFinalQcApproval:
                      true,
                  }),

                generation:
                  Object.freeze({
                    allowUnapprovedGeneration:
                      false,

                    maxAutomaticRetries:
                      2,

                    supportedProviders: [
                      "RUNWAY" as const,
                      "VEO" as const,
                      "MANUAL" as const,
                    ],
                  }),
              }),
          );

        const resolveMediaRoot =
          vi.fn(
            () =>
              mediaRoot,
          );

        const inspectLifecycle =
          vi.fn(
            async () =>
              lifecycle,
          );

        const loadVeoPolicy =
          vi.fn(
            async () =>
              Object.freeze({
                schemaVersion:
                  "1.0" as const,

                pricingReviewedOn:
                  "2026-09-22",

                generation:
                  Object.freeze({
                    model:
                      "veo-3.1-fast-generate-preview" as const,

                    centsPerSecond:
                      10,

                    maxCentsPerGeneration:
                      80,

                    allowedDurationsSeconds: [
                      4 as const,
                      6 as const,
                      8 as const,
                    ],

                    aspectRatio:
                      "16:9" as const,

                    resolution:
                      "720p" as const,

                    numberOfVideos:
                      1 as const,

                    nativeAudioExpected:
                      true as const,

                    expectedOutputFps:
                      24 as const,

                    maxImageBytes:
                      10_000_000,
                  }),

                operation:
                  Object.freeze({
                    pollIntervalMs:
                      10_000,

                    timeoutMs:
                      900_000,
                  }),
              }),
          );

        const createVeoOperationLookupClient =
          vi.fn(
            createVeoOperationLookupClientProduction,
          );

        const generatedVideo =
          Object.freeze({
            video:
              Object.freeze({
                uri:
                  "https://example.test/reconciled-veo-01.mp4",

                mimeType:
                  "video/mp4",
              }),
          });

        const providerExecution:
          VeoExecutionResult =
          Object.freeze({
            operationName,

            generatedVideos:
              Object.freeze([
                generatedVideo,
              ]),

            raiMediaFilteredCount:
              0,

            raiMediaFilteredReasons:
              Object.freeze([]),
          });

        const resumeVeo =
          vi.fn<
            typeof resumeVeoOperation
          >(
            async (
              client,
              input,
            ) => {
              expect(
                Object.keys(
                  client,
                ),
              ).toEqual([
                "operations",
              ]);

              expect(
                Object.keys(
                  client.operations,
                ),
              ).toEqual([
                "getVideosOperation",
              ]);

              expect(
                "models" in
                  client,
              ).toBe(
                false,
              );

              expect(
                input,
              ).toEqual({
                operationName,

                pollIntervalMs:
                  10_000,

                timeoutMs:
                  900_000,
              });

              return providerExecution;
            },
          );

        const generationRecord =
          buildVeoGenerationRecord({
            recordedAt:
              "2026-09-27T20:30:00.000Z",

            episodeId:
              "EP91",

            shotId:
              "S04",

            operationName,

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
                "Busybookie Veo lifecycle reconciliation recovery test.",

              sourceImagePath:
                "D:/Busybookie/Production/references/EP91/S04/reference.png",

              imageMimeType:
                "image/png",
            },

            costPolicy: {
              pricingReviewedOn:
                "2026-09-27",

              centsPerSecond:
                10,

              locallyExpectedCents:
                40,
            },

            safety: {
              raiMediaFilteredCount:
                0,

              raiMediaFilteredReasons:
                [],
            },

            outputs: [
              {
                outputIndex:
                  1,

                destinationPath:
                  "D:/Busybookie/Production/generated-video/EP91/S04/EP91_S04_durable-veo-123_01.mp4",

                bytes:
                  321,

                sha256:
                  "c".repeat(
                    64,
                  ),

                contentType:
                  "video/mp4",
              },
            ],
          });

        const generationRecordPath =
          "D:/Busybookie/Production/generated-video/EP91/S04/EP91_S04_durable-veo-123.veo-generation.json";

        const completion =
          Object.freeze({
            schemaVersion:
              "1.0" as const,

            completedAt:
              "2026-09-27T20:31:00.000Z",

            status:
              "COMPLETED" as const,

            reservationId:
              "44444444-4444-4444-8444-444444444444",

            episodeId:
              "EP91",

            shotId:
              "S04",

            provider:
              "VEO" as const,

            providerExecutionId:
              operationName,

            generationRecordPath,
          });

        const reconciliationResult =
          Object.freeze({
            lifecycleState:
              "COMPLETED" as const,

            reconciliationMode:
              "RECOVERED_SUBMISSION" as const,

            provider:
              "VEO" as const,

            providerExecutionId:
              operationName,

            providerExecution,

            generationRecord,

            generationRecordPath,

            completion,

            completionPath:
              "D:/Busybookie/Production/generated-video/EP91/S04/EP91_S04.execution-completion.json",
          }) satisfies
            ExecutionLifecycleReconciliationResult;

        const reconcileLifecycle =
          vi.fn(
            async (
              input,
              dependencies,
            ) => {
              expect(
                input,
              ).toEqual({
                mediaRoot,
                episodeId:
                  "EP91",
                shotId:
                  "S04",
                veoPollIntervalMs:
                  10_000,
                veoTimeoutMs:
                  900_000,
              });

              const cachedLifecycle =
                await dependencies
                  .inspectLifecycle(
                    mediaRoot,
                    "EP91",
                    "S04",
                  );

              expect(
                cachedLifecycle,
              ).toBe(
                lifecycle,
              );

              expect(
                dependencies
                  .resumeVeoOperation,
              ).toBeTypeOf(
                "function",
              );

              await dependencies
                .resumeVeoOperation?.({
                  operationName,

                  pollIntervalMs:
                    10_000,

                  timeoutMs:
                    900_000,
                });

              return reconciliationResult;
            },
          );

        const loadRunwayPolicy =
          vi.fn(
            async () => {
              throw new Error(
                "Runway policy must not be loaded for Veo recovery.",
              );
            },
          );

        const createRunwayTaskLookupClient =
          vi.fn(
            () => {
              throw new Error(
                "Runway client must not be constructed for Veo recovery.",
              );
            },
          );

        await runExecutionReconcileCli(
          [
            "--episode",
            "EP91",
            "--shot",
            "S04",
          ],
          {
            loadEnvironment,
            loadProductionRules,
            resolveMediaRoot,
            inspectLifecycle,
            reconcileLifecycle,
            loadRunwayPolicy,
            createRunwayTaskLookupClient,
            loadVeoPolicy,
            createVeoOperationLookupClient,
            resumeVeoOperation:
              resumeVeo,
          },
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          loadVeoPolicy,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createVeoOperationLookupClient,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createVeoOperationLookupClient,
        ).toHaveBeenCalledWith(
          "test-gemini-key",
        );

        expect(
          resumeVeo,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          reconcileLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          loadRunwayPolicy,
        ).not.toHaveBeenCalled();

        expect(
          createRunwayTaskLookupClient,
        ).not.toHaveBeenCalled();

        expect(
          inspectLifecycle
            .mock
            .invocationCallOrder[0],
        ).toBeLessThan(
          loadVeoPolicy
            .mock
            .invocationCallOrder[0]!,
        );

        expect(
          inspectLifecycle
            .mock
            .invocationCallOrder[0],
        ).toBeLessThan(
          createVeoOperationLookupClient
            .mock
            .invocationCallOrder[0]!,
        );
      },
    );
  },
);
