import type RunwayML from "@runwayml/sdk";

import type {
  Gen45Request,
} from "../gen45/gen45Request.schema.js";

export type RunwayCreatedGeneration =
  Readonly<{
    id: string;
    estimatedCost: Readonly<{
      credits: number;
    }>;
  }>;

export type RunwaySucceededGeneration =
  Readonly<{
    id: string;
    status: "SUCCEEDED";
    cost: Readonly<{
      credits: number;
    }>;
    output: readonly string[];
  }>;

export type RunwayGen45ExecutionResult =
  Readonly<{
    taskId: string;
    estimatedCredits: number;
    finalCredits: number;
    outputUrls: readonly string[];
  }>;

function assertHttpsOutputUrl(
  value: string,
): void {
  let parsed: URL;

  try {
    parsed =
      new URL(value);
  } catch {
    throw new Error(
      "Runway returned an invalid output URL.",
    );
  }

  if (
    parsed.protocol !== "https:"
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
  if (
    created.id !== succeeded.id
  ) {
    throw new Error(
      `Runway task id mismatch: created ${created.id}, completed ${succeeded.id}.`,
    );
  }

  if (
    succeeded.output.length === 0
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
      succeeded.id,

    estimatedCredits:
      created.estimatedCost.credits,

    finalCredits:
      succeeded.cost.credits,

    outputUrls:
      Object.freeze([
        ...succeeded.output,
      ]),
  });
}

export async function executeRunwayGen45(
  client: RunwayML,
  request: Gen45Request,
  waitTimeoutMs: number,
): Promise<RunwayGen45ExecutionResult> {
  const task =
    client.imageToVideo.create(
      request,
    );

  const created =
    await task;

  const succeeded =
    await task.waitForTaskOutput({
      timeout:
        waitTimeoutMs,
    });

  return normalizeRunwayGen45Result(
    created,
    succeeded,
  );
}
