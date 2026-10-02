import {
  lstat,
} from "node:fs/promises";

import {
  isDeepStrictEqual,
} from "node:util";

import {
  CompositionShotNormalizationCacheRecordSchema,
  type CompositionShotNormalizationCacheRecord,
} from "./compositionShotNormalizationCacheRecord.schema.js";

import {
  inspectCompositionNormalizationFile,
} from "./inspectCompositionNormalizationFile.js";

import {
  COMPOSITION_NORMALIZATION_MAX_OUTPUT_BYTES,
  type MaterializedCompositionShotNormalization,
} from "./materializeCompositionShotNormalization.js";

import {
  materializeDialogueCompositionShotNormalization,
  type MaterializeDialogueCompositionShotNormalizationInput,
} from "./materializeDialogueCompositionShotNormalization.js";

import {
  probeCompositionSourceMedia,
} from "./probeCompositionSourceMedia.js";

import {
  readCompositionShotNormalizationCacheRecord,
} from "./readCompositionShotNormalizationCacheRecord.js";

import {
  verifyDialogueCompositionShotNormalizationOutput,
} from "./verifyDialogueCompositionShotNormalizationOutput.js";

import {
  writeCompositionShotNormalizationCacheRecord,
} from "./writeCompositionShotNormalizationCacheRecord.js";

export type DialogueCompositionShotNormalizationCacheStatus =
  | "HIT"
  | "MATERIALIZED";

export type EnsuredDialogueCompositionShotNormalizationCache =
  Readonly<{
    cacheStatus:
      DialogueCompositionShotNormalizationCacheStatus;

    artifact:
      MaterializedCompositionShotNormalization;
  }>;

export type DialogueCompositionShotNormalizationCacheRecordReader =
  (
    outputPath:
      string,
  ) =>
    Promise<
      CompositionShotNormalizationCacheRecord |
      null
    >;

export type DialogueCompositionShotNormalizationCacheArtifactExists =
  (
    outputPath:
      string,
  ) =>
    Promise<boolean>;

export type DialogueCompositionShotNormalizationMaterializer =
  (
    input:
      MaterializeDialogueCompositionShotNormalizationInput,
  ) =>
    Promise<
      MaterializedCompositionShotNormalization
    >;

export type DialogueCompositionShotNormalizationCacheRecordWriter =
  (
    record:
      CompositionShotNormalizationCacheRecord,
  ) =>
    Promise<string>;

export type DialogueCompositionShotNormalizationCacheFileInspector =
  typeof inspectCompositionNormalizationFile;

export type DialogueCompositionShotNormalizationCacheOutputProbe =
  typeof probeCompositionSourceMedia;

export type DialogueCompositionShotNormalizationCacheClock =
  () => Date;

export type EnsureDialogueCompositionShotNormalizationCacheDependencies =
  Readonly<{
    readRecord:
      DialogueCompositionShotNormalizationCacheRecordReader;

    artifactExists:
      DialogueCompositionShotNormalizationCacheArtifactExists;

    materialize:
      DialogueCompositionShotNormalizationMaterializer;

    writeRecord:
      DialogueCompositionShotNormalizationCacheRecordWriter;

    inspectFile:
      DialogueCompositionShotNormalizationCacheFileInspector;

    probeOutput:
      DialogueCompositionShotNormalizationCacheOutputProbe;

    now:
      DialogueCompositionShotNormalizationCacheClock;
  }>;

async function defaultArtifactExists(
  outputPath:
    string,
): Promise<boolean> {
  try {
    await lstat(
      outputPath,
    );

    return true;
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
      return false;
    }

    throw error;
  }
}

const defaultDependencies:
  EnsureDialogueCompositionShotNormalizationCacheDependencies =
  Object.freeze({
    readRecord:
      readCompositionShotNormalizationCacheRecord,

    artifactExists:
      defaultArtifactExists,

    materialize:
      materializeDialogueCompositionShotNormalization,

    writeRecord:
      writeCompositionShotNormalizationCacheRecord,

    inspectFile:
      inspectCompositionNormalizationFile,

    probeOutput:
      probeCompositionSourceMedia,

    now:
      () =>
        new Date(),
  });

