// Server-side, versioned capability registry for commercial provider
// connections. Provider identifiers are controlled vocabulary: a customer
// can only connect a provider the registry resolves with creation enabled.
//
// Which real providers are commercially enabled is an open product decision
// (provider-connection architecture, section 30). Production source therefore
// holds this contract and no provider entries; the default process installs
// no provider-connection routes at all. Tests supply their own registry.

export type ProviderCredentialKind = "API_KEY";

export type ProviderCapability = Readonly<{
  provider: string;
  connectionCreationEnabled: boolean;
  credentialKinds: readonly string[];
}>;

export type ProviderCapabilityRegistry = Readonly<{
  // Returns a frozen capability, or null for an unknown provider.
  resolve: (provider: string) => ProviderCapability | null;
}>;
