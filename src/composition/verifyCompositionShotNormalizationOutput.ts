import {
  isAbsolute,
} from "node:path";

import type {
  CompositionShotNormalizationPlan,
} from "./buildCompositionShotNormalizationPlan.js";

import type {
  CompositionSourceMediaMetadata,
} from "./probeCompositionSourceMedia.js";

const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /^[A-Za-z]:[\\/]/;

const NORMALIZATION_PROFILE_ID =
  "busybookie-master-normalization-v1" as const;

const NUMERIC_EPSILON_SECONDS =
  0.000001;

export type VerifiedCompositionShotNormalizationOutput =
  Readonly<{
    outputPath:
      string;

    durationSeconds:
      number;

    durationToleranceSeconds:
      number;
  }>;

export type VerifyCompositionShotNormalizationOutputInput =
  Readonly<{
    plan:
      CompositionShotNormalizationPlan;

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
      `Composition normalization output verification requires positive ${label}.`,
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
      `Composition normalization output verification requires positive integer ${label}.`,
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
    CompositionShotNormalizationPlan,
): void {
  if (
    plan.schemaVersion !==
    "1.0"
  ) {
    throw new Error(
      "Composition normalization output verification requires normalization schema version 1.0.",
    );
  }

  if (
    plan.profileId !==
    NORMALIZATION_PROFILE_ID
  ) {
    throw new Error(
      `Composition normalization output verification requires profile ${NORMALIZATION_PROFILE_ID}.`,
    );
  }

  if (
    plan.video.width !==
      1920 ||
    plan.video.height !==
      1080 ||
    plan.video.frameRate !==
      25 ||
    plan.audio.sampleRateHz !==
      48000
  ) {
    throw new Error(
      "Composition normalization output verification requires the v1 master profile geometry/timing: 1920x1080 at 25 fps with 48000 Hz audio.",
    );
  }

  if (
    plan.durationMode !==
    "MANIFEST_LOCKED"
  ) {
    throw new Error(
      "Composition normalization output verification requires MANIFEST_LOCKED duration mode.",
    );
  }

  if (
    plan.container !==
    "mp4"
  ) {
    throw new Error(
      "Composition normalization output verification requires MP4 output.",
    );
  }

  requirePositiveFiniteNumber(
    plan.targetDurationSeconds,
    "target duration",
  );

  if (
    plan.video.codecName !==
      "h264" ||
    plan.video.pixelFormat !==
      "yuv420p" ||
    plan.video.scaleMode !==
      "FIT_PAD"
  ) {
    throw new Error(
      "Composition normalization output verification requires the H.264/yuv420p/FIT_PAD video contract.",
    );
  }

  requirePositiveSafeInteger(
    plan.video.width,
    "target video width",
  );

  requirePositiveSafeInteger(
    plan.video.height,
    "target video height",
  );

  requirePositiveFiniteNumber(
    plan.video.frameRate,
    "target video frame rate",
  );

  if (
    plan.audio.codecName !==
      "aac" ||
    plan.audio.channels !==
      2 ||
    plan.audio.channelLayout !==
      "stereo"
  ) {
    throw new Error(
      "Composition normalization output verification requires the AAC stereo audio contract.",
    );
  }

  requirePositiveSafeInteger(
    plan.audio.sampleRateHz,
    "target audio sample rate",
  );
}

export function verifyCompositionShotNormalizationOutput(
  input:
    VerifyCompositionShotNormalizationOutputInput,
): VerifiedCompositionShotNormalizationOutput {
  validatePlan(
    input.plan,
  );

  const outputPath =
    input.outputMedia.sourceVideoPath.trim();

  if (
    outputPath.length ===
      0 ||
    !isPortableAbsolutePath(
      outputPath,
    )
  ) {
    throw new Error(
      "Composition normalization output verification requires an absolute output path.",
    );
  }

  const formats =
    input.outputMedia.formatName
      .split(
        ",",
      )
      .map(
        (value) =>
          value.trim()
            .toLowerCase(),
      );

  if (
    !formats.includes(
      "mp4",
    )
  ) {
    throw new Error(
      "Composition normalization output verification requires MP4 container metadata.",
    );
  }

  requirePositiveFiniteNumber(
    input.outputMedia.durationSeconds,
    "output duration",
  );

  if (
    input.outputMedia.video.codecName
      .toLowerCase() !==
      input.plan.video.codecName
  ) {
    throw new Error(
      "Composition normalization output video codec does not match the normalization plan.",
    );
  }

  if (
    input.outputMedia.video.profile !==
    "High"
  ) {
    throw new Error(
      "Composition normalization output requires H.264 High profile.",
    );
  }

  if (
    input.outputMedia.video.width !==
      input.plan.video.width ||
    input.outputMedia.video.height !==
      input.plan.video.height
  ) {
    throw new Error(
      "Composition normalization output video dimensions do not match the normalization plan.",
    );
  }

  if (
    input.outputMedia.video.pixelFormat
      .toLowerCase() !==
      input.plan.video.pixelFormat
  ) {
    throw new Error(
      "Composition normalization output pixel format does not match the normalization plan.",
    );
  }

  if (
    input.outputMedia.video.frameRate !==
    input.plan.video.frameRate
  ) {
    throw new Error(
      "Composition normalization output frame rate does not match the normalization plan.",
    );
  }

  const audio =
    input.outputMedia.audio;

  if (
    audio ===
    null
  ) {
    throw new Error(
      "Composition normalization output requires an audio stream.",
    );
  }

  if (
    audio.codecName.toLowerCase() !==
    input.plan.audio.codecName
  ) {
    throw new Error(
      "Composition normalization output audio codec does not match the normalization plan.",
    );
  }

  if (
    audio.sampleRateHz !==
    input.plan.audio.sampleRateHz
  ) {
    throw new Error(
      "Composition normalization output audio sample rate does not match the normalization plan.",
    );
  }

  if (
    audio.channels !==
      input.plan.audio.channels ||
    audio.channelLayout.toLowerCase() !==
      input.plan.audio.channelLayout
  ) {
    throw new Error(
      "Composition normalization output audio channel layout does not match the normalization plan.",
    );
  }

  const durationToleranceSeconds =
    1 /
    input.plan.video.frameRate;

  const durationDifferenceSeconds =
    Math.abs(
      input.outputMedia.durationSeconds -
      input.plan.targetDurationSeconds,
    );

  if (
    durationDifferenceSeconds >
    durationToleranceSeconds +
      NUMERIC_EPSILON_SECONDS
  ) {
    throw new Error(
      `Composition normalization output duration differs from the manifest duration by more than one normalized frame for ${input.plan.episodeId}/${input.plan.shotId}.`,
    );
  }

  return Object.freeze({
    outputPath,

    durationSeconds:
      input.outputMedia.durationSeconds,

    durationToleranceSeconds,
  });
}
