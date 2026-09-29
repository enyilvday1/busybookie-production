import {
  execFile,
} from "node:child_process";

export type CompositionSourceMediaProbeInput =
  Readonly<{
    ffprobeExecutable:
      string;

    sourceVideoPath:
      string;

    nativeAudio:
      boolean;
  }>;

export type CompositionSourceMediaProbeRunnerResult =
  Readonly<{
    executable:
      string;

    args:
      readonly string[];

    stdout:
      string;

    stderr:
      string;
  }>;

export type CompositionSourceMediaProbeRunner =
  (
    executable:
      string,

    args:
      readonly string[],
  ) =>
    Promise<
      CompositionSourceMediaProbeRunnerResult
    >;

export type CompositionSourceVideoMetadata =
  Readonly<{
    codecName:
      string;

    profile:
      string | null;

    width:
      number;

    height:
      number;

    pixelFormat:
      string;

    frameRate:
      number;
  }>;

export type CompositionSourceAudioMetadata =
  Readonly<{
    codecName:
      string;

    profile:
      string | null;

    sampleRateHz:
      number;

    channels:
      number;

    channelLayout:
      string;
  }>;

export type CompositionSourceMediaMetadata =
  Readonly<{
    sourceVideoPath:
      string;

    formatName:
      string;

    durationSeconds:
      number;

    video:
      CompositionSourceVideoMetadata;

    audio:
      CompositionSourceAudioMetadata | null;
  }>;

export type ProbeCompositionSourceMediaDependencies =
  Readonly<{
    runProbe:
      CompositionSourceMediaProbeRunner;
  }>;

type UnknownRecord =
  Record<string, unknown>;

const defaultRunProbe:
  CompositionSourceMediaProbeRunner =
  async (
    executable,
    args,
  ) =>
    new Promise(
      (
        resolve,
        reject,
      ) => {
        execFile(
          executable,
          [
            ...args,
          ],
          {
            encoding:
              "utf8",

            windowsHide:
              true,

            timeout:
              10_000,

            maxBuffer:
              4 * 1024 * 1024,
          },
          (
            error,
            stdout,
            stderr,
          ) => {
            if (error) {
              reject(
                error,
              );

              return;
            }

            resolve(
              Object.freeze({
                executable,

                args:
                  Object.freeze([
                    ...args,
                  ]),

                stdout,

                stderr,
              }),
            );
          },
        );
      },
    );

const defaultDependencies:
  ProbeCompositionSourceMediaDependencies =
  Object.freeze({
    runProbe:
      defaultRunProbe,
  });

function isRecord(
  value:
    unknown,
): value is UnknownRecord {
  return (
    typeof value ===
      "object" &&
    value !==
      null &&
    !Array.isArray(
      value,
    )
  );
}

function requireNonEmptyString(
  value:
    unknown,

  label:
    string,
): string {
  if (
    typeof value !==
      "string" ||
    value.trim().length ===
      0
  ) {
    throw new Error(
      `Composition source media probe requires ${label}.`,
    );
  }

  return value.trim();
}

function optionalNonEmptyString(
  value:
    unknown,
): string | null {
  if (
    typeof value !==
      "string"
  ) {
    return null;
  }

  const trimmed =
    value.trim();

  return trimmed.length >
    0
    ? trimmed
    : null;
}

function requirePositiveNumber(
  value:
    unknown,

  label:
    string,
): number {
  const parsed =
    typeof value ===
      "number"
      ? value
      : typeof value ===
          "string"
        ? Number(
            value,
          )
        : Number.NaN;

  if (
    !Number.isFinite(
      parsed,
    ) ||
    parsed <=
      0
  ) {
    throw new Error(
      `Composition source media probe requires positive ${label}.`,
    );
  }

  return parsed;
}

function requirePositiveInteger(
  value:
    unknown,

  label:
    string,
): number {
  const parsed =
    requirePositiveNumber(
      value,
      label,
    );

  if (
    !Number.isInteger(
      parsed,
    )
  ) {
    throw new Error(
      `Composition source media probe requires integer ${label}.`,
    );
  }

  return parsed;
}

function parseRate(
  value:
    unknown,
): number | null {
  if (
    typeof value ===
      "number"
  ) {
    return (
      Number.isFinite(
        value,
      ) &&
      value >
        0
    )
      ? value
      : null;
  }

  if (
    typeof value !==
      "string"
  ) {
    return null;
  }

  const trimmed =
    value.trim();

  if (
    trimmed.length ===
      0
  ) {
    return null;
  }

  const parts =
    trimmed.split(
      "/",
    );

  if (
    parts.length ===
      2
  ) {
    const numerator =
      Number(
        parts[0],
      );

    const denominator =
      Number(
        parts[1],
      );

    if (
      Number.isFinite(
        numerator,
      ) &&
      Number.isFinite(
        denominator,
      ) &&
      numerator >
        0 &&
      denominator >
        0
    ) {
      return (
        numerator /
        denominator
      );
    }

    return null;
  }

  const parsed =
    Number(
      trimmed,
    );

  return (
    Number.isFinite(
      parsed,
    ) &&
    parsed >
      0
  )
    ? parsed
    : null;
}

function requireFrameRate(
  stream:
    UnknownRecord,
): number {
  const average =
    parseRate(
      stream.avg_frame_rate,
    );

  if (
    average !==
      null
  ) {
    return average;
  }

  const nominal =
    parseRate(
      stream.r_frame_rate,
    );

  if (
    nominal !==
      null
  ) {
    return nominal;
  }

  throw new Error(
    "Composition source media probe requires a positive video frame rate.",
  );
}

