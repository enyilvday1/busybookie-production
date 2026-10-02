import {
  describe,
  expect,
  it,
} from "vitest";

import {
  classifyDialogueLifecycle,
} from "../src/dialogue/classifyDialogueLifecycle.js";

import type {
  DialogueCompletion,
} from "../src/dialogue/dialogueCompletion.schema.js";

import type {
  DialogueReservation,
} from "../src/dialogue/dialogueReservation.schema.js";

import type {
  DialogueSubmission,
} from "../src/dialogue/dialogueSubmission.schema.js";

const reservation:
  DialogueReservation = {
    schemaVersion:
      "1.0",

    reservationId:
      "11111111-1111-4111-8111-111111111111",

    reservedAt:
      "2026-10-01T22:00:00.000Z",

    status:
      "RESERVED",

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
  };

const recoveryMetadata =
  Object.freeze({
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

    plan: {
      planKey:
        reservation.planKey,

      episodeId:
        reservation.episodeId,

      sceneId:
        reservation.sceneId,

      shotId:
        reservation.shotId,

      dialogueLineId:
        reservation.dialogueLineId,

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
    },
  });

const submission:
  DialogueSubmission = {
    schemaVersion:
      "1.0",

    submittedAt:
      "2026-10-01T22:01:00.000Z",

    status:
      "SUBMITTED",

    reservationId:
      reservation.reservationId,

    episodeId:
      reservation.episodeId,

    sceneId:
      reservation.sceneId,

    shotId:
      reservation.shotId,

    dialogueLineId:
      reservation.dialogueLineId,

    planKey:
      reservation.planKey,

    provider:
      reservation.provider,

    providerExecutionId:
      "task-dialogue-123",

    providerEstimatedCredits:
      1,

    recoveryMetadata,
  };

const completion:
  DialogueCompletion = {
    schemaVersion:
      "1.0",

    completedAt:
      "2026-10-01T22:02:00.000Z",

    status:
      "COMPLETED",

    reservationId:
      reservation.reservationId,

    episodeId:
      reservation.episodeId,

    sceneId:
      reservation.sceneId,

    shotId:
      reservation.shotId,

    dialogueLineId:
      reservation.dialogueLineId,

    planKey:
      reservation.planKey,

    provider:
      reservation.provider,

    providerExecutionId:
      submission.providerExecutionId,

    generationRecordPath:
      "D:/Busybookie/Production/voices/EP02/S02/EP02_SC01_S02_L01/EP02_SC01_S02_L01_RUNWAY_task-dialogue-123.dialogue-generation.json",
  };

