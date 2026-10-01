import {
  isAbsolute,
} from "node:path";

import type {
  EpisodeRoughCutRenderPlan,
} from "./buildEpisodeRoughCutRenderPlan.js";

import type {
  CompositionSourceMediaMetadata,
} from "./probeCompositionSourceMedia.js";

const ROUGH_CUT_RENDER_PROFILE_ID =
  "busybookie-episode-rough-cut-v1" as const;

const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /^[A-Za-z]:[\\/]/;

const NUMERIC_EPSILON_SECONDS =
  0.000001;

export type VerifiedEpisodeRoughCutOutput =
  Readonly<{
    outputPath:
      string;

    durationSeconds:
      number;

    durationToleranceSeconds:
      number;
  }>;

export type VerifyEpisodeRoughCutOutputInput =
  Readonly<{
    plan:
      EpisodeRoughCutRenderPlan;

    outputMedia:
      CompositionSourceMediaMetadata;
  }>;

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
      `Episode rough-cut output verification requires positive ${label}.`,
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
      `Episode rough-cut output verification requires positive integer ${label}.`,
    );
  }
}

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

function validatePlan(
  plan:
    EpisodeRoughCutRenderPlan,
): void {
  if (
    plan.schemaVersion !==
      "1.0"
  ) {
    throw new Error(
      "Episode rough-cut output verification requires render-plan schema version 1.0.",
    );
  }

  if (
    plan.profileId !==
      ROUGH_CUT_RENDER_PROFILE_ID
  ) {
    throw new Error(
      `Episode rough-cut output verification requires profile ${ROUGH_CUT_RENDER_PROFILE_ID}.`,
    );
  }

  if (
    plan.assemblyMode !==
      "STRAIGHT_CUT"
  ) {
    throw new Error(
      "Episode rough-cut output verification requires STRAIGHT_CUT assembly mode.",
    );
  }

  if (
    plan.container !==
      "mp4"
  ) {
    throw new Error(
      "Episode rough-cut output verification requires MP4 output.",
    );
  }

  if (
    plan.video.codecName !==
      "h264" ||
    plan.video.profile !==
      "High" ||
    plan.video.width !==
      1920 ||
    plan.video.height !==
      1080 ||
    plan.video.frameRate !==
      25 ||
    plan.video.pixelFormat !==
      "yuv420p" ||
    plan.audio.codecName !==
      "aac" ||
    plan.audio.sampleRateHz !==
      48000 ||
    plan.audio.channels !==
      2 ||
    plan.audio.channelLayout !==
      "stereo"
  ) {
    throw new Error(
      "Episode rough-cut output verification requires the Busybookie v1 master profile: H.264 High, 1920x1080, 25 fps, yuv420p, AAC 48000 Hz stereo.",
    );
  }

  requirePositiveSafeInteger(
    plan.totalShots,
    "total shot count",
  );

  requirePositiveFiniteNumber(
    plan.totalDurationSeconds,
    "planned duration",
  );

  if (
    plan.shots.length !==
      plan.totalShots
  ) {
    throw new Error(
      "Episode rough-cut output verification total shot count does not match the render-plan shot list.",
    );
  }
}

export function verifyEpisodeRoughCutOutput(
  input:
    VerifyEpisodeRoughCutOutputInput,
): VerifiedEpisodeRoughCutOutput {
  validatePlan(
    input.plan,
  );

  const outputPath =
    input.outputMedia
      .sourceVideoPath
      .trim();

  if (
    outputPath.length ===
      0 ||
    !isPortableAbsolutePath(
      outputPath,
    )
  ) {
    throw new Error(
      "Episode rough-cut output verification requires an absolute output path.",
    );
  }

  const formats =
    input.outputMedia
      .formatName
      .split(
        ",",
      )
      .map(
        (
          value,
        ) =>
          value
            .trim()
            .toLowerCase(),
      );

  if (
    !formats.includes(
      "mp4",
    )
  ) {
    throw new Error(
      "Episode rough-cut output verification requires MP4 container metadata.",
    );
  }

  requirePositiveFiniteNumber(
    input.outputMedia
      .durationSeconds,
    "output duration",
  );

  if (
    input.outputMedia
      .video
      .codecName
      .toLowerCase() !==
    input.plan
      .video
      .codecName
  ) {
    throw new Error(
      "Episode rough-cut output video codec does not match the render plan.",
    );
  }

  if (
    input.outputMedia
      .video
      .profile !==
    "High"
  ) {
    throw new Error(
      "Episode rough-cut output requires H.264 High profile.",
    );
  }

  if (
    input.outputMedia
      .video
      .width !==
      input.plan
        .video
        .width ||
    input.outputMedia
      .video
      .height !==
      input.plan
        .video
        .height
  ) {
    throw new Error(
      "Episode rough-cut output video dimensions do not match the render plan.",
    );
  }

  if (
    input.outputMedia
      .video
      .pixelFormat
      .toLowerCase() !==
    input.plan
      .video
      .pixelFormat
  ) {
    throw new Error(
      "Episode rough-cut output pixel format does not match the render plan.",
    );
  }

  if (
    input.outputMedia
      .video
      .frameRate !==
    input.plan
      .video
      .frameRate
  ) {
    throw new Error(
      "Episode rough-cut output frame rate does not match the render plan.",
    );
  }

  const audio =
    input.outputMedia
      .audio;

  if (
    audio ===
      null
  ) {
    throw new Error(
      "Episode rough-cut output requires an audio stream.",
    );
  }

  if (
    audio.codecName
      .toLowerCase() !==
    input.plan
      .audio
      .codecName
  ) {
    throw new Error(
      "Episode rough-cut output audio codec does not match the render plan.",
    );
  }

  if (
    audio.sampleRateHz !==
      input.plan
        .audio
        .sampleRateHz
  ) {
    throw new Error(
      "Episode rough-cut output audio sample rate does not match the render plan.",
    );
  }

  if (
    audio.channels !==
      input.plan
        .audio
        .channels ||
    audio.channelLayout
      .toLowerCase() !==
      input.plan
        .audio
        .channelLayout
  ) {
    throw new Error(
      "Episode rough-cut output audio channel layout does not match the render plan.",
    );
  }

  const durationToleranceSeconds =
    1 /
    input.plan
      .video
      .frameRate;

  const durationDifferenceSeconds =
    Math.abs(
      input.outputMedia
        .durationSeconds -
      input.plan
        .totalDurationSeconds,
    );

  if (
    durationDifferenceSeconds >
      durationToleranceSeconds +
        NUMERIC_EPSILON_SECONDS
  ) {
    throw new Error(
      `Episode rough-cut output duration differs from the planned composition duration by more than one rendered frame for ${input.plan.episodeId}.`,
    );
  }

  return Object.freeze({
    outputPath,

    durationSeconds:
      input.outputMedia
        .durationSeconds,

    durationToleranceSeconds,
  });
}
