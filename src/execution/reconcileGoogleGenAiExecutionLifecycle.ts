import type {
  GoogleGenAiGenerationRecord,
} from "../googleGenai/audit/googleGenAiGenerationRecord.schema.js";

import {
  GOOGLE_GENAI_PROVIDER,
} from "../googleGenai/googleGenAi.types.js";

import type {
  GoogleGenAiExecutionCompletion,
} from "./googleGenAiExecutionCompletion.schema.js";

import {
  inspectGoogleGenAiExecutionLifecycle,
} from "./inspectGoogleGenAiExecutionLifecycle.js";

import {
  materializeGoogleGenAiSingleShotOutput,
  type GoogleGenAiOutputFileSystem,
  type GoogleGenAiOutputRetriever,
  type GoogleGenAiOutputUriDownloader,
} from "./providers/materializeGoogleGenAiSingleShotOutput.js";

import {
  persistGoogleGenAiSingleShotCompletion,
  type GoogleGenAiCompletionFileSystem,
} from "./providers/persistGoogleGenAiSingleShotCompletion.js";

import {
  recoverGoogleGenAiSingleShot,
  type GoogleGenAiInteractionGetter,
} from "./providers/recoverGoogleGenAiSingleShot.js";

import {
  verifyGoogleGenAiDurableCompletion,
  type GoogleGenAiDurableCompletionVerification,
} from "./verifyGoogleGenAiDurableCompletion.js";

/**
 * Dormant Google GenAI lifecycle reconciliation.
 *
 * A Google-specific reconciler kept apart from the shared lifecycle
 * reconciler and its result union. COMPLETED is verified offline with no
 * provider calls and no writes. SUBMITTED performs same-ID recovery, and
 * only a remote SUCCESS proceeds through output materialization, durable
 * persistence, and a fresh durable verification. Pending, terminal,
 * action-required, and unknown remote states throw. It never creates or
 * resubmits an interaction and never switches provider.
 */

export type GoogleGenAiExecutionLifecycleReconciliationInput =
  Readonly<{
    mediaRoot:
      string;

    episodeId:
      string;

    shotId:
      string;
  }>;

export type GoogleGenAiSubmittedRecoveryDependencies =
  Readonly<{
    getInteraction:
      GoogleGenAiInteractionGetter;

    retrieveOutput:
      GoogleGenAiOutputRetriever;

    downloadUri:
      GoogleGenAiOutputUriDownloader;

    maxOutputBytes:
      number;

    now?:
      () => string;

    outputFileSystem?:
      GoogleGenAiOutputFileSystem;

    completionFileSystem?:
      GoogleGenAiCompletionFileSystem;
  }>;

export type GoogleGenAiExecutionLifecycleReconciliationDependencies =
  Readonly<{
    submittedRecovery?:
      GoogleGenAiSubmittedRecoveryDependencies;
  }>;

export type GoogleGenAiExecutionLifecycleReconciliationResult =
  | Readonly<{
      lifecycleState:
        "COMPLETED";

      reconciliationMode:
        "DURABLE_COMPLETION";

      provider:
        typeof GOOGLE_GENAI_PROVIDER;

      providerExecutionId:
        string;

      generationRecord:
        GoogleGenAiGenerationRecord;

      generationRecordPath:
        string;

      completion:
        GoogleGenAiExecutionCompletion;

      completionPath:
        string;
    }>
  | Readonly<{
      lifecycleState:
        "COMPLETED";

      reconciliationMode:
        "RECOVERED_SUBMISSION";

      provider:
        typeof GOOGLE_GENAI_PROVIDER;

      providerExecutionId:
        string;

      remoteStatus:
        "completed";

      generationRecord:
        GoogleGenAiGenerationRecord;

      generationRecordPath:
        string;

      completion:
        GoogleGenAiExecutionCompletion;

      completionPath:
        string;
    }>;

const FORBIDDEN_CALLER_OVERRIDE_FIELDS =
  Object.freeze([
    "providerExecutionId",
    "interactionId",
    "provider",
    "reservationId",
    "generationRecordPath",
    "outputPath",
  ]);

const MISSING_SUBMITTED_RECOVERY_DEPENDENCIES_MESSAGE =
  "Google GenAI SUBMITTED reconciliation requires injected same-ID recovery dependencies (getInteraction, retrieveOutput, downloadUri, maxOutputBytes).";

function requireSubmittedRecoveryDependencies(
  submittedRecovery:
    GoogleGenAiSubmittedRecoveryDependencies | undefined,
): GoogleGenAiSubmittedRecoveryDependencies {
  if (
    submittedRecovery === undefined ||
    typeof submittedRecovery.getInteraction !==
      "function" ||
    typeof submittedRecovery.retrieveOutput !==
      "function" ||
    typeof submittedRecovery.downloadUri !==
      "function" ||
    typeof submittedRecovery.maxOutputBytes !==
      "number" ||
    !Number.isSafeInteger(
      submittedRecovery.maxOutputBytes,
    ) ||
    submittedRecovery.maxOutputBytes <= 0
  ) {
    throw new Error(
      MISSING_SUBMITTED_RECOVERY_DEPENDENCIES_MESSAGE,
    );
  }

  return submittedRecovery;
}

