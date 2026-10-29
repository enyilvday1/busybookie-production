import {
  extname,
} from "node:path";
import { checkedEpisodeExecutionData, recheckEpisodeExecutionBindings, type CheckedEpisodeExecutionContext } from "./episodeExecutionGuard.js";
import { rawSha256, BoundEpisodeError } from "./boundEpisodeProduction.types.js";

import {
  readGoogleGenAiReferenceImage,
  type GoogleGenAiReferenceImageMimeType,
} from "../googleGenai/assets/readGoogleGenAiReferenceImage.js";

import {
  GEMINI_OMNI_11_FLASH_MODEL,
  GOOGLE_GENAI_PROVIDER,
} from "../googleGenai/googleGenAi.types.js";

import {
  computeGoogleGenAiExpectedCost,
  GoogleGenAiExpectedCostRejectedError,
  type GoogleGenAiExpectedCost,
} from "../googleGenai/googleGenAiExpectedCost.js";

import type {
  CharacterBible,
} from "../schemas/character.schema.js";

import type {
  EpisodeManifest,
  Shot,
} from "../schemas/episodeManifest.schema.js";

import type {
  GoogleGenAiPolicy,
} from "../schemas/googleGenAiPolicy.schema.js";

import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

import type {
  LoadedGoogleGenAiActivationPolicy,
} from "../validation/loadGoogleGenAiActivationPolicy.js";

import type {
  CreateExecutionReservationResult,
} from "./createExecutionReservation.js";

import type {
  CreateExecutionSubmissionResult,
} from "./createExecutionSubmission.js";

import type {
  inspectExecutionLifecycle,
} from "./inspectExecutionLifecycle.js";

import {
  buildGoogleGenAiSingleShotPrompt,
} from "./providers/buildGoogleGenAiSingleShotPrompt.js";

import {
  submitGoogleGenAiSingleShot,
  type GoogleGenAiInteractionCreator,
  type GoogleGenAiSubmissionAcceptance,
} from "./providers/submitGoogleGenAiSingleShot.js";

import type {
  ExecutionReservationCreator,
  ExecutionSubmissionCreator,
  SingleShotVisualReferenceVerifier,
} from "./singleShotExecution.types.js";

/**
 * Default-off, operator-only Google GenAI single-shot execution (B4X).
 *
 * Every deterministic local check runs before the durable reservation is
 * written: shot admission (visual-only, approved, <= the policy duration),
 * the Google-owned prompt, the 720p resolution, the expected-cost cap, the
 * new-submission switch, paid confirmation, credential construction, the
 * absence of any lifecycle record, visual-reference verification and a
 * bounded read of the reference image. Only then is the GOOGLE_GENAI
 * reservation written and exactly one Interaction created. Execution stops
 * at the durable submission; recovery is the separate reconcile action.
 *
 * Failures surface only as GoogleGenAiOperatorError (closed code, stage and
 * state change, static message, no cause). Dependency errors are discarded
 * so no provider/SDK detail can reach operator output. There is no retry,
 * no fallback provider and no override of an existing record.
 */

export { GOOGLE_GENAI_OPERATOR_ERROR_CODES, GOOGLE_GENAI_OPERATOR_STAGES, GOOGLE_GENAI_OPERATOR_RESOLUTION,
  GoogleGenAiOperatorError, type GoogleGenAiOperatorErrorCode, type GoogleGenAiOperatorStage,
  type GoogleGenAiOperatorStateChange } from "./evaluateGoogleGenAiLocalAdmission.js";
import { GOOGLE_GENAI_OPERATOR_RESOLUTION, GoogleGenAiOperatorError, evaluateGoogleGenAiLocalAdmission,
  type GoogleGenAiOperatorErrorCode, type GoogleGenAiOperatorStage } from "./evaluateGoogleGenAiLocalAdmission.js";

// B4U5 section 7 policy set; a subset of the submitter's extension map.
const REFERENCE_IMAGE_MIME_TYPES: Readonly<Record<string, GoogleGenAiReferenceImageMimeType>> =
  Object.freeze({
    ".png":
      "image/png",
    ".jpg":
      "image/jpeg",
    ".jpeg":
      "image/jpeg",
    ".webp":
      "image/webp",
  });

