import {
  lstat,
} from "node:fs/promises";

import {
  isDeepStrictEqual,
} from "node:util";

import type {
  CompositionShotNormalizationCacheRecord,
} from "./compositionShotNormalizationCacheRecord.schema.js";

import {
  inspectCompositionNormalizationFile,
} from "./inspectCompositionNormalizationFile.js";

import {
  COMPOSITION_NORMALIZATION_MAX_OUTPUT_BYTES,
  materializeCompositionShotNormalization,
  type CompositionNormalizationOutputProbe,
  type MaterializeCompositionShotNormalizationInput,
  type MaterializedCompositionShotNormalization,
} from "./materializeCompositionShotNormalization.js";

import {
  probeCompositionSourceMedia,
} from "./probeCompositionSourceMedia.js";

import {
  readCompositionShotNormalizationCacheRecord,
} from "./readCompositionShotNormalizationCacheRecord.js";

import {
  verifyCompositionShotNormalizationOutput,
} from "./verifyCompositionShotNormalizationOutput.js";

import {
  writeCompositionShotNormalizationCacheRecord,
} from "./writeCompositionShotNormalizationCacheRecord.js";

export type CompositionShotNormalizationCacheStatus =
  "HIT" |
  "MATERIALIZED";

export type EnsuredCompositionShotNormalizationCache =
  Readonly<{
    cacheStatus:
      CompositionShotNormalizationCacheStatus;

    artifact:
      MaterializedCompositionShotNormalization;
  }>;

export type CompositionShotNormalizationCacheRecordReader =
  (
    outputPath:
      string,
  ) =>
    Promise<
      CompositionShotNormalizationCacheRecord |
      null
    >;

export type CompositionShotNormalizationCacheArtifactExists =
  (
    outputPath:
      string,
  ) =>
    Promise<boolean>;

export type CompositionShotNormalizationMaterializer =
  (
    input:
      MaterializeCompositionShotNormalizationInput,
  ) =>
    Promise<
      MaterializedCompositionShotNormalization
    >;

export type CompositionShotNormalizationCacheRecordWriter =
  (
    record:
      CompositionShotNormalizationCacheRecord,
  ) =>
    Promise<string>;

export type CompositionShotNormalizationCacheFileInspector =
  typeof inspectCompositionNormalizationFile;

export type CompositionShotNormalizationCacheClock =
  () => Date;

export type EnsureCompositionShotNormalizationCacheDependencies =
  Readonly<{
    readRecord:
      CompositionShotNormalizationCacheRecordReader;

    artifactExists:
      CompositionShotNormalizationCacheArtifactExists;

    materialize:
      CompositionShotNormalizationMaterializer;

    writeRecord:
      CompositionShotNormalizationCacheRecordWriter;

    inspectFile:
      CompositionShotNormalizationCacheFileInspector;

    probeOutput:
      CompositionNormalizationOutputProbe;

    now:
      CompositionShotNormalizationCacheClock;
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
    const code =
      (
        error as
          NodeJS.ErrnoException
      ).code;

    if (
      code ===
      "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}

const defaultDependencies:
  EnsureCompositionShotNormalizationCacheDependencies =
  Object.freeze({
    readRecord:
      readCompositionShotNormalizationCacheRecord,

    artifactExists:
      defaultArtifactExists,

    materialize:
      materializeCompositionShotNormalization,

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

export async function ensureCompositionShotNormalizationCache(
  input:
    MaterializeCompositionShotNormalizationInput,

  dependencies:
    EnsureCompositionShotNormalizationCacheDependencies =
      defaultDependencies,
): Promise<EnsuredCompositionShotNormalizationCache> {
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
      !isDeepStrictEqual(
        record.plan,
        input.plan,
      )
    ) {
      throw new Error(
        `Composition normalization cache record plan does not match the requested normalization plan for ${input.plan.episodeId}/${input.plan.shotId}.`,
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
        `Composition normalization cached artifact integrity does not match its durable record for ${input.plan.episodeId}/${input.plan.shotId}.`,
      );
    }

    const outputMedia =
      await dependencies
        .probeOutput({
          ffprobeExecutable:
            input.ffprobeExecutable,

          sourceVideoPath:
            input.plan.outputPath,

          nativeAudio:
            true,
        });

    const verified =
      verifyCompositionShotNormalizationOutput({
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
        `Composition normalization cached artifact media verification does not match its durable record for ${input.plan.episodeId}/${input.plan.shotId}.`,
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
      "Composition normalization cache is orphaned: normalized artifact exists without a durable cache record.",
    );
  }

  if (
    record !==
      null &&
    !outputExists
  ) {
    throw new Error(
      "Composition normalization cache is incomplete: durable cache record exists without its normalized artifact.",
    );
  }

  const materialized =
    await dependencies
      .materialize(
        input,
      );

  const cacheRecord:
    CompositionShotNormalizationCacheRecord =
    {
      schemaVersion:
        "1.0",

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
    };

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
