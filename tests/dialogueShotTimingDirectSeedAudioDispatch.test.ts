import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  ShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import {
  verifyShotDialogueAudioTiming,
} from "../src/dialogue/verifyShotDialogueAudioTiming.js";

const MEDIA_ROOT =
  "D:/Busybookie/Production";

const PLAN_KEY =
  "3f94f116370e8b91036ce01d1122ccafcdd3d7ba84379f9a4b36db7113356a57";

const TASK_ID =
  "1c2664f3-2375-4bbc-8681-85b914d26883";

const OUTPUT_PATH =
  `${MEDIA_ROOT}/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_${TASK_ID}_01.audio`;

const plan =
  Object.freeze({
    schemaVersion:
      "2.0",

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
              selectionStatus:
                "LOCKED",

              provider:
                "RUNWAY",

              voiceName:
                "Ollie",

              deliveryTraits:
                Object.freeze([
                  "young",
                  "curious",
                  "warm",
                  "friendly",
                  "natural",
                ]),

              executionMode:
                "RUNWAY_REFERENCE_AUDIO",

              referenceAudio:
                Object.freeze({
                  assetId:
                    "OLLIE_VOICE_REFERENCE_V1",

                  mediaRootRelativePath:
                    "references/voices/OLLIE/ollie-reference-v1.mp3",

                  bytes:
                    231_593,

                  sha256:
                    "ad7bc6a50675bddc74a4885f290667fad1076c5cd3d9844eb7ff2d84b0f94a2f",

                  contentType:
                    "audio/mpeg",

                  durationSeconds:
                    14.4,

                  codecName:
                    "mp3",

                  sampleRateHz:
                    44_100,

                  channels:
                    1,
                }),
            }),
        }),
      ]),

    planKey:
      PLAN_KEY,
  }) as unknown as
    ShotDialoguePlan;

describe(
  "BusyBookie shot timing direct SeedAudio dispatch",
  () => {
    it(
      "routes RUNWAY_REFERENCE_AUDIO lines through plan-scoped SeedAudio timing admission",
      async () => {
        const legacyVerifyLine =
          vi.fn(
            async () => {
              throw new Error(
                "Legacy singleton timing verifier must not handle a direct SeedAudio line.",
              );
            },
          );

        const directVerified =
          Object.freeze({
            lifecycleState:
              "COMPLETED",

            reconciliationMode:
              "DURABLE_COMPLETION",

            provider:
              "RUNWAY",

            providerExecutionId:
              TASK_ID,

            generationRecord:
              Object.freeze({
                plan:
                  Object.freeze({
                    planKey:
                      PLAN_KEY,

                    dialogueLineId:
                      "EP02_SC01_S02_L01",
                  }),

                outputs:
                  Object.freeze([
                    Object.freeze({
                      outputIndex:
                        1,

                      destinationPath:
                        OUTPUT_PATH,

                      bytes:
                        58_976,

                      sha256:
                        "e7207b0b6287c92551e10b21c9101b00edfc9a54246a104327d59047c324098a",

                      contentType:
                        "audio/mpeg",
                    }),
                  ]),
              }),

            output:
              Object.freeze({
                outputIndex:
                  1,

                destinationPath:
                  OUTPUT_PATH,

                bytes:
                  58_976,

                sha256:
                  "e7207b0b6287c92551e10b21c9101b00edfc9a54246a104327d59047c324098a",

                contentType:
                  "audio/mpeg",
              }),
          });

        const directVerifyLine =
          vi.fn(
            async (
              input:
                Readonly<{
                  mediaRoot:
                    string;

                  episodeId:
                    string;

                  sceneId:
                    string;

                  shotId:
                    string;

                  dialogueLineId:
                    string;

                  planKey:
                    string;
                }>,
            ) => {
              expect(
                input,
              ).toEqual({
                mediaRoot:
                  MEDIA_ROOT,

                episodeId:
                  "EP02",

                sceneId:
                  "SC01",

                shotId:
                  "S02",

                dialogueLineId:
                  "EP02_SC01_S02_L01",

                planKey:
                  PLAN_KEY,
              });

              return directVerified;
            },
          );

        const probeAudio =
          vi.fn(
            async (
              input:
                Readonly<{
                  ffprobeExecutable:
                    string;

                  sourceAudioPath:
                    string;
                }>,
            ) => {
              expect(
                input.sourceAudioPath,
              ).toBe(
                OUTPUT_PATH,
              );

              return Object.freeze({
                sourceAudioPath:
                  OUTPUT_PATH,

                formatName:
                  "mp3",

                durationSeconds:
                  3.63102,

                audio:
                  Object.freeze({
                    codecName:
                      "mp3",

                    profile:
                      null,

                    sampleRateHz:
                      44_100,

                    channels:
                      2,

                    channelLayout:
                      "stereo",
                  }),
              });
            },
          );

        const expectedTiming =
          Object.freeze({
            marker:
              "verified-direct-seed-audio-timing",
          });

        const verifyTiming =
          vi.fn(
            (
              input:
                Readonly<{
                  plan:
                    ShotDialoguePlan;

                  lines:
                    readonly Readonly<{
                      verified:
                        unknown;

                      audio:
                        unknown;
                    }>[];
                }>,
            ) => {
              expect(
                input.plan,
              ).toBe(
                plan,
              );

              expect(
                input.lines,
              ).toHaveLength(
                1,
              );

              expect(
                input.lines[0]
                  ?.verified,
              ).toBe(
                directVerified,
              );

              return expectedTiming;
            },
          );

        const result =
          await verifyShotDialogueAudioTiming(
            {
              mediaRoot:
                MEDIA_ROOT,

              ffprobeExecutable:
                "C:/Tools/ffprobe.exe",

              plan,
            },
            {
              verifyLine:
                legacyVerifyLine,

              verifyDirectSeedAudioLine:
                directVerifyLine,

              probeAudio,

              verifyTiming,
            } as never,
          );

        expect(
          directVerifyLine,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          legacyVerifyLine,
        ).not.toHaveBeenCalled();

        expect(
          probeAudio,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          verifyTiming,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result,
        ).toBe(
          expectedTiming,
        );
      },
    );
  },
);

