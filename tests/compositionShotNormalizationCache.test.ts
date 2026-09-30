import {
  join,
} from "node:path";

import {
  tmpdir,
} from "node:os";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  CompositionShotNormalizationPlan,
} from "../src/composition/buildCompositionShotNormalizationPlan.js";

import type {
  MaterializeCompositionShotNormalizationInput,
  MaterializedCompositionShotNormalization,
} from "../src/composition/materializeCompositionShotNormalization.js";

import type {
  CompositionShotNormalizationCacheRecord,
} from "../src/composition/compositionShotNormalizationCacheRecord.schema.js";

import {
  ensureCompositionShotNormalizationCache,
} from "../src/composition/ensureCompositionShotNormalizationCache.js";

const RECORDED_AT =
  "2026-09-30T19:55:00.000Z";

function createPlan():
CompositionShotNormalizationPlan {
  const cacheKey =
    "b".repeat(
      64,
    );

  return Object.freeze({
    schemaVersion:
      "1.0",

    profileId:
      "busybookie-master-normalization-v1",

    episodeId:
      "EP90",

    shotId:
      "S01",

    sourceVideoPath:
      join(
        tmpdir(),
        "busybookie-provider-source.mp4",
      ),

    sourceSha256:
      "a".repeat(
        64,
      ),

    sourceDurationSeconds:
      5.041667,

    targetDurationSeconds:
      5,

    durationToleranceSeconds:
      1 / 24,

    durationMode:
      "MANIFEST_LOCKED",

    nativeAudio:
      false,

    container:
      "mp4",

    video:
      Object.freeze({
        codecName:
          "h264",

        width:
          1920,

        height:
          1080,

        frameRate:
          25,

        pixelFormat:
          "yuv420p",

        scaleMode:
          "FIT_PAD",
      }),

    audio:
      Object.freeze({
        mode:
          "SYNTHETIC_SILENCE",

        codecName:
          "aac",

        sampleRateHz:
          48000,

        channels:
          2,

        channelLayout:
          "stereo",
      }),

    cacheKey,

    outputPath:
      join(
        tmpdir(),
        "cache",
        "composition-normalized",
        "EP90",
        "S01",
        `EP90_S01_${cacheKey}.mp4`,
      ),
  });
}

