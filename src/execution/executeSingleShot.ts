import type {
  Shot,
} from "../schemas/episodeManifest.schema.js";

import {
  resolveDurableShotExecutionReadiness,
} from "./resolveDurableShotExecutionReadiness.js";

import type {
  PaidExecutionProvider,
  SingleShotExecutionDependencies,
  SingleShotExecutionRequest,
  SingleShotExecutionResult,
  SingleShotProviderExecutionInput,
  SingleShotSubmissionAcceptance,
} from "./singleShotExecution.types.js";

function findSelectedShot(
  request:
    SingleShotExecutionRequest,
): Shot {
  for (
    const scene
    of request.episode.scenes
  ) {
    const shot =
      scene.shots.find(
        (candidate) =>
          candidate.id ===
          request.shotId,
      );

    if (shot) {
      return shot;
    }
  }

  throw new Error(
    `Shot ${request.shotId} was not found in episode ${request.episode.episodeId}.`,
  );
}

function requirePaidProvider(
  provider:
    string | null,
  shotId:
    string,
): PaidExecutionProvider {
  switch (provider) {
    case "RUNWAY":
    case "VEO":
      return provider;

    default:
      throw new Error(
        `Single-shot execution blocked: ${shotId} has no supported paid execution provider.`,
      );
  }
}

