import {
  createHash,
} from "node:crypto";

import {
  isAbsolute,
  resolve,
  win32,
} from "node:path";

import {
  ExecutionReservationEpisodeIdSchema,
  ExecutionReservationShotIdSchema,
} from "../execution/executionReservation.schema.js";

import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

import type {
  PreparedEpisodeComposition,
  PreparedEpisodeCompositionShot,
} from "./prepareEpisodeComposition.js";

const ROUGH_CUT_RENDER_PROFILE_ID =
  "busybookie-episode-rough-cut-v1" as const;

const NORMALIZATION_PROFILE_ID =
  "busybookie-master-normalization-v1" as const;

const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /^[A-Za-z]:[\\/]/;

const NUMERIC_EPSILON =
  0.000001;

export type EpisodeRoughCutRenderPlanShot =
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

    sourceVideoPath:
      string;

    sourceBytes:
      number;

    sourceSha256:
      string;
  }>;

export type EpisodeRoughCutRenderPlan =
  Readonly<{
    schemaVersion:
      "1.0";

    profileId:
      typeof ROUGH_CUT_RENDER_PROFILE_ID;

    assemblyMode:
      "STRAIGHT_CUT";

    episodeId:
      string;

    title:
      string;

    totalShots:
      number;

    totalDurationSeconds:
      number;

    container:
      "mp4";

    video:
      Readonly<{
        codecName:
          "h264";

        profile:
          "High";

        width:
          number;

        height:
          number;

        frameRate:
          number;

        pixelFormat:
          "yuv420p";
      }>;

    audio:
      Readonly<{
        codecName:
          "aac";

        sampleRateHz:
          number;

        channels:
          2;

        channelLayout:
          "stereo";
      }>;

    renderKey:
      string;

    outputPath:
      string;

    shots:
      readonly EpisodeRoughCutRenderPlanShot[];
  }>;

export type BuildEpisodeRoughCutRenderPlanInput =
  Readonly<{
    mediaRoot:
      string;

    preparedComposition:
      PreparedEpisodeComposition;

    postProduction:
      ProductionRules["postProduction"];
  }>;

function isPortableAbsolutePath(
  value:
    string,
): boolean {
  return (
    isAbsolute(
      value,
    ) ||
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(
      value,
    )
  );
}

function resolvePortablePath(
  root:
    string,

  ...segments:
    readonly string[]
): string {
  if (
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(
      root,
    )
  ) {
    return win32.resolve(
      root,
      ...segments,
    );
  }

  return resolve(
    root,
    ...segments,
  );
}

function requirePortableAbsolutePath(
  value:
    string,

  label:
    string,
): string {
  const trimmed =
    value.trim();

  if (
    trimmed.length ===
      0 ||
    !isPortableAbsolutePath(
      trimmed,
    )
  ) {
    throw new Error(
      `Episode rough-cut render planning requires absolute ${label}.`,
    );
  }

  return trimmed;
}

function requirePositiveFiniteNumber(
  value:
    number,

  label:
    string,
): void {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <=
      0
  ) {
    throw new Error(
      `Episode rough-cut render planning requires positive ${label}.`,
    );
  }
}

function requirePositiveSafeInteger(
  value:
    number,

  label:
    string,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value <=
      0
  ) {
    throw new Error(
      `Episode rough-cut render planning requires positive integer ${label}.`,
    );
  }
}

function requireSha256(
  value:
    string,

  label:
    string,
): string {
  const normalized =
    value.trim()
      .toLowerCase();

  if (
    !/^[a-f0-9]{64}$/u.test(
      normalized,
    )
  ) {
    throw new Error(
      `Episode rough-cut render planning requires valid ${label} SHA-256.`,
    );
  }

  return normalized;
}

function assertMasterProfile(
  postProduction:
    ProductionRules["postProduction"],
): void {
  if (
    postProduction.aspectRatio !==
      "16:9" ||
    postProduction.width !==
      1920 ||
    postProduction.height !==
      1080 ||
    postProduction.timelineFps !==
      25 ||
    postProduction.audioSampleRateHz !==
      48000
  ) {
    throw new Error(
      "Episode rough-cut render planning requires the Busybookie v1 master profile: 16:9, 1920x1080, 25 fps, 48000 Hz audio.",
    );
  }
}

