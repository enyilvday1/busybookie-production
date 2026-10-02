import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  DialogueCompositionShotNormalizationPlan,
} from "../src/composition/buildDialogueCompositionShotNormalizationPlan.js";

import {
  CompositionShotNormalizationCacheRecordSchema,
  type CompositionShotNormalizationCacheRecord,
} from "../src/composition/compositionShotNormalizationCacheRecord.schema.js";

import type {
  MaterializedCompositionShotNormalization,
} from "../src/composition/materializeCompositionShotNormalization.js";

import type {
  MaterializeDialogueCompositionShotNormalizationInput,
} from "../src/composition/materializeDialogueCompositionShotNormalization.js";

import {
  ensureDialogueCompositionShotNormalizationCache,
} from "../src/composition/ensureDialogueCompositionShotNormalizationCache.js";

const RECORDED_AT =
  "2026-10-02T14:00:00.000Z";

function createPlan():
DialogueCompositionShotNormalizationPlan {
  return Object.freeze({
    schemaVersion:
      "2.0",

    profileId:
      "busybookie-master-normalization-v2-dialogue",

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    sourceVideoPath:
      "D:/Busybookie/Production/generated-video/EP02/S02/source.mp4",

    sourceSha256:
      "1".repeat(
        64,
      ),

    sourceDurationSeconds:
      6,

    targetDurationSeconds:
      6,

    durationToleranceSeconds:
      1 / 24,

    durationMode:
      "MANIFEST_LOCKED",

    nativeAudio:
      true,

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
          "REPLACE_SOURCE_WITH_DIALOGUE",

        mixNativeAudio:
          false,

        sourceAudioDisposition:
          "DISCARD_NATIVE_AUDIO",

        dialoguePlanKey:
          "2".repeat(
            64,
          ),

        audioKey:
          "3".repeat(
            64,
          ),

        lines:
          Object.freeze([
            Object.freeze({
              lineNumber:
                1,

              dialogueLineId:
                "EP02_SC01_S02_L01",

              sourceAudioPath:
                "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/line1.audio",

              sourceBytes:
                1001,

              sourceSha256:
                "4".repeat(
                  64,
                ),

              startSeconds:
                0.5,

              durationSeconds:
                1.5,

              endSeconds:
                2,
            }),

            Object.freeze({
              lineNumber:
                2,

              dialogueLineId:
                "EP02_SC01_S02_L02",

              sourceAudioPath:
                "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L02/line2.audio",

              sourceBytes:
                1002,

              sourceSha256:
                "5".repeat(
                  64,
                ),

              startSeconds:
                2.5,

              durationSeconds:
                2.25,

              endSeconds:
                4.75,
            }),
          ]),

        codecName:
          "aac",

        sampleRateHz:
          48000,

        channels:
          2,

        channelLayout:
          "stereo",
      }),

    cacheKey:
      "6".repeat(
        64,
      ),

    outputPath:
      "D:/Busybookie/Production/cache/composition-normalized/EP02/S02/EP02_S02_output.mp4",
  });
}

function createArtifact(
  plan:
    DialogueCompositionShotNormalizationPlan,
): MaterializedCompositionShotNormalization {
  return Object.freeze({
    outputPath:
      plan.outputPath,

    bytes:
      123456,

    sha256:
      "7".repeat(
        64,
      ),

    contentType:
      "video/mp4",

    durationSeconds:
      6,

    durationToleranceSeconds:
      1 / 25,
  });
}

function createRecord(
  plan:
    DialogueCompositionShotNormalizationPlan,
  artifact:
    MaterializedCompositionShotNormalization,
): CompositionShotNormalizationCacheRecord {
  return CompositionShotNormalizationCacheRecordSchema.parse({
    schemaVersion:
      "2.0",

    recordedAt:
      RECORDED_AT,

    status:
      "NORMALIZED",

    plan,

    artifact,
  });
}

function createInput(
  plan:
    DialogueCompositionShotNormalizationPlan,
): MaterializeDialogueCompositionShotNormalizationInput {
  return Object.freeze({
    ffmpegExecutable:
      "D:/Tools/ffmpeg/bin/ffmpeg.exe",

    ffprobeExecutable:
      "D:/Tools/ffmpeg/bin/ffprobe.exe",

    plan,
  });
}

