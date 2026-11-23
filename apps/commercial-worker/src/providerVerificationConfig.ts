import { WorkerError } from "./workerError.js";

// R44B11F Phase 5: the provider-verification kill switch and live gate
// (architecture "Verification kill switch"). Parsed from an environment
// record injected by the caller, in the style of workerConfig.ts; no worker
// module reads the process environment for it.
//
// The configuration type has no enabled member: no supported configuration
// permits a real provider call, and the live gate refuses every one. Enabling
// requires a later explicit live-enablement amendment.

export const PROVIDER_VERIFICATION_CONFIG_KEY = "COMMERCIAL_WORKER_LIVE_PROVIDER_VERIFICATION";

export type ProviderVerificationConfig = Readonly<{ liveVerification: "DISABLED" }>;

const DISABLED: ProviderVerificationConfig = Object.freeze({ liveVerification: "DISABLED" });

// Reads only its one key, exactly by name, with no trimming or case folding.
// Missing is DISABLED; exactly "disabled" is DISABLED; anything else is
// invalid and never echoed.
export function loadProviderVerificationConfig(environment: Readonly<Record<string, string | undefined>>): ProviderVerificationConfig {
  const value = environment[PROVIDER_VERIFICATION_CONFIG_KEY];
  if (value === undefined || value === "disabled") return DISABLED;
  throw new WorkerError("PROVIDER_VERIFICATION_CONFIG_INVALID");
}

// Throws for every Phase 5 configuration.
export function requireLiveProviderVerification(config: ProviderVerificationConfig): void {
  void config;
  throw new WorkerError("PROVIDER_VERIFICATION_DISABLED");
}
