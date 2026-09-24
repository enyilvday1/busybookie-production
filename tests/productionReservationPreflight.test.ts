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

function makeLifecycleMocks(
  events: string[],
) {
  const createReservation =
    vi.fn<
      ProductionSingleShotExecutionCompositionDependencies[
        "createReservation"
      ]
    >(
      async () => {
        events.push(
          "reservation",
        );

        throw new Error(
          "Durable reservation must not run before provider configuration succeeds.",
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
          "Unexpected submission creation.",
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
  "Busybookie production reservation preflight",
  () => {
    it(
      "prepares Runway before creating a durable Runway reservation",
      async () => {
        const events:
          string[] = [];

        const lifecycle =
          makeLifecycleMocks(
            events,
          );

        const prepareRunwayExecutor =
          vi.fn<
            ProductionSingleShotExecutionCompositionDependencies[
              "prepareRunwayExecutor"
            ]
          >(
            async () => {
              events.push(
                "runway-preflight",
              );

              throw new Error(
                "Mock Runway configuration failure.",
              );
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
                "Veo must remain untouched.",
              );
            },
          );

        const dependencies = {
          ...lifecycle,
          prepareRunwayExecutor,
          prepareVeoExecutor,
        } satisfies
          ProductionSingleShotExecutionCompositionDependencies;

        const production =
          createProductionSingleShotExecutionDependencies(
            {},
            dependencies,
          );

        await expect(
          production
            .createReservation(
              "D:/Busybookie/Production",
              {
                episodeId:
                  "EP90",

                shotId:
                  "S01",

                provider:
                  "RUNWAY",
              },
            ),
        ).rejects.toThrow(
          /Mock Runway configuration failure/i,
        );

        expect(
          events,
        ).toEqual([
          "runway-preflight",
        ]);

        expect(
          lifecycle
            .createReservation,
        ).not.toHaveBeenCalled();

        expect(
          prepareVeoExecutor,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "prepares Veo before creating a durable Veo reservation",
      async () => {
        const events:
          string[] = [];

        const lifecycle =
          makeLifecycleMocks(
            events,
          );

        const prepareRunwayExecutor =
          vi.fn<
            ProductionSingleShotExecutionCompositionDependencies[
              "prepareRunwayExecutor"
            ]
          >(
            async () => {
              throw new Error(
                "Runway must remain untouched.",
              );
            },
          );

        const prepareVeoExecutor =
          vi.fn<
            ProductionSingleShotExecutionCompositionDependencies[
              "prepareVeoExecutor"
            ]
          >(
            async () => {
              events.push(
                "veo-preflight",
              );

              throw new Error(
                "Mock Veo configuration failure.",
              );
            },
          );

        const dependencies = {
          ...lifecycle,
          prepareRunwayExecutor,
          prepareVeoExecutor,
        } satisfies
          ProductionSingleShotExecutionCompositionDependencies;

        const production =
          createProductionSingleShotExecutionDependencies(
            {},
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
                  "VEO",
              },
            ),
        ).rejects.toThrow(
          /Mock Veo configuration failure/i,
        );

        expect(
          events,
        ).toEqual([
          "veo-preflight",
        ]);

        expect(
          lifecycle
            .createReservation,
        ).not.toHaveBeenCalled();

        expect(
          prepareRunwayExecutor,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
