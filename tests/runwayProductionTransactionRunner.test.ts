import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createRunwaySingleShotProductionTransactionRunner,
  type RunwaySingleShotProductionTransactionRunnerDependencies,
} from "../src/execution/providers/createRunwaySingleShotProductionTransactionRunner.js";

describe(
  "Busybookie Runway production transaction runner",
  () => {
    it(
      "translates low-level Runway submission acceptance into the generic provider acceptance contract",
      async () => {
        const client =
          Object.freeze({
            marker:
              "mock-runway-client",
          }) as unknown as Parameters<
            typeof createRunwaySingleShotProductionTransactionRunner
          >[0];

        const onSubmissionAccepted =
          vi.fn(
            async (
              _acceptance:
                unknown,
            ) =>
              undefined,
          );

        const executeGeneration =
          vi.fn<
            RunwaySingleShotProductionTransactionRunnerDependencies[
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

              await options
                .onSubmissionAccepted(
                  {
                    taskId:
                      "runway-production-task-1",

                    providerEstimatedCredits:
                      1,
                  },
                );

              return {
                taskId:
                  "runway-production-task-1",

                estimatedCredits:
                  1,

                finalCredits:
                  1,

                outputUrls: [
                  "https://example.com/mock.mp4",
                ],
              };
            },
          );

        const runTransaction =
          vi.fn<
            RunwaySingleShotProductionTransactionRunnerDependencies[
              "runTransaction"
            ]
          >(
            async (
              _input,
              transactionDependencies,
            ) => {
              const request =
                {} as Parameters<
                  typeof transactionDependencies.executeGeneration
                >[0];

              const execution =
                await transactionDependencies
                  .executeGeneration(
                    request,
                    30_000,
                  );

              return {
                record: {
                  taskId:
                    execution.taskId,
                },

                recordPath:
                  "D:/Busybookie/Production/generated-video/EP90/S01/mock.runway-generation.json",
              } as Awaited<
                ReturnType<
                  RunwaySingleShotProductionTransactionRunnerDependencies[
                    "runTransaction"
                  ]
                >
              >;
            },
          );

        const dependencies = {
          runTransaction,

          resolveImageAsset:
            vi.fn(),

          uploadEphemeralAsset:
            vi.fn(),

          executeGeneration,

          downloadOutput:
            vi.fn(),

          writeGenerationRecord:
            vi.fn(),
        } satisfies
          RunwaySingleShotProductionTransactionRunnerDependencies;

        const runner =
          createRunwaySingleShotProductionTransactionRunner(
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
          onSubmissionAccepted,
        ).toHaveBeenCalledWith({
          provider:
            "RUNWAY",

          providerExecutionId:
            "runway-production-task-1",

          providerEstimatedCredits:
            1,
        });

        expect(
          executeGeneration,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result.record.taskId,
        ).toBe(
          "runway-production-task-1",
        );
      },
    );
  },
);
