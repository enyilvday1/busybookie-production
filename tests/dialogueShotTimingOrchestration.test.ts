import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  ShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import type {
  DialogueAudioMetadata,
  DialogueAudioProbeInput,
} from "../src/dialogue/probeDialogueAudio.js";

import type {
  VerifiedCompletedDialogueLineForTiming,
  VerifyCompletedDialogueLineForTimingInput,
} from "../src/dialogue/verifyCompletedDialogueLineForTiming.js";

import type {
  VerifiedShotDialogueTiming,
  VerifyShotDialogueTimingInput,
} from "../src/dialogue/verifyShotDialogueTiming.js";

import {
  verifyShotDialogueAudioTiming,
} from "../src/dialogue/verifyShotDialogueAudioTiming.js";

const mediaRoot =
  "D:/Busybookie/Production";

const ffprobeExecutable =
  "D:/Tools/ffmpeg/bin/ffprobe.exe";

const planKey =
  "a".repeat(
    64,
  );

const plan = Object.freeze({
  schemaVersion: "1.0" as const,
  episodeId: "EP02",
  sceneId: "SC01",
  shotId: "S02",
  shotDurationSeconds: 6,

  videoGeneration: Object.freeze({
    provider: "VEO" as const,
    nativeAudio: true,
  }),

  // Synthetic preset-voice fixtures, not a change to Ollie's production voice.
  lines: Object.freeze([
    Object.freeze({
      lineNumber: 1,
      dialogueLineId: "EP02_SC01_S02_L01",
      characterId: "OLLIE" as const,
      characterName: "Ollie",
      text: "First legacy timing test line.",
      deliveryNotes: null,

      voice: Object.freeze({
        provider: "RUNWAY" as const,
        voiceName: "Chad",
        deliveryTraits: Object.freeze(["warm", "friendly"]),
      }),
    }),

    Object.freeze({
      lineNumber: 2,
      dialogueLineId: "EP02_SC01_S02_L02",
      characterId: "OLLIE" as const,
      characterName: "Ollie",
      text: "Second legacy timing test line.",
      deliveryNotes: null,

      voice: Object.freeze({
        provider: "RUNWAY" as const,
        voiceName: "Chad",
        deliveryTraits: Object.freeze(["warm", "friendly"]),
      }),
    }),
  ]),

  planKey,
}) satisfies ShotDialoguePlan;

function createVerifiedLine(
  dialogueLineId:
    string,
): VerifiedCompletedDialogueLineForTiming {
  const lineNumber =
    dialogueLineId.endsWith(
      "L01",
    )
      ? 1
      : 2;

  const destinationPath =
    `${mediaRoot}/voices/EP02/S02/${dialogueLineId}/${dialogueLineId}_RUNWAY_task-${lineNumber}_01.audio`;

  const output =
    Object.freeze({
      outputIndex:
        1,

      destinationPath,

      bytes:
        1000 +
        lineNumber,

      sha256:
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
      `${mediaRoot}/voices/EP02/S02/${dialogueLineId}/${dialogueLineId}_RUNWAY_task-${lineNumber}.dialogue-generation.json`,

    completion:
      {},

    completionPath:
      `${mediaRoot}/voices/EP02/S02/${dialogueLineId}/${dialogueLineId}.dialogue-completion.json`,

    output,
  } as unknown as
    VerifiedCompletedDialogueLineForTiming;
}

function createAudioMetadata(
  sourceAudioPath:
    string,
): DialogueAudioMetadata {
  const durationSeconds =
    sourceAudioPath.includes(
      "_L01",
    )
      ? 1.5
      : 2.25;

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

const expectedTiming =
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
      Object.freeze([]),
  }) as unknown as
    VerifiedShotDialogueTiming;

