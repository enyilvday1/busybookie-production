import {
  createGoogleGenAiSingleShotProductionInteractionCreator,
} from "./providers/createGoogleGenAiSingleShotProductionInteractionCreator.js";

import {
  createGoogleGenAiSingleShotSecureProductionRecovery,
} from "./providers/createGoogleGenAiSingleShotSecureProductionRecovery.js";

/**
 * Production dependency composition for the operator-only Google runner.
 *
 * The explicitly supplied API key is validated by the secure recovery
 * factory's canonical rule (without echoing it) and then bound into the
 * existing create-side and recovery-side factories. Construction performs
 * no network call, no provider call and no environment or policy read; the
 * caller owns credential acquisition and admission.
 */

export type GoogleGenAiOperatorProductionDependencies =
  Readonly<{
    createInteraction:
      ReturnType<
        typeof createGoogleGenAiSingleShotProductionInteractionCreator
      >;
    submittedRecovery:
      ReturnType<
        typeof createGoogleGenAiSingleShotSecureProductionRecovery
      >;
  }>;

export function createGoogleGenAiOperatorProductionDependencies(
  apiKey:
    string,
): GoogleGenAiOperatorProductionDependencies {
  const submittedRecovery =
    createGoogleGenAiSingleShotSecureProductionRecovery(
      apiKey,
    );

  const createInteraction =
    createGoogleGenAiSingleShotProductionInteractionCreator(
      apiKey,
    );

  return Object.freeze({
    createInteraction,
    submittedRecovery,
  });
}
