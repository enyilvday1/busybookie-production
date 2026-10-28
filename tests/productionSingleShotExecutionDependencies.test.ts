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

  const verifyVisualReference =
    vi.fn<
      NonNullable<
        ProductionSingleShotExecutionCompositionDependencies[
          "verifyVisualReference"
        ]
      >
    >(
      async () => {
        throw new Error(
          "Visual-reference verification must not run during production dependency composition tests.",
        );
      },
    );

  return {
    verifyVisualReference,
    createReservation,
    createSubmission,
    createCompletion,
  };
}

describe(
  "Busybookie production single-shot execution dependencies",
  () => {
    it(
      "exposes a visual-reference verifier in default production composition without touching providers or media",
      () => {
        const productionDependencies =
          createProductionSingleShotExecutionDependencies(
            {},
          );

        expect(
          productionDependencies
            .verifyVisualReference,
        ).toBeTypeOf(
          "function",
        );
      },
    );

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
          productionDependencies
            .verifyVisualReference,
        ).toBe(
          lifecycle
            .verifyVisualReference,
        );

        expect(
          lifecycle
            .verifyVisualReference,
        ).not.toHaveBeenCalled();

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

    // B5C-X1: one narrow Google capability (the existing orchestrator), composed lazily.
    it(
      "exposes only the lazy Google orchestrator capability and reads the Gemini credential only inside prepareSubmission",
      async () => {
        const lifecycle =
          makeLifecycleCreatorMocks();

        const trip = (name: string) =>
          vi.fn(() => {
            throw new Error(`${name} must not run during composition.`);
          });

        const prepareRunwayExecutor = trip("prepareRunwayExecutor");
        const prepareVeoExecutor = trip("prepareVeoExecutor");
        const loadGooglePolicies = vi.fn(async () => ({}) as never);
        const createInteraction = vi.fn();
        const prepareGoogleInteraction = vi.fn(() => ({ createInteraction, submittedRecovery: {} }) as never);
        const submitGoogle = vi.fn(async () => ({ lifecycleState: "SUBMITTED" }) as never);

        const compose = (credentials: { GEMINI_API_KEY?: string }) =>
          createProductionSingleShotExecutionDependencies(
            credentials,
            {
              ...lifecycle,
              prepareRunwayExecutor: prepareRunwayExecutor as never,
              prepareVeoExecutor: prepareVeoExecutor as never,
              loadGooglePolicies,
              prepareGoogleInteraction,
              submitGoogle,
            },
          );

        const productionDependencies =
          compose({ GEMINI_API_KEY: "gemini-x1-key" });

        expect(
          Object.keys(productionDependencies).sort(),
        ).toEqual([
          "createCompletion",
          "createReservation",
          "createSubmission",
          "executeGoogleSubmission",
          "executeRunway",
          "executeVeo",
          "readDialogueVisualAuthorization",
          "verifyVisualReference",
        ]);

        for (const spy of [prepareRunwayExecutor, prepareVeoExecutor, loadGooglePolicies, prepareGoogleInteraction, submitGoogle]) {
          expect(spy).not.toHaveBeenCalled();
        }

        const request = { marker: "x1-request" } as never;

        await productionDependencies.executeGoogleSubmission!(request);

        expect(submitGoogle).toHaveBeenCalledTimes(1);

        const [forwarded, orchestration] =
          submitGoogle.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];

        expect(forwarded).toEqual({ marker: "x1-request", resolution: "720p" });

        expect(Object.keys(orchestration).sort()).toEqual([
          "createReservation",
          "createSubmission",
          "inspectLifecycle",
          "loadPolicies",
          "prepareSubmission",
          "verifyVisualReference",
        ]);

        expect(orchestration.loadPolicies).toBe(loadGooglePolicies);
        expect(orchestration.createReservation).toBe(lifecycle.createReservation);
        expect(orchestration.createSubmission).toBe(lifecycle.createSubmission);
        expect(orchestration.verifyVisualReference).toBe(lifecycle.verifyVisualReference);
        expect(prepareGoogleInteraction).not.toHaveBeenCalled();

        const prepared = (orchestration.prepareSubmission as () => Record<string, unknown>)();

        expect(prepareGoogleInteraction).toHaveBeenCalledExactlyOnceWith("gemini-x1-key");
        expect(Object.keys(prepared)).toEqual(["createInteraction"]);
        expect(prepared.createInteraction).toBe(createInteraction);

        // No credential: refusal at prepareSubmission (orchestrator step 14), never at composition.
        const keyless = compose({});

        await keyless.executeGoogleSubmission!(request);

        const [, keylessOrchestration] =
          submitGoogle.mock.calls[1] as unknown as [unknown, Record<string, unknown>];

        expect(() => (keylessOrchestration.prepareSubmission as () => unknown)()).toThrow("GEMINI_API_KEY is not configured.");
        expect(prepareGoogleInteraction).toHaveBeenCalledTimes(1);
        expect(prepareRunwayExecutor).not.toHaveBeenCalled();
        expect(prepareVeoExecutor).not.toHaveBeenCalled();
      },
    );
  },
);
