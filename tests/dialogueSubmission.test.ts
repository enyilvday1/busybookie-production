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
  DialogueSubmissionSchema,
} from "../src/dialogue/dialogueSubmission.schema.js";

import {
  createDialogueSubmission,
} from "../src/dialogue/createDialogueSubmission.js";

import {
  createDialogueSubmissionPath,
} from "../src/dialogue/dialogueSubmissionPath.js";

import {
  readDialogueSubmission,
} from "../src/dialogue/readDialogueSubmission.js";

import type {
  DialogueGenerationRecoveryMetadata,
} from "../src/dialogue/runRunwayElevenV3Transaction.js";

async function makeTempDirectory():
  Promise<string> {
  return mkdtemp(
    join(
      tmpdir(),
      "busybookie-dialogue-submission-",
    ),
  );
}

const reservationId =
  "11111111-1111-4111-8111-111111111111";

const planKey =
  "a".repeat(
    64,
  );

const reservationDependencies =
  Object.freeze({
    now:
      () =>
        "2026-10-01T20:00:00.000Z",

    createReservationId:
      () =>
        reservationId,
  });

const submissionDependencies =
  Object.freeze({
    now:
      () =>
        "2026-10-01T20:01:00.000Z",
  });

function createRecoveryMetadata():
  DialogueGenerationRecoveryMetadata {
  return Object.freeze({
    request:
      Object.freeze({
        model:
          "eleven_v3" as const,

        promptText:
          "Look what I found!",

        voice:
          Object.freeze({
            type:
              "runway-preset" as const,

            presetId:
              "Chad" as const,
          }),

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
      }),

    locallyExpectedCredits:
      1,

    plan:
      Object.freeze({
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

        voice:
          Object.freeze({
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
          }),
      }),
  });
}

function createSubmissionInput(
  overrides:
    Partial<{
      reservationId: string;
      episodeId: string;
      sceneId: string;
      shotId: string;
      dialogueLineId: string;
      planKey: string;
      providerExecutionId: string;
      providerEstimatedCredits: number;
      recoveryMetadata:
        DialogueGenerationRecoveryMetadata;
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

    providerExecutionId:
      "task-dialogue-123",

    providerEstimatedCredits:
      1,

    recoveryMetadata:
      createRecoveryMetadata(),

    ...overrides,
  };
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

      planKey,

      provider:
        "RUNWAY",
    },
    reservationDependencies,
  );
}

describe(
  "Busybookie dialogue paid-generation submission receipt",
  () => {
    it(
      "creates a deterministic line-scoped submission path",
      () => {
        const result =
          createDialogueSubmissionPath(
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
          /D:\/Busybookie\/Production\/voices\/EP02\/S02\/EP02_SC01_S02_L01\/EP02_SC01_S02_L01\.dialogue-submission\.json$/,
        );
      },
    );

    it(
      "creates and reads a durable submission containing all metadata required to resume the accepted paid task",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createReservation(
          mediaRoot,
        );

        const input =
          createSubmissionInput();

        const result =
          await createDialogueSubmission(
            mediaRoot,
            input,
            submissionDependencies,
          );

        expect(
          result.record,
        ).toEqual({
          schemaVersion:
            "1.0",

          submittedAt:
            "2026-10-01T20:01:00.000Z",

          status:
            "SUBMITTED",

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

          providerExecutionId:
            "task-dialogue-123",

          providerEstimatedCredits:
            1,

          recoveryMetadata:
            input.recoveryMetadata,
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
      "requires the existing durable reservation before accepting a submission receipt",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          createDialogueSubmission(
            mediaRoot,
            createSubmissionInput(),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /requires an existing.*reservation|reservation.*required/i,
        );
      },
    );

    it(
      "fails closed when the submission reservation ID differs from the durable reservation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createReservation(
          mediaRoot,
        );

        await expect(
          createDialogueSubmission(
            mediaRoot,
            createSubmissionInput({
              reservationId:
                "22222222-2222-4222-8222-222222222222",
            }),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /reservation ID.*does not match|does not match.*reservation/i,
        );
      },
    );

    it(
      "fails closed when the submission plan key differs from the durable reservation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createReservation(
          mediaRoot,
        );

        await expect(
          createDialogueSubmission(
            mediaRoot,
            createSubmissionInput({
              planKey:
                "b".repeat(
                  64,
                ),
            }),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /planKey|plan key/i,
        );
      },
    );

    it(
      "fails closed when recovery metadata does not match the reserved canonical dialogue identity",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createReservation(
          mediaRoot,
        );

        const recoveryMetadata =
          createRecoveryMetadata();

        const conflictingRecoveryMetadata =
          {
            ...recoveryMetadata,

            plan: {
              ...recoveryMetadata.plan,

              planKey:
                "b".repeat(
                  64,
                ),
            },
          } as DialogueGenerationRecoveryMetadata;

        await expect(
          createDialogueSubmission(
            mediaRoot,
            createSubmissionInput({
              recoveryMetadata:
                conflictingRecoveryMetadata,
            }),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /recovery.*plan|planKey|plan key/i,
        );
      },
    );

    it(
      "blocks a duplicate submission even when a different provider task ID is supplied",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createReservation(
          mediaRoot,
        );

        await createDialogueSubmission(
          mediaRoot,
          createSubmissionInput(),
          submissionDependencies,
        );

        await expect(
          createDialogueSubmission(
            mediaRoot,
            createSubmissionInput({
              providerExecutionId:
                "task-dialogue-other-456",
            }),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /dialogue submission already exists/i,
        );
      },
    );

    it(
      "allows exactly one winner when two submission writes race",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createReservation(
          mediaRoot,
        );

        const attempts =
          await Promise.allSettled([
            createDialogueSubmission(
              mediaRoot,
              createSubmissionInput(),
              submissionDependencies,
            ),

            createDialogueSubmission(
              mediaRoot,
              createSubmissionInput(),
              submissionDependencies,
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

    it.each([
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ])(
      "rejects invalid provider-estimated credits %s",
      (
        invalidCredits,
      ) => {
        expect(
          DialogueSubmissionSchema.safeParse({
            schemaVersion:
              "1.0",

            submittedAt:
              "2026-10-01T20:01:00.000Z",

            status:
              "SUBMITTED",

            ...createSubmissionInput({
              providerEstimatedCredits:
                invalidCredits,
            }),
          }).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects a receipt whose recovery request no longer matches its immutable plan snapshot",
      () => {
        const recoveryMetadata =
          createRecoveryMetadata();

        expect(
          DialogueSubmissionSchema.safeParse({
            schemaVersion:
              "1.0",

            submittedAt:
              "2026-10-01T20:01:00.000Z",

            status:
              "SUBMITTED",

            ...createSubmissionInput({
              recoveryMetadata: {
                ...recoveryMetadata,

                request: {
                  ...recoveryMetadata.request,

                  promptText:
                    "Different dialogue.",
                },
              },
            }),
          }).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "treats an existing malformed submission file as blocking and fails closed when read",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createReservation(
          mediaRoot,
        );

        const submissionPath =
          createDialogueSubmissionPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
          );

        await mkdir(
          dirname(
            submissionPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          submissionPath,
          "{damaged",
          "utf8",
        );

        await expect(
          createDialogueSubmission(
            mediaRoot,
            createSubmissionInput(),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /dialogue submission already exists/i,
        );

        await expect(
          readDialogueSubmission(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
          ),
        ).rejects.toThrow(
          /not valid JSON/i,
        );
      },
    );

    it(
      "returns null when no durable submission exists",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readDialogueSubmission(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
          ),
        ).resolves.toBeNull();
      },
    );
  },
);
