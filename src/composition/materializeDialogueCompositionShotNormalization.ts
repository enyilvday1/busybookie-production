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
  buildDialogueCompositionShotNormalizationFfmpegCommand,
} from "./buildDialogueCompositionShotNormalizationFfmpegCommand.js";

import type {
  DialogueCompositionShotNormalizationPlan,
} from "./buildDialogueCompositionShotNormalizationPlan.js";

import {
  inspectCompositionNormalizationFile,
} from "./inspectCompositionNormalizationFile.js";

import {
  COMPOSITION_NORMALIZATION_MAX_OUTPUT_BYTES,
  COMPOSITION_NORMALIZATION_MAX_SOURCE_BYTES,
  CompositionNormalizationOutputAlreadyExistsError,
} from "./materializeCompositionShotNormalization.js";

import type {
  CompositionNormalizationFfmpegRunner,
  CompositionNormalizationOutputProbe,
  CompositionNormalizationTemporaryFileRemover,
  MaterializedCompositionShotNormalization,
} from "./materializeCompositionShotNormalization.js";

import {
  probeCompositionSourceMedia,
} from "./probeCompositionSourceMedia.js";

import {
  verifyDialogueCompositionShotNormalizationOutput,
} from "./verifyDialogueCompositionShotNormalizationOutput.js";

export const DIALOGUE_COMPOSITION_NORMALIZATION_MAX_AUDIO_BYTES =
  25_000_000;

export type MaterializeDialogueCompositionShotNormalizationInput =
  Readonly<{
    ffmpegExecutable:
      string;

    ffprobeExecutable:
      string;

    plan:
      DialogueCompositionShotNormalizationPlan;
  }>;

export type MaterializeDialogueCompositionShotNormalizationDependencies =
  Readonly<{
    runFfmpeg:
      CompositionNormalizationFfmpegRunner;

    probeOutput:
      CompositionNormalizationOutputProbe;

    removeTemporaryFile?:
      CompositionNormalizationTemporaryFileRemover;
  }>;

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
  MaterializeDialogueCompositionShotNormalizationDependencies =
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

async function removeTemporaryArtifact(
  filePath:
    string,

  remover:
    CompositionNormalizationTemporaryFileRemover,
): Promise<void> {
  try {
    await remover(
      filePath,
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
}

async function verifySourceVideoIntegrity(
  plan:
    DialogueCompositionShotNormalizationPlan,
): Promise<void> {
  const expectedSourceSha256 =
    plan.sourceSha256
      .trim()
      .toLowerCase();

  if (
    !/^[a-f0-9]{64}$/u.test(
      expectedSourceSha256,
    )
  ) {
    throw new Error(
      "Dialogue composition normalization source SHA-256 is invalid for " +
        plan.episodeId +
        "/" +
        plan.shotId +
        ".",
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
        plan.sourceVideoPath,
        COMPOSITION_NORMALIZATION_MAX_SOURCE_BYTES,
      );
  } catch (
    error
  ) {
    throw new Error(
      "Dialogue composition normalization source integrity inspection failed for " +
        plan.episodeId +
        "/" +
        plan.shotId +
        ".",
      {
        cause:
          error,
      },
    );
  }

  if (
    inspected.sha256 !==
    expectedSourceSha256
  ) {
    throw new Error(
      "Dialogue composition normalization source SHA-256 does not match the normalization plan for " +
        plan.episodeId +
        "/" +
        plan.shotId +
        ".",
    );
  }
}

async function verifyDialogueAudioIntegrity(
  plan:
    DialogueCompositionShotNormalizationPlan,
): Promise<void> {
  for (
    const line
    of plan.audio.lines
  ) {
    if (
      !Number.isSafeInteger(
        line.sourceBytes,
      ) ||
      line.sourceBytes <=
        0
    ) {
      throw new Error(
        `Dialogue composition normalization dialogue audio byte count is invalid for ${line.dialogueLineId}.`,
      );
    }

    const expectedSha256 =
      line.sourceSha256
        .trim()
        .toLowerCase();

    if (
      !/^[a-f0-9]{64}$/u.test(
        expectedSha256,
      )
    ) {
      throw new Error(
        `Dialogue composition normalization dialogue audio SHA-256 is invalid for ${line.dialogueLineId}.`,
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
          line.sourceAudioPath,
          DIALOGUE_COMPOSITION_NORMALIZATION_MAX_AUDIO_BYTES,
        );
    } catch (
      error
    ) {
      throw new Error(
        `Dialogue composition normalization dialogue audio integrity inspection failed for ${line.dialogueLineId}.`,
        {
          cause:
            error,
        },
      );
    }

    if (
      inspected.bytes !==
      line.sourceBytes
    ) {
      throw new Error(
        `Dialogue composition normalization dialogue audio byte count does not match the normalization plan for ${line.dialogueLineId}.`,
      );
    }

    if (
      inspected.sha256 !==
      expectedSha256
    ) {
      throw new Error(
        `Dialogue composition normalization dialogue audio SHA-256 does not match the normalization plan for ${line.dialogueLineId}.`,
      );
    }
  }
}

async function promoteExclusively(
  temporaryPath:
    string,

  destinationPath:
    string,
): Promise<void> {
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
}

export async function materializeDialogueCompositionShotNormalization(
  input:
    MaterializeDialogueCompositionShotNormalizationInput,

  dependencies:
    MaterializeDialogueCompositionShotNormalizationDependencies =
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

  await verifySourceVideoIntegrity(
    input.plan,
  );

  await verifyDialogueAudioIntegrity(
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

  const temporaryPath =
    `${destinationPath}.part-${process.pid}-${randomUUID()}`;

  const command =
    buildDialogueCompositionShotNormalizationFfmpegCommand({
      ffmpegExecutable:
        input.ffmpegExecutable,

      plan:
        input.plan,

      outputPath:
        temporaryPath,
    });

  let promoted =
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
        "Dialogue composition normalization FFmpeg failed for " +
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

    const outputMedia =
      await dependencies
        .probeOutput({
          ffprobeExecutable:
            input.ffprobeExecutable,

          sourceVideoPath:
            temporaryPath,

          nativeAudio:
            true,
        });

    const verified =
      verifyDialogueCompositionShotNormalizationOutput({
        plan:
          input.plan,

        outputMedia,
      });

    const inspected =
      await inspectCompositionNormalizationFile(
        temporaryPath,
        COMPOSITION_NORMALIZATION_MAX_OUTPUT_BYTES,
      );

    await promoteExclusively(
      temporaryPath,
      destinationPath,
    );

    promoted =
      true;

    try {
      await removeTemporaryArtifact(
        temporaryPath,
        removeTemporaryFile,
      );
    } catch (
      error
    ) {
      throw new Error(
        "Dialogue composition normalization temporary cleanup failed after successful promotion for " +
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

    return Object.freeze({
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
  } catch (
    error
  ) {
    if (
      !promoted
    ) {
      try {
        await removeTemporaryArtifact(
          temporaryPath,
          removeTemporaryFile,
        );
      } catch (
        cleanupError
      ) {
        throw new Error(
          "Dialogue composition normalization temporary cleanup failed while handling a materialization failure for " +
            input.plan.episodeId +
            "/" +
            input.plan.shotId +
            ".",
          {
            cause:
              cleanupError,
          },
        );
      }
    }

    throw error;
  }
}
