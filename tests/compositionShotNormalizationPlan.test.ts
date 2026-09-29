import {
  createHash,
} from "node:crypto";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildCompositionShotNormalizationPlan,
} from "../src/composition/buildCompositionShotNormalizationPlan.js";

import type {
  EpisodeCompositionPlanShot,
} from "../src/composition/buildEpisodeCompositionPlan.js";

import type {
  CompositionSourceMediaMetadata,
} from "../src/composition/probeCompositionSourceMedia.js";

describe(
  "Busybookie composition shot normalization plan",
  () => {
    it(
      "builds a deterministic master-normalization plan for the real Runway source shape",
      () => {
        const mediaRoot =
          "D:/Busybookie/Production";

        const shot =
          Object.freeze({
            sceneId:
              "SC01",

            shotId:
              "S01",

            order:
              1,

            title:
              "Littleleaf Valley gentle establishing motion",

            durationSeconds:
              5,

            nativeAudio:
              false,

            provider:
              "RUNWAY",

            providerExecutionId:
              "ab297ae3-b36b-47ed-a339-8dc574b8f17c",

            sourceVideoPath:
              "D:/Busybookie/Production/generated-video/EP90/S01/EP90_S01_ab297ae3-b36b-47ed-a339-8dc574b8f17c_01.mp4",

            sourceBytes:
              8859089,

            sourceSha256:
              "1f2d3cb765ba2ff0379af6d1ad9a34901a8a1b2153cad45875da3a3c072ff982",

            sourceContentType:
              "video/mp4",
          }) satisfies
            EpisodeCompositionPlanShot;

        const sourceMedia =
          Object.freeze({
            sourceVideoPath:
              shot.sourceVideoPath,

            formatName:
              "mov,mp4,m4a,3gp,3g2,mj2",

            durationSeconds:
              5.041667,

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
              null,
          }) satisfies
            CompositionSourceMediaMetadata;

        const postProduction =
          Object.freeze({
            aspectRatio:
              "16:9" as const,

            width:
              1920,

            height:
              1080,

            timelineFps:
              25,

            audioSampleRateHz:
              48000,
          });

        const first =
          buildCompositionShotNormalizationPlan({
            mediaRoot,

            episodeId:
              "EP90",

            shot,

            sourceMedia,

            postProduction,
          });

        const second =
          buildCompositionShotNormalizationPlan({
            mediaRoot,

            episodeId:
              "EP90",

            shot,

            sourceMedia,

            postProduction,
          });

        expect(first).toMatchObject({
          schemaVersion:
            "1.0",

          profileId:
            "busybookie-master-normalization-v1",

          episodeId:
            "EP90",

          shotId:
            "S01",

          sourceVideoPath:
            shot.sourceVideoPath,

          sourceSha256:
            shot.sourceSha256,

          sourceDurationSeconds:
            5.041667,

          targetDurationSeconds:
            5,

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
        });

        expect(
          first.durationToleranceSeconds,
        ).toBeCloseTo(
          1 / 24,
          8,
        );

        const expectedCacheIdentity =
          [
            "busybookie-master-normalization-v1",
            "EP90",
            "S01",
            shot.sourceSha256,
            "5",
            "synthetic-silence",
            "1920x1080@25",
            "48000",
          ].join(
            "\n",
          );

        const expectedCacheKey =
          createHash(
            "sha256",
          )
            .update(
              expectedCacheIdentity,
              "utf8",
            )
            .digest(
              "hex",
            );

        expect(
          first.cacheKey,
        ).toBe(
          expectedCacheKey,
        );

        expect(
          first.outputPath
            .replaceAll(
              "\\",
              "/",
            ),
        ).toBe(
          `${mediaRoot}/cache/composition-normalized/EP90/S01/EP90_S01_${expectedCacheKey}.mp4`,
        );

        expect(
          second,
        ).toEqual(
          first,
        );

        expect(
          Object.isFrozen(
            first,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            first.video,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            first.audio,
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);

describe(
  "Busybookie composition shot normalization duration admission",
  () => {
    it(
      "fails closed when source duration differs from manifest duration by more than one source frame",
      () => {
        const shot =
          Object.freeze({
            sceneId:
              "SC01",

            shotId:
              "S01",

            order:
              1,

            title:
              "Duration mismatch",

            durationSeconds:
              5,

            nativeAudio:
              false,

            provider:
              "RUNWAY",

            providerExecutionId:
              "task-duration-mismatch",

            sourceVideoPath:
              "D:/Busybookie/Production/generated-video/EP90/S01/source.mp4",

            sourceBytes:
              1000,

            sourceSha256:
              "a".repeat(
                64,
              ),

            sourceContentType:
              "video/mp4",
          }) satisfies
            EpisodeCompositionPlanShot;

        const sourceMedia =
          Object.freeze({
            sourceVideoPath:
              shot.sourceVideoPath,

            formatName:
              "mov,mp4,m4a,3gp,3g2,mj2",

            durationSeconds:
              5.25,

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
              null,
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            buildCompositionShotNormalizationPlan({
              mediaRoot:
                "D:/Busybookie/Production",

              episodeId:
                "EP90",

              shot,

              sourceMedia,

              postProduction:
                Object.freeze({
                  aspectRatio:
                    "16:9" as const,

                  width:
                    1920,

                  height:
                    1080,

                  timelineFps:
                    25,

                  audioSampleRateHz:
                    48000,
                }),
            }),
        ).toThrow(
          /duration.*more than one source frame/i,
        );
      },
    );
  },
);

describe(
  "Busybookie composition shot normalization native audio",
  () => {
    it(
      "preserves admitted native audio intent for the real Veo source shape",
      () => {
        const mediaRoot =
          "D:/Busybookie/Production";

        const shot =
          Object.freeze({
            sceneId:
              "SC01",

            shotId:
              "S01",

            order:
              1,

            title:
              "Littleleaf Valley gentle motion with ambience",

            durationSeconds:
              4,

            nativeAudio:
              true,

            provider:
              "VEO",

            providerExecutionId:
              "models/veo-3.1-fast-generate-preview/operations/6fyqkhhf9fj5",

            sourceVideoPath:
              "D:/Busybookie/Production/generated-video/EP91/S01/EP91_S01_6fyqkhhf9fj5_01.mp4",

            sourceBytes:
              4511709,

            sourceSha256:
              "e68af876046f62a60dcd5efeb2eecf54c2d395efcce594b4b81b8635afc931aa",

            sourceContentType:
              null,
          }) satisfies
            EpisodeCompositionPlanShot;

        const sourceMedia =
          Object.freeze({
            sourceVideoPath:
              shot.sourceVideoPath,

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
                  1280,

                height:
                  720,

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
          }) satisfies
            CompositionSourceMediaMetadata;

        const result =
          buildCompositionShotNormalizationPlan({
            mediaRoot,

            episodeId:
              "EP91",

            shot,

            sourceMedia,

            postProduction:
              Object.freeze({
                aspectRatio:
                  "16:9" as const,

                width:
                  1920,

                height:
                  1080,

                timelineFps:
                  25,

                audioSampleRateHz:
                  48000,
              }),
          });

        expect(
          result.nativeAudio,
        ).toBe(
          true,
        );

        expect(
          result.audio,
        ).toEqual({
          mode:
            "PRESERVE_NATIVE",

          codecName:
            "aac",

          sampleRateHz:
            48000,

          channels:
            2,

          channelLayout:
            "stereo",
        });

        expect(
          result.sourceDurationSeconds,
        ).toBe(
          4,
        );

        expect(
          result.targetDurationSeconds,
        ).toBe(
          4,
        );

        expect(
          result.outputPath
            .replaceAll(
              "\\",
              "/",
            ),
        ).toMatch(
          /^D:\/Busybookie\/Production\/cache\/composition-normalized\/EP91\/S01\/EP91_S01_[a-f0-9]{64}\.mp4$/,
        );

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
      },
    );
  },
);
