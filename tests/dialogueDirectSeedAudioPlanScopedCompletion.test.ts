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
  createDialogueDirectSeedAudioReservation,
} from "../src/dialogue/createDialogueDirectSeedAudioReservation.js";

import {
  createDialogueDirectSeedAudioSubmission,
} from "../src/dialogue/createDialogueDirectSeedAudioSubmission.js";

import {
  createDialogueDirectSeedAudioCompletion,
} from "../src/dialogue/createDialogueDirectSeedAudioCompletion.js";

import {
  readDialogueDirectSeedAudioCompletion,
} from "../src/dialogue/readDialogueDirectSeedAudioCompletion.js";

import {
  createDialogueDirectSeedAudioCompletionPath,
} from "../src/dialogue/dialogueDirectSeedAudioLifecyclePaths.js";

import {
  createDialogueCompletionPath,
} from "../src/dialogue/dialogueCompletionPath.js";

import {
  writeDialogueGenerationRecord,
} from "../src/dialogue/writeDialogueGenerationRecord.js";

const PLAN_KEY =
  "a".repeat(
    64,
  );

const RESERVATION_ID =
  "11111111-1111-4111-8111-111111111111";

const PROVIDER_EXECUTION_ID =
  "task-seed-audio-completion-1";

const REFERENCE_AUDIO_SHA256 =
  "ad7bc6a50675bddc74a4885f290667fad1076c5cd3d9844eb7ff2d84b0f94a2f";

const HISTORICAL_COMPLETION_SENTINEL =
  "historical-singleton-completion-must-remain-untouched\n";

const createdDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-direct-seed-audio-completion-",
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

function createReferenceAudio() {
  return {
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
  } as const;
}

function createPlanSnapshot(
  planKey =
    PLAN_KEY,
) {
  return {
    planKey,

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

      referenceAudio:
        createReferenceAudio(),
    },
  } as const;
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
  } as const;
}

function createRecoveryMetadata(
  planKey =
    PLAN_KEY,
) {
  return {
    request:
      createRequest(),

    localCreditCeiling:
      30,

    plan:
      createPlanSnapshot(
        planKey,
      ),
  } as const;
}

async function prepareDirectSeedAudioLifecycle(
  mediaRoot:
    string,
): Promise<string> {
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
          "2026-10-06T17:00:00.000Z",

      createReservationId:
        () =>
          RESERVATION_ID,
    },
  );

  await createDialogueDirectSeedAudioSubmission(
    mediaRoot,
    {
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
        PROVIDER_EXECUTION_ID,

      providerEstimatedCredits:
        5.25,

      recoveryMetadata:
        createRecoveryMetadata(),
    },
    {
      now:
        () =>
          "2026-10-06T17:01:00.000Z",
    },
  );

  return writeDialogueGenerationRecord(
    mediaRoot,
    {
      schemaVersion:
        "3.0",

      recordedAt:
        "2026-10-06T17:02:00.000Z",

      status:
        "SUCCEEDED",

      provider:
        "RUNWAY",

      providerExecutionId:
        PROVIDER_EXECUTION_ID,

      providerModel:
        "seed_audio",

      providerCreatedAt:
        "2026-10-06T17:01:30.000Z",

      request:
        createRequest(),

      credits: {
        localCeiling:
          30,

        providerEstimated:
          5.25,

        providerFinal:
          4.75,
      },

      plan:
        createPlanSnapshot(),

      outputs: [
        {
          outputIndex:
            1,

          destinationPath:
            join(
              mediaRoot,
              "generated-dialogue",
              "EP02",
              "S02",
              "EP02_SC01_S02_L01_RUNWAY_task-seed-audio-completion-1_01.audio",
            ),

          bytes:
            1_234,

          sha256:
            "b".repeat(
              64,
            ),

          contentType:
            "audio/mpeg",
        },
      ],
    },
  );
}

function createCompletionInput(
  generationRecordPath:
    string,
) {
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
      "RUNWAY" as const,

    providerExecutionId:
      PROVIDER_EXECUTION_ID,

    generationRecordPath,
  };
}

