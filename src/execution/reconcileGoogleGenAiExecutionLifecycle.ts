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

import type {
  GoogleGenAiInteractionReplayResult,
  GoogleGenAiOutputUriDownloader,
  GoogleGenAiPrepareOutputUri,
  GoogleGenAiRecoveryContext,
  GoogleGenAiReplayInteraction,
  GoogleGenAiSecureOutputTransportPolicy,
} from "../googleGenai/transport/googleGenAiSecureOutputTransport.types.js";

import {
  GoogleGenAiSecureOutputTransportError,
} from "../googleGenai/transport/googleGenAiSecureOutputTransportError.js";

import {
  materializeGoogleGenAiSingleShotOutput,
  type GoogleGenAiOutputFileSystem,
  type GoogleGenAiOutputRetriever,
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
 *
 * SUBMITTED recovery replays the durable Interaction.id exactly once per
 * invocation and binds local getter/output adapters to that same frozen
 * observation. One recovery context bounds the whole invocation by the
 * smaller of the published invocation budget (monotonic elapsed time) and
 * the durable recovery horizon (submittedAt plus the published horizon,
 * wall clock). Transport behavior is injected; this module has no network
 * or credential authority.
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
    replayInteraction:
      GoogleGenAiReplayInteraction;

    prepareUri:
      GoogleGenAiPrepareOutputUri;

    downloadUri:
      GoogleGenAiOutputUriDownloader;

    policy:
      GoogleGenAiSecureOutputTransportPolicy;

    nowMs?:
      () => number;

    monotonicNowMs?:
      () => number;

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

// The superseded split shape is refused rather than adapted.
const LEGACY_SUBMITTED_RECOVERY_FIELDS =
  Object.freeze([
    "getInteraction",
    "retrieveOutput",
    "maxOutputBytes",
  ]);

const POLICY_FIELDS =
  Object.freeze({
    limits:
      Object.freeze([
        "maxOutputBytes",
        "filesMetadataMaxResponseBytes",
        "sseMaxEventBytes",
        "sseMaxResponseBytesPerAttempt",
        "sseMaxEventsPerAttempt",
      ]),

    timeouts:
      Object.freeze([
        "streamConnectHeadersTimeoutMs",
        "streamIdleTimeoutMs",
        "streamAttemptTimeoutMs",
        "filesMetadataTimeoutMs",
        "filesDownloadTimeoutMs",
        "reconciliationAttemptTimeoutMs",
      ]),

    recovery:
      Object.freeze([
        "automatedRemoteRecoveryHorizonMs",
        "filesMinRemainingLifetimeMs",
        "maxStreamRecoveryAttemptsPerReconciliation",
        "maxFilesDownloadAttemptsPerReconciliation",
        "streamRecoveryFirstRetryDelayMs",
        "streamRecoverySecondRetryDelayMs",
        "filesDownloadRetryDelayMs",
      ]),
  });

const SUBMITTED_AT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d+))?Z$/;

function configuration(): GoogleGenAiSecureOutputTransportError {
  return new GoogleGenAiSecureOutputTransportError(
    "SECURE_TRANSPORT_CONFIGURATION_INVALID",
  );
}

function requireSubmittedRecoveryDependencies(
  submittedRecovery:
    GoogleGenAiSubmittedRecoveryDependencies | undefined,
): GoogleGenAiSubmittedRecoveryDependencies {
  if (
    submittedRecovery === null ||
    typeof submittedRecovery !==
      "object" ||
    LEGACY_SUBMITTED_RECOVERY_FIELDS.some(
      (field) =>
        Object.hasOwn(
          submittedRecovery,
          field,
        ),
    ) ||
    typeof submittedRecovery.replayInteraction !==
      "function" ||
    typeof submittedRecovery.prepareUri !==
      "function" ||
    typeof submittedRecovery.downloadUri !==
      "function" ||
    [
      submittedRecovery.nowMs,
      submittedRecovery.monotonicNowMs,
      submittedRecovery.now,
    ].some(
      (clock) =>
        clock !== undefined &&
        typeof clock !==
          "function",
    )
  ) {
    throw configuration();
  }

  const policy:
    unknown =
    submittedRecovery.policy;

  if (
    policy === null ||
    typeof policy !==
      "object"
  ) {
    throw configuration();
  }

  for (
    const [
      section,
      fields,
    ] of Object.entries(
      POLICY_FIELDS,
    )
  ) {
    const values:
      unknown =
      (policy as Record<string, unknown>)[section];

    if (
      values === null ||
      typeof values !==
        "object" ||
      !fields.every(
        (field) => {
          const value =
            (values as Record<string, unknown>)[field];

          return typeof value ===
            "number" &&
            Number.isSafeInteger(
              value,
            ) &&
            value > 0;
        },
      )
    ) {
      throw configuration();
    }
  }

  return submittedRecovery;
}