export type GoogleGenAiOperatorPolicies =
  Readonly<{
    activationPolicy:
      LoadedGoogleGenAiActivationPolicy;
    googlePolicy:
      GoogleGenAiPolicy;
  }>;

export type GoogleGenAiOperatorExecuteRequest =
  Readonly<{
    episode:
      EpisodeManifest;
    shotId:
      string;
    bible:
      CharacterBible;
    rules:
      ProductionRules;
    mediaRoot:
      string;
    sourceImagePath:
      string;
    resolution:
      string;
    confirmPaidGeneration:
      boolean;
  }>;

export type GoogleGenAiOperatorExecuteDependencies =
  Readonly<{
    loadPolicies:
      () => Promise<GoogleGenAiOperatorPolicies>;
    prepareSubmission:
      () => Readonly<{
        createInteraction:
          GoogleGenAiInteractionCreator;
      }>;
    inspectLifecycle:
      typeof inspectExecutionLifecycle;
    verifyVisualReference:
      SingleShotVisualReferenceVerifier;
    createReservation:
      ExecutionReservationCreator;
    createSubmission:
      ExecutionSubmissionCreator;
  }>;

export type GoogleGenAiOperatorExecuteResult =
  Readonly<{
    lifecycleState:
      "SUBMITTED";
    episodeId:
      string;
    shotId:
      string;
    provider:
      typeof GOOGLE_GENAI_PROVIDER;
    model:
      typeof GEMINI_OMNI_11_FLASH_MODEL;
    resolution:
      typeof GOOGLE_GENAI_OPERATOR_RESOLUTION;
    expectedMicroUsd:
      number;
    maxExpectedCostMicroUsd:
      number;
    reservationId:
      string;
    reservationPath:
      string;
    providerExecutionId:
      string;
    submissionPath:
      string;
  }>;

function refuse(
  code:
    GoogleGenAiOperatorErrorCode,
  stage:
    GoogleGenAiOperatorStage =
      "ADMISSION",
): GoogleGenAiOperatorError {
  return new GoogleGenAiOperatorError(
    code,
    stage,
    "NONE",
  );
}

async function guarded<T>(
  code:
    GoogleGenAiOperatorErrorCode,
  stage:
    GoogleGenAiOperatorStage,
  action:
    () => T | Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch {
    throw refuse(
      code,
      stage,
    );
  }
}

function selectShot(
  episode:
    EpisodeManifest,
  shotId:
    string,
): Shot {
  const matches =
    episode.scenes.flatMap(
      (scene) =>
        scene.shots.filter(
          (candidate) =>
            candidate.id ===
            shotId,
        ),
    );

  if (
    matches.length ===
    0
  ) {
    throw refuse(
      "SHOT_NOT_FOUND",
    );
  }

  if (
    matches.length >
    1
  ) {
    throw refuse(
      "SHOT_AMBIGUOUS",
    );
  }

  return matches[0]!;
}

function expectedCostOrRefuse(
  policies:
    GoogleGenAiOperatorPolicies,
): GoogleGenAiExpectedCost {
  try {
    return computeGoogleGenAiExpectedCost({
      resolution:
        GOOGLE_GENAI_OPERATOR_RESOLUTION,
      pricing:
        policies.googlePolicy
          .pricing,
      cost:
        policies.activationPolicy
          .cost,
    });
  } catch (error) {
    if (
      error instanceof
      GoogleGenAiExpectedCostRejectedError
    ) {
      switch (error.code) {
        case "RESOLUTION_UNSUPPORTED":
        case "PRICING_UNAVAILABLE":
        case "COST_EXCEEDS_CAP":
          throw refuse(
            error.code,
          );
        default:
          break;
      }
    }

    throw refuse(
      "CALCULATION_FAILED",
    );
  }
}

