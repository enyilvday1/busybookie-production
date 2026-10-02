import {
  mkdtemp,
  mkdir,
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
  describe,
  expect,
  it,
} from "vitest";

import {
  createDialogueReservation,
} from "../src/dialogue/createDialogueReservation.js";

import {
  createDialogueSubmission,
} from "../src/dialogue/createDialogueSubmission.js";

import {
  createDialogueGenerationRecordPath,
} from "../src/dialogue/dialogueGenerationRecordPath.js";

import {
  writeDialogueGenerationRecord,
} from "../src/dialogue/writeDialogueGenerationRecord.js";

import {
  DialogueCompletionSchema,
} from "../src/dialogue/dialogueCompletion.schema.js";

import {
  createDialogueCompletion,
} from "../src/dialogue/createDialogueCompletion.js";

import {
  createDialogueCompletionPath,
} from "../src/dialogue/dialogueCompletionPath.js";

import {
  readDialogueCompletion,
} from "../src/dialogue/readDialogueCompletion.js";

const reservationId =
  "11111111-1111-4111-8111-111111111111";

const planKey =
  "a".repeat(
    64,
  );

const providerExecutionId =
  "task-dialogue-123";

async function makeTempDirectory():
  Promise<string> {
  return mkdtemp(
    join(
      tmpdir(),
      "busybookie-dialogue-completion-",
    ),
  );
}

function createPlanSnapshot() {
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
      "OLLIE" as const,

    characterName:
      "Ollie",

    text:
      "Look what I found!",

    deliveryNotes:
      "Curious, excited and gentle.",

    voice: {
      provider:
        "RUNWAY" as const,

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
  };
}

