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
  createRunwayTaskLookupClient as createRunwayTaskLookupClientProduction,
} from "../src/runway/execution/createRunwayTaskLookupClient.js";

import {
  resumeRunwayGen45Task,
} from "../src/runway/execution/resumeRunwayGen45Task.js";

import {
  runExecutionReconcileCli,
} from "../src/execution/cli/runExecutionReconcileCli.js";

describe(
  "Busybookie execution reconciliation CLI submitted Runway lifecycle",
  () => {
    it(
      "routes durable SUBMITTED Runway execution through lookup-only same-task recovery",
      async () => {
        const mediaRoot =
          "D:/Busybookie/Production";

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
                  "1.2",

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

                recoveryMetadata:
                  Object.freeze({
                    request:
                      Object.freeze({
                        durationSeconds:
                          5,

                        ratio:
                          "1280:720",

                        outputFormat:
                          "mp4",

                        promptText:
                          "Busybookie Runway reconciliation recovery test.",

                        sourceImagePath:
                          "D:/Busybookie/Production/references/EP91/S01/reference.png",

                        assetStrategy:
                          "DATA_URI",
                      }),

                    locallyExpectedCredits:
                      60,
                  }),
              }),
          });

        const loadEnvironment =
          vi.fn(
            () =>
              Object.freeze({
                BUSYBOOKIE_MEDIA_ROOT:
                  mediaRoot,

                RUNWAYML_API_SECRET:
                  "test-runway-secret",
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

        const loadRunwayPolicy =
          vi.fn(
            async () =>
              Object.freeze({
                schemaVersion:
                  "1.0" as const,

                pricingReviewedOn:
                  "2026-09-22",

                gen45:
                  Object.freeze({
                    creditsPerSecond:
                      12,

                    maxCreditsPerGeneration:
                      60,

                    maxDurationSeconds:
                      5,
                  }),

                task:
                  Object.freeze({
                    waitTimeoutMs:
                      600_000,
                  }),
              }),
          );

        const createRunwayTaskLookupClient =
          vi.fn(
            createRunwayTaskLookupClientProduction,
          );

        const providerExecution =
          Object.freeze({
            taskId:
              "task-durable-123",

            estimatedCredits:
              60,

            finalCredits:
              55,

            outputUrls:
              Object.freeze([
                "https://example.test/reconciled-runway-01.mp4",
              ]),
          });

        const resumeRunwayTask =
          vi.fn<
            typeof resumeRunwayGen45Task
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
                "tasks",
              ]);

              expect(
                Object.keys(
                  client.tasks,
                ),
              ).toEqual([
                "retrieve",
              ]);

              expect(
                "imageToVideo" in
                  client,
              ).toBe(
                false,
              );

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

              return providerExecution;
            },
          );

        const generationRecord =
          Object.freeze({
            schemaVersion:
              "1.0" as const,

            recordedAt:
              "2026-09-25T20:30:00.000Z",

            provider:
              "RUNWAY" as const,

            model:
              "gen4.5" as const,

            status:
              "SUCCEEDED" as const,

            episodeId:
              "EP91",

            shotId:
              "S01",

            taskId:
              "task-durable-123",

            request:
              Object.freeze({
                durationSeconds:
                  5,

                ratio:
                  "1280:720" as const,

                outputFormat:
                  "mp4" as const,

                promptText:
                  "Busybookie Runway reconciliation recovery test.",

                sourceImagePath:
                  "D:/Busybookie/Production/references/EP91/S01/reference.png",

                assetStrategy:
                  "DATA_URI" as const,
              }),

            credits:
              Object.freeze({
                locallyExpected:
                  60,

                providerEstimated:
                  60,

                providerFinal:
                  55,
              }),

            outputs: [
              Object.freeze({
                outputIndex:
                  1,

                destinationPath:
                  "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_task-durable-123_01.mp4",

                bytes:
                  123,

                sha256:
                  "a".repeat(
                    64,
                  ),

                contentType:
                  "video/mp4",
              }),
            ],
          });

        const completion =
          Object.freeze({
            schemaVersion:
              "1.0" as const,

            completedAt:
              "2026-09-25T20:31:00.000Z",

            status:
              "COMPLETED" as const,

            reservationId:
              "11111111-1111-4111-8111-111111111111",

            episodeId:
              "EP91",

            shotId:
              "S01",

            provider:
              "RUNWAY" as const,

            providerExecutionId:
              "task-durable-123",

            generationRecordPath:
              "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_task-durable-123.runway-generation.json",
          });

        const reconciliationResult =
          Object.freeze({
            lifecycleState:
              "COMPLETED" as const,

            reconciliationMode:
              "RECOVERED_SUBMISSION" as const,

            provider:
              "RUNWAY" as const,

            providerExecutionId:
              "task-durable-123",

            providerExecution,

            generationRecord,

            generationRecordPath:
              completion
                .generationRecordPath,

            completion,

            completionPath:
              "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01.execution-completion.json",
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
                  "S01",
                runwayWaitTimeoutMs:
                  600_000,
              });

              const cachedLifecycle =
                await dependencies
                  .inspectLifecycle(
                    mediaRoot,
                    "EP91",
                    "S01",
                  );

              expect(
                cachedLifecycle,
              ).toBe(
                lifecycle,
              );

              expect(
                dependencies
                  .resumeRunwayTask,
              ).toBeTypeOf(
                "function",
              );

              await dependencies
                .resumeRunwayTask?.({
                  taskId:
                    "task-durable-123",

                  providerEstimatedCredits:
                    60,

                  waitTimeoutMs:
                    600_000,
                });

              return reconciliationResult;
            },
          );

        await runExecutionReconcileCli(
          [
            "--episode",
            "EP91",
            "--shot",
            "S01",
          ],
          {
            loadEnvironment,
            loadProductionRules,
            resolveMediaRoot,
            inspectLifecycle,
            reconcileLifecycle,
            loadRunwayPolicy,
            createRunwayTaskLookupClient,
            resumeRunwayTask,
          },
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectLifecycle,
        ).toHaveBeenCalledWith(
          mediaRoot,
          "EP91",
          "S01",
        );

        expect(
          loadRunwayPolicy,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createRunwayTaskLookupClient,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createRunwayTaskLookupClient,
        ).toHaveBeenCalledWith({
          RUNWAYML_API_SECRET:
            "test-runway-secret",
        });

        expect(
          resumeRunwayTask,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          reconcileLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectLifecycle
            .mock
            .invocationCallOrder[0],
        ).toBeLessThan(
          loadRunwayPolicy
            .mock
            .invocationCallOrder[0]!,
        );

        expect(
          inspectLifecycle
            .mock
            .invocationCallOrder[0],
        ).toBeLessThan(
          createRunwayTaskLookupClient
            .mock
            .invocationCallOrder[0]!,
        );
      },
    );
  },
);
