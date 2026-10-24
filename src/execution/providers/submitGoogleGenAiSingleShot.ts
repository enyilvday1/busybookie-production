import {
  readFile,
} from "node:fs/promises";

import {
  extname,
} from "node:path";

import {
  GEMINI_OMNI_11_FLASH_MODEL,
  GOOGLE_GENAI_PROVIDER,
} from "../../googleGenai/googleGenAi.types.js";

import {
  GoogleGenAiPolicySchema,
} from "../../schemas/googleGenAiPolicy.schema.js";

import {
  ExecutionReservationSchema,
} from "../executionReservation.schema.js";

import {
  ExecutionSubmissionInputSchema,
  type ExecutionSubmissionInput,
} from "../executionSubmission.schema.js";

import {
  assertReferenceImageInsideRoot,
} from "./referenceImagePath.js";

/**
 * Dormant Google GenAI single-shot submission adapter.
 *
 * Creates exactly one Google Interaction, then hands the provider-assigned
 * Interaction.id and recovery metadata to the durable acceptance callback.
 * It never polls, retrieves output, completes, reconciles, retries, or
 * falls back to another provider. The Google client is injected; this
 * module constructs no client and reads no credentials.
 */

const GOOGLE_GENAI_IMAGE_MIME_TYPES =
  Object.freeze({
    ".png":
      "image/png",

    ".jpg":
      "image/jpeg",

    ".jpeg":
      "image/jpeg",

    ".webp":
      "image/webp",

    ".heic":
      "image/heic",

    ".heif":
      "image/heif",

    ".gif":
      "image/gif",

    ".bmp":
      "image/bmp",

    ".tif":
      "image/tiff",

    ".tiff":
      "image/tiff",
  });

export type GoogleGenAiSingleShotImageMimeType =
  typeof GOOGLE_GENAI_IMAGE_MIME_TYPES[
    keyof typeof GOOGLE_GENAI_IMAGE_MIME_TYPES
  ];

export type GoogleGenAiSingleShotTextInput =
  Readonly<{
    type:
      "text";

    text:
      string;
  }>;

export type GoogleGenAiSingleShotImageInput =
  Readonly<{
    type:
      "image";

    data:
      string;

    mime_type:
      GoogleGenAiSingleShotImageMimeType;
  }>;

export type GoogleGenAiSingleShotInteractionRequest =
  Readonly<{
    model:
      typeof GEMINI_OMNI_11_FLASH_MODEL;

    input: [
      GoogleGenAiSingleShotTextInput,
      GoogleGenAiSingleShotImageInput,
    ];

    background:
      true;

    store:
      true;

    stream:
      false;
  }>;

export type GoogleGenAiCreatedInteraction =
  Readonly<{
    id:
      unknown;
  }>;

export type GoogleGenAiInteractionCreator =
  (
    request:
      GoogleGenAiSingleShotInteractionRequest,
  ) =>
    Promise<
      GoogleGenAiCreatedInteraction
    >;

type GoogleGenAiExecutionSubmissionInput =
  Extract<
    ExecutionSubmissionInput,
    { provider: typeof GOOGLE_GENAI_PROVIDER }
  >;

export type GoogleGenAiSubmissionRecoveryMetadata =
  GoogleGenAiExecutionSubmissionInput[
    "recoveryMetadata"
  ];

export type GoogleGenAiSubmissionAcceptance =
  Readonly<{
    provider:
      typeof GOOGLE_GENAI_PROVIDER;

    providerExecutionId:
      string;

    recoveryMetadata:
      GoogleGenAiSubmissionRecoveryMetadata;
  }>;

export type GoogleGenAiSubmissionAcceptedHandler =
  (
    acceptance:
      GoogleGenAiSubmissionAcceptance,
  ) =>
    Promise<void>;

export type GoogleGenAiSingleShotSubmissionInput =
  Readonly<{
    mediaRoot:
      string;

    episodeId:
      string;

    shotId:
      string;

    reservation:
      unknown;

    sourceImagePath:
      string;

    promptText:
      string;

    policySnapshot:
      unknown;

    onSubmissionAccepted:
      GoogleGenAiSubmissionAcceptedHandler;
  }>;

export type GoogleGenAiSingleShotSubmissionDependencies =
  Readonly<{
    createInteraction:
      GoogleGenAiInteractionCreator;
  }>;

