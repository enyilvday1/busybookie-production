import {
  describe,
  expect,
  it,
} from "vitest";

import {
  verifyEpisodeRoughCutOutput,
} from "../src/composition/verifyEpisodeRoughCutOutput.js";

import type {
  EpisodeRoughCutRenderPlan,
} from "../src/composition/buildEpisodeRoughCutRenderPlan.js";

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
      "Verifier contract episode",

    totalShots:
      2,

    totalDurationSeconds:
      8,

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
            "D:/Busybookie/Production/cache/composition-normalized/EP02/S01/a.mp4",

          sourceBytes:
            2_001,

          sourceSha256:
            "c".repeat(
              64,
            ),
        }),

        Object.freeze({
          sceneId:
            "SC01",

          shotId:
            "S02",

          order:
            2,

          title:
            "Shot S02",

          durationSeconds:
            4,

          sourceVideoPath:
            "D:/Busybookie/Production/cache/composition-normalized/EP02/S02/b.mp4",

          sourceBytes:
            2_002,

          sourceSha256:
            "d".repeat(
              64,
            ),
        }),
      ]),
  });
}

function createValidOutput():
  CompositionSourceMediaMetadata {
  return Object.freeze({
    sourceVideoPath:
      "D:/Busybookie/Production/exports/EP02/rough-cut/output.mp4.part-test",

    formatName:
      "mov,mp4,m4a,3gp,3g2,mj2",

    durationSeconds:
      8,

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
  "Busybookie episode rough-cut output verification",
  () => {
    it(
      "accepts output that satisfies the exact rough-cut master contract",
      () => {
        const result =
          verifyEpisodeRoughCutOutput({
            plan:
              createPlan(),

            outputMedia:
              createValidOutput(),
          });

        expect(
          result,
        ).toEqual({
          outputPath:
            "D:/Busybookie/Production/exports/EP02/rough-cut/output.mp4.part-test",

          durationSeconds:
            8,

          durationToleranceSeconds:
            1 / 25,
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

    it(
      "accepts a one-frame duration difference",
      () => {
        const outputMedia =
          Object.freeze({
            ...createValidOutput(),

            durationSeconds:
              8.04,
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyEpisodeRoughCutOutput({
              plan:
                createPlan(),

              outputMedia,
            }),
        ).not.toThrow();
      },
    );

    it(
      "fails closed when output duration differs by more than one frame",
      () => {
        const outputMedia =
          Object.freeze({
            ...createValidOutput(),

            durationSeconds:
              8.05,
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyEpisodeRoughCutOutput({
              plan:
                createPlan(),

              outputMedia,
            }),
        ).toThrow(
          /duration.*more than one.*frame/i,
        );
      },
    );

    it(
      "fails closed when the output video profile is not H.264 High",
      () => {
        const valid =
          createValidOutput();

        const outputMedia =
          Object.freeze({
            ...valid,

            video:
              Object.freeze({
                ...valid.video,

                profile:
                  "Main",
              }),
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyEpisodeRoughCutOutput({
              plan:
                createPlan(),

              outputMedia,
            }),
        ).toThrow(
          /high profile|profile/i,
        );
      },
    );

    it(
      "fails closed when output audio is absent",
      () => {
        const outputMedia =
          Object.freeze({
            ...createValidOutput(),

            audio:
              null,
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyEpisodeRoughCutOutput({
              plan:
                createPlan(),

              outputMedia,
            }),
        ).toThrow(
          /audio/i,
        );
      },
    );

    it(
      "fails closed when the master geometry is wrong",
      () => {
        const valid =
          createValidOutput();

        const outputMedia =
          Object.freeze({
            ...valid,

            video:
              Object.freeze({
                ...valid.video,

                width:
                  1280,
              }),
          }) satisfies
            CompositionSourceMediaMetadata;

        expect(
          () =>
            verifyEpisodeRoughCutOutput({
              plan:
                createPlan(),

              outputMedia,
            }),
        ).toThrow(
          /dimensions|geometry|width/i,
        );
      },
    );
  },
);
