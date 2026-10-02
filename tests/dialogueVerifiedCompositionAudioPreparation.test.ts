import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  DialogueCompositionAudioPlan,
} from "../src/dialogue/buildDialogueCompositionAudioPlan.js";

import type {
  DialoguePlacementPlan,
} from "../src/dialogue/buildDialoguePlacementPlan.js";

import type {
  ShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import type {
  VerifiedShotDialogueTiming,
} from "../src/dialogue/verifyShotDialogueTiming.js";

import {
  prepareVerifiedDialogueCompositionAudioPlan,
} from "../src/dialogue/prepareVerifiedDialogueCompositionAudioPlan.js";

const mediaRoot =
  "D:/Busybookie/Production";

const ffprobeExecutable =
  "D:/Tools/ffmpeg/bin/ffprobe.exe";

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

          characterId:
            "OLLIE",

          characterName:
            "Ollie",

          text:
            "Look what I found!",

          deliveryNotes:
            "Curious, excited and gentle.",

          voice:
            Object.freeze({
              provider:
                "RUNWAY",

              voiceName:
                "Chad",

              deliveryTraits:
                Object.freeze([
                  "young",
                  "curious",
                  "warm",
                  "friendly",
                  "natural",
                ]),
            }),
        }),
      ]),

    planKey:
      "a".repeat(
        64,
      ),
  }) as ShotDialoguePlan;

const verifiedTiming =
  Object.freeze({
    schemaVersion:
      "1.0",

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    planKey:
      dialoguePlan.planKey,

    shotDurationSeconds:
      6,

    durationToleranceSeconds:
      0.000001,

    totalSpeechDurationSeconds:
      1.5,

    remainingDurationSeconds:
      4.5,

    lines:
      Object.freeze([
        Object.freeze({
          lineNumber:
            1,

          dialogueLineId:
            "EP02_SC01_S02_L01",

          sourceAudioPath:
            `${mediaRoot}/voices/EP02/S02/EP02_SC01_S02_L01/verified.audio`,

          sourceBytes:
            12345,

          sourceSha256:
            "b".repeat(
              64,
            ),

          durationSeconds:
            1.5,
        }),
      ]),
  }) as VerifiedShotDialogueTiming;

const placementPlan =
  Object.freeze({
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
      dialoguePlan.planKey,

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
            verifiedTiming.lines[0]!
              .sourceAudioPath,

          sourceBytes:
            verifiedTiming.lines[0]!
              .sourceBytes,

          sourceSha256:
            verifiedTiming.lines[0]!
              .sourceSha256,

          startSeconds:
            0.5,

          durationSeconds:
            1.5,

          endSeconds:
            2,
        }),
      ]),
  }) as DialoguePlacementPlan;

const compositionAudioPlan =
  Object.freeze({
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

    dialoguePlanKey:
      dialoguePlan.planKey,

    shotDurationSeconds:
      6,

    sourceNativeAudio:
      true,

    sourceAudioDisposition:
      "DISCARD_NATIVE_AUDIO",

    lines:
      placementPlan.lines,

    audioKey:
      "c".repeat(
        64,
      ),
  }) as DialogueCompositionAudioPlan;

describe(
  "Busybookie verified dialogue composition-audio preparation",
  () => {
    it(
      "derives composition audio only from verified durable timing evidence plus explicit caller placement starts",
      async () => {
        const verifyAudioTiming =
          vi.fn(
            async () =>
              verifiedTiming,
          );

        const buildPlacementPlan =
          vi.fn(
            () =>
              placementPlan,
          );

        const buildAudioPlan =
          vi.fn(
            () =>
              compositionAudioPlan,
          );

        const placements =
          Object.freeze([
            Object.freeze({
              dialogueLineId:
                "EP02_SC01_S02_L01",

              startSeconds:
                0.5,
            }),
          ]);

        const result =
          await prepareVerifiedDialogueCompositionAudioPlan(
            {
              mediaRoot,

              ffprobeExecutable,

              dialoguePlan,

              placements,
            },
            {
              verifyAudioTiming:
                verifyAudioTiming as never,

              buildPlacementPlan:
                buildPlacementPlan as never,

              buildAudioPlan:
                buildAudioPlan as never,
            },
          );

        expect(
          verifyAudioTiming,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          verifyAudioTiming,
        ).toHaveBeenCalledWith({
          mediaRoot,

          ffprobeExecutable,

          plan:
            dialoguePlan,
        });

        expect(
          buildPlacementPlan,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          buildPlacementPlan,
        ).toHaveBeenCalledWith({
          dialoguePlan,

          timing:
            verifiedTiming,

          placements,
        });

        expect(
          buildAudioPlan,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          buildAudioPlan,
        ).toHaveBeenCalledWith({
          dialoguePlan,

          placementPlan,
        });

        expect(
          result,
        ).toBe(
          compositionAudioPlan,
        );
      },
    );
  },
);
