import {
  mkdtemp,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createExecutionReservation,
} from "../src/execution/createExecutionReservation.js";

import {
  createExecutionSubmission,
} from "../src/execution/createExecutionSubmission.js";

import {
  ExecutionSubmissionInputSchema,
  ExecutionSubmissionSchema,
} from "../src/execution/executionSubmission.schema.js";

const temporaryDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-submission-acceptance-metadata-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

const reservationDependencies = {
  now: () =>
    "2026-09-25T20:10:00.000Z",

  createReservationId: () =>
    "11111111-1111-4111-8111-111111111111",
};

const submissionDependencies = {
  now: () =>
    "2026-09-25T20:11:00.000Z",
};

afterEach(
  async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map(
          (directory) =>
            rm(
              directory,
              {
                recursive:
                  true,

                force:
                  true,
              },
            ),
        ),
    );
  },
);

describe(
  "Busybookie execution submission acceptance metadata",
  () => {
    it(
      "requires provider estimated credits for a new Runway submission",
      () => {
        expect(
          () =>
            ExecutionSubmissionInputSchema.parse({
              reservationId:
                "11111111-1111-4111-8111-111111111111",

              episodeId:
                "EP90",

              shotId:
                "S01",

              provider:
                "RUNWAY",

              providerExecutionId:
                "task-runway-123",
            }),
        ).toThrow(
          /estimated.*credits|providerEstimatedCredits/i,
        );
      },
    );

    it(
      "persists Runway acceptance-time estimated credits in submission schema version 1.1",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const reservation =
          await createExecutionReservation(
            mediaRoot,
            {
              episodeId:
                "EP90",

              shotId:
                "S01",

              provider:
                "RUNWAY",
            },
            reservationDependencies,
          );

        const input =
          ExecutionSubmissionInputSchema.parse({
            reservationId:
              reservation.record
                .reservationId,

            episodeId:
              "EP90",

            shotId:
              "S01",

            provider:
              "RUNWAY",

            providerExecutionId:
              "task-runway-123",

            providerEstimatedCredits:
              60,
          });

        const submission =
          await createExecutionSubmission(
            mediaRoot,
            input,
            submissionDependencies,
          );

        expect(
          submission.record,
        ).toEqual({
          schemaVersion:
            "1.1",

          submittedAt:
            "2026-09-25T20:11:00.000Z",

          status:
            "SUBMITTED",

          reservationId:
            reservation.record
              .reservationId,

          episodeId:
            "EP90",

          shotId:
            "S01",

          provider:
            "RUNWAY",

          providerExecutionId:
            "task-runway-123",

          providerEstimatedCredits:
            60,
        });
      },
    );

    it(
      "continues to persist new Veo submissions as schema version 1.0 without Runway credit metadata",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const reservation =
          await createExecutionReservation(
            mediaRoot,
            {
              episodeId:
                "EP91",

              shotId:
                "S01",

              provider:
                "VEO",
            },
            reservationDependencies,
          );

        const input =
          ExecutionSubmissionInputSchema.parse({
            reservationId:
              reservation.record
                .reservationId,

            episodeId:
              "EP91",

            shotId:
              "S01",

            provider:
              "VEO",

            providerExecutionId:
              "models/veo/operations/123",
          });

        const submission =
          await createExecutionSubmission(
            mediaRoot,
            input,
            submissionDependencies,
          );

        expect(
          submission.record,
        ).toEqual({
          schemaVersion:
            "1.0",

          submittedAt:
            "2026-09-25T20:11:00.000Z",

          status:
            "SUBMITTED",

          reservationId:
            reservation.record
              .reservationId,

          episodeId:
            "EP91",

          shotId:
            "S01",

          provider:
            "VEO",

          providerExecutionId:
            "models/veo/operations/123",
        });
      },
    );

    it(
      "continues to parse a legacy Runway schema version 1.0 submission without estimated credits",
      () => {
        expect(
          ExecutionSubmissionSchema.parse({
            schemaVersion:
              "1.0",

            submittedAt:
              "2026-09-24T12:01:00.000Z",

            status:
              "SUBMITTED",

            reservationId:
              "11111111-1111-4111-8111-111111111111",

            episodeId:
              "EP90",

            shotId:
              "S01",

            provider:
              "RUNWAY",

            providerExecutionId:
              "legacy-task-123",
          }),
        ).toEqual({
          schemaVersion:
            "1.0",

          submittedAt:
            "2026-09-24T12:01:00.000Z",

          status:
            "SUBMITTED",

          reservationId:
            "11111111-1111-4111-8111-111111111111",

          episodeId:
            "EP90",

          shotId:
            "S01",

          provider:
            "RUNWAY",

          providerExecutionId:
            "legacy-task-123",
        });
      },
    );
  },
);