function createRecoveryMetadata() {
  return {
    request: {
      model:
        "eleven_v3" as const,

      promptText:
        "Look what I found!",

      voice: {
        type:
          "runway-preset" as const,

        presetId:
          "Chad" as const,
      },

      applyTextNormalization:
        "auto" as const,

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

    locallyExpectedCredits:
      1,

    plan:
      createPlanSnapshot(),
  };
}

async function prepareLifecycle(
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

      planKey,

      provider:
        "RUNWAY",
    },
    {
      now:
        () =>
          "2026-10-01T20:00:00.000Z",

      createReservationId:
        () =>
          reservationId,
    },
  );

  await createDialogueSubmission(
    mediaRoot,
    {
      reservationId,

      episodeId:
        "EP02",

      sceneId:
        "SC01",

      shotId:
        "S02",

      dialogueLineId:
        "EP02_SC01_S02_L01",

      planKey,

      provider:
        "RUNWAY",

      providerExecutionId,

      providerEstimatedCredits:
        1,

      recoveryMetadata:
        createRecoveryMetadata(),
    },
    {
      now:
        () =>
          "2026-10-01T20:01:00.000Z",
    },
  );

  return writeDialogueGenerationRecord(
    mediaRoot,
    {
      schemaVersion:
        "1.0",

      recordedAt:
        "2026-10-01T20:02:00.000Z",

      status:
        "SUCCEEDED",

      provider:
        "RUNWAY",

      providerExecutionId,

      providerModel:
        "eleven_v3",

      providerCreatedAt:
        "2026-10-01T20:01:30.000Z",

      request:
        createRecoveryMetadata().request,

      credits: {
        locallyExpected:
          1,

        providerEstimated:
          1,

        providerFinal:
          1,
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
              "voices",
              "EP02",
              "S02",
              "EP02_SC01_S02_L01",
              "EP02_SC01_S02_L01_RUNWAY_task-dialogue-123_01.audio",
            ),

          bytes:
            123,

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

  overrides:
    Partial<{
      reservationId: string;
      episodeId: string;
      sceneId: string;
      shotId: string;
      dialogueLineId: string;
      planKey: string;
      providerExecutionId: string;
      generationRecordPath: string;
    }> = {},
) {
  return {
    reservationId,

    episodeId:
      "EP02",

    sceneId:
      "SC01",

    shotId:
      "S02",

    dialogueLineId:
      "EP02_SC01_S02_L01",

    planKey,

    provider:
      "RUNWAY" as const,

    providerExecutionId,

    generationRecordPath,

    ...overrides,
  };
}

describe(
  "Busybookie dialogue completion receipt",
  () => {
    it(
      "creates a deterministic line-scoped completion path",
      () => {
        const result =
          createDialogueCompletionPath(
            "D:/Busybookie/Production",
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
          );

        expect(
          result.replaceAll(
            "\\",
            "/",
          ),
        ).toMatch(
          /D:\/Busybookie\/Production\/voices\/EP02\/S02\/EP02_SC01_S02_L01\/EP02_SC01_S02_L01\.dialogue-completion\.json$/,
        );
      },
    );

    it(
      "creates and reads a durable completion bound to reservation, submission, plan, and generation record",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const generationRecordPath =
          await prepareLifecycle(
            mediaRoot,
          );

        const result =
          await createDialogueCompletion(
            mediaRoot,
            createCompletionInput(
              generationRecordPath,
            ),
            {
              now:
                () =>
                  "2026-10-01T20:03:00.000Z",
            },
          );

        expect(
          result.record,
        ).toEqual({
          schemaVersion:
            "1.0",

          completedAt:
            "2026-10-01T20:03:00.000Z",

          status:
            "COMPLETED",

          reservationId,

          episodeId:
            "EP02",

          sceneId:
            "SC01",

          shotId:
            "S02",

          dialogueLineId:
            "EP02_SC01_S02_L01",

          planKey,

          provider:
            "RUNWAY",

          providerExecutionId,

          generationRecordPath,
        });

        await expect(
          readDialogueCompletion(
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
      "requires the durable reservation and submission chain",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const generationRecordPath =
          createDialogueGenerationRecordPath(
            mediaRoot,
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            providerExecutionId,
          );

        await expect(
          createDialogueCompletion(
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
      "fails closed when the accepted submission task ID differs from completion evidence",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const generationRecordPath =
          await prepareLifecycle(
            mediaRoot,
          );

        await expect(
          createDialogueCompletion(
            mediaRoot,
            createCompletionInput(
              generationRecordPath,
              {
                providerExecutionId:
                  "task-other-999",
              },
            ),
          ),
        ).rejects.toThrow(
          /provider execution ID|task ID|submission/i,
        );
      },
    );

    it(
      "fails closed when planKey differs from the durable reservation or submission",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const generationRecordPath =
          await prepareLifecycle(
            mediaRoot,
          );

        await expect(
          createDialogueCompletion(
            mediaRoot,
            createCompletionInput(
              generationRecordPath,
              {
                planKey:
                  "c".repeat(
                    64,
                  ),
              },
            ),
          ),
        ).rejects.toThrow(
          /planKey|plan key/i,
        );
      },
    );

    it(
      "rejects a generation record path that is not the canonical path for the accepted task",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await prepareLifecycle(
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
            recursive:
              true,
          },
        );

        await writeFile(
          outsidePath,
          "{}\n",
          "utf8",
        );

        await expect(
          createDialogueCompletion(
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
      "fails closed when the canonical generation record is missing",
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

            planKey,

            provider:
              "RUNWAY",
          },
          {
            createReservationId:
              () =>
                reservationId,
          },
        );

        await createDialogueSubmission(
          mediaRoot,
          {
            reservationId,

            episodeId:
              "EP02",

            sceneId:
              "SC01",

            shotId:
              "S02",

            dialogueLineId:
              "EP02_SC01_S02_L01",

            planKey,

            provider:
              "RUNWAY",

            providerExecutionId,

            providerEstimatedCredits:
              1,

            recoveryMetadata:
              createRecoveryMetadata(),
          },
        );

        const generationRecordPath =
          createDialogueGenerationRecordPath(
            mediaRoot,
            "EP02",
            "S02",
            "EP02_SC01_S02_L01",
            "RUNWAY",
            providerExecutionId,
          );

        await expect(
          createDialogueCompletion(
            mediaRoot,
            createCompletionInput(
              generationRecordPath,
            ),
          ),
        ).rejects.toThrow(
          /generation record.*does not exist|requires.*generation record/i,
        );
      },
    );

    it(
      "blocks duplicate completion receipts",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const generationRecordPath =
          await prepareLifecycle(
            mediaRoot,
          );

        const input =
          createCompletionInput(
            generationRecordPath,
          );

        await createDialogueCompletion(
          mediaRoot,
          input,
        );

        await expect(
          createDialogueCompletion(
            mediaRoot,
            input,
          ),
        ).rejects.toThrow(
          /dialogue completion already exists/i,
        );
      },
    );

    it(
      "allows exactly one winner when two completion writes race",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const generationRecordPath =
          await prepareLifecycle(
            mediaRoot,
          );

        const input =
          createCompletionInput(
            generationRecordPath,
          );

        const attempts =
          await Promise.allSettled([
            createDialogueCompletion(
              mediaRoot,
              input,
            ),

            createDialogueCompletion(
              mediaRoot,
              input,
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

    it(
      "rejects malformed completion schema evidence",
      () => {
        expect(
          DialogueCompletionSchema.safeParse({
            schemaVersion:
              "1.0",

            completedAt:
              "2026-10-01T20:03:00.000Z",

            status:
              "COMPLETED",

            reservationId,

            episodeId:
              "EP02",

            sceneId:
              "SC01",

            shotId:
              "S02",

            dialogueLineId:
              "EP02_SC01_S02_L01",

            planKey:
              "not-a-sha256",

            provider:
              "RUNWAY",

            providerExecutionId,

            generationRecordPath:
              "D:/Busybookie/Production/example.dialogue-generation.json",
          }).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "returns null when no completion exists and fails closed on malformed durable JSON",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readDialogueCompletion(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
          ),
        ).resolves.toBeNull();

        const completionPath =
          createDialogueCompletionPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
          );

        await mkdir(
          dirname(
            completionPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          completionPath,
          "{damaged",
          "utf8",
        );

        await expect(
          readDialogueCompletion(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
          ),
        ).rejects.toThrow(
          /not valid JSON|malformed/i,
        );
      },
    );
  },
);
