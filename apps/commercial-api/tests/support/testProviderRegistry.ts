import type { ProviderCapability, ProviderCapabilityRegistry } from "../../src/providerConnections/providerCapabilityRegistry.js";

// TEST FIXTURE ONLY. A capability registry with fictitious providers, used to
// exercise ProviderConnection behaviour. No real provider is enabled anywhere:
// commercial enablement is an open product decision.
//
// R44B11F: verification capability fixtures are fictitious too. The locked
// real-provider policy IDs are exercised only by tests that compose their own
// registry explicitly.

const CAPABILITIES: readonly ProviderCapability[] = [
  { provider: "TEST_PROVIDER", connectionCreationEnabled: true, credentialKinds: ["API_KEY"], verificationEnabled: true, verificationPolicyId: "TEST_PROVIDER_METADATA_V1" },
  {
    provider: "SECOND_TEST_PROVIDER",
    connectionCreationEnabled: true,
    credentialKinds: ["API_KEY"],
    verificationEnabled: true,
    verificationPolicyId: "SECOND_TEST_PROVIDER_METADATA_V1",
  },
  { provider: "DISABLED_TEST_PROVIDER", connectionCreationEnabled: false, credentialKinds: ["API_KEY"], verificationEnabled: false, verificationPolicyId: null },
  { provider: "OAUTH_ONLY_TEST_PROVIDER", connectionCreationEnabled: true, credentialKinds: ["OAUTH"], verificationEnabled: false, verificationPolicyId: null },
  // Connectable, but verification is default-off.
  { provider: "UNVERIFIABLE_TEST_PROVIDER", connectionCreationEnabled: true, credentialKinds: ["API_KEY"], verificationEnabled: false, verificationPolicyId: null },
  // A policy ID without the explicit enablement flag is still refused.
  {
    provider: "POLICY_ONLY_TEST_PROVIDER",
    connectionCreationEnabled: true,
    credentialKinds: ["API_KEY"],
    verificationEnabled: false,
    verificationPolicyId: "POLICY_ONLY_TEST_PROVIDER_METADATA_V1",
  },
  // Enabled without a structurally valid policy ID is refused.
  { provider: "MALFORMED_POLICY_TEST_PROVIDER", connectionCreationEnabled: true, credentialKinds: ["API_KEY"], verificationEnabled: true, verificationPolicyId: "lowercase-policy" },
  { provider: "MISSING_POLICY_TEST_PROVIDER", connectionCreationEnabled: true, credentialKinds: ["API_KEY"], verificationEnabled: true, verificationPolicyId: null },
];

export function createTestProviderRegistry(extra: readonly ProviderCapability[] = []): ProviderCapabilityRegistry {
  const byProvider = new Map(
    [...CAPABILITIES, ...extra].map((capability) => [capability.provider, Object.freeze({ ...capability, credentialKinds: Object.freeze([...capability.credentialKinds]) })]),
  );
  return Object.freeze({ resolve: (provider: string) => byProvider.get(provider) ?? null });
}
