import { describe, expect, it } from "vitest";

import {
  loadProviderVerificationConfig,
  PROVIDER_VERIFICATION_CONFIG_KEY,
  requireLiveProviderVerification,
  type ProviderVerificationConfig,
} from "../src/providerVerificationConfig.js";
import { WorkerError } from "../src/workerError.js";

// R44B11F Phase 5: the provider-verification kill switch and live gate
// (architecture "Verification kill switch"). Injected environment records
// only; the process environment is never consulted.

const KEY = "COMMERCIAL_WORKER_LIVE_PROVIDER_VERIFICATION";

// A distinctive value, so the no-echo check cannot match ordinary text.
const DISTINCT = "fixture-arbitrary-value-7f3a";

function configError(environment: Readonly<Record<string, string | undefined>>): string {
  let caught: unknown;
  try {
    loadProviderVerificationConfig(environment);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(WorkerError);
  // Fixed text and no cause: the supplied value is never echoed.
  expect((caught as Error).message).toBe("The provider verification configuration is invalid.");
  expect((caught as Error).cause).toBeUndefined();
  const visible = `${(caught as Error).message} ${JSON.stringify(caught)} ${String((caught as Error).stack)}`;
  expect(visible.includes(DISTINCT)).toBe(false);
  return (caught as WorkerError).code;
}

describe("provider verification kill switch", () => {
  it("reads exactly the locked key", () => {
    expect(PROVIDER_VERIFICATION_CONFIG_KEY).toBe(KEY);
  });

  it("is DISABLED when the key is missing and when it is exactly disabled", () => {
    expect(loadProviderVerificationConfig({})).toEqual({ liveVerification: "DISABLED" });
    expect(loadProviderVerificationConfig({ [KEY]: undefined })).toEqual({ liveVerification: "DISABLED" });
    expect(loadProviderVerificationConfig({ [KEY]: "disabled" })).toEqual({ liveVerification: "DISABLED" });
    expect(Object.isFrozen(loadProviderVerificationConfig({}))).toBe(true);
  });

  it("rejects every other value with PROVIDER_VERIFICATION_CONFIG_INVALID, without echoing it", () => {
    for (const value of [
      "",
      "enabled",
      "ENABLED",
      "true",
      "1",
      "yes",
      "on",
      "DISABLED",
      "Disabled",
      " disabled",
      "disabled ",
      "disabled\n",
      "\tdisabled",
      "disabled,enabled",
      "live",
      DISTINCT,
    ]) {
      expect(configError({ [KEY]: value }), JSON.stringify(value)).toBe("PROVIDER_VERIFICATION_CONFIG_INVALID");
    }
  });

  it("has no enabled configuration: the live gate refuses every configuration the loader returns", () => {
    for (const environment of [{}, { [KEY]: "disabled" }]) {
      const config = loadProviderVerificationConfig(environment);
      expect(config.liveVerification).toBe("DISABLED");
      expect(() => requireLiveProviderVerification(config)).toThrow(WorkerError);
      try {
        requireLiveProviderVerification(config);
      } catch (error) {
        expect((error as WorkerError).code).toBe("PROVIDER_VERIFICATION_DISABLED");
        expect((error as Error).message).toBe("Live provider verification is disabled.");
      }
    }
    // Even a forged value outside the type does not pass the gate.
    const forged = { liveVerification: "ENABLED" } as unknown as ProviderVerificationConfig;
    expect(() => requireLiveProviderVerification(forged)).toThrow("Live provider verification is disabled.");
  });

  it("reads only the injected record: other keys, including the submission switch, have no effect", () => {
    const others = {
      WORKER_LIVE_PROVIDER_SUBMISSION_ENABLED: "YES",
      COMMERCIAL_WORKER_ENV: "production",
      COMMERCIAL_WORKER_STATE_ROOT: "/var/lib/busybookie/commercial-worker",
      commercial_worker_live_provider_verification: "enabled",
      [`${KEY}_ENABLED`]: "true",
    };
    expect(loadProviderVerificationConfig(others)).toEqual({ liveVerification: "DISABLED" });
    expect(loadProviderVerificationConfig({ ...others, [KEY]: "disabled" })).toEqual({ liveVerification: "DISABLED" });
    expect(configError({ ...others, [KEY]: "enabled" })).toBe("PROVIDER_VERIFICATION_CONFIG_INVALID");
  });

  it("does not consult the process environment", () => {
    const previous = process.env[KEY];
    process.env[KEY] = "enabled";
    try {
      expect(loadProviderVerificationConfig({})).toEqual({ liveVerification: "DISABLED" });
    } finally {
      if (previous === undefined) delete process.env[KEY];
      else process.env[KEY] = previous;
    }
    // And a process-level "disabled" does not rescue an invalid injected value.
    expect(configError({ [KEY]: "true" })).toBe("PROVIDER_VERIFICATION_CONFIG_INVALID");
  });
});