describe(
  "Busybookie composition shot normalization cache",
  () => {
    it(
      "materializes once and writes one durable record for an unambiguous cache miss",
      async () => {
        const plan =
          createPlan();

        const input:
          MaterializeCompositionShotNormalizationInput =
          Object.freeze({
            ffmpegExecutable:
              "D:/Tools/ffmpeg/bin/ffmpeg.exe",

            ffprobeExecutable:
              "D:/Tools/ffmpeg/bin/ffprobe.exe",

            plan,
          });

        const materialized:
          MaterializedCompositionShotNormalization =
          Object.freeze({
            outputPath:
              plan.outputPath,

            bytes:
              123456,

            sha256:
              "c".repeat(
                64,
              ),

            contentType:
              "video/mp4",

            durationSeconds:
              5,

            durationToleranceSeconds:
              1 / 25,
          });

        const readRecord =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              null,
          );

        const artifactExists =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              false,
          );

        const materialize =
          vi.fn(
            async (
              _input:
                MaterializeCompositionShotNormalizationInput,
            ) =>
              materialized,
          );

        let writtenRecord:
          CompositionShotNormalizationCacheRecord |
          null =
            null;

        const writeRecord =
          vi.fn(
            async (
              record:
                CompositionShotNormalizationCacheRecord,
            ) => {
              writtenRecord =
                record;

              return `${plan.outputPath}.composition-normalization.json`;
            },
          );

        const inspectFile =
          vi.fn(
            async () => {
              throw new Error(
                "Cache-hit file inspection must not run on a clean miss.",
              );
            },
          );

        const probeOutput =
          vi.fn(
            async () => {
              throw new Error(
                "Cache-hit ffprobe verification must not run on a clean miss.",
              );
            },
          );

        const now =
          vi.fn(
            () =>
              new Date(
                RECORDED_AT,
              ),
          );

        const result =
          await ensureCompositionShotNormalizationCache(
            input,
            {
              readRecord,
              artifactExists,
              materialize,
              writeRecord,
              inspectFile,
              probeOutput,
              now,
            },
          );

        expect(
          readRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          readRecord,
        ).toHaveBeenCalledWith(
          plan.outputPath,
        );

        expect(
          artifactExists,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          artifactExists,
        ).toHaveBeenCalledWith(
          plan.outputPath,
        );

        expect(
          materialize,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          materialize,
        ).toHaveBeenCalledWith(
          input,
        );

        expect(
          writeRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          writtenRecord,
        ).toEqual({
          schemaVersion:
            "1.0",

          recordedAt:
            RECORDED_AT,

          status:
            "NORMALIZED",

          plan,

          artifact:
            materialized,
        });

        expect(
          inspectFile,
        ).not.toHaveBeenCalled();

        expect(
          probeOutput,
        ).not.toHaveBeenCalled();

        expect(
          result,
        ).toEqual({
          cacheStatus:
            "MATERIALIZED",

          artifact:
            materialized,
        });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);

describe(
  "Busybookie composition shot normalization cache hit",
  () => {
    it(
      "reuses a valid durable normalized artifact without materializing or rewriting it",
      async () => {
        const plan =
          createPlan();

        const input:
          MaterializeCompositionShotNormalizationInput =
          Object.freeze({
            ffmpegExecutable:
              "D:/Tools/ffmpeg/bin/ffmpeg.exe",

            ffprobeExecutable:
              "D:/Tools/ffmpeg/bin/ffprobe.exe",

            plan,
          });

        const artifact:
          MaterializedCompositionShotNormalization =
          Object.freeze({
            outputPath:
              plan.outputPath,

            bytes:
              123456,

            sha256:
              "c".repeat(
                64,
              ),

            contentType:
              "video/mp4",

            durationSeconds:
              5,

            durationToleranceSeconds:
              1 / 25,
          });

        const record:
          CompositionShotNormalizationCacheRecord =
          {
            schemaVersion:
              "1.0",

            recordedAt:
              RECORDED_AT,

            status:
              "NORMALIZED",

            plan,

            artifact,
          };

        const readRecord =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              record,
          );

        const artifactExists =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              true,
          );

        const materialize =
          vi.fn(
            async () => {
              throw new Error(
                "FFmpeg materialization must not run for a valid cache hit.",
              );
            },
          );

        const writeRecord =
          vi.fn(
            async () => {
              throw new Error(
                "A valid cache hit must not rewrite its durable record.",
              );
            },
          );

        const inspectFile =
          vi.fn(
            async (
              _outputPath:
                string,

              _maxBytes:
                number,
            ) =>
              Object.freeze({
                bytes:
                  artifact.bytes,

                sha256:
                  artifact.sha256,
              }),
          );

        const probeOutput =
          vi.fn(
            async () =>
              Object.freeze({
                sourceVideoPath:
                  plan.outputPath,

                formatName:
                  "mov,mp4,m4a,3gp,3g2,mj2",

                durationSeconds:
                  5,

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
              }),
          );

        const now =
          vi.fn(
            () => {
              throw new Error(
                "A valid cache hit must not create a new timestamp.",
              );
            },
          );

        const result =
          await ensureCompositionShotNormalizationCache(
            input,
            {
              readRecord,
              artifactExists,
              materialize,
              writeRecord,
              inspectFile,
              probeOutput,
              now,
            },
          );

        expect(
          readRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          artifactExists,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectFile,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectFile,
        ).toHaveBeenCalledWith(
          plan.outputPath,
          500_000_000,
        );

        expect(
          probeOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          probeOutput,
        ).toHaveBeenCalledWith({
          ffprobeExecutable:
            input.ffprobeExecutable,

          sourceVideoPath:
            plan.outputPath,

          nativeAudio:
            true,
        });

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();

        expect(
          now,
        ).not.toHaveBeenCalled();

        expect(
          result,
        ).toEqual({
          cacheStatus:
            "HIT",

          artifact,
        });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);


describe(
  "Busybookie composition shot normalization cache orphan state",
  () => {
    it(
      "fails closed when normalized MP4 exists without a durable cache record",
      async () => {
        const plan =
          createPlan();

        const input:
          MaterializeCompositionShotNormalizationInput =
          Object.freeze({
            ffmpegExecutable:
              "D:/Tools/ffmpeg/bin/ffmpeg.exe",

            ffprobeExecutable:
              "D:/Tools/ffmpeg/bin/ffprobe.exe",

            plan,
          });

        const readRecord =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              null,
          );

        const artifactExists =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              true,
          );

        const materialize =
          vi.fn(
            async () => {
              throw new Error(
                "FFmpeg materialization must not run for an orphan cache artifact.",
              );
            },
          );

        const writeRecord =
          vi.fn(
            async () => {
              throw new Error(
                "An orphan cache artifact must not create or rewrite a durable record.",
              );
            },
          );

        const inspectFile =
          vi.fn(
            async () => {
              throw new Error(
                "An orphan cache artifact must not be trusted for cache-hit inspection.",
              );
            },
          );

        const probeOutput =
          vi.fn(
            async () => {
              throw new Error(
                "An orphan cache artifact must not be ffprobed as a trusted cache hit.",
              );
            },
          );

        const now =
          vi.fn(
            () => {
              throw new Error(
                "An orphan cache artifact must not create a timestamp.",
              );
            },
          );

        await expect(
          ensureCompositionShotNormalizationCache(
            input,
            {
              readRecord,
              artifactExists,
              materialize,
              writeRecord,
              inspectFile,
              probeOutput,
              now,
            },
          ),
        ).rejects.toThrow(
          "Composition normalization cache is orphaned: normalized artifact exists without a durable cache record.",
        );

        expect(
          readRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          readRecord,
        ).toHaveBeenCalledWith(
          plan.outputPath,
        );

        expect(
          artifactExists,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          artifactExists,
        ).toHaveBeenCalledWith(
          plan.outputPath,
        );

        expect(
          inspectFile,
        ).not.toHaveBeenCalled();

        expect(
          probeOutput,
        ).not.toHaveBeenCalled();

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();

        expect(
          now,
        ).not.toHaveBeenCalled();
      },
    );
  },
);


