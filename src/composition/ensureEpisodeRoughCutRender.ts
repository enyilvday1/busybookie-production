import {
  lstat,
} from "node:fs/promises";

import {
  isDeepStrictEqual,
} from "node:util";

import type {
  EpisodeRoughCutRenderPlan,
} from "./buildEpisodeRoughCutRenderPlan.js";

import type {
  EpisodeRoughCutRenderRecord,
} from "./episodeRoughCutRenderRecord.schema.js";

import {
  inspectCompositionNormalizationFile,
} from "./inspectCompositionNormalizationFile.js";

import {
  EPISODE_ROUGH_CUT_MAX_OUTPUT_BYTES,
  materializeEpisodeRoughCut,
  type EpisodeRoughCutOutputProbe,
  type MaterializeEpisodeRoughCutInput,
  type MaterializedEpisodeRoughCut,
} from "./materializeEpisodeRoughCut.js";

import {
  probeCompositionSourceMedia,
} from "./probeCompositionSourceMedia.js";

import {
  readEpisodeRoughCutRenderRecord,
} from "./readEpisodeRoughCutRenderRecord.js";

import {
  verifyEpisodeRoughCutOutput,
} from "./verifyEpisodeRoughCutOutput.js";

import {
  writeEpisodeRoughCutRenderRecord,
} from "./writeEpisodeRoughCutRenderRecord.js";

export type EpisodeRoughCutRenderStatus =
  "HIT" |
  "MATERIALIZED";

export type EnsuredEpisodeRoughCutRender =
  Readonly<{
    renderStatus:
      EpisodeRoughCutRenderStatus;

    artifact:
      MaterializedEpisodeRoughCut;
  }>;

export type EpisodeRoughCutRenderRecordReader =
  (
    outputPath:
      string,
  ) =>
    Promise<
      EpisodeRoughCutRenderRecord |
      null
    >;

export type EpisodeRoughCutArtifactExists =
  (
    outputPath:
      string,
  ) =>
    Promise<boolean>;

export type EpisodeRoughCutMaterializer =
  (
    input:
      MaterializeEpisodeRoughCutInput,
  ) =>
    Promise<
      MaterializedEpisodeRoughCut
    >;

export type EpisodeRoughCutRenderRecordWriter =
  (
    record:
      EpisodeRoughCutRenderRecord,
  ) =>
    Promise<string>;

export type EpisodeRoughCutFileInspector =
  typeof inspectCompositionNormalizationFile;

export type EpisodeRoughCutRenderClock =
  () => Date;

