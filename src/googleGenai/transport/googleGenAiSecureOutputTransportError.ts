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

/** No provider message, URL, headers, credential, arbitrary cause or caller retry flag. */
export class GoogleGenAiSecureOutputTransportError extends Error {
  readonly code: GoogleGenAiSecureOutputTransportErrorCode;
  readonly attempt: number | undefined;
  readonly httpStatus: number | undefined;
  readonly retryable: boolean;

  constructor(
    code: GoogleGenAiSecureOutputTransportErrorCode,
    details: Readonly<{ attempt?: number; httpStatus?: number }> = {},
  ) {
    const safeCode = GOOGLE_GENAI_SECURE_OUTPUT_TRANSPORT_ERROR_CODES.includes(code)
      ? code : "SECURE_TRANSPORT_CONFIGURATION_INVALID";
    super(`Google GenAI secure output transport failed (${safeCode}).`);
    this.name = "GoogleGenAiSecureOutputTransportError";
    this.code = safeCode;
    this.attempt = Number.isSafeInteger(details.attempt) && (details.attempt ?? 0) > 0
      ? details.attempt : undefined;
    this.httpStatus = Number.isInteger(details.httpStatus) && (details.httpStatus ?? 0) >= 100 && (details.httpStatus ?? 0) <= 599
      ? details.httpStatus : undefined;
    const transientHttp = this.httpStatus === undefined || this.httpStatus === 429 || this.httpStatus >= 500;
    this.retryable = ["SSE_HEADERS_TIMEOUT", "SSE_IDLE_TIMEOUT", "SSE_ATTEMPT_TIMEOUT", "FILES_METADATA_TIMEOUT", "DOWNLOAD_TIMEOUT"].includes(safeCode)
      || (["SSE_HTTP_FAILED", "FILES_METADATA_HTTP_FAILED", "DOWNLOAD_HTTP_FAILED"].includes(safeCode) && transientHttp);
    Object.freeze(this);
  }
}
