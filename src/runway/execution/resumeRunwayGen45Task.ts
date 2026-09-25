import type RunwayML from "@runwayml/sdk";

import {
  normalizeRunwayGen45Result,
  type RunwayCreatedGeneration,
  type RunwayGen45ExecutionResult,
} from "./runwayGen45Execution.js";

export type RunwayTaskLookupClient =
  Readonly<{
    tasks:
      Readonly<
        Pick<
          RunwayML["tasks"],
          "retrieve"
        >
      >;
  }>;

export type ResumeRunwayGen45TaskInput =
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
      "Runway resume requires a non-empty task ID.",
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
      "Runway resume requires providerEstimatedCredits to be a nonnegative safe integer.",
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
      "Runway resume wait timeout must be a positive safe integer.",
    );
  }

  return value;
}

export async function resumeRunwayGen45Task(
  client:
    RunwayTaskLookupClient,

  input:
    ResumeRunwayGen45TaskInput,
): Promise<RunwayGen45ExecutionResult> {
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
      `Runway retrieved task ID ${retrievedTaskId} does not match durable task ID ${taskId}.`,
    );
  }

  const succeeded =
    await task
      .waitForTaskOutput({
        timeout:
          waitTimeoutMs,
      });

  const created:
    RunwayCreatedGeneration =
    Object.freeze({
      id:
        taskId,

      estimatedCost:
        Object.freeze({
          credits:
            providerEstimatedCredits,
        }),
    });

  return normalizeRunwayGen45Result(
    created,
    succeeded,
  );
}
