import {
  execFile,
} from "node:child_process";

export type CompositionMediaToolchainSource =
  Readonly<{
    BUSYBOOKIE_FFMPEG_PATH?:
      string;

    BUSYBOOKIE_FFPROBE_PATH?:
      string;
  }>;

export type CompositionMediaToolchainProbeResult =
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

export type CompositionMediaToolchainProbe =
  (
    executable:
      string,

    args:
      readonly string[],
  ) =>
    Promise<
      CompositionMediaToolchainProbeResult
    >;

export type CompositionMediaToolchain =
  Readonly<{
    ffmpegExecutable:
      string;

    ffprobeExecutable:
      string;

    ffmpegVersionOutput:
      string;

    ffprobeVersionOutput:
      string;
  }>;

export type ValidateCompositionMediaToolchainDependencies =
  Readonly<{
    probe:
      CompositionMediaToolchainProbe;
  }>;

const defaultProbe:
  CompositionMediaToolchainProbe =
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
              5_000,

            maxBuffer:
              1024 * 1024,
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
  ValidateCompositionMediaToolchainDependencies =
  Object.freeze({
    probe:
      defaultProbe,
  });

function resolveExecutable(
  configured:
    string | undefined,

  fallback:
    string,
): string {
  const trimmed =
    configured?.trim();

  return trimmed
    ? trimmed
    : fallback;
}

function requireExpectedVersionIdentity(
  label:
    "ffmpeg" | "ffprobe",

  versionOutput:
    string,
): void {
  const firstNonEmptyLine =
    versionOutput
      .split(
        /\r?\n/u,
      )
      .map(
        (line) =>
          line.trim(),
      )
      .find(
        (line) =>
          line.length >
          0,
      );

  const expectedPrefix =
    `${label} version`;

  if (
    !firstNonEmptyLine ||
    !firstNonEmptyLine
      .toLowerCase()
      .startsWith(
        expectedPrefix,
      )
  ) {
    throw new Error(
      `${label} version probe identity mismatch: expected output beginning with "${expectedPrefix}".`,
    );
  }
}

async function probeVersion(
  label:
    "ffmpeg" | "ffprobe",

  executable:
    string,

  probe:
    CompositionMediaToolchainProbe,
): Promise<string> {
  let result:
    CompositionMediaToolchainProbeResult;

  try {
    result =
      await probe(
        executable,
        [
          "-version",
        ],
      );
  } catch (error) {
    throw new Error(
      `${label} is unavailable or failed its version probe: ${executable}`,
      {
        cause:
          error,
      },
    );
  }

  const versionOutput =
    result.stdout.trim() ||
    result.stderr.trim();

  if (!versionOutput) {
    throw new Error(
      `${label} version probe returned no output.`,
    );
  }

  requireExpectedVersionIdentity(
    label,
    versionOutput,
  );

  return versionOutput;
}

export async function validateCompositionMediaToolchain(
  source:
    CompositionMediaToolchainSource,

  dependencies:
    ValidateCompositionMediaToolchainDependencies =
      defaultDependencies,
): Promise<CompositionMediaToolchain> {
  const ffmpegExecutable =
    resolveExecutable(
      source.BUSYBOOKIE_FFMPEG_PATH,
      "ffmpeg",
    );

  const ffprobeExecutable =
    resolveExecutable(
      source.BUSYBOOKIE_FFPROBE_PATH,
      "ffprobe",
    );

  const ffmpegVersionOutput =
    await probeVersion(
      "ffmpeg",
      ffmpegExecutable,
      dependencies.probe,
    );

  const ffprobeVersionOutput =
    await probeVersion(
      "ffprobe",
      ffprobeExecutable,
      dependencies.probe,
    );

  return Object.freeze({
    ffmpegExecutable,

    ffprobeExecutable,

    ffmpegVersionOutput,

    ffprobeVersionOutput,
  });
}
