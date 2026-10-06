import {
  describe,
  expect,
  it,
} from "vitest";

import {
  DialogueDirectSeedAudioGenerationRecoveryMetadataSchema,
} from "../src/dialogue/dialogueSubmission.schema.js";

import {
  DialogueGenerationRecordV3Schema,
} from "../src/dialogue/dialogueGenerationRecord.schema.js";

const PLAN_KEY =
  "a".repeat(
    64,
  );

function createPlan() {
  return {
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

      referenceAudio: {
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
      },
    },
  };
}

function createRequest() {
  return {
    model:
      "seed_audio",

    promptText:
      "Look what I found!",

    outputFormat:
      "mp3",

    sampleRate:
      44_100,

    voice: {
      type:
        "reference-audio",

      audioUri:
        "runway://uploads/ollie-reference-v1",
    },
  };
}

describe(
  "BusyBookie direct SeedAudio budget contract",
  () => {
    it(
      "records an explicit local credit ceiling rather than a false locally expected SeedAudio cost",
      () => {
        const parsed =
          DialogueDirectSeedAudioGenerationRecoveryMetadataSchema
            .parse({
              request:
                createRequest(),

              localCreditCeiling:
                30,

              plan:
                createPlan(),
            });

        expect(
          parsed.localCreditCeiling,
        ).toBe(
          30,
        );

        expect(
          "locallyExpectedCredits" in parsed,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects the obsolete locallyExpectedCredits field for direct SeedAudio recovery metadata",
      () => {
        expect(
          DialogueDirectSeedAudioGenerationRecoveryMetadataSchema
            .safeParse({
              request:
                createRequest(),

              locallyExpectedCredits:
                5,

              plan:
                createPlan(),
            })
            .success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "records the local ceiling separately from provider estimated and final credits in a v3 generation record",
      () => {
        const parsed =
          DialogueGenerationRecordV3Schema
            .parse({
              schemaVersion:
                "3.0",

              recordedAt:
                "2026-10-06T10:55:00.000Z",

              status:
                "SUCCEEDED",

              provider:
                "RUNWAY",

              providerExecutionId:
                "task-seed-audio-123",

              providerModel:
                "seed_audio",

              providerCreatedAt:
                "2026-10-06T10:54:30.000Z",

              request:
                createRequest(),

              credits: {
                localCeiling:
                  30,

                providerEstimated:
                  5,

                providerFinal:
                  5,
              },

              plan:
                createPlan(),

              outputs: [
                {
                  outputIndex:
                    1,

                  destinationPath:
                    "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_task-seed-audio-123_01.audio",

                  bytes:
                    123_456,

                  sha256:
                    "b".repeat(
                      64,
                    ),

                  contentType:
                    "audio/mpeg",
                },
              ],
            });

        expect(
          parsed.credits,
        ).toEqual({
          localCeiling:
            30,

          providerEstimated:
            5,

          providerFinal:
            5,
        });
      },
    );

    it(
      "rejects obsolete locallyExpected credit evidence on a v3 generation record",
      () => {
        const result =
          DialogueGenerationRecordV3Schema
            .safeParse({
              schemaVersion:
                "3.0",

              recordedAt:
                "2026-10-06T10:55:00.000Z",

              status:
                "SUCCEEDED",

              provider:
                "RUNWAY",

              providerExecutionId:
                "task-seed-audio-123",

              providerModel:
                "seed_audio",

              providerCreatedAt:
                "2026-10-06T10:54:30.000Z",

              request:
                createRequest(),

              credits: {
                locallyExpected:
                  5,

                providerEstimated:
                  5,

                providerFinal:
                  5,
              },

              plan:
                createPlan(),

              outputs: [
                {
                  outputIndex:
                    1,

                  destinationPath:
                    "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_task-seed-audio-123_01.audio",

                  bytes:
                    123_456,

                  sha256:
                    "b".repeat(
                      64,
                    ),

                  contentType:
                    "audio/mpeg",
                },
              ],
            });

        expect(
          result.success,
        ).toBe(
          false,
        );
      },
    );
  },
);