export async function executeSingleShot(
  request:
    SingleShotExecutionRequest,

  dependencies:
    SingleShotExecutionDependencies,
): Promise<SingleShotExecutionResult> {
  const shot =
    findSelectedShot(
      request,
    );

  const readiness =
    await resolveDurableShotExecutionReadiness(
      {
        episode:
          request.episode,

        shot,

        bible:
          request.bible,

        rules:
          request.rules,

        policy:
          request.policy,

        mediaRoot:
          request.mediaRoot,
      },
      {
        readDialogueVisualAuthorization:
          dependencies
            .readDialogueVisualAuthorization,
      },
    );

  if (
    readiness.disposition !==
    "EXECUTABLE"
  ) {
    const blockerDetail =
      readiness.blockers.length >
      0
        ? ` Blockers: ${readiness.blockers.join(" | ")}`
        : "";

    throw new Error(
      `Single-shot execution blocked: ${shot.id} readiness is ${readiness.disposition}.${blockerDetail}`,
    );
  }

  // B5C-X1: GOOGLE_GENAI is asynchronous. It bypasses the synchronous paid
  // provider contract and delegates to the injected Google submission
  // capability, which owns admission, activation, reservation, the single
  // create and the durable accepted-submission record. No completion, poll,
  // reconcile or output work happens here.
  if (
    readiness.executionProvider ===
    "GOOGLE_GENAI"
  ) {
    if (
      !request.confirmPaidGeneration
    ) {
      throw new Error(
        "Paid-generation confirmation is required before creating an execution reservation.",
      );
    }

    const googleSubmitter =
      dependencies
        .executeGoogleSubmission;

    if (!googleSubmitter) {
      throw new Error(
        `Single-shot execution blocked: ${shot.id} has no shared Google submission dependency.`,
      );
    }

    const submitted =
      await googleSubmitter({
        episode:
          request.episode,

        shotId:
          shot.id,

        bible:
          request.bible,

        rules:
          request.rules,

        mediaRoot:
          request.mediaRoot,

        sourceImagePath:
          request.sourceImagePath,

        confirmPaidGeneration:
          request.confirmPaidGeneration,
      });

    if (
      submitted.lifecycleState !==
        "SUBMITTED" ||
      submitted.provider !==
        "GOOGLE_GENAI" ||
      submitted.episodeId !==
        request.episode.episodeId ||
      submitted.shotId !==
        shot.id ||
      !submitted.providerExecutionId.trim() ||
      !submitted.submissionPath.trim()
    ) {
      throw new Error(
        `Google submission for ${request.episode.episodeId}/${shot.id} did not return a durable accepted-submission identity.`,
      );
    }

    return Object.freeze({
      provider:
        "GOOGLE_GENAI",

      lifecycleState:
        "SUBMITTED",

      readiness,

      submitted,
    });
  }

  const provider =
    requirePaidProvider(
      readiness.executionProvider,
      shot.id,
    );

  if (
    !request.confirmPaidGeneration
  ) {
    throw new Error(
      "Paid-generation confirmation is required before creating an execution reservation.",
    );
  }

  const visualReferenceVerifier =
    dependencies
      .verifyVisualReference;

  if (!visualReferenceVerifier) {
    throw new Error(
      "verifyVisualReference dependency is required before creating an execution reservation.",
    );
  }

  const verifiedVisualReference =
    await visualReferenceVerifier({
      mediaRoot:
        request.mediaRoot,

      sourceImagePath:
        request.sourceImagePath,

      approvedAssetIds:
        shot.references
          .assetIds,
    });

  const verifiedSourceImagePath =
    verifiedVisualReference
      .absolutePath
      .trim();

  if (!verifiedSourceImagePath) {
    throw new Error(
      "Visual-reference verification returned an empty canonical source image path.",
    );
  }

  const reservation =
    await dependencies
      .createReservation(
        request.mediaRoot,
        {
          episodeId:
            request.episode
              .episodeId,

          shotId:
            shot.id,

          provider,
        },
      );

  let submission:
    Awaited<
      ReturnType<
        SingleShotExecutionDependencies[
          "createSubmission"
        ]
      >
    > | null =
    null;

  let acceptedProviderExecutionId:
    string | null =
    null;

  let submissionAttempted =
    false;

  const onSubmissionAccepted =
    async (
      acceptance:
        SingleShotSubmissionAcceptance,
    ): Promise<void> => {
      if (submissionAttempted) {
        throw new Error(
          `Provider submission acceptance was reported more than once for ${request.episode.episodeId}/${shot.id}.`,
        );
      }

      submissionAttempted =
        true;

      if (
        acceptance.provider !==
        provider
      ) {
        throw new Error(
          `Provider submission acceptance reported ${acceptance.provider} for ${request.episode.episodeId}/${shot.id}, but the selected provider is ${provider}.`,
        );
      }

      const normalizedProviderExecutionId =
        acceptance
          .providerExecutionId
          .trim();

      if (!normalizedProviderExecutionId) {
        throw new Error(
          `Provider submission acceptance returned an empty execution ID for ${request.episode.episodeId}/${shot.id}.`,
        );
      }

      acceptedProviderExecutionId =
        normalizedProviderExecutionId;

      submission =
        acceptance.provider ===
          "RUNWAY"
          ? await dependencies
              .createSubmission(
                request.mediaRoot,
                {
                  reservationId:
                    reservation.record
                      .reservationId,

                  episodeId:
                    request.episode
                      .episodeId,

                  shotId:
                    shot.id,

                  provider:
                    "RUNWAY",

                  providerExecutionId:
                    normalizedProviderExecutionId,

                  providerEstimatedCredits:
                    acceptance
                      .providerEstimatedCredits,

                  recoveryMetadata:
                    acceptance
                      .recoveryMetadata,
                },
              )
          : await dependencies
              .createSubmission(
                request.mediaRoot,
                {
                  reservationId:
                    reservation.record
                      .reservationId,

                  episodeId:
                    request.episode
                      .episodeId,

                  shotId:
                    shot.id,

                  provider:
                    "VEO",

                  providerExecutionId:
                    normalizedProviderExecutionId,

                  recoveryMetadata:
                    acceptance
                      .recoveryMetadata,
                },
              );
    };

  const providerInput:
    SingleShotProviderExecutionInput =
    Object.freeze({
      episode:
        request.episode,

      shot,

      readiness,

      mediaRoot:
        request.mediaRoot,

      sourceImagePath:
        verifiedSourceImagePath,

      reservation,

      onSubmissionAccepted,
    });

  let providerExecution;

  switch (provider) {
    case "RUNWAY":
      providerExecution =
        await dependencies
          .executeRunway(
            providerInput,
          );
      break;

    case "VEO":
      providerExecution =
        await dependencies
          .executeVeo(
            providerInput,
          );
      break;
  }

  if (
    !submission ||
    !acceptedProviderExecutionId
  ) {
    throw new Error(
      `Provider execution for ${request.episode.episodeId}/${shot.id} completed without durable submission acceptance.`,
    );
  }

  const returnedProviderExecutionId =
    providerExecution
      .providerExecutionId
      .trim();

  if (!returnedProviderExecutionId) {
    throw new Error(
      `Provider execution for ${request.episode.episodeId}/${shot.id} returned an empty execution ID.`,
    );
  }

  if (
    returnedProviderExecutionId !==
    acceptedProviderExecutionId
  ) {
    throw new Error(
      `Provider execution ID ${returnedProviderExecutionId} does not match accepted submission ID ${acceptedProviderExecutionId} for ${request.episode.episodeId}/${shot.id}.`,
    );
  }

  const generationRecordPath =
    providerExecution
      .recordPath
      .trim();

  if (!generationRecordPath) {
    throw new Error(
      `Provider execution for ${request.episode.episodeId}/${shot.id} returned an empty generation record path.`,
    );
  }

  const completion =
    await dependencies
      .createCompletion(
        request.mediaRoot,
        {
          reservationId:
            reservation.record
              .reservationId,

          episodeId:
            request.episode
              .episodeId,

          shotId:
            shot.id,

          provider,

          providerExecutionId:
            returnedProviderExecutionId,

          generationRecordPath,
        },
      );

  return Object.freeze({
    provider,
    readiness,
    reservation,
    submission,
    providerExecution,
    completion,
  });
}