describe(
  "Busybookie composition shot normalization cache incomplete state",
  () => {
    it(
      "fails closed when a durable cache record exists without its normalized MP4",
      async () => {
        const plan =
          createPlan();

        const input:
          MaterializeCompositionShotNormalizationInput =
          Object.freeze({
            ffmpegExecutable:
              "D:/Tools/ffmpeg/bin/ffmpeg.exe",

            ffprobeExecutable:
              "D:/Tools/ffmpeg/bin/ffprobe.exe",

            plan,
          });

        const artifact:
          MaterializedCompositionShotNormalization =
          Object.freeze({
            outputPath:
              plan.outputPath,

            bytes:
              123456,

            sha256:
              "c".repeat(
                64,
              ),

            contentType:
              "video/mp4",

            durationSeconds:
              5,

            durationToleranceSeconds:
              1 / 25,
          });

        const record:
          CompositionShotNormalizationCacheRecord =
          {
            schemaVersion:
              "1.0",

            recordedAt:
              RECORDED_AT,

            status:
              "NORMALIZED",

            plan,

            artifact,
          };

        const readRecord =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              record,
          );

        const artifactExists =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              false,
          );

        const materialize =
          vi.fn(
            async () => {
              throw new Error(
                "FFmpeg materialization must not run for an incomplete durable cache state.",
              );
            },
          );

        const writeRecord =
          vi.fn(
            async () => {
              throw new Error(
                "An incomplete durable cache state must not rewrite its record.",
              );
            },
          );

        const inspectFile =
          vi.fn(
            async () => {
              throw new Error(
                "Missing normalized media must not be inspected.",
              );
            },
          );

        const probeOutput =
          vi.fn(
            async () => {
              throw new Error(
                "Missing normalized media must not be ffprobed.",
              );
            },
          );

        const now =
          vi.fn(
            () => {
              throw new Error(
                "An incomplete durable cache state must not create a timestamp.",
              );
            },
          );

        await expect(
          ensureCompositionShotNormalizationCache(
            input,
            {
              readRecord,
              artifactExists,
              materialize,
              writeRecord,
              inspectFile,
              probeOutput,
              now,
            },
          ),
        ).rejects.toThrow(
          "Composition normalization cache is incomplete: durable cache record exists without its normalized artifact.",
        );

        expect(
          readRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          readRecord,
        ).toHaveBeenCalledWith(
          plan.outputPath,
        );

        expect(
          artifactExists,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          artifactExists,
        ).toHaveBeenCalledWith(
          plan.outputPath,
        );

        expect(
          inspectFile,
        ).not.toHaveBeenCalled();

        expect(
          probeOutput,
        ).not.toHaveBeenCalled();

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();

        expect(
          now,
        ).not.toHaveBeenCalled();
      },
    );
  },
);


