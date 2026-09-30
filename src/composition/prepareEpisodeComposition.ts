import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

import {
  buildCompositionShotNormalizationPlan,
  type CompositionShotNormalizationPlan,
} from "./buildCompositionShotNormalizationPlan.js";

import type {
  EpisodeCompositionPlan,
  EpisodeCompositionPlanShot,
} from "./buildEpisodeCompositionPlan.js";

import {
  ensureCompositionShotNormalizationCache,
  type CompositionShotNormalizationCacheStatus,
} from "./ensureCompositionShotNormalizationCache.js";

import type {
  MaterializedCompositionShotNormalization,
} from "./materializeCompositionShotNormalization.js";

import {
  probeCompositionSourceMedia,
} from "./probeCompositionSourceMedia.js";

export type PreparedEpisodeCompositionShot =
  Readonly<
    EpisodeCompositionPlanShot &
      {
        normalizationPlan:
          CompositionShotNormalizationPlan;

        normalizationCacheStatus:
          CompositionShotNormalizationCacheStatus;

        normalizedArtifact:
          MaterializedCompositionShotNormalization;
      }
  >;

export type PreparedEpisodeComposition =
  Readonly<{
    episodeId:
      string;

    title:
      string;

    totalShots:
      number;

    totalDurationSeconds:
      number;

    shots:
      readonly PreparedEpisodeCompositionShot[];
  }>;

export type PrepareEpisodeCompositionInput =
  Readonly<{
    compositionPlan:
      EpisodeCompositionPlan;

    mediaRoot:
      string;

    postProduction:
      ProductionRules["postProduction"];

    ffmpegExecutable:
      string;

    ffprobeExecutable:
      string;
  }>;

export type PrepareEpisodeCompositionDependencies =
  Readonly<{
    probeSource:
      typeof probeCompositionSourceMedia;

    buildNormalizationPlan:
      typeof buildCompositionShotNormalizationPlan;

    ensureNormalizationCache:
      typeof ensureCompositionShotNormalizationCache;
  }>;

const defaultDependencies:
  PrepareEpisodeCompositionDependencies =
    Object.freeze({
      probeSource:
        probeCompositionSourceMedia,

      buildNormalizationPlan:
        buildCompositionShotNormalizationPlan,

      ensureNormalizationCache:
        ensureCompositionShotNormalizationCache,
    });

export async function prepareEpisodeComposition(
  input:
    PrepareEpisodeCompositionInput,

  dependencies:
    PrepareEpisodeCompositionDependencies =
      defaultDependencies,
): Promise<PreparedEpisodeComposition> {
  const preparedShots:
    PreparedEpisodeCompositionShot[] =
      [];

  for (
    const shot
    of input.compositionPlan.shots
  ) {
    const sourceMedia =
      await dependencies
        .probeSource({
          ffprobeExecutable:
            input.ffprobeExecutable,

          sourceVideoPath:
            shot.sourceVideoPath,

          nativeAudio:
            shot.nativeAudio,
        });

    const normalizationPlan =
      dependencies
        .buildNormalizationPlan({
          mediaRoot:
            input.mediaRoot,

          episodeId:
            input.compositionPlan
              .episodeId,

          shot,

          sourceMedia,

          postProduction:
            input.postProduction,
        });

    const ensured =
      await dependencies
        .ensureNormalizationCache({
          ffmpegExecutable:
            input.ffmpegExecutable,

          ffprobeExecutable:
            input.ffprobeExecutable,

          plan:
            normalizationPlan,
        });

    preparedShots.push(
      Object.freeze({
        ...shot,

        normalizationPlan,

        normalizationCacheStatus:
          ensured.cacheStatus,

        normalizedArtifact:
          ensured.artifact,
      }),
    );
  }

  return Object.freeze({
    episodeId:
      input.compositionPlan
        .episodeId,

    title:
      input.compositionPlan
        .title,

    totalShots:
      input.compositionPlan
        .totalShots,

    totalDurationSeconds:
      input.compositionPlan
        .totalDurationSeconds,

    shots:
      Object.freeze([
        ...preparedShots,
      ]),
  });
}
