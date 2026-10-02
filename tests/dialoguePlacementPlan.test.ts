import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  ShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import type {
  VerifiedShotDialogueTiming,
} from "../src/dialogue/verifyShotDialogueTiming.js";

import {
  buildDialoguePlacementPlan,
} from "../src/dialogue/buildDialoguePlacementPlan.js";

const planKey =
  "a".repeat(
    64,
  );

const dialoguePlan =
  Object.freeze({
    schemaVersion:
      "1.0",

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    shotDurationSeconds:
      6,

    videoGeneration:
      Object.freeze({
        provider:
          "VEO",

        nativeAudio:
          true,
      }),

    lines:
      Object.freeze([
        Object.freeze({
          lineNumber:
            1,

          dialogueLineId:
            "EP02_SC01_S02_L01",
        }),

        Object.freeze({
          lineNumber:
            2,

          dialogueLineId:
            "EP02_SC01_S02_L02",
        }),
      ]),

    planKey,
  }) as unknown as
    ShotDialoguePlan;

const timing =
  Object.freeze({
    schemaVersion:
      "1.0",

    timingMode:
      "AGGREGATE_ONLY",

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    planKey,

    shotDurationSeconds:
      6,

    durationToleranceSeconds:
      0.000001,

    totalSpeechDurationSeconds:
      3.75,

    remainingDurationSeconds:
      2.25,

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
            "1".repeat(
              64,
            ),

          durationSeconds:
            1.5,
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
            "2".repeat(
              64,
            ),

          durationSeconds:
            2.25,
        }),
      ]),
  }) as VerifiedShotDialogueTiming;