function sampleClock(
  clock:
    () => number,
): number {
  let value:
    number;

  try {
    value =
      clock();
  } catch {
    throw configuration();
  }

  if (
    typeof value !==
      "number" ||
    !Number.isFinite(
      value,
    ) ||
    Math.abs(
      value,
    ) >
      Number.MAX_SAFE_INTEGER
  ) {
    throw configuration();
  }

  return value;
}

function parseSubmittedAt(
  submittedAt:
    unknown,
): number {
  if (
    typeof submittedAt !==
    "string"
  ) {
    throw configuration();
  }

  const match =
    SUBMITTED_AT_PATTERN.exec(
      submittedAt,
    );

  if (
    !match ||
    match[0] !== submittedAt
  ) {
    throw configuration();
  }

  // Floor sub-millisecond precision conservatively.
  const fraction =
    match[1] ?? "";

  const parsed =
    Date.parse(
      submittedAt.slice(
        0,
        19,
      ) +
        (fraction
          ? `.${fraction.padEnd(3, "0").slice(0, 3)}`
          : "") +
        "Z",
    );

  if (
    !Number.isSafeInteger(
      parsed,
    ) ||
    new Date(
      parsed,
    )
      .toISOString()
      .slice(
        0,
        19,
      ) !==
      submittedAt.slice(
        0,
        19,
      )
  ) {
    throw configuration();
  }

  return parsed;
}

type SubmittedRecoveryAuthority =
  Readonly<{
    context:
      GoogleGenAiRecoveryContext;

    requireActive:
      () => void;

    reason:
      () => GoogleGenAiSecureOutputTransportError | undefined;

    dispose:
      () => void;
  }>;

/**
 * One parent cancellation/deadline authority for the whole SUBMITTED
 * invocation. Monotonic elapsed time spends the invocation budget; the wall
 * clock only measures the durable horizon, so wall movement can never
 * enlarge the budget. The first typed abort reason wins.
 */
