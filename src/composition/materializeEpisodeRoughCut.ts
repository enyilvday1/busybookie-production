import {
  execFile,
} from "node:child_process";

import {
  randomUUID,
} from "node:crypto";

import {
  constants,
} from "node:fs";

import {
  copyFile,
  lstat,
  mkdir,
  unlink,
} from "node:fs/promises";

import {
  dirname,
} from "node:path";

import {
  buildEpisodeRoughCutFfmpegCommand,
} from "./buildEpisodeRoughCutFfmpegCommand.js";

import type {
  EpisodeRoughCutRenderPlan,
} from "./buildEpisodeRoughCutRenderPlan.js";

import {
  inspectCompositionNormalizationFile,
} from "./inspectCompositionNormalizationFile.js";

import {
  probeCompositionSourceMedia,
} from "./probeCompositionSourceMedia.js";

import type {
  CompositionSourceMediaMetadata,
  CompositionSourceMediaProbeInput,
} from "./probeCompositionSourceMedia.js";

import {
  verifyEpisodeRoughCutOutput,
} from "./verifyEpisodeRoughCutOutput.js";

export const EPISODE_ROUGH_CUT_MAX_SOURCE_BYTES =
  500_000_000;

export const EPISODE_ROUGH_CUT_MAX_OUTPUT_BYTES =
  5_000_000_000;

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/u;

export type EpisodeRoughCutFfmpegRunnerResult =
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

export type EpisodeRoughCutFfmpegRunner =
  (
    executable:
      string,

    args:
      readonly string[],
  ) =>
    Promise<
      EpisodeRoughCutFfmpegRunnerResult
    >;

export type EpisodeRoughCutOutputProbe =
  (
    input:
      CompositionSourceMediaProbeInput,
  ) =>
    Promise<
      CompositionSourceMediaMetadata
    >;

export type EpisodeRoughCutTemporaryFileRemover =
  (
    filePath:
      string,
  ) =>
    Promise<void>;

export type MaterializeEpisodeRoughCutInput =
  Readonly<{
    ffmpegExecutable:
      string;

    ffprobeExecutable:
      string;

    plan:
      EpisodeRoughCutRenderPlan;
  }>;

export type MaterializeEpisodeRoughCutDependencies =
  Readonly<{
    runFfmpeg:
      EpisodeRoughCutFfmpegRunner;

    probeOutput:
      EpisodeRoughCutOutputProbe;

    removeTemporaryFile?:
      EpisodeRoughCutTemporaryFileRemover;
  }>;

export type MaterializedEpisodeRoughCut =
  Readonly<{
    outputPath:
      string;

    bytes:
      number;

    sha256:
      string;

    contentType:
      "video/mp4";

    durationSeconds:
      number;

    durationToleranceSeconds:
      number;
  }>;

export class EpisodeRoughCutOutputAlreadyExistsError
  extends Error {
  readonly destinationPath:
    string;

  constructor(
    destinationPath:
      string,
  ) {
    super(
      `Episode rough-cut output already exists: ${destinationPath}`,
    );

    this.name =
      "EpisodeRoughCutOutputAlreadyExistsError";

    this.destinationPath =
      destinationPath;
  }
}

