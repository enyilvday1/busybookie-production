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
  EpisodeCompositionPlanShot,
} from "./buildEpisodeCompositionPlan.js";

import type {
  CompositionSourceMediaMetadata,
} from "./probeCompositionSourceMedia.js";

const NORMALIZATION_PROFILE_ID =
  "busybookie-master-normalization-v1" as const;

const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /^[A-Za-z]:[\\/]/;

export type CompositionShotNormalizationAudioMode =
  | "PRESERVE_NATIVE"
  | "SYNTHETIC_SILENCE";

export type CompositionShotNormalizationPlan =
  Readonly<{
    schemaVersion:
      "1.0";

    profileId:
      typeof NORMALIZATION_PROFILE_ID;

    episodeId:
      string;

    shotId:
      string;

    sourceVideoPath:
      string;

    sourceSha256:
      string;

    sourceDurationSeconds:
      number;

    targetDurationSeconds:
      number;

    durationToleranceSeconds:
      number;

    durationMode:
      "MANIFEST_LOCKED";

    nativeAudio:
      boolean;

    container:
      "mp4";

    video:
      Readonly<{
        codecName:
          "h264";

        width:
          number;

        height:
          number;

        frameRate:
          number;

        pixelFormat:
          "yuv420p";

        scaleMode:
          "FIT_PAD";
      }>;

    audio:
      Readonly<{
        mode:
          CompositionShotNormalizationAudioMode;

        codecName:
          "aac";

        sampleRateHz:
          number;

        channels:
          2;

        channelLayout:
          "stereo";
      }>;

    cacheKey:
      string;

    outputPath:
      string;
  }>;

export type BuildCompositionShotNormalizationPlanInput =
  Readonly<{
    mediaRoot:
      string;

    episodeId:
      string;

    shot:
      EpisodeCompositionPlanShot;

    sourceMedia:
      CompositionSourceMediaMetadata;

    postProduction:
      ProductionRules["postProduction"];
  }>;

function isPortableAbsolutePath(
  value: string,
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
  root: string,
  ...segments: readonly string[]
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

function requirePositiveFiniteNumber(
  value: number,
  label: string,
): void {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <= 0
  ) {
    throw new Error(
      `Composition normalization requires positive ${label}.`,
    );
  }
}

function requirePositiveSafeInteger(
  value: number,
  label: string,
): void {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value <= 0
  ) {
    throw new Error(
      `Composition normalization requires positive integer ${label}.`,
    );
  }
}

function validateMasterFormat(
  postProduction:
    ProductionRules["postProduction"],
): void {
  if (
    postProduction.aspectRatio !==
    "16:9"
  ) {
    throw new Error(
      "Composition normalization requires the Busybookie 16:9 master aspect ratio.",
    );
  }

  if (
    postProduction.width !==
      1920 ||
    postProduction.height !==
      1080
  ) {
    throw new Error(
      "Composition normalization requires the Busybookie 1920x1080 master dimensions.",
    );
  }

  if (
    postProduction.timelineFps !==
    25
  ) {
    throw new Error(
      "Composition normalization requires the Busybookie 25 fps master timeline.",
    );
  }

  if (
    postProduction.audioSampleRateHz !==
    48000
  ) {
    throw new Error(
      "Composition normalization requires the Busybookie 48 kHz master audio rate.",
    );
  }
}