describe(
  "Busybookie composition shot normalization cache plan mismatch",
  () => {
    it(
      "fails closed before inspecting media when the durable plan does not match the requested plan",
      async () => {
        const plan =
          createPlan();

        const input:
          MaterializeCompositionShotNormalizationInput =
          Object.freeze({
            ffmpegExecutable:
              "D:/Tools/ffmpeg/bin/ffmpeg.exe",

            ffprobeExecutable:
              "D:/Tools/ffmpeg/bin/ffprobe.exe",

            plan,
          });

        const mismatchedPlan:
          CompositionShotNormalizationPlan =
          Object.freeze({
            ...plan,

            targetDurationSeconds:
              6,
          });

        const artifact:
          MaterializedCompositionShotNormalization =
          Object.freeze({
            outputPath:
              plan.outputPath,

            bytes:
              123456,

            sha256:
              "c".repeat(
                64,
              ),

            contentType:
              "video/mp4",

            durationSeconds:
              5,

            durationToleranceSeconds:
              1 / 25,
          });

        const record:
          CompositionShotNormalizationCacheRecord =
          {
            schemaVersion:
              "1.0",

            recordedAt:
              RECORDED_AT,

            status:
              "NORMALIZED",

            plan:
              mismatchedPlan,

            artifact,
          };

        const readRecord =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              record,
          );

        const artifactExists =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              true,
          );

        const materialize =
          vi.fn(
            async () => {
              throw new Error(
                "FFmpeg materialization must not run for a cache plan mismatch.",
              );
            },
          );

        const writeRecord =
          vi.fn(
            async () => {
              throw new Error(
                "A cache plan mismatch must not rewrite its durable record.",
              );
            },
          );

        const inspectFile =
          vi.fn(
            async () => {
              throw new Error(
                "A cache plan mismatch must fail before artifact inspection.",
              );
            },
          );

        const probeOutput =
          vi.fn(
            async () => {
              throw new Error(
                "A cache plan mismatch must fail before ffprobe.",
              );
            },
          );

        const now =
          vi.fn(
            () => {
              throw new Error(
                "A cache plan mismatch must not create a timestamp.",
              );
            },
          );

        await expect(
          ensureCompositionShotNormalizationCache(
            input,
            {
              readRecord,
              artifactExists,
              materialize,
              writeRecord,
              inspectFile,
              probeOutput,
              now,
            },
          ),
        ).rejects.toThrow(
          `Composition normalization cache record plan does not match the requested normalization plan for ${plan.episodeId}/${plan.shotId}.`,
        );

        expect(
          readRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          artifactExists,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectFile,
        ).not.toHaveBeenCalled();

        expect(
          probeOutput,
        ).not.toHaveBeenCalled();

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();

        expect(
          now,
        ).not.toHaveBeenCalled();
      },
    );
  },
);


