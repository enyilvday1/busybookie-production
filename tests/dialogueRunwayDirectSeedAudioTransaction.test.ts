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
  runRunwayDirectSeedAudioDialogueTransaction,
} from "../src/dialogue/runRunwayDirectSeedAudioDialogueTransaction.js";

const PLAN_KEY =
  "a".repeat(
    64,
  );

function createPlan():
ShotDialoguePlan {
  return {
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

    videoGeneration: {
      provider:
        "VEO",

      nativeAudio:
        true,
    },

    lines: [
      {
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

        voice: {
          selectionStatus:
            "LOCKED",

          provider:
            "RUNWAY",

          voiceName:
            "Ollie",

          deliveryTraits: [
            "young",
            "curious",
            "warm",
            "friendly",
            "natural",
          ],

          executionMode:
            "RUNWAY_REFERENCE_AUDIO",

          referenceAudio:
            createReferenceAudio(),
        },
      },
    ],

    planKey:
      PLAN_KEY,
  };
}

function createReferenceAudio() {
  return {
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
  } as const;
}

describe(
  "BusyBookie direct SeedAudio dialogue transaction",
  () => {
    it(
      "verifies the immutable reference, uploads only the verified physical asset, executes SeedAudio, and writes v3 durable provenance",
      async () => {
        const callOrder:
          string[] = [];

        const referenceAudio =
          createReferenceAudio();

        const verifiedReferenceAudio = {
          ...referenceAudio,

          absolutePath:
            "D:/Busybookie/Production/references/voices/OLLIE/ollie-reference-v1.mp3",
        } as const;

        const verifyReferenceAudio =
          vi.fn(
            async () => {
              callOrder.push(
                "verify",
              );

              return verifiedReferenceAudio;
            },
          );

        const uploadReferenceAudio =
          vi.fn(
            async (
              absolutePath:
                string,
            ) => {
              callOrder.push(
                "upload",
              );

              expect(
                absolutePath,
              ).toBe(
                verifiedReferenceAudio
                  .absolutePath,
              );

              return "runway://ephemeral/ollie-reference-v1";
            },
          );

        const executeGeneration =
          vi.fn(
            async (
              request:
                unknown,

              waitTimeoutMs:
                number,

              recoveryMetadata:
                unknown,
            ) => {
              callOrder.push(
                "execute",
              );

              expect(
                request,
              ).toEqual({
                model:
                  "seed_audio",

                promptText:
                  "Look what I found!",

                voice: {
                  type:
                    "reference-audio",

                  audioUri:
                    "runway://ephemeral/ollie-reference-v1",
                },
              });

              expect(
                waitTimeoutMs,
              ).toBe(
                600_000,
              );

              expect(
                recoveryMetadata,
              ).toEqual({
                request: {
                  model:
                    "seed_audio",

                  promptText:
                    "Look what I found!",

                  voice: {
                    type:
                      "reference-audio",

                    audioUri:
                      "runway://ephemeral/ollie-reference-v1",
                  },
                },

                localCreditCeiling:
                  30,

                plan: {
                  planKey:
                    PLAN_KEY,

                  episodeId:
                    "EP02",

                  sceneId:
                    "SC01",

                  shotId:
                    "S02",

                  dialogueLineId:
                    "EP02_SC01_S02_L01",

                  lineNumber:
                    1,

                  characterId:
                    "OLLIE",

                  characterName:
                    "Ollie",

                  text:
                    "Look what I found!",

                  deliveryNotes:
                    "Curious, excited and gentle.",

                  voice: {
                    selectionStatus:
                      "LOCKED",

                    provider:
                      "RUNWAY",

                    voiceName:
                      "Ollie",

                    deliveryTraits: [
                      "young",
                      "curious",
                      "warm",
                      "friendly",
                      "natural",
                    ],

                    executionMode:
                      "RUNWAY_REFERENCE_AUDIO",

                    referenceAudio,
                  },
                },
              });

              return {
                taskId:
                  "task-seed-audio-123",

                providerCreatedAt:
                  "2026-10-06T11:00:00.000Z",

                estimatedCredits:
                  5,

                finalCredits:
                  4.5,

                outputUrls: [
                  "https://example.test/ollie-seed-audio.mp3",
                ],
              };
            },
          );

        const downloadOutput =
          vi.fn(
            async (
              sourceUrl:
                string,

              destinationPath:
                string,
            ) => {
              callOrder.push(
                "download",
              );

              expect(
                sourceUrl,
              ).toBe(
                "https://example.test/ollie-seed-audio.mp3",
              );

              expect(
                destinationPath,
              ).toMatch(
                /EP02_SC01_S02_L01_RUNWAY_task-seed-audio-123_01\.audio$/,
              );

              return {
                destinationPath,

                bytes:
                  1_234,

                sha256:
                  "b".repeat(
                    64,
                  ),

                contentType:
                  "audio/mpeg",
              };
            },
          );

        const writeGenerationRecord =
          vi.fn(
            async (
              mediaRoot:
                string,

              record:
                unknown,
            ) => {
              callOrder.push(
                "write",
              );

              expect(
                mediaRoot,
              ).toBe(
                "D:/Busybookie/Production",
              );

              expect(
                record,
              ).toMatchObject({
                schemaVersion:
                  "3.0",

                recordedAt:
                  "2026-10-06T11:01:00.000Z",

                status:
                  "SUCCEEDED",

                provider:
                  "RUNWAY",

                providerExecutionId:
                  "task-seed-audio-123",

                providerModel:
                  "seed_audio",

                providerCreatedAt:
                  "2026-10-06T11:00:00.000Z",

                request: {
                  model:
                    "seed_audio",

                  promptText:
                    "Look what I found!",

                  voice: {
                    type:
                      "reference-audio",

                    audioUri:
                      "runway://ephemeral/ollie-reference-v1",
                  },
                },

                credits: {
                  localCeiling:
                    30,

                  providerEstimated:
                    5,

                  providerFinal:
                    4.5,
                },

                plan: {
                  dialogueLineId:
                    "EP02_SC01_S02_L01",

                  characterId:
                    "OLLIE",

                  voice: {
                    provider:
                      "RUNWAY",

                    voiceName:
                      "Ollie",
                  },
                },
              });

              return "D:/Busybookie/Production/generated-dialogue/EP02/S02/record.json";
            },
          );

        const result =
          await runRunwayDirectSeedAudioDialogueTransaction(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                "D:/Busybookie/Production",

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,
            },
            {
              verifyReferenceAudio,

              uploadReferenceAudio,

              executeGeneration,

              downloadOutput,

              writeGenerationRecord,

              now:
                () =>
                  "2026-10-06T11:01:00.000Z",
            },
          );

        expect(
          callOrder,
        ).toEqual([
          "verify",
          "upload",
          "execute",
          "download",
          "write",
        ]);

        expect(
          verifyReferenceAudio,
        ).toHaveBeenCalledWith({
          mediaRoot:
            "D:/Busybookie/Production",

          referenceAudio,

          ffprobeExecutable:
            "ffprobe",
        });

        expect(
          uploadReferenceAudio,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          executeGeneration,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          result.record,
        ).toMatchObject({
          schemaVersion:
            "3.0",

          providerExecutionId:
            "task-seed-audio-123",

          credits: {
            localCeiling:
              30,

            providerEstimated:
              5,

            providerFinal:
              4.5,
          },
        });

        expect(
          result.recordPath,
        ).toBe(
          "D:/Busybookie/Production/generated-dialogue/EP02/S02/record.json",
        );
      },
    );

    it(
      "fails before upload or paid execution when immutable reference verification fails",
      async () => {
        const verifyReferenceAudio =
          vi.fn(
            async () => {
              throw new Error(
                "reference SHA mismatch",
              );
            },
          );

        const uploadReferenceAudio =
          vi.fn();

        const executeGeneration =
          vi.fn();

        const downloadOutput =
          vi.fn();

        const writeGenerationRecord =
          vi.fn();

        await expect(
          runRunwayDirectSeedAudioDialogueTransaction(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                "D:/Busybookie/Production",

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,
            },
            {
              verifyReferenceAudio,

              uploadReferenceAudio,

              executeGeneration,

              downloadOutput,

              writeGenerationRecord,
            },
          ),
        ).rejects.toThrow(
          /reference SHA mismatch/i,
        );

        expect(
          uploadReferenceAudio,
        ).not.toHaveBeenCalled();

        expect(
          executeGeneration,
        ).not.toHaveBeenCalled();

        expect(
          downloadOutput,
        ).not.toHaveBeenCalled();

        expect(
          writeGenerationRecord,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails before paid execution when reference upload fails",
      async () => {
        const referenceAudio =
          createReferenceAudio();

        const verifyReferenceAudio =
          vi.fn(
            async () => ({
              ...referenceAudio,

              absolutePath:
                "D:/Busybookie/Production/references/voices/OLLIE/ollie-reference-v1.mp3",
            }),
          );

        const uploadReferenceAudio =
          vi.fn(
            async () => {
              throw new Error(
                "ephemeral upload failed",
              );
            },
          );

        const executeGeneration =
          vi.fn();

        const downloadOutput =
          vi.fn();

        const writeGenerationRecord =
          vi.fn();

        await expect(
          runRunwayDirectSeedAudioDialogueTransaction(
            {
              plan:
                createPlan(),

              dialogueLineId:
                "EP02_SC01_S02_L01",

              mediaRoot:
                "D:/Busybookie/Production",

              ffprobeExecutable:
                "ffprobe",

              localCreditCeiling:
                30,

              waitTimeoutMs:
                600_000,
            },
            {
              verifyReferenceAudio,

              uploadReferenceAudio,

              executeGeneration,

              downloadOutput,

              writeGenerationRecord,
            },
          ),
        ).rejects.toThrow(
          /ephemeral upload failed/i,
        );

        expect(
          executeGeneration,
        ).not.toHaveBeenCalled();

        expect(
          downloadOutput,
        ).not.toHaveBeenCalled();

        expect(
          writeGenerationRecord,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
