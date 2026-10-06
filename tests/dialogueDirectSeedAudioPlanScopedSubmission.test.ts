import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createDialogueReservation,
} from "../src/dialogue/createDialogueReservation.js";

import {
  createDialogueSubmissionPath,
} from "../src/dialogue/dialogueSubmissionPath.js";

import {
  createDialogueDirectSeedAudioReservation,
} from "../src/dialogue/createDialogueDirectSeedAudioReservation.js";

import {
  createDialogueDirectSeedAudioSubmission,
} from "../src/dialogue/createDialogueDirectSeedAudioSubmission.js";

import {
  readDialogueDirectSeedAudioSubmission,
} from "../src/dialogue/readDialogueDirectSeedAudioSubmission.js";

import {
  createDialogueDirectSeedAudioSubmissionPath,
} from "../src/dialogue/dialogueDirectSeedAudioLifecyclePaths.js";

const HISTORICAL_PLAN_KEY =
  "a".repeat(
    64,
  );

const SEED_AUDIO_PLAN_KEY =
  "b".repeat(
    64,
  );

const HISTORICAL_RESERVATION_ID =
  "11111111-1111-4111-8111-111111111111";

const SEED_AUDIO_RESERVATION_ID =
  "22222222-2222-4222-8222-222222222222";

const REFERENCE_AUDIO_SHA256 =
  "ad7bc6a50675bddc74a4885f290667fad1076c5cd3d9844eb7ff2d84b0f94a2f";

const HISTORICAL_SUBMISSION_SENTINEL =
  "historical-eleven-submission-must-remain-untouched\n";

const createdDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-direct-seed-audio-scoped-submission-",
      ),
    );

  createdDirectories.push(
    directory,
  );

  return directory;
}

afterEach(
  async () => {
    await Promise.all(
      createdDirectories
        .splice(
          0,
        )
        .map(
          (
            directory,
          ) =>
            rm(
              directory,
              {
                recursive: true,
                force: true,
              },
            ),
        ),
    );
  },
);

function createReferenceAudioPlan() {
  return {
    planKey:
      SEED_AUDIO_PLAN_KEY,

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

function createSubmissionInput(
  providerExecutionId =
    "task-seed-audio-123",
) {
  return {
    reservationId:
      SEED_AUDIO_RESERVATION_ID,

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    dialogueLineId:
      "EP02_SC01_S02_L01",

    planKey:
      SEED_AUDIO_PLAN_KEY,

    provider:
      "RUNWAY" as const,

    providerExecutionId,

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

async function createHistoricalSingletonEvidence(
  mediaRoot:
    string,
): Promise<string> {
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
        HISTORICAL_PLAN_KEY,

      provider:
        "RUNWAY",
    },
    {
      now:
        () =>
          "2026-10-02T21:12:28.101Z",

      createReservationId:
        () =>
          HISTORICAL_RESERVATION_ID,
    },
  );

  const historicalSubmissionPath =
    createDialogueSubmissionPath(
      mediaRoot,
      "EP02",
      "SC01",
      "S02",
      "EP02_SC01_S02_L01",
    );

  await mkdir(
    dirname(
      historicalSubmissionPath,
    ),
    {
      recursive: true,
    },
  );

  await writeFile(
    historicalSubmissionPath,
    HISTORICAL_SUBMISSION_SENTINEL,
    "utf8",
  );

  return historicalSubmissionPath;
}

async function createScopedReservation(
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
        SEED_AUDIO_PLAN_KEY,

      provider:
        "RUNWAY",
    },
    {
      now:
        () =>
          "2026-10-06T16:45:00.000Z",

      createReservationId:
        () =>
          SEED_AUDIO_RESERVATION_ID,
    },
  );
}

describe(
  "BusyBookie direct SeedAudio plan-scoped submission persistence",
  () => {
    it(
      "binds to the plan-scoped SeedAudio reservation while preserving historical singleton submission evidence",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const historicalSubmissionPath =
          await createHistoricalSingletonEvidence(
            mediaRoot,
          );

        await createScopedReservation(
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
                  "2026-10-06T16:46:00.000Z",
            },
          );

        const expectedScopedPath =
          createDialogueDirectSeedAudioSubmissionPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            SEED_AUDIO_PLAN_KEY,
          );

        expect(
          result.submissionPath,
        ).toBe(
          expectedScopedPath,
        );

        expect(
          result.submissionPath,
        ).not.toBe(
          historicalSubmissionPath,
        );

        expect(
          result.record,
        ).toEqual({
          schemaVersion:
            "3.0",

          submittedAt:
            "2026-10-06T16:46:00.000Z",

          status:
            "SUBMITTED",

          ...input,
        });

        await expect(
          readDialogueDirectSeedAudioSubmission(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            SEED_AUDIO_PLAN_KEY,
          ),
        ).resolves.toEqual(
          result.record,
        );

        expect(
          await readFile(
            historicalSubmissionPath,
            "utf8",
          ),
        ).toBe(
          HISTORICAL_SUBMISSION_SENTINEL,
        );
      },
    );

    it(
      "requires the matching plan-scoped SeedAudio reservation even when a historical singleton reservation exists",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createHistoricalSingletonEvidence(
          mediaRoot,
        );

        await expect(
          createDialogueDirectSeedAudioSubmission(
            mediaRoot,
            createSubmissionInput(),
          ),
        ).rejects.toThrow(
          /requires an existing.*SeedAudio.*reservation/i,
        );
      },
    );

    it(
      "returns null when the selected plan has no direct SeedAudio submission",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readDialogueDirectSeedAudioSubmission(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            SEED_AUDIO_PLAN_KEY,
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "blocks a second submission for the same direct SeedAudio plan even when the provider task ID changes",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createScopedReservation(
          mediaRoot,
        );

        await createDialogueDirectSeedAudioSubmission(
          mediaRoot,
          createSubmissionInput(),
        );

        await expect(
          createDialogueDirectSeedAudioSubmission(
            mediaRoot,
            createSubmissionInput(
              "task-seed-audio-other-456",
            ),
          ),
        ).rejects.toThrow(
          /dialogue direct SeedAudio submission already exists/i,
        );
      },
    );

    it(
      "allows exactly one winner when two submissions race for the same direct SeedAudio plan",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createScopedReservation(
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
            (
              attempt,
            ) =>
              attempt.status ===
              "fulfilled",
          ),
        ).toHaveLength(
          1,
        );

        expect(
          attempts.filter(
            (
              attempt,
            ) =>
              attempt.status ===
              "rejected",
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "fails closed when plan-scoped submission evidence is malformed",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const submissionPath =
          createDialogueDirectSeedAudioSubmissionPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            SEED_AUDIO_PLAN_KEY,
          );

        await mkdir(
          dirname(
            submissionPath,
          ),
          {
            recursive: true,
          },
        );

        await writeFile(
          submissionPath,
          "{not-valid-json",
          "utf8",
        );

        await expect(
          readDialogueDirectSeedAudioSubmission(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            SEED_AUDIO_PLAN_KEY,
          ),
        ).rejects.toThrow(
          /not valid JSON/i,
        );

        expect(
          await readFile(
            submissionPath,
            "utf8",
          ),
        ).toBe(
          "{not-valid-json",
        );
      },
    );
  },
);
