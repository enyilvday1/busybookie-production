import {
  describe,
  expect,
  it,
} from "vitest";

import {
  DialogueGenerationRecordSchema,
} from "../src/dialogue/dialogueGenerationRecord.schema.js";

function createValidRecord() {
  return {
    schemaVersion:
      "1.0",

    recordedAt:
      "2026-10-01T12:30:00.000Z",

    status:
      "SUCCEEDED",

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-123",

    providerModel:
      "eleven_v3",

    providerCreatedAt:
      "2026-10-01T12:29:50.000Z",

    request: {
      model:
        "eleven_v3",

      promptText:
        "Look what I found!",

      voice: {
        type:
          "runway-preset",

        presetId:
          "Chad",
      },

      applyTextNormalization:
        "auto",

      languageCode:
        "en",

      seed:
        0,

      similarityBoost:
        0.75,

      speed:
        1,

      stability:
        0.5,

      style:
        0,

      useSpeakerBoost:
        true,
    },

    credits: {
      locallyExpected:
        1,

      providerEstimated:
        1,

      providerFinal:
        1,
    },

    plan: {
      planKey:
        "a".repeat(
          64,
        ),

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
        provider:
          "RUNWAY",

        voiceName:
          "Chad",

        deliveryTraits: [
          "young",
          "curious",
          "warm",
          "friendly",
          "natural",
        ],
      },
    },

    outputs: [
      {
        outputIndex:
          1,

        destinationPath:
          "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/provider-output.audio",

        bytes:
          12345,

        sha256:
          "b".repeat(
            64,
          ),

        contentType:
          "audio/mpeg",
      },
    ],
  };
}

describe(
  "Busybookie dialogue generation record schema",
  () => {
    it(
      "accepts a successful provenance-rich durable dialogue generation record",
      () => {
        const parsed =
          DialogueGenerationRecordSchema.parse(
            createValidRecord(),
          );

        expect(
          parsed,
        ).toMatchObject({
          schemaVersion:
            "1.0",

          status:
            "SUCCEEDED",

          provider:
            "RUNWAY",

          providerExecutionId:
            "task-123",

          providerModel:
            "eleven_v3",

          providerCreatedAt:
            "2026-10-01T12:29:50.000Z",

          request: {
            model:
              "eleven_v3",

            promptText:
              "Look what I found!",

            voice: {
              type:
                "runway-preset",

              presetId:
                "Chad",
            },

            applyTextNormalization:
              "auto",

            languageCode:
              "en",

            seed:
              0,

            similarityBoost:
              0.75,

            speed:
              1,

            stability:
              0.5,

            style:
              0,

            useSpeakerBoost:
              true,
          },

          credits: {
            locallyExpected:
              1,

            providerEstimated:
              1,

            providerFinal:
              1,
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
                "Chad",
            },
          },

          outputs: [
            {
              outputIndex:
                1,

              bytes:
                12345,

              contentType:
                "audio/mpeg",
            },
          ],
        });
      },
    );

    it(
      "requires the exact provider request snapshot",
      () => {
        const {
          request: _request,
          ...record
        } = createValidRecord();

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow();
      },
    );

    it(
      "requires provider task creation time",
      () => {
        const {
          providerCreatedAt: _providerCreatedAt,
          ...record
        } = createValidRecord();

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow();
      },
    );

    it(
      "requires local, provider-estimated, and provider-final credit evidence",
      () => {
        const {
          credits: _credits,
          ...record
        } = createValidRecord();

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow();
      },
    );

    it(
      "requires request model to match recorded provider model",
      () => {
        const record =
          createValidRecord();

        record.request.model =
          "different-model";

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow(
          /model.*match|match.*model/i,
        );
      },
    );

    it(
      "requires provider prompt text to match the planned dialogue text",
      () => {
        const record =
          createValidRecord();

        record.request.promptText =
          "Different dialogue.";

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow(
          /prompt.*plan|dialogue.*match|text.*match/i,
        );
      },
    );

    it(
      "requires provider preset voice to match the locked planned voice",
      () => {
        const record =
          createValidRecord();

        record.request.voice.presetId =
          "Maya";

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow(
          /voice.*match|preset.*match/i,
        );
      },
    );

    it(
      "rejects invalid Eleven v3 request controls",
      () => {
        const record =
          createValidRecord();

        record.request.speed =
          1.21;

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow();

        const invalidSeedRecord =
          createValidRecord();

        invalidSeedRecord.request.seed =
          4_294_967_296;

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              invalidSeedRecord,
            ),
        ).toThrow();
      },
    );

    it(
      "rejects negative credit evidence",
      () => {
        const record =
          createValidRecord();

        record.credits.providerFinal =
          -1;

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow();
      },
    );

    it(
      "allows provider output content type to be absent while retaining cryptographic evidence",
      () => {
        const record =
          createValidRecord();

        record.outputs[0]!.contentType =
          null as unknown as string;

        const parsed =
          DialogueGenerationRecordSchema.parse(
            record,
          );

        expect(
          parsed.outputs[0]!.contentType,
        ).toBeNull();

        expect(
          parsed.outputs[0]!.sha256,
        ).toBe(
          "b".repeat(
            64,
          ),
        );
      },
    );

    it(
      "rejects a non-absolute persisted output path",
      () => {
        const record =
          createValidRecord();

        record.outputs[0]!.destinationPath =
          "voices/output.audio";

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow(
          /absolute/i,
        );
      },
    );

    it(
      "rejects malformed output SHA-256 evidence",
      () => {
        const record =
          createValidRecord();

        record.outputs[0]!.sha256 =
          "not-a-sha256";

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow(
          /sha256|64-character/i,
        );
      },
    );

    it(
      "rejects a provider other than the locked voice provider",
      () => {
        const record =
          createValidRecord();

        record.provider =
          "VEO";

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow();
      },
    );

    it(
      "rejects unknown top-level fields",
      () => {
        const record = {
          ...createValidRecord(),

          silentlyAccepted:
            true,
        };

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow();
      },
    );
  },
);
