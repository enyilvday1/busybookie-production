import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ensureEpisodeRoughCutRender,
} from "../src/composition/ensureEpisodeRoughCutRender.js";

import type {
  EpisodeRoughCutRenderPlan,
} from "../src/composition/buildEpisodeRoughCutRenderPlan.js";

import type {
  EpisodeRoughCutRenderRecord,
} from "../src/composition/episodeRoughCutRenderRecord.schema.js";

import type {
  MaterializedEpisodeRoughCut,
} from "../src/composition/materializeEpisodeRoughCut.js";

import type {
  CompositionSourceMediaMetadata,
} from "../src/composition/probeCompositionSourceMedia.js";

function createPlan():
  EpisodeRoughCutRenderPlan {
  const renderKey =
    "e".repeat(
      64,
    );

  return Object.freeze({
    schemaVersion:
      "1.0",

    profileId:
      "busybookie-episode-rough-cut-v1",

    assemblyMode:
      "STRAIGHT_CUT",

    episodeId:
      "EP02",

    title:
      "Reconciliation contract",

    totalShots:
      1,

    totalDurationSeconds:
      4,

    container:
      "mp4",

    video:
      Object.freeze({
        codecName:
          "h264",

        profile:
          "High",

        width:
          1920,

        height:
          1080,

        frameRate:
          25,

        pixelFormat:
          "yuv420p",
      }),

    audio:
      Object.freeze({
        codecName:
          "aac",

        sampleRateHz:
          48000,

        channels:
          2,

        channelLayout:
          "stereo",
      }),

    renderKey,

    outputPath:
      `D:/Busybookie/Production/exports/EP02/rough-cut/EP02_rough-cut_${renderKey}.mp4`,

    shots:
      Object.freeze([
        Object.freeze({
          sceneId:
            "SC01",

          shotId:
            "S01",

          order:
            1,

          title:
            "Shot S01",

          durationSeconds:
            4,

          sourceVideoPath:
            "D:/Busybookie/Production/cache/composition-normalized/EP02/S01/source.mp4",

          sourceBytes:
            123_456,

          sourceSha256:
            "c".repeat(
              64,
            ),
        }),
      ]),
  });
}

function createArtifact(
  plan:
    EpisodeRoughCutRenderPlan,
): MaterializedEpisodeRoughCut {
  return Object.freeze({
    outputPath:
      plan.outputPath,

    bytes:
      654_321,

    sha256:
      "d".repeat(
        64,
      ),

    contentType:
      "video/mp4",

    durationSeconds:
      4,

    durationToleranceSeconds:
      1 / 25,
  });
}

function createRecord(
  plan:
    EpisodeRoughCutRenderPlan,
): EpisodeRoughCutRenderRecord {
  const artifact =
    createArtifact(
      plan,
    );

  return {
    schemaVersion:
      "1.0",

    recordedAt:
      "2026-10-01T00:50:00.000Z",

    status:
      "RENDERED",

    plan: {
      ...plan,

      video: {
        codecName:
          "h264",

        profile:
          "High",

        width:
          1920,

        height:
          1080,

        frameRate:
          25,

        pixelFormat:
          "yuv420p",
      },

      audio: {
        codecName:
          "aac",

        sampleRateHz:
          48000,

        channels:
          2,

        channelLayout:
          "stereo",
      },

      shots:
        plan.shots.map(
          (
            shot,
          ) => ({
            ...shot,
          }),
        ),
    },

    artifact: {
      ...artifact,
    },
  };
}

function createValidProbeResult(
  outputPath:
    string,
): CompositionSourceMediaMetadata {
  return Object.freeze({
    sourceVideoPath:
      outputPath,

    formatName:
      "mov,mp4,m4a,3gp,3g2,mj2",

    durationSeconds:
      4,

    video:
      Object.freeze({
        codecName:
          "h264",

        profile:
          "High",

        width:
          1920,

        height:
          1080,

        pixelFormat:
          "yuv420p",

        frameRate:
          25,
      }),

    audio:
      Object.freeze({
        codecName:
          "aac",

        profile:
          "LC",

        sampleRateHz:
          48000,

        channels:
          2,

        channelLayout:
          "stereo",
      }),
  });
}

