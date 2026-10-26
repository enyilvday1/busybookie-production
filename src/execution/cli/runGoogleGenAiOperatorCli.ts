import {
  createHash,
} from "node:crypto";

import {
  GOOGLE_GENAI_SECURE_OUTPUT_TRANSPORT_ERROR_CODES,
} from "../../googleGenai/transport/googleGenAiSecureOutputTransportError.js";

import {
  loadCharacterBible,
} from "../../validation/loadCharacterBible.js";

import {
  loadEnvironment,
} from "../../validation/loadEnvironment.js";

import {
  loadEpisodeManifest,
} from "../../validation/loadEpisodeManifest.js";

import {
  loadGoogleGenAiActivationPolicy,
} from "../../validation/loadGoogleGenAiActivationPolicy.js";

import {
  loadGoogleGenAiPolicy,
} from "../../validation/loadGoogleGenAiPolicy.js";

import {
  loadProductionRules,
} from "../../validation/loadProductionRules.js";

import {
  validateEpisodeProduction,
} from "../../validation/validateEpisodeProduction.js";

import {
  validateMediaRoot,
} from "../../validation/validateMediaRoot.js";

import {
  createExecutionReservation,
} from "../createExecutionReservation.js";

import {
  createExecutionSubmission,
} from "../createExecutionSubmission.js";

import {
  createGoogleGenAiOperatorProductionDependencies,
} from "../createGoogleGenAiOperatorProductionDependencies.js";

import {
  createProductionVisualReferenceVerifier,
} from "../createProductionVisualReferenceVerifier.js";

import {
  executeGoogleGenAiOperatorSingleShot,
  GOOGLE_GENAI_OPERATOR_ERROR_CODES,
  GoogleGenAiOperatorError,
  type GoogleGenAiOperatorErrorCode,
  type GoogleGenAiOperatorStage,
  type GoogleGenAiOperatorStateChange,
} from "../executeGoogleGenAiOperatorSingleShot.js";

import {
  inspectExecutionLifecycle,
} from "../inspectExecutionLifecycle.js";

import {
  inspectGoogleGenAiExecutionLifecycle,
} from "../inspectGoogleGenAiExecutionLifecycle.js";

import {
  readExecutionReservation,
} from "../readExecutionReservation.js";

import {
  reconcileGoogleGenAiExecutionLifecycle,
} from "../reconcileGoogleGenAiExecutionLifecycle.js";

import {
  parseGoogleGenAiOperatorCliArgs,
} from "./googleGenAiOperatorCliArgs.js";

/**
 * Operator-only Google GenAI runner CLI (B4X).
 *
 *   execute   - local admission, then one reservation, one Interaction and
 *               the durable submission; stops at SUBMITTED.
 *   reconcile - same-ID secure recovery of an existing GOOGLE_GENAI record;
 *               never loads the activation policy, never reserves or submits.
 *
 * Output is KEY=VALUE lines. Failures print only a closed error code, stage,
 * state change and a fixed message; no caught value is ever formatted, so no
 * stack, cause, provider body, SDK object, header or credential can appear.
 * The runner returns its exit code and never rethrows.
 */

export const GOOGLE_GENAI_OPERATOR_EXIT_CODES =
  Object.freeze({
    SUCCESS:
      0,
    USAGE:
      2,
    REFUSED_NO_STATE_CHANGE:
      3,
    FAILED_STATE_PRESENT:
      4,
    RECOVERY_NOT_COMPLETED:
      5,
  });

type ExitCode =
  typeof GOOGLE_GENAI_OPERATOR_EXIT_CODES[keyof typeof GOOGLE_GENAI_OPERATOR_EXIT_CODES];

const {
  USAGE,
  REFUSED_NO_STATE_CHANGE: REFUSED,
  FAILED_STATE_PRESENT: FAILED,
  RECOVERY_NOT_COMPLETED: NOT_RECOVERED,
} = GOOGLE_GENAI_OPERATOR_EXIT_CODES;

