import type {
  EpisodeManifest,
} from "../schemas/episodeManifest.schema.js";

import {
  verifyCompletedShotForComposition,
} from "./verifyCompletedShotForComposition.js";

export type EpisodeCompositionPlanShot =
  Readonly<{
    sceneId:
      string;

    shotId:
      string;

    order:
      number;

    title:
      string;

    durationSeconds:
      number;

    nativeAudio:
      boolean;

    provider:
      "RUNWAY" | "VEO";

    providerExecutionId:
      string;

    sourceVideoPath:
      string;

    sourceBytes:
      number;

    sourceSha256:
      string;

    sourceContentType:
      string | null;
  }>;

export type EpisodeCompositionPlan =
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
      readonly EpisodeCompositionPlanShot[];
  }>;

export type BuildEpisodeCompositionPlanInput =
  Readonly<{
    mediaRoot:
      string;

    episode:
      EpisodeManifest;
  }>;

export type BuildEpisodeCompositionPlanDependencies =
  Readonly<{
    verifyShot:
      typeof verifyCompletedShotForComposition;
  }>;

const defaultDependencies:
  BuildEpisodeCompositionPlanDependencies =
  Object.freeze({
    verifyShot:
      verifyCompletedShotForComposition,
  });

export async function buildEpisodeCompositionPlan(
  input:
    BuildEpisodeCompositionPlanInput,

  dependencies:
    BuildEpisodeCompositionPlanDependencies =
      defaultDependencies,
): Promise<EpisodeCompositionPlan> {
  const orderedShots =
    input.episode.scenes
      .flatMap(
        (scene) =>
          scene.shots.map(
            (shot) => ({
              sceneId:
                scene.id,

              shot,
            }),
          ),
      )
      .sort(
        (left, right) =>
          left.shot.order -
          right.shot.order,
      );

  const compositionShots:
    EpisodeCompositionPlanShot[] =
      [];

  for (
    const {
      sceneId,
      shot,
    } of orderedShots
  ) {
    const verified =
      await dependencies
        .verifyShot({
          mediaRoot:
            input.mediaRoot,

          episodeId:
            input.episode.episodeId,

          shotId:
            shot.id,
        });

    const outputs =
      verified
        .generationRecord
        .outputs;

    if (
      outputs.length !==
      1
    ) {
      throw new Error(
        `Episode composition requires exactly one verified output for ${input.episode.episodeId}/${shot.id}; received ${outputs.length}.`,
      );
    }

    const output =
      outputs[0];

    if (!output) {
      throw new Error(
        `Episode composition verified output is missing for ${input.episode.episodeId}/${shot.id}.`,
      );
    }

    compositionShots.push(
      Object.freeze({
        sceneId,

        shotId:
          shot.id,

        order:
          shot.order,

        title:
          shot.title,

        durationSeconds:
          shot.durationSeconds,

        nativeAudio:
          shot.generation.nativeAudio,

        provider:
          verified.provider,

        providerExecutionId:
          verified
            .providerExecutionId,

        sourceVideoPath:
          output.destinationPath,

        sourceBytes:
          output.bytes,

        sourceSha256:
          output.sha256,

        sourceContentType:
          output.contentType,
      }),
    );
  }

  const totalDurationSeconds =
    compositionShots.reduce(
      (
        total,
        shot,
      ) =>
        total +
        shot.durationSeconds,
      0,
    );

  return Object.freeze({
    episodeId:
      input.episode.episodeId,

    title:
      input.episode.title,

    totalShots:
      compositionShots.length,

    totalDurationSeconds,

    shots:
      Object.freeze([
        ...compositionShots,
      ]),
  });
}
