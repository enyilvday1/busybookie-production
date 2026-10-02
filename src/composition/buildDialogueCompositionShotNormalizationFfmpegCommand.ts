import {
  isAbsolute,
} from "node:path";

import type {
  DialogueCompositionShotNormalizationPlan,
} from "./buildDialogueCompositionShotNormalizationPlan.js";

const WINDOWS_ABSOLUTE_PATH_PATTERN =
  /^[A-Za-z]:[\\/]/;

const DIALOGUE_NORMALIZATION_PROFILE_ID =
  "busybookie-master-normalization-v2-dialogue" as const;

const NUMERIC_EPSILON_SECONDS =
  0.000001;

export type DialogueCompositionShotNormalizationFfmpegCommand =
  Readonly<{
    executable:
      string;

    args:
      readonly string[];
  }>;

export type BuildDialogueCompositionShotNormalizationFfmpegCommandInput =
  Readonly<{
    ffmpegExecutable:
      string;

    plan:
      DialogueCompositionShotNormalizationPlan;

    outputPath:
      string;
  }>;

function requireNonEmptyString(
  value:
    string,

  label:
    string,
): string {
  const normalized =
    value.trim();

  if (
    normalized.length ===
    0
  ) {
    throw new Error(
      `Dialogue composition normalization FFmpeg command requires ${label}.`,
    );
  }

  return normalized;
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
      `Dialogue composition normalization FFmpeg command requires absolute ${label}.`,
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
      `Dialogue composition normalization FFmpeg command requires positive finite ${label}.`,
    );
  }
}

function requireNonNegativeFiniteNumber(
  value:
    number,

  label:
    string,
): void {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <
      0
  ) {
    throw new Error(
      `Dialogue composition normalization FFmpeg command requires finite non-negative ${label}.`,
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
      `Dialogue composition normalization FFmpeg command requires positive integer ${label}.`,
    );
  }
}

function validatePlan(
  plan:
    DialogueCompositionShotNormalizationPlan,
): void {
  if (
    plan.schemaVersion !==
    "2.0"
  ) {
    throw new Error(
      "Dialogue composition normalization FFmpeg command requires normalization schema version 2.0.",
    );
  }

  if (
    plan.profileId !==
    DIALOGUE_NORMALIZATION_PROFILE_ID
  ) {
    throw new Error(
      `Dialogue composition normalization FFmpeg command requires profile ${DIALOGUE_NORMALIZATION_PROFILE_ID}.`,
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
      "Dialogue composition normalization FFmpeg command requires the v2 master profile geometry/timing: 1920x1080 at 25 fps with 48000 Hz audio.",
    );
  }

  if (
    plan.durationMode !==
    "MANIFEST_LOCKED"
  ) {
    throw new Error(
      "Dialogue composition normalization FFmpeg command requires MANIFEST_LOCKED duration mode.",
    );
  }

  if (
    plan.container !==
    "mp4"
  ) {
    throw new Error(
      "Dialogue composition normalization FFmpeg command requires MP4 output.",
    );
  }

  requirePositiveFiniteNumber(
    plan.targetDurationSeconds,
    "target duration",
  );

  requirePositiveFiniteNumber(
    plan.durationToleranceSeconds,
    "duration tolerance",
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
      "Dialogue composition normalization FFmpeg command requires the H.264/yuv420p/FIT_PAD video contract.",
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
    plan.audio.mode !==
    "REPLACE_SOURCE_WITH_DIALOGUE"
  ) {
    throw new Error(
      "Dialogue composition normalization FFmpeg command requires REPLACE_SOURCE_WITH_DIALOGUE audio mode.",
    );
  }

  if (
    plan.audio.mixNativeAudio !==
    false
  ) {
    throw new Error(
      "Dialogue composition normalization FFmpeg command requires mixNativeAudio=false.",
    );
  }

  const expectedSourceAudioDisposition =
    plan.nativeAudio
      ? "DISCARD_NATIVE_AUDIO"
      : "NO_SOURCE_AUDIO";

  if (
    plan.audio.sourceAudioDisposition !==
    expectedSourceAudioDisposition
  ) {
    throw new Error(
      "Dialogue composition normalization FFmpeg command source-audio disposition does not match the source native-audio state.",
    );
  }

  if (
    plan.audio.codecName !==
      "aac" ||
    plan.audio.channels !==
      2 ||
    plan.audio.channelLayout !==
      "stereo"
  ) {
    throw new Error(
      "Dialogue composition normalization FFmpeg command requires the AAC stereo audio contract.",
    );
  }

  requirePositiveSafeInteger(
    plan.audio.sampleRateHz,
    "audio sample rate",
  );

  if (
    plan.audio.lines.length ===
    0
  ) {
    throw new Error(
      "Dialogue composition normalization FFmpeg command requires at least one dialogue line.",
    );
  }

  let previousEndSeconds:
    number | null =
      null;

  const seenDialogueLineIds =
    new Set<string>();

  for (
    let index =
      0;
    index <
      plan.audio.lines.length;
    index +=
      1
  ) {
    const line =
      plan.audio.lines[
        index
      ];

    if (!line) {
      throw new Error(
        `Dialogue composition normalization FFmpeg command could not resolve dialogue line index ${index}.`,
      );
    }

    const expectedLineNumber =
      index +
      1;

    if (
      line.lineNumber !==
      expectedLineNumber
    ) {
      throw new Error(
        `Dialogue composition normalization FFmpeg command requires continuous dialogue line order; expected ${expectedLineNumber}, received ${line.lineNumber}.`,
      );
    }

    const dialogueLineId =
      requireNonEmptyString(
        line.dialogueLineId,
        `dialogue line identity at index ${index}`,
      );

    if (
      seenDialogueLineIds.has(
        dialogueLineId,
      )
    ) {
      throw new Error(
        `Dialogue composition normalization FFmpeg command received duplicate dialogue line ${dialogueLineId}.`,
      );
    }

    seenDialogueLineIds.add(
      dialogueLineId,
    );

    requireAbsolutePath(
      line.sourceAudioPath,
      `source audio path for ${dialogueLineId}`,
    );

    requirePositiveSafeInteger(
      line.sourceBytes,
      `source byte count for ${dialogueLineId}`,
    );

    if (
      !/^[a-f0-9]{64}$/u.test(
        line.sourceSha256,
      )
    ) {
      throw new Error(
        `Dialogue composition normalization FFmpeg command requires a lowercase SHA-256 for ${dialogueLineId}.`,
      );
    }

    requireNonNegativeFiniteNumber(
      line.startSeconds,
      `start time for ${dialogueLineId}`,
    );

    requirePositiveFiniteNumber(
      line.durationSeconds,
      `duration for ${dialogueLineId}`,
    );

    requirePositiveFiniteNumber(
      line.endSeconds,
      `end time for ${dialogueLineId}`,
    );

    const calculatedEndSeconds =
      line.startSeconds +
      line.durationSeconds;

    if (
      Math.abs(
        calculatedEndSeconds -
        line.endSeconds,
      ) >
      plan.durationToleranceSeconds +
        NUMERIC_EPSILON_SECONDS
    ) {
      throw new Error(
        `Dialogue composition normalization FFmpeg command line ${dialogueLineId} end does not match start plus duration.`,
      );
    }

    if (
      line.endSeconds >
      plan.targetDurationSeconds +
        plan.durationToleranceSeconds +
        NUMERIC_EPSILON_SECONDS
    ) {
      throw new Error(
        `Dialogue composition normalization FFmpeg command line ${dialogueLineId} ends beyond the shot duration tolerance.`,
      );
    }

    if (
      previousEndSeconds !==
        null &&
      line.startSeconds <
        previousEndSeconds
    ) {
      throw new Error(
        `Dialogue composition normalization FFmpeg command does not permit overlapping dialogue lines; ${dialogueLineId} overlaps its predecessor.`,
      );
    }

    previousEndSeconds =
      line.endSeconds;
  }
}

