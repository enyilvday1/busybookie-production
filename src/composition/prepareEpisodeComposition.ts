import type {
  DialogueCompositionAudioPlan,
} from "../dialogue/buildDialogueCompositionAudioPlan.js";

import {
  buildShotDialoguePlan,
} from "../dialogue/buildShotDialoguePlan.js";

import {
  resolveDurableDialogueCompositionAudioPlan,
} from "../dialogue/resolveDurableDialogueCompositionAudioPlan.js";

import type {
  CharacterBible,
} from "../schemas/character.schema.js";

import type {
  EpisodeManifest,
  Shot,
} from "../schemas/episodeManifest.schema.js";

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

    // Canonical authority for which shots carry dialogue; dialogue
    // composition audio is resolved from durable placement evidence.
    episode:
      EpisodeManifest;

    bible:
      CharacterBible;

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

    buildDialoguePlan:
      typeof buildShotDialoguePlan;

    resolveDialogueAudioPlan:
      typeof resolveDurableDialogueCompositionAudioPlan;

    /*
     * Optional only to preserve the existing dependency-injection
     * contract for callers that prepare v1-only episodes.
     *
     * Dialogue-aware preparation fails closed, before any normalization
     * work, if either dependency is absent while the canonical episode
     * has a dialogue-bearing shot.
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

      buildDialoguePlan:
        buildShotDialoguePlan,

      resolveDialogueAudioPlan:
        resolveDurableDialogueCompositionAudioPlan,

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

function indexCanonicalShots(
  episode:
    EpisodeManifest,
): ReadonlyMap<
  string,
  readonly Shot[]
> {
  const canonicalByShot =
    new Map<
      string,
      Shot[]
    >();

  for (
    const scene
    of episode.scenes
  ) {
    for (
      const shot
      of scene.shots
    ) {
      const shotKey =
        createShotIdentityKey(
          scene.id,
          shot.id,
        );

      const matches =
        canonicalByShot.get(
          shotKey,
        );

      if (
        matches
      ) {
        matches.push(
          shot,
        );
      } else {
        canonicalByShot.set(
          shotKey,
          [
            shot,
          ],
        );
      }
    }
  }

  return canonicalByShot;
}

/*
 * PASS 1: episode-wide, read-only admission. Every dialogue-bearing
 * shot must resolve durable composition audio before any shot is
 * normalized, so a later failure leaves no partial normalization work.
 */
async function resolveDialogueAudioByShot(
  input:
    PrepareEpisodeCompositionInput,

  dependencies:
    PrepareEpisodeCompositionDependencies,
): Promise<
  ReadonlyMap<
    string,
    DialogueCompositionAudioPlan
  >
> {
  const episodeId =
    input.compositionPlan
      .episodeId;

  if (
    input.episode.episodeId !==
    episodeId
  ) {
    throw new Error(
      `Episode composition canonical episode identity does not match ${episodeId}; received ${input.episode.episodeId}.`,
    );
  }

  const canonicalByShot =
    indexCanonicalShots(
      input.episode,
    );

  const admittedShotKeys =
    new Set<string>();

  const dialogueByShot =
    new Map<
      string,
      DialogueCompositionAudioPlan
    >();

  // Sequential by design: shots are admitted in composition order.
  for (
    const shot
    of input.compositionPlan.shots
  ) {
    const shotLabel =
      `${episodeId}/${shot.sceneId}/${shot.shotId}`;

    const shotKey =
      createShotIdentityKey(
        shot.sceneId,
        shot.shotId,
      );

    if (
      admittedShotKeys.has(
        shotKey,
      )
    ) {
      throw new Error(
        `Episode composition plan contains duplicate shot ${shotLabel}.`,
      );
    }

    admittedShotKeys.add(
      shotKey,
    );

    const matches =
      canonicalByShot.get(
        shotKey,
      ) ??
      [];

    if (
      matches.length !==
      1
    ) {
      throw new Error(
        matches.length === 0
          ? `Episode composition shot ${shotLabel} has no canonical episode shot.`
          : `Episode composition shot ${shotLabel} matches ${matches.length} canonical episode shots.`,
      );
    }

    const canonicalShot =
      matches[0]!;

    if (
      canonicalShot.dialogue.length ===
      0
    ) {
      continue;
    }

    if (
      !dependencies
        .buildDialogueNormalizationPlan ||
      !dependencies
        .ensureDialogueNormalizationCache
    ) {
      throw new Error(
        `Episode composition dialogue normalization dependencies are unavailable for ${shotLabel}.`,
      );
    }

    const dialoguePlan =
      dependencies
        .buildDialoguePlan({
          episodeId,

          sceneId:
            shot.sceneId,

          shot:
            canonicalShot,

          bible:
            input.bible,
        });

    const dialogueAudio =
      await dependencies
        .resolveDialogueAudioPlan({
          mediaRoot:
            input.mediaRoot,

          ffprobeExecutable:
            input.ffprobeExecutable,

          dialoguePlan,
        });

    if (
      dialogueAudio.episodeId !==
        episodeId ||
      dialogueAudio.sceneId !==
        shot.sceneId ||
      dialogueAudio.shotId !==
        shot.shotId
    ) {
      throw new Error(
        `Episode composition resolved dialogue audio identity ${dialogueAudio.episodeId}/${dialogueAudio.sceneId}/${dialogueAudio.shotId} does not match ${shotLabel}.`,
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
    await resolveDialogueAudioByShot(
      input,
      dependencies,
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