export function buildCompositionShotNormalizationPlan(
  input:
    BuildCompositionShotNormalizationPlanInput,
): CompositionShotNormalizationPlan {
  const normalizedMediaRoot =
    input.mediaRoot.trim();

  if (!normalizedMediaRoot) {
    throw new Error(
      "Composition normalization media root is required.",
    );
  }

  if (
    !isPortableAbsolutePath(
      normalizedMediaRoot,
    )
  ) {
    throw new Error(
      "Composition normalization media root must be absolute.",
    );
  }

  const episodeId =
    ExecutionReservationEpisodeIdSchema
      .parse(
        input.episodeId,
      );

  const shotId =
    ExecutionReservationShotIdSchema
      .parse(
        input.shot.shotId,
      );

  const sourceVideoPath =
    input.shot.sourceVideoPath.trim();

  if (!sourceVideoPath) {
    throw new Error(
      "Composition normalization source video path is required.",
    );
  }

  if (
    !isPortableAbsolutePath(
      sourceVideoPath,
    )
  ) {
    throw new Error(
      "Composition normalization source video path must be absolute.",
    );
  }

  if (
    input.sourceMedia.sourceVideoPath !==
    input.shot.sourceVideoPath
  ) {
    throw new Error(
      `Composition normalization source-media path does not match the admitted composition source for ${episodeId}/${shotId}.`,
    );
  }

  if (
    !/^[a-f0-9]{64}$/.test(
      input.shot.sourceSha256,
    )
  ) {
    throw new Error(
      "Composition normalization source SHA-256 must be a lowercase 64-character hexadecimal digest.",
    );
  }

  requirePositiveSafeInteger(
    input.shot.sourceBytes,
    "source byte count",
  );

  requirePositiveFiniteNumber(
    input.shot.durationSeconds,
    "target duration",
  );

  requirePositiveFiniteNumber(
    input.sourceMedia.durationSeconds,
    "source duration",
  );

  requirePositiveSafeInteger(
    input.sourceMedia.video.width,
    "source video width",
  );

  requirePositiveSafeInteger(
    input.sourceMedia.video.height,
    "source video height",
  );

  requirePositiveFiniteNumber(
    input.sourceMedia.video.frameRate,
    "source video frame rate",
  );

  const durationToleranceSeconds =
    1 /
    input.sourceMedia.video.frameRate;

  const durationDifferenceSeconds =
    Math.abs(
      input.sourceMedia.durationSeconds -
      input.shot.durationSeconds,
    );

  if (
    durationDifferenceSeconds >
    durationToleranceSeconds +
      0.000001
  ) {
    throw new Error(
      `Composition normalization source duration differs from manifest duration by more than one source frame for ${episodeId}/${shotId}.`,
    );
  }

  validateMasterFormat(
    input.postProduction,
  );

  if (
    input.shot.nativeAudio &&
    input.sourceMedia.audio ===
      null
  ) {
    throw new Error(
      `Composition normalization requires admitted native audio for ${episodeId}/${shotId}.`,
    );
  }

  if (
    !input.shot.nativeAudio &&
    input.sourceMedia.audio !==
      null
  ) {
    throw new Error(
      `Composition normalization requires source audio to be excluded when native audio is disabled for ${episodeId}/${shotId}.`,
    );
  }

  const audioMode:
    CompositionShotNormalizationAudioMode =
      input.shot.nativeAudio
        ? "PRESERVE_NATIVE"
        : "SYNTHETIC_SILENCE";

  const audioCacheToken =
    audioMode ===
    "PRESERVE_NATIVE"
      ? "preserve-native"
      : "synthetic-silence";

  const cacheIdentity =
    [
      NORMALIZATION_PROFILE_ID,
      episodeId,
      shotId,
      input.shot.sourceSha256,
      String(
        input.shot.durationSeconds,
      ),
      audioCacheToken,
      `${input.postProduction.width}x${input.postProduction.height}@${input.postProduction.timelineFps}`,
      String(
        input.postProduction.audioSampleRateHz,
      ),
    ].join(
      "\n",
    );

  const cacheKey =
    createHash(
      "sha256",
    )
      .update(
        cacheIdentity,
        "utf8",
      )
      .digest(
        "hex",
      );

  const video =
    Object.freeze({
      codecName:
        "h264" as const,

      width:
        input.postProduction.width,

      height:
        input.postProduction.height,

      frameRate:
        input.postProduction.timelineFps,

      pixelFormat:
        "yuv420p" as const,

      scaleMode:
        "FIT_PAD" as const,
    });

  const audio =
    Object.freeze({
      mode:
        audioMode,

      codecName:
        "aac" as const,

      sampleRateHz:
        input.postProduction.audioSampleRateHz,

      channels:
        2 as const,

      channelLayout:
        "stereo" as const,
    });

  const outputPath =
    resolvePortablePath(
      normalizedMediaRoot,
      "cache",
      "composition-normalized",
      episodeId,
      shotId,
      `${episodeId}_${shotId}_${cacheKey}.mp4`,
    );

  return Object.freeze({
    schemaVersion:
      "1.0" as const,

    profileId:
      NORMALIZATION_PROFILE_ID,

    episodeId,

    shotId,

    sourceVideoPath:
      input.shot.sourceVideoPath,

    sourceSha256:
      input.shot.sourceSha256,

    sourceDurationSeconds:
      input.sourceMedia.durationSeconds,

    targetDurationSeconds:
      input.shot.durationSeconds,

    durationToleranceSeconds,

    durationMode:
      "MANIFEST_LOCKED" as const,

    nativeAudio:
      input.shot.nativeAudio,

    container:
      "mp4" as const,

    video,

    audio,

    cacheKey,

    outputPath,
  });
}