describe(
  "Busybookie composition shot normalization cache artifact integrity",
  () => {
    it(
      "fails closed before probing when actual cached bytes do not match the durable record",
      async () => {
        const plan =
          createPlan();

        const input:
          MaterializeCompositionShotNormalizationInput =
          Object.freeze({
            ffmpegExecutable:
              "D:/Tools/ffmpeg/bin/ffmpeg.exe",

            ffprobeExecutable:
              "D:/Tools/ffmpeg/bin/ffprobe.exe",

            plan,
          });

        const artifact:
          MaterializedCompositionShotNormalization =
          Object.freeze({
            outputPath:
              plan.outputPath,

            bytes:
              123456,

            sha256:
              "c".repeat(
                64,
              ),

            contentType:
              "video/mp4",

            durationSeconds:
              5,

            durationToleranceSeconds:
              1 / 25,
          });

        const record:
          CompositionShotNormalizationCacheRecord =
          {
            schemaVersion:
              "1.0",

            recordedAt:
              RECORDED_AT,

            status:
              "NORMALIZED",

            plan,

            artifact,
          };

        const readRecord =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              record,
          );

        const artifactExists =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              true,
          );

        const inspectFile =
          vi.fn(
            async () =>
              Object.freeze({
                bytes:
                  artifact.bytes + 1,

                sha256:
                  artifact.sha256,
              }),
          );

        const probeOutput =
          vi.fn(
            async () => {
              throw new Error(
                "Integrity mismatch must fail before ffprobe.",
              );
            },
          );

        const materialize =
          vi.fn(
            async () => {
              throw new Error(
                "FFmpeg materialization must not run for a cache integrity mismatch.",
              );
            },
          );

        const writeRecord =
          vi.fn(
            async () => {
              throw new Error(
                "A cache integrity mismatch must not rewrite its durable record.",
              );
            },
          );

        const now =
          vi.fn(
            () => {
              throw new Error(
                "A cache integrity mismatch must not create a timestamp.",
              );
            },
          );

        await expect(
          ensureCompositionShotNormalizationCache(
            input,
            {
              readRecord,
              artifactExists,
              materialize,
              writeRecord,
              inspectFile,
              probeOutput,
              now,
            },
          ),
        ).rejects.toThrow(
          `Composition normalization cached artifact integrity does not match its durable record for ${plan.episodeId}/${plan.shotId}.`,
        );

        expect(
          readRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          artifactExists,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectFile,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectFile,
        ).toHaveBeenCalledWith(
          plan.outputPath,
          500_000_000,
        );

        expect(
          probeOutput,
        ).not.toHaveBeenCalled();

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();

        expect(
          now,
        ).not.toHaveBeenCalled();
      },
    );
  },
);


describe(
  "Busybookie composition shot normalization cache artifact SHA integrity",
  () => {
    it(
      "fails closed before probing when cached SHA-256 does not match the durable record",
      async () => {
        const plan =
          createPlan();

        const input:
          MaterializeCompositionShotNormalizationInput =
          Object.freeze({
            ffmpegExecutable:
              "D:/Tools/ffmpeg/bin/ffmpeg.exe",

            ffprobeExecutable:
              "D:/Tools/ffmpeg/bin/ffprobe.exe",

            plan,
          });

        const artifact:
          MaterializedCompositionShotNormalization =
          Object.freeze({
            outputPath:
              plan.outputPath,

            bytes:
              123456,

            sha256:
              "c".repeat(
                64,
              ),

            contentType:
              "video/mp4",

            durationSeconds:
              5,

            durationToleranceSeconds:
              1 / 25,
          });

        const record:
          CompositionShotNormalizationCacheRecord =
          {
            schemaVersion:
              "1.0",

            recordedAt:
              RECORDED_AT,

            status:
              "NORMALIZED",

            plan,

            artifact,
          };

        const readRecord =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              record,
          );

        const artifactExists =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              true,
          );

        const inspectFile =
          vi.fn(
            async () =>
              Object.freeze({
                bytes:
                  artifact.bytes,

                sha256:
                  "d".repeat(
                    64,
                  ),
              }),
          );

        const probeOutput =
          vi.fn(
            async () => {
              throw new Error(
                "SHA-256 mismatch must fail before ffprobe.",
              );
            },
          );

        const materialize =
          vi.fn(
            async () => {
              throw new Error(
                "FFmpeg materialization must not run for a cache SHA-256 mismatch.",
              );
            },
          );

        const writeRecord =
          vi.fn(
            async () => {
              throw new Error(
                "A cache SHA-256 mismatch must not rewrite its durable record.",
              );
            },
          );

        const now =
          vi.fn(
            () => {
              throw new Error(
                "A cache SHA-256 mismatch must not create a timestamp.",
              );
            },
          );

        await expect(
          ensureCompositionShotNormalizationCache(
            input,
            {
              readRecord,
              artifactExists,
              materialize,
              writeRecord,
              inspectFile,
              probeOutput,
              now,
            },
          ),
        ).rejects.toThrow(
          `Composition normalization cached artifact integrity does not match its durable record for ${plan.episodeId}/${plan.shotId}.`,
        );

        expect(
          readRecord,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          artifactExists,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectFile,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectFile,
        ).toHaveBeenCalledWith(
          plan.outputPath,
          500_000_000,
        );

        expect(
          probeOutput,
        ).not.toHaveBeenCalled();

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();

        expect(
          now,
        ).not.toHaveBeenCalled();
      },
    );
  },
);