function assertTrustedNormalizedShot(
  episodeId:
    string,

  shot:
    PreparedEpisodeCompositionShot,
): Readonly<{
  sourceVideoPath:
    string;

  sourceBytes:
    number;

  sourceSha256:
    string;
}> {
  const shotId =
    ExecutionReservationShotIdSchema
      .parse(
        shot.shotId,
      );

  if (
    shot.normalizationPlan.schemaVersion !==
      "1.0" ||
    shot.normalizationPlan.profileId !==
      NORMALIZATION_PROFILE_ID
  ) {
    throw new Error(
      `Episode rough-cut render planning requires trusted normalization profile ${NORMALIZATION_PROFILE_ID} for ${episodeId}/${shotId}.`,
    );
  }

  if (
    shot.normalizationPlan.episodeId !==
      episodeId ||
    shot.normalizationPlan.shotId !==
      shotId
  ) {
    throw new Error(
      `Episode rough-cut render planning normalization identity does not match ${episodeId}/${shotId}.`,
    );
  }

  if (
    shot.normalizationPlan.container !==
      "mp4" ||
    shot.normalizationPlan.video.codecName !==
      "h264" ||
    shot.normalizationPlan.video.width !==
      1920 ||
    shot.normalizationPlan.video.height !==
      1080 ||
    shot.normalizationPlan.video.frameRate !==
      25 ||
    shot.normalizationPlan.video.pixelFormat !==
      "yuv420p" ||
    shot.normalizationPlan.audio.codecName !==
      "aac" ||
    shot.normalizationPlan.audio.sampleRateHz !==
      48000 ||
    shot.normalizationPlan.audio.channels !==
      2 ||
    shot.normalizationPlan.audio.channelLayout !==
      "stereo"
  ) {
    throw new Error(
      `Episode rough-cut render planning normalized media profile is invalid for ${episodeId}/${shotId}.`,
    );
  }

  requirePositiveFiniteNumber(
    shot.durationSeconds,
    `shot duration for ${episodeId}/${shotId}`,
  );

  if (
    Math.abs(
      shot.normalizationPlan.targetDurationSeconds -
      shot.durationSeconds,
    ) >
    NUMERIC_EPSILON
  ) {
    throw new Error(
      `Episode rough-cut render planning normalization duration does not match admitted duration for ${episodeId}/${shotId}.`,
    );
  }

  if (
    shot.normalizedArtifact.contentType !==
      "video/mp4"
  ) {
    throw new Error(
      `Episode rough-cut render planning requires MP4 normalized media for ${episodeId}/${shotId}.`,
    );
  }

  const sourceVideoPath =
    requirePortableAbsolutePath(
      shot.normalizedArtifact.outputPath,
      `normalized source path for ${episodeId}/${shotId}`,
    );

  if (
    sourceVideoPath !==
      shot.normalizationPlan.outputPath
  ) {
    throw new Error(
      `Episode rough-cut render planning normalized artifact path does not match the normalization plan for ${episodeId}/${shotId}.`,
    );
  }

  requirePositiveSafeInteger(
    shot.normalizedArtifact.bytes,
    `normalized source byte count for ${episodeId}/${shotId}`,
  );

  const sourceSha256 =
    requireSha256(
      shot.normalizedArtifact.sha256,
      `normalized source for ${episodeId}/${shotId}`,
    );

  requirePositiveFiniteNumber(
    shot.normalizedArtifact.durationSeconds,
    `normalized source duration for ${episodeId}/${shotId}`,
  );

  requirePositiveFiniteNumber(
    shot.normalizedArtifact.durationToleranceSeconds,
    `normalized source duration tolerance for ${episodeId}/${shotId}`,
  );

  if (
    Math.abs(
      shot.normalizedArtifact.durationSeconds -
      shot.durationSeconds,
    ) >
    shot.normalizedArtifact.durationToleranceSeconds +
      NUMERIC_EPSILON
  ) {
    throw new Error(
      `Episode rough-cut render planning normalized source duration exceeds tolerance for ${episodeId}/${shotId}.`,
    );
  }

  return Object.freeze({
    sourceVideoPath,

    sourceBytes:
      shot.normalizedArtifact.bytes,

    sourceSha256,
  });
}