function parseVideoStream(
  stream:
    UnknownRecord,
): CompositionSourceVideoMetadata {
  return Object.freeze({
    codecName:
      requireNonEmptyString(
        stream.codec_name,
        "video codec name",
      ),

    profile:
      optionalNonEmptyString(
        stream.profile,
      ),

    width:
      requirePositiveInteger(
        stream.width,
        "video width",
      ),

    height:
      requirePositiveInteger(
        stream.height,
        "video height",
      ),

    pixelFormat:
      requireNonEmptyString(
        stream.pix_fmt,
        "video pixel format",
      ),

    frameRate:
      requireFrameRate(
        stream,
      ),
  });
}

function parseAudioStream(
  stream:
    UnknownRecord,
): CompositionSourceAudioMetadata {
  return Object.freeze({
    codecName:
      requireNonEmptyString(
        stream.codec_name,
        "audio codec name",
      ),

    profile:
      optionalNonEmptyString(
        stream.profile,
      ),

    sampleRateHz:
      requirePositiveInteger(
        stream.sample_rate,
        "audio sample rate",
      ),

    channels:
      requirePositiveInteger(
        stream.channels,
        "audio channel count",
      ),

    channelLayout:
      requireNonEmptyString(
        stream.channel_layout,
        "audio channel layout",
      ),
  });
}

function parseProbeJson(
  stdout:
    string,

  sourceVideoPath:
    string,

  nativeAudio:
    boolean,
): CompositionSourceMediaMetadata {
  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        stdout,
      );
  } catch (error) {
    throw new Error(
      `Composition source media probe returned invalid JSON for ${sourceVideoPath}.`,
      {
        cause:
          error,
      },
    );
  }

  if (
    !isRecord(
      parsed,
    )
  ) {
    throw new Error(
      `Composition source media probe returned an invalid document for ${sourceVideoPath}.`,
    );
  }

  const streams =
    parsed.streams;

  if (
    !Array.isArray(
      streams,
    )
  ) {
    throw new Error(
      `Composition source media probe returned no stream list for ${sourceVideoPath}.`,
    );
  }

  const streamRecords =
    streams.filter(
      isRecord,
    );

  const videoStreams =
    streamRecords.filter(
      (stream) =>
        stream.codec_type ===
        "video",
    );

  if (
    videoStreams.length !==
      1
  ) {
    throw new Error(
      `Composition source media probe requires exactly one video stream for ${sourceVideoPath}; received ${videoStreams.length}.`,
    );
  }

  const videoStream =
    videoStreams[0];

  if (!videoStream) {
    throw new Error(
      `Composition source media probe could not resolve the video stream for ${sourceVideoPath}.`,
    );
  }

  const audioStreams =
    streamRecords.filter(
      (stream) =>
        stream.codec_type ===
        "audio",
    );

  if (
    nativeAudio &&
    audioStreams.length !==
      1
  ) {
    throw new Error(
      `Composition source media requires native audio but expected exactly one audio stream for ${sourceVideoPath}; received ${audioStreams.length}.`,
    );
  }

  let audio:
    CompositionSourceAudioMetadata | null =
      null;

  if (
    nativeAudio &&
    audioStreams.length ===
      1
  ) {
    const audioStream =
      audioStreams[0];

    if (!audioStream) {
      throw new Error(
        `Composition source media probe could not resolve the audio stream for ${sourceVideoPath}.`,
      );
    }

    audio =
      parseAudioStream(
        audioStream,
      );
  }

  const format =
    parsed.format;

  if (
    !isRecord(
      format,
    )
  ) {
    throw new Error(
      `Composition source media probe returned no format metadata for ${sourceVideoPath}.`,
    );
  }

  return Object.freeze({
    sourceVideoPath,

    formatName:
      requireNonEmptyString(
        format.format_name,
        "format name",
      ),

    durationSeconds:
      requirePositiveNumber(
        format.duration,
        "media duration",
      ),

    video:
      parseVideoStream(
        videoStream,
      ),

    audio,
  });
}

export async function probeCompositionSourceMedia(
  input:
    CompositionSourceMediaProbeInput,

  dependencies:
    ProbeCompositionSourceMediaDependencies =
      defaultDependencies,
): Promise<CompositionSourceMediaMetadata> {
  const ffprobeExecutable =
    requireNonEmptyString(
      input.ffprobeExecutable,
      "ffprobe executable",
    );

  const sourceVideoPath =
    requireNonEmptyString(
      input.sourceVideoPath,
      "source video path",
    );

  let result:
    CompositionSourceMediaProbeRunnerResult;

  try {
    result =
      await dependencies
        .runProbe(
          ffprobeExecutable,
          [
            "-v",
            "error",
            "-show_entries",
            "format=format_name,duration,size:stream=index,codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,sample_rate,channels,channel_layout,duration",
            "-of",
            "json",
            sourceVideoPath,
          ],
        );
  } catch (error) {
    throw new Error(
      `Composition source media ffprobe failed for ${sourceVideoPath}.`,
      {
        cause:
          error,
      },
    );
  }

  const stdout =
    result.stdout.trim();

  if (
    stdout.length ===
      0
  ) {
    throw new Error(
      `Composition source media ffprobe returned no JSON for ${sourceVideoPath}.`,
    );
  }

  return parseProbeJson(
    stdout,
    sourceVideoPath,
    input.nativeAudio,
  );
}
