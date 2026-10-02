import type {
  DialogueCompositionAudioPlan,
} from "../dialogue/buildDialogueCompositionAudioPlan.js";

import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

import {
  buildCompositionShotNormalizationPlan,
  type CompositionShotNormalizationPlan,
} from "./buildCompositionShotNormalizationPlan.js";

import {
  buildDialogueCompositionShotNormalizationPlan,
  type DialogueCompositionShotNormalizationPlan,
} from "./buildDialogueCompositionShotNormalizationPlan.js";

import type {
  EpisodeCompositionPlan,
  EpisodeCompositionPlanShot,
} from "./buildEpisodeCompositionPlan.js";

import {
  ensureCompositionShotNormalizationCache,
  type CompositionShotNormalizationCacheStatus,
} from "./ensureCompositionShotNormalizationCache.js";

import {
  ensureDialogueCompositionShotNormalizationCache,
  type DialogueCompositionShotNormalizationCacheStatus,
} from "./ensureDialogueCompositionShotNormalizationCache.js";

import type {
  MaterializedCompositionShotNormalization,
} from "./materializeCompositionShotNormalization.js";

import {
  probeCompositionSourceMedia,
} from "./probeCompositionSourceMedia.js";

export type EpisodeCompositionNormalizationPlan =
  CompositionShotNormalizationPlan |
  DialogueCompositionShotNormalizationPlan;

export type EpisodeCompositionNormalizationCacheStatus =
  CompositionShotNormalizationCacheStatus |
  DialogueCompositionShotNormalizationCacheStatus;

export type PreparedEpisodeCompositionShot =
  Readonly<
    EpisodeCompositionPlanShot &
      {
        normalizationPlan:
          EpisodeCompositionNormalizationPlan;

        normalizationCacheStatus:
          EpisodeCompositionNormalizationCacheStatus;

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

    dialogueAudioPlans?:
      readonly DialogueCompositionAudioPlan[];

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

    /*
     * Optional only to preserve the existing dependency-injection
     * contract for callers that prepare v1-only episodes.
     *
     * Dialogue-aware preparation fails closed if either dependency
     * is absent for a shot that has trusted dialogue audio evidence.
     */
    buildDialogueNormalizationPlan?:
      typeof buildDialogueCompositionShotNormalizationPlan;

    ensureDialogueNormalizationCache?:
      typeof ensureDialogueCompositionShotNormalizationCache;
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

      buildDialogueNormalizationPlan:
        buildDialogueCompositionShotNormalizationPlan,

      ensureDialogueNormalizationCache:
        ensureDialogueCompositionShotNormalizationCache,
    });

function createShotIdentityKey(
  sceneId:
    string,

  shotId:
    string,
): string {
  return JSON.stringify([
    sceneId,
    shotId,
  ]);
}

function indexDialogueAudioPlans(
  input:
    PrepareEpisodeCompositionInput,
): ReadonlyMap<
  string,
  DialogueCompositionAudioPlan
> {
  const dialogueAudioPlans =
    input.dialogueAudioPlans ??
    [];

  const admittedShotKeys =
    new Set(
      input.compositionPlan.shots.map(
        (
          shot,
        ) =>
          createShotIdentityKey(
            shot.sceneId,
            shot.shotId,
          ),
      ),
    );

  const dialogueByShot =
    new Map<
      string,
      DialogueCompositionAudioPlan
    >();

  for (
    const dialogueAudio
    of dialogueAudioPlans
  ) {
    if (
      dialogueAudio.episodeId !==
      input.compositionPlan.episodeId
    ) {
      throw new Error(
        `Episode composition dialogue audio episode identity does not match ${input.compositionPlan.episodeId}; received ${dialogueAudio.episodeId}.`,
      );
    }

    const shotKey =
      createShotIdentityKey(
        dialogueAudio.sceneId,
        dialogueAudio.shotId,
      );

    if (
      !admittedShotKeys.has(
        shotKey,
      )
    ) {
      throw new Error(
        `Episode composition dialogue audio references unknown admitted shot ${dialogueAudio.episodeId}/${dialogueAudio.sceneId}/${dialogueAudio.shotId}.`,
      );
    }

    if (
      dialogueByShot.has(
        shotKey,
      )
    ) {
      throw new Error(
        `Episode composition received duplicate dialogue audio evidence for ${dialogueAudio.episodeId}/${dialogueAudio.sceneId}/${dialogueAudio.shotId}.`,
      );
    }

    dialogueByShot.set(
      shotKey,
      dialogueAudio,
    );
  }

  return dialogueByShot;
}

export async function prepareEpisodeComposition(
  input:
    PrepareEpisodeCompositionInput,

  dependencies:
    PrepareEpisodeCompositionDependencies =
      defaultDependencies,
): Promise<PreparedEpisodeComposition> {
  const dialogueByShot =
    indexDialogueAudioPlans(
      input,
    );

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

    const dialogueAudio =
      dialogueByShot.get(
        createShotIdentityKey(
          shot.sceneId,
          shot.shotId,
        ),
      );

    if (
      dialogueAudio
    ) {
      const buildDialogueNormalizationPlan =
        dependencies
          .buildDialogueNormalizationPlan;

      const ensureDialogueNormalizationCache =
        dependencies
          .ensureDialogueNormalizationCache;

      if (
        !buildDialogueNormalizationPlan ||
        !ensureDialogueNormalizationCache
      ) {
        throw new Error(
          `Episode composition dialogue normalization dependencies are unavailable for ${input.compositionPlan.episodeId}/${shot.sceneId}/${shot.shotId}.`,
        );
      }

      const normalizationPlan =
        buildDialogueNormalizationPlan({
          mediaRoot:
            input.mediaRoot,

          episodeId:
            input.compositionPlan
              .episodeId,

          shot,

          sourceMedia,

          postProduction:
            input.postProduction,

          dialogueAudio,
        });

      const ensured =
        await ensureDialogueNormalizationCache({
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

      continue;
    }

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
