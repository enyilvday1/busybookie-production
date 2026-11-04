import {
  BoundEpisodeError,
} from "../boundEpisodeProduction.types.js";

import {
  assertCheckedEpisodeAdmission,
  checkedEpisodeExecutionData,
  consumeEpisodeRecoveryDispatch,
  type CheckedEpisodeExecutionContext,
} from "../episodeExecutionGuard.js";

import {
  createProductionExecutionReconcileDependencies,
} from "../createProductionExecutionReconcileDependencies.js";

export type ProductionVisualAttemptExecutionReconcileInput =
  Readonly<{
    episodeId:
      string;

    shotId:
      string;

    attemptNumber:
      number;
  }>;

export type RunProductionVisualAttemptExecutionReconcileDependencies =
  Readonly<{
    createDependencies:
      typeof createProductionExecutionReconcileDependencies;
  }>;

const defaultDependencies:
  RunProductionVisualAttemptExecutionReconcileDependencies =
  Object.freeze({
    createDependencies:
      createProductionExecutionReconcileDependencies,
  });

export async function runProductionVisualAttemptExecutionReconcile(
  input:
    ProductionVisualAttemptExecutionReconcileInput,

  dependencies:
    RunProductionVisualAttemptExecutionReconcileDependencies =
      defaultDependencies,

  checkedContext?:
    CheckedEpisodeExecutionContext,
): Promise<void> {
  if (!checkedContext) {
    throw new BoundEpisodeError(
      "OPERATING_CONDITION_UNESTABLISHED",
    );
  }

  const checked =
    checkedEpisodeExecutionData(
      checkedContext,
    );

  const action =
    checked.plan.actions[0];

  if (
    action.kind !==
      "VISUAL_ATTEMPT_RECONCILE" ||
    input.episodeId !==
      action.episodeId ||
    input.shotId !==
      action.shotId ||
    input.attemptNumber !==
      action.attemptNumber
  ) {
    throw new BoundEpisodeError(
      "INPUT_BINDING_DRIFT",
    );
  }

  await assertCheckedEpisodeAdmission(
    checkedContext,
  );

  const production =
    dependencies
      .createDependencies();

  const reconcile =
    production
      .reconcileGoogleVisualAttemptLifecycle;

  const createSubmittedRecovery =
    production
      .createGoogleSubmittedRecovery;

  if (
    !reconcile ||
    !createSubmittedRecovery
  ) {
    throw new BoundEpisodeError(
      "OPERATING_CONDITION_UNESTABLISHED",
    );
  }

  const environment =
    production
      .loadEnvironment();

  const geminiApiKey =
    environment
      .GEMINI_API_KEY
      ?.trim();

  if (!geminiApiKey) {
    throw new BoundEpisodeError(
      "OPERATING_CONDITION_UNESTABLISHED",
    );
  }

  await assertCheckedEpisodeAdmission(
    checkedContext,
  );

  consumeEpisodeRecoveryDispatch(
    checked.invocation,
  );

  await reconcile(
    {
      mediaRoot:
        checked.plan
          .inputBinding
          .runtimeIdentity
          .mediaRoot,

      episodeId:
        action.episodeId,

      shotId:
        action.shotId,

      attemptNumber:
        action.attemptNumber,
    },
    {
      submittedRecovery:
        createSubmittedRecovery(
          geminiApiKey,
        ),
    },
  );
}
