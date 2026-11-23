import { GOOGLE_PROVIDER_ID, RUNWAY_PROVIDER_ID } from "commercial-worker-protocol";

// R44B11F Phase 5: the pure worker-side provider-verification vocabulary and
// pre-grant admission (architecture "Closed vocabulary and pre-grant
// admission"). No I/O, no environment, no network, no timer.
//
// The two provider identities are the canonical R44B11A constants imported
// from the shared protocol package (conflict repair C1); this module keeps no
// local copy of either. The outcome and reason vocabulary and the two policy
// identifiers stay worker-local literals: no runtime authority exports them
// to the worker. Drift against their canonical sources is caught by tests.

export const PROVIDER_VERIFICATION_OUTCOMES = Object.freeze(["VERIFIED", "DEFINITIVE_FAILURE", "INCONCLUSIVE"] as const);
export type ProviderVerificationOutcome = (typeof PROVIDER_VERIFICATION_OUTCOMES)[number];

// The Phase 3 worker-reportable table, unchanged and in order. The Phase 4
// reconciliation reasons are not worker-reportable and are absent.
export const PROVIDER_VERIFICATION_REASONS_BY_OUTCOME = Object.freeze({
  VERIFIED: Object.freeze(["VERIFICATION_SUCCEEDED"] as const),
  DEFINITIVE_FAILURE: Object.freeze(["CREDENTIAL_REJECTED", "CREDENTIAL_NOT_AUTHORIZED"] as const),
  INCONCLUSIVE: Object.freeze([
    "PROVIDER_BILLING_RESTRICTION",
    "PROVIDER_RATE_OR_QUOTA_LIMITED",
    "PROVIDER_UNAVAILABLE",
    "PROVIDER_TIMEOUT",
    "PROVIDER_NETWORK_FAILURE",
    "PROVIDER_RESPONSE_MALFORMED",
    "PROVIDER_RESPONSE_TOO_LARGE",
    "PROVIDER_UNEXPECTED_STATUS",
    "PROVIDER_OPERATION_DRIFT",
    "VERIFICATION_AMBIGUOUS",
  ] as const),
});
export type ProviderVerificationReasonCode = (typeof PROVIDER_VERIFICATION_REASONS_BY_OUTCOME)[ProviderVerificationOutcome][number];

export type ProviderVerificationResultReport = Readonly<{ outcome: ProviderVerificationOutcome; reasonCode: ProviderVerificationReasonCode }>;

const isOutcome = (value: unknown): value is ProviderVerificationOutcome =>
  typeof value === "string" && (PROVIDER_VERIFICATION_OUTCOMES as readonly string[]).includes(value);

// Accepts only an outcome and reason pair from the table above.
export function isProviderVerificationResultReport(value: unknown): value is ProviderVerificationResultReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { outcome, reasonCode } = value as Record<string, unknown>;
  if (!isOutcome(outcome) || typeof reasonCode !== "string") return false;
  return (PROVIDER_VERIFICATION_REASONS_BY_OUTCOME[outcome] as readonly string[]).includes(reasonCode);
}

// The fixed supported pairs: provider by canonical constant, policy by
// worker-local literal.
export const SUPPORTED_PROVIDER_VERIFICATION_PAIRS = Object.freeze([
  Object.freeze({ provider: GOOGLE_PROVIDER_ID, verificationPolicyId: "GOOGLE_GENAI_MODELS_LIST_V1BETA" }),
  Object.freeze({ provider: RUNWAY_PROVIDER_ID, verificationPolicyId: "RUNWAY_ORGANIZATION_GET_V1_2024_11_06" }),
] as const);

export type ProviderVerificationAdmission =
  | Readonly<{ status: "SUPPORTED"; provider: string; verificationPolicyId: string }>
  | Readonly<{ status: "REFUSED"; reason: "UNSUPPORTED_PROVIDER" | "UNSUPPORTED_POLICY" | "PROVIDER_POLICY_MISMATCH" }>;

const refused = (reason: "UNSUPPORTED_PROVIDER" | "UNSUPPORTED_POLICY" | "PROVIDER_POLICY_MISMATCH"): ProviderVerificationAdmission =>
  Object.freeze({ status: "REFUSED", reason });

// Structural admission only: it proves the lease names an operation this
// contract knows and never authorizes execution. Exact, case-sensitive
// comparison, in the locked precedence.
export function classifyProviderVerificationLease(lease: Readonly<{ provider: string; verificationPolicyId: string }>): ProviderVerificationAdmission {
  const { provider, verificationPolicyId } = lease;
  if (!SUPPORTED_PROVIDER_VERIFICATION_PAIRS.some((pair) => pair.provider === provider)) return refused("UNSUPPORTED_PROVIDER");
  if (!SUPPORTED_PROVIDER_VERIFICATION_PAIRS.some((pair) => pair.verificationPolicyId === verificationPolicyId)) return refused("UNSUPPORTED_POLICY");
  if (!SUPPORTED_PROVIDER_VERIFICATION_PAIRS.some((pair) => pair.provider === provider && pair.verificationPolicyId === verificationPolicyId)) {
    return refused("PROVIDER_POLICY_MISMATCH");
  }
  return Object.freeze({ status: "SUPPORTED", provider, verificationPolicyId });
}
