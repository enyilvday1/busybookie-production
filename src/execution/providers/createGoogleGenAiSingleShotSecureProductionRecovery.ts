import {
  GOOGLE_GENAI_ACTIVATION_LIMITS,
} from "../../googleGenai/googleGenAiActivationLimits.js";

import type {
  GoogleGenAiFetch,
  GoogleGenAiOutputUriDownloader,
  GoogleGenAiPrepareOutputUri,
  GoogleGenAiReplayInteraction,
  GoogleGenAiSecureOutputTransportPolicy,
} from "../../googleGenai/transport/googleGenAiSecureOutputTransport.types.js";

import {
  replayGoogleGenAiInteraction,
} from "../../googleGenai/transport/replayGoogleGenAiInteraction.js";

import {
  getGoogleGenAiFilesMetadata,
} from "../../googleGenai/transport/getGoogleGenAiFilesMetadata.js";

import {
  downloadGoogleGenAiFile,
} from "../../googleGenai/transport/downloadGoogleGenAiFile.js";

import type {
  GoogleGenAiSubmittedRecoveryDependencies,
} from "../reconcileGoogleGenAiExecutionLifecycle.js";

/**
 * Dormant secure production recovery factory for Google GenAI.
 *
 * Composes the protected secure transports (bounded SSE replay, Files
 * metadata preparation, single-attempt streaming download) with an
 * explicitly supplied API key, the frozen activation-limits authority and
 * optional injected fetch/wall/monotonic clocks, and returns exactly the
 * dependency set consumed by reconcileGoogleGenAiExecutionLifecycle.
 *
 * Construction is synchronous and offline: no request, replay, metadata or
 * download happens here. The factory owns no endpoint, header, URL, retry,
 * timer, deadline, cache or persistence; those stay with the transports,
 * the materializer and the reconciler. It never loads environment or
 * activation config, never gates recovery on new-submission admission, and
 * selects no provider. No src/scripts runtime consumer exists: wiring is a
 * later, separately authorized gate.
 */

export type GoogleGenAiSecureProductionRecoveryOptions =
  Readonly<{
    fetchImpl?:
      GoogleGenAiFetch;

    nowMs?:
      () => number;

    monotonicNowMs?:
      () => number;
  }>;

// Same visible-ASCII rule the protected transports enforce per request.
const API_KEY_PATTERN =
  /^[\x21-\x7e]+$/;

const INVALID_API_KEY_MESSAGE =
  "Google GenAI secure production recovery requires a non-empty visible-ASCII API key.";

const INVALID_OPTIONS_MESSAGE =
  "Google GenAI secure production recovery options must provide functions for fetchImpl, nowMs and monotonicNowMs when present.";

/**
 * Selects only the structural transport-policy fields from the frozen
 * activation-limits authority. Values are read from the authority, never
 * restated here; cost and submission-only limits are excluded.
 */
