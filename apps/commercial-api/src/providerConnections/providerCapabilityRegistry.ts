// Server-side, versioned capability registry for commercial provider
// connections. Provider identifiers are controlled vocabulary: a customer
// can only connect a provider the registry resolves with creation enabled.
//
// Which real providers are commercially enabled is an open product decision
// (provider-connection architecture, section 30). Production source therefore
// holds this contract and no provider entries; the default process installs
// no provider-connection routes at all. Tests supply their own registry.
//
// R44B11F customer verification is a separate, default-off capability. A
// verification request may create work only when the provider's capability
// explicitly sets verificationEnabled to true AND names its fixed
// verification policy ID. The policy ID is opaque to commercial-api: it is
// shape-checked here and in migration 0010, stored immutably on the job, and
// interpreted only by the worker-side fixed verification transport. Enabling
// this capability alone never enables real-provider verification: the
// worker keeps its own independent kill switch.

export type ProviderCredentialKind = "API_KEY";

export type ProviderCapability = Readonly<{
  provider: string;
  connectionCreationEnabled: boolean;
  credentialKinds: readonly string[];
  // R44B11F: default-off. Both fields must be explicit; null or false
  // refuses every verification request for this provider.
  verificationEnabled: boolean;
  verificationPolicyId: string | null;
}>;

export type ProviderCapabilityRegistry = Readonly<{
  // Returns a frozen capability, or null for an unknown provider.
  resolve: (provider: string) => ProviderCapability | null;
}>;

// Mirrors provider_verification_jobs_policy_ck (migration 0010).
const VERIFICATION_POLICY_ID_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const MAX_VERIFICATION_POLICY_ID_LENGTH = 128;

export function isStructurallyValidVerificationPolicyId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_VERIFICATION_POLICY_ID_LENGTH && VERIFICATION_POLICY_ID_PATTERN.test(value);
}

// The verification policy ID for a provider, or null when the registry does
// not explicitly enable verification with a structurally valid policy ID.
// Fails closed for an unknown provider or a capability for another provider.
export function resolveVerificationPolicyId(registry: ProviderCapabilityRegistry, provider: string): string | null {
  const capability = registry.resolve(provider);
  if (capability === null || capability.provider !== provider || capability.verificationEnabled !== true) return null;
  return isStructurallyValidVerificationPolicyId(capability.verificationPolicyId) ? capability.verificationPolicyId : null;
}