function createSubmittedRecoveryAuthority(
  submittedAt:
    unknown,
  dependencies:
    GoogleGenAiSubmittedRecoveryDependencies,
): SubmittedRecoveryAuthority {
  const wallClock =
    dependencies.nowMs ??
    Date.now;

  const monotonicClock =
    dependencies.monotonicNowMs ??
    (() => performance.now());

  const budgetMs =
    dependencies.policy.timeouts
      .reconciliationAttemptTimeoutMs;

  const submittedAtMs =
    parseSubmittedAt(
      submittedAt,
    );

  const horizonEndMs =
    submittedAtMs +
    dependencies.policy.recovery
      .automatedRemoteRecoveryHorizonMs;

  const startedWallMs =
    sampleClock(
      wallClock,
    );

  if (startedWallMs < submittedAtMs) {
    throw configuration();
  }

  if (horizonEndMs - startedWallMs <= 0) {
    throw new GoogleGenAiSecureOutputTransportError(
      "RECOVERY_HORIZON_EXCEEDED",
    );
  }

  const startedMonotonicMs =
    sampleClock(
      monotonicClock,
    );

  const controller =
    new AbortController();

  let reason:
    GoogleGenAiSecureOutputTransportError | undefined;

  const abort =
    (
      error:
        GoogleGenAiSecureOutputTransportError,
    ): void => {
      if (reason) {
        return;
      }

      reason =
        error;

      controller.abort(
        error,
      );
    };

  const budgetRemainingMs =
    (): number =>
      budgetMs -
      (sampleClock(
        monotonicClock,
      ) -
        startedMonotonicMs);

  const horizonRemainingMs =
    (): number =>
      horizonEndMs -
      sampleClock(
        wallClock,
      );

  const horizonFirst =
    horizonEndMs -
      startedWallMs <
    budgetMs;

  const timer =
    setTimeout(
      () =>
        abort(
          new GoogleGenAiSecureOutputTransportError(
            horizonFirst
              ? "RECOVERY_HORIZON_EXCEEDED"
              : "RECONCILIATION_TIMEOUT",
          ),
        ),
      Math.min(
        budgetMs,
        horizonEndMs -
          startedWallMs,
      ),
    );

  // Records an elapsed expiry as the first typed reason even when the timer
  // callback has not been delivered yet.
  const observeExpiry =
    (): void => {
      if (!reason) {
        if (horizonRemainingMs() <= 0) {
          abort(
            new GoogleGenAiSecureOutputTransportError(
              "RECOVERY_HORIZON_EXCEEDED",
            ),
          );
        } else if (budgetRemainingMs() <= 0) {
          abort(
            new GoogleGenAiSecureOutputTransportError(
              "RECONCILIATION_TIMEOUT",
            ),
          );
        }
      }
    };

  const requireActive =
    (): void => {
      observeExpiry();

      if (reason) {
        throw reason;
      }
    };

  return Object.freeze({
    context:
      Object.freeze({
        signal:
          controller.signal,

        remainingMs:
          (): number =>
            Math.min(
              budgetRemainingMs(),
              horizonRemainingMs(),
            ),
      }),

    requireActive,

    reason:
      () => {
        try {
          observeExpiry();
        } catch {
          // A malformed clock keeps the already-surfaced failure.
        }

        return reason;
      },

    dispose:
      () =>
        clearTimeout(
          timer,
        ),
  });
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

  const authority =
    createSubmittedRecoveryAuthority(
      inspection.submission
        .submittedAt,
      recoveryDependencies,
    );

  try {
    return await recoverSubmittedGoogleGenAiExecution(
      input,
      providerExecutionId,
      recoveryDependencies,
      authority,
    );
  } catch (error) {
    throw outwardFailure(
      authority.reason(),
      error,
    );
  } finally {
    authority.dispose();
  }
}

const CLOSED_ERROR_FIELDS =
  Object.freeze([
    "code",
    "attempt",
    "httpStatus",
    "retryable",
  ] as const);

/**
 * Closed-error boundary for the declared replay dependency. A failure is
 * never trusted by identity or instanceof alone: semantic fields are read
 * only as OWN DATA descriptors (no getter executes), and the trusted
 * constructor must round-trip code/attempt/httpStatus/retryable exactly.
 * Only that fresh reconstruction crosses. Anything else (ordinary errors,
 * malformed, inherited, accessor-backed or contradictory representations)
 * becomes the existing nonretryable SECURE_TRANSPORT_CONFIGURATION_INVALID,
 * so no dependency identity, message, stack, cause or custom data escapes.
 */
function normalizeReplayDependencyFailure(
  error:
    unknown,
): GoogleGenAiSecureOutputTransportError {
  try {
    if (
      !(error instanceof
        GoogleGenAiSecureOutputTransportError)
    ) {
      return configuration();
    }

    const fields =
      CLOSED_ERROR_FIELDS.map(
        (field) =>
          Reflect.getOwnPropertyDescriptor(
            error,
            field,
          ),
      );

    if (
      fields.some(
        (descriptor) =>
          descriptor === undefined ||
          !("value" in descriptor),
      )
    ) {
      return configuration();
    }

    const [
      code,
      attempt,
      httpStatus,
      retryable,
    ] =
      fields.map(
        (descriptor) =>
          descriptor?.value as unknown,
      );

    if (
      typeof code !==
        "string" ||
      typeof retryable !==
        "boolean" ||
      (attempt !== undefined &&
        typeof attempt !==
          "number") ||
      (httpStatus !== undefined &&
        typeof httpStatus !==
          "number")
    ) {
      return configuration();
    }

    const rebuilt =
      new GoogleGenAiSecureOutputTransportError(
        code as GoogleGenAiSecureOutputTransportError["code"],
        {
          ...(attempt === undefined
            ? {}
            : {
                attempt,
              }),

          ...(httpStatus === undefined
            ? {}
            : {
                httpStatus,
              }),
        },
      );

    return rebuilt.code ===
        code &&
      Object.is(
        rebuilt.attempt,
        attempt,
      ) &&
      Object.is(
        rebuilt.httpStatus,
        httpStatus,
      ) &&
      rebuilt.retryable ===
        retryable
      ? rebuilt
      : configuration();
  } catch {
    return configuration();
  }
}