describe(
  "Busybookie composition shot normalization cache media contract",
  () => {
    it(
      "fails closed without rerendering when freshly probed cached media violates the normalization contract",
      async () => {
        const plan =
          createPlan();

        const input:
          MaterializeCompositionShotNormalizationInput =
          Object.freeze({
            ffmpegExecutable:
              "D:/Tools/ffmpeg/bin/ffmpeg.exe",

            ffprobeExecutable:
              "D:/Tools/ffmpeg/bin/ffprobe.exe",

            plan,
          });

        const artifact:
          MaterializedCompositionShotNormalization =
          Object.freeze({
            outputPath:
              plan.outputPath,

            bytes:
              123456,

            sha256:
              "c".repeat(
                64,
              ),

            contentType:
              "video/mp4",

            durationSeconds:
              5,

            durationToleranceSeconds:
              1 / 25,
          });

        const record:
          CompositionShotNormalizationCacheRecord =
          {
            schemaVersion:
              "1.0",

            recordedAt:
              RECORDED_AT,

            status:
              "NORMALIZED",

            plan,

            artifact,
          };

        const readRecord =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              record,
          );

        const artifactExists =
          vi.fn(
            async (
              _outputPath:
                string,
            ) =>
              true,
          );

        const inspectFile =
          vi.fn(
            async () =>
              Object.freeze({
                bytes:
                  artifact.bytes,

                sha256:
                  artifact.sha256,
              }),
          );

        const probeOutput =
          vi.fn(
            async () =>
              Object.freeze({
                sourceVideoPath:
                  plan.outputPath,

                formatName:
                  "mov,mp4,m4a,3gp,3g2,mj2",

                durationSeconds:
                  5,

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
                      24,
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
              }),
          );

        const materialize =
          vi.fn(
            async () => {
              throw new Error(
                "FFmpeg materialization must not run when cached media fails revalidation.",
              );
            },
          );

        const writeRecord =
          vi.fn(
            async () => {
              throw new Error(
                "Invalid cached media must not rewrite its durable record.",
              );
            },
          );

        const now =
          vi.fn(
            () => {
              throw new Error(
                "Invalid cached media must not create a timestamp.",
              );
            },
          );

        await expect(
          ensureCompositionShotNormalizationCache(
            input,
            {
              readRecord,
              artifactExists,
              materialize,
              writeRecord,
              inspectFile,
              probeOutput,
              now,
            },
          ),
        ).rejects.toThrow(
          "Composition normalization output frame rate does not match the normalization plan.",
        );

        expect(
          inspectFile,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          inspectFile,
        ).toHaveBeenCalledWith(
          plan.outputPath,
          500_000_000,
        );

        expect(
          probeOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          probeOutput,
        ).toHaveBeenCalledWith({
          ffprobeExecutable:
            input.ffprobeExecutable,

          sourceVideoPath:
            plan.outputPath,

          nativeAudio:
            true,
        });

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();

        expect(
          now,
        ).not.toHaveBeenCalled();
      },
    );
  },
);