export const GOOGLE_GENAI_OPERATOR_ERROR_TABLE: Readonly<Record<GoogleGenAiOperatorErrorCode, Readonly<{ exitCode: ExitCode; message: string }>>> =
  Object.freeze({
    USAGE_INVALID: { exitCode: USAGE, message: "Invalid arguments. Usage: execute --episode EP## --shot S## --image <path> --resolution 720p [--confirm-paid-generation] | reconcile --episode EP## --shot S##." },
    ENVIRONMENT_INVALID: { exitCode: REFUSED, message: "The runtime environment is invalid." },
    CREDENTIAL_MISSING: { exitCode: REFUSED, message: "GEMINI_API_KEY is not configured." },
    CREDENTIAL_INVALID: { exitCode: REFUSED, message: "GEMINI_API_KEY failed local validation." },
    CONFIG_INVALID: { exitCode: REFUSED, message: "A required configuration or policy file is invalid." },
    EPISODE_INVALID: { exitCode: REFUSED, message: "The episode manifest could not be loaded or validated." },
    MEDIA_ROOT_INVALID: { exitCode: REFUSED, message: "BUSYBOOKIE_MEDIA_ROOT is invalid." },
    SHOT_NOT_FOUND: { exitCode: REFUSED, message: "The selected shot does not exist in the episode." },
    SHOT_AMBIGUOUS: { exitCode: REFUSED, message: "The selected shot identity is ambiguous in the episode." },
    EPISODE_STATUS_NOT_LIVE: { exitCode: REFUSED, message: "The episode is not in a live generation status." },
    APPROVALS_MISSING: { exitCode: REFUSED, message: "Required episode approvals are missing." },
    SHOT_NOT_PROGRESSABLE: { exitCode: REFUSED, message: "The shot cannot progress under the production rules." },
    SHOT_STATUS_NOT_APPROVED: { exitCode: REFUSED, message: "The shot is not APPROVED_FOR_GENERATION." },
    MANIFEST_PROVIDER_NOT_PAID: { exitCode: REFUSED, message: "The shot manifest provider must be RUNWAY or VEO." },
    NATIVE_AUDIO_REJECTED: { exitCode: REFUSED, message: "The shot requires native audio; the Google operator runner is visual-only." },
    DIALOGUE_REJECTED: { exitCode: REFUSED, message: "The shot requires dialogue; the Google operator runner is visual-only." },
    AUDIO_DEPENDENT_SHOT_TYPE_REJECTED: { exitCode: REFUSED, message: "The shot type depends on audio; the Google operator runner is visual-only." },
    DURATION_EXCEEDS_LIMIT: { exitCode: REFUSED, message: "The shot duration exceeds the activation-policy limit." },
    REFERENCES_NOT_APPROVED: { exitCode: REFUSED, message: "The shot requires an approved visual reference." },
    PROMPT_INVALID: { exitCode: REFUSED, message: "The Google prompt could not be built for the shot." },
    RESOLUTION_UNSUPPORTED: { exitCode: REFUSED, message: "Only 720p is admissible." },
    PRICING_UNAVAILABLE: { exitCode: REFUSED, message: "No authoritative local price exists for the request." },
    CALCULATION_FAILED: { exitCode: REFUSED, message: "The expected cost could not be calculated." },
    COST_EXCEEDS_CAP: { exitCode: REFUSED, message: "The expected cost exceeds the activation-policy cap." },
    NEW_SUBMISSIONS_DISABLED: { exitCode: REFUSED, message: "New Google submissions are disabled by the activation policy." },
    CONFIRMATION_REQUIRED: { exitCode: REFUSED, message: "Paid generation requires --confirm-paid-generation." },
    LIFECYCLE_EXISTS: { exitCode: REFUSED, message: "An execution lifecycle record already exists for the shot." },
    LIFECYCLE_UNREADABLE: { exitCode: REFUSED, message: "The existing execution lifecycle could not be read." },
    VISUAL_REFERENCE_UNVERIFIED: { exitCode: REFUSED, message: "The reference image is not a verified approved visual reference for the shot." },
    REFERENCE_IMAGE_UNSUPPORTED: { exitCode: REFUSED, message: "The reference image extension must be .png, .jpg, .jpeg or .webp." },
    REFERENCE_IMAGE_REJECTED: { exitCode: REFUSED, message: "The reference image failed the bounded read check." },
    RESERVATION_FAILED: { exitCode: FAILED, message: "The durable reservation could not be created. Inspect the lifecycle records; do not retry automatically." },
    SUBMISSION_REFUSED_BEFORE_PROVIDER_CALL: { exitCode: FAILED, message: "Submission stopped before any provider call; a reservation exists. Operator review is required." },
    SUBMISSION_ACCEPTANCE_UNCERTAIN: { exitCode: FAILED, message: "Google may have accepted the paid request. Do not resubmit; operator investigation is required." },
    DURABLE_SUBMISSION_FAILED: { exitCode: FAILED, message: "Google accepted the request but the durable submission was not recorded. Do not resubmit." },
    NO_LIFECYCLE: { exitCode: REFUSED, message: "No execution lifecycle exists for the shot." },
    INCOMPATIBLE_PROVIDER_STATE: { exitCode: REFUSED, message: "The shot lifecycle belongs to another provider." },
    RESERVED_WITHOUT_SUBMISSION: { exitCode: FAILED, message: "A Google reservation exists without a durable submission. Operator investigation is required; never resubmit." },
    LIFECYCLE_INVALID: { exitCode: FAILED, message: "The Google lifecycle records are invalid or inconsistent." },
    RECOVERY_FAILED: { exitCode: NOT_RECOVERED, message: "Secure recovery did not complete; the durable submission is unchanged." },
    RECONCILE_FAILED: { exitCode: NOT_RECOVERED, message: "Reconciliation did not complete." },
    INTERNAL_ERROR: { exitCode: FAILED, message: "Internal error." },
  });