export async function ensureDialogueCompositionShotNormalizationCache(
  input:
    MaterializeDialogueCompositionShotNormalizationInput,

  dependencies:
    EnsureDialogueCompositionShotNormalizationCacheDependencies =
      defaultDependencies,
): Promise<EnsuredDialogueCompositionShotNormalizationCache> {
  const record =
    await dependencies
      .readRecord(
        input.plan.outputPath,
      );

  const outputExists =
    await dependencies
      .artifactExists(
        input.plan.outputPath,
      );

  if (
    record !==
      null &&
    outputExists
  ) {
    if (
      record.schemaVersion !==
      "2.0"
    ) {
      throw new Error(
        `Dialogue composition normalization cache record plan does not match the requested normalization plan for ${input.plan.episodeId}/${input.plan.shotId}.`,
      );
    }

    if (
      !isDeepStrictEqual(
        record.plan,
        input.plan,
      )
    ) {
      throw new Error(
        `Dialogue composition normalization cache record plan does not match the requested normalization plan for ${input.plan.episodeId}/${input.plan.shotId}.`,
      );
    }

    const inspected =
      await dependencies
        .inspectFile(
          input.plan.outputPath,
          COMPOSITION_NORMALIZATION_MAX_OUTPUT_BYTES,
        );

    if (
      inspected.bytes !==
        record.artifact.bytes ||
      inspected.sha256 !==
        record.artifact.sha256
    ) {
      throw new Error(
        `Dialogue composition normalization cached artifact integrity does not match its durable record for ${input.plan.episodeId}/${input.plan.shotId}.`,
      );
    }

    const outputMedia =
      await dependencies
        .probeOutput({
          ffprobeExecutable:
            input.ffprobeExecutable,

          sourceVideoPath:
            input.plan.outputPath,

          /*
           * Every normalized dialogue-v2 artifact
           * must contain its final AAC audio stream,
           * irrespective of whether the provider
           * source originally contained native audio.
           */
          nativeAudio:
            true,
        });

    const verified =
      verifyDialogueCompositionShotNormalizationOutput({
        plan:
          input.plan,

        outputMedia,
      });

    if (
      verified.outputPath !==
        record.artifact.outputPath ||
      verified.durationSeconds !==
        record.artifact.durationSeconds ||
      verified.durationToleranceSeconds !==
        record.artifact.durationToleranceSeconds
    ) {
      throw new Error(
        `Dialogue composition normalization cached artifact media verification does not match its durable record for ${input.plan.episodeId}/${input.plan.shotId}.`,
      );
    }

    return Object.freeze({
      cacheStatus:
        "HIT" as const,

      artifact:
        record.artifact,
    });
  }

  if (
    record ===
      null &&
    outputExists
  ) {
    throw new Error(
      "Dialogue composition normalization cache is orphaned: normalized artifact exists without a durable cache record.",
    );
  }

  if (
    record !==
      null &&
    !outputExists
  ) {
    throw new Error(
      "Dialogue composition normalization cache is incomplete: durable cache record exists without its normalized artifact.",
    );
  }

  const materialized =
    await dependencies
      .materialize(
        input,
      );

  /*
   * Parse through the shared schema instead of
   * manually casting the readonly runtime plan
   * into the Zod-inferred durable snapshot type.
   * This also validates the exact persistence
   * envelope before the writer sees it.
   */
  const cacheRecord =
    CompositionShotNormalizationCacheRecordSchema
      .parse({
        schemaVersion:
          "2.0",

        recordedAt:
          dependencies
            .now()
            .toISOString(),

        status:
          "NORMALIZED",

        plan:
          input.plan,

        artifact:
          materialized,
      });

  await dependencies
    .writeRecord(
      cacheRecord,
    );

  return Object.freeze({
    cacheStatus:
      "MATERIALIZED" as const,

    artifact:
      materialized,
  });
}
