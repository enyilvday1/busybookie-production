import {
  describe,
  expect,
  it,
} from "vitest";

import {
  classifyExecutionLifecycle,
} from "../src/execution/classifyExecutionLifecycle.js";

import type {
  ExecutionCompletion,
} from "../src/execution/executionCompletion.schema.js";

import type {
  ExecutionReservation,
} from "../src/execution/executionReservation.schema.js";

import type {
  ExecutionSubmission,
} from "../src/execution/executionSubmission.schema.js";

const reservation:
  ExecutionReservation = {
    schemaVersion:
      "1.0",

    reservationId:
      "11111111-1111-4111-8111-111111111111",

    reservedAt:
      "2026-09-25T18:00:00.000Z",

    status:
      "RESERVED",

    episodeId:
      "EP90",

    shotId:
      "S01",

    provider:
      "RUNWAY",
  };

const submission:
  ExecutionSubmission = {
    schemaVersion:
      "1.0",

    submittedAt:
      "2026-09-25T18:01:00.000Z",

    status:
      "SUBMITTED",

    reservationId:
      reservation.reservationId,

    episodeId:
      reservation.episodeId,

    shotId:
      reservation.shotId,

    provider:
      reservation.provider,

    providerExecutionId:
      "task-runway-123",
  };

const completion:
  ExecutionCompletion = {
    schemaVersion:
      "1.0",

    completedAt:
      "2026-09-25T18:02:00.000Z",

    status:
      "COMPLETED",

    reservationId:
      reservation.reservationId,

    episodeId:
      reservation.episodeId,

    shotId:
      reservation.shotId,

    provider:
      reservation.provider,

    providerExecutionId:
      submission.providerExecutionId,

    generationRecordPath:
      "C:/busybookie/generated-video/EP90/S01/EP90_S01_task-runway-123.runway-generation.json",
  };

describe(
  "Busybookie execution lifecycle classification",
  () => {
    it(
      "classifies an untouched shot as NOTHING",
      () => {
        expect(
          classifyExecutionLifecycle({
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
          classifyExecutionLifecycle({
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
          classifyExecutionLifecycle({
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
      "classifies a fully consistent lifecycle as COMPLETED",
      () => {
        expect(
          classifyExecutionLifecycle({
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
            classifyExecutionLifecycle({
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
      "fails closed when a completion exists without a submission",
      () => {
        expect(
          () =>
            classifyExecutionLifecycle({
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
          ExecutionSubmission = {
            ...submission,

            reservationId:
              "22222222-2222-4222-8222-222222222222",
          };

        expect(
          () =>
            classifyExecutionLifecycle({
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
      "fails closed when submission provider does not match reservation",
      () => {
        const mismatchedSubmission:
          ExecutionSubmission = {
            ...submission,

            provider:
              "VEO",
          };

        expect(
          () =>
            classifyExecutionLifecycle({
              reservation,

              submission:
                mismatchedSubmission,

              completion:
                null,
            }),
        ).toThrow(
          /provider/i,
        );
      },
    );

    it(
      "fails closed when submission episode does not match reservation",
      () => {
        const mismatchedSubmission:
          ExecutionSubmission = {
            ...submission,

            episodeId:
              "EP91",
          };

        expect(
          () =>
            classifyExecutionLifecycle({
              reservation,

              submission:
                mismatchedSubmission,

              completion:
                null,
            }),
        ).toThrow(
          /episode/i,
        );
      },
    );

    it(
      "fails closed when submission shot does not match reservation",
      () => {
        const mismatchedSubmission:
          ExecutionSubmission = {
            ...submission,

            shotId:
              "S02",
          };

        expect(
          () =>
            classifyExecutionLifecycle({
              reservation,

              submission:
                mismatchedSubmission,

              completion:
                null,
            }),
        ).toThrow(
          /shot/i,
        );
      },
    );

    it(
      "fails closed when completion reservationId does not match reservation",
      () => {
        const mismatchedCompletion:
          ExecutionCompletion = {
            ...completion,

            reservationId:
              "22222222-2222-4222-8222-222222222222",
          };

        expect(
          () =>
            classifyExecutionLifecycle({
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
      "fails closed when completion provider does not match prior lifecycle records",
      () => {
        const mismatchedCompletion:
          ExecutionCompletion = {
            ...completion,

            provider:
              "VEO",
          };

        expect(
          () =>
            classifyExecutionLifecycle({
              reservation,

              submission,

              completion:
                mismatchedCompletion,
            }),
        ).toThrow(
          /provider/i,
        );
      },
    );

    it(
      "fails closed when completion episode does not match prior lifecycle records",
      () => {
        const mismatchedCompletion:
          ExecutionCompletion = {
            ...completion,

            episodeId:
              "EP91",
          };

        expect(
          () =>
            classifyExecutionLifecycle({
              reservation,

              submission,

              completion:
                mismatchedCompletion,
            }),
        ).toThrow(
          /episode/i,
        );
      },
    );

    it(
      "fails closed when completion shot does not match prior lifecycle records",
      () => {
        const mismatchedCompletion:
          ExecutionCompletion = {
            ...completion,

            shotId:
              "S02",
          };

        expect(
          () =>
            classifyExecutionLifecycle({
              reservation,

              submission,

              completion:
                mismatchedCompletion,
            }),
        ).toThrow(
          /shot/i,
        );
      },
    );

    it(
      "fails closed when completion providerExecutionId does not match submission",
      () => {
        const mismatchedCompletion:
          ExecutionCompletion = {
            ...completion,

            providerExecutionId:
              "task-runway-different",
          };

        expect(
          () =>
            classifyExecutionLifecycle({
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
