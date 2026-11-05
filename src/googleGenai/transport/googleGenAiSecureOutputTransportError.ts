export const GOOGLE_GENAI_SECURE_OUTPUT_TRANSPORT_ERROR_CODES = Object.freeze([
  "SSE_HEADERS_TIMEOUT", "SSE_IDLE_TIMEOUT", "SSE_ATTEMPT_TIMEOUT",
  "SSE_RESPONSE_TOO_LARGE", "SSE_EVENT_TOO_LARGE", "SSE_EVENT_LIMIT_EXCEEDED",
  "SSE_MALFORMED_EVENT", "SSE_HTTP_FAILED", "SSE_PROVIDER_ERROR",
  "INTERACTION_REPLAY_CONTRACT_CHANGED", "DOWNLOAD_URI_INVALID",
  "FILES_METADATA_TIMEOUT", "FILES_METADATA_HTTP_FAILED", "FILES_METADATA_INVALID",
  "FILES_METADATA_RESPONSE_TOO_LARGE", "FILE_IDENTITY_MISMATCH", "FILE_NOT_ACTIVE",
  "FILE_MIME_INVALID", "FILE_TOO_LARGE", "FILE_EXPIRATION_INVALID",
  "FILE_EXPIRATION_TOO_CLOSE", "FILE_HASH_FORMAT_UNSUPPORTED", "DOWNLOAD_TIMEOUT",
  "DOWNLOAD_HTTP_FAILED", "DOWNLOAD_REDIRECT_REJECTED", "DOWNLOAD_CONTENT_TYPE_INVALID",
  "DOWNLOAD_CONTENT_LENGTH_INVALID", "DOWNLOAD_TOO_LARGE", "DOWNLOAD_SIZE_MISMATCH",
  "DOWNLOAD_HASH_MISMATCH", "DOWNLOAD_MP4_INVALID", "TEMP_WRITE_FAILED",
  "OUTPUT_PUBLICATION_CONFLICT", "OUTPUT_PUBLICATION_FAILED", "TEMP_CLEANUP_FAILED",
  "RECOVERY_HORIZON_EXCEEDED", "RECOVERY_BUDGET_EXHAUSTED", "RECONCILIATION_TIMEOUT",
  "OPERATION_ABORTED", "SECURE_TRANSPORT_CONFIGURATION_INVALID", "CREDENTIALS_INVALID",
] as const);

export type GoogleGenAiSecureOutputTransportErrorCode =
  typeof GOOGLE_GENAI_SECURE_OUTPUT_TRANSPORT_ERROR_CODES[number];

export const GOOGLE_GENAI_REPLAY_CONTRACT_STAGES = Object.freeze([
  "SSE_VALUE_NOT_OBJECT",
  "SSE_UNKNOWN_KEY",
  "SSE_REQUIRED_KEY_MISSING",
  "SSE_INVALID_NUMBER",
  "SSE_INVALID_BOUNDED_ARRAY",
  "SSE_USAGE_SHAPE_CHANGED",
  "SSE_STATUS_MISSING",
  "SSE_STATUS_UNKNOWN",
  "SSE_IDENTITY_MISMATCH",
  "SSE_STATUS_REGRESSION",
  "SSE_EVENT_AFTER_TERMINAL",
  "SSE_INTERACTION_SNAPSHOT_CHANGED",
  "SSE_CONTINUATION_TOKEN_CHANGED",
  "SSE_COMPLETION_PRECONDITION_FAILED",
  "SSE_EVENT_BEFORE_CREATED",
  "SSE_EVENT_KIND_UNKNOWN",
  "SSE_EVENT_INDEX_INVALID",
  "SSE_STEP_ORDER_INVALID",
  "SSE_STEP_SHAPE_CHANGED",
  "SSE_STEP_STATE_INVALID",
  "SSE_THOUGHT_DELTA_CHANGED",
  "SSE_VIDEO_DELTA_CHANGED",
  "SSE_RESULT_TRAILING_EVENT",
  "SSE_TERMINAL_FRAME_CHANGED",
  "SSE_EVENT_ID_CHANGED",
  "SSE_PUSH_AFTER_TERMINAL",
  "SSE_FINISH_REPEATED",
  "SSE_FINAL_PENDING_STATE_INVALID",
  "REPLAY_PROVIDER_EXECUTION_ID_INVALID",
  "REPLAY_URL_CONTRACT_CHANGED",
] as const);

export type GoogleGenAiReplayContractStage =
  typeof GOOGLE_GENAI_REPLAY_CONTRACT_STAGES[number];

/** No provider message, URL, headers, credential, arbitrary cause or caller retry flag. */
export class GoogleGenAiSecureOutputTransportError extends Error {
  readonly code: GoogleGenAiSecureOutputTransportErrorCode;
  readonly attempt: number | undefined;
  readonly httpStatus: number | undefined;
  readonly stage: GoogleGenAiReplayContractStage | undefined;
  readonly retryable: boolean;

  constructor(
    code: GoogleGenAiSecureOutputTransportErrorCode,
    details: Readonly<{
      attempt?: number;
      httpStatus?: number;
      stage?: GoogleGenAiReplayContractStage;
    }> = {},
  ) {
    const candidateCode =
      GOOGLE_GENAI_SECURE_OUTPUT_TRANSPORT_ERROR_CODES.includes(code)
        ? code
        : "SECURE_TRANSPORT_CONFIGURATION_INVALID";

    const candidateStage =
      details.stage;

    const stageValid =
      candidateStage === undefined ||
      (
        candidateCode ===
          "INTERACTION_REPLAY_CONTRACT_CHANGED" &&
        GOOGLE_GENAI_REPLAY_CONTRACT_STAGES.includes(
          candidateStage,
        )
      );

    const safeCode =
      stageValid
        ? candidateCode
        : "SECURE_TRANSPORT_CONFIGURATION_INVALID";

    const safeStage =
      safeCode ===
        "INTERACTION_REPLAY_CONTRACT_CHANGED" &&
      candidateStage !== undefined &&
      GOOGLE_GENAI_REPLAY_CONTRACT_STAGES.includes(
        candidateStage,
      )
        ? candidateStage
        : undefined;

    super(`Google GenAI secure output transport failed (${safeCode}).`);
    this.name = "GoogleGenAiSecureOutputTransportError";
    this.code = safeCode;
    this.attempt = Number.isSafeInteger(details.attempt) && (details.attempt ?? 0) > 0
      ? details.attempt : undefined;
    this.httpStatus = Number.isInteger(details.httpStatus) && (details.httpStatus ?? 0) >= 100 && (details.httpStatus ?? 0) <= 599
      ? details.httpStatus : undefined;
    this.stage = safeStage;
    const transientHttp = this.httpStatus === undefined || this.httpStatus === 429 || this.httpStatus >= 500;
    this.retryable = ["SSE_HEADERS_TIMEOUT", "SSE_IDLE_TIMEOUT", "SSE_ATTEMPT_TIMEOUT", "FILES_METADATA_TIMEOUT", "DOWNLOAD_TIMEOUT"].includes(safeCode)
      || (["SSE_HTTP_FAILED", "FILES_METADATA_HTTP_FAILED", "DOWNLOAD_HTTP_FAILED"].includes(safeCode) && transientHttp);
    Object.freeze(this);
  }
}
