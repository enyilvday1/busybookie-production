import {
  isAbsolute,
} from "node:path";

import type {
  CompositionShotNormalizationPlan,
} from "./buildCompositionShotNormalizationPlan.js";

const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /^[A-Za-z]:[\\/]/;

const NORMALIZATION_PROFILE_ID =
  "busybookie-master-normalization-v1" as const;

export type CompositionShotNormalizationFfmpegCommand =
  Readonly<{
    executable:
      string;

    args:
      readonly string[];
  }>;

export type BuildCompositionShotNormalizationFfmpegCommandInput =
  Readonly<{
    ffmpegExecutable:
      string;

    plan:
      CompositionShotNormalizationPlan;

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
      `Composition normalization FFmpeg command requires ${label}.`,
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
      `Composition normalization FFmpeg command requires absolute ${label}.`,
    );
  }

  return normalized;
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
      `Composition normalization FFmpeg command requires positive ${label}.`,
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
      `Composition normalization FFmpeg command requires positive integer ${label}.`,
    );
  }
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
      "Composition normalization FFmpeg command requires normalization schema version 1.0.",
    );
  }

  if (
    plan.profileId !==
    NORMALIZATION_PROFILE_ID
  ) {
    throw new Error(
      `Composition normalization FFmpeg command requires profile ${NORMALIZATION_PROFILE_ID}.`,
    );
  }

  if (
    plan.durationMode !==
    "MANIFEST_LOCKED"
  ) {
    throw new Error(
      "Composition normalization FFmpeg command requires MANIFEST_LOCKED duration mode.",
    );
  }

  if (
    plan.container !==
    "mp4"
  ) {
    throw new Error(
      "Composition normalization FFmpeg command requires MP4 output.",
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
      "Composition normalization FFmpeg command requires the H.264/yuv420p/FIT_PAD video contract.",
    );
  }

  requirePositiveSafeInteger(
    plan.video.width,
    "video width",
  );

  requirePositiveSafeInteger(
    plan.video.height,
    "video height",
  );

  requirePositiveFiniteNumber(
    plan.video.frameRate,
    "video frame rate",
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
      "Composition normalization FFmpeg command requires the AAC stereo audio contract.",
    );
  }

  requirePositiveSafeInteger(
    plan.audio.sampleRateHz,
    "audio sample rate",
  );

  if (
    plan.nativeAudio &&
    plan.audio.mode !==
      "PRESERVE_NATIVE"
  ) {
    throw new Error(
      "Composition normalization FFmpeg command requires PRESERVE_NATIVE audio mode when native audio is enabled.",
    );
  }

  if (
    !plan.nativeAudio &&
    plan.audio.mode !==
      "SYNTHETIC_SILENCE"
  ) {
    throw new Error(
      "Composition normalization FFmpeg command requires SYNTHETIC_SILENCE audio mode when native audio is disabled.",
    );
  }
}

export function buildCompositionShotNormalizationFfmpegCommand(
  input:
    BuildCompositionShotNormalizationFfmpegCommandInput,
): CompositionShotNormalizationFfmpegCommand {
  const executable =
    requireNonEmptyString(
      input.ffmpegExecutable,
      "an FFmpeg executable",
    );

  validatePlan(
    input.plan,
  );

  const sourceVideoPath =
    requireAbsolutePath(
      input.plan.sourceVideoPath,
      "source video path",
    );

  const outputPath =
    requireAbsolutePath(
      input.outputPath,
      "output path",
    );

  if (
    sourceVideoPath ===
    outputPath
  ) {
    throw new Error(
      "Composition normalization FFmpeg command output path must differ from the source video path.",
    );
  }

  const duration =
    String(
      input.plan.targetDurationSeconds,
    );

  const width =
    String(
      input.plan.video.width,
    );

  const height =
    String(
      input.plan.video.height,
    );

  const frameRate =
    String(
      input.plan.video.frameRate,
    );

  const sampleRate =
    String(
      input.plan.audio.sampleRateHz,
    );

  const videoFilter =
    [
      "[0:v:0]",
      `scale=w=${width}:h=${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,`,
      `pad=w=${width}:h=${height}:x=(ow-iw)/2:y=(oh-ih)/2,`,
      "setsar=1,",
      `fps=fps=${frameRate},`,
      `tpad=stop_mode=clone:stop_duration=${duration},`,
      `trim=duration=${duration},`,
      "setpts=PTS-STARTPTS",
      "[v];",
    ].join(
      "",
    );

  const audioFilter =
    input.plan.audio.mode ===
    "PRESERVE_NATIVE"
      ? [
          "[0:a:0]",
          `aresample=sample_rate=${sampleRate}:out_chlayout=stereo,`,
          `apad=whole_dur=${duration},`,
          `atrim=duration=${duration},`,
          "asetpts=PTS-STARTPTS",
          "[a]",
        ].join(
          "",
        )
      : [
          `anullsrc=channel_layout=stereo:sample_rate=${sampleRate}:duration=${duration},`,
          `atrim=duration=${duration},`,
          "asetpts=PTS-STARTPTS",
          "[a]",
        ].join(
          "",
        );

  const filterComplex =
    `${videoFilter}${audioFilter}`;

  const args =
    Object.freeze([
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-n",
      "-i",
      sourceVideoPath,
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
      frameRate,
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      sampleRate,
      "-ac",
      "2",
      "-t",
      duration,
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