export type EnsureEpisodeRoughCutRenderDependencies =
  Readonly<{
    readRecord:
      EpisodeRoughCutRenderRecordReader;

    artifactExists:
      EpisodeRoughCutArtifactExists;

    materialize:
      EpisodeRoughCutMaterializer;

    writeRecord:
      EpisodeRoughCutRenderRecordWriter;

    inspectFile:
      EpisodeRoughCutFileInspector;

    probeOutput:
      EpisodeRoughCutOutputProbe;

    now:
      EpisodeRoughCutRenderClock;
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
  EnsureEpisodeRoughCutRenderDependencies =
    Object.freeze({
      readRecord:
        readEpisodeRoughCutRenderRecord,

      artifactExists:
        defaultArtifactExists,

      materialize:
        materializeEpisodeRoughCut,

      writeRecord:
        writeEpisodeRoughCutRenderRecord,

      inspectFile:
        inspectCompositionNormalizationFile,

      probeOutput:
        probeCompositionSourceMedia,

      now:
        () =>
          new Date(),
    });

function createDurablePlanSnapshot(
  plan:
    EpisodeRoughCutRenderPlan,
): EpisodeRoughCutRenderRecord["plan"] {
  return {
    schemaVersion:
      plan.schemaVersion,

    profileId:
      plan.profileId,

    assemblyMode:
      plan.assemblyMode,

    episodeId:
      plan.episodeId,

    title:
      plan.title,

    totalShots:
      plan.totalShots,

    totalDurationSeconds:
      plan.totalDurationSeconds,

    container:
      plan.container,

    video: {
      codecName:
        plan.video.codecName,

      profile:
        plan.video.profile,

      width:
        1920,

      height:
        1080,

      frameRate:
        25,

      pixelFormat:
        plan.video.pixelFormat,
    },

    audio: {
      codecName:
        plan.audio.codecName,

      sampleRateHz:
        48000,

      channels:
        plan.audio.channels,

      channelLayout:
        plan.audio.channelLayout,
    },

    renderKey:
      plan.renderKey,

    outputPath:
      plan.outputPath,

    shots:
      plan.shots.map(
        (
          shot,
        ) => ({
          sceneId:
            shot.sceneId,

          shotId:
            shot.shotId,

          order:
            shot.order,

          title:
            shot.title,

          durationSeconds:
            shot.durationSeconds,

          sourceVideoPath:
            shot.sourceVideoPath,

          sourceBytes:
            shot.sourceBytes,

          sourceSha256:
            shot.sourceSha256,
        }),
      ),
  };
}

function createDurableArtifactSnapshot(
  artifact:
    MaterializedEpisodeRoughCut,
): EpisodeRoughCutRenderRecord["artifact"] {
  return {
    outputPath:
      artifact.outputPath,

    bytes:
      artifact.bytes,

    sha256:
      artifact.sha256,

    contentType:
      artifact.contentType,

    durationSeconds:
      artifact.durationSeconds,

    durationToleranceSeconds:
      artifact.durationToleranceSeconds,
  };
}

export async function ensureEpisodeRoughCutRender(
  input:
    MaterializeEpisodeRoughCutInput,

  dependencies:
    EnsureEpisodeRoughCutRenderDependencies =
      defaultDependencies,
): Promise<EnsuredEpisodeRoughCutRender> {
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
        `Episode rough-cut render record plan does not match the requested render plan for ${input.plan.episodeId}.`,
      );
    }

    const inspected =
      await dependencies
        .inspectFile(
          input.plan.outputPath,
          EPISODE_ROUGH_CUT_MAX_OUTPUT_BYTES,
        );

    if (
      inspected.bytes !==
        record.artifact.bytes ||
      inspected.sha256 !==
        record.artifact.sha256
    ) {
      throw new Error(
        `Episode rough-cut artifact integrity does not match its durable record for ${input.plan.episodeId}.`,
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
      verifyEpisodeRoughCutOutput({
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
        `Episode rough-cut artifact media verification does not match its durable record for ${input.plan.episodeId}.`,
      );
    }

    return Object.freeze({
      renderStatus:
        "HIT" as const,

      artifact:
        Object.freeze({
          outputPath:
            record.artifact.outputPath,

          bytes:
            record.artifact.bytes,

          sha256:
            record.artifact.sha256,

          contentType:
            record.artifact.contentType,

          durationSeconds:
            record.artifact.durationSeconds,

          durationToleranceSeconds:
            record.artifact.durationToleranceSeconds,
        }),
    });
  }

  if (
    record ===
      null &&
    outputExists
  ) {
    throw new Error(
      "Episode rough-cut render is orphaned: artifact exists without a durable render record.",
    );
  }

  if (
    record !==
      null &&
    !outputExists
  ) {
    throw new Error(
      "Episode rough-cut render is incomplete: durable render record exists without its artifact.",
    );
  }

  const materialized =
    await dependencies
      .materialize(
        input,
      );

  const renderRecord:
    EpisodeRoughCutRenderRecord =
      {
        schemaVersion:
          "1.0",

        recordedAt:
          dependencies
            .now()
            .toISOString(),

        status:
          "RENDERED",

        plan:
          createDurablePlanSnapshot(
            input.plan,
          ),

        artifact:
          createDurableArtifactSnapshot(
            materialized,
          ),
      };

  await dependencies
    .writeRecord(
      renderRecord,
    );

  return Object.freeze({
    renderStatus:
      "MATERIALIZED" as const,

    artifact:
      materialized,
  });
}