export type RunGoogleGenAiOperatorCliDependencies =
  Readonly<{
    loadEnvironment:
      typeof loadEnvironment;
    loadEpisodeManifest:
      typeof loadEpisodeManifest;
    loadCharacterBible:
      typeof loadCharacterBible;
    loadProductionRules:
      typeof loadProductionRules;
    validateEpisodeProduction:
      typeof validateEpisodeProduction;
    validateMediaRoot:
      typeof validateMediaRoot;
    loadActivationPolicy:
      () => ReturnType<typeof loadGoogleGenAiActivationPolicy>;
    loadGooglePolicy:
      () => ReturnType<typeof loadGoogleGenAiPolicy>;
    createDependencies:
      typeof createGoogleGenAiOperatorProductionDependencies;
    createVisualReferenceVerifier:
      typeof createProductionVisualReferenceVerifier;
    inspectLifecycle:
      typeof inspectExecutionLifecycle;
    createReservation:
      typeof createExecutionReservation;
    createSubmission:
      typeof createExecutionSubmission;
    executeSingleShot:
      typeof executeGoogleGenAiOperatorSingleShot;
    readReservation:
      typeof readExecutionReservation;
    inspectGoogleLifecycle:
      typeof inspectGoogleGenAiExecutionLifecycle;
    reconcile:
      typeof reconcileGoogleGenAiExecutionLifecycle;
    writeStdout:
      (line: string) => void;
    writeStderr:
      (line: string) => void;
  }>;

const defaultDependencies:
  RunGoogleGenAiOperatorCliDependencies =
  Object.freeze({
    loadEnvironment,
    loadEpisodeManifest,
    loadCharacterBible,
    loadProductionRules,
    validateEpisodeProduction,
    validateMediaRoot,
    // Default paths only: no policy-path argument or override exists.
    loadActivationPolicy:
      () =>
        loadGoogleGenAiActivationPolicy(),
    loadGooglePolicy:
      () =>
        loadGoogleGenAiPolicy(),
    createDependencies:
      createGoogleGenAiOperatorProductionDependencies,
    createVisualReferenceVerifier:
      createProductionVisualReferenceVerifier,
    inspectLifecycle:
      inspectExecutionLifecycle,
    createReservation:
      createExecutionReservation,
    createSubmission:
      createExecutionSubmission,
    executeSingleShot:
      executeGoogleGenAiOperatorSingleShot,
    readReservation:
      readExecutionReservation,
    inspectGoogleLifecycle:
      inspectGoogleGenAiExecutionLifecycle,
    reconcile:
      reconcileGoogleGenAiExecutionLifecycle,
    writeStdout:
      (line: string) => {
        process.stdout.write(
          `${line}\n`,
        );
      },
    writeStderr:
      (line: string) => {
        process.stderr.write(
          `${line}\n`,
        );
      },
  });