export async function executeGoogleGenAiOperatorSingleShot(
  request:
    GoogleGenAiOperatorExecuteRequest,
  dependencies:
    GoogleGenAiOperatorExecuteDependencies,
  checkedContext?: CheckedEpisodeExecutionContext,
): Promise<GoogleGenAiOperatorExecuteResult> {
  if (checkedContext) await recheckEpisodeExecutionBindings(checkedContext);
  const episodeId =
    request.episode.episodeId;

  // Step 6: exactly one explicitly selected shot.
  const shot =
    selectShot(
      request.episode,
      request.shotId,
    );

  // Step 7: the activation and pricing policies (strict loaders).
  const policies =
    await guarded(
      "CONFIG_INVALID",
      "LOAD",
      () =>
        dependencies.loadPolicies(),
    );

  // Step 8: visual-only, approved, bounded-duration shot admission.
  await evaluateGoogleGenAiLocalAdmission(
    request,
    shot,
    policies.activationPolicy,
  );

  // Step 9: Google-owned prompt.
  const promptText =
    await guarded(
      "PROMPT_INVALID",
      "ADMISSION",
      () =>
        buildGoogleGenAiSingleShotPrompt(
          shot,
        ),
    );

  // Step 10: the only locally priced resolution.
  if (
    request.resolution !==
    GOOGLE_GENAI_OPERATOR_RESOLUTION
  ) {
    throw refuse(
      "RESOLUTION_UNSUPPORTED",
    );
  }

  // Step 11: expected-cost cap.
  const expectedCost =
    expectedCostOrRefuse(
      policies,
    );

  // Step 12: default-off new-submission switch, before any durable write.
  if (
    policies.activationPolicy
      .admission
      .newSubmissionsEnabled !==
    true
  ) {
    throw refuse(
      "NEW_SUBMISSIONS_DISABLED",
    );
  }

  // Step 13: explicit paid-generation confirmation.
  if (
    request.confirmPaidGeneration !==
    true
  ) {
    throw refuse(
      "CONFIRMATION_REQUIRED",
    );
  }

  // Step 14: credential validation and network-free client construction.
  const prepared =
    await guarded(
      "CREDENTIAL_INVALID",
      "CREDENTIAL",
      () =>
        dependencies.prepareSubmission(),
    );

  // Step 15: no lifecycle record of any provider may exist.
  const lifecycle =
    await guarded(
      "LIFECYCLE_UNREADABLE",
      "LIFECYCLE",
      () =>
        dependencies.inspectLifecycle(
          request.mediaRoot,
          episodeId,
          shot.id,
        ),
    );

  if (
    lifecycle.state !==
    "NOTHING"
  ) {
    throw refuse(
      "LIFECYCLE_EXISTS",
      "LIFECYCLE",
    );
  }

  // Step 16: registered, approved visual reference for this shot.
  const verified =
    await guarded(
      "VISUAL_REFERENCE_UNVERIFIED",
      "REFERENCE",
      () =>
        dependencies.verifyVisualReference({
          mediaRoot:
            request.mediaRoot,
          sourceImagePath:
            request.sourceImagePath,
          approvedAssetIds:
            shot.references
              .assetIds,
        }),
    );

  const sourceImagePath =
    typeof verified?.absolutePath ===
      "string"
      ? verified.absolutePath.trim()
      : "";

  if (!sourceImagePath) {
    throw refuse(
      "VISUAL_REFERENCE_UNVERIFIED",
      "REFERENCE",
    );
  }

  // Step 17: supported extension and bounded, link-safe image read.
  const expectedMimeType =
    REFERENCE_IMAGE_MIME_TYPES[
      extname(
        sourceImagePath,
      ).toLowerCase()
    ];

  if (!expectedMimeType) {
    throw refuse(
      "REFERENCE_IMAGE_UNSUPPORTED",
      "REFERENCE",
    );
  }

  await guarded(
    "REFERENCE_IMAGE_REJECTED",
    "REFERENCE",
    () =>
      readGoogleGenAiReferenceImage({
        mediaRoot:
          request.mediaRoot,
        sourceImagePath,
        expectedMimeType,
        maxBytes:
          policies.activationPolicy
            .limits
            .maxReferenceImageBytes,
      }),
  );

  // R1: the durable GOOGLE_GENAI reservation (exclusive; never replaced).
  let reservation:
    CreateExecutionReservationResult;

  try {
    reservation =
      await dependencies.createReservation(
        request.mediaRoot,
        {
          episodeId,
          shotId:
            shot.id,
          provider:
            GOOGLE_GENAI_PROVIDER,
        },
      );
  } catch {
    throw new GoogleGenAiOperatorError(
      "RESERVATION_FAILED",
      "RESERVATION",
      "UNKNOWN",
    );
  }

  // R2: exactly one create, then the durable submission.
  let createAttempted =
    false;

  let acceptanceReceived =
    false;

  const durableSubmission: {
    result:
      CreateExecutionSubmissionResult | null;
  } = {
    result:
      null,
  };

  const createInteraction:
    GoogleGenAiInteractionCreator =
    async (
      interactionRequest,
    ) => {
      if (checkedContext) {
        await recheckEpisodeExecutionBindings(checkedContext);
        const action = checkedEpisodeExecutionData(checkedContext).plan.actions[0];
        if (action.kind !== "VISUAL_GENERATE" || action.resolvedProvider !== "GOOGLE_GENAI" ||
            rawSha256(Buffer.from(interactionRequest.input[1].data, "base64")) !== action.referenceBinding.sha256) {
          throw new BoundEpisodeError("REFERENCE_DRIFT");
        }
      }
      if (createAttempted) {
        throw new Error(
          "Google GenAI operator runner allows at most one create per invocation.",
        );
      }

      createAttempted =
        true;

      return prepared.createInteraction(
        interactionRequest,
      );
    };

  const onSubmissionAccepted =
    async (
      acceptance:
        GoogleGenAiSubmissionAcceptance,
    ): Promise<void> => {
      if (acceptanceReceived) {
        throw new Error(
          "Google GenAI submission acceptance was reported more than once.",
        );
      }

      acceptanceReceived =
        true;

      if (
        acceptance.provider !==
        GOOGLE_GENAI_PROVIDER
      ) {
        throw new Error(
          "Google GenAI submission acceptance reported another provider.",
        );
      }

      durableSubmission.result =
        await dependencies.createSubmission(
          request.mediaRoot,
          {
            reservationId:
              reservation.record
                .reservationId,
            episodeId,
            shotId:
              shot.id,
            provider:
              GOOGLE_GENAI_PROVIDER,
            providerExecutionId:
              acceptance.providerExecutionId,
            recoveryMetadata:
              acceptance.recoveryMetadata,
          },
        );
    };

  let providerExecutionId:
    string;

  try {
    const result =
      await submitGoogleGenAiSingleShot(
        {
          mediaRoot:
            request.mediaRoot,
          episodeId,
          shotId:
            shot.id,
          reservation:
            reservation.record,
          sourceImagePath,
          promptText,
          policySnapshot:
            policies.googlePolicy,
          activationPolicy:
            policies.activationPolicy,
          resolution:
            expectedCost.resolution,
          onSubmissionAccepted,
        },
        {
          createInteraction,
        },
      );

    providerExecutionId =
      result.providerExecutionId;
  } catch {
    if (!createAttempted) {
      throw new GoogleGenAiOperatorError(
        "SUBMISSION_REFUSED_BEFORE_PROVIDER_CALL",
        "SUBMISSION",
        "RESERVED_ONLY",
      );
    }

    if (!acceptanceReceived) {
      throw new GoogleGenAiOperatorError(
        "SUBMISSION_ACCEPTANCE_UNCERTAIN",
        "SUBMISSION",
        "RESERVED_ONLY",
      );
    }

    throw new GoogleGenAiOperatorError(
      "DURABLE_SUBMISSION_FAILED",
      "SUBMISSION",
      "UNKNOWN",
    );
  }

  const durable =
    durableSubmission.result;

  if (
    !durable ||
    durable.record.provider !==
      GOOGLE_GENAI_PROVIDER ||
    durable.record.providerExecutionId !==
      providerExecutionId ||
    durable.record.reservationId !==
      reservation.record.reservationId
  ) {
    throw new GoogleGenAiOperatorError(
      "DURABLE_SUBMISSION_FAILED",
      "SUBMISSION",
      "UNKNOWN",
    );
  }

  return Object.freeze({
    lifecycleState:
      "SUBMITTED",
    episodeId,
    shotId:
      shot.id,
    provider:
      GOOGLE_GENAI_PROVIDER,
    model:
      GEMINI_OMNI_11_FLASH_MODEL,
    resolution:
      GOOGLE_GENAI_OPERATOR_RESOLUTION,
    expectedMicroUsd:
      expectedCost.expectedMicroUsd,
    maxExpectedCostMicroUsd:
      expectedCost.maxExpectedCostMicroUsd,
    reservationId:
      reservation.record
        .reservationId,
    reservationPath:
      reservation.reservationPath,
    providerExecutionId,
    submissionPath:
      durable.submissionPath,
  });
}
