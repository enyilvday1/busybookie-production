import { describe, expect, it } from "vitest";

import {
  evaluateShotProvider,
} from "../src/routing/evaluateShotProvider.js";

import { loadCharacterBible } from "../src/validation/loadCharacterBible.js";
import { loadEpisodeManifest } from "../src/validation/loadEpisodeManifest.js";
import { loadProductionRules } from "../src/validation/loadProductionRules.js";
import { loadProviderRoutingPolicy } from "../src/validation/loadProviderRoutingPolicy.js";

async function loadRoutingContext() {
  const [
    bible,
    rules,
    policy,
  ] = await Promise.all([
    loadCharacterBible(),
    loadProductionRules(),
    loadProviderRoutingPolicy(),
  ]);

  return {
    bible,
    rules,
    policy,
  };
}

describe("Busybookie Provider Router", () => {
  it("loads the fail-closed provider routing policy", async () => {
    const policy =
      await loadProviderRoutingPolicy();

    expect(policy).toEqual({
      schemaVersion: "1.0",
      nonDialogue: {
        nativeAudioProvider: "VEO",
        visualOnlyProvider: "RUNWAY",
      },
      dialogue: {
        requireLockedVoices: true,
        automaticProviderSelection: false,
        treatDialogueShotTypeAsDialogueIntent: true,
      },
      manifest: {
        flagProviderMismatch: true,
      },
    });
  });

  it("routes EP90 visual-only generation to Runway", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP90"),
      loadRoutingContext(),
    ]);

    const shot =
      episode.scenes[0]?.shots[0];

    if (!shot) {
      throw new Error("Expected EP90 S01.");
    }

    const decision =
      evaluateShotProvider(
        shot,
        context.bible,
        context.rules,
        context.policy,
      );

    expect(decision.disposition).toBe("ROUTABLE");
    expect(decision.recommendedProvider).toBe("RUNWAY");
    expect(decision.currentProvider).toBe("RUNWAY");
    expect(decision.currentProviderMatchesRecommendation).toBe(true);
    expect(decision.manifestConflict).toBe(false);
    expect(decision.blockers).toEqual([]);
  });

  it("routes EP91 native-audio generation to Veo", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP91"),
      loadRoutingContext(),
    ]);

    const shot =
      episode.scenes[0]?.shots[0];

    if (!shot) {
      throw new Error("Expected EP91 S01.");
    }

    const decision =
      evaluateShotProvider(
        shot,
        context.bible,
        context.rules,
        context.policy,
      );

    expect(decision.disposition).toBe("ROUTABLE");
    expect(decision.recommendedProvider).toBe("VEO");
    expect(decision.currentProvider).toBe("VEO");
    expect(decision.currentProviderMatchesRecommendation).toBe(true);
    expect(decision.manifestConflict).toBe(false);
    expect(decision.blockers).toEqual([]);
  });

  it("routes EP02 S01 visual-only generation to Runway", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP02"),
      loadRoutingContext(),
    ]);

    const shot =
      episode.scenes[0]?.shots[0];

    if (!shot) {
      throw new Error("Expected EP02 S01.");
    }

    const decision =
      evaluateShotProvider(
        shot,
        context.bible,
        context.rules,
        context.policy,
      );

    expect(decision.disposition).toBe("ROUTABLE");
    expect(decision.recommendedProvider).toBe("RUNWAY");
    expect(decision.currentProvider).toBe("RUNWAY");
    expect(decision.currentProviderMatchesRecommendation).toBe(true);
    expect(decision.manifestConflict).toBe(false);
    expect(decision.blockers).toEqual([]);
  });

  it("requires manual review for Ollie dialogue with a locked voice", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP02"),
      loadRoutingContext(),
    ]);

    const shot =
      episode.scenes[0]?.shots[1];

    if (!shot) {
      throw new Error("Expected EP02 S02.");
    }

    const testBible =
      structuredClone(
        context.bible,
      );

    const ollie =
      testBible.characters.find(
        (character) =>
          character.id ===
          "OLLIE",
      );

    if (!ollie) {
      throw new Error(
        "Expected Ollie in Character Bible.",
      );
    }

    ollie.voice = {
      selectionStatus:
        "LOCKED",

      provider:
        "RUNWAY",

      voiceName:
        "Chad",

      deliveryTraits: [
        ...ollie.voice
          .deliveryTraits,
      ],
    };

    const decision =
      evaluateShotProvider(
        shot,
        testBible,
        context.rules,
        context.policy,
      );

    expect(decision.disposition).toBe("MANUAL_REVIEW");
    expect(decision.recommendedProvider).toBeNull();
    expect(decision.currentProviderMatchesRecommendation).toBeNull();
    expect(decision.manifestConflict).toBe(false);
    expect(decision.blockers).toEqual([]);
    expect(decision.reasons.join(" ")).toMatch(/locked-voice requirements/i);
  });

  it("requires manual review for Mont dialogue now that his voice is locked", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP02"),
      loadRoutingContext(),
    ]);

    const sourceShot =
      episode.scenes[0]?.shots[1];

    if (!sourceShot) {
      throw new Error("Expected EP02 S02.");
    }

    const montShot =
      structuredClone(sourceShot);

    montShot.characters = [
      "MONT",
    ];

    montShot.dialogue = [
      {
        characterId: "MONT",
        text: "Hello, friends.",
        deliveryNotes: "Gentle and reassuring.",
      },
    ];

    const decision =
      evaluateShotProvider(
        montShot,
        context.bible,
        context.rules,
        context.policy,
      );

    expect(decision.disposition).toBe("MANUAL_REVIEW");
    expect(decision.recommendedProvider).toBeNull();
    expect(decision.currentProviderMatchesRecommendation).toBeNull();
    expect(decision.manifestConflict).toBe(false);
    expect(decision.blockers).toEqual([]);
    expect(decision.reasons.join(" ")).toMatch(/locked-voice requirements/i);
  });

  it("flags a manifest provider conflict for EP91 routed to Runway", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP91"),
      loadRoutingContext(),
    ]);

    const sourceShot =
      episode.scenes[0]?.shots[0];

    if (!sourceShot) {
      throw new Error("Expected EP91 S01.");
    }

    const conflictingShot =
      structuredClone(sourceShot);

    conflictingShot.generation.provider =
      "RUNWAY";

    const decision =
      evaluateShotProvider(
        conflictingShot,
        context.bible,
        context.rules,
        context.policy,
      );

    expect(decision.disposition).toBe("CONFLICT");
    expect(decision.recommendedProvider).toBe("VEO");
    expect(decision.currentProvider).toBe("RUNWAY");
    expect(decision.currentProviderMatchesRecommendation).toBe(false);
    expect(decision.manifestConflict).toBe(true);
    expect(decision.blockers).toEqual([]);
    expect(decision.reasons.join(" ")).toMatch(/conflicts with routing recommendation VEO/i);
  });

  it("blocks routing when the recommended provider is disabled", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP91"),
      loadRoutingContext(),
    ]);

    const shot =
      episode.scenes[0]?.shots[0];

    if (!shot) {
      throw new Error("Expected EP91 S01.");
    }

    const restrictedRules =
      structuredClone(context.rules);

    restrictedRules.generation.supportedProviders =
      ["RUNWAY", "MANUAL"];

    const decision =
      evaluateShotProvider(
        shot,
        context.bible,
        restrictedRules,
        context.policy,
      );

    expect(decision.disposition).toBe("BLOCKED");
    expect(decision.recommendedProvider).toBe("VEO");
    expect(decision.currentProvider).toBe("VEO");
    expect(decision.currentProviderMatchesRecommendation).toBe(true);
    expect(decision.manifestConflict).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0]).toMatch(/VEO is not enabled/i);
  });

  it("blocks dialogue routing when Mont voice is not locked", async () => {
    const [
      episode,
      context,
    ] = await Promise.all([
      loadEpisodeManifest("EP02"),
      loadRoutingContext(),
    ]);

    const sourceShot =
      episode.scenes[0]?.shots[1];

    if (!sourceShot) {
      throw new Error("Expected EP02 S02.");
    }

    const montShot =
      structuredClone(sourceShot);

    montShot.characters = [
      "MONT",
    ];

    montShot.dialogue = [
      {
        characterId: "MONT",
        text: "Hello, friends.",
        deliveryNotes: "Gentle and reassuring.",
      },
    ];

    const testBible =
      structuredClone(
        context.bible,
      );

    const mont =
      testBible.characters.find(
        (character) =>
          character.id ===
          "MONT",
      );

    if (!mont) {
      throw new Error(
        "Expected Mont in Character Bible.",
      );
    }

    mont.voice = {
      selectionStatus:
        "PENDING",
      provider:
        "RUNWAY",
      voiceName:
        null,
      deliveryTraits: [
        ...mont.voice
          .deliveryTraits,
      ],
    };

    const decision =
      evaluateShotProvider(
        montShot,
        testBible,
        context.rules,
        context.policy,
      );

    expect(decision.disposition).toBe("BLOCKED");
    expect(decision.recommendedProvider).toBeNull();
    expect(decision.currentProviderMatchesRecommendation).toBeNull();
    expect(decision.manifestConflict).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0]).toMatch(/no approved voice is locked/i);
    expect(decision.reasons.join(" ")).toMatch(/requires locked voices/i);
  });
});
