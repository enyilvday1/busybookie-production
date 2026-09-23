import type {
  CharacterBible,
} from "../schemas/character.schema.js";

import type {
  EpisodeManifest,
} from "../schemas/episodeManifest.schema.js";

import type {
  ProviderRoutingPolicy,
} from "../schemas/providerRoutingPolicy.schema.js";

import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

import {
  evaluateShotProvider,
} from "./evaluateShotProvider.js";

import type {
  EpisodeRoutingReport,
  EpisodeRoutingShot,
} from "./episodeRoutingReport.types.js";

import type {
  ProviderRoutingDisposition,
} from "./providerRouter.types.js";

export function evaluateEpisodeRouting(
  episode: EpisodeManifest,
  bible: CharacterBible,
  rules: ProductionRules,
  policy: ProviderRoutingPolicy,
): EpisodeRoutingReport {
  const shots: EpisodeRoutingShot[] = [];

  for (const scene of episode.scenes) {
    for (const shot of scene.shots) {
      shots.push({
        sceneId: scene.id,
        sceneTitle: scene.title,
        shotId: shot.id,
        order: shot.order,
        title: shot.title,
        decision: evaluateShotProvider(
          shot,
          bible,
          rules,
          policy,
        ),
      });
    }
  }

  shots.sort(
    (left, right) =>
      left.order - right.order,
  );

  const summary: Record<
    ProviderRoutingDisposition,
    number
  > = {
    ROUTABLE: 0,
    BLOCKED: 0,
    MANUAL_REVIEW: 0,
    CONFLICT: 0,
  };

  for (const shot of shots) {
    summary[
      shot.decision.disposition
    ] += 1;
  }

  return {
    episodeId: episode.episodeId,
    title: episode.title,
    totalShots: shots.length,
    summary,
    shots,
  };
}