describe(
  "Busybookie shot dialogue audio timing orchestration",
  () => {
    it(
      "verifies and probes every planned line in canonical order before aggregate timing verification",
      async () => {
        const verifyLine =
          vi.fn(
            async (
              input:
                VerifyCompletedDialogueLineForTimingInput,
            ) =>
              createVerifiedLine(
                input.dialogueLineId,
              ),
          );

        const probeAudio =
          vi.fn(
            async (
              input:
                DialogueAudioProbeInput,
            ) =>
              createAudioMetadata(
                input.sourceAudioPath,
              ),
          );

        const verifyTiming =
          vi.fn(
            (
              input:
                VerifyShotDialogueTimingInput,
            ) => {
              expect(
                input.plan,
              ).toBe(
                plan,
              );

              expect(
                input.lines.map(
                  (line) =>
                    line
                      .verified
                      .generationRecord
                      .plan
                      .dialogueLineId,
                ),
              ).toEqual([
                "EP02_SC01_S02_L01",
                "EP02_SC01_S02_L02",
              ]);

              expect(
                input.lines.map(
                  (line) =>
                    line.audio
                      .sourceAudioPath,
                ),
              ).toEqual([
                expect.stringContaining(
                  "EP02_SC01_S02_L01",
                ),
                expect.stringContaining(
                  "EP02_SC01_S02_L02",
                ),
              ]);

              return expectedTiming;
            },
          );

        const result =
          await verifyShotDialogueAudioTiming(
            {
              mediaRoot,
              ffprobeExecutable,
              plan,
            },
            {
              verifyLine:
                verifyLine as never,

              probeAudio:
                probeAudio as never,

              verifyTiming:
                verifyTiming as never,
            },
          );

        expect(
          verifyLine,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          verifyLine,
        ).toHaveBeenNthCalledWith(
          1,
          {
            mediaRoot,
            episodeId:
              "EP02",
            sceneId:
              "SC01",
            shotId:
              "S02",
            dialogueLineId:
              "EP02_SC01_S02_L01",
          },
        );

        expect(
          verifyLine,
        ).toHaveBeenNthCalledWith(
          2,
          {
            mediaRoot,
            episodeId:
              "EP02",
            sceneId:
              "SC01",
            shotId:
              "S02",
            dialogueLineId:
              "EP02_SC01_S02_L02",
          },
        );

        expect(
          probeAudio,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          probeAudio,
        ).toHaveBeenNthCalledWith(
          1,
          {
            ffprobeExecutable,
            sourceAudioPath:
              expect.stringContaining(
                "EP02_SC01_S02_L01",
              ),
          },
        );

        expect(
          probeAudio,
        ).toHaveBeenNthCalledWith(
          2,
          {
            ffprobeExecutable,
            sourceAudioPath:
              expect.stringContaining(
                "EP02_SC01_S02_L02",
              ),
          },
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

    it(
      "fails closed immediately when durable timing admission fails for a line",
      async () => {
        const admissionError =
          new Error(
            "line is not durably complete",
          );

        const verifyLine =
          vi.fn(
            async (
              _input:
                VerifyCompletedDialogueLineForTimingInput,
            ) => {
              throw admissionError;
            },
          );

        const probeAudio =
          vi.fn();

        const verifyTiming =
          vi.fn();

        await expect(
          verifyShotDialogueAudioTiming(
            {
              mediaRoot,
              ffprobeExecutable,
              plan,
            },
            {
              verifyLine:
                verifyLine as never,

              probeAudio:
                probeAudio as never,

              verifyTiming:
                verifyTiming as never,
            },
          ),
        ).rejects.toBe(
          admissionError,
        );

        expect(
          verifyLine,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          probeAudio,
        ).not.toHaveBeenCalled();

        expect(
          verifyTiming,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed immediately when probing the admitted audio fails",
      async () => {
        const probeError =
          new Error(
            "ffprobe rejected audio",
          );

        const verifyLine =
          vi.fn(
            async (
              input:
                VerifyCompletedDialogueLineForTimingInput,
            ) =>
              createVerifiedLine(
                input.dialogueLineId,
              ),
          );

        const probeAudio =
          vi.fn(
            async (
              _input:
                DialogueAudioProbeInput,
            ) => {
              throw probeError;
            },
          );

        const verifyTiming =
          vi.fn();

        await expect(
          verifyShotDialogueAudioTiming(
            {
              mediaRoot,
              ffprobeExecutable,
              plan,
            },
            {
              verifyLine:
                verifyLine as never,

              probeAudio:
                probeAudio as never,

              verifyTiming:
                verifyTiming as never,
            },
          ),
        ).rejects.toBe(
          probeError,
        );

        expect(
          verifyLine,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          probeAudio,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          verifyTiming,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
