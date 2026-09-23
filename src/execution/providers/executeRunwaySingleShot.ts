import type {
  Shot,
} from "../../schemas/episodeManifest.schema.js";

import type {
  RunwayPolicy,
} from "../../schemas/runwayPolicy.schema.js";

import type {
  SingleShotProviderExecutionInput,
  SingleShotProviderExecutionResult,
} from "../singleShotExecution.types.js";

import {
  assertReferenceImageInsideRoot,
} from "./referenceImagePath.js";

export type RunwaySingleShotTransactionInput =
  Readonly<{
    episodeId: string;
    shotId: string;

    sourceImagePath:
      string;

    promptText:
      string;

    durationSeconds:
      number;

    mediaRoot:
      string;

    policy:
      RunwayPolicy;
  }>;

export type RunwaySingleShotTransactionResult =
  Readonly<{
    record:
      Readonly<{
        taskId:
          string;
      }>;

    recordPath:
      string;
  }>;

export type RunwaySingleShotTransactionRunner =
  (
    input:
      RunwaySingleShotTransactionInput,
  ) =>
    Promise<
      RunwaySingleShotTransactionResult
    >;

export type RunwaySingleShotPromptBuilder =
  (
    shot: Shot,
  ) => string;

export type RunwaySingleShotAdapterDependencies =
  Readonly<{
    policy:
      RunwayPolicy;

    buildPrompt:
      RunwaySingleShotPromptBuilder;

    runTransaction:
      RunwaySingleShotTransactionRunner;
  }>;

function assertRunwayExecutionEnvelope(
  input:
    SingleShotProviderExecutionInput,
): void {
  if (
    input.readiness.disposition !==
    "EXECUTABLE"
  ) {
    throw new Error(
      `Runway adapter requires EXECUTABLE readiness; received ${input.readiness.disposition}.`,
    );
  }

  if (
    input.readiness.executionProvider !==
    "RUNWAY"
  ) {
    throw new Error(
      `Runway adapter requires RUNWAY as the execution provider; received ${String(
        input.readiness.executionProvider,
      )}.`,
    );
  }

  const reservation =
    input.reservation.record;

  if (
    reservation.provider !==
    "RUNWAY"
  ) {
    throw new Error(
      `Execution reservation must belong to RUNWAY; received ${reservation.provider}.`,
    );
  }

  if (
    reservation.episodeId !==
      input.episode.episodeId ||
    reservation.shotId !==
      input.shot.id
  ) {
    throw new Error(
      `Execution reservation ${reservation.episodeId}/${reservation.shotId} does not match requested shot ${input.episode.episodeId}/${input.shot.id}.`,
    );
  }
}

function requireTaskId(
  taskId: string,
): string {
  const normalized =
    taskId.trim();

  if (!normalized) {
    throw new Error(
      "Runway transaction returned an empty task ID.",
    );
  }

  return normalized;
}

export async function executeRunwaySingleShot(
  input:
    SingleShotProviderExecutionInput,

  dependencies:
    RunwaySingleShotAdapterDependencies,
): Promise<
  SingleShotProviderExecutionResult
> {
  assertRunwayExecutionEnvelope(
    input,
  );

  const sourceImagePath =
    assertReferenceImageInsideRoot(
      input.mediaRoot,
      input.sourceImagePath,
    );

  const promptText =
    dependencies.buildPrompt(
      input.shot,
    );

  const transaction =
    await dependencies
      .runTransaction({
        episodeId:
          input.episode.episodeId,

        shotId:
          input.shot.id,

        sourceImagePath,

        promptText,

        durationSeconds:
          input.shot
            .durationSeconds,

        mediaRoot:
          input.mediaRoot,

        policy:
          dependencies.policy,
      });

  return Object.freeze({
    providerExecutionId:
      requireTaskId(
        transaction.record
          .taskId,
      ),

    recordPath:
      transaction.recordPath,
  });
}