describe(
  "BusyBookie direct SeedAudio shot-timing fail-closed dispatch",
  () => {
    const input = Object.freeze({
      mediaRoot: MEDIA_ROOT,
      ffprobeExecutable: "C:/Tools/ffprobe.exe",
      plan,
    });

    function createBlockedDownstream() {
      return {
        verifyLine: vi.fn(async () => {
          throw new Error(
            "Legacy singleton admission must not handle this reference-audio line.",
          );
        }),

        probeAudio: vi.fn(async () => {
          throw new Error(
            "Audio probing must not run after failed timing admission.",
          );
        }),

        verifyTiming: vi.fn(() => {
          throw new Error(
            "Aggregate timing must not run after failed line admission.",
          );
        }),
      };
    }

    function expectNoDownstreamCalls(
      dependencies: ReturnType<typeof createBlockedDownstream>,
    ): void {
      expect(dependencies.verifyLine).not.toHaveBeenCalled();
      expect(dependencies.probeAudio).not.toHaveBeenCalled();
      expect(dependencies.verifyTiming).not.toHaveBeenCalled();
    }

    it(
      "rejects a missing direct verifier without legacy fallback, probing, or aggregate timing",
      async () => {
        // Deliberately omit the optional direct verifier.
        const dependencies = createBlockedDownstream() satisfies
          NonNullable<
            Parameters<typeof verifyShotDialogueAudioTiming>[1]
          >;

        await expect(
          verifyShotDialogueAudioTiming(input, dependencies),
        ).rejects.toThrow(
          /requires plan-scoped direct SeedAudio timing admission/i,
        );

        expectNoDownstreamCalls(dependencies);
      },
    );

    it(
      "propagates direct admission failure unchanged without legacy fallback or downstream work",
      async () => {
        const admissionError = new Error(
          "Selected plan-scoped SeedAudio completion could not be verified.",
        );

        const blocked = createBlockedDownstream();

        const verifyDirectSeedAudioLine = vi.fn(async () => {
          throw admissionError;
        });

        const dependencies = {
          ...blocked,
          verifyDirectSeedAudioLine,
        } satisfies NonNullable<
          Parameters<typeof verifyShotDialogueAudioTiming>[1]
        >;

        await expect(
          verifyShotDialogueAudioTiming(input, dependencies),
        ).rejects.toBe(admissionError);

        expect(verifyDirectSeedAudioLine).toHaveBeenCalledTimes(1);

        expect(verifyDirectSeedAudioLine).toHaveBeenCalledWith({
          mediaRoot: MEDIA_ROOT,
          episodeId: "EP02",
          sceneId: "SC01",
          shotId: "S02",
          dialogueLineId: "EP02_SC01_S02_L01",
          planKey: PLAN_KEY,
        });

        expectNoDownstreamCalls(blocked);
      },
    );
  },
);
