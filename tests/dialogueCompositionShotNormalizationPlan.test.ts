import {
  createHash,
} from "node:crypto";

import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  DialogueCompositionAudioPlan,
} from "../src/dialogue/buildDialogueCompositionAudioPlan.js";

import type {
  ProductionRules,
} from "../src/schemas/productionRules.schema.js";

import type {
  EpisodeCompositionPlanShot,
} from "../src/composition/buildEpisodeCompositionPlan.js";

import type {
  CompositionSourceMediaMetadata,
} from "../src/composition/probeCompositionSourceMedia.js";

import {
  buildDialogueCompositionShotNormalizationPlan,
} from "../src/composition/buildDialogueCompositionShotNormalizationPlan.js";

const MEDIA_ROOT =
  "D:/Busybookie/Production";

const SOURCE_VIDEO_PATH =
  `${MEDIA_ROOT}/generated-video/EP02/S02/EP02_S02_source.mp4`;

const SOURCE_SHA256 =
  "a".repeat(
    64,
  );

const DIALOGUE_PLAN_KEY =
  "c".repeat(
    64,
  );

const AUDIO_KEY =
  "b".repeat(
    64,
  );

const postProduction:
  ProductionRules["postProduction"] =
    Object.freeze({
      aspectRatio:
        "16:9",

      width:
        1920,

      height:
        1080,

      timelineFps:
        25,

      audioSampleRateHz:
        48000,
    });

function createShot(
  nativeAudio:
    boolean,
): EpisodeCompositionPlanShot {
  return Object.freeze({
    sceneId:
      "SC01",

    shotId:
      "S02",

    order:
      2,

    title:
      "Dialogue shot",

    durationSeconds:
      6,

    nativeAudio,

    provider:
      "VEO",

    providerExecutionId:
      "operations/dialogue-shot",

    sourceVideoPath:
      SOURCE_VIDEO_PATH,

    sourceBytes:
      9_001,

    sourceSha256:
      SOURCE_SHA256,

    sourceContentType:
      "video/mp4",
  });
}

function createSourceMedia(
  nativeAudio:
    boolean,
): CompositionSourceMediaMetadata {
  return Object.freeze({
    sourceVideoPath:
      SOURCE_VIDEO_PATH,

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
          1280,

        height:
          720,

        pixelFormat:
          "yuv420p",

        frameRate:
          24,
      }),

    audio:
      nativeAudio
        ? Object.freeze({
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
          })
        : null,
  }) as
    CompositionSourceMediaMetadata;
}

