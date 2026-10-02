import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CompositionShotNormalizationCacheRecordSchema,
} from "../src/composition/compositionShotNormalizationCacheRecord.schema.js";

const MEDIA_ROOT =
  "D:/Busybookie/Production";

const V1_CACHE_KEY =
  "a".repeat(
    64,
  );

const V2_CACHE_KEY =
  "b".repeat(
    64,
  );

const v1OutputPath =
  `${MEDIA_ROOT}/cache/composition-normalized/EP90/S01/EP90_S01_${V1_CACHE_KEY}.mp4`;

const v2OutputPath =
  `${MEDIA_ROOT}/cache/composition-normalized/EP02/S02/EP02_S02_${V2_CACHE_KEY}.mp4`;

const artifactFor =
  (
    outputPath:
      string,
  ) =>
    ({
      outputPath,

      bytes:
        123456,

      sha256:
        "f".repeat(
          64,
        ),

      contentType:
        "video/mp4",

      durationSeconds:
        6,

      durationToleranceSeconds:
        1 / 25,
    });

describe(
  "Busybookie composition normalization durable cache schema evolution",
  () => {
    it(
      "continues to parse an existing v1 normalization cache record unchanged",
      () => {
        const record =
          {
            schemaVersion:
              "1.0",

            recordedAt:
              "2026-10-02T12:00:00.000Z",

            status:
              "NORMALIZED",

            plan: {
              schemaVersion:
                "1.0",

              profileId:
                "busybookie-master-normalization-v1",

              episodeId:
                "EP90",

              shotId:
                "S01",

              sourceVideoPath:
                `${MEDIA_ROOT}/generated-video/EP90/S01/source.mp4`,

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
                false,

              container:
                "mp4",

              video: {
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
              },

              audio: {
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
              },

              cacheKey:
                V1_CACHE_KEY,

              outputPath:
                v1OutputPath,
            },

            artifact:
              artifactFor(
                v1OutputPath,
              ),
          };

        expect(
          () =>
            CompositionShotNormalizationCacheRecordSchema
              .parse(
                record,
              ),
        ).not.toThrow();
      },
    );

    it(
      "parses a v2 dialogue normalization cache record with a strict dialogue plan snapshot",
      () => {
        const record =
          {
            schemaVersion:
              "2.0",

            recordedAt:
              "2026-10-02T12:00:00.000Z",

            status:
              "NORMALIZED",

            plan: {
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
                `${MEDIA_ROOT}/generated-video/EP02/S02/source.mp4`,

              sourceSha256:
                "2".repeat(
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

              video: {
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
              },

              audio: {
                mode:
                  "REPLACE_SOURCE_WITH_DIALOGUE",

                mixNativeAudio:
                  false,

                sourceAudioDisposition:
                  "DISCARD_NATIVE_AUDIO",

                dialoguePlanKey:
                  "3".repeat(
                    64,
                  ),

                audioKey:
                  "4".repeat(
                    64,
                  ),

                lines: [
                  {
                    lineNumber:
                      1,

                    dialogueLineId:
                      "EP02_SC01_S02_L01",

                    sourceAudioPath:
                      `${MEDIA_ROOT}/voices/EP02/S02/EP02_SC01_S02_L01/line1.audio`,

                    sourceBytes:
                      1001,

                    sourceSha256:
                      "5".repeat(
                        64,
                      ),

                    startSeconds:
                      0.5,

                    durationSeconds:
                      1.5,

                    endSeconds:
                      2,
                  },

                  {
                    lineNumber:
                      2,

                    dialogueLineId:
                      "EP02_SC01_S02_L02",

                    sourceAudioPath:
                      `${MEDIA_ROOT}/voices/EP02/S02/EP02_SC01_S02_L02/line2.audio`,

                    sourceBytes:
                      1002,

                    sourceSha256:
                      "6".repeat(
                        64,
                      ),

                    startSeconds:
                      2.5,

                    durationSeconds:
                      2.25,

                    endSeconds:
                      4.75,
                  },
                ],

                codecName:
                  "aac",

                sampleRateHz:
                  48000,

                channels:
                  2,

                channelLayout:
                  "stereo",
              },

              cacheKey:
                V2_CACHE_KEY,

              outputPath:
                v2OutputPath,
            },

            artifact:
              artifactFor(
                v2OutputPath,
              ),
          };

        expect(
          () =>
            CompositionShotNormalizationCacheRecordSchema
              .parse(
                record,
              ),
        ).not.toThrow();
      },
    );
  },
);
