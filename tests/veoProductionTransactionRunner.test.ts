import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createVeoSingleShotProductionTransactionRunner,
  type VeoSingleShotProductionTransactionRunnerDependencies,
} from "../src/execution/providers/createVeoSingleShotProductionTransactionRunner.js";

describe(
  "Busybookie Veo production transaction runner",
  () => {
    it(
      "forwards the orchestrator submission-acceptance handler into the low-level Veo executor",
      async () => {
        const client =
          Object.freeze({
            marker:
              "mock-veo-client",
          }) as unknown as Parameters<
            typeof createVeoSingleShotProductionTransactionRunner
          >[0];

        const onSubmissionAccepted =
          vi.fn(
            async (
              providerExecutionId:
                string,
            ) => {
              expect(
                providerExecutionId,
              ).toBe(
                "operations/veo-production-1",
              );
            },
          );

        const executeGeneration =
          vi.fn<
            VeoSingleShotProductionTransactionRunnerDependencies[
              "executeGeneration"
            ]
          >(
            async (
              receivedClient,
              _request,
              options,
            ) => {
              expect(
                receivedClient,
              ).toBe(
                client,
              );

              expect(
                options
                  .onSubmissionAccepted,
              ).toBe(
                onSubmissionAccepted,
              );

              await options
                .onSubmissionAccepted(
                  "operations/veo-production-1",
                );

              return {
                operationName:
                  "operations/veo-production-1",

                generatedVideos: [
                  {
                    video: {
                      videoBytes:
                        "bW9jaw==",
                    },
                  },
                ],

                raiMediaFilteredCount:
                  0,

                raiMediaFilteredReasons:
                  [],
              };
            },
          );

        const runTransaction =
          vi.fn<
            VeoSingleShotProductionTransactionRunnerDependencies[
              "runTransaction"
            ]
          >(
            async (
              _input,
              transactionDependencies,
            ) => {
              const request:
                Parameters<
                  typeof transactionDependencies.executeGeneration
                >[0] = {
                  model:
                    "veo-3.1-fast-generate-preview",

                  source: {
                    prompt:
                      "Mock Veo prompt.",
                  },

                  config: {
                    numberOfVideos:
                      1,

                    durationSeconds:
                      4,

                    aspectRatio:
                      "16:9",

                    resolution:
                      "720p",
                  },
                };

              const execution =
                await transactionDependencies
                  .executeGeneration(
                    request,
                    {
                      pollIntervalMs:
                        1_000,

                      timeoutMs:
                        30_000,
                    },
                  );

              return {
                record: {
                  operationName:
                    execution
                      .operationName,
                },

                recordPath:
                  "D:/Busybookie/Production/generated-video/EP91/S01/mock.veo-generation.json",
              } as Awaited<
                ReturnType<
                  VeoSingleShotProductionTransactionRunnerDependencies[
                    "runTransaction"
                  ]
                >
              >;
            },
          );

        const dependencies = {
          runTransaction,

          prepareImageAsset:
            vi.fn(),

          executeGeneration,

          persistGeneratedVideo:
            vi.fn(),

          writeGenerationRecord:
            vi.fn(),
        } satisfies
          VeoSingleShotProductionTransactionRunnerDependencies;

        const runner =
          createVeoSingleShotProductionTransactionRunner(
            client,
            dependencies,
          );

        const transactionInput =
          {} as Parameters<
            typeof runner
          >[0];

        const result =
          await runner(
            transactionInput,
            onSubmissionAccepted,
          );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          executeGeneration,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result.record
            .operationName,
        ).toBe(
          "operations/veo-production-1",
        );
      },
    );
  },
);