describe(
  "BusyBookie direct SeedAudio plan-scoped completion persistence",
  () => {
    it(
      "creates and reads a plan-scoped completion while preserving historical singleton completion evidence",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const historicalCompletionPath =
          createDialogueCompletionPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
          );

        await mkdir(
          dirname(
            historicalCompletionPath,
          ),
          {
            recursive: true,
          },
        );

        await writeFile(
          historicalCompletionPath,
          HISTORICAL_COMPLETION_SENTINEL,
          "utf8",
        );

        const generationRecordPath =
          await prepareDirectSeedAudioLifecycle(
            mediaRoot,
          );

        const result =
          await createDialogueDirectSeedAudioCompletion(
            mediaRoot,
            createCompletionInput(
              generationRecordPath,
            ),
            {
              now:
                () =>
                  "2026-10-06T17:03:00.000Z",
            },
          );

        const expectedPath =
          createDialogueDirectSeedAudioCompletionPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            PLAN_KEY,
          );

        expect(
          result.completionPath,
        ).toBe(
          expectedPath,
        );

        expect(
          result.completionPath,
        ).not.toBe(
          historicalCompletionPath,
        );

        expect(
          result.record,
        ).toEqual({
          schemaVersion:
            "1.0",

          completedAt:
            "2026-10-06T17:03:00.000Z",

          status:
            "COMPLETED",

          ...createCompletionInput(
            generationRecordPath,
          ),
        });

        await expect(
          readDialogueDirectSeedAudioCompletion(
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

        expect(
          await readFile(
            historicalCompletionPath,
            "utf8",
          ),
        ).toBe(
          HISTORICAL_COMPLETION_SENTINEL,
        );
      },
    );

    it(
      "requires the matching plan-scoped reservation and submission chain",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const generationRecordPath =
          join(
            mediaRoot,
            "voices",
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            `EP02_SC01_S02_L01_RUNWAY_${PROVIDER_EXECUTION_ID}.dialogue-generation.json`,
          );

        await expect(
          createDialogueDirectSeedAudioCompletion(
            mediaRoot,
            createCompletionInput(
              generationRecordPath,
            ),
          ),
        ).rejects.toThrow(
          /reservation|required/i,
        );
      },
    );

    it(
      "fails closed when completion evidence uses a different provider execution ID than the accepted submission",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const generationRecordPath =
          await prepareDirectSeedAudioLifecycle(
            mediaRoot,
          );

        await expect(
          createDialogueDirectSeedAudioCompletion(
            mediaRoot,
            {
              ...createCompletionInput(
                generationRecordPath,
              ),

              providerExecutionId:
                "task-seed-audio-other",
            },
          ),
        ).rejects.toThrow(
          /provider execution ID|submission|task ID/i,
        );
      },
    );

    it(
      "rejects a generation record path that is not canonical for the accepted provider execution",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await prepareDirectSeedAudioLifecycle(
          mediaRoot,
        );

        const outsidePath =
          join(
            mediaRoot,
            "other",
            "fake.dialogue-generation.json",
          );

        await mkdir(
          dirname(
            outsidePath,
          ),
          {
            recursive: true,
          },
        );

        await writeFile(
          outsidePath,
          "{}\n",
          "utf8",
        );

        await expect(
          createDialogueDirectSeedAudioCompletion(
            mediaRoot,
            createCompletionInput(
              outsidePath,
            ),
          ),
        ).rejects.toThrow(
          /canonical|generation record path/i,
        );
      },
    );

    it(
      "blocks a duplicate completion for the same direct SeedAudio plan",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const generationRecordPath =
          await prepareDirectSeedAudioLifecycle(
            mediaRoot,
          );

        const input =
          createCompletionInput(
            generationRecordPath,
          );

        await createDialogueDirectSeedAudioCompletion(
          mediaRoot,
          input,
        );

        await expect(
          createDialogueDirectSeedAudioCompletion(
            mediaRoot,
            input,
          ),
        ).rejects.toThrow(
          /direct SeedAudio completion already exists/i,
        );
      },
    );

    it(
      "allows exactly one winner when two completion writes race for the same direct SeedAudio plan",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const generationRecordPath =
          await prepareDirectSeedAudioLifecycle(
            mediaRoot,
          );

        const input =
          createCompletionInput(
            generationRecordPath,
          );

        const attempts =
          await Promise.allSettled([
            createDialogueDirectSeedAudioCompletion(
              mediaRoot,
              input,
            ),

            createDialogueDirectSeedAudioCompletion(
              mediaRoot,
              input,
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
      "returns null when the selected plan has no completion and fails closed on malformed scoped JSON",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readDialogueDirectSeedAudioCompletion(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            PLAN_KEY,
          ),
        ).resolves.toBeNull();

        const completionPath =
          createDialogueDirectSeedAudioCompletionPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            PLAN_KEY,
          );

        await mkdir(
          dirname(
            completionPath,
          ),
          {
            recursive: true,
          },
        );

        await writeFile(
          completionPath,
          "{damaged",
          "utf8",
        );

        await expect(
          readDialogueDirectSeedAudioCompletion(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            PLAN_KEY,
          ),
        ).rejects.toThrow(
          /not valid JSON|malformed/i,
        );

        expect(
          await readFile(
            completionPath,
            "utf8",
          ),
        ).toBe(
          "{damaged",
        );
      },
    );
  },
);
