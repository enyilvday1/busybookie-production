import {
  inspectExecutionLifecycle,
} from "./inspectExecutionLifecycle.js";

import type {
  ResumeRunwayGen45TaskInput,
} from "../runway/execution/resumeRunwayGen45Task.js";

import type {
  RunwayGen45ExecutionResult,
} from "../runway/execution/runwayGen45Execution.js";

export type ExecutionLifecycleReconciliationInput =
  Readonly<{
    mediaRoot:
      string;

    episodeId:
      string;

    shotId:
      string;

    runwayWaitTimeoutMs:
      number;
  }>;

export type ExecutionLifecycleReconciliationDependencies =
  Readonly<{
    inspectLifecycle:
      typeof inspectExecutionLifecycle;

    resumeRunwayTask:
      (
        input:
          ResumeRunwayGen45TaskInput,
      ) =>
        Promise<
          RunwayGen45ExecutionResult
        >;
  }>;

export type ExecutionLifecycleReconciliationResult =
  Readonly<{
    lifecycleState:
      "SUBMITTED";

    provider:
      "RUNWAY";

    providerExecutionId:
      string;

    providerExecution:
      RunwayGen45ExecutionResult;
  }>;

export async function reconcileExecutionLifecycle(
  input:
    ExecutionLifecycleReconciliationInput,

  dependencies:
    ExecutionLifecycleReconciliationDependencies,
): Promise<ExecutionLifecycleReconciliationResult> {
  const lifecycle =
    await dependencies
      .inspectLifecycle(
        input.mediaRoot,
        input.episodeId,
        input.shotId,
      );

  if (
    lifecycle.state !==
    "SUBMITTED"
  ) {
    throw new Error(
      `Execution lifecycle reconciliation currently requires SUBMITTED state; received ${lifecycle.state}.`,
    );
  }

  const submission =
    lifecycle.submission;

  if (
    submission.provider !==
    "RUNWAY"
  ) {
    throw new Error(
      `Execution lifecycle reconciliation for provider ${submission.provider} is not implemented in this milestone.`,
    );
  }

  if (
    submission.schemaVersion !==
    "1.1"
  ) {
    throw new Error(
      "Runway reconciliation requires submission schema version 1.1 with durable providerEstimatedCredits. Legacy Runway 1.0 submissions require manual reconciliation.",
    );
  }

  const providerExecution =
    await dependencies
      .resumeRunwayTask({
        taskId:
          submission
            .providerExecutionId,

        providerEstimatedCredits:
          submission
            .providerEstimatedCredits,

        waitTimeoutMs:
          input
            .runwayWaitTimeoutMs,
      });

  if (
    providerExecution.taskId !==
    submission.providerExecutionId
  ) {
    throw new Error(
      `Runway reconciliation returned task ID ${providerExecution.taskId} but durable submission records ${submission.providerExecutionId}.`,
    );
  }

  return Object.freeze({
    lifecycleState:
      "SUBMITTED",

    provider:
      "RUNWAY",

    providerExecutionId:
      submission
        .providerExecutionId,

    providerExecution,
  });
}