function createValidOutputMedia(
  outputPath:
    string,
) {
  return Object.freeze({
    sourceVideoPath:
      outputPath,

    formatName:
      "mov,mp4,m4a,3gp,3g2,mj2",

    durationSeconds:
      6,

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
  "Busybookie dialogue composition normalization durable cache",
  () => {
    it(
      "materializes a genuine miss and persists a schema-version-2 durable record",
      async () => {
        const plan =
          createPlan();

        const input =
          createInput(
            plan,
          );

        const artifact =
          createArtifact(
            plan,
          );

        const readRecord =
          vi.fn(
            async () =>
              null,
          );

        const artifactExists =
          vi.fn(
            async () =>
              false,
          );

        const materialize =
          vi.fn(
            async () =>
              artifact,
          );

        const writeRecord =
          vi.fn(
            async (
              record:
                CompositionShotNormalizationCacheRecord,
            ) => {
              expect(
                record.schemaVersion,
              ).toBe(
                "2.0",
              );

              expect(
                record.plan,
              ).toEqual(
                plan,
              );

              expect(
                record.artifact,
              ).toEqual(
                artifact,
              );

              return "D:/Busybookie/Production/cache/composition-normalized/EP02/S02/record.json";
            },
          );

        const inspectFile =
          vi.fn();

        const probeOutput =
          vi.fn();

        const now =
          vi.fn(
            () =>
              new Date(
                RECORDED_AT,
              ),
          );

        const result =
          await ensureDialogueCompositionShotNormalizationCache(
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
          result,
        ).toEqual({
          cacheStatus:
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
          now,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it(
      "accepts a cache hit only after fresh integrity and dialogue-v2 media verification",
      async () => {
        const plan =
          createPlan();

        const input =
          createInput(
            plan,
          );

        const artifact =
          createArtifact(
            plan,
          );

        const record =
          createRecord(
            plan,
            artifact,
          );

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

        const materialize =
          vi.fn();

        const writeRecord =
          vi.fn();

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
              createValidOutputMedia(
                plan.outputPath,
              ),
          );

        const now =
          vi.fn();

        const result =
          await ensureDialogueCompositionShotNormalizationCache(
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
          result,
        ).toEqual({
          cacheStatus:
            "HIT",

          artifact,
        });

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

    it(
      "fails closed when a cache record plan differs from the requested dialogue-v2 plan",
      async () => {
        const plan =
          createPlan();

        const artifact =
          createArtifact(
            plan,
          );

        const mismatchedPlan =
          Object.freeze({
            ...plan,

            cacheKey:
              "8".repeat(
                64,
              ),
          }) satisfies
            DialogueCompositionShotNormalizationPlan;

        const readRecord =
          vi.fn(
            async () =>
              createRecord(
                mismatchedPlan,
                Object.freeze({
                  ...artifact,

                  outputPath:
                    mismatchedPlan.outputPath,
                }),
              ),
          );

        const materialize =
          vi.fn();

        const writeRecord =
          vi.fn();

        await expect(
          ensureDialogueCompositionShotNormalizationCache(
            createInput(
              plan,
            ),
            {
              readRecord,

              artifactExists:
                vi.fn(
                  async () =>
                    true,
                ),

              materialize,
              writeRecord,

              inspectFile:
                vi.fn(),

              probeOutput:
                vi.fn(),

              now:
                vi.fn(),
            },
          ),
        ).rejects.toThrow(
          /record plan.*requested normalization plan|plan.*does not match/i,
        );

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed for an orphaned normalized artifact without a durable record",
      async () => {
        const plan =
          createPlan();

        const materialize =
          vi.fn();

        const writeRecord =
          vi.fn();

        await expect(
          ensureDialogueCompositionShotNormalizationCache(
            createInput(
              plan,
            ),
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

              materialize,
              writeRecord,

              inspectFile:
                vi.fn(),

              probeOutput:
                vi.fn(),

              now:
                vi.fn(),
            },
          ),
        ).rejects.toThrow(
          /orphaned/i,
        );

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed for an incomplete cache record whose normalized artifact is missing",
      async () => {
        const plan =
          createPlan();

        const artifact =
          createArtifact(
            plan,
          );

        const materialize =
          vi.fn();

        const writeRecord =
          vi.fn();

        await expect(
          ensureDialogueCompositionShotNormalizationCache(
            createInput(
              plan,
            ),
            {
              readRecord:
                vi.fn(
                  async () =>
                    createRecord(
                      plan,
                      artifact,
                    ),
                ),

              artifactExists:
                vi.fn(
                  async () =>
                    false,
                ),

              materialize,
              writeRecord,

              inspectFile:
                vi.fn(),

              probeOutput:
                vi.fn(),

              now:
                vi.fn(),
            },
          ),
        ).rejects.toThrow(
          /incomplete/i,
        );

        expect(
          materialize,
        ).not.toHaveBeenCalled();

        expect(
          writeRecord,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when cached bytes or SHA no longer match the durable artifact evidence",
      async () => {
        const plan =
          createPlan();

        const artifact =
          createArtifact(
            plan,
          );

        const materialize =
          vi.fn();

        const writeRecord =
          vi.fn();

        const probeOutput =
          vi.fn();

        await expect(
          ensureDialogueCompositionShotNormalizationCache(
            createInput(
              plan,
            ),
            {
              readRecord:
                vi.fn(
                  async () =>
                    createRecord(
                      plan,
                      artifact,
                    ),
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
                        artifact.bytes,

                      sha256:
                        "9".repeat(
                          64,
                        ),
                    }),
                ),

              probeOutput,

              now:
                vi.fn(),
            },
          ),
        ).rejects.toThrow(
          /cached artifact integrity|integrity.*durable record/i,
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
      },
    );
  },
);
