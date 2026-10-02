import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  ShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import type {
  DialogueAudioMetadata,
} from "../src/dialogue/probeDialogueAudio.js";

import type {
  VerifiedCompletedDialogueLineForTiming,
} from "../src/dialogue/verifyCompletedDialogueLineForTiming.js";

import {
  verifyShotDialogueTiming,
} from "../src/dialogue/verifyShotDialogueTiming.js";

const planKey =
  "a".repeat(
    64,
  );

function createPlan(
  shotDurationSeconds:
    number =
      6,
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

    shotDurationSeconds,

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
                ]),
            }),
        }),

        Object.freeze({
          lineNumber:
            2,

          dialogueLineId:
            "EP02_SC01_S02_L02",

          characterId:
            "KACEY",

          characterName:
            "Kacey",

          text:
            "What is it?",

          deliveryNotes:
            "Warm and curious.",

          voice:
            Object.freeze({
              provider:
                "RUNWAY",

              voiceName:
                "Maya",

              deliveryTraits:
                Object.freeze([
                  "young",
                  "warm",
                  "thoughtful",
                ]),
            }),
        }),
      ]),

    planKey,
  });
}

function createVerifiedLine(
  lineNumber:
    number,

  dialogueLineId:
    string,

  options:
    Readonly<{
      evidencePlanKey?:
        string | undefined;

      sourceAudioPath?:
        string;

      sha256?:
        string;
    }> =
      {},
): VerifiedCompletedDialogueLineForTiming {
  const sourceAudioPath =
    options.sourceAudioPath ??
    `D:/Busybookie/Production/voices/EP02/S02/${dialogueLineId}/${dialogueLineId}_RUNWAY_task-${lineNumber}_01.audio`;

  const output =
    Object.freeze({
      outputIndex:
        1,

      destinationPath:
        sourceAudioPath,

      bytes:
        1000 +
        lineNumber,

      sha256:
        options.sha256 ??
        String(
          lineNumber,
        ).repeat(
          64,
        ),

      contentType:
        "audio/mpeg",
    });

  return {
    lifecycleState:
      "COMPLETED",

    reconciliationMode:
      "DURABLE_COMPLETION",

    provider:
      "RUNWAY",

    providerExecutionId:
      `task-${lineNumber}`,

    generationRecord:
      {
        plan: {
          planKey:
            options.evidencePlanKey ??
            planKey,

          episodeId:
            "EP02",

          sceneId:
            "SC01",

          shotId:
            "S02",

          dialogueLineId,

          lineNumber,
        },

        outputs: [
          output,
        ],
      },

    generationRecordPath:
      `D:/Busybookie/Production/voices/EP02/S02/${dialogueLineId}/${dialogueLineId}_RUNWAY_task-${lineNumber}.dialogue-generation.json`,

    completion:
      {},

    completionPath:
      `D:/Busybookie/Production/voices/EP02/S02/${dialogueLineId}/${dialogueLineId}.dialogue-completion.json`,

    output,
  } as unknown as
    VerifiedCompletedDialogueLineForTiming;
}

function createAudioMetadata(
  sourceAudioPath:
    string,

  durationSeconds:
    number,
): DialogueAudioMetadata {
  return Object.freeze({
    sourceAudioPath,

    formatName:
      "mp3",

    durationSeconds,

    audio:
      Object.freeze({
        codecName:
          "mp3",

        profile:
          null,

        sampleRateHz:
          44100,

        channels:
          1,

        channelLayout:
          "mono",
      }),
  });
}

function createLineEvidence(
  lineNumber:
    number,

  dialogueLineId:
    string,

  durationSeconds:
    number,

  options:
    Readonly<{
      evidencePlanKey?:
        string | undefined;

      probedSourceAudioPath?:
        string;
    }> =
      {},
) {
  const verified =
    createVerifiedLine(
      lineNumber,
      dialogueLineId,
      {
        evidencePlanKey:
          options.evidencePlanKey,
      },
    );

  const audio =
    createAudioMetadata(
      options.probedSourceAudioPath ??
        verified.output.destinationPath,
      durationSeconds,
    );

  return Object.freeze({
    verified,

    audio,
  });
}

