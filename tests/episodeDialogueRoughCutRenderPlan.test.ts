import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildEpisodeRoughCutRenderPlan,
} from "../src/composition/buildEpisodeRoughCutRenderPlan.js";

import type {
  PreparedEpisodeComposition,
  PreparedEpisodeCompositionShot,
} from "../src/composition/prepareEpisodeComposition.js";

import type {
  ProductionRules,
} from "../src/schemas/productionRules.schema.js";

const MEDIA_ROOT =
  "D:/Busybookie/Production";

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

function makeDialogueV2PreparedShot():
  PreparedEpisodeCompositionShot {
  const sourceVideoPath =
    `${MEDIA_ROOT}/generated-video/EP02/S01/EP02_S01_01.mp4`;

  const outputPath =
    `${MEDIA_ROOT}/cache/composition-normalized/EP02/S01/EP02_S01_${"d".repeat(
      64,
    )}.mp4`;

  return Object.freeze({
    sceneId:
      "SC01",

    shotId:
      "S01",

    order:
      1,

    title:
      "Dialogue shot",

    durationSeconds:
      4,

    nativeAudio:
      true,

    provider:
      "VEO",

    providerExecutionId:
      "operations/dialogue-shot",

    sourceVideoPath,

    sourceBytes:
      1_001,

    sourceSha256:
      "1".repeat(
        64,
      ),

    sourceContentType:
      "video/mp4",

    normalizationPlan:
      Object.freeze({
        schemaVersion:
          "2.0",

        profileId:
          "busybookie-master-normalization-v2-dialogue",

        episodeId:
          "EP02",

        sceneId:
          "SC01",

        shotId:
          "S01",

        sourceVideoPath,

        sourceSha256:
          "1".repeat(
            64,
          ),

        sourceDurationSeconds:
          4,

        targetDurationSeconds:
          4,

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
              "a".repeat(
                64,
              ),

            audioKey:
              "b".repeat(
                64,
              ),

            lines:
              Object.freeze([
                Object.freeze({
                  lineNumber:
                    1,

                  dialogueLineId:
                    "EP02_SC01_S01_L01",

                  sourceAudioPath:
                    `${MEDIA_ROOT}/voices/EP02/S01/EP02_SC01_S01_L01/line.audio`,

                  sourceBytes:
                    12_345,

                  sourceSha256:
                    "c".repeat(
                      64,
                    ),

                  startSeconds:
                    0.5,

                  durationSeconds:
                    1.5,

                  endSeconds:
                    2,
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
          "d".repeat(
            64,
          ),

        outputPath,
      }),

    normalizationCacheStatus:
      "HIT",

    normalizedArtifact:
      Object.freeze({
        outputPath,

        bytes:
          2_001,

        sha256:
          "e".repeat(
            64,
          ),

        contentType:
          "video/mp4",

        durationSeconds:
          4,

        durationToleranceSeconds:
          1 / 25,
      }),
  });
}

function makePreparedComposition(
  shot:
    PreparedEpisodeCompositionShot,
): PreparedEpisodeComposition {
  return Object.freeze({
    episodeId:
      "EP02",

    title:
      "Dialogue rough-cut episode",

    totalShots:
      1,

    totalDurationSeconds:
      4,

    shots:
      Object.freeze([
        shot,
      ]),
  });
}

describe(
  "Busybookie dialogue-v2 rough-cut render planning",
  () => {
    it(
      "accepts the explicitly trusted dialogue-v2 normalization profile while preserving the master-media contract",
      () => {
        const shot =
          makeDialogueV2PreparedShot();

        const result =
          buildEpisodeRoughCutRenderPlan({
            mediaRoot:
              MEDIA_ROOT,

            preparedComposition:
              makePreparedComposition(
                shot,
              ),

            postProduction,
          });

        expect(
          result.schemaVersion,
        ).toBe(
          "1.0",
        );

        expect(
          result.profileId,
        ).toBe(
          "busybookie-episode-rough-cut-v1",
        );

        expect(
          result.shots,
        ).toEqual([
          {
            sceneId:
              "SC01",

            shotId:
              "S01",

            order:
              1,

            title:
              "Dialogue shot",

            durationSeconds:
              4,

            sourceVideoPath:
              shot.normalizedArtifact
                .outputPath,

            sourceBytes:
              2_001,

            sourceSha256:
              "e".repeat(
                64,
              ),
          },
        ]);
      },
    );

    it(
      "still rejects an unrecognised normalization schema/profile pair",
      () => {
        const trustedShot =
          makeDialogueV2PreparedShot();

        const untrustedShot =
          Object.freeze({
            ...trustedShot,

            normalizationPlan:
              Object.freeze({
                ...trustedShot
                  .normalizationPlan,

                schemaVersion:
                  "9.0",

                profileId:
                  "busybookie-master-normalization-v999",
              }),
          }) as unknown as
            PreparedEpisodeCompositionShot;

        expect(
          () =>
            buildEpisodeRoughCutRenderPlan({
              mediaRoot:
                MEDIA_ROOT,

              preparedComposition:
                makePreparedComposition(
                  untrustedShot,
                ),

              postProduction,
            }),
        ).toThrow(
          "Episode rough-cut render planning requires trusted normalization profile busybookie-master-normalization-v1 or busybookie-master-normalization-v2-dialogue for EP02/S01.",
        );
      },
    );
  },
);
