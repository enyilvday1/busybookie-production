import { describe, expect, it } from "vitest";

import { loadProductionRules } from "../src/validation/loadProductionRules.js";

describe("Busybookie Production Rules", () => {
  it("loads the authoritative production configuration", async () => {
    const rules = await loadProductionRules();

    expect(rules.schemaVersion).toBe("1.0");
    expect(rules.brand.brandName).toBe("Busybookie");
    expect(rules.brand.showName).toBe("Ollie, Kacey & Mont");
    expect(rules.brand.setting).toBe("Littleleaf Valley");
    expect(rules.brand.tagline).toBe(
      "Little stories. Big imaginations.",
    );
  });

  it("locks the master post-production format", async () => {
    const rules = await loadProductionRules();

    expect(rules.postProduction).toEqual({
      aspectRatio: "16:9",
      width: 1920,
      height: 1080,
      timelineFps: 25,
      audioSampleRateHz: 48000,
    });
  });

  it("requires external media storage", async () => {
    const rules = await loadProductionRules();

    expect(rules.storage.mediaRootEnvVar).toBe(
      "BUSYBOOKIE_MEDIA_ROOT",
    );

    expect(rules.storage.requireExternalMediaRoot).toBe(true);
  });

  it("requires all production approval gates", async () => {
    const rules = await loadProductionRules();

    expect(rules.approvals).toEqual({
      requireScriptApproval: true,
      requireStoryboardApproval: true,
      requireReferenceApproval: true,
      requireRoughCutApproval: true,
      requireFinalQcApproval: true,
    });
  });

  it("blocks uncontrolled automatic generation", async () => {
    const rules = await loadProductionRules();

    expect(
      rules.generation.allowUnapprovedGeneration,
    ).toBe(false);

    expect(rules.generation.maxAutomaticRetries).toBe(2);

    expect(rules.generation.supportedProviders).toEqual([
      "RUNWAY",
      "VEO",
      "MANUAL",
    ]);
  });
});