describe(
  "Busybookie shot dialogue timing",
  () => {
    it(
      "builds deterministic aggregate timing evidence from ordered admitted dialogue audio",
      () => {
        const plan =
          createPlan();

        const result =
          verifyShotDialogueTiming({
            plan,

            lines: [
              createLineEvidence(
                1,
                "EP02_SC01_S02_L01",
                1.5,
              ),

              createLineEvidence(
                2,
                "EP02_SC01_S02_L02",
                2.25,
              ),
            ],
          });

        expect(
          result,
        ).toEqual({
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

          lines: [
            {
              lineNumber:
                1,

              dialogueLineId:
                "EP02_SC01_S02_L01",

              sourceAudioPath:
                expect.stringContaining(
                  "EP02_SC01_S02_L01",
                ),

              sourceBytes:
                1001,

              sourceSha256:
                "1".repeat(
                  64,
                ),

              durationSeconds:
                1.5,
            },

            {
              lineNumber:
                2,

              dialogueLineId:
                "EP02_SC01_S02_L02",

              sourceAudioPath:
                expect.stringContaining(
                  "EP02_SC01_S02_L02",
                ),

              sourceBytes:
                1002,

              sourceSha256:
                "2".repeat(
                  64,
                ),

              durationSeconds:
                2.25,
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
            (line: Readonly<object>) =>
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
      "rejects missing timing evidence for a planned dialogue line",
      () => {
        expect(
          () =>
            verifyShotDialogueTiming({
              plan:
                createPlan(),

              lines: [
                createLineEvidence(
                  1,
                  "EP02_SC01_S02_L01",
                  1.5,
                ),
              ],
            }),
        ).toThrow(
          /every planned dialogue line|evidence count|missing/i,
        );
      },
    );

    it(
      "rejects dialogue evidence supplied out of canonical plan order",
      () => {
        expect(
          () =>
            verifyShotDialogueTiming({
              plan:
                createPlan(),

              lines: [
                createLineEvidence(
                  2,
                  "EP02_SC01_S02_L02",
                  2,
                ),

                createLineEvidence(
                  1,
                  "EP02_SC01_S02_L01",
                  1,
                ),
              ],
            }),
        ).toThrow(
          /order|identity|line/i,
        );
      },
    );

    it(
      "rejects duplicate line evidence instead of silently reusing one line twice",
      () => {
        expect(
          () =>
            verifyShotDialogueTiming({
              plan:
                createPlan(),

              lines: [
                createLineEvidence(
                  1,
                  "EP02_SC01_S02_L01",
                  1,
                ),

                createLineEvidence(
                  1,
                  "EP02_SC01_S02_L01",
                  1,
                ),
              ],
            }),
        ).toThrow(
          /duplicate|order|identity|line/i,
        );
      },
    );

    it(
      "rejects admitted evidence bound to a different dialogue plan key",
      () => {
        expect(
          () =>
            verifyShotDialogueTiming({
              plan:
                createPlan(),

              lines: [
                createLineEvidence(
                  1,
                  "EP02_SC01_S02_L01",
                  1,
                  {
                    evidencePlanKey:
                      "b".repeat(
                        64,
                      ),
                  },
                ),

                createLineEvidence(
                  2,
                  "EP02_SC01_S02_L02",
                  1,
                ),
              ],
            }),
        ).toThrow(
          /planKey|plan key/i,
        );
      },
    );

    it(
      "rejects probe metadata that does not describe the exact admitted audio artifact",
      () => {
        expect(
          () =>
            verifyShotDialogueTiming({
              plan:
                createPlan(),

              lines: [
                createLineEvidence(
                  1,
                  "EP02_SC01_S02_L01",
                  1,
                  {
                    probedSourceAudioPath:
                      "D:/Busybookie/Production/wrong.audio",
                  },
                ),

                createLineEvidence(
                  2,
                  "EP02_SC01_S02_L02",
                  1,
                ),
              ],
            }),
        ).toThrow(
          /audio path|source.*path|admitted/i,
        );
      },
    );

    it.each([
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])(
      "rejects invalid measured dialogue duration %s",
      (
        durationSeconds,
      ) => {
        expect(
          () =>
            verifyShotDialogueTiming({
              plan:
                createPlan(),

              lines: [
                createLineEvidence(
                  1,
                  "EP02_SC01_S02_L01",
                  durationSeconds,
                ),

                createLineEvidence(
                  2,
                  "EP02_SC01_S02_L02",
                  1,
                ),
              ],
            }),
        ).toThrow(
          /positive.*duration|finite.*duration|duration/i,
        );
      },
    );

    it(
      "rejects aggregate speech that exceeds the shot duration beyond numeric tolerance",
      () => {
        expect(
          () =>
            verifyShotDialogueTiming({
              plan:
                createPlan(
                  6,
                ),

              lines: [
                createLineEvidence(
                  1,
                  "EP02_SC01_S02_L01",
                  3,
                ),

                createLineEvidence(
                  2,
                  "EP02_SC01_S02_L02",
                  3.000002,
                ),
              ],
            }),
        ).toThrow(
          /exceeds.*shot duration|speech duration/i,
        );
      },
    );

    it(
      "accepts only floating-point overrun within tolerance and reports zero remaining slack",
      () => {
        const result =
          verifyShotDialogueTiming({
            plan:
              createPlan(
                6,
              ),

            lines: [
              createLineEvidence(
                1,
                "EP02_SC01_S02_L01",
                3,
              ),

              createLineEvidence(
                2,
                "EP02_SC01_S02_L02",
                3.0000005,
              ),
            ],
          });

        expect(
          result.totalSpeechDurationSeconds,
        ).toBeCloseTo(
          6.0000005,
          7,
        );

        expect(
          result.remainingDurationSeconds,
        ).toBe(
          0,
        );
      },
    );
  },
);
