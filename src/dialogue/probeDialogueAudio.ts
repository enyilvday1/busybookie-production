import {
  execFile,
} from "node:child_process";

export type DialogueAudioProbeInput =
  Readonly<{
    ffprobeExecutable:
      string;

    sourceAudioPath:
      string;
  }>;

export type DialogueAudioProbeRunnerResult =
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

export type DialogueAudioProbeRunner =
  (
    executable:
      string,

    args:
      readonly string[],
  ) =>
    Promise<
      DialogueAudioProbeRunnerResult
    >;

export type DialogueAudioStreamMetadata =
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

export type DialogueAudioMetadata =
  Readonly<{
    sourceAudioPath:
      string;

    formatName:
      string;

    durationSeconds:
      number;

    audio:
      DialogueAudioStreamMetadata;
  }>;

export type ProbeDialogueAudioDependencies =
  Readonly<{
    runProbe:
      DialogueAudioProbeRunner;
  }>;

type UnknownRecord =
  Record<
    string,
    unknown
  >;

const defaultRunProbe:
  DialogueAudioProbeRunner =
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
  ProbeDialogueAudioDependencies =
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
      `Dialogue audio probe requires ${label}.`,
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
      `Dialogue audio probe requires positive ${label}.`,
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
      `Dialogue audio probe requires integer ${label}.`,
    );
  }

  return parsed;
}

function parseAudioStream(
  stream:
    UnknownRecord,
): DialogueAudioStreamMetadata {
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

  sourceAudioPath:
    string,
): DialogueAudioMetadata {
  let parsed:
    unknown;

  try {
    parsed =
      JSON.parse(
        stdout,
      );
  } catch (error) {
    throw new Error(
      `Dialogue audio probe returned invalid JSON for ${sourceAudioPath}.`,
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
      `Dialogue audio probe returned an invalid document for ${sourceAudioPath}.`,
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
      `Dialogue audio probe returned no stream list for ${sourceAudioPath}.`,
    );
  }

  const streamRecords =
    streams.filter(
      isRecord,
    );

  const audioStreams =
    streamRecords.filter(
      (stream) =>
        stream.codec_type ===
        "audio",
    );

  if (
    audioStreams.length !==
    1
  ) {
    throw new Error(
      `Dialogue audio probe requires exactly one audio stream for ${sourceAudioPath}; received ${audioStreams.length}.`,
    );
  }

  const videoStreams =
    streamRecords.filter(
      (stream) =>
        stream.codec_type ===
        "video",
    );

  if (
    videoStreams.length >
    0
  ) {
    throw new Error(
      `Dialogue audio probe requires audio-only media for ${sourceAudioPath}; received ${videoStreams.length} video stream(s).`,
    );
  }

  const nonAudioStreams =
    streamRecords.filter(
      (stream) =>
        stream.codec_type !==
        "audio",
    );

  if (
    nonAudioStreams.length >
    0
  ) {
    throw new Error(
      `Dialogue audio probe requires audio-only media for ${sourceAudioPath}; received ${nonAudioStreams.length} non-audio stream(s).`,
    );
  }

  const audioStream =
    audioStreams[0];

  if (!audioStream) {
    throw new Error(
      `Dialogue audio probe could not resolve the audio stream for ${sourceAudioPath}.`,
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
      `Dialogue audio probe returned no format metadata for ${sourceAudioPath}.`,
    );
  }

  return Object.freeze({
    sourceAudioPath,

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

    audio:
      parseAudioStream(
        audioStream,
      ),
  });
}

export async function probeDialogueAudio(
  input:
    DialogueAudioProbeInput,

  dependencies:
    ProbeDialogueAudioDependencies =
      defaultDependencies,
): Promise<
  DialogueAudioMetadata
> {
  const ffprobeExecutable =
    requireNonEmptyString(
      input.ffprobeExecutable,
      "ffprobe executable",
    );

  const sourceAudioPath =
    requireNonEmptyString(
      input.sourceAudioPath,
      "source audio path",
    );

  let result:
    DialogueAudioProbeRunnerResult;

  try {
    result =
      await dependencies
        .runProbe(
          ffprobeExecutable,
          [
            "-v",
            "error",
            "-show_entries",
            "format=format_name,duration,size:stream=index,codec_type,codec_name,profile,sample_rate,channels,channel_layout,duration",
            "-of",
            "json",
            sourceAudioPath,
          ],
        );
  } catch (error) {
    throw new Error(
      `Dialogue audio ffprobe failed for ${sourceAudioPath}.`,
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
      `Dialogue audio ffprobe returned no JSON for ${sourceAudioPath}.`,
    );
  }

  return parseProbeJson(
    stdout,
    sourceAudioPath,
  );
}
