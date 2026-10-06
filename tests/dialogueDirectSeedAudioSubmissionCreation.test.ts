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
  createDialogueDirectSeedAudioReservation,
} from "../src/dialogue/createDialogueDirectSeedAudioReservation.js";

import {
  createDialogueDirectSeedAudioSubmission,
} from "../src/dialogue/createDialogueDirectSeedAudioSubmission.js";

import {
  readDialogueDirectSeedAudioSubmission,
} from "../src/dialogue/readDialogueDirectSeedAudioSubmission.js";

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
      "busybookie-direct-seed-audio-submission-",
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

function createDirectSeedAudioRequest() {
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
      "task-seed-audio-123",

    providerEstimatedCredits:
      2.5,

    recoveryMetadata: {
      request:
        createDirectSeedAudioRequest(),

      localCreditCeiling:
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
  await createDialogueDirectSeedAudioReservation(
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
          "2026-10-05T20:00:00.000Z",

      createReservationId:
        () =>
          RESERVATION_ID,
    },
  );
}

describe(
  "BusyBookie direct SeedAudio dialogue submission creation",
  () => {
    it(
      "creates and reads a v3 durable direct SeedAudio submission without router evidence",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createReservation(
          mediaRoot,
        );

        const input =
          createSubmissionInput();

        const result =
          await createDialogueDirectSeedAudioSubmission(
            mediaRoot,
            input,
            {
              now:
                () =>
                  "2026-10-05T20:01:00.000Z",
            },
          );

        expect(
          result.record,
        ).toEqual({
          schemaVersion:
            "3.0",

          submittedAt:
            "2026-10-05T20:01:00.000Z",

          status:
            "SUBMITTED",

          ...input,
        });

        expect(
          "routing" in
            result.record,
        ).toBe(
          false,
        );

        await expect(
          readDialogueDirectSeedAudioSubmission(
              mediaRoot,
              "EP02",
              "SC01",
              "S02",
              "EP02_SC01_S02_L01",
              PLAN_KEY,
            ),
        ).resolves.toEqual(
          result.record,
        );
      },
    );

    it(
      "requires an existing durable reservation before accepting direct SeedAudio submission evidence",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          createDialogueDirectSeedAudioSubmission(
            mediaRoot,
            createSubmissionInput(),
          ),
        ).rejects.toThrow(
          /requires an existing plan-scoped SeedAudio reservation/i,
        );
      },
    );

    it(
      "fails closed when the direct SeedAudio reservation ID differs from durable reservation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createDialogueDirectSeedAudioReservation(
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
                "2026-10-05T20:00:00.000Z",

            createReservationId:
              () =>
                "22222222-2222-4222-8222-222222222222",
          },
        );

        await expect(
          createDialogueDirectSeedAudioSubmission(
            mediaRoot,
            createSubmissionInput(),
          ),
        ).rejects.toThrow(
          /reservation ID does not match the durable reservation/i,
        );
      },
    );

    it(
      "does not allow a different plan-scoped reservation to satisfy the selected plan",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createDialogueDirectSeedAudioReservation(
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
                "2026-10-05T20:00:00.000Z",

            createReservationId:
              () =>
                RESERVATION_ID,
          },
        );

        await expect(
          createDialogueDirectSeedAudioSubmission(
            mediaRoot,
            createSubmissionInput(),
          ),
        ).rejects.toThrow(
          /requires an existing plan-scoped SeedAudio reservation/i,
        );
      },
    );

    it(
      "blocks a duplicate direct SeedAudio submission even when a different provider task ID is supplied",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createReservation(
          mediaRoot,
        );

        await createDialogueDirectSeedAudioSubmission(
          mediaRoot,
          createSubmissionInput(),
        );

        await expect(
          createDialogueDirectSeedAudioSubmission(
            mediaRoot,
            {
              ...createSubmissionInput(),

              providerExecutionId:
                "task-seed-audio-other-456",
            },
          ),
        ).rejects.toThrow(
          /dialogue direct SeedAudio submission already exists/i,
        );
      },
    );

    it(
      "allows exactly one winner when two direct SeedAudio submission writes race",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createReservation(
          mediaRoot,
        );

        const attempts =
          await Promise.allSettled([
            createDialogueDirectSeedAudioSubmission(
              mediaRoot,
              createSubmissionInput(),
            ),

            createDialogueDirectSeedAudioSubmission(
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
      },
    );
  },
);
