import {
  inspectExecutionLifecycle,
} from "../execution/inspectExecutionLifecycle.js";

import {
  reconcileExecutionLifecycle,
  type ExecutionLifecycleReconciliationResult,
} from "../execution/reconcileExecutionLifecycle.js";

export type VerifyCompletedShotForCompositionInput =
  Readonly<{
    mediaRoot:
      string;

    episodeId:
      string;

    shotId:
      string;
  }>;

export type VerifyCompletedShotForCompositionDependencies =
  Readonly<{
    inspectLifecycle:
      typeof inspectExecutionLifecycle;

    verifyLifecycle:
      typeof reconcileExecutionLifecycle;
  }>;

const defaultDependencies:
  VerifyCompletedShotForCompositionDependencies =
  Object.freeze({
    inspectLifecycle:
      inspectExecutionLifecycle,

    verifyLifecycle:
      reconcileExecutionLifecycle,
  });

export async function verifyCompletedShotForComposition(
  input:
    VerifyCompletedShotForCompositionInput,

  dependencies:
    VerifyCompletedShotForCompositionDependencies =
      defaultDependencies,
): Promise<
  ExecutionLifecycleReconciliationResult
> {
  const lifecycle =
    await dependencies
      .inspectLifecycle(
        input.mediaRoot,
        input.episodeId,
        input.shotId,
      );

  if (
    lifecycle.state !==
    "COMPLETED"
  ) {
    throw new Error(
      `Composition admission requires COMPLETED lifecycle for ${input.episodeId}/${input.shotId}; received ${lifecycle.state}.`,
    );
  }

  const cachedInspectLifecycle:
    typeof inspectExecutionLifecycle =
    async () =>
      lifecycle;

  const verified =
    await dependencies
      .verifyLifecycle(
        {
          mediaRoot:
            input.mediaRoot,

          episodeId:
            input.episodeId,

          shotId:
            input.shotId,
        },
        {
          inspectLifecycle:
            cachedInspectLifecycle,
        },
      );

  if (
    verified.lifecycleState !==
      "COMPLETED" ||
    verified.reconciliationMode !==
      "DURABLE_COMPLETION"
  ) {
    throw new Error(
      `Composition admission requires DURABLE_COMPLETION verification for ${input.episodeId}/${input.shotId}.`,
    );
  }

  return verified;
}
