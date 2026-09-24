import type {
  Shot,
} from "../../schemas/episodeManifest.schema.js";

import type {
  VeoPolicy,
} from "../../schemas/veoPolicy.schema.js";

import type {
  SingleShotProviderExecutionInput,
  SingleShotProviderExecutionResult,
  SingleShotSubmissionAcceptedHandler,
} from "../singleShotExecution.types.js";

import {
  assertReferenceImageInsideRoot,
} from "./referenceImagePath.js";

export type VeoSingleShotTransactionInput =
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
      VeoPolicy;
  }>;

export type VeoSingleShotTransactionResult =
  Readonly<{
    record:
      Readonly<{
        operationName:
          string;
      }>;

    recordPath:
      string;
  }>;

export type VeoSingleShotTransactionRunner =
  (
    input:
      VeoSingleShotTransactionInput,

    onSubmissionAccepted:
      SingleShotSubmissionAcceptedHandler,
  ) =>
    Promise<
      VeoSingleShotTransactionResult
    >;

export type VeoSingleShotPromptBuilder =
  (
    shot: Shot,
  ) => string;

export type VeoSingleShotAdapterDependencies =
  Readonly<{
    policy:
      VeoPolicy;

    buildPrompt:
      VeoSingleShotPromptBuilder;

    runTransaction:
      VeoSingleShotTransactionRunner;
  }>;

function assertVeoExecutionEnvelope(
  input:
    SingleShotProviderExecutionInput,
): void {
  if (
    input.readiness.disposition !==
    "EXECUTABLE"
  ) {
    throw new Error(
      `Veo adapter requires EXECUTABLE readiness; received ${input.readiness.disposition}.`,
    );
  }

  if (
    input.readiness.executionProvider !==
    "VEO"
  ) {
    throw new Error(
      `Veo adapter requires VEO as the execution provider; received ${String(
        input.readiness.executionProvider,
      )}.`,
    );
  }

  const reservation =
    input.reservation.record;

  if (
    reservation.provider !==
    "VEO"
  ) {
    throw new Error(
      `Execution reservation must belong to VEO; received ${reservation.provider}.`,
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

function requireOperationName(
  operationName: string,
): string {
  const normalized =
    operationName.trim();

  if (!normalized) {
    throw new Error(
      "Veo transaction returned an empty operation name.",
    );
  }

  return normalized;
}

export async function executeVeoSingleShot(
  input:
    SingleShotProviderExecutionInput,

  dependencies:
    VeoSingleShotAdapterDependencies,
): Promise<
  SingleShotProviderExecutionResult
> {
  assertVeoExecutionEnvelope(
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
      },
      input.onSubmissionAccepted,
    );

  return Object.freeze({
    providerExecutionId:
      requireOperationName(
        transaction.record
          .operationName,
      ),

    recordPath:
      transaction.recordPath,
  });
}
