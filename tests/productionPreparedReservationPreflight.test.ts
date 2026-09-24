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
  SingleShotProviderExecutor,
} from "../src/execution/singleShotExecution.types.js";

function makePreparedExecutor():
SingleShotProviderExecutor {
  return async () => {
    throw new Error(
      "Prepared executor must not execute during reservation preflight.",
    );
  };
}

function makeLifecycleMocks(
  events: string[],
) {
  const createReservation =
    vi.fn(
      async () => {
        events.push(
          "reservation",
        );

        throw new Error(
          "Durable reservation reached after successful provider preparation.",
        );
      },
    );

  const createSubmission =
    vi.fn(
      async () => {
        throw new Error(
          "Unexpected submission creation.",
        );
      },
    );

  const createCompletion =
    vi.fn(
      async () => {
        throw new Error(
          "Unexpected completion creation.",
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
  "Busybookie prepared production reservation preflight",
  () => {
    it(
      "awaits Runway preparation before durable reservation",
      async () => {
        const events:
          string[] = [];

        const lifecycle =
          makeLifecycleMocks(
            events,
          );

        const prepareRunwayExecutor =
          vi.fn(
            async () => {
              events.push(
                "runway-prepare-start",
              );

              await Promise.resolve();

              events.push(
                "runway-prepare-complete",
              );

              return makePreparedExecutor();
            },
          );

        const prepareVeoExecutor =
          vi.fn(
            async () => {
              throw new Error(
                "Veo preparation must remain untouched.",
              );
            },
          );

        const dependencies = {
          ...lifecycle,

          createRunwayExecutor:
            () => {
              throw new Error(
                "Legacy Runway lazy factory must not be used by reservation preflight.",
              );
            },

          createVeoExecutor:
            () => {
              throw new Error(
                "Legacy Veo lazy factory must not be used by reservation preflight.",
              );
            },

          prepareRunwayExecutor,
          prepareVeoExecutor,
        } as unknown as
          ProductionSingleShotExecutionCompositionDependencies;

        const production =
          createProductionSingleShotExecutionDependencies(
            {
              RUNWAYML_API_SECRET:
                "runway-test-secret",
            },
            dependencies,
          );

        await expect(
          production
            .createReservation(
              "D:/Busybookie/Production",
              {
                episodeId:
                  "EP91",

                shotId:
                  "S01",

                provider:
                  "RUNWAY",
              },
            ),
        ).rejects.toThrow(
          /Durable reservation reached after successful provider preparation/i,
        );

        expect(
          events,
        ).toEqual([
          "runway-prepare-start",
          "runway-prepare-complete",
          "reservation",
        ]);

        expect(
          prepareRunwayExecutor,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          prepareVeoExecutor,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "awaits Veo preparation before durable reservation",
      async () => {
        const events:
          string[] = [];

        const lifecycle =
          makeLifecycleMocks(
            events,
          );

        const prepareRunwayExecutor =
          vi.fn(
            async () => {
              throw new Error(
                "Runway preparation must remain untouched.",
              );
            },
          );

        const prepareVeoExecutor =
          vi.fn(
            async () => {
              events.push(
                "veo-prepare-start",
              );

              await Promise.resolve();

              events.push(
                "veo-prepare-complete",
              );

              return makePreparedExecutor();
            },
          );

        const dependencies = {
          ...lifecycle,

          createRunwayExecutor:
            () => {
              throw new Error(
                "Legacy Runway lazy factory must not be used by reservation preflight.",
              );
            },

          createVeoExecutor:
            () => {
              throw new Error(
                "Legacy Veo lazy factory must not be used by reservation preflight.",
              );
            },

          prepareRunwayExecutor,
          prepareVeoExecutor,
        } as unknown as
          ProductionSingleShotExecutionCompositionDependencies;

        const production =
          createProductionSingleShotExecutionDependencies(
            {
              GEMINI_API_KEY:
                "gemini-test-secret",
            },
            dependencies,
          );

        await expect(
          production
            .createReservation(
              "D:/Busybookie/Production",
              {
                episodeId:
                  "EP91",

                shotId:
                  "S02",

                provider:
                  "VEO",
              },
            ),
        ).rejects.toThrow(
          /Durable reservation reached after successful provider preparation/i,
        );

        expect(
          events,
        ).toEqual([
          "veo-prepare-start",
          "veo-prepare-complete",
          "reservation",
        ]);

        expect(
          prepareVeoExecutor,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          prepareRunwayExecutor,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
