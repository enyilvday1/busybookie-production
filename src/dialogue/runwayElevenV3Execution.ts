import type RunwayML from "@runwayml/sdk";

import {
  z,
} from "zod";

import type {
  RunwayElevenV3Request,
} from "./runwayElevenV3Request.schema.js";

export type RunwayElevenV3CreatedGeneration =
  Readonly<{
    id:
      string;

    estimatedCost:
      Readonly<{
        credits:
          number;
      }>;
  }>;

export type RunwayElevenV3SucceededGeneration =
  Readonly<{
    id:
      string;

    createdAt:
      string;

    status:
      "SUCCEEDED";

    cost:
      Readonly<{
        credits:
          number;
      }>;

    output:
      readonly string[];
  }>;

export type RunwayElevenV3ExecutionResult =
  Readonly<{
    taskId:
      string;

    providerCreatedAt:
      string;

    estimatedCredits:
      number;

    finalCredits:
      number;

    outputUrls:
      readonly string[];
  }>;

export type RunwayElevenV3SubmissionAcceptance =
  Readonly<{
    taskId:
      string;

    providerEstimatedCredits:
      number;
  }>;

export type RunwayElevenV3SubmissionAcceptedHandler =
  (
    acceptance:
      RunwayElevenV3SubmissionAcceptance,
  ) =>
    Promise<void>;

export type RunwayElevenV3ExecutionOptions =
  Readonly<{
    waitTimeoutMs:
      number;

    onSubmissionAccepted:
      RunwayElevenV3SubmissionAcceptedHandler;
  }>;

const ProviderCreatedAtSchema =
  z.string()
    .datetime();

function requireRunwayTaskId(
  value:
    string,
): string {
  const normalized =
    value.trim();

  if (!normalized) {
    throw new Error(
      "Runway Eleven v3 returned an empty task ID.",
    );
  }

  return normalized;
}

function requireProviderCredits(
  value:
    number,

  label:
    "estimated" | "final",
): number {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      `Runway Eleven v3 provider ${label} credits must be a nonnegative safe integer.`,
    );
  }

  return value;
}

function requireProviderCreatedAt(
  value:
    string,
): string {
  const parsed =
    ProviderCreatedAtSchema.safeParse(
      value,
    );

  if (!parsed.success) {
    throw new Error(
      `Runway Eleven v3 returned an invalid createdAt timestamp: ${String(
        value,
      )}`,
    );
  }

  return parsed.data;
}

function assertHttpsOutputUrl(
  value:
    string,
): void {
  let parsed:
    URL;

  try {
    parsed =
      new URL(
        value,
      );
  } catch {
    throw new Error(
      "Runway Eleven v3 returned an invalid output URL.",
    );
  }

  if (
    parsed.protocol !==
    "https:"
  ) {
    throw new Error(
      "Runway Eleven v3 output URL must use HTTPS.",
    );
  }
}

export function normalizeRunwayElevenV3Result(
  created:
    RunwayElevenV3CreatedGeneration,

  succeeded:
    RunwayElevenV3SucceededGeneration,
): RunwayElevenV3ExecutionResult {
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
      `Runway Eleven v3 task id mismatch: created ${createdTaskId}, completed ${succeededTaskId}.`,
    );
  }

  const estimatedCredits =
    requireProviderCredits(
      created
        .estimatedCost
        .credits,
      "estimated",
    );

  const finalCredits =
    requireProviderCredits(
      succeeded
        .cost
        .credits,
      "final",
    );

  const providerCreatedAt =
    requireProviderCreatedAt(
      succeeded.createdAt,
    );

  if (
    succeeded.output.length ===
    0
  ) {
    throw new Error(
      "Runway Eleven v3 generation succeeded but returned no output URLs.",
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

    providerCreatedAt,

    estimatedCredits,

    finalCredits,

    outputUrls:
      Object.freeze([
        ...succeeded.output,
      ]),
  });
}

export async function executeRunwayElevenV3(
  client:
    RunwayML,

  request:
    RunwayElevenV3Request,

  options:
    RunwayElevenV3ExecutionOptions,
): Promise<
  RunwayElevenV3ExecutionResult
> {
  const task =
    client.textToSpeech.create(
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

  const providerEstimatedCredits =
    requireProviderCredits(
      created
        .estimatedCost
        .credits,
      "estimated",
    );

  try {
    await options
      .onSubmissionAccepted({
        taskId,

        providerEstimatedCredits,
      });
  } catch (error) {
    throw new Error(
      `Runway accepted paid dialogue task ${taskId}, but Busybookie could not durably record the submission. Do not resubmit automatically.`,
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

  return normalizeRunwayElevenV3Result(
    created,
    succeeded,
  );
}
