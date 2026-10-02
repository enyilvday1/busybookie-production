import type RunwayML from "@runwayml/sdk";

import {
  normalizeRunwayElevenV3Result,
  type RunwayElevenV3CreatedGeneration,
  type RunwayElevenV3ExecutionResult,
} from "./runwayElevenV3Execution.js";

export type RunwayElevenV3TaskLookupClient =
  Readonly<{
    tasks:
      Readonly<
        Pick<
          RunwayML["tasks"],
          "retrieve"
        >
      >;
  }>;

export type ResumeRunwayElevenV3TaskInput =
  Readonly<{
    taskId:
      string;

    providerEstimatedCredits:
      number;

    waitTimeoutMs:
      number;
  }>;

function requireRunwayTaskId(
  value:
    string,
): string {
  const normalized =
    value.trim();

  if (!normalized) {
    throw new Error(
      "Runway Eleven v3 resume requires a non-empty task ID.",
    );
  }

  return normalized;
}

function requireProviderEstimatedCredits(
  value:
    number,
): number {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      "Runway Eleven v3 resume requires providerEstimatedCredits to be a nonnegative safe integer.",
    );
  }

  return value;
}

function requireWaitTimeoutMs(
  value:
    number,
): number {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value <= 0
  ) {
    throw new Error(
      "Runway Eleven v3 resume wait timeout must be a positive safe integer.",
    );
  }

  return value;
}

export async function resumeRunwayElevenV3Task(
  client:
    RunwayElevenV3TaskLookupClient,

  input:
    ResumeRunwayElevenV3TaskInput,
): Promise<
  RunwayElevenV3ExecutionResult
> {
  const taskId =
    requireRunwayTaskId(
      input.taskId,
    );

  const providerEstimatedCredits =
    requireProviderEstimatedCredits(
      input.providerEstimatedCredits,
    );

  const waitTimeoutMs =
    requireWaitTimeoutMs(
      input.waitTimeoutMs,
    );

  const task =
    client.tasks
      .retrieve(
        taskId,
        {
          maxRetries:
            0,
        },
      );

  const retrieved =
    await task;

  const retrievedTaskId =
    requireRunwayTaskId(
      retrieved.id,
    );

  if (
    retrievedTaskId !==
    taskId
  ) {
    throw new Error(
      `Runway Eleven v3 retrieved task ID ${retrievedTaskId} does not match durable task ID ${taskId}.`,
    );
  }

  const succeeded =
    await task
      .waitForTaskOutput({
        timeout:
          waitTimeoutMs,
      });

  const created:
    RunwayElevenV3CreatedGeneration =
      Object.freeze({
        id:
          taskId,

        estimatedCost:
          Object.freeze({
            credits:
              providerEstimatedCredits,
          }),
      });

  return normalizeRunwayElevenV3Result(
    created,
    succeeded,
  );
}