export type GoogleGenAiSingleShotSubmissionResult =
  Readonly<{
    providerExecutionId:
      string;
  }>;

function requireGoogleGenAiImageMimeType(
  sourceImagePath:
    string,
): GoogleGenAiSingleShotImageMimeType {
  const extension =
    extname(
      sourceImagePath,
    ).toLowerCase();

  switch (extension) {
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".webp":
    case ".heic":
    case ".heif":
    case ".gif":
    case ".bmp":
    case ".tif":
    case ".tiff":
      return GOOGLE_GENAI_IMAGE_MIME_TYPES[
        extension
      ];

    default:
      throw new Error(
        `Google GenAI reference image extension is not supported: ${extension || "(none)"}.`,
      );
  }
}

function requirePromptText(
  promptText:
    string,
): string {
  const normalized =
    promptText.trim();

  if (!normalized) {
    throw new Error(
      "Google GenAI prompt text is required.",
    );
  }

  return normalized;
}

function requireInteractionId(
  interaction:
    GoogleGenAiCreatedInteraction,
): string {
  const id =
    interaction.id;

  if (
    typeof id !==
      "string" ||
    !id.trim()
  ) {
    throw new Error(
      "Google GenAI returned an empty Interaction.id.",
    );
  }

  return id;
}

export async function submitGoogleGenAiSingleShot(
  input:
    GoogleGenAiSingleShotSubmissionInput,

  dependencies:
    GoogleGenAiSingleShotSubmissionDependencies,
): Promise<
  GoogleGenAiSingleShotSubmissionResult
> {
  const reservation =
    ExecutionReservationSchema
      .parse(
        input.reservation,
      );

  if (
    reservation.provider !==
    GOOGLE_GENAI_PROVIDER
  ) {
    throw new Error(
      `Execution reservation must belong to ${GOOGLE_GENAI_PROVIDER}; received ${reservation.provider}.`,
    );
  }

  if (
    reservation.episodeId !==
      input.episodeId ||
    reservation.shotId !==
      input.shotId
  ) {
    throw new Error(
      `Execution reservation ${reservation.episodeId}/${reservation.shotId} does not match requested shot ${input.episodeId}/${input.shotId}.`,
    );
  }

  const policySnapshot =
    GoogleGenAiPolicySchema
      .parse(
        input.policySnapshot,
      );

  const promptText =
    requirePromptText(
      input.promptText,
    );

  const sourceImagePath =
    assertReferenceImageInsideRoot(
      input.mediaRoot,
      input.sourceImagePath,
    );

  const mimeType =
    requireGoogleGenAiImageMimeType(
      sourceImagePath,
    );

  const imageBytes =
    await readFile(
      sourceImagePath,
    );

  const recoveryMetadata:
    GoogleGenAiSubmissionRecoveryMetadata =
    Object.freeze({
      request:
        Object.freeze({
          model:
            GEMINI_OMNI_11_FLASH_MODEL,

          background:
            true,

          store:
            true,

          stream:
            false,

          promptText,

          sourceImagePath,
        }),

      policySnapshot,
    });

  const request:
    GoogleGenAiSingleShotInteractionRequest =
    {
      model:
        GEMINI_OMNI_11_FLASH_MODEL,

      input: [
        {
          type:
            "text",

          text:
            promptText,
        },
        {
          type:
            "image",

          data:
            imageBytes.toString(
              "base64",
            ),

          mime_type:
            mimeType,
        },
      ],

      background:
        true,

      store:
        true,

      stream:
        false,
    };

  const interaction =
    await dependencies
      .createInteraction(
        request,
      );

  const providerExecutionId =
    requireInteractionId(
      interaction,
    );

  try {
    ExecutionSubmissionInputSchema
      .parse({
        reservationId:
          reservation.reservationId,

        episodeId:
          reservation.episodeId,

        shotId:
          reservation.shotId,

        provider:
          GOOGLE_GENAI_PROVIDER,

        providerExecutionId,

        recoveryMetadata,
      });

    await input.onSubmissionAccepted({
      provider:
        GOOGLE_GENAI_PROVIDER,

      providerExecutionId,

      recoveryMetadata,
    });
  } catch (error) {
    throw new Error(
      `Google GenAI accepted paid interaction ${providerExecutionId}, but Busybookie could not durably record the submission. Do not resubmit automatically.`,
      {
        cause:
          error,
      },
    );
  }

  return Object.freeze({
    providerExecutionId,
  });
}