describe(
  "Busybookie dialogue placement plan",
  () => {
    it(
      "builds explicit non-overlapping placements using verified audio identity and duration",
      () => {
        const result =
          buildDialoguePlacementPlan({
            dialoguePlan,

            timing,

            placements: [
              {
                dialogueLineId:
                  "EP02_SC01_S02_L01",

                startSeconds:
                  0.5,
              },

              {
                dialogueLineId:
                  "EP02_SC01_S02_L02",

                startSeconds:
                  2.5,
              },
            ],
          });

        expect(
          result,
        ).toEqual({
          schemaVersion:
            "1.0",

          placementMode:
            "EXPLICIT",

          episodeId:
            "EP02",

          sceneId:
            "SC01",

          shotId:
            "S02",

          dialoguePlanKey:
            planKey,

          shotDurationSeconds:
            6,

          durationToleranceSeconds:
            0.000001,

          lines: [
            {
              lineNumber:
                1,

              dialogueLineId:
                "EP02_SC01_S02_L01",

              sourceAudioPath:
                timing.lines[0]
                  ?.sourceAudioPath,

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
            },

            {
              lineNumber:
                2,

              dialogueLineId:
                "EP02_SC01_S02_L02",

              sourceAudioPath:
                timing.lines[1]
                  ?.sourceAudioPath,

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
            },
          ],
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
            result.lines,
          ),
        ).toBe(
          true,
        );

        expect(
          result.lines.every(
            (
              line:
                Readonly<object>,
            ) =>
              Object.isFrozen(
                line,
              ),
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "rejects missing explicit placement for any planned line",
      () => {
        expect(
          () =>
            buildDialoguePlacementPlan({
              dialoguePlan,

              timing,

              placements: [
                {
                  dialogueLineId:
                    "EP02_SC01_S02_L01",

                  startSeconds:
                    0,
                },
              ],
            }),
        ).toThrow(
          /every.*dialogue line|placement count|missing/i,
        );
      },
    );

    it(
      "rejects placement entries supplied out of canonical dialogue order",
      () => {
        expect(
          () =>
            buildDialoguePlacementPlan({
              dialoguePlan,

              timing,

              placements: [
                {
                  dialogueLineId:
                    "EP02_SC01_S02_L02",

                  startSeconds:
                    2,
                },

                {
                  dialogueLineId:
                    "EP02_SC01_S02_L01",

                  startSeconds:
                    0,
                },
              ],
            }),
        ).toThrow(
          /order|identity|line/i,
        );
      },
    );

    it(
      "rejects duplicate dialogue line placements",
      () => {
        expect(
          () =>
            buildDialoguePlacementPlan({
              dialoguePlan,

              timing,

              placements: [
                {
                  dialogueLineId:
                    "EP02_SC01_S02_L01",

                  startSeconds:
                    0,
                },

                {
                  dialogueLineId:
                    "EP02_SC01_S02_L01",

                  startSeconds:
                    2,
                },
              ],
            }),
        ).toThrow(
          /duplicate|order|identity|line/i,
        );
      },
    );

    it.each([
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])(
      "rejects invalid explicit start time %s",
      (
        startSeconds,
      ) => {
        expect(
          () =>
            buildDialoguePlacementPlan({
              dialoguePlan,

              timing,

              placements: [
                {
                  dialogueLineId:
                    "EP02_SC01_S02_L01",

                  startSeconds,
                },

                {
                  dialogueLineId:
                    "EP02_SC01_S02_L02",

                  startSeconds:
                    2,
                },
              ],
            }),
        ).toThrow(
          /start.*finite|start.*zero|start.*positive|start.*non-negative/i,
        );
      },
    );

    it(
      "rejects dialogue line overlap",
      () => {
        expect(
          () =>
            buildDialoguePlacementPlan({
              dialoguePlan,

              timing,

              placements: [
                {
                  dialogueLineId:
                    "EP02_SC01_S02_L01",

                  startSeconds:
                    0.5,
                },

                {
                  dialogueLineId:
                    "EP02_SC01_S02_L02",

                  startSeconds:
                    1.9,
                },
              ],
            }),
        ).toThrow(
          /overlap/i,
        );
      },
    );

    it(
      "rejects a line ending beyond the shot duration tolerance",
      () => {
        expect(
          () =>
            buildDialoguePlacementPlan({
              dialoguePlan,

              timing,

              placements: [
                {
                  dialogueLineId:
                    "EP02_SC01_S02_L01",

                  startSeconds:
                    0,
                },

                {
                  dialogueLineId:
                    "EP02_SC01_S02_L02",

                  startSeconds:
                    3.750002,
                },
              ],
            }),
        ).toThrow(
          /ends.*shot|shot duration|beyond/i,
        );
      },
    );

    it(
      "accepts only a floating-point end overrun within timing tolerance and clamps the end to the shot duration",
      () => {
        const result =
          buildDialoguePlacementPlan({
            dialoguePlan,

            timing,

            placements: [
              {
                dialogueLineId:
                  "EP02_SC01_S02_L01",

                startSeconds:
                  0,
              },

              {
                dialogueLineId:
                  "EP02_SC01_S02_L02",

                startSeconds:
                  3.7500005,
              },
            ],
          });

        expect(
          result.lines[1]
            ?.endSeconds,
        ).toBe(
          6,
        );
      },
    );

    it(
      "rejects timing evidence bound to a different dialogue plan key",
      () => {
        const mismatchedTiming =
          Object.freeze({
            ...timing,

            planKey:
              "b".repeat(
                64,
              ),
          }) as
            VerifiedShotDialogueTiming;

        expect(
          () =>
            buildDialoguePlacementPlan({
              dialoguePlan,

              timing:
                mismatchedTiming,

              placements: [
                {
                  dialogueLineId:
                    "EP02_SC01_S02_L01",

                  startSeconds:
                    0,
                },

                {
                  dialogueLineId:
                    "EP02_SC01_S02_L02",

                  startSeconds:
                    2,
                },
              ],
            }),
        ).toThrow(
          /planKey|plan key/i,
        );
      },
    );

    it(
      "rejects timing evidence whose line identity/order differs from the dialogue plan",
      () => {
        const mismatchedTiming =
          Object.freeze({
            ...timing,

            lines:
              Object.freeze([
                timing.lines[1],
                timing.lines[0],
              ]),
          }) as
            VerifiedShotDialogueTiming;

        expect(
          () =>
            buildDialoguePlacementPlan({
              dialoguePlan,

              timing:
                mismatchedTiming,

              placements: [
                {
                  dialogueLineId:
                    "EP02_SC01_S02_L01",

                  startSeconds:
                    0,
                },

                {
                  dialogueLineId:
                    "EP02_SC01_S02_L02",

                  startSeconds:
                    2,
                },
              ],
            }),
        ).toThrow(
          /timing.*order|timing.*identity|line/i,
        );
      },
    );
  },
);