type Failure =
  Readonly<{
    code:
      GoogleGenAiOperatorErrorCode;
    stage:
      GoogleGenAiOperatorStage;
    stateChange:
      GoogleGenAiOperatorStateChange;
    transportCode?:
      string;
    retryable?:
      boolean;
  }>;

class OperatorFailure extends Error {
  constructor(
    readonly failure:
      Failure,
  ) {
    super(
      "Google GenAI operator CLI failure.",
    );
  }
}

function fail(
  code:
    GoogleGenAiOperatorErrorCode,
  stage:
    GoogleGenAiOperatorStage,
  stateChange:
    GoogleGenAiOperatorStateChange =
      "NONE",
): OperatorFailure {
  return new OperatorFailure({
    code,
    stage,
    stateChange,
  });
}

async function step<T>(
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
    throw fail(
      code,
      stage,
    );
  }
}

/** Reads an own data property only; accessors and inherited values are ignored. */
function ownData(
  value:
    unknown,
  key:
    string,
): unknown {
  if (
    value === null ||
    typeof value !==
      "object"
  ) {
    return undefined;
  }

  const descriptor =
    Object.getOwnPropertyDescriptor(
      value,
      key,
    );

  return descriptor !== undefined &&
    "value" in descriptor
    ? descriptor.value
    : undefined;
}

/** Only this module's own closed failure types are trusted; everything else is INTERNAL_ERROR. */
function classify(
  error:
    unknown,
  fallbackStage:
    GoogleGenAiOperatorStage,
): Failure {
  if (
    error instanceof
    OperatorFailure
  ) {
    return error.failure;
  }

  if (
    error instanceof
      GoogleGenAiOperatorError &&
    (GOOGLE_GENAI_OPERATOR_ERROR_CODES as readonly string[]).includes(
      error.code,
    )
  ) {
    return {
      code:
        error.code,
      stage:
        error.stage,
      stateChange:
        error.stateChange,
    };
  }

  return {
    code:
      "INTERNAL_ERROR",
    stage:
      fallbackStage,
    stateChange:
      "UNKNOWN",
  };
}

function recoveryFailure(
  error:
    unknown,
): OperatorFailure {
  const code =
    ownData(
      error,
      "code",
    );

  const retryable =
    ownData(
      error,
      "retryable",
    );

  const transportCode =
    typeof code ===
      "string" &&
    (GOOGLE_GENAI_SECURE_OUTPUT_TRANSPORT_ERROR_CODES as readonly string[]).includes(
      code,
    )
      ? code
      : undefined;

  if (
    transportCode ===
    undefined
  ) {
    return fail(
      "RECONCILE_FAILED",
      "RECONCILE",
      "UNKNOWN",
    );
  }

  return new OperatorFailure({
    code:
      "RECOVERY_FAILED",
    stage:
      "RECONCILE",
    stateChange:
      "UNKNOWN",
    transportCode,
    retryable:
      retryable ===
      true,
  });
}

const sha256 =
  (value: string): string =>
    createHash(
      "sha256",
    )
      .update(
        value,
        "utf8",
      )
      .digest(
        "hex",
      );

// Values are repository-validated identifiers, numbers and media paths; line
// breaks are removed so one value can never forge another output line.
const field =
  (key: string, value: string | number): string =>
    `${key}=${String(value).replace(/[\r\n]/g, "")}`;

