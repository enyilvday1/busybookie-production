/**
 * Frozen Google GenAI activation limits (Step 1138B4U5 policy lock).
 *
 * These are BusyBookie operational limits, not Google provider maximums.
 * The activation-policy schema requires the checked-in configuration to
 * equal these values exactly, so a policy change is always a reviewed
 * code change. Costs use the repository's integer MICRO_USD fixed point.
 */

export const GOOGLE_GENAI_ACTIVATION_POLICY_SCHEMA_VERSION =
  "1.0" as const;

/**
 * Video resolutions accepted by the installed @google/genai 2.24.0
 * VideoResponseFormat. Accepting a value here does not make it
 * admissible: the expected-cost preflight additionally requires an
 * authoritative local price for it.
 */
export const GOOGLE_GENAI_VIDEO_RESOLUTIONS =
  Object.freeze([
    "360p",
    "720p",
    "1080p",
    "4k",
  ] as const);

export type GoogleGenAiVideoResolution =
  typeof GOOGLE_GENAI_VIDEO_RESOLUTIONS[number];

export const GOOGLE_GENAI_VIDEO_DELIVERY =
  "uri" as const;

export const GOOGLE_GENAI_ACTIVATION_LIMITS =
  Object.freeze({
    cost:
      Object.freeze({
        maxExpectedCostMicroUsd:
          2_000_000,

        inputReserveMicroUsd:
          500_000,

        costAdmissionDurationSeconds:
          10,
      }),

    limits:
      Object.freeze({
        maxOutputBytes:
          268_435_456,

        maxReferenceImageBytes:
          10_485_760,

        sseMaxEventBytes:
          1_048_576,

        sseMaxResponseBytesPerAttempt:
          16_777_216,

        sseMaxEventsPerAttempt:
          512,
      }),

    timeouts:
      Object.freeze({
        createTimeoutMs:
          60_000,

        streamConnectHeadersTimeoutMs:
          30_000,

        streamIdleTimeoutMs:
          120_000,

        streamAttemptTimeoutMs:
          900_000,

        filesMetadataTimeoutMs:
          30_000,

        filesDownloadTimeoutMs:
          600_000,

        reconciliationAttemptTimeoutMs:
          1_200_000,
      }),

    recovery:
      Object.freeze({
        automatedRemoteRecoveryHorizonMs:
          86_400_000,

        filesMinRemainingLifetimeMs:
          3_600_000,

        maxStreamRecoveryAttemptsPerReconciliation:
          3,

        maxFilesDownloadAttemptsPerReconciliation:
          2,
      }),
  });

/**
 * The production create timeout. The SDK maps this request option to
 * timeout_ms and an AbortSignal; it never adds a retry.
 */
export const GOOGLE_GENAI_CREATE_TIMEOUT_MS =
  GOOGLE_GENAI_ACTIVATION_LIMITS
    .timeouts
    .createTimeoutMs;
