import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach } from "vitest";
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
  runExecutionReconcileCli,
} from "../src/execution/cli/runExecutionReconcileCli.js";

const temporaryGuardRoots: string[] = [];
afterEach(async () => { for (const root of temporaryGuardRoots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe(
  "Busybookie execution reconciliation CLI completed lifecycle",
  () => {
    it(
      "verifies durable COMPLETED evidence without provider policy, credentials, or provider-client construction",
      async () => {
        const mediaRoot = await mkdtemp(join(process.cwd(), ".b7-reconcile-cli-"));
        temporaryGuardRoots.push(mediaRoot);

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
                  "11111111-1111-4111-8111-111111111111",

                reservedAt:
                  "2026-09-28T12:00:00.000Z",

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
                  "2026-09-28T12:01:00.000Z",

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
                          "Busybookie durable completed reconciliation test.",

                        sourceImagePath:
                          "D:/Busybookie/Production/references/EP91/S01/reference.png",

                        assetStrategy:
                          "DATA_URI",
                      }),

                    locallyExpectedCredits:
                      60,
                  }),
              }),

            completion:
              Object.freeze({
                schemaVersion:
                  "1.0",

                completedAt:
                  "2026-09-28T12:10:00.000Z",

                status:
                  "COMPLETED",

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

                generationRecordPath:
                  "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_task-durable-123.runway-generation.json",
              }),
          });

        const loadEnvironment =
          vi.fn(
            () =>
              Object.freeze({
                BUSYBOOKIE_MEDIA_ROOT:
                  mediaRoot,
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
                      48000,
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

        const generationRecord =
          Object.freeze({
            schemaVersion:
              "1.0" as const,

            recordedAt:
              "2026-09-28T12:09:00.000Z",

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
                  "Busybookie durable completed reconciliation test.",

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

        const reconciliationResult =
          Object.freeze({
            lifecycleState:
              "COMPLETED" as const,

            reconciliationMode:
              "DURABLE_COMPLETION" as const,

            provider:
              "RUNWAY" as const,

            providerExecutionId:
              "task-durable-123",

            generationRecord,

            generationRecordPath:
              "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_task-durable-123.runway-generation.json",

            completion:
              lifecycle.completion,

            completionPath:
              "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01.execution-completion.json",
          }) satisfies
            ExecutionLifecycleReconciliationResult;

        const reconcileLifecycle =
          vi.fn(
            async () =>
              reconciliationResult,
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
          },
        );

        expect(
          loadEnvironment,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          loadProductionRules,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          resolveMediaRoot,
        ).toHaveBeenCalledTimes(
          1,
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
          reconcileLifecycle,
        ).toHaveBeenCalledTimes(
          1,
        );

      },
    );
  },
);
