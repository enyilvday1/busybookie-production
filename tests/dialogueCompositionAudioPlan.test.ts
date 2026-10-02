import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  ShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import type {
  DialoguePlacementPlan,
} from "../src/dialogue/buildDialoguePlacementPlan.js";

import {
  buildDialogueCompositionAudioPlan,
} from "../src/dialogue/buildDialogueCompositionAudioPlan.js";

const dialoguePlanKey =
  "a".repeat(
    64,
  );

function createDialoguePlan(
  nativeAudio:
    boolean,
): ShotDialoguePlan {
  return Object.freeze({
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

        nativeAudio,
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

    planKey:
      dialoguePlanKey,
  }) as unknown as
    ShotDialoguePlan;
}

function createPlacementPlan(
  overrides:
    Readonly<{
      dialoguePlanKey?:
        string;

      secondStartSeconds?:
        number;

      secondSourceSha256?:
        string;

      secondSourceAudioPath?:
        string;
    }> =
      {},
): DialoguePlacementPlan {
  const secondStartSeconds =
    overrides.secondStartSeconds ??
    2.5;

  return Object.freeze({
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
      overrides.dialoguePlanKey ??
      dialoguePlanKey,

    shotDurationSeconds:
      6,

    durationToleranceSeconds:
      0.000001,

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
            overrides.secondSourceAudioPath ??
            "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L02/line2.audio",

          sourceBytes:
            1002,

          sourceSha256:
            overrides.secondSourceSha256 ??
            "2".repeat(
              64,
            ),

          startSeconds:
            secondStartSeconds,

          durationSeconds:
            2.25,

          endSeconds:
            secondStartSeconds +
            2.25,
        }),
      ]),
  });
}

describe(
  "Busybookie dialogue composition audio plan",
  () => {
    it.each([
      true,
      false,
    ])(
      "replaces the entire source audio when dialogue is present; source nativeAudio=%s",
      (
        nativeAudio,
      ) => {
        const result =
          buildDialogueCompositionAudioPlan({
            dialoguePlan:
              createDialoguePlan(
                nativeAudio,
              ),

            placementPlan:
              createPlacementPlan(),
          });

        expect(
          result,
        ).toMatchObject({
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
            "S02",

          dialoguePlanKey,

          shotDurationSeconds:
            6,

          sourceNativeAudio:
            nativeAudio,

          sourceAudioDisposition:
            nativeAudio
              ? "DISCARD_NATIVE_AUDIO"
              : "NO_SOURCE_AUDIO",

          lines:
            createPlacementPlan()
              .lines,
        });

        expect(
          result.audioKey,
        ).toMatch(
          /^[a-f0-9]{64}$/,
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
            result.lines,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "rejects a placement plan bound to a different dialogue plan key",
      () => {
        expect(
          () =>
            buildDialogueCompositionAudioPlan({
              dialoguePlan:
                createDialoguePlan(
                  true,
                ),

              placementPlan:
                createPlacementPlan({
                  dialoguePlanKey:
                    "b".repeat(
                      64,
                    ),
                }),
            }),
        ).toThrow(
          /planKey|plan key/i,
        );
      },
    );

    it(
      "rejects placement identity that does not match the dialogue plan",
      () => {
        const placementPlan =
          createPlacementPlan();

        const mismatched =
          Object.freeze({
            ...placementPlan,

            shotId:
              "S03",
          }) as
            DialoguePlacementPlan;

        expect(
          () =>
            buildDialogueCompositionAudioPlan({
              dialoguePlan:
                createDialoguePlan(
                  false,
                ),

              placementPlan:
                mismatched,
            }),
        ).toThrow(
          /identity|shot/i,
        );
      },
    );

    it(
      "rejects placement line identity or order that differs from the dialogue plan",
      () => {
        const placementPlan =
          createPlacementPlan();

        const mismatched =
          Object.freeze({
            ...placementPlan,

            lines:
              Object.freeze([
                placementPlan.lines[1],
                placementPlan.lines[0],
              ]),
          }) as
            DialoguePlacementPlan;

        expect(
          () =>
            buildDialogueCompositionAudioPlan({
              dialoguePlan:
                createDialoguePlan(
                  true,
                ),

              placementPlan:
                mismatched,
            }),
        ).toThrow(
          /order|identity|line/i,
        );
      },
    );

    it(
      "changes audioKey when an explicit dialogue start time changes",
      () => {
        const first =
          buildDialogueCompositionAudioPlan({
            dialoguePlan:
              createDialoguePlan(
                true,
              ),

            placementPlan:
              createPlacementPlan({
                secondStartSeconds:
                  2.5,
              }),
          });

        const second =
          buildDialogueCompositionAudioPlan({
            dialoguePlan:
              createDialoguePlan(
                true,
              ),

            placementPlan:
              createPlacementPlan({
                secondStartSeconds:
                  2.75,
              }),
          });

        expect(
          first.audioKey,
        ).not.toBe(
          second.audioKey,
        );
      },
    );

    it(
      "changes audioKey when a verified dialogue source SHA changes",
      () => {
        const first =
          buildDialogueCompositionAudioPlan({
            dialoguePlan:
              createDialoguePlan(
                true,
              ),

            placementPlan:
              createPlacementPlan(),
          });

        const second =
          buildDialogueCompositionAudioPlan({
            dialoguePlan:
              createDialoguePlan(
                true,
              ),

            placementPlan:
              createPlacementPlan({
                secondSourceSha256:
                  "3".repeat(
                    64,
                  ),
              }),
          });

        expect(
          first.audioKey,
        ).not.toBe(
          second.audioKey,
        );
      },
    );

    it(
      "changes audioKey when the source native-audio disposition changes",
      () => {
        const native =
          buildDialogueCompositionAudioPlan({
            dialoguePlan:
              createDialoguePlan(
                true,
              ),

            placementPlan:
              createPlacementPlan(),
          });

        const noNative =
          buildDialogueCompositionAudioPlan({
            dialoguePlan:
              createDialoguePlan(
                false,
              ),

            placementPlan:
              createPlacementPlan(),
          });

        expect(
          native.audioKey,
        ).not.toBe(
          noNative.audioKey,
        );
      },
    );
    it(
      "keeps audioKey stable when verified dialogue content moves to a different absolute path",
      () => {
        const first =
          buildDialogueCompositionAudioPlan({
            dialoguePlan:
              createDialoguePlan(
                true,
              ),

            placementPlan:
              createPlacementPlan(),
          });

        const relocated =
          buildDialogueCompositionAudioPlan({
            dialoguePlan:
              createDialoguePlan(
                true,
              ),

            placementPlan:
              createPlacementPlan({
                secondSourceAudioPath:
                  "E:/Busybookie/Relocated/voices/EP02/S02/EP02_SC01_S02_L02/line2.audio",
              }),
          });

        expect(
          relocated.lines[1]?.sourceAudioPath,
        ).not.toBe(
          first.lines[1]?.sourceAudioPath,
        );

        expect(
          relocated.lines[1]?.sourceBytes,
        ).toBe(
          first.lines[1]?.sourceBytes,
        );

        expect(
          relocated.lines[1]?.sourceSha256,
        ).toBe(
          first.lines[1]?.sourceSha256,
        );

        expect(
          relocated.audioKey,
        ).toBe(
          first.audioKey,
        );
      },
    );

  },
);
