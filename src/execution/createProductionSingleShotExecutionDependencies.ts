import {
  createExecutionCompletion,
} from "./createExecutionCompletion.js";

import {
  createExecutionReservation,
} from "./createExecutionReservation.js";

import {
  createExecutionSubmission,
} from "./createExecutionSubmission.js";

import {
  readDialogueVisualAuthorization,
} from "./readDialogueVisualAuthorization.js";

import {
  prepareRunwaySingleShotProductionExecutor,
} from "./providers/createRunwaySingleShotProductionExecutor.js";

import {
  prepareVeoSingleShotProductionExecutor,
} from "./providers/createVeoSingleShotProductionExecutor.js";

import type {
  SingleShotExecutionDependencies,
  SingleShotProviderExecutor,
} from "./singleShotExecution.types.js";

export type ProductionSingleShotExecutionCredentialSource =
  Readonly<{
    RUNWAYML_API_SECRET?:
      string;

    GEMINI_API_KEY?:
      string;
  }>;

export type ProductionSingleShotExecutionCompositionDependencies =
  Readonly<{
    readDialogueVisualAuthorization?:
      NonNullable<
        SingleShotExecutionDependencies[
          "readDialogueVisualAuthorization"
        ]
      >;

    createReservation:
      SingleShotExecutionDependencies[
        "createReservation"
      ];

    createSubmission:
      SingleShotExecutionDependencies[
        "createSubmission"
      ];

    createCompletion:
      SingleShotExecutionDependencies[
        "createCompletion"
      ];

    prepareRunwayExecutor:
      typeof prepareRunwaySingleShotProductionExecutor;

    prepareVeoExecutor:
      typeof prepareVeoSingleShotProductionExecutor;
  }>;

const defaultDependencies:
  ProductionSingleShotExecutionCompositionDependencies =
  Object.freeze({
    readDialogueVisualAuthorization:
      readDialogueVisualAuthorization,

    createReservation:
      createExecutionReservation,

    createSubmission:
      createExecutionSubmission,

    createCompletion:
      createExecutionCompletion,

    prepareRunwayExecutor:
      prepareRunwaySingleShotProductionExecutor,

    prepareVeoExecutor:
      prepareVeoSingleShotProductionExecutor,
  });

export function createProductionSingleShotExecutionDependencies(
  credentialSource:
    ProductionSingleShotExecutionCredentialSource,

  dependencies:
    ProductionSingleShotExecutionCompositionDependencies =
      defaultDependencies,
): SingleShotExecutionDependencies {
  let runwayExecutorPromise:
    Promise<SingleShotProviderExecutor> | null =
    null;

  let veoExecutorPromise:
    Promise<SingleShotProviderExecutor> | null =
    null;

  const getRunwayExecutor =
    (): Promise<SingleShotProviderExecutor> => {
      if (!runwayExecutorPromise) {
        const runwayCredentialSource:
          Parameters<
            typeof prepareRunwaySingleShotProductionExecutor
          >[0] =
          credentialSource
            .RUNWAYML_API_SECRET ===
              undefined
            ? {}
            : {
                RUNWAYML_API_SECRET:
                  credentialSource
                    .RUNWAYML_API_SECRET,
              };

        runwayExecutorPromise =
          dependencies
            .prepareRunwayExecutor(
              runwayCredentialSource,
            );
      }

      return runwayExecutorPromise;
    };

  const getVeoExecutor =
    (): Promise<SingleShotProviderExecutor> => {
      if (!veoExecutorPromise) {
        veoExecutorPromise =
          dependencies
            .prepareVeoExecutor(
              credentialSource
                .GEMINI_API_KEY ??
                "",
            );
      }

      return veoExecutorPromise;
    };

  const createReservation:
    SingleShotExecutionDependencies[
      "createReservation"
    ] =
    async (
      mediaRoot,
      reservationInput,
    ) => {
      if (
        reservationInput
          .provider ===
        "RUNWAY"
      ) {
        await getRunwayExecutor();
      } else if (
        reservationInput
          .provider ===
        "VEO"
      ) {
        await getVeoExecutor();
      }

      return dependencies
        .createReservation(
          mediaRoot,
          reservationInput,
        );
    };

  const executeRunway:
    SingleShotProviderExecutor =
    async (
      input,
    ) => {
      const executor =
        await getRunwayExecutor();

      return executor(
        input,
      );
    };

  const executeVeo:
    SingleShotProviderExecutor =
    async (
      input,
    ) => {
      const executor =
        await getVeoExecutor();

      return executor(
        input,
      );
    };

  return Object.freeze({
    readDialogueVisualAuthorization:
      dependencies
        .readDialogueVisualAuthorization ??
      readDialogueVisualAuthorization,

    createReservation,

    createSubmission:
      dependencies
        .createSubmission,

    createCompletion:
      dependencies
        .createCompletion,

    executeRunway,
    executeVeo,
  });
}