describe(
  "Busybookie episode rough-cut render reconciliation",
  () => {
    it(
      "materializes and writes a durable record only when both record and artifact are absent",
      async () => {
        const plan =
          createPlan();

        const artifact =
          createArtifact(
            plan,
          );

        const materialize =
          vi.fn(
            async () =>
              artifact,
          );

        const writeRecord =
          vi.fn(
            async (
              _record:
                EpisodeRoughCutRenderRecord,
            ) =>
              "D:/Busybookie/Production/exports/EP02/rough-cut/output.composition-rough-cut.json",
          );

        const inspectFile =
          vi.fn();

        const probeOutput =
          vi.fn();

        const result =
          await ensureEpisodeRoughCutRender(
            {
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              ffprobeExecutable:
                "C:/Tools/ffprobe.exe",

              plan,
            },
            {
              readRecord:
                vi.fn(
                  async () =>
                    null,
                ),

              artifactExists:
                vi.fn(
                  async () =>
                    false,
                ),

              materialize,

              writeRecord,

              inspectFile,

              probeOutput,

              now:
                () =>
                  new Date(
                    "2026-10-01T00:50:00.000Z",
                  ),
            },
          );

        expect(
          result,
        ).toEqual({
          renderStatus:
            "MATERIALIZED",

          artifact,
        });

        expect(
          materialize,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          writeRecord,
        ).toHaveBeenCalledWith({
          schemaVersion:
            "1.0",

          recordedAt:
            "2026-10-01T00:50:00.000Z",

          status:
            "RENDERED",

          plan:
            expect.objectContaining({
              renderKey:
                plan.renderKey,

              outputPath:
                plan.outputPath,
            }),

          artifact,
        });

        expect(
          inspectFile,
        ).not.toHaveBeenCalled();

        expect(
          probeOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "returns HIT only after durable record, artifact integrity, and media verification all agree",
      async () => {
        const plan =
          createPlan();

        const record =
          createRecord(
            plan,
          );

        const materialize =
          vi.fn();

        const writeRecord =
          vi.fn();

        const result =
          await ensureEpisodeRoughCutRender(
            {
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              ffprobeExecutable:
                "C:/Tools/ffprobe.exe",

              plan,
            },
            {
              readRecord:
                vi.fn(
                  async () =>
                    record,
                ),

              artifactExists:
                vi.fn(
                  async () =>
                    true,
                ),

              materialize,

              writeRecord,

              inspectFile:
                vi.fn(
                  async () =>
                    Object.freeze({
                      bytes:
                        record.artifact.bytes,

                      sha256:
                        record.artifact.sha256,
                    }),
                ),

              probeOutput:
                vi.fn(
                  async () =>
                    createValidProbeResult(
                      plan.outputPath,
                    ),
                ),

              now:
                () =>
                  new Date(),
            },
          );

        expect(
          result,
        ).toEqual({
          renderStatus:
            "HIT",

          artifact:
            record.artifact,
        });

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when an artifact exists without its durable render record",
      async () => {
        const plan =
          createPlan();

        await expect(
          ensureEpisodeRoughCutRender(
            {
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              ffprobeExecutable:
                "C:/Tools/ffprobe.exe",

              plan,
            },
            {
              readRecord:
                vi.fn(
                  async () =>
                    null,
                ),

              artifactExists:
                vi.fn(
                  async () =>
                    true,
                ),

              materialize:
                vi.fn(),

              writeRecord:
                vi.fn(),

              inspectFile:
                vi.fn(),

              probeOutput:
                vi.fn(),

              now:
                () =>
                  new Date(),
            },
          ),
        ).rejects.toThrow(
          /orphaned.*artifact.*without.*record/i,
        );
      },
    );

    it(
      "fails closed when a durable render record exists without its artifact",
      async () => {
        const plan =
          createPlan();

        await expect(
          ensureEpisodeRoughCutRender(
            {
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              ffprobeExecutable:
                "C:/Tools/ffprobe.exe",

              plan,
            },
            {
              readRecord:
                vi.fn(
                  async () =>
                    createRecord(
                      plan,
                    ),
                ),

              artifactExists:
                vi.fn(
                  async () =>
                    false,
                ),

              materialize:
                vi.fn(),

              writeRecord:
                vi.fn(),

              inspectFile:
                vi.fn(),

              probeOutput:
                vi.fn(),

              now:
                () =>
                  new Date(),
            },
          ),
        ).rejects.toThrow(
          /incomplete.*record.*without.*artifact/i,
        );
      },
    );

    it(
      "fails closed when the durable record plan differs from the requested render plan",
      async () => {
        const plan =
          createPlan();

        const record =
          createRecord(
            plan,
          );

        const conflictingRecord:
          EpisodeRoughCutRenderRecord =
            {
              ...record,

              plan: {
                ...record.plan,

                title:
                  "Different durable title",
              },
            };

        await expect(
          ensureEpisodeRoughCutRender(
            {
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              ffprobeExecutable:
                "C:/Tools/ffprobe.exe",

              plan,
            },
            {
              readRecord:
                vi.fn(
                  async () =>
                    conflictingRecord,
                ),

              artifactExists:
                vi.fn(
                  async () =>
                    true,
                ),

              materialize:
                vi.fn(),

              writeRecord:
                vi.fn(),

              inspectFile:
                vi.fn(),

              probeOutput:
                vi.fn(),

              now:
                () =>
                  new Date(),
            },
          ),
        ).rejects.toThrow(
          /record plan.*does not match.*requested.*plan/i,
        );
      },
    );

    it(
      "fails closed when the rendered artifact bytes or SHA no longer match the durable record",
      async () => {
        const plan =
          createPlan();

        const record =
          createRecord(
            plan,
          );

        await expect(
          ensureEpisodeRoughCutRender(
            {
              ffmpegExecutable:
                "C:/Tools/ffmpeg.exe",

              ffprobeExecutable:
                "C:/Tools/ffprobe.exe",

              plan,
            },
            {
              readRecord:
                vi.fn(
                  async () =>
                    record,
                ),

              artifactExists:
                vi.fn(
                  async () =>
                    true,
                ),

              materialize:
                vi.fn(),

              writeRecord:
                vi.fn(),

              inspectFile:
                vi.fn(
                  async () =>
                    Object.freeze({
                      bytes:
                        record.artifact.bytes,

                      sha256:
                        "f".repeat(
                          64,
                        ),
                    }),
                ),

              probeOutput:
                vi.fn(),

              now:
                () =>
                  new Date(),
            },
          ),
        ).rejects.toThrow(
          /artifact integrity.*does not match.*durable record/i,
        );
      },
    );
  },
);