async function runExecute(
  options:
    Extract<
      ReturnType<typeof parseGoogleGenAiOperatorCliArgs>,
      { subcommand: "execute" }
    >,
  dependencies:
    RunGoogleGenAiOperatorCliDependencies,
): Promise<readonly string[]> {
  // Steps 2-5: environment, credential presence, manifest, media root.
  const env =
    await step(
      "ENVIRONMENT_INVALID",
      "ENVIRONMENT",
      () =>
        dependencies.loadEnvironment(),
    );

  const apiKey =
    env.GEMINI_API_KEY;

  if (
    apiKey ===
    undefined
  ) {
    throw fail(
      "CREDENTIAL_MISSING",
      "ENVIRONMENT",
    );
  }

  const [
    episode,
    bible,
    rules,
  ] = await step(
    "EPISODE_INVALID",
    "LOAD",
    () =>
      Promise.all([
        dependencies.loadEpisodeManifest(
          options.episodeId,
        ),
        dependencies.loadCharacterBible(),
        dependencies.loadProductionRules(),
      ]),
  );

  await step(
    "EPISODE_INVALID",
    "LOAD",
    () => {
      if (
        episode.episodeId !==
        options.episodeId
      ) {
        throw new Error(
          "Loaded episode identity does not match --episode.",
        );
      }

      dependencies.validateEpisodeProduction(
        episode,
        bible,
        rules,
      );
    },
  );

  const mediaRoot =
    await step(
      "MEDIA_ROOT_INVALID",
      "ENVIRONMENT",
      () =>
        dependencies.validateMediaRoot(
          env,
          rules,
        ),
    );

  // Steps 6-17 and R1/R2 are owned by the orchestrator.
  const result =
    await dependencies.executeSingleShot(
      {
        episode,
        shotId:
          options.shotId,
        bible,
        rules,
        mediaRoot,
        sourceImagePath:
          options.sourceImagePath,
        resolution:
          options.resolution,
        confirmPaidGeneration:
          options.confirmPaidGeneration,
      },
      {
        loadPolicies:
          async () => {
            const [
              activationPolicy,
              googlePolicy,
            ] = await Promise.all([
              dependencies.loadActivationPolicy(),
              dependencies.loadGooglePolicy(),
            ]);

            return {
              activationPolicy,
              googlePolicy,
            };
          },
        prepareSubmission:
          () => {
            const prepared =
              dependencies.createDependencies(
                apiKey,
              );

            return {
              createInteraction:
                prepared.createInteraction,
            };
          },
        inspectLifecycle:
          dependencies.inspectLifecycle,
        verifyVisualReference:
          dependencies.createVisualReferenceVerifier(),
        createReservation:
          dependencies.createReservation,
        createSubmission:
          dependencies.createSubmission,
      },
    );

  return [
    field("GOOGLE_GENAI_OPERATOR_RESULT", "SUBMITTED"),
    field("EPISODE_ID", result.episodeId),
    field("SHOT_ID", result.shotId),
    field("PROVIDER", result.provider),
    field("MODEL", result.model),
    field("RESOLUTION", result.resolution),
    field("EXPECTED_COST_MICRO_USD", result.expectedMicroUsd),
    field("COST_CAP_MICRO_USD", result.maxExpectedCostMicroUsd),
    field("RESERVATION_ID", result.reservationId),
    field("PROVIDER_EXECUTION_ID_SHA256", sha256(result.providerExecutionId)),
    field("SUBMISSION_PATH", result.submissionPath),
    field("NEXT_ACTION", "reconcile"),
  ];
}