type GoogleGenAiDurableResultFields =
  Readonly<{
    provider:
      typeof GOOGLE_GENAI_PROVIDER;

    providerExecutionId:
      string;

    generationRecord:
      GoogleGenAiGenerationRecord;

    generationRecordPath:
      string;

    completion:
      GoogleGenAiExecutionCompletion;

    completionPath:
      string;
  }>;

function durableFields(
  verification:
    GoogleGenAiDurableCompletionVerification,
): GoogleGenAiDurableResultFields {
  return {
    provider:
      GOOGLE_GENAI_PROVIDER,

    providerExecutionId:
      verification.providerExecutionId,

    generationRecord:
      verification.generationRecord,

    generationRecordPath:
      verification.generationRecordPath,

    completion:
      verification.completion,

    completionPath:
      verification.completionPath,
  };
}

export async function reconcileGoogleGenAiExecutionLifecycle(
  input:
    GoogleGenAiExecutionLifecycleReconciliationInput,

  dependencies:
    GoogleGenAiExecutionLifecycleReconciliationDependencies =
      {},
): Promise<
  GoogleGenAiExecutionLifecycleReconciliationResult
> {
  for (
    const field of FORBIDDEN_CALLER_OVERRIDE_FIELDS
  ) {
    if (
      Object.hasOwn(
        input,
        field,
      )
    ) {
      throw new Error(
        `Google GenAI lifecycle reconciliation does not accept a caller-supplied ${field}; durable records are authoritative.`,
      );
    }
  }

  const inspection =
    await inspectGoogleGenAiExecutionLifecycle(
      input.mediaRoot,
      input.episodeId,
      input.shotId,
    );

  if (
    inspection.state ===
    "COMPLETED"
  ) {
    const verification =
      await verifyGoogleGenAiDurableCompletion(
        input.mediaRoot,
        input.episodeId,
        input.shotId,
      );

    return Object.freeze({
      lifecycleState:
        "COMPLETED",

      reconciliationMode:
        "DURABLE_COMPLETION",

      ...durableFields(
        verification,
      ),
    });
  }

  if (
    inspection.state !==
    "SUBMITTED"
  ) {
    throw new Error(
      `Google GenAI lifecycle reconciliation requires SUBMITTED or COMPLETED state; received ${inspection.state}.`,
    );
  }

  const recoveryDependencies =
    requireSubmittedRecoveryDependencies(
      dependencies.submittedRecovery,
    );

  const providerExecutionId =
    inspection.submission
      .providerExecutionId;

  const recovery =
    await recoverGoogleGenAiSingleShot(
      {
        mediaRoot:
          input.mediaRoot,

        episodeId:
          input.episodeId,

        shotId:
          input.shotId,
      },
      {
        getInteraction:
          recoveryDependencies.getInteraction,
      },
    );

  if (
    recovery.providerExecutionId !==
    providerExecutionId
  ) {
    throw new Error(
      `Google GenAI recovery returned providerExecutionId ${recovery.providerExecutionId}, which does not match the inspected durable submission ${providerExecutionId}.`,
    );
  }

  if (
    recovery.lifecycleClass ===
    "PENDING"
  ) {
    throw new Error(
      `Google GenAI interaction ${providerExecutionId} is still pending (remote status ${recovery.remoteStatus}). No durable completion exists yet; reconcile again later. Do not resubmit automatically.`,
    );
  }

  if (
    recovery.lifecycleClass ===
    "TERMINAL_FAILURE"
  ) {
    throw new Error(
      `Google GenAI interaction ${providerExecutionId} ended without a materializable result (remote status ${recovery.remoteStatus}). No completion was recorded. Do not resubmit automatically; operator review is required.`,
    );
  }

  const materializedOutput =
    await materializeGoogleGenAiSingleShotOutput(
      {
        mediaRoot:
          input.mediaRoot,

        episodeId:
          input.episodeId,

        shotId:
          input.shotId,

        maxOutputBytes:
          recoveryDependencies.maxOutputBytes,
      },
      {
        retrieveOutput:
          recoveryDependencies.retrieveOutput,

        downloadUri:
          recoveryDependencies.downloadUri,

        ...(recoveryDependencies.outputFileSystem ===
        undefined
          ? {}
          : {
              fileSystem:
                recoveryDependencies.outputFileSystem,
            }),
      },
    );

  await persistGoogleGenAiSingleShotCompletion(
    {
      mediaRoot:
        input.mediaRoot,

      episodeId:
        input.episodeId,

      shotId:
        input.shotId,

      materializedOutput,
    },
    {
      ...(recoveryDependencies.now ===
      undefined
        ? {}
        : {
            now:
              recoveryDependencies.now,
          }),

      ...(recoveryDependencies.completionFileSystem ===
      undefined
        ? {}
        : {
            fileSystem:
              recoveryDependencies.completionFileSystem,
          }),
    },
  );

  const verification =
    await verifyGoogleGenAiDurableCompletion(
      input.mediaRoot,
      input.episodeId,
      input.shotId,
    );

  return Object.freeze({
    lifecycleState:
      "COMPLETED",

    reconciliationMode:
      "RECOVERED_SUBMISSION",

    remoteStatus:
      "completed",

    ...durableFields(
      verification,
    ),
  });
}