describe(
  "Busybookie composition shot normalization cache verified artifact evidence",
  () => {
    it(
      "fails closed when freshly verified cached output path does not match the durable artifact evidence",
      async () => {
        const plan =
          createPlan();

        const input:
          MaterializeCompositionShotNormalizationInput =
          Object.freeze({
            ffmpegExecutable:
              "D:/Tools/ffmpeg/bin/ffmpeg.exe",

            ffprobeExecutable:
              "D:/Tools/ffmpeg/bin/ffprobe.exe",

            plan,
          });

        const artifact:
          MaterializedCompositionShotNormalization =
          Object.freeze({
            outputPath:
              plan.outputPath,

            bytes:
              123456,

            sha256:
              "c".repeat(
                64,
              ),

            contentType:
              "video/mp4",

            durationSeconds:
              5,

            durationToleranceSeconds:
              1 / 25,
          });

        const record:
          CompositionShotNormalizationCacheRecord =
          {
            schemaVersion:
              "1.0",

            recordedAt:
              RECORDED_AT,

            status:
              "NORMALIZED",

            plan,

            artifact,
          };

        const readRecord =
          vi.fn(
            async () =>
              record,
          );

        const artifactExists =
          vi.fn(
            async () =>
              true,
          );

        const inspectFile =
          vi.fn(
            async () =>
              Object.freeze({
                bytes:
                  artifact.bytes,

                sha256:
                  artifact.sha256,
              }),
          );

        const probeOutput =
          vi.fn(
            async () =>
              Object.freeze({
                sourceVideoPath:
                  join(
                    tmpdir(),
                    "different-normalized-output.mp4",
                  ),

                formatName:
                  "mov,mp4,m4a,3gp,3g2,mj2",

                durationSeconds:
                  5,

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
              }),
          );

        const materialize =
          vi.fn(
            async () => {
              throw new Error(
                "FFmpeg materialization must not run for verified artifact evidence mismatch.",
              );
            },
          );

        const writeRecord =
          vi.fn(
            async () => {
              throw new Error(
                "Verified artifact evidence mismatch must not rewrite its durable record.",
              );
            },
          );

        const now =
          vi.fn(
            () => {
              throw new Error(
                "Verified artifact evidence mismatch must not create a timestamp.",
              );
            },
          );

        await expect(
          ensureCompositionShotNormalizationCache(
            input,
            {
              readRecord,
              artifactExists,
              materialize,
              writeRecord,
              inspectFile,
              probeOutput,
              now,
            },
          ),
        ).rejects.toThrow(
          `Composition normalization cached artifact media verification does not match its durable record for ${plan.episodeId}/${plan.shotId}.`,
        );

        expect(
          inspectFile,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          probeOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();

        expect(
          now,
        ).not.toHaveBeenCalled();
      },
    );
  },
);


describe(
  "Busybookie composition shot normalization cache verified duration evidence",
  () => {
    it(
      "fails closed when freshly verified cached duration does not match the durable artifact evidence",
      async () => {
        const plan =
          createPlan();

        const input:
          MaterializeCompositionShotNormalizationInput =
          Object.freeze({
            ffmpegExecutable:
              "D:/Tools/ffmpeg/bin/ffmpeg.exe",

            ffprobeExecutable:
              "D:/Tools/ffmpeg/bin/ffprobe.exe",

            plan,
          });

        const artifact:
          MaterializedCompositionShotNormalization =
          Object.freeze({
            outputPath:
              plan.outputPath,

            bytes:
              123456,

            sha256:
              "c".repeat(
                64,
              ),

            contentType:
              "video/mp4",

            durationSeconds:
              5,

            durationToleranceSeconds:
              1 / 25,
          });

        const record:
          CompositionShotNormalizationCacheRecord =
          {
            schemaVersion:
              "1.0",

            recordedAt:
              RECORDED_AT,

            status:
              "NORMALIZED",

            plan,

            artifact,
          };

        const readRecord =
          vi.fn(
            async () =>
              record,
          );

        const artifactExists =
          vi.fn(
            async () =>
              true,
          );

        const inspectFile =
          vi.fn(
            async () =>
              Object.freeze({
                bytes:
                  artifact.bytes,

                sha256:
                  artifact.sha256,
              }),
          );

        const probeOutput =
          vi.fn(
            async () =>
              Object.freeze({
                sourceVideoPath:
                  plan.outputPath,

                formatName:
                  "mov,mp4,m4a,3gp,3g2,mj2",

                durationSeconds:
                  5.04,

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
              }),
          );

        const materialize =
          vi.fn(
            async () => {
              throw new Error(
                "FFmpeg materialization must not run for verified duration evidence mismatch.",
              );
            },
          );

        const writeRecord =
          vi.fn(
            async () => {
              throw new Error(
                "Verified duration evidence mismatch must not rewrite its durable record.",
              );
            },
          );

        const now =
          vi.fn(
            () => {
              throw new Error(
                "Verified duration evidence mismatch must not create a timestamp.",
              );
            },
          );

        await expect(
          ensureCompositionShotNormalizationCache(
            input,
            {
              readRecord,
              artifactExists,
              materialize,
              writeRecord,
              inspectFile,
              probeOutput,
              now,
            },
          ),
        ).rejects.toThrow(
          `Composition normalization cached artifact media verification does not match its durable record for ${plan.episodeId}/${plan.shotId}.`,
        );

        expect(
          inspectFile,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          probeOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();

        expect(
          now,
        ).not.toHaveBeenCalled();
      },
    );
  },
);


describe(
  "Busybookie composition shot normalization cache verified duration tolerance evidence",
  () => {
    it(
      "fails closed when freshly verified cached duration tolerance does not match the durable artifact evidence",
      async () => {
        const plan =
          createPlan();

        const input:
          MaterializeCompositionShotNormalizationInput =
          Object.freeze({
            ffmpegExecutable:
              "D:/Tools/ffmpeg/bin/ffmpeg.exe",

            ffprobeExecutable:
              "D:/Tools/ffmpeg/bin/ffprobe.exe",

            plan,
          });

        const artifact:
          MaterializedCompositionShotNormalization =
          Object.freeze({
            outputPath:
              plan.outputPath,

            bytes:
              123456,

            sha256:
              "c".repeat(
                64,
              ),

            contentType:
              "video/mp4",

            durationSeconds:
              5,

            durationToleranceSeconds:
              1 / 24,
          });

        const record:
          CompositionShotNormalizationCacheRecord =
          {
            schemaVersion:
              "1.0",

            recordedAt:
              RECORDED_AT,

            status:
              "NORMALIZED",

            plan,

            artifact,
          };

        const readRecord =
          vi.fn(
            async () =>
              record,
          );

        const artifactExists =
          vi.fn(
            async () =>
              true,
          );

        const inspectFile =
          vi.fn(
            async () =>
              Object.freeze({
                bytes:
                  artifact.bytes,

                sha256:
                  artifact.sha256,
              }),
          );

        const probeOutput =
          vi.fn(
            async () =>
              Object.freeze({
                sourceVideoPath:
                  plan.outputPath,

                formatName:
                  "mov,mp4,m4a,3gp,3g2,mj2",

                durationSeconds:
                  5,

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
              }),
          );

        const materialize =
          vi.fn(
            async () => {
              throw new Error(
                "FFmpeg materialization must not run for verified duration tolerance evidence mismatch.",
              );
            },
          );

        const writeRecord =
          vi.fn(
            async () => {
              throw new Error(
                "Verified duration tolerance evidence mismatch must not rewrite its durable record.",
              );
            },
          );

        const now =
          vi.fn(
            () => {
              throw new Error(
                "Verified duration tolerance evidence mismatch must not create a timestamp.",
              );
            },
          );

        await expect(
          ensureCompositionShotNormalizationCache(
            input,
            {
              readRecord,
              artifactExists,
              materialize,
              writeRecord,
              inspectFile,
              probeOutput,
              now,
            },
          ),
        ).rejects.toThrow(
          `Composition normalization cached artifact media verification does not match its durable record for ${plan.episodeId}/${plan.shotId}.`,
        );

        expect(
          inspectFile,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          probeOutput,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();

        expect(
          now,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
