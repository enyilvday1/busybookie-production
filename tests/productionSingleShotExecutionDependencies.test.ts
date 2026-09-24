import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createProductionSingleShotExecutionDependencies,
  type ProductionSingleShotExecutionCompositionDependencies,
} from "../src/execution/createProductionSingleShotExecutionDependencies.js";

import type {
  SingleShotProviderExecutionInput,
  SingleShotProviderExecutionResult,
} from "../src/execution/singleShotExecution.types.js";

function makeProviderInput():
SingleShotProviderExecutionInput {
  return Object.freeze({
    marker:
      "mock-provider-input",
  }) as unknown as
    SingleShotProviderExecutionInput;
}

function makeProviderResult(
  providerExecutionId:
    string,
): SingleShotProviderExecutionResult {
  return Object.freeze({
    providerExecutionId,

    recordPath:
      "D:/Busybookie/Production/generated-video/mock-generation.json",
  });
}

function makeLifecycleCreatorMocks() {
  const createReservation =
    vi.fn<
      ProductionSingleShotExecutionCompositionDependencies[
        "createReservation"
      ]
    >(
      async () => {
        throw new Error(
          "Reservation creator must not run during composition.",
        );
      },
    );

  const createSubmission =
    vi.fn<
      ProductionSingleShotExecutionCompositionDependencies[
        "createSubmission"
      ]
    >(
      async () => {
        throw new Error(
          "Submission creator must not run during composition.",
        );
      },
    );

  const createCompletion =
    vi.fn<
      ProductionSingleShotExecutionCompositionDependencies[
        "createCompletion"
      ]
    >(
      async () => {
        throw new Error(
          "Completion creator must not run during composition.",
        );
      },
    );

  return {
    createReservation,
    createSubmission,
    createCompletion,
  };
}

describe(
  "Busybookie production single-shot execution dependencies",
  () => {
    it(
      "keeps Veo untouched when only the Runway executor is selected",
      async () => {
        const lifecycle =
          makeLifecycleCreatorMocks();

        const input =
          makeProviderInput();

        const expectedResult =
          makeProviderResult(
            "runway-production-task-1",
          );

        const runwayExecutor =
          vi.fn(
            async (
              receivedInput:
                SingleShotProviderExecutionInput,
            ) => {
              expect(
                receivedInput,
              ).toBe(
                input,
              );

              return expectedResult;
            },
          );

        const prepareRunwayExecutor =
          vi.fn<
            ProductionSingleShotExecutionCompositionDependencies[
              "prepareRunwayExecutor"
            ]
          >(
            async (
              credentialSource,
            ) => {
              expect(
                credentialSource,
              ).toEqual({
                RUNWAYML_API_SECRET:
                  "runway-only-secret",
              });

              return runwayExecutor;
            },
          );

        const prepareVeoExecutor =
          vi.fn<
            ProductionSingleShotExecutionCompositionDependencies[
              "prepareVeoExecutor"
            ]
          >(
            async () => {
              throw new Error(
                "Veo composition must remain untouched during Runway execution.",
              );
            },
          );

        const dependencies = {
          ...lifecycle,
          prepareRunwayExecutor,
          prepareVeoExecutor,
        } satisfies
          ProductionSingleShotExecutionCompositionDependencies;

        const productionDependencies =
          createProductionSingleShotExecutionDependencies(
            {
              RUNWAYML_API_SECRET:
                "runway-only-secret",
            },
            dependencies,
          );

        expect(
          prepareRunwayExecutor,
        ).not.toHaveBeenCalled();

        expect(
          prepareVeoExecutor,
        ).not.toHaveBeenCalled();

        expect(
          productionDependencies
            .createReservation,
        ).not.toBe(
          lifecycle
            .createReservation,
        );

        expect(
          lifecycle
            .createReservation,
        ).not.toHaveBeenCalled();

        expect(
          productionDependencies
            .createSubmission,
        ).toBe(
          lifecycle
            .createSubmission,
        );

        expect(
          productionDependencies
            .createCompletion,
        ).toBe(
          lifecycle
            .createCompletion,
        );

        const result =
          await productionDependencies
            .executeRunway(
              input,
            );

        expect(
          prepareRunwayExecutor,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          prepareVeoExecutor,
        ).not.toHaveBeenCalled();

        expect(
          runwayExecutor,
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

    it(
      "keeps Runway untouched when only the Veo executor is selected",
      async () => {
        const lifecycle =
          makeLifecycleCreatorMocks();

        const input =
          makeProviderInput();

        const expectedResult =
          makeProviderResult(
            "operations/veo-production-1",
          );

        const veoExecutor =
          vi.fn(
            async (
              receivedInput:
                SingleShotProviderExecutionInput,
            ) => {
              expect(
                receivedInput,
              ).toBe(
                input,
              );

              return expectedResult;
            },
          );

        const prepareRunwayExecutor =
          vi.fn<
            ProductionSingleShotExecutionCompositionDependencies[
              "prepareRunwayExecutor"
            ]
          >(
            async () => {
              throw new Error(
                "Runway composition must remain untouched during Veo execution.",
              );
            },
          );

        const prepareVeoExecutor =
          vi.fn<
            ProductionSingleShotExecutionCompositionDependencies[
              "prepareVeoExecutor"
            ]
          >(
            async (
              apiKey,
            ) => {
              expect(
                apiKey,
              ).toBe(
                "gemini-only-secret",
              );

              return veoExecutor;
            },
          );

        const dependencies = {
          ...lifecycle,
          prepareRunwayExecutor,
          prepareVeoExecutor,
        } satisfies
          ProductionSingleShotExecutionCompositionDependencies;

        const productionDependencies =
          createProductionSingleShotExecutionDependencies(
            {
              GEMINI_API_KEY:
                "gemini-only-secret",
            },
            dependencies,
          );

        expect(
          prepareRunwayExecutor,
        ).not.toHaveBeenCalled();

        expect(
          prepareVeoExecutor,
        ).not.toHaveBeenCalled();

        const result =
          await productionDependencies
            .executeVeo(
              input,
            );

        expect(
          prepareRunwayExecutor,
        ).not.toHaveBeenCalled();

        expect(
          prepareVeoExecutor,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          veoExecutor,
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
