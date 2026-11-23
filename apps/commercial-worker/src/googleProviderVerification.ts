import type { ProviderVerificationResultReport } from "./providerVerificationContract.js";
import type { ProviderVerificationRawOutcome, ProviderVerificationRequest } from "./providerVerificationTransport.js";

// R44B11F Phase 6: the fixed Google verification request and the complete
// Google classifier (architecture "Fixed requests", "Result classification",
// "Success shapes", "Google authentication and authorization semantics").
// Pure and synchronous: no I/O, no clock, no state, no logging. Only the
// machine-readable error fields are read; no provider message is inspected.

const VERIFIED: ProviderVerificationResultReport = Object.freeze({ outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" });
const CREDENTIAL_REJECTED: ProviderVerificationResultReport = Object.freeze({ outcome: "DEFINITIVE_FAILURE", reasonCode: "CREDENTIAL_REJECTED" });
const CREDENTIAL_NOT_AUTHORIZED: ProviderVerificationResultReport = Object.freeze({ outcome: "DEFINITIVE_FAILURE", reasonCode: "CREDENTIAL_NOT_AUTHORIZED" });
const TIMEOUT: ProviderVerificationResultReport = Object.freeze({ outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_TIMEOUT" });
const AMBIGUOUS: ProviderVerificationResultReport = Object.freeze({ outcome: "INCONCLUSIVE", reasonCode: "VERIFICATION_AMBIGUOUS" });
const NETWORK_FAILURE: ProviderVerificationResultReport = Object.freeze({ outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_NETWORK_FAILURE" });
const TOO_LARGE: ProviderVerificationResultReport = Object.freeze({ outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_RESPONSE_TOO_LARGE" });
const MALFORMED: ProviderVerificationResultReport = Object.freeze({ outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_RESPONSE_MALFORMED" });
const DRIFT: ProviderVerificationResultReport = Object.freeze({ outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_OPERATION_DRIFT" });
const BILLING: ProviderVerificationResultReport = Object.freeze({ outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_BILLING_RESTRICTION" });
const RATE_OR_QUOTA: ProviderVerificationResultReport = Object.freeze({ outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_RATE_OR_QUOTA_LIMITED" });
const UNAVAILABLE: ProviderVerificationResultReport = Object.freeze({ outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_UNAVAILABLE" });
const UNEXPECTED_STATUS: ProviderVerificationResultReport = Object.freeze({ outcome: "INCONCLUSIVE", reasonCode: "PROVIDER_UNEXPECTED_STATUS" });

const ERROR_INFO_TYPE = "type.googleapis.com/google.rpc.ErrorInfo";

// The complete literal; never assembled from parts, configuration or input.
export function buildGoogleVerificationRequest(credential: string): ProviderVerificationRequest {
  return Object.freeze({
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    headers: Object.freeze({ "x-goog-api-key": credential }),
  });
}

type JsonObject = Readonly<Record<string, unknown>>;
const NOT_JSON = Symbol("not JSON");

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);
const own = (object: JsonObject, member: string): unknown => (Object.hasOwn(object, member) ? object[member] : undefined);

// Fatal UTF-8 decoding, then JSON.parse. A decoding or parse failure, or an
// empty body, is not JSON.
function decodeJson(body: Uint8Array): unknown {
  if (body.byteLength === 0) return NOT_JSON;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return NOT_JSON;
  }
}

// A non-null, non-array object with no own error member whose own models
// member, when present, is an array.
function hasSuccessShape(value: unknown): boolean {
  if (!isObject(value) || Object.hasOwn(value, "error")) return false;
  return !Object.hasOwn(value, "models") || Array.isArray(value.models);
}

// The structured error object of a Google API error envelope, or null.
function errorOf(body: Uint8Array): JsonObject | null {
  const parsed = decodeJson(body);
  if (!isObject(parsed)) return null;
  const error = own(parsed, "error");
  return isObject(error) ? error : null;
}

const statusIs = (error: JsonObject | null, expected: string): boolean => error !== null && own(error, "status") === expected;

function hasBillingDisabledReason(error: JsonObject | null): boolean {
  if (error === null) return false;
  const details = own(error, "details");
  if (!Array.isArray(details)) return false;
  return details.some((detail: unknown) => isObject(detail) && own(detail, "@type") === ERROR_INFO_TYPE && own(detail, "reason") === "BILLING_DISABLED");
}

// First match wins, in the locked table order.
export function classifyGoogleVerificationOutcome(outcome: ProviderVerificationRawOutcome): ProviderVerificationResultReport {
  if (outcome.kind === "TIMEOUT") return TIMEOUT;
  if (outcome.kind === "CALLER_ABORT") return AMBIGUOUS;
  if (outcome.kind === "NETWORK_FAILURE") return NETWORK_FAILURE;
  if (outcome.kind === "BODY_TOO_LARGE") return TOO_LARGE;
  const { status, body } = outcome;
  if (status === 200) {
    const parsed = decodeJson(body);
    return parsed !== NOT_JSON && hasSuccessShape(parsed) ? VERIFIED : MALFORMED;
  }
  if (status === 0 || (status >= 300 && status <= 399)) return DRIFT;
  if (status === 400) return AMBIGUOUS;
  if (status === 401) return statusIs(errorOf(body), "UNAUTHENTICATED") ? CREDENTIAL_REJECTED : AMBIGUOUS;
  if (status === 402) return BILLING;
  if (status === 403) {
    const error = errorOf(body);
    if (hasBillingDisabledReason(error)) return BILLING;
    return statusIs(error, "PERMISSION_DENIED") ? CREDENTIAL_NOT_AUTHORIZED : AMBIGUOUS;
  }
  if (status === 404 || status === 405 || status === 410) return DRIFT;
  if (status === 429) return RATE_OR_QUOTA;
  if (status >= 500 && status <= 599) return UNAVAILABLE;
  return UNEXPECTED_STATUS;
}