function isTempCleanupFailure(
  value:
    unknown,
): value is GoogleGenAiSecureOutputTransportError {
  return value instanceof
    GoogleGenAiSecureOutputTransportError &&
    value.code ===
      "TEMP_CLEANUP_FAILED";
}

/**
 * The first typed parent reason wins over any downstream symptom, but never
 * erases independently surfaced sanitized cleanup evidence: the parent
 * reason stays primary and each TEMP_CLEANUP_FAILED member is kept, so the
 * combined condition is never mistaken for a plain transient timeout.
 */
function outwardFailure(
  reason:
    GoogleGenAiSecureOutputTransportError | undefined,
  error:
    unknown,
): unknown {
  if (reason === undefined) {
    return error;
  }

  const cleanupFailures =
    error instanceof AggregateError
      ? error.errors.filter(
          isTempCleanupFailure,
        )
      : isTempCleanupFailure(
          error,
        )
        ? [
            error,
          ]
        : [];

  if (cleanupFailures.length === 0) {
    return reason;
  }

  return new AggregateError(
    [
      reason,
      cleanupFailures[0],
    ],
    "Google GenAI recovery stopped at its parent deadline and its temporary output could not be cleaned up.",
  );
}

async function recoverSubmittedGoogleGenAiExecution(
  input:
    GoogleGenAiExecutionLifecycleReconciliationInput,
  providerExecutionId:
    string,
  recoveryDependencies:
    GoogleGenAiSubmittedRecoveryDependencies,
  authority:
    SubmittedRecoveryAuthority,
): Promise<
  GoogleGenAiExecutionLifecycleReconciliationResult
> {
  authority.requireActive();

  // Exactly one replay observation per invocation; it is never refreshed.
  // replayInteraction is a declared dependency seam: its failure is
  // normalized here and never trusted to have been sanitized upstream.
  let observation:
    GoogleGenAiInteractionReplayResult;

  try {
    observation =
      await recoveryDependencies
        .replayInteraction(
          providerExecutionId,
          authority.context,
        );
  } catch (error) {
    throw normalizeReplayDependencyFailure(
      error,
    );
  }

  authority.requireActive();

  // Both local adapters return the SAME frozen observation. A changed
  // durable identity fails closed and never causes a second replay.
  const observedInteraction =
    async (
      requestedProviderExecutionId:
        string,
    ): Promise<GoogleGenAiInteractionReplayResult> => {
      if (
        requestedProviderExecutionId !==
        providerExecutionId
      ) {
        throw new Error(
          "Google GenAI durable providerExecutionId changed after lifecycle inspection; refusing a second replay.",
        );
      }

      return observation;
    };

  const getInteraction:
    GoogleGenAiInteractionGetter =
    observedInteraction;

  const retrieveOutput:
    GoogleGenAiOutputRetriever =
    observedInteraction;

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
        getInteraction,
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

  authority.requireActive();

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
          recoveryDependencies.policy.limits
            .maxOutputBytes,
      },
      {
        retrieveOutput,

        prepareUri:
          recoveryDependencies.prepareUri,

        downloadUri:
          recoveryDependencies.downloadUri,

        policy:
          recoveryDependencies.policy,

        context:
          authority.context,

        ...(recoveryDependencies.outputFileSystem ===
        undefined
          ? {}
          : {
              fileSystem:
                recoveryDependencies.outputFileSystem,
            }),
      },
    );

  // No completion is persisted once the invocation authority has expired.
  authority.requireActive();

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
