import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createRunwaySingleShotProductionExecutor,
  type RunwaySingleShotProductionExecutorDependencies,
} from "../src/execution/providers/createRunwaySingleShotProductionExecutor.js";

import type {
  SingleShotProviderExecutionInput,
  SingleShotProviderExecutionResult,
} from "../src/execution/singleShotExecution.types.js";

describe(
  "Busybookie Runway production executor",
  () => {
    it(
      "lazily composes the Runway adapter without requiring another provider",
      async () => {
        const source =
          Object.freeze({
            RUNWAYML_API_SECRET:
              "test-runway-secret",
          });

        const input =
          Object.freeze({
            marker:
              "mock-provider-input",
          }) as unknown as
            SingleShotProviderExecutionInput;

        const expectedResult =
          Object.freeze({
            providerExecutionId:
              "runway-production-task-1",

            recordPath:
              "D:/Busybookie/Production/generated-video/EP90/S01/mock.runway-generation.json",
          }) satisfies
            SingleShotProviderExecutionResult;

        const policy =
          Object.freeze({
            marker:
              "mock-runway-policy",
          }) as unknown as Awaited<
            ReturnType<
              RunwaySingleShotProductionExecutorDependencies[
                "loadPolicy"
              ]
            >
          >;

        const client =
          Object.freeze({
            marker:
              "mock-runway-client",
          }) as unknown as ReturnType<
            RunwaySingleShotProductionExecutorDependencies[
              "createClient"
            ]
          >;

        const runTransaction =
          vi.fn() as unknown as ReturnType<
            RunwaySingleShotProductionExecutorDependencies[
              "createTransactionRunner"
            ]
          >;

        const loadPolicy =
          vi.fn<
            RunwaySingleShotProductionExecutorDependencies[
              "loadPolicy"
            ]
          >(
            async () =>
              policy,
          );

        const createClient =
          vi.fn<
            RunwaySingleShotProductionExecutorDependencies[
              "createClient"
            ]
          >(
            (
              receivedSource,
            ) => {
              expect(
                receivedSource,
              ).toBe(
                source,
              );

              return client;
            },
          );

        const createTransactionRunner =
          vi.fn<
            RunwaySingleShotProductionExecutorDependencies[
              "createTransactionRunner"
            ]
          >(
            (
              receivedClient,
            ) => {
              expect(
                receivedClient,
              ).toBe(
                client,
              );

              return runTransaction;
            },
          );

        const buildPrompt =
          vi.fn<
            RunwaySingleShotProductionExecutorDependencies[
              "buildPrompt"
            ]
          >(
            () =>
              "Mock Runway prompt.",
          );

        const executeAdapter =
          vi.fn<
            RunwaySingleShotProductionExecutorDependencies[
              "executeAdapter"
            ]
          >(
            async (
              receivedInput,
              adapterDependencies,
            ) => {
              expect(
                receivedInput,
              ).toBe(
                input,
              );

              expect(
                adapterDependencies
                  .policy,
              ).toBe(
                policy,
              );

              expect(
                adapterDependencies
                  .buildPrompt,
              ).toBe(
                buildPrompt,
              );

              expect(
                adapterDependencies
                  .runTransaction,
              ).toBe(
                runTransaction,
              );

              return expectedResult;
            },
          );

        const dependencies = {
          loadPolicy,
          createClient,
          createTransactionRunner,
          buildPrompt,
          executeAdapter,
        } satisfies
          RunwaySingleShotProductionExecutorDependencies;

        const executor =
          createRunwaySingleShotProductionExecutor(
            source,
            dependencies,
          );

        expect(
          loadPolicy,
        ).not.toHaveBeenCalled();

        expect(
          createClient,
        ).not.toHaveBeenCalled();

        expect(
          createTransactionRunner,
        ).not.toHaveBeenCalled();

        expect(
          executeAdapter,
        ).not.toHaveBeenCalled();

        const result =
          await executor(
            input,
          );

        expect(
          loadPolicy,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createClient,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          createTransactionRunner,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          executeAdapter,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result,
        ).toBe(
          expectedResult,
        );
      },
    );
  },
);
