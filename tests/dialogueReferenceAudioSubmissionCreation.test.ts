import {
  mkdtemp,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createDialogueReservation,
} from "../src/dialogue/createDialogueReservation.js";

import {
  createDialogueReferenceAudioSubmission,
} from "../src/dialogue/createDialogueReferenceAudioSubmission.js";

import {
  readDialogueSubmission,
} from "../src/dialogue/readDialogueSubmission.js";

const PLAN_KEY =
  "a".repeat(
    64,
  );

const RESERVATION_ID =
  "11111111-1111-4111-8111-111111111111";

const REFERENCE_AUDIO_SHA256 =
  "ad7bc6a50675bddc74a4885f290667fad1076c5cd3d9844eb7ff2d84b0f94a2f";

async function makeTempDirectory(): Promise<string> {
  return mkdtemp(
    join(
      tmpdir(),
      "busybookie-reference-audio-submission-",
    ),
  );
}

function createReferenceAudioPlan() {
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
      ] as string[],

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
  } as const;
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
  } as const;
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
        2.5,
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
  } as const;
}

function createSubmissionInput() {
  return {
    reservationId:
      RESERVATION_ID,

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

    provider:
      "RUNWAY",

    providerExecutionId:
      "task-reference-audio-123",

    providerEstimatedCredits:
      2.5,

    routing:
      createRoutingEvidence(),

    recoveryMetadata: {
      request:
        createReferenceAudioRequest(),

      locallyExpectedCredits:
        2,

      plan:
        createReferenceAudioPlan(),
    },
  } as const;
}

async function createReservation(
  mediaRoot:
    string,
): Promise<void> {
  await createDialogueReservation(
    mediaRoot,
    {
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

      provider:
        "RUNWAY",
    },
    {
      now:
        () =>
          "2026-10-05T12:00:00.000Z",

      createReservationId:
        () =>
          RESERVATION_ID,
    },
  );
}

describe(
  "Busybookie reference-audio dialogue submission creation",
  () => {
    it(
      "creates and reads a v2 durable submission preserving accepted router evidence",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createReservation(
          mediaRoot,
        );

        const input =
          createSubmissionInput();

        const result =
          await createDialogueReferenceAudioSubmission(
            mediaRoot,
            input,
            {
              now:
                () =>
                  "2026-10-05T12:01:00.000Z",
            },
          );

        expect(
          result.record,
        ).toEqual({
          schemaVersion:
            "2.0",

          submittedAt:
            "2026-10-05T12:01:00.000Z",

          status:
            "SUBMITTED",

          ...input,
        });

        await expect(
          readDialogueSubmission(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
          ),
        ).resolves.toEqual(
          result.record,
        );
      },
    );

    it(
      "requires an existing durable reservation before accepting a reference-audio submission",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          createDialogueReferenceAudioSubmission(
            mediaRoot,
            createSubmissionInput(),
          ),
        ).rejects.toThrow(
          /requires an existing dialogue reservation/i,
        );
      },
    );

    it(
      "fails closed when the reference-audio submission reservation ID differs from the durable reservation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createDialogueReservation(
          mediaRoot,
          {
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

            provider:
              "RUNWAY",
          },
          {
            now:
              () =>
                "2026-10-05T12:00:00.000Z",

            createReservationId:
              () =>
                "22222222-2222-4222-8222-222222222222",
          },
        );

        await expect(
          createDialogueReferenceAudioSubmission(
            mediaRoot,
            createSubmissionInput(),
          ),
        ).rejects.toThrow(
          /reservation ID does not match the durable reservation/i,
        );
      },
    );

    it(
      "fails closed when the reference-audio submission plan key differs from the durable reservation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createDialogueReservation(
          mediaRoot,
          {
            episodeId:
              "EP02",

            sceneId:
              "SC01",

            shotId:
              "S02",

            dialogueLineId:
              "EP02_SC01_S02_L01",

            planKey:
              "b".repeat(
                64,
              ),

            provider:
              "RUNWAY",
          },
          {
            now:
              () =>
                "2026-10-05T12:00:00.000Z",

            createReservationId:
              () =>
                RESERVATION_ID,
          },
        );

        await expect(
          createDialogueReferenceAudioSubmission(
            mediaRoot,
            createSubmissionInput(),
          ),
        ).rejects.toThrow(
          /planKey does not match the durable reservation planKey/i,
        );
      },
    );

    it(
      "blocks a duplicate reference-audio submission even when a different provider task ID is supplied",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createReservation(
          mediaRoot,
        );

        await createDialogueReferenceAudioSubmission(
          mediaRoot,
          createSubmissionInput(),
        );

        await expect(
          createDialogueReferenceAudioSubmission(
            mediaRoot,
            {
              ...createSubmissionInput(),

              providerExecutionId:
                "task-reference-audio-other-456",
            },
          ),
        ).rejects.toThrow(
          /dialogue submission already exists/i,
        );
      },
    );

    it(
      "allows exactly one winner when two reference-audio submission writes race",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createReservation(
          mediaRoot,
        );

        const attempts =
          await Promise.allSettled([
            createDialogueReferenceAudioSubmission(
              mediaRoot,
              createSubmissionInput(),
            ),

            createDialogueReferenceAudioSubmission(
              mediaRoot,
              createSubmissionInput(),
            ),
          ]);

        expect(
          attempts.filter(
            (attempt) =>
              attempt.status ===
              "fulfilled",
          ),
        ).toHaveLength(
          1,
        );

        expect(
          attempts.filter(
            (attempt) =>
              attempt.status ===
              "rejected",
          ),
        ).toHaveLength(
          1,
        );

        const rejected =
          attempts.find(
            (attempt) =>
              attempt.status ===
              "rejected",
          );

        expect(
          rejected,
        ).toBeDefined();

        if (
          rejected?.status ===
          "rejected"
        ) {
          expect(
            rejected.reason,
          ).toBeInstanceOf(
            Error,
          );

          expect(
            String(
              rejected.reason,
            ),
          ).toMatch(
            /dialogue submission already exists/i,
          );
        }
      },
    );
  },
);
