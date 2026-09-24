import type RunwayML from "@runwayml/sdk";

import type {
  Gen45Request,
} from "../gen45/gen45Request.schema.js";

export type RunwayCreatedGeneration =
  Readonly<{
    id: string;

    estimatedCost:
      Readonly<{
        credits: number;
      }>;
  }>;

export type RunwaySucceededGeneration =
  Readonly<{
    id: string;

    status:
      "SUCCEEDED";

    cost:
      Readonly<{
        credits: number;
      }>;

    output:
      readonly string[];
  }>;

export type RunwayGen45ExecutionResult =
  Readonly<{
    taskId:
      string;

    estimatedCredits:
      number;

    finalCredits:
      number;

    outputUrls:
      readonly string[];
  }>;

export type RunwaySubmissionAcceptedHandler =
  (
    taskId:
      string,
  ) =>
    Promise<void>;

export type RunwayGen45ExecutionOptions =
  Readonly<{
    waitTimeoutMs:
      number;

    onSubmissionAccepted:
      RunwaySubmissionAcceptedHandler;
  }>;

function requireRunwayTaskId(
  value:
    string,
): string {
  const normalized =
    value.trim();

  if (!normalized) {
    throw new Error(
      "Runway returned an empty task ID.",
    );
  }

  return normalized;
}

function assertHttpsOutputUrl(
  value: string,
): void {
  let parsed: URL;

  try {
    parsed =
      new URL(
        value,
      );
  } catch {
    throw new Error(
      "Runway returned an invalid output URL.",
    );
  }

  if (
    parsed.protocol !==
    "https:"
  ) {
    throw new Error(
      "Runway output URL must use HTTPS.",
    );
  }
}

export function normalizeRunwayGen45Result(
  created:
    RunwayCreatedGeneration,

  succeeded:
    RunwaySucceededGeneration,
): RunwayGen45ExecutionResult {
  const createdTaskId =
    requireRunwayTaskId(
      created.id,
    );

  const succeededTaskId =
    requireRunwayTaskId(
      succeeded.id,
    );

  if (
    createdTaskId !==
    succeededTaskId
  ) {
    throw new Error(
      `Runway task id mismatch: created ${createdTaskId}, completed ${succeededTaskId}.`,
    );
  }

  if (
    succeeded.output.length ===
    0
  ) {
    throw new Error(
      "Runway generation succeeded but returned no output URLs.",
    );
  }

  for (
    const outputUrl
    of succeeded.output
  ) {
    assertHttpsOutputUrl(
      outputUrl,
    );
  }

  return Object.freeze({
    taskId:
      succeededTaskId,

    estimatedCredits:
      created
        .estimatedCost
        .credits,

    finalCredits:
      succeeded
        .cost
        .credits,

    outputUrls:
      Object.freeze([
        ...succeeded.output,
      ]),
  });
}

export async function executeRunwayGen45(
  client:
    RunwayML,

  request:
    Gen45Request,

  options:
    RunwayGen45ExecutionOptions,
): Promise<RunwayGen45ExecutionResult> {
  const task =
    client.imageToVideo.create(
      request,
      {
        maxRetries:
          0,
      },
    );

  const created =
    await task;

  const taskId =
    requireRunwayTaskId(
      created.id,
    );

  try {
    await options
      .onSubmissionAccepted(
        taskId,
      );
  } catch (error) {
    throw new Error(
      `Runway accepted paid task ${taskId}, but Busybookie could not durably record the submission. Do not resubmit automatically.`,
      {
        cause:
          error,
      },
    );
  }

  const succeeded =
    await task
      .waitForTaskOutput({
        timeout:
          options
            .waitTimeoutMs,
      });

  return normalizeRunwayGen45Result(
    created,
    succeeded,
  );
}
