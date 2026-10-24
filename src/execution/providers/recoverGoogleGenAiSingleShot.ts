import {
  GOOGLE_GENAI_PROVIDER,
} from "../../googleGenai/googleGenAi.types.js";

import {
  GOOGLE_GENAI_INTERACTION_STATUSES,
  classifyGoogleGenAiInteractionStatus,
  normalizeGoogleGenAiProviderExecutionId,
  type GoogleGenAiInteractionLifecycleClass,
  type GoogleGenAiInteractionStatus,
} from "../../googleGenai/googleGenAiInteractionContract.js";

import {
  readExecutionSubmission,
} from "../readExecutionSubmission.js";

/**
 * Dormant Google GenAI same-ID recovery adapter.
 *
 * Reads the durable execution submission, looks up exactly that Google
 * Interaction.id once through the injected getter, verifies the returned
 * id, and classifies the remote status with the existing Google lifecycle
 * contract. It never creates, resubmits, retries, completes, reconciles,
 * downloads output, or writes anything durably.
 */

export type GoogleGenAiObservedInteraction =
  Readonly<{
    id:
      unknown;

    status:
      unknown;
  }>;

export type GoogleGenAiInteractionGetter =
  (
    providerExecutionId:
      string,
  ) =>
    Promise<
      GoogleGenAiObservedInteraction
    >;

export type GoogleGenAiSingleShotRecoveryInput =
  Readonly<{
    mediaRoot:
      string;

    episodeId:
      string;

    shotId:
      string;
  }>;

export type GoogleGenAiSingleShotRecoveryDependencies =
  Readonly<{
    getInteraction:
      GoogleGenAiInteractionGetter;
  }>;

export type GoogleGenAiRecoveredLifecycleClass =
  Exclude<
    GoogleGenAiInteractionLifecycleClass,
    "ACTION_REQUIRED_UNSUPPORTED"
  >;

export type GoogleGenAiSingleShotRecoveryResult =
  Readonly<{
    provider:
      typeof GOOGLE_GENAI_PROVIDER;

    providerExecutionId:
      string;

    remoteStatus:
      GoogleGenAiInteractionStatus;

    lifecycleClass:
      GoogleGenAiRecoveredLifecycleClass;
  }>;

const FORBIDDEN_CALLER_IDENTIFIER_FIELDS =
  Object.freeze([
    "providerExecutionId",
    "interactionId",
  ]);

export async function recoverGoogleGenAiSingleShot(
  input:
    GoogleGenAiSingleShotRecoveryInput,

  dependencies:
    GoogleGenAiSingleShotRecoveryDependencies,
): Promise<
  GoogleGenAiSingleShotRecoveryResult
> {
  for (
    const field of FORBIDDEN_CALLER_IDENTIFIER_FIELDS
  ) {
    if (
      Object.hasOwn(
        input,
        field,
      )
    ) {
      throw new Error(
        `Google GenAI recovery does not accept a caller-supplied ${field}; the durable execution submission is authoritative.`,
      );
    }
  }

  const submission =
    await readExecutionSubmission(
      input.mediaRoot,
      input.episodeId,
      input.shotId,
    );

  if (!submission) {
    throw new Error(
      `Google GenAI recovery requires a durable execution submission for ${input.episodeId}/${input.shotId}.`,
    );
  }

  if (
    submission.provider !==
    GOOGLE_GENAI_PROVIDER
  ) {
    throw new Error(
      `Google GenAI recovery requires a ${GOOGLE_GENAI_PROVIDER} execution submission; received ${submission.provider}.`,
    );
  }

  if (
    Object.hasOwn(
      submission,
      "interactionId",
    )
  ) {
    throw new Error(
      "Google GenAI execution submission must not carry a separate interactionId.",
    );
  }

  const providerExecutionId =
    submission.providerExecutionId;

  if (!providerExecutionId.trim()) {
    throw new Error(
      "Google GenAI execution submission has an empty providerExecutionId.",
    );
  }

  const interaction =
    await dependencies
      .getInteraction(
        providerExecutionId,
      );

  normalizeGoogleGenAiProviderExecutionId(
    interaction,
  );

  if (
    interaction.id !==
    providerExecutionId
  ) {
    throw new Error(
      `Google GenAI recovery returned interaction ${JSON.stringify(interaction.id)}, which does not match durable providerExecutionId ${JSON.stringify(providerExecutionId)}.`,
    );
  }

  const lifecycleClass =
    classifyGoogleGenAiInteractionStatus(
      interaction.status,
    );

  if (
    lifecycleClass ===
    "ACTION_REQUIRED_UNSUPPORTED"
  ) {
    throw new Error(
      `Google GenAI interaction ${providerExecutionId} requires client action, which Busybookie does not support. Operator review is required.`,
    );
  }

  const remoteStatus =
    GOOGLE_GENAI_INTERACTION_STATUSES.find(
      (status) =>
        status ===
        interaction.status,
    );

  if (remoteStatus === undefined) {
    throw new Error(
      `Google GenAI interaction status is not recognized: ${JSON.stringify(interaction.status)}.`,
    );
  }

  return Object.freeze({
    provider:
      GOOGLE_GENAI_PROVIDER,

    providerExecutionId,

    remoteStatus,

    lifecycleClass,
  });
}