function selectSecureTransportPolicy():
GoogleGenAiSecureOutputTransportPolicy {
  const {
    limits,
    timeouts,
    recovery,
  } =
    GOOGLE_GENAI_ACTIVATION_LIMITS;

  return Object.freeze({
    limits:
      Object.freeze({
        maxOutputBytes:
          limits.maxOutputBytes,

        filesMetadataMaxResponseBytes:
          limits.filesMetadataMaxResponseBytes,

        sseMaxEventBytes:
          limits.sseMaxEventBytes,

        sseMaxResponseBytesPerAttempt:
          limits.sseMaxResponseBytesPerAttempt,

        sseMaxEventsPerAttempt:
          limits.sseMaxEventsPerAttempt,
      }),

    timeouts:
      Object.freeze({
        streamConnectHeadersTimeoutMs:
          timeouts.streamConnectHeadersTimeoutMs,

        streamIdleTimeoutMs:
          timeouts.streamIdleTimeoutMs,

        streamAttemptTimeoutMs:
          timeouts.streamAttemptTimeoutMs,

        filesMetadataTimeoutMs:
          timeouts.filesMetadataTimeoutMs,

        filesDownloadTimeoutMs:
          timeouts.filesDownloadTimeoutMs,

        reconciliationAttemptTimeoutMs:
          timeouts.reconciliationAttemptTimeoutMs,
      }),

    recovery:
      Object.freeze({
        automatedRemoteRecoveryHorizonMs:
          recovery.automatedRemoteRecoveryHorizonMs,

        filesMinRemainingLifetimeMs:
          recovery.filesMinRemainingLifetimeMs,

        maxStreamRecoveryAttemptsPerReconciliation:
          recovery.maxStreamRecoveryAttemptsPerReconciliation,

        maxFilesDownloadAttemptsPerReconciliation:
          recovery.maxFilesDownloadAttemptsPerReconciliation,

        streamRecoveryFirstRetryDelayMs:
          recovery.streamRecoveryFirstRetryDelayMs,

        streamRecoverySecondRetryDelayMs:
          recovery.streamRecoverySecondRetryDelayMs,

        filesDownloadRetryDelayMs:
          recovery.filesDownloadRetryDelayMs,
      }),
  });
}

export function createGoogleGenAiSingleShotSecureProductionRecovery(
  apiKey:
    string,
  options:
    GoogleGenAiSecureProductionRecoveryOptions =
      {},
): GoogleGenAiSubmittedRecoveryDependencies {
  // Validated once and never echoed; the transports re-check per request.
  const key =
    typeof apiKey ===
      "string"
      ? apiKey.trim()
      : "";

  if (
    !key ||
    !API_KEY_PATTERN.test(
      key,
    )
  ) {
    throw new Error(
      INVALID_API_KEY_MESSAGE,
    );
  }

  if (
    options === null ||
    typeof options !==
      "object" ||
    [
      options.fetchImpl,
      options.nowMs,
      options.monotonicNowMs,
    ].some(
      (value) =>
        value !== undefined &&
        typeof value !==
          "function",
    )
  ) {
    throw new Error(
      INVALID_OPTIONS_MESSAGE,
    );
  }

  const policy =
    selectSecureTransportPolicy();

  const nowMs =
    options.nowMs ??
    Date.now;

  const monotonicNowMs =
    options.monotonicNowMs ??
    ((): number =>
      performance.now());

  const fetchBinding =
    options.fetchImpl ===
    undefined
      ? {}
      : {
          fetchImpl:
            options.fetchImpl,
        };

  // Pure forwarding closures: the reconciler-owned context passes through
  // unchanged, and each call is exactly one protected transport invocation.
  const replayInteraction:
    GoogleGenAiReplayInteraction =
    (
      providerExecutionId,
      context,
    ) =>
      replayGoogleGenAiInteraction(
        providerExecutionId,
        context,
        {
          apiKey:
            key,

          policy,

          ...fetchBinding,
        },
      );

  const prepareUri:
    GoogleGenAiPrepareOutputUri =
    (
      request,
      context,
    ) =>
      getGoogleGenAiFilesMetadata(
        request,
        context,
        {
          apiKey:
            key,

          policy,

          nowMs,

          ...fetchBinding,
        },
      );

  const downloadUri:
    GoogleGenAiOutputUriDownloader =
    (
      metadata,
      sink,
      context,
    ) =>
      downloadGoogleGenAiFile(
        metadata,
        sink,
        context,
        {
          apiKey:
            key,

          policy,

          nowMs,

          monotonicNowMs,

          ...fetchBinding,
        },
      );

  // The same clocks drive transport lifetime checks and the reconciler's
  // budget/horizon authority. No completion-timestamp clock is supplied:
  // completion persistence keeps its own existing clock.
  return Object.freeze({
    replayInteraction,
    prepareUri,
    downloadUri,
    policy,
    nowMs,
    monotonicNowMs,
  });
}
