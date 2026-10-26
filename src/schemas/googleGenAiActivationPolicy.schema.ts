import {
  z,
} from "zod";

import {
  GEMINI_OMNI_11_FLASH_MODEL,
  GOOGLE_GENAI_FIXED_POINT_UNIT,
  GOOGLE_GENAI_PROVIDER,
} from "../googleGenai/googleGenAi.types.js";

import {
  GOOGLE_GENAI_ACTIVATION_LIMITS,
  GOOGLE_GENAI_ACTIVATION_POLICY_SCHEMA_VERSION,
} from "../googleGenai/googleGenAiActivationLimits.js";

/**
 * Operational Google GenAI activation policy.
 *
 * Separate from GoogleGenAiPolicySchema, which is embedded in durable
 * Google submission records and must not change for activation policy.
 * Every limit is pinned to the frozen B4U5 value; only the default-off
 * new-submission switch is an operator-controlled boolean. Unknown keys,
 * wrong types and any drifted value are rejected.
 */

const {
  cost,
  limits,
  timeouts,
  recovery,
} =
  GOOGLE_GENAI_ACTIVATION_LIMITS;

export const GoogleGenAiActivationPolicySchema =
  z.object({
    schemaVersion:
      z.literal(
        GOOGLE_GENAI_ACTIVATION_POLICY_SCHEMA_VERSION,
      ),

    provider:
      z.literal(
        GOOGLE_GENAI_PROVIDER,
      ),

    model:
      z.literal(
        GEMINI_OMNI_11_FLASH_MODEL,
      ),

    admission:
      z.object({
        newSubmissionsEnabled:
          z.boolean(),
      })
        .strict(),

    cost:
      z.object({
        fixedPointUnit:
          z.literal(
            GOOGLE_GENAI_FIXED_POINT_UNIT,
          ),

        maxExpectedCostMicroUsd:
          z.literal(
            cost.maxExpectedCostMicroUsd,
          ),

        inputReserveMicroUsd:
          z.literal(
            cost.inputReserveMicroUsd,
          ),

        costAdmissionDurationSeconds:
          z.literal(
            cost.costAdmissionDurationSeconds,
          ),
      })
        .strict(),

    limits:
      z.object({
        filesMetadataMaxResponseBytes:
          z.literal(limits.filesMetadataMaxResponseBytes),

        maxOutputBytes:
          z.literal(
            limits.maxOutputBytes,
          ),

        maxReferenceImageBytes:
          z.literal(
            limits.maxReferenceImageBytes,
          ),

        sseMaxEventBytes:
          z.literal(
            limits.sseMaxEventBytes,
          ),

        sseMaxResponseBytesPerAttempt:
          z.literal(
            limits.sseMaxResponseBytesPerAttempt,
          ),

        sseMaxEventsPerAttempt:
          z.literal(
            limits.sseMaxEventsPerAttempt,
          ),
      })
        .strict(),

    timeouts:
      z.object({
        createTimeoutMs:
          z.literal(
            timeouts.createTimeoutMs,
          ),

        streamConnectHeadersTimeoutMs:
          z.literal(
            timeouts.streamConnectHeadersTimeoutMs,
          ),

        streamIdleTimeoutMs:
          z.literal(
            timeouts.streamIdleTimeoutMs,
          ),

        streamAttemptTimeoutMs:
          z.literal(
            timeouts.streamAttemptTimeoutMs,
          ),

        filesMetadataTimeoutMs:
          z.literal(
            timeouts.filesMetadataTimeoutMs,
          ),

        filesDownloadTimeoutMs:
          z.literal(
            timeouts.filesDownloadTimeoutMs,
          ),

        reconciliationAttemptTimeoutMs:
          z.literal(
            timeouts.reconciliationAttemptTimeoutMs,
          ),
      })
        .strict(),

    recovery:
      z.object({
        streamRecoveryFirstRetryDelayMs:
          z.literal(recovery.streamRecoveryFirstRetryDelayMs),

        streamRecoverySecondRetryDelayMs:
          z.literal(recovery.streamRecoverySecondRetryDelayMs),

        filesDownloadRetryDelayMs:
          z.literal(recovery.filesDownloadRetryDelayMs),

        automatedRemoteRecoveryHorizonMs:
          z.literal(
            recovery.automatedRemoteRecoveryHorizonMs,
          ),

        filesMinRemainingLifetimeMs:
          z.literal(
            recovery.filesMinRemainingLifetimeMs,
          ),

        maxStreamRecoveryAttemptsPerReconciliation:
          z.literal(
            recovery.maxStreamRecoveryAttemptsPerReconciliation,
          ),

        maxFilesDownloadAttemptsPerReconciliation:
          z.literal(
            recovery.maxFilesDownloadAttemptsPerReconciliation,
          ),
      })
        .strict(),
  })
    .strict();

export type GoogleGenAiActivationPolicy =
  z.infer<
    typeof GoogleGenAiActivationPolicySchema
  >;