async function runReconcile(
  options:
    Extract<
      ReturnType<typeof parseGoogleGenAiOperatorCliArgs>,
      { subcommand: "reconcile" }
    >,
  dependencies:
    RunGoogleGenAiOperatorCliDependencies,
): Promise<readonly string[]> {
  // Recovery never loads the activation policy or reads the new-submission switch.
  const env =
    await step(
      "ENVIRONMENT_INVALID",
      "ENVIRONMENT",
      () =>
        dependencies.loadEnvironment(),
    );

  const apiKey =
    env.GEMINI_API_KEY;

  if (
    apiKey ===
    undefined
  ) {
    throw fail(
      "CREDENTIAL_MISSING",
      "ENVIRONMENT",
    );
  }

  const rules =
    await step(
      "CONFIG_INVALID",
      "LOAD",
      () =>
        dependencies.loadProductionRules(),
    );

  const mediaRoot =
    await step(
      "MEDIA_ROOT_INVALID",
      "ENVIRONMENT",
      () =>
        dependencies.validateMediaRoot(
          env,
          rules,
        ),
    );

  const {
    submittedRecovery,
  } = await step(
    "CREDENTIAL_INVALID",
    "CREDENTIAL",
    () =>
      dependencies.createDependencies(
        apiKey,
      ),
  );

  const reservation =
    await step(
      "LIFECYCLE_INVALID",
      "LIFECYCLE",
      () =>
        dependencies.readReservation(
          mediaRoot,
          options.episodeId,
          options.shotId,
        ),
    );

  if (!reservation) {
    throw fail(
      "NO_LIFECYCLE",
      "LIFECYCLE",
    );
  }

  if (
    reservation.provider !==
    "GOOGLE_GENAI"
  ) {
    throw fail(
      "INCOMPATIBLE_PROVIDER_STATE",
      "LIFECYCLE",
    );
  }

  const inspection =
    await step(
      "LIFECYCLE_INVALID",
      "LIFECYCLE",
      () =>
        dependencies.inspectGoogleLifecycle(
          mediaRoot,
          options.episodeId,
          options.shotId,
        ),
    );

  if (
    inspection.state ===
    "RESERVED_ONLY"
  ) {
    throw fail(
      "RESERVED_WITHOUT_SUBMISSION",
      "LIFECYCLE",
    );
  }

  let result:
    Awaited<ReturnType<typeof reconcileGoogleGenAiExecutionLifecycle>>;

  try {
    result =
      await dependencies.reconcile(
        {
          mediaRoot,
          episodeId:
            options.episodeId,
          shotId:
            options.shotId,
        },
        {
          submittedRecovery,
        },
      );
  } catch (error) {
    throw recoveryFailure(
      error,
    );
  }

  const output =
    result.generationRecord
      .outputs[0];

  if (!output) {
    throw fail(
      "RECONCILE_FAILED",
      "RECONCILE",
      "UNKNOWN",
    );
  }

  return [
    field("GOOGLE_GENAI_OPERATOR_RESULT", "COMPLETED"),
    field("RECONCILIATION_MODE", result.reconciliationMode),
    field("EPISODE_ID", options.episodeId),
    field("SHOT_ID", options.shotId),
    field("PROVIDER", result.provider),
    field("PROVIDER_EXECUTION_ID_SHA256", sha256(result.providerExecutionId)),
    field("OUTPUT_PATH", output.destinationPath),
    field("OUTPUT_BYTES", output.bytes),
    field("OUTPUT_SHA256", output.sha256),
    field("CONTENT_TYPE", output.contentType),
    field("GENERATION_RECORD_PATH", result.generationRecordPath),
    field("COMPLETION_PATH", result.completionPath),
  ];
}

export async function runGoogleGenAiOperatorCli(
  args:
    readonly string[] =
      process.argv.slice(
        2,
      ),
  dependencies:
    RunGoogleGenAiOperatorCliDependencies =
      defaultDependencies,
): Promise<number> {
  let subcommand =
    "UNKNOWN";

  try {
    let options:
      ReturnType<typeof parseGoogleGenAiOperatorCliArgs>;

    try {
      options =
        parseGoogleGenAiOperatorCliArgs(
          args,
        );
    } catch {
      throw fail(
        "USAGE_INVALID",
        "ARGS",
      );
    }

    subcommand =
      options.subcommand;

    const lines =
      options.subcommand ===
        "execute"
        ? await runExecute(
            options,
            dependencies,
          )
        : await runReconcile(
            options,
            dependencies,
          );

    for (
      const line of lines
    ) {
      dependencies.writeStdout(
        line,
      );
    }

    return GOOGLE_GENAI_OPERATOR_EXIT_CODES.SUCCESS;
  } catch (error) {
    const failure =
      classify(
        error,
        subcommand ===
          "reconcile"
          ? "RECONCILE"
          : subcommand ===
              "execute"
            ? "SUBMISSION"
            : "ARGS",
      );

    const entry =
      GOOGLE_GENAI_OPERATOR_ERROR_TABLE[
        failure.code
      ];

    const lines = [
      field("GOOGLE_GENAI_OPERATOR_RESULT", "FAILED"),
      field("SUBCOMMAND", subcommand),
      field("ERROR_CODE", failure.code),
      field("STAGE", failure.stage),
      field("STATE_CHANGE", failure.stateChange),
      field("RETRYABLE", failure.retryable === true ? "YES" : "NO"),
      ...(failure.transportCode === undefined
        ? []
        : [field("TRANSPORT_CODE", failure.transportCode)]),
      field("MESSAGE", entry.message),
    ];

    try {
      for (
        const line of lines
      ) {
        dependencies.writeStderr(
          line,
        );
      }
    } catch {
      // Output failure must not change the exit code or rethrow.
    }

    return entry.exitCode;
  }
}