describe(
  "Busybookie dialogue lifecycle classification",
  () => {
    it(
      "classifies an untouched dialogue line as NOTHING",
      () => {
        expect(
          classifyDialogueLifecycle({
            reservation:
              null,

            submission:
              null,

            completion:
              null,
          }),
        ).toEqual({
          state:
            "NOTHING",
        });
      },
    );

    it(
      "classifies reservation-only state as RESERVED_ONLY",
      () => {
        expect(
          classifyDialogueLifecycle({
            reservation,

            submission:
              null,

            completion:
              null,
          }),
        ).toEqual({
          state:
            "RESERVED_ONLY",

          reservation,
        });
      },
    );

    it(
      "classifies reservation plus submission as SUBMITTED",
      () => {
        expect(
          classifyDialogueLifecycle({
            reservation,

            submission,

            completion:
              null,
          }),
        ).toEqual({
          state:
            "SUBMITTED",

          reservation,

          submission,
        });
      },
    );

    it(
      "classifies a fully consistent dialogue lifecycle as COMPLETED",
      () => {
        expect(
          classifyDialogueLifecycle({
            reservation,

            submission,

            completion,
          }),
        ).toEqual({
          state:
            "COMPLETED",

          reservation,

          submission,

          completion,
        });
      },
    );

    it(
      "fails closed when a submission exists without a reservation",
      () => {
        expect(
          () =>
            classifyDialogueLifecycle({
              reservation:
                null,

              submission,

              completion:
                null,
            }),
        ).toThrow(
          /reservation/i,
        );
      },
    );

    it(
      "fails closed when a completion exists without a reservation",
      () => {
        expect(
          () =>
            classifyDialogueLifecycle({
              reservation:
                null,

              submission:
                null,

              completion,
            }),
        ).toThrow(
          /reservation/i,
        );
      },
    );

    it(
      "fails closed when a completion exists without a submission",
      () => {
        expect(
          () =>
            classifyDialogueLifecycle({
              reservation,

              submission:
                null,

              completion,
            }),
        ).toThrow(
          /submission/i,
        );
      },
    );

    it(
      "fails closed when submission reservationId does not match reservation",
      () => {
        const mismatchedSubmission:
          DialogueSubmission = {
            ...submission,

            reservationId:
              "22222222-2222-4222-8222-222222222222",
          };

        expect(
          () =>
            classifyDialogueLifecycle({
              reservation,

              submission:
                mismatchedSubmission,

              completion:
                null,
            }),
        ).toThrow(
          /reservation.*id|reservationId/i,
        );
      },
    );

    it(
      "fails closed when submission scene does not match reservation",
      () => {
        const mismatchedSubmission =
          {
            ...submission,

            sceneId:
              "SC02",
          } as DialogueSubmission;

        expect(
          () =>
            classifyDialogueLifecycle({
              reservation,

              submission:
                mismatchedSubmission,

              completion:
                null,
            }),
        ).toThrow(
          /scene/i,
        );
      },
    );

    it(
      "fails closed when submission dialogue line does not match reservation",
      () => {
        const mismatchedSubmission =
          {
            ...submission,

            dialogueLineId:
              "EP02_SC01_S02_L02",
          } as DialogueSubmission;

        expect(
          () =>
            classifyDialogueLifecycle({
              reservation,

              submission:
                mismatchedSubmission,

              completion:
                null,
            }),
        ).toThrow(
          /dialogue.*line|line/i,
        );
      },
    );

    it(
      "fails closed when submission planKey does not match reservation",
      () => {
        const mismatchedSubmission =
          {
            ...submission,

            planKey:
              "b".repeat(
                64,
              ),
          } as DialogueSubmission;

        expect(
          () =>
            classifyDialogueLifecycle({
              reservation,

              submission:
                mismatchedSubmission,

              completion:
                null,
            }),
        ).toThrow(
          /planKey|plan key/i,
        );
      },
    );

    it(
      "fails closed when completion reservationId does not match reservation",
      () => {
        const mismatchedCompletion:
          DialogueCompletion = {
            ...completion,

            reservationId:
              "22222222-2222-4222-8222-222222222222",
          };

        expect(
          () =>
            classifyDialogueLifecycle({
              reservation,

              submission,

              completion:
                mismatchedCompletion,
            }),
        ).toThrow(
          /reservation.*id|reservationId/i,
        );
      },
    );

    it(
      "fails closed when completion scene does not match prior lifecycle records",
      () => {
        const mismatchedCompletion =
          {
            ...completion,

            sceneId:
              "SC02",
          } as DialogueCompletion;

        expect(
          () =>
            classifyDialogueLifecycle({
              reservation,

              submission,

              completion:
                mismatchedCompletion,
            }),
        ).toThrow(
          /scene/i,
        );
      },
    );

    it(
      "fails closed when completion dialogue line does not match prior lifecycle records",
      () => {
        const mismatchedCompletion =
          {
            ...completion,

            dialogueLineId:
              "EP02_SC01_S02_L02",
          } as DialogueCompletion;

        expect(
          () =>
            classifyDialogueLifecycle({
              reservation,

              submission,

              completion:
                mismatchedCompletion,
            }),
        ).toThrow(
          /dialogue.*line|line/i,
        );
      },
    );

    it(
      "fails closed when completion planKey does not match prior lifecycle records",
      () => {
        const mismatchedCompletion =
          {
            ...completion,

            planKey:
              "b".repeat(
                64,
              ),
          } as DialogueCompletion;

        expect(
          () =>
            classifyDialogueLifecycle({
              reservation,

              submission,

              completion:
                mismatchedCompletion,
            }),
        ).toThrow(
          /planKey|plan key/i,
        );
      },
    );

    it(
      "fails closed when completion provider execution ID does not match submission",
      () => {
        const mismatchedCompletion:
          DialogueCompletion = {
            ...completion,

            providerExecutionId:
              "task-dialogue-different",
          };

        expect(
          () =>
            classifyDialogueLifecycle({
              reservation,

              submission,

              completion:
                mismatchedCompletion,
            }),
        ).toThrow(
          /provider.*execution.*id|providerExecutionId/i,
        );
      },
    );
  },
);
