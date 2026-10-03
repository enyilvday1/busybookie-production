import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  EpisodeManifest,
  Shot,
} from "../src/schemas/episodeManifest.schema.js";

import {
  evaluateShotExecutionReadiness,
} from "../src/planning/evaluateShotExecutionReadiness.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

import {
  loadProductionRules,
} from "../src/validation/loadProductionRules.js";

import {
  loadProviderRoutingPolicy,
} from "../src/validation/loadProviderRoutingPolicy.js";

async function loadPlanningContext() {
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

function requireShot(
  episode: EpisodeManifest,
  shotId: string,
): Shot {
  for (const scene of episode.scenes) {
    const shot = scene.shots.find(
      (candidate) =>
        candidate.id === shotId,
    );

    if (shot) {
      return shot;
    }
  }

  throw new Error(
    `Expected ${episode.episodeId} ${shotId}.`,
  );
}

describe(
  "Busybookie shot execution readiness",
  () => {
    it(
      "marks ready EP90 Runway generation executable",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP90"),
          loadPlanningContext(),
        ]);

        const shot = requireShot(
          episode,
          "S01",
        );

        const result =
          evaluateShotExecutionReadiness(
            episode,
            shot,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(result.routing.disposition).toBe(
          "ROUTABLE",
        );
        expect(result.disposition).toBe(
          "EXECUTABLE",
        );
        expect(result.executionProvider).toBe(
          "RUNWAY",
        );
        expect(result.blockers).toEqual([]);
      },
    );

    it(
      "marks ready EP91 Veo generation executable",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP91"),
          loadPlanningContext(),
        ]);

        const shot = requireShot(
          episode,
          "S01",
        );

        const result =
          evaluateShotExecutionReadiness(
            episode,
            shot,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(result.routing.disposition).toBe(
          "ROUTABLE",
        );
        expect(result.disposition).toBe(
          "EXECUTABLE",
        );
        expect(result.executionProvider).toBe(
          "VEO",
        );
        expect(result.blockers).toEqual([]);
      },
    );

    it(
      "preserves manual review for dialogue routing",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP02"),
          loadPlanningContext(),
        ]);

        const shot = requireShot(
          episode,
          "S02",
        );

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

        const result =
          evaluateShotExecutionReadiness(
            episode,
            shot,
            testBible,
            context.rules,
            context.policy,
          );

        expect(result.routing.disposition).toBe(
          "MANUAL_REVIEW",
        );
        expect(result.disposition).toBe(
          "MANUAL_REVIEW",
        );
        expect(result.executionProvider).toBeNull();
      },
    );

    it(
      "keeps a routable shot not ready when episode approval fails",
      async () => {
        const [
          sourceEpisode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP90"),
          loadPlanningContext(),
        ]);

        const episode =
          structuredClone(sourceEpisode);

        episode.approvals.script =
          "PENDING";

        const shot = requireShot(
          episode,
          "S01",
        );

        const result =
          evaluateShotExecutionReadiness(
            episode,
            shot,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(result.routing.disposition).toBe(
          "ROUTABLE",
        );
        expect(result.disposition).toBe(
          "NOT_READY",
        );
        expect(result.executionProvider).toBe(
          "RUNWAY",
        );
        expect(result.blockers.join(" ")).toMatch(
          /script approval is required/i,
        );
      },
    );

    it(
      "keeps a routable shot not ready until approved for generation",
      async () => {
        const [
          sourceEpisode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP90"),
          loadPlanningContext(),
        ]);

        const episode =
          structuredClone(sourceEpisode);

        const shot = requireShot(
          episode,
          "S01",
        );

        shot.generation.status =
          "PLANNED";

        const result =
          evaluateShotExecutionReadiness(
            episode,
            shot,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(result.routing.disposition).toBe(
          "ROUTABLE",
        );
        expect(result.disposition).toBe(
          "NOT_READY",
        );
        expect(result.blockers.join(" ")).toMatch(
          /status is PLANNED/i,
        );
      },
    );

    it(
      "keeps routable Veo generation not ready without a required reference",
      async () => {
        const [
          sourceEpisode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP91"),
          loadPlanningContext(),
        ]);

        const episode =
          structuredClone(sourceEpisode);

        const shot = requireShot(
          episode,
          "S01",
        );

        shot.references.required =
          false;

        const result =
          evaluateShotExecutionReadiness(
            episode,
            shot,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(result.routing.disposition).toBe(
          "ROUTABLE",
        );
        expect(result.disposition).toBe(
          "NOT_READY",
        );
        expect(result.executionProvider).toBe(
          "VEO",
        );
        expect(result.blockers.join(" ")).toMatch(
          /does not declare a required reference image/i,
        );
      },
    );

    it(
      "preserves routing conflict before execution checks",
      async () => {
        const [
          sourceEpisode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP91"),
          loadPlanningContext(),
        ]);

        const episode =
          structuredClone(sourceEpisode);

        const shot = requireShot(
          episode,
          "S01",
        );

        shot.generation.provider =
          "RUNWAY";

        const result =
          evaluateShotExecutionReadiness(
            episode,
            shot,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(result.routing.disposition).toBe(
          "CONFLICT",
        );
        expect(result.disposition).toBe(
          "CONFLICT",
        );
        expect(result.executionProvider).toBeNull();
        expect(result.routing.recommendedProvider).toBe(
          "VEO",
        );
      },
    );

    it(
      "preserves blocked routing when the recommended provider is disabled",
      async () => {
        const [
          episode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP91"),
          loadPlanningContext(),
        ]);

        const rules =
          structuredClone(context.rules);

        rules.generation.supportedProviders =
          rules.generation.supportedProviders.filter(
            (provider) =>
              provider !== "VEO",
          );

        const shot = requireShot(
          episode,
          "S01",
        );

        const result =
          evaluateShotExecutionReadiness(
            episode,
            shot,
            context.bible,
            rules,
            context.policy,
          );

        expect(result.routing.disposition).toBe(
          "BLOCKED",
        );
        expect(result.disposition).toBe(
          "BLOCKED",
        );
        expect(result.executionProvider).toBeNull();
        expect(result.blockers.join(" ")).toMatch(
          /VEO is not enabled/i,
        );
      },
    );

    it(
      "keeps routable Runway generation not ready when the episode is not live",
      async () => {
        const [
          sourceEpisode,
          context,
        ] = await Promise.all([
          loadEpisodeManifest("EP90"),
          loadPlanningContext(),
        ]);

        const episode =
          structuredClone(sourceEpisode);

        episode.status =
          "DRAFT";

        const shot = requireShot(
          episode,
          "S01",
        );

        const result =
          evaluateShotExecutionReadiness(
            episode,
            shot,
            context.bible,
            context.rules,
            context.policy,
          );

        expect(result.routing.disposition).toBe(
          "ROUTABLE",
        );
        expect(result.disposition).toBe(
          "NOT_READY",
        );
        expect(result.executionProvider).toBe(
          "RUNWAY",
        );
        expect(result.blockers.join(" ")).toMatch(
          /status is DRAFT/i,
        );
      },
    );

  },
);
