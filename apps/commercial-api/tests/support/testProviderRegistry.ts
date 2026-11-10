import type { ProviderCapability, ProviderCapabilityRegistry } from "../../src/providerConnections/providerCapabilityRegistry.js";

// TEST FIXTURE ONLY. A capability registry with fictitious providers, used to
// exercise ProviderConnection behaviour. No real provider is enabled anywhere:
// commercial enablement is an open product decision.

const CAPABILITIES: readonly ProviderCapability[] = [
  { provider: "TEST_PROVIDER", connectionCreationEnabled: true, credentialKinds: ["API_KEY"] },
  { provider: "SECOND_TEST_PROVIDER", connectionCreationEnabled: true, credentialKinds: ["API_KEY"] },
  { provider: "DISABLED_TEST_PROVIDER", connectionCreationEnabled: false, credentialKinds: ["API_KEY"] },
  { provider: "OAUTH_ONLY_TEST_PROVIDER", connectionCreationEnabled: true, credentialKinds: ["OAUTH"] },
];

export function createTestProviderRegistry(): ProviderCapabilityRegistry {
  const byProvider = new Map(CAPABILITIES.map((capability) => [capability.provider, Object.freeze({ ...capability, credentialKinds: Object.freeze([...capability.credentialKinds]) })]));
  return Object.freeze({ resolve: (provider: string) => byProvider.get(provider) ?? null });
}
