import {
  describe,
  expect,
  it,
} from "vitest";

import {
  DialogueGenerationRecordSchema,
} from "../src/dialogue/dialogueGenerationRecord.schema.js";

import {
  DialogueSubmissionSchema,
} from "../src/dialogue/dialogueSubmission.schema.js";

const REFERENCE_AUDIO_SHA256 =
  "ad7bc6a50675bddc74a4885f290667fad1076c5cd3d9844eb7ff2d84b0f94a2f";

function createReferenceAudioPlanSnapshot() {
  return {
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
          REFERENCE_AUDIO_SHA256,

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

function createReferenceAudioRequest() {
  return {
    configId:
      "busybookie-reference-audio-test",

    input: {
      type:
        "speech",

      promptText:
        "Look what I found!",

      voice: {
        type:
          "reference-audio",

        audioUri:
          "runway://uploads/reference-audio-test",
      },
    },
  };
}

function createRoutingEvidence() {
  return {
    configId:
      "busybookie-reference-audio-test",

    model:
      "test-reference-audio-model",

    provider:
      "test-provider",

    estimatedCost: {
      credits:
        2,
    },

    resolvedInput: {
      type:
        "speech",

      voice:
        "reference-audio",
    },

    resolvedSettings: {
      optimizeFor:
        "quality",

      priceCeiling:
        10,
    },
  };
}

function createV2GenerationRecord() {
  return {
    schemaVersion:
      "2.0",

    recordedAt:
      "2026-10-05T09:00:00.000Z",

    status:
      "SUCCEEDED",

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-reference-audio-123",

    providerModel:
      "test-reference-audio-model",

    providerCreatedAt:
      "2026-10-05T08:59:50.000Z",

    request:
      createReferenceAudioRequest(),

    routing:
      createRoutingEvidence(),

    credits: {
      locallyExpected:
        2,

      providerEstimated:
        2,

      providerFinal:
        2,
    },

    plan:
      createReferenceAudioPlanSnapshot(),

    outputs: [
      {
        outputIndex:
          1,

        destinationPath:
          "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/provider-output.audio",

        bytes:
          12_345,

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

function createV2Submission() {
  return {
    schemaVersion:
      "2.0",

    submittedAt:
      "2026-10-05T08:59:45.000Z",

    status:
      "SUBMITTED",

    reservationId:
      "11111111-1111-4111-8111-111111111111",

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    dialogueLineId:
      "EP02_SC01_S02_L01",

    planKey:
      "a".repeat(
        64,
      ),

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-reference-audio-123",

    providerEstimatedCredits:
      2,

    routing:
      createRoutingEvidence(),

    recoveryMetadata: {
      request:
        createReferenceAudioRequest(),

      locallyExpectedCredits:
        2,

      plan:
        createReferenceAudioPlanSnapshot(),
    },
  };
}

describe(
  "Busybookie Runway reference-audio durable contracts",
  () => {
    it(
      "accepts a v2 generation record that preserves immutable reference-audio identity and router evidence",
      () => {
        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              createV2GenerationRecord(),
            ),
        ).not.toThrow();
      },
    );

    it(
      "accepts fractional provider credit evidence for Runway Model Router v2 records",
      () => {
        const record =
          createV2GenerationRecord();

        record.routing
          .estimatedCost
          .credits =
          2.5;

        record.credits
          .providerEstimated =
          2.5;

        record.credits
          .providerFinal =
          2.25;

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).not.toThrow();

        const submission =
          createV2Submission();

        submission.providerEstimatedCredits =
          2.5;

        submission.routing
          .estimatedCost
          .credits =
          2.5;

        expect(
          () =>
            DialogueSubmissionSchema.parse(
              submission,
            ),
        ).not.toThrow();
      },
    );

    it(
      "rejects a v2 generation record whose prompt differs from the immutable plan",
      () => {
        const record =
          createV2GenerationRecord();

        record.request
          .input
          .promptText =
          "Different dialogue.";

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow(
          /request prompt text must match the planned dialogue text/i,
        );
      },
    );

    it(
      "rejects a v2 generation record whose router config differs from the immutable request",
      () => {
        const record =
          createV2GenerationRecord();

        record.routing.configId =
          "different-router-config";

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow(
          /routing configId must match the immutable request configId/i,
        );
      },
    );

    it(
      "rejects a v2 generation record whose provider model differs from accepted router evidence",
      () => {
        const record =
          createV2GenerationRecord();

        record.providerModel =
          "different-model";

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow(
          /provider model must match the accepted router model/i,
        );
      },
    );

    it(
      "rejects a v2 generation record whose provider estimate differs from accepted router evidence",
      () => {
        const record =
          createV2GenerationRecord();

        record.credits
          .providerEstimated =
          3.5;

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow(
          /provider-estimated credits must match the accepted router estimate/i,
        );
      },
    );

    it(
      "rejects a v2 reference-audio request that does not use a Runway upload URI",
      () => {
        const record =
          createV2GenerationRecord();

        record.request
          .input
          .voice
          .audioUri =
          "https://example.test/reference.mp3";

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow(
          /must use a Runway upload URI/i,
        );
      },
    );

    it(
      "rejects unknown fields from strict v2 durable records",
      () => {
        const record = {
          ...createV2GenerationRecord(),

          unexpectedEvidence:
            true,
        };

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow();

        const submission = {
          ...createV2Submission(),

          unexpectedEvidence:
            true,
        };

        expect(
          () =>
            DialogueSubmissionSchema.parse(
              submission,
            ),
        ).toThrow();
      },
    );

    it(
      "rejects a v2 submission whose router config differs from immutable recovery metadata",
      () => {
        const submission =
          createV2Submission();

        submission.routing.configId =
          "different-router-config";

        expect(
          () =>
            DialogueSubmissionSchema.parse(
              submission,
            ),
        ).toThrow(
          /submission routing configId must match the immutable recovery request/i,
        );
      },
    );

    it(
      "rejects a v2 submission whose provider estimate differs from accepted router evidence",
      () => {
        const submission =
          createV2Submission();

        submission.providerEstimatedCredits =
          4.25;

        expect(
          () =>
            DialogueSubmissionSchema.parse(
              submission,
            ),
        ).toThrow(
          /submission provider estimate must match accepted router evidence/i,
        );
      },
    );

    it(
      "keeps locally expected v2 credits integer-only while provider evidence may be fractional",
      () => {
        const record =
          createV2GenerationRecord();

        record.credits
          .locallyExpected =
          2.5;

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              record,
            ),
        ).toThrow();

        const submission =
          createV2Submission();

        submission.recoveryMetadata
          .locallyExpectedCredits =
          2.5;

        expect(
          () =>
            DialogueSubmissionSchema.parse(
              submission,
            ),
        ).toThrow();
      },
    );

    it(
      "rejects negative or non-finite v2 provider credit evidence",
      () => {
        const negativeRecord =
          createV2GenerationRecord();

        negativeRecord.routing
          .estimatedCost
          .credits =
          -0.5;

        negativeRecord.credits
          .providerEstimated =
          -0.5;

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              negativeRecord,
            ),
        ).toThrow(
          /provider credit value must be nonnegative/i,
        );

        const infiniteRecord =
          createV2GenerationRecord();

        infiniteRecord.credits
          .providerFinal =
          Number.POSITIVE_INFINITY;

        expect(
          () =>
            DialogueGenerationRecordSchema.parse(
              infiniteRecord,
            ),
        ).toThrow();
      },
    );

    it(
      "accepts a v2 submission that preserves immutable recovery evidence and the accepted router decision",
      () => {
        expect(
          () =>
            DialogueSubmissionSchema.parse(
              createV2Submission(),
            ),
        ).not.toThrow();
      },
    );
  },
);