function createAudioPlan(
  input:
    Readonly<{
      sourceNativeAudio:
        boolean;

      audioKey?:
        string;

      shotId?:
        string;
    }>,
): DialogueCompositionAudioPlan {
  const sourceAudioDisposition =
    input.sourceNativeAudio
      ? "DISCARD_NATIVE_AUDIO" as const
      : "NO_SOURCE_AUDIO" as const;

  return Object.freeze({
    schemaVersion:
      "1.0",

    audioMode:
      "REPLACE_SOURCE_WITH_DIALOGUE",

    mixNativeAudio:
      false,

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      input.shotId ??
      "S02",

    dialoguePlanKey:
      DIALOGUE_PLAN_KEY,

    shotDurationSeconds:
      6,

    sourceNativeAudio:
      input.sourceNativeAudio,

    sourceAudioDisposition,

    lines:
      Object.freeze([
        Object.freeze({
          lineNumber:
            1,

          dialogueLineId:
            "EP02_SC01_S02_L01",

          sourceAudioPath:
            `${MEDIA_ROOT}/voices/EP02/S02/EP02_SC01_S02_L01/line1.audio`,

          sourceBytes:
            1001,

          sourceSha256:
            "1".repeat(
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
            `${MEDIA_ROOT}/voices/EP02/S02/EP02_SC01_S02_L02/line2.audio`,

          sourceBytes:
            1002,

          sourceSha256:
            "2".repeat(
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

    audioKey:
      input.audioKey ??
      AUDIO_KEY,
  });
}

function expectedCacheKey(
  audioKey:
    string,
): string {
  return createHash(
    "sha256",
  )
    .update(
      [
        "busybookie-master-normalization-v2-dialogue",
        "EP02",
        "SC01",
        "S02",
        SOURCE_SHA256,
        "6",
        audioKey,
        "1920x1080@25",
        "48000",
      ].join(
        "\n",
      ),
      "utf8",
    )
    .digest(
      "hex",
    );
}

describe(
  "Busybookie dialogue composition shot normalization planning",
  () => {
    it.each([
      true,
      false,
    ])(
      "builds a v2 dialogue-replacement normalization plan; source nativeAudio=%s",
      (
        nativeAudio,
      ) => {
        const audioPlan =
          createAudioPlan({
            sourceNativeAudio:
              nativeAudio,
          });

        const result =
          buildDialogueCompositionShotNormalizationPlan({
            mediaRoot:
              MEDIA_ROOT,

            episodeId:
              "EP02",

            shot:
              createShot(
                nativeAudio,
              ),

            sourceMedia:
              createSourceMedia(
                nativeAudio,
              ),

            postProduction,

            dialogueAudio:
              audioPlan,
          });

        const cacheKey =
          expectedCacheKey(
            AUDIO_KEY,
          );

        expect(
          result,
        ).toEqual({
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
            SOURCE_VIDEO_PATH,

          sourceSha256:
            SOURCE_SHA256,

          sourceDurationSeconds:
            6,

          targetDurationSeconds:
            6,

          durationToleranceSeconds:
            1 / 24,

          durationMode:
            "MANIFEST_LOCKED",

          nativeAudio,

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
              nativeAudio
                ? "DISCARD_NATIVE_AUDIO"
                : "NO_SOURCE_AUDIO",

            dialoguePlanKey:
              DIALOGUE_PLAN_KEY,

            audioKey:
              AUDIO_KEY,

            lines:
              audioPlan.lines,

            codecName:
              "aac",

            sampleRateHz:
              48000,

            channels:
              2,

            channelLayout:
              "stereo",
          },

          cacheKey,

          outputPath:
            `${MEDIA_ROOT}/cache/composition-normalized/EP02/S02/EP02_S02_${cacheKey}.mp4`,
        });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            result.audio,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            result.audio.lines,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "changes normalization cacheKey when dialogue audioKey changes",
      () => {
        const first =
          buildDialogueCompositionShotNormalizationPlan({
            mediaRoot:
              MEDIA_ROOT,

            episodeId:
              "EP02",

            shot:
              createShot(
                true,
              ),

            sourceMedia:
              createSourceMedia(
                true,
              ),

            postProduction,

            dialogueAudio:
              createAudioPlan({
                sourceNativeAudio:
                  true,

                audioKey:
                  "b".repeat(
                    64,
                  ),
              }),
          });

        const second =
          buildDialogueCompositionShotNormalizationPlan({
            mediaRoot:
              MEDIA_ROOT,

            episodeId:
              "EP02",

            shot:
              createShot(
                true,
              ),

            sourceMedia:
              createSourceMedia(
                true,
              ),

            postProduction,

            dialogueAudio:
              createAudioPlan({
                sourceNativeAudio:
                  true,

                audioKey:
                  "d".repeat(
                    64,
                  ),
              }),
          });

        expect(
          first.cacheKey,
        ).not.toBe(
          second.cacheKey,
        );

        expect(
          first.outputPath,
        ).not.toBe(
          second.outputPath,
        );
      },
    );

    it(
      "rejects dialogue audio identity that does not match the composition shot",
      () => {
        expect(
          () =>
            buildDialogueCompositionShotNormalizationPlan({
              mediaRoot:
                MEDIA_ROOT,

              episodeId:
                "EP02",

              shot:
                createShot(
                  true,
                ),

              sourceMedia:
                createSourceMedia(
                  true,
                ),

              postProduction,

              dialogueAudio:
                createAudioPlan({
                  sourceNativeAudio:
                    true,

                  shotId:
                    "S03",
                }),
            }),
        ).toThrow(
          /dialogue.*identity|shot/i,
        );
      },
    );

    it(
      "rejects dialogue source-native-audio disposition that does not match the composition shot",
      () => {
        expect(
          () =>
            buildDialogueCompositionShotNormalizationPlan({
              mediaRoot:
                MEDIA_ROOT,

              episodeId:
                "EP02",

              shot:
                createShot(
                  true,
                ),

              sourceMedia:
                createSourceMedia(
                  true,
                ),

              postProduction,

              dialogueAudio:
                createAudioPlan({
                  sourceNativeAudio:
                    false,
                }),
            }),
        ).toThrow(
          /native.*audio|source.*audio/i,
        );
      },
    );

    it(
      "rejects source-media identity that does not match the admitted composition source",
      () => {
        const sourceMedia =
          Object.freeze({
            ...createSourceMedia(
              true,
            ),

            sourceVideoPath:
              `${MEDIA_ROOT}/generated-video/EP02/S02/other.mp4`,
          }) as
            CompositionSourceMediaMetadata;

        expect(
          () =>
            buildDialogueCompositionShotNormalizationPlan({
              mediaRoot:
                MEDIA_ROOT,

              episodeId:
                "EP02",

              shot:
                createShot(
                  true,
                ),

              sourceMedia,

              postProduction,

              dialogueAudio:
                createAudioPlan({
                  sourceNativeAudio:
                    true,
                }),
            }),
        ).toThrow(
          /source-media path|source.*match/i,
        );
      },
    );
  },
);
