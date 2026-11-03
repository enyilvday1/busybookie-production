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
  submitGoogleGenAiSingleShotFromReservationIdentity,
  type GoogleGenAiInteractionCreator,
  type GoogleGenAiSubmissionAcceptance,
} from "./providers/submitGoogleGenAiSingleShot.js";

import type {
  ExecutionReservationCreator,
  ExecutionSubmissionCreator,
  SingleShotVisualReferenceVerifier,
} from "./singleShotExecution.types.js";

import type {
  createVisualAttemptExecutionReservation,
  CreateVisualAttemptExecutionReservationResult,
} from "./createVisualAttemptExecutionReservation.js";

import type {
  createVisualAttemptExecutionSubmission,
  CreateVisualAttemptExecutionSubmissionResult,
} from "./createVisualAttemptExecutionSubmission.js";

import type {
  inspectVisualAttemptExecutionLifecycle,
} from "./inspectVisualAttemptExecutionLifecycle.js";

import {
  VisualReplacementAttemptNumberSchema,
} from "./visualAttemptNumber.schema.js";

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

// B5 Slice-2H-B: attempt-mode surface. The request is the normal single-shot
// input plus attemptNumber; every durable lineage identity comes only from
// durable evidence or the accepted Google interaction, never from the caller.
type CallerSuppliedLineageForbidden =
  Readonly<{
    admissionId?:
      never;
    admissionSha256?:
      never;
    reservationId?:
      never;
    reservationSha256?:
      never;
    providerExecutionId?:
      never;
    submissionPath?:
      never;
    submissionSha256?:
      never;
  }>;

const CALLER_SUPPLIED_LINEAGE_FIELDS =
  Object.freeze([
    "admissionId",
    "admissionSha256",
    "reservationId",
    "reservationSha256",
    "providerExecutionId",
    "submissionPath",
    "submissionSha256",
  ] as const);

export type GoogleGenAiVisualAttemptExecuteRequest =
  GoogleGenAiOperatorExecuteRequest &
  CallerSuppliedLineageForbidden &
  Readonly<{
    attemptNumber:
      number;
  }>;

export type GoogleGenAiVisualAttemptExecuteDependencies =
  Readonly<{
    loadPolicies:
      () => Promise<GoogleGenAiOperatorPolicies>;
    prepareSubmission:
      () => Readonly<{
        createInteraction:
          GoogleGenAiInteractionCreator;
      }>;
    inspectVisualAttemptLifecycle:
      typeof inspectVisualAttemptExecutionLifecycle;
    verifyVisualReference:
      SingleShotVisualReferenceVerifier;
    createVisualAttemptReservation:
      typeof createVisualAttemptExecutionReservation;
    createVisualAttemptSubmission:
      typeof createVisualAttemptExecutionSubmission;
  }>;

export type GoogleGenAiVisualAttemptExecuteResult =
  Readonly<
    GoogleGenAiOperatorExecuteResult & {
      sceneId:
        string;
      attemptNumber:
        number;
      admissionId:
        string;
      admissionSha256:
        string;
      reservationSha256:
        string;
      submissionSha256:
        string;
    }
  >;

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

type AdmittedGoogleGenAiOperatorShot =
  Readonly<{
    episodeId:
      string;
    shot:
      Shot;
    policies:
      GoogleGenAiOperatorPolicies;
    promptText:
      string;
    expectedCost:
      GoogleGenAiExpectedCost;
    prepared:
      Readonly<{
        createInteraction:
          GoogleGenAiInteractionCreator;
      }>;
  }>;

// Steps 6-14, shared by the legacy and the attempt-mode entrypoints.
async function admitGoogleGenAiOperatorShot(
  request:
    GoogleGenAiOperatorExecuteRequest,
  dependencies:
    Pick<
      GoogleGenAiOperatorExecuteDependencies,
      "loadPolicies" | "prepareSubmission"
    >,
): Promise<AdmittedGoogleGenAiOperatorShot> {
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

  return {
    episodeId,
    shot,
    policies,
    promptText,
    expectedCost,
    prepared,
  };
}