export function buildDialogueCompositionShotNormalizationFfmpegCommand(
  input:
    BuildDialogueCompositionShotNormalizationFfmpegCommandInput,
): DialogueCompositionShotNormalizationFfmpegCommand {
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
    outputPath ===
    sourceVideoPath
  ) {
    throw new Error(
      "Dialogue composition normalization FFmpeg command output path must differ from the source video path.",
    );
  }

  const dialogueAudioPaths =
    input.plan.audio.lines.map(
      (
        line,
      ) =>
        requireAbsolutePath(
          line.sourceAudioPath,
          `source audio path for ${line.dialogueLineId}`,
        ),
    );

  if (
    dialogueAudioPaths.includes(
      outputPath,
    )
  ) {
    throw new Error(
      "Dialogue composition normalization FFmpeg command output path must differ from every dialogue source audio path.",
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

  const baseAudioFilter =
    [
      `anullsrc=channel_layout=stereo:sample_rate=${sampleRate}:duration=${duration},`,
      `atrim=duration=${duration},`,
      "asetpts=PTS-STARTPTS",
      "[base];",
    ].join(
      "",
    );

  const dialogueAudioFilters =
    input.plan.audio.lines.map(
      (
        line,
        index,
      ) =>
        [
          `[${index + 1}:a:0]`,
          `aresample=sample_rate=${sampleRate}:out_chlayout=stereo,`,
          `atrim=duration=${line.durationSeconds},`,
          "asetpts=PTS-STARTPTS,",
          `adelay=${Math.round(line.startSeconds * input.plan.audio.sampleRateHz)}S:all=1`,
          `[d${index}];`,
        ].join(
          "",
        ),
    )
      .join(
        "",
      );

  const mixInputs =
    [
      "[base]",
      ...input.plan.audio.lines.map(
        (
          _line,
          index,
        ) =>
          `[d${index}]`,
      ),
    ].join(
      "",
    );

  const mixedAudioFilter =
    [
      mixInputs,
      `amix=inputs=${input.plan.audio.lines.length + 1}:duration=longest:dropout_transition=0:normalize=0,`,
      `atrim=duration=${duration},`,
      "asetpts=PTS-STARTPTS",
      "[a]",
    ].join(
      "",
    );

  const filterComplex =
    [
      videoFilter,
      baseAudioFilter,
      dialogueAudioFilters,
      mixedAudioFilter,
    ].join(
      "",
    );

  const inputArguments =
    dialogueAudioPaths.flatMap(
      (
        sourceAudioPath,
      ) => [
        "-i",
        sourceAudioPath,
      ],
    );

  const args =
    Object.freeze([
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-n",

      "-i",
      sourceVideoPath,

      ...inputArguments,

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
