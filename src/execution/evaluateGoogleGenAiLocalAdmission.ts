import type { CharacterBible } from "../schemas/character.schema.js";
import type { EpisodeManifest, Shot } from "../schemas/episodeManifest.schema.js";
import type { ProductionRules } from "../schemas/productionRules.schema.js";
import type { LoadedGoogleGenAiActivationPolicy } from "../validation/loadGoogleGenAiActivationPolicy.js";
import { assertEpisodeApprovals, assertShotCanProgress } from "../validation/validateEpisodeProduction.js";

export type GoogleLocalAdmissionInput = Readonly<{ episode: EpisodeManifest; bible: CharacterBible; rules: ProductionRules }>;
export const GOOGLE_GENAI_OPERATOR_ERROR_CODES =
  Object.freeze([
    "USAGE_INVALID",
    "ENVIRONMENT_INVALID",
    "CREDENTIAL_MISSING",
    "CREDENTIAL_INVALID",
    "CONFIG_INVALID",
    "EPISODE_INVALID",
    "MEDIA_ROOT_INVALID",
    "SHOT_NOT_FOUND",
    "SHOT_AMBIGUOUS",
    "EPISODE_STATUS_NOT_LIVE",
    "APPROVALS_MISSING",
    "SHOT_NOT_PROGRESSABLE",
    "SHOT_STATUS_NOT_APPROVED",
    "MANIFEST_PROVIDER_NOT_PAID",
    "NATIVE_AUDIO_REJECTED",
    "DIALOGUE_REJECTED",
    "AUDIO_DEPENDENT_SHOT_TYPE_REJECTED",
    "DURATION_EXCEEDS_LIMIT",
    "REFERENCES_NOT_APPROVED",
    "PROMPT_INVALID",
    "RESOLUTION_UNSUPPORTED",
    "PRICING_UNAVAILABLE",
    "CALCULATION_FAILED",
    "COST_EXCEEDS_CAP",
    "NEW_SUBMISSIONS_DISABLED",
    "CONFIRMATION_REQUIRED",
    "LIFECYCLE_EXISTS",
    "LIFECYCLE_UNREADABLE",
    "VISUAL_REFERENCE_UNVERIFIED",
    "REFERENCE_IMAGE_UNSUPPORTED",
    "REFERENCE_IMAGE_REJECTED",
    "RESERVATION_FAILED",
    "SUBMISSION_REFUSED_BEFORE_PROVIDER_CALL",
    "SUBMISSION_ACCEPTANCE_UNCERTAIN",
    "DURABLE_SUBMISSION_FAILED",
    "NO_LIFECYCLE",
    "INCOMPATIBLE_PROVIDER_STATE",
    "RESERVED_WITHOUT_SUBMISSION",
    "LIFECYCLE_INVALID",
    "RECOVERY_FAILED",
    "RECONCILE_FAILED",
    "INTERNAL_ERROR",
  ] as const);

export type GoogleGenAiOperatorErrorCode =
  typeof GOOGLE_GENAI_OPERATOR_ERROR_CODES[number];

export const GOOGLE_GENAI_OPERATOR_STAGES =
  Object.freeze([
    "ARGS",
    "ENVIRONMENT",
    "LOAD",
    "ADMISSION",
    "CREDENTIAL",
    "LIFECYCLE",
    "REFERENCE",
    "RESERVATION",
    "SUBMISSION",
    "RECONCILE",
  ] as const);

export type GoogleGenAiOperatorStage =
  typeof GOOGLE_GENAI_OPERATOR_STAGES[number];

export type GoogleGenAiOperatorStateChange =
  | "NONE"
  | "RESERVED_ONLY"
  | "SUBMITTED"
  | "UNKNOWN";

export class GoogleGenAiOperatorError extends Error {
  readonly code:
    GoogleGenAiOperatorErrorCode;

  readonly stage:
    GoogleGenAiOperatorStage;

  readonly stateChange:
    GoogleGenAiOperatorStateChange;

  constructor(
    code:
      GoogleGenAiOperatorErrorCode,
    stage:
      GoogleGenAiOperatorStage,
    stateChange:
      GoogleGenAiOperatorStateChange =
        "NONE",
  ) {
    super(
      `Google GenAI operator runner stopped (${code}).`,
    );

    this.name =
      "GoogleGenAiOperatorError";

    this.code =
      code;

    this.stage =
      stage;

    this.stateChange =
      stateChange;
  }
}

/** The only resolution with an authoritative local price (B4X1). */
export const GOOGLE_GENAI_OPERATOR_RESOLUTION =
  "720p" as const;

const LIVE_EPISODE_STATUSES: ReadonlySet<string> =
  new Set([
    "READY_FOR_GENERATION",
    "IN_PRODUCTION",
  ]);

const PAID_MANIFEST_PROVIDERS: ReadonlySet<string> =
  new Set([
    "RUNWAY",
    "VEO",
    // B5C-X1: an explicit GOOGLE_GENAI manifest (B5C-S1 selection).
    "GOOGLE_GENAI",
  ]);

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

/** Shot admission (B4X1 section 11 step 8), in the locked order. */
export async function evaluateGoogleGenAiLocalAdmission(
  request:
    GoogleLocalAdmissionInput,
  shot:
    Shot,
  activationPolicy:
    LoadedGoogleGenAiActivationPolicy,
): Promise<void> {
  if (
    !LIVE_EPISODE_STATUSES.has(
      request.episode.status,
    )
  ) {
    throw refuse(
      "EPISODE_STATUS_NOT_LIVE",
    );
  }

  await guarded(
    "APPROVALS_MISSING",
    "ADMISSION",
    () =>
      assertEpisodeApprovals(
        request.episode,
        request.rules,
      ),
  );

  await guarded(
    "SHOT_NOT_PROGRESSABLE",
    "ADMISSION",
    () =>
      assertShotCanProgress(
        shot,
        request.bible,
        request.rules,
      ),
  );

  if (
    shot.generation.status !==
    "APPROVED_FOR_GENERATION"
  ) {
    throw refuse(
      "SHOT_STATUS_NOT_APPROVED",
    );
  }

  if (
    !PAID_MANIFEST_PROVIDERS.has(
      shot.generation.provider,
    )
  ) {
    throw refuse(
      "MANIFEST_PROVIDER_NOT_PAID",
    );
  }

  if (
    shot.generation.nativeAudio !==
    false
  ) {
    throw refuse(
      "NATIVE_AUDIO_REJECTED",
    );
  }

  if (
    shot.dialogue.length >
      0 ||
    shot.type ===
      "DIALOGUE"
  ) {
    throw refuse(
      "DIALOGUE_REJECTED",
    );
  }

  if (
    shot.type ===
    "MUSICAL"
  ) {
    throw refuse(
      "AUDIO_DEPENDENT_SHOT_TYPE_REJECTED",
    );
  }

  if (
    typeof shot.durationSeconds !==
      "number" ||
    !Number.isFinite(
      shot.durationSeconds,
    ) ||
    shot.durationSeconds <=
      0 ||
    shot.durationSeconds >
      activationPolicy.cost
        .costAdmissionDurationSeconds
  ) {
    throw refuse(
      "DURATION_EXCEEDS_LIMIT",
    );
  }

  if (
    !shot.references.required ||
    shot.references.approvalStatus !==
      "APPROVED" ||
    shot.references.assetIds.length <
      1
  ) {
    throw refuse(
      "REFERENCES_NOT_APPROVED",
    );
  }
}
