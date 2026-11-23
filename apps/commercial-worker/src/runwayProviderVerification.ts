import type { ProviderVerificationResultReport } from "./providerVerificationContract.js";
import type { ProviderVerificationRawOutcome, ProviderVerificationRequest } from "./providerVerificationTransport.js";

// R44B11F Phase 6: the fixed second-provider verification request and its
// complete classifier (architecture "Fixed requests", "Result
// classification", "Success shapes", "Runway 401, 403 and 404 semantics").
// Pure and synchronous: no I/O, no clock, no state, no logging. The 401
// decision is made on the status alone; no provider message is inspected.

const VERIFIED: ProviderVerificationResultReport = Object.freeze({ outcome: "VERIFIED", reasonCode: "VERIFICATION_SUCCEEDED" });
const CREDENTIAL_REJECTED: ProviderVerificationResultReport = Object.freeze({ outcome: "DEFINITIVE_FAILURE", reasonCode: "CREDENTIAL_REJECTED" });
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

// The complete literals; never assembled from parts, configuration or input.
export function buildRunwayVerificationRequest(credential: string): ProviderVerificationRequest {
  return Object.freeze({
    url: "https://api.dev.runwayml.com/v1/organization",
    headers: Object.freeze({ Authorization: `Bearer ${credential}`, "X-Runway-Version": "2024-11-06" }),
  });
}

// Fatal UTF-8 decoding, then JSON.parse; the success shape is a non-null,
// non-array object with no own error member. An empty body is not JSON.
function hasSuccessShape(body: Uint8Array): boolean {
  if (body.byteLength === 0) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return false;
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && !Object.hasOwn(parsed, "error");
}

// First match wins, in the locked table order.
export function classifyRunwayVerificationOutcome(outcome: ProviderVerificationRawOutcome): ProviderVerificationResultReport {
  if (outcome.kind === "TIMEOUT") return TIMEOUT;
  if (outcome.kind === "CALLER_ABORT") return AMBIGUOUS;
  if (outcome.kind === "NETWORK_FAILURE") return NETWORK_FAILURE;
  if (outcome.kind === "BODY_TOO_LARGE") return TOO_LARGE;
  const { status, body } = outcome;
  if (status === 200) return hasSuccessShape(body) ? VERIFIED : MALFORMED;
  if (status === 0 || (status >= 300 && status <= 399)) return DRIFT;
  if (status === 400) return AMBIGUOUS;
  if (status === 401) return CREDENTIAL_REJECTED;
  if (status === 402) return BILLING;
  if (status === 403) return AMBIGUOUS;
  if (status === 404 || status === 405 || status === 410) return DRIFT;
  if (status === 429) return RATE_OR_QUOTA;
  if (status >= 500 && status <= 599) return UNAVAILABLE;
  return UNEXPECTED_STATUS;
}
