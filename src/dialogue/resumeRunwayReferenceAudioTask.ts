import type RunwayML from "@runwayml/sdk";

import {
  z,
} from "zod";

export type RunwayReferenceAudioTaskLookupClient =
  Readonly<{
    tasks:
      Readonly<
        Pick<
          RunwayML["tasks"],
          "retrieve"
        >
      >;
  }>;

export type ResumeRunwayReferenceAudioTaskInput =
  Readonly<{
    taskId:
      string;

    providerEstimatedCredits:
      number;

    waitTimeoutMs:
      number;
  }>;

export type RunwayReferenceAudioTaskResumeResult =
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

const ProviderCreatedAtSchema =
  z.string()
    .datetime();

function requireRunwayTaskId(
  value:
    string,

  label:
    "durable" | "retrieved" | "completed",
): string {
  if (
    typeof value !==
    "string"
  ) {
    throw new Error(
      `Runway reference-audio ${label} task ID must be a string.`,
    );
  }

  const normalized =
    value.trim();

  if (!normalized) {
    throw new Error(
      `Runway reference-audio ${label} task ID must be non-empty.`,
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
    !Number.isFinite(
      value,
    ) ||
    value < 0
  ) {
    throw new Error(
      `Runway reference-audio provider ${label} credits must be finite and nonnegative.`,
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
      "Runway reference-audio resume wait timeout must be a positive safe integer.",
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
      `Runway reference-audio returned an invalid createdAt timestamp: ${String(
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
  if (
    typeof value !==
    "string"
  ) {
    throw new Error(
      "Runway reference-audio returned an invalid output URL.",
    );
  }

  let parsed:
    URL;

  try {
    parsed =
      new URL(
        value,
      );
  } catch {
    throw new Error(
      "Runway reference-audio returned an invalid output URL.",
    );
  }

  if (
    parsed.protocol !==
    "https:"
  ) {
    throw new Error(
      "Runway reference-audio output URL must use HTTPS.",
    );
  }
}

export async function resumeRunwayReferenceAudioTask(
  client:
    RunwayReferenceAudioTaskLookupClient,

  input:
    ResumeRunwayReferenceAudioTaskInput,
): Promise<
  RunwayReferenceAudioTaskResumeResult
> {
  const taskId =
    requireRunwayTaskId(
      input.taskId,
      "durable",
    );

  const providerEstimatedCredits =
    requireProviderCredits(
      input.providerEstimatedCredits,
      "estimated",
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
      "retrieved",
    );

  if (
    retrievedTaskId !==
    taskId
  ) {
    throw new Error(
      `Runway reference-audio retrieved task ID ${retrievedTaskId} does not match durable task ID ${taskId}.`,
    );
  }

  const succeeded =
    await task
      .waitForTaskOutput({
        timeout:
          waitTimeoutMs,
      });

  if (
    succeeded.status !==
    "SUCCEEDED"
  ) {
    throw new Error(
      "Runway reference-audio recovery did not return SUCCEEDED terminal evidence.",
    );
  }

  const succeededTaskId =
    requireRunwayTaskId(
      succeeded.id,
      "completed",
    );

  if (
    succeededTaskId !==
    taskId
  ) {
    throw new Error(
      `Runway reference-audio completed task ID ${succeededTaskId} does not match durable task ID ${taskId}.`,
    );
  }

  const providerCreatedAt =
    requireProviderCreatedAt(
      succeeded.createdAt,
    );

  const finalCredits =
    requireProviderCredits(
      succeeded
        .cost
        .credits,
      "final",
    );

  if (
    !Array.isArray(
      succeeded.output,
    ) ||
    succeeded.output.length ===
      0
  ) {
    throw new Error(
      "Runway reference-audio generation succeeded but returned no output URLs.",
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

    estimatedCredits:
      providerEstimatedCredits,

    finalCredits,

    outputUrls:
      Object.freeze([
        ...succeeded.output,
      ]),
  });
}