const defaultRunFfmpeg:
  EpisodeRoughCutFfmpegRunner =
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
                30 * 60 * 1000,

              maxBuffer:
                4 * 1024 * 1024,
            },
            (
              error,
              stdout,
              stderr,
            ) => {
              if (
                error
              ) {
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

const defaultProbeOutput:
  EpisodeRoughCutOutputProbe =
    async (
      input,
    ) =>
      probeCompositionSourceMedia(
        input,
      );

const defaultRemoveTemporaryFile:
  EpisodeRoughCutTemporaryFileRemover =
    async (
      filePath,
    ) => {
      await unlink(
        filePath,
      );
    };

const defaultDependencies:
  MaterializeEpisodeRoughCutDependencies =
    Object.freeze({
      runFfmpeg:
        defaultRunFfmpeg,

      probeOutput:
        defaultProbeOutput,

      removeTemporaryFile:
        defaultRemoveTemporaryFile,
    });

async function assertDestinationAbsent(
  destinationPath:
    string,
): Promise<void> {
  try {
    await lstat(
      destinationPath,
    );
  } catch (
    error
  ) {
    if (
      (
        error as
          NodeJS.ErrnoException
      ).code ===
      "ENOENT"
    ) {
      return;
    }

    throw error;
  }

  throw new EpisodeRoughCutOutputAlreadyExistsError(
    destinationPath,
  );
}

async function verifyPlannedSources(
  plan:
    EpisodeRoughCutRenderPlan,
): Promise<void> {
  for (
    const shot
    of plan.shots
  ) {
    const expectedSha256 =
      shot.sourceSha256
        .trim()
        .toLowerCase();

    if (
      !SHA256_PATTERN.test(
        expectedSha256,
      )
    ) {
      throw new Error(
        `Episode rough-cut source SHA-256 is invalid for ${plan.episodeId}/${shot.shotId}.`,
      );
    }

    if (
      !Number.isSafeInteger(
        shot.sourceBytes,
      ) ||
      shot.sourceBytes <=
        0
    ) {
      throw new Error(
        `Episode rough-cut source byte count is invalid for ${plan.episodeId}/${shot.shotId}.`,
      );
    }

    let inspected:
      Readonly<{
        bytes:
          number;

        sha256:
          string;
      }>;

    try {
      inspected =
        await inspectCompositionNormalizationFile(
          shot.sourceVideoPath,
          EPISODE_ROUGH_CUT_MAX_SOURCE_BYTES,
        );
    } catch (
      error
    ) {
      throw new Error(
        `Episode rough-cut source integrity inspection failed for ${plan.episodeId}/${shot.shotId}.`,
        {
          cause:
            error,
        },
      );
    }

    /*
     * Check SHA first deliberately. Any mutation to a
     * normalized source must be reported as an integrity
     * mismatch even when the mutation also changed length.
     */
    if (
      inspected.sha256 !==
      expectedSha256
    ) {
      throw new Error(
        `Episode rough-cut source SHA-256 does not match the render plan for ${plan.episodeId}/${shot.shotId}.`,
      );
    }

    if (
      inspected.bytes !==
      shot.sourceBytes
    ) {
      throw new Error(
        `Episode rough-cut source byte count does not match the render plan for ${plan.episodeId}/${shot.shotId}.`,
      );
    }
  }
}

export async function materializeEpisodeRoughCut(
  input:
    MaterializeEpisodeRoughCutInput,

  dependencies:
    MaterializeEpisodeRoughCutDependencies =
      defaultDependencies,
): Promise<MaterializedEpisodeRoughCut> {
  const destinationPath =
    input.plan.outputPath
      .trim();

  /*
   * Constructing the command before touching the destination
   * validates the render plan and all path/profile invariants.
   * The temporary path remains in the destination directory so
   * promotion never crosses filesystems.
   */
  const temporaryPath =
    `${destinationPath}.part-${process.pid}-${randomUUID()}`;

  const command =
    buildEpisodeRoughCutFfmpegCommand({
      ffmpegExecutable:
        input.ffmpegExecutable,

      plan:
        input.plan,

      outputPath:
        temporaryPath,
    });

  await assertDestinationAbsent(
    destinationPath,
  );

  /*
   * The render plan is cryptographically bound to every
   * normalized shot. Verify those exact bytes before FFmpeg
   * is allowed to consume them.
   */
  await verifyPlannedSources(
    input.plan,
  );

  await mkdir(
    dirname(
      destinationPath,
    ),
    {
      recursive:
        true,
    },
  );

  const removeTemporaryFile =
    dependencies
      .removeTemporaryFile ??
    defaultRemoveTemporaryFile;

  let operationSucceeded =
    false;

  try {
    try {
      await dependencies
        .runFfmpeg(
          command.executable,
          command.args,
        );
    } catch (
      error
    ) {
      throw new Error(
        `Episode rough-cut FFmpeg failed for ${input.plan.episodeId}.`,
        {
          cause:
            error,
        },
      );
    }

    const outputMedia =
      await dependencies
        .probeOutput({
          ffprobeExecutable:
            input.ffprobeExecutable,

          sourceVideoPath:
            temporaryPath,

          /*
           * Every normalized source contains audio and the
           * straight-cut master therefore requires an audio
           * stream in the assembled rough cut.
           */
          nativeAudio:
            true,
        });

    const verified =
      verifyEpisodeRoughCutOutput({
        plan:
          input.plan,

        outputMedia,
      });

    const inspected =
      await inspectCompositionNormalizationFile(
        temporaryPath,
        EPISODE_ROUGH_CUT_MAX_OUTPUT_BYTES,
      );

    try {
      await copyFile(
        temporaryPath,
        destinationPath,
        constants.COPYFILE_EXCL,
      );
    } catch (
      error
    ) {
      if (
        (
          error as
            NodeJS.ErrnoException
        ).code ===
        "EEXIST"
      ) {
        throw new EpisodeRoughCutOutputAlreadyExistsError(
          destinationPath,
        );
      }

      throw error;
    }

    const result =
      Object.freeze({
        outputPath:
          destinationPath,

        bytes:
          inspected.bytes,

        sha256:
          inspected.sha256,

        contentType:
          "video/mp4" as const,

        durationSeconds:
          verified.durationSeconds,

        durationToleranceSeconds:
          verified.durationToleranceSeconds,
      });

    operationSucceeded =
      true;

    return result;
  } finally {
    try {
      await removeTemporaryFile(
        temporaryPath,
      );
    } catch (
      error
    ) {
      const code =
        (
          error as
            NodeJS.ErrnoException
        ).code;

      if (
        code !==
          "ENOENT" &&
        operationSucceeded
      ) {
        throw new Error(
          `Episode rough-cut temporary cleanup failed after successful promotion for ${input.plan.episodeId}.`,
          {
            cause:
              error,
          },
        );
      }

      /*
       * If rendering, verification, inspection, or promotion
       * already failed, preserve that primary failure rather
       * than replacing it with a secondary cleanup error.
       */
    }
  }
}