export function buildEpisodeRoughCutRenderPlan(
  input:
    BuildEpisodeRoughCutRenderPlanInput,
): EpisodeRoughCutRenderPlan {
  const mediaRoot =
    requirePortableAbsolutePath(
      input.mediaRoot,
      "media root",
    );

  assertMasterProfile(
    input.postProduction,
  );

  const episodeId =
    ExecutionReservationEpisodeIdSchema
      .parse(
        input.preparedComposition
          .episodeId,
      );

  const title =
    input.preparedComposition
      .title
      .trim();

  if (
    title.length ===
      0
  ) {
    throw new Error(
      "Episode rough-cut render planning requires an episode title.",
    );
  }

  requirePositiveSafeInteger(
    input.preparedComposition
      .totalShots,
    "total shot count",
  );

  requirePositiveFiniteNumber(
    input.preparedComposition
      .totalDurationSeconds,
    "total composition duration",
  );

  if (
    input.preparedComposition
      .shots.length ===
      0
  ) {
    throw new Error(
      "Episode rough-cut render planning requires at least one prepared shot.",
    );
  }

  if (
    input.preparedComposition
      .totalShots !==
    input.preparedComposition
      .shots.length
  ) {
    throw new Error(
      "Episode rough-cut render planning total shot count does not match the prepared shot list.",
    );
  }

  const seenShotIds =
    new Set<string>();

  const plannedShots:
    EpisodeRoughCutRenderPlanShot[] =
      input.preparedComposition
        .shots
        .map(
          (
            shot,
            index,
          ) => {
            const shotId =
              ExecutionReservationShotIdSchema
                .parse(
                  shot.shotId,
                );

            if (
              seenShotIds.has(
                shotId,
              )
            ) {
              throw new Error(
                `Episode rough-cut render planning encountered duplicate shot ${shotId}.`,
              );
            }

            seenShotIds.add(
              shotId,
            );

            const expectedOrder =
              index +
              1;

            if (
              !Number.isSafeInteger(
                shot.order,
              ) ||
              shot.order !==
                expectedOrder
            ) {
              throw new Error(
                `Episode rough-cut render planning requires continuous ordered shots. Expected order ${expectedOrder}, found ${shot.order} for ${episodeId}/${shotId}.`,
              );
            }

            const trusted =
              assertTrustedNormalizedShot(
                episodeId,
                shot,
              );

            return Object.freeze({
              sceneId:
                shot.sceneId,

              shotId,

              order:
                shot.order,

              title:
                shot.title,

              durationSeconds:
                shot.durationSeconds,

              sourceVideoPath:
                trusted.sourceVideoPath,

              sourceBytes:
                trusted.sourceBytes,

              sourceSha256:
                trusted.sourceSha256,
            });
          },
        );

  const calculatedDurationSeconds =
    plannedShots.reduce(
      (
        total,
        shot,
      ) =>
        total +
        shot.durationSeconds,
      0,
    );

  if (
    Math.abs(
      calculatedDurationSeconds -
      input.preparedComposition
        .totalDurationSeconds,
    ) >
    NUMERIC_EPSILON
  ) {
    throw new Error(
      "Episode rough-cut render planning total duration does not match the ordered prepared shots.",
    );
  }

  const renderIdentityParts:
    string[] =
      [
        ROUGH_CUT_RENDER_PROFILE_ID,
        episodeId,
        String(
          input.preparedComposition
            .totalShots,
        ),
        String(
          input.preparedComposition
            .totalDurationSeconds,
        ),
        `${input.postProduction.width}x${input.postProduction.height}@${input.postProduction.timelineFps}`,
        String(
          input.postProduction
            .audioSampleRateHz,
        ),
      ];

  for (
    const shot
    of plannedShots
  ) {
    renderIdentityParts.push(
      shot.shotId,
      String(
        shot.order,
      ),
      String(
        shot.durationSeconds,
      ),
      shot.sourceSha256,
    );
  }

  const renderKey =
    createHash(
      "sha256",
    )
      .update(
        renderIdentityParts.join(
          "\n",
        ),
        "utf8",
      )
      .digest(
        "hex",
      );

  const video =
    Object.freeze({
      codecName:
        "h264" as const,

      profile:
        "High" as const,

      width:
        input.postProduction
          .width,

      height:
        input.postProduction
          .height,

      frameRate:
        input.postProduction
          .timelineFps,

      pixelFormat:
        "yuv420p" as const,
    });

  const audio =
    Object.freeze({
      codecName:
        "aac" as const,

      sampleRateHz:
        input.postProduction
          .audioSampleRateHz,

      channels:
        2 as const,

      channelLayout:
        "stereo" as const,
    });

  const outputPath =
    resolvePortablePath(
      mediaRoot,
      "exports",
      episodeId,
      "rough-cut",
      `${episodeId}_rough-cut_${renderKey}.mp4`,
    );

  return Object.freeze({
    schemaVersion:
      "1.0" as const,

    profileId:
      ROUGH_CUT_RENDER_PROFILE_ID,

    assemblyMode:
      "STRAIGHT_CUT" as const,

    episodeId,

    title,

    totalShots:
      input.preparedComposition
        .totalShots,

    totalDurationSeconds:
      input.preparedComposition
        .totalDurationSeconds,

    container:
      "mp4" as const,

    video,

    audio,

    renderKey,

    outputPath,

    shots:
      Object.freeze([
        ...plannedShots,
      ]),
  });
}
