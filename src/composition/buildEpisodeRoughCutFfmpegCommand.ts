import {
  isAbsolute,
  win32,
} from "node:path";

import type {
  EpisodeRoughCutRenderPlan,
} from "./buildEpisodeRoughCutRenderPlan.js";

const ROUGH_CUT_RENDER_PROFILE_ID =
  "busybookie-episode-rough-cut-v1" as const;

const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /^[A-Za-z]:[\\/]/;

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/u;

const NUMERIC_EPSILON =
  0.000001;

export type EpisodeRoughCutFfmpegCommand =
  Readonly<{
    executable:
      string;

    args:
      readonly string[];
  }>;

export type BuildEpisodeRoughCutFfmpegCommandInput =
  Readonly<{
    ffmpegExecutable:
      string;

    plan:
      EpisodeRoughCutRenderPlan;

    outputPath:
      string;
  }>;

function requireNonEmptyString(
  value:
    string,

  label:
    string,
): string {
  const trimmed =
    value.trim();

  if (
    trimmed.length ===
      0
  ) {
    throw new Error(
      `Episode rough-cut FFmpeg command requires ${label}.`,
    );
  }

  return trimmed;
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

function requireAbsolutePath(
  value:
    string,

  label:
    string,
): string {
  const normalized =
    requireNonEmptyString(
      value,
      label,
    );

  if (
    !isPortableAbsolutePath(
      normalized,
    )
  ) {
    throw new Error(
      `Episode rough-cut FFmpeg command requires absolute ${label}.`,
    );
  }

  return normalized;
}

function canonicalPathForComparison(
  value:
    string,
): string {
  if (
    WINDOWS_ABSOLUTE_PATH_PATTERN.test(
      value,
    )
  ) {
    return win32
      .normalize(
        value,
      )
      .toLowerCase();
  }

  return value;
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
      `Episode rough-cut FFmpeg command requires positive ${label}.`,
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
      `Episode rough-cut FFmpeg command requires positive integer ${label}.`,
    );
  }
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
      "Episode rough-cut FFmpeg command requires render-plan schema version 1.0.",
    );
  }

  if (
    plan.profileId !==
      ROUGH_CUT_RENDER_PROFILE_ID
  ) {
    throw new Error(
      `Episode rough-cut FFmpeg command requires profile ${ROUGH_CUT_RENDER_PROFILE_ID}.`,
    );
  }

  if (
    plan.assemblyMode !==
      "STRAIGHT_CUT"
  ) {
    throw new Error(
      "Episode rough-cut FFmpeg command requires STRAIGHT_CUT assembly mode.",
    );
  }

  if (
    plan.container !==
      "mp4"
  ) {
    throw new Error(
      "Episode rough-cut FFmpeg command requires MP4 output.",
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
      "Episode rough-cut FFmpeg command requires the Busybookie v1 master profile: H.264 High, 1920x1080, 25 fps, yuv420p, AAC 48000 Hz stereo.",
    );
  }

  requirePositiveSafeInteger(
    plan.totalShots,
    "total shot count",
  );

  requirePositiveFiniteNumber(
    plan.totalDurationSeconds,
    "total duration",
  );

  if (
    plan.shots.length !==
      plan.totalShots
  ) {
    throw new Error(
      "Episode rough-cut FFmpeg command total shot count does not match the render-plan shot list.",
    );
  }

  if (
    plan.shots.length ===
      0
  ) {
    throw new Error(
      "Episode rough-cut FFmpeg command requires at least one shot.",
    );
  }

  if (
    !SHA256_PATTERN.test(
      plan.renderKey,
    )
  ) {
    throw new Error(
      "Episode rough-cut FFmpeg command requires a lowercase 64-character render key.",
    );
  }

  let calculatedDurationSeconds =
    0;

  for (
    let index =
      0;
    index <
      plan.shots.length;
    index +=
      1
  ) {
    const shot =
      plan.shots[
        index
      ];

    if (
      shot ===
      undefined
    ) {
      throw new Error(
        `Episode rough-cut FFmpeg command could not resolve shot index ${index}.`,
      );
    }

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
        `Episode rough-cut FFmpeg command requires continuous shot order. Expected ${expectedOrder}, found ${shot.order}.`,
      );
    }

    requirePositiveFiniteNumber(
      shot.durationSeconds,
      `duration for shot ${shot.shotId}`,
    );

    requirePositiveSafeInteger(
      shot.sourceBytes,
      `source byte count for shot ${shot.shotId}`,
    );

    if (
      !SHA256_PATTERN.test(
        shot.sourceSha256,
      )
    ) {
      throw new Error(
        `Episode rough-cut FFmpeg command requires a valid source SHA-256 for shot ${shot.shotId}.`,
      );
    }

    requireAbsolutePath(
      shot.sourceVideoPath,
      `source video path for shot ${shot.shotId}`,
    );

    calculatedDurationSeconds +=
      shot.durationSeconds;
  }

  if (
    Math.abs(
      calculatedDurationSeconds -
      plan.totalDurationSeconds,
    ) >
    NUMERIC_EPSILON
  ) {
    throw new Error(
      "Episode rough-cut FFmpeg command total duration does not match the render-plan shot durations.",
    );
  }
}

export function buildEpisodeRoughCutFfmpegCommand(
  input:
    BuildEpisodeRoughCutFfmpegCommandInput,
): EpisodeRoughCutFfmpegCommand {
  const executable =
    requireNonEmptyString(
      input.ffmpegExecutable,
      "an FFmpeg executable",
    );

  validatePlan(
    input.plan,
  );

  const outputPath =
    requireAbsolutePath(
      input.outputPath,
      "output path",
    );

  const canonicalOutputPath =
    canonicalPathForComparison(
      outputPath,
    );

  const inputArgs:
    string[] =
      [];

  const filterInputLabels:
    string[] =
      [];

  for (
    let index =
      0;
    index <
      input.plan.shots.length;
    index +=
      1
  ) {
    const shot =
      input.plan.shots[
        index
      ];

    if (
      shot ===
      undefined
    ) {
      throw new Error(
        `Episode rough-cut FFmpeg command could not resolve shot index ${index}.`,
      );
    }

    const sourceVideoPath =
      requireAbsolutePath(
        shot.sourceVideoPath,
        `source video path for shot ${shot.shotId}`,
      );

    if (
      canonicalPathForComparison(
        sourceVideoPath,
      ) ===
      canonicalOutputPath
    ) {
      throw new Error(
        "Episode rough-cut FFmpeg command output path must differ from every source video path.",
      );
    }

    inputArgs.push(
      "-i",
      sourceVideoPath,
    );

    filterInputLabels.push(
      `[${index}:v:0]`,
      `[${index}:a:0]`,
    );
  }

  const filterComplex =
    [
      ...filterInputLabels,
      `concat=n=${input.plan.totalShots}:v=1:a=1`,
      "[v]",
      "[a]",
    ].join(
      "",
    );

  const args =
    Object.freeze([
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-n",
      ...inputArgs,
      "-filter_complex",
      filterComplex,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(
        input.plan.video.frameRate,
      ),
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      String(
        input.plan.audio.sampleRateHz,
      ),
      "-ac",
      "2",
      "-t",
      String(
        input.plan.totalDurationSeconds,
      ),
      "-map_metadata",
      "-1",
      "-map_chapters",
      "-1",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      outputPath,
    ]);

  return Object.freeze({
    executable,
    args,
  });
}
