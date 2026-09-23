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
  evaluateShotExecutionReadiness,
} from "./evaluateShotExecutionReadiness.js";

import type {
  EpisodeExecutionPlan,
  EpisodeExecutionPlanShot,
} from "./episodeExecutionPlan.types.js";

import type {
  ExecutionReadinessDisposition,
} from "./executionReadiness.types.js";

export function evaluateEpisodeExecutionPlan(
  episode: EpisodeManifest,
  bible: CharacterBible,
  rules: ProductionRules,
  policy: ProviderRoutingPolicy,
): EpisodeExecutionPlan {
  const shots: EpisodeExecutionPlanShot[] = [];

  for (const scene of episode.scenes) {
    for (const shot of scene.shots) {
      shots.push({
        sceneId: scene.id,
        sceneTitle: scene.title,
        shotId: shot.id,
        order: shot.order,
        title: shot.title,
        readiness:
          evaluateShotExecutionReadiness(
            episode,
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
    ExecutionReadinessDisposition,
    number
  > = {
    EXECUTABLE: 0,
    NOT_READY: 0,
    MANUAL_REVIEW: 0,
    CONFLICT: 0,
    BLOCKED: 0,
  };

  for (const shot of shots) {
    summary[
      shot.readiness.disposition
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
