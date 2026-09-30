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
  buildCompositionShotNormalizationFfmpegCommand,
} from "./buildCompositionShotNormalizationFfmpegCommand.js";

import {
  inspectCompositionNormalizationFile,
} from "./inspectCompositionNormalizationFile.js";

import type {
  CompositionShotNormalizationPlan,
} from "./buildCompositionShotNormalizationPlan.js";

import {
  probeCompositionSourceMedia,
} from "./probeCompositionSourceMedia.js";

import type {
  CompositionSourceMediaMetadata,
  CompositionSourceMediaProbeInput,
} from "./probeCompositionSourceMedia.js";

import {
  verifyCompositionShotNormalizationOutput,
} from "./verifyCompositionShotNormalizationOutput.js";

export const COMPOSITION_NORMALIZATION_MAX_OUTPUT_BYTES =
  500_000_000;

export const COMPOSITION_NORMALIZATION_MAX_SOURCE_BYTES =
  500_000_000;

export type CompositionNormalizationFfmpegRunnerResult =
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

export type CompositionNormalizationFfmpegRunner =
  (
    executable:
      string,

    args:
      readonly string[],
  ) =>
    Promise<
      CompositionNormalizationFfmpegRunnerResult
    >;

export type CompositionNormalizationOutputProbe =
  (
    input:
      CompositionSourceMediaProbeInput,
  ) =>
    Promise<
      CompositionSourceMediaMetadata
    >;

export type CompositionNormalizationTemporaryFileRemover =
  (
    filePath:
      string,
  ) =>
    Promise<void>;

export type MaterializeCompositionShotNormalizationInput =
  Readonly<{
    ffmpegExecutable:
      string;

    ffprobeExecutable:
      string;

    plan:
      CompositionShotNormalizationPlan;
  }>;

export type MaterializeCompositionShotNormalizationDependencies =
  Readonly<{
    runFfmpeg:
      CompositionNormalizationFfmpegRunner;

    probeOutput:
      CompositionNormalizationOutputProbe;

    removeTemporaryFile?:
      CompositionNormalizationTemporaryFileRemover;
  }>;

export type MaterializedCompositionShotNormalization =
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

export class CompositionNormalizationOutputAlreadyExistsError
  extends Error {
  readonly destinationPath:
    string;

  constructor(
    destinationPath:
      string,
  ) {
    super(
      `Composition normalization output already exists: ${destinationPath}`,
    );

    this.name =
      "CompositionNormalizationOutputAlreadyExistsError";

    this.destinationPath =
      destinationPath;
  }
}

const defaultRunFfmpeg:
  CompositionNormalizationFfmpegRunner =
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

const defaultProbeOutput:
  CompositionNormalizationOutputProbe =
  async (
    input,
  ) =>
    probeCompositionSourceMedia(
      input,
    );

const defaultRemoveTemporaryFile:
  CompositionNormalizationTemporaryFileRemover =
  async (
    filePath,
  ) =>
    unlink(
      filePath,
    );

const defaultDependencies:
  MaterializeCompositionShotNormalizationDependencies =
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

  throw new CompositionNormalizationOutputAlreadyExistsError(
    destinationPath,
  );
}

export async function materializeCompositionShotNormalization(
  input:
    MaterializeCompositionShotNormalizationInput,

  dependencies:
    MaterializeCompositionShotNormalizationDependencies =
      defaultDependencies,
): Promise<MaterializedCompositionShotNormalization> {
  const destinationPath =
    input.plan.outputPath;

  const removeTemporaryFile =
    dependencies.removeTemporaryFile ??
    defaultRemoveTemporaryFile;

  await assertDestinationAbsent(
    destinationPath,
  );

  const expectedSourceSha256 =
    input.plan.sourceSha256
      .trim()
      .toLowerCase();

  if (
    !/^[a-f0-9]{64}$/u.test(
      expectedSourceSha256,
    )
  ) {
    throw new Error(
      "Composition normalization source SHA-256 is invalid for " +
        input.plan.episodeId +
        "/" +
        input.plan.shotId +
        ".",
    );
  }

  let sourceInspected:
    Readonly<{
      bytes:
        number;

      sha256:
        string;
    }>;

  try {
    sourceInspected =
      await inspectCompositionNormalizationFile(
        input.plan.sourceVideoPath,
        COMPOSITION_NORMALIZATION_MAX_SOURCE_BYTES,
      );
  } catch (
    error
  ) {
    throw new Error(
      "Composition normalization source integrity inspection failed for " +
        input.plan.episodeId +
        "/" +
        input.plan.shotId +
        ".",
      {
        cause:
          error,
      },
    );
  }

  if (
    sourceInspected.sha256 !==
    expectedSourceSha256
  ) {
    throw new Error(
      "Composition normalization source SHA-256 does not match the normalization plan for " +
        input.plan.episodeId +
        "/" +
        input.plan.shotId +
        ".",
    );
  }

  await mkdir(
    dirname(
      destinationPath,
    ),
    {
      recursive:
        true,
    },
  );

  const temporaryPath =
    `${destinationPath}.part-${process.pid}-${randomUUID()}`;

  const command =
    buildCompositionShotNormalizationFfmpegCommand({
      ffmpegExecutable:
        input.ffmpegExecutable,

      plan:
        input.plan,

      outputPath:
        temporaryPath,
    });

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
        `Composition normalization FFmpeg failed for ${input.plan.episodeId}/${input.plan.shotId}.`,
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
           * Every normalized Busybookie master
           * contains audio. Native source audio is
           * either preserved or synthetic stereo
           * silence is generated by FFmpeg.
           */
          nativeAudio:
            true,
        });

    const verified =
      verifyCompositionShotNormalizationOutput({
        plan:
          input.plan,

        outputMedia,
      });

    const inspected =
      await inspectCompositionNormalizationFile(
        temporaryPath,
        COMPOSITION_NORMALIZATION_MAX_OUTPUT_BYTES,
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
        throw new CompositionNormalizationOutputAlreadyExistsError(
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
          "Composition normalization temporary cleanup failed after successful promotion for " +
            input.plan.episodeId +
            "/" +
            input.plan.shotId +
            ".",
          {
            cause:
              error,
          },
        );
      }

      /*
       * If the primary operation already failed,
       * preserve that primary failure rather than
       * masking it with a secondary cleanup error.
       */
    }
  }
}
