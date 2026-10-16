import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AudioDeliveryPolicyV1Schema, checkAudioDeliveryPolicyV1, E5_MEASUREMENT_ENGINE, hashAudioDeliveryPolicyV1, validateAudioDeliveryPolicyV1,
} from "../src/editorial/audioDeliveryPolicy.schema.js";
import { canonicalEditorialJson, editorialSha256 } from "../src/editorial/canonicalizeEditorialPlan.js";

// Local, in-memory fixtures only (repeated per E5 test file; no shared helper path is authorized).
type AnyRecord = Record<string, any>;
function policy(overrides: AnyRecord = {}): AnyRecord {
  return {
    policyType: "BUSYBOOKIE_AUDIO_DELIVERY_POLICY", policyVersion: "1", policyId: "audio-delivery:test-episode",
    measurementEngine: "FFMPEG_LOUDNORM_INPUT_STATS_V1", targetIntegratedCentiLufs: -1600, integratedToleranceCentiLu: 100,
    truePeakCeilingCentiDbtp: -100, minimumGainCentiDb: -2000, maximumGainCentiDb: 1000, loudnessRangePolicy: "RECORD_ONLY",
    expectedAudio: { codecName: "aac", sampleRateHz: 48000, channels: 2, channelLayout: "stereo" }, ...overrides,
  };
}

describe("E5 AudioDeliveryPolicyV1", () => {
  it("T5-01 a complete integer centi-unit policy validates and hashes canonically", () => {
    const checked = checkAudioDeliveryPolicyV1(policy());
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.policySha256).toBe(editorialSha256(canonicalEditorialJson(checked.policy)));
    expect(hashAudioDeliveryPolicyV1(policy())).toBe(checked.policySha256);
    expect(E5_MEASUREMENT_ENGINE).toBe("FFMPEG_LOUDNORM_INPUT_STATS_V1");
  });

  it("T5-02 key order never changes the policy hash; any value change does", () => {
    const reordered = Object.fromEntries(Object.entries(policy()).reverse());
    expect(hashAudioDeliveryPolicyV1(reordered)).toBe(hashAudioDeliveryPolicyV1(policy()));
    expect(hashAudioDeliveryPolicyV1(policy({ integratedToleranceCentiLu: 99 }))).not.toBe(hashAudioDeliveryPolicyV1(policy()));
    expect(hashAudioDeliveryPolicyV1(policy({ policyId: "audio-delivery:other" }))).not.toBe(hashAudioDeliveryPolicyV1(policy()));
  });

  it("T5-03 ranges are closed and inclusive at both ends", () => {
    for (const [field, low, high] of [
      ["targetIntegratedCentiLufs", -7000, -500], ["integratedToleranceCentiLu", 0, 500], ["truePeakCeilingCentiDbtp", -900, 0],
    ] as const) {
      expect(checkAudioDeliveryPolicyV1(policy({ [field]: low })).ok, `${field} low`).toBe(true);
      expect(checkAudioDeliveryPolicyV1(policy({ [field]: high })).ok, `${field} high`).toBe(true);
      expect(checkAudioDeliveryPolicyV1(policy({ [field]: low - 1 })).ok, `${field} below`).toBe(false);
      expect(checkAudioDeliveryPolicyV1(policy({ [field]: high + 1 })).ok, `${field} above`).toBe(false);
    }
    expect(checkAudioDeliveryPolicyV1(policy({ minimumGainCentiDb: -9600, maximumGainCentiDb: 1200 })).ok).toBe(true);
    expect(checkAudioDeliveryPolicyV1(policy({ minimumGainCentiDb: -9601 })).ok).toBe(false);
    expect(checkAudioDeliveryPolicyV1(policy({ maximumGainCentiDb: 1201 })).ok).toBe(false);
  });

  it("T5-04 non-integer, -0, unsafe and min > max values are POLICY_INVALID", () => {
    for (const bad of [policy({ targetIntegratedCentiLufs: -1600.5 }), policy({ truePeakCeilingCentiDbtp: -0 }),
      policy({ integratedToleranceCentiLu: Number.MAX_SAFE_INTEGER + 1 }), policy({ minimumGainCentiDb: 500, maximumGainCentiDb: 400 }),
      policy({ targetIntegratedCentiLufs: "-1600" })]) {
      expect(checkAudioDeliveryPolicyV1(bad)).toStrictEqual({ ok: false, reason: "POLICY_INVALID" });
    }
    expect(checkAudioDeliveryPolicyV1(policy({ minimumGainCentiDb: 400, maximumGainCentiDb: 400 })).ok).toBe(true);
  });

  it("T5-05 strict at every level: unknown fields, wrong literals and wrong expected audio are rejected", () => {
    expect(checkAudioDeliveryPolicyV1({ ...policy(), extra: 1 }).ok).toBe(false);
    expect(checkAudioDeliveryPolicyV1(policy({ expectedAudio: { ...policy().expectedAudio, bitrate: 192 } })).ok).toBe(false);
    expect(checkAudioDeliveryPolicyV1(policy({ expectedAudio: { ...policy().expectedAudio, sampleRateHz: 44100 } })).ok).toBe(false);
    expect(checkAudioDeliveryPolicyV1(policy({ measurementEngine: "EBUR128" })).ok).toBe(false);
    expect(checkAudioDeliveryPolicyV1(policy({ loudnessRangePolicy: "GATE" })).ok).toBe(false);
    expect(checkAudioDeliveryPolicyV1(policy({ policyVersion: "2" })).ok).toBe(false);
  });

  it("T5-06 policy id grammar: audio-delivery namespace, kebab-case, at most 80 characters", () => {
    expect(checkAudioDeliveryPolicyV1(policy({ policyId: "audio-delivery:youtube-1" })).ok).toBe(true);
    expect(checkAudioDeliveryPolicyV1(policy({ policyId: `audio-delivery:${"a".repeat(65)}` })).ok).toBe(true);
    for (const id of ["busybookie-master-v1", "audio-delivery:", "audio-delivery:Upper", "audio-delivery:a--b", "audio-delivery:-a",
      `audio-delivery:${"a".repeat(66)}`]) {
      expect(checkAudioDeliveryPolicyV1(policy({ policyId: id })).ok, id).toBe(false);
    }
  });

  it("T5-07 no default policy exists: the module exports no policy value and validation never fills fields", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/editorial/audioDeliveryPolicy.schema.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/DEFAULT|YOUTUBE|ATSC|\.default\(/);
    for (const field of Object.keys(policy())) {
      const { [field]: _omitted, ...missing } = policy();
      expect(checkAudioDeliveryPolicyV1(missing).ok, field).toBe(false);
    }
    expect(() => validateAudioDeliveryPolicyV1({})).toThrow(/POLICY_INVALID/);
    expect(AudioDeliveryPolicyV1Schema.safeParse(undefined).success).toBe(false);
  });
});