// Steps 16-17, shared by the legacy and the attempt-mode entrypoints.
async function readVerifiedGoogleGenAiOperatorReference(
  request:
    GoogleGenAiOperatorExecuteRequest,
  shot:
    Shot,
  policies:
    GoogleGenAiOperatorPolicies,
  verifyVisualReference:
    SingleShotVisualReferenceVerifier,
): Promise<Readonly<{ sourceImagePath: string; bytes: Buffer }>> {
  // Step 16: registered, approved visual reference for this shot.
  const verified =
    await guarded(
      "VISUAL_REFERENCE_UNVERIFIED",
      "REFERENCE",
      () =>
        verifyVisualReference({
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

  const referenceImage =
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

  return {
    sourceImagePath,
    bytes:
      referenceImage.bytes,
  };
}

export async function executeGoogleGenAiOperatorSingleShot(
  request:
    GoogleGenAiOperatorExecuteRequest,
  dependencies:
    GoogleGenAiOperatorExecuteDependencies,
  checkedContext?: CheckedEpisodeExecutionContext,
): Promise<GoogleGenAiOperatorExecuteResult> {
  if (checkedContext) await recheckEpisodeExecutionBindings(checkedContext);

  // Steps 6-14.
  const {
    episodeId,
    shot,
    policies,
    promptText,
    expectedCost,
    prepared,
  } =
    await admitGoogleGenAiOperatorShot(
      request,
      dependencies,
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

  // Steps 16-17.
  const {
    sourceImagePath,
  } =
    await readVerifiedGoogleGenAiOperatorReference(
      request,
      shot,
      policies,
      dependencies.verifyVisualReference,
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

function requireReplacementAttemptNumber(
  request:
    GoogleGenAiVisualAttemptExecuteRequest,
): number {
  for (const field of CALLER_SUPPLIED_LINEAGE_FIELDS) {
    if (
      field in
      request
    ) {
      throw refuse(
        "USAGE_INVALID",
        "ARGS",
      );
    }
  }

  const attemptNumber =
    VisualReplacementAttemptNumberSchema
      .safeParse(
        request.attemptNumber,
      );

  if (!attemptNumber.success) {
    throw refuse(
      "USAGE_INVALID",
      "ARGS",
    );
  }

  return attemptNumber.data;
}

function selectSceneId(
  episode:
    EpisodeManifest,
  shot:
    Shot,
): string {
  const scenes =
    episode.scenes.filter(
      (scene) =>
        scene.shots.includes(
          shot,
        ),
    );

  if (
    scenes.length !==
    1
  ) {
    throw refuse(
      "SHOT_AMBIGUOUS",
    );
  }

  return scenes[0]!.id;
}

const MANIFEST_RAW_SHA256_PATTERN =
  /^[a-f0-9]{64}$/;

// R37D: the process-local checked execution context is the attempt-mode
// execution authority. An unissued context fails closed inside
// checkedEpisodeExecutionData (OPERATING_CONDITION_UNESTABLISHED).
function requireCheckedAttemptAuthority(
  checkedContext:
    CheckedEpisodeExecutionContext,
  request:
    GoogleGenAiVisualAttemptExecuteRequest,
  episodeId:
    string,
): void {
  const data =
    checkedEpisodeExecutionData(
      checkedContext,
    );

  if (
    data.plan.episodeId !==
      episodeId ||
    data.plan.inputBinding
      .runtimeIdentity
      .mediaRoot !==
      request.mediaRoot
  ) {
    throw new BoundEpisodeError(
      "INPUT_BINDING_DRIFT",
    );
  }
}

// R37D: the currently bound raw manifest must be the admitted manifest.
// The parsed request episode is never manifest authority.
async function requireAdmittedManifestBinding(
  checkedContext:
    CheckedEpisodeExecutionContext,
  request:
    GoogleGenAiVisualAttemptExecuteRequest,
  episodeId:
    string,
  admittedManifestRawSha256:
    string,
): Promise<void> {
  requireCheckedAttemptAuthority(
    checkedContext,
    request,
    episodeId,
  );

  await recheckEpisodeExecutionBindings(
    checkedContext,
  );

  const manifests =
    checkedEpisodeExecutionData(
      checkedContext,
    ).plan.inputBinding.fileBindings.filter(
      (file) =>
        file.role ===
        "MANIFEST",
    );

  if (
    manifests.length !==
    1
  ) {
    throw new BoundEpisodeError(
      "INPUT_BINDING_DRIFT",
    );
  }

  const manifest =
    manifests[0]!;

  if (
    manifest.exists !==
      true ||
    typeof manifest.rawSha256 !==
      "string" ||
    !MANIFEST_RAW_SHA256_PATTERN.test(
      manifest.rawSha256,
    ) ||
    manifest.rawSha256 !==
      admittedManifestRawSha256
  ) {
    throw new BoundEpisodeError(
      "INPUT_BINDING_DRIFT",
    );
  }
}

/**
 * B5 Slice-2H-B attempt-mode Google single-shot execution (R36E sections
 * 10-14). Dormant: no CLI, routing, automation or composition module reaches
 * it.
 *
 * The same deterministic local admission as the legacy runner runs first.
 * The attempt lifecycle authority is inspectVisualAttemptExecutionLifecycle,
 * and ADMITTED_ONLY is the only state that may create a provider job. The
 * effective prompt text and the exact verified reference bytes must hash to
 * the durable admission identities before the attempt reservation, and again
 * immediately before the single create. A required checked execution
 * context (R37D) binds the raw manifest: its single MANIFEST binding must
 * equal the admitted manifestRawSha256 before the reservation, and the
 * bound inputs are rechecked again before the create. The accepted interaction is
 * persisted only through createVisualAttemptExecutionSubmission, which owns
 * the global providerExecutionId claim. Execution stops at SUBMITTED; the
 * operator writes no completion, never retries and never falls back.
 */
export async function executeGoogleGenAiVisualAttemptSingleShot(
  request:
    GoogleGenAiVisualAttemptExecuteRequest,
  dependencies:
    GoogleGenAiVisualAttemptExecuteDependencies,
  checkedContext:
    CheckedEpisodeExecutionContext,
): Promise<GoogleGenAiVisualAttemptExecuteResult> {
  // A0: attempt-mode request surface (attemptNumber >= 2, no caller lineage).
  const attemptNumber =
    requireReplacementAttemptNumber(
      request,
    );

  // C0: issued checked context for this episode and media root (no I/O).
  requireCheckedAttemptAuthority(
    checkedContext,
    request,
    request.episode.episodeId,
  );

  // Steps 6-14: policies, local admission, switch, paid confirmation, credential.
  const {
    episodeId,
    shot,
    policies,
    promptText,
    expectedCost,
    prepared,
  } =
    await admitGoogleGenAiOperatorShot(
      request,
      dependencies,
    );

  const sceneId =
    selectSceneId(
      request.episode,
      shot,
    );

  // A1: the attempt lifecycle authority; only ADMITTED_ONLY may proceed.
  const lifecycle =
    await guarded(
      "LIFECYCLE_UNREADABLE",
      "LIFECYCLE",
      () =>
        dependencies.inspectVisualAttemptLifecycle(
          request.mediaRoot,
          episodeId,
          shot.id,
          attemptNumber,
        ),
    );

  if (
    lifecycle.state ===
    "NOT_ADMITTED"
  ) {
    throw refuse(
      "NO_LIFECYCLE",
      "LIFECYCLE",
    );
  }

  if (
    lifecycle.state ===
      "RESERVED_ONLY" ||
    lifecycle.state ===
      "SUBMITTED" ||
    lifecycle.state ===
      "COMPLETED"
  ) {
    throw refuse(
      "LIFECYCLE_EXISTS",
      "LIFECYCLE",
    );
  }

  if (
    lifecycle.state !==
    "ADMITTED_ONLY"
  ) {
    throw refuse(
      "LIFECYCLE_INVALID",
      "LIFECYCLE",
    );
  }

  // A2: the durable admission, not the caller, is the identity authority.
  const admission =
    lifecycle.admission;

  if (
    lifecycle.provider !==
      GOOGLE_GENAI_PROVIDER ||
    admission.record.provider !==
      GOOGLE_GENAI_PROVIDER ||
    lifecycle.admissionId !==
      admission.record.admissionId ||
    lifecycle.episodeId !==
      episodeId ||
    admission.record.episodeId !==
      episodeId ||
    lifecycle.sceneId !==
      sceneId ||
    admission.record.sceneId !==
      sceneId ||
    lifecycle.shotId !==
      shot.id ||
    admission.record.shotId !==
      shot.id ||
    lifecycle.attemptNumber !==
      attemptNumber ||
    admission.record.attemptNumber !==
      attemptNumber
  ) {
    throw refuse(
      "LIFECYCLE_INVALID",
      "LIFECYCLE",
    );
  }

  // A3: the effective prompt text must be the admitted prompt identity.
  if (
    rawSha256(promptText) !==
    admission.record.promptIdentitySha256
  ) {
    throw refuse(
      "PROMPT_INVALID",
    );
  }

  // Steps 16-17, then A4: the verified reference bytes must be the admitted reference identity.
  const reference =
    await readVerifiedGoogleGenAiOperatorReference(
      request,
      shot,
      policies,
      dependencies.verifyVisualReference,
    );

  if (
    rawSha256(reference.bytes) !==
    admission.record.referenceIdentitySha256
  ) {
    throw refuse(
      "REFERENCE_IMAGE_REJECTED",
      "REFERENCE",
    );
  }

  // C1: recheck every bound input; the single bound MANIFEST is the admitted manifest.
  await requireAdmittedManifestBinding(
    checkedContext,
    request,
    episodeId,
    admission.record.manifestRawSha256,
  );

  // R1: the durable attempt-aware reservation (exclusive; never replaced).
  let reservation:
    CreateVisualAttemptExecutionReservationResult;

  try {
    reservation =
      await dependencies.createVisualAttemptReservation(
        request.mediaRoot,
        {
          episodeId,
          sceneId,
          shotId:
            shot.id,
          attemptNumber,
          provider:
            GOOGLE_GENAI_PROVIDER,
          expectedAdmissionId:
            admission.record.admissionId,
          expectedAdmissionSha256:
            admission.admissionSha256,
        },
      );
  } catch {
    throw new GoogleGenAiOperatorError(
      "RESERVATION_FAILED",
      "RESERVATION",
      "UNKNOWN",
    );
  }

  // R2: exactly one create, then the durable attempt submission.
  let createAttempted =
    false;

  let acceptanceReceived =
    false;

  const durableSubmission: {
    result:
      CreateVisualAttemptExecutionSubmissionResult | null;
  } = {
    result:
      null,
  };

  const createInteraction:
    GoogleGenAiInteractionCreator =
    async (
      interactionRequest,
    ) => {
      if (createAttempted) {
        throw new Error(
          "Google GenAI attempt operator allows at most one create per invocation.",
        );
      }

      // C2: bound inputs (including the admitted MANIFEST) unchanged since C1.
      await requireAdmittedManifestBinding(
        checkedContext,
        request,
        episodeId,
        admission.record.manifestRawSha256,
      );

      // The exact irreversible inputs must still be the admitted identities.
      if (
        rawSha256(interactionRequest.input[0].text) !==
          admission.record.promptIdentitySha256 ||
        rawSha256(Buffer.from(interactionRequest.input[1].data, "base64")) !==
          admission.record.referenceIdentitySha256
      ) {
        throw new Error(
          "Google GenAI attempt request no longer matches the admitted prompt/reference identity.",
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
        await dependencies.createVisualAttemptSubmission(
          request.mediaRoot,
          {
            episodeId,
            sceneId,
            shotId:
              shot.id,
            attemptNumber,
            expectedAdmissionId:
              admission.record.admissionId,
            expectedAdmissionSha256:
              admission.admissionSha256,
            expectedReservationId:
              reservation.record.reservationId,
            expectedReservationSha256:
              reservation.reservationSha256,
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
      await submitGoogleGenAiSingleShotFromReservationIdentity(
        {
          mediaRoot:
            request.mediaRoot,
          episodeId,
          shotId:
            shot.id,
          reservationIdentity: {
            reservationId:
              reservation.record.reservationId,
            episodeId:
              reservation.record.episodeId,
            shotId:
              reservation.record.shotId,
            provider:
              GOOGLE_GENAI_PROVIDER,
          },
          sourceImagePath:
            reference.sourceImagePath,
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
      reservation.record.reservationId ||
    durable.record.reservationSha256 !==
      reservation.reservationSha256 ||
    durable.record.admissionId !==
      admission.record.admissionId ||
    durable.record.admissionSha256 !==
      admission.admissionSha256 ||
    durable.record.attemptNumber !==
      attemptNumber
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
    sceneId,
    shotId:
      shot.id,
    attemptNumber,
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
    admissionId:
      admission.record.admissionId,
    admissionSha256:
      admission.admissionSha256,
    reservationId:
      reservation.record.reservationId,
    reservationPath:
      reservation.reservationPath,
    reservationSha256:
      reservation.reservationSha256,
    providerExecutionId,
    submissionPath:
      durable.submissionPath,
    submissionSha256:
      durable.submissionSha256,
  });
}
