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
      "persists Runway acceptance and recovery metadata in submission schema version 1.2",
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

            recoveryMetadata: {
              request: {
                durationSeconds:
                  5,

                ratio:
                  "1280:720",

                outputFormat:
                  "mp4",

                promptText:
                  "Busybookie durable submission recovery metadata test.",

                sourceImagePath:
                  "D:/Busybookie/Production/references/EP90/S01/reference.png",

                assetStrategy:
                  "DATA_URI",
              },

              locallyExpectedCredits:
                60,
            },
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
            "1.2",

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

          recoveryMetadata: {
            request: {
              durationSeconds:
                5,

              ratio:
                "1280:720",

              outputFormat:
                "mp4",

              promptText:
                "Busybookie durable submission recovery metadata test.",

              sourceImagePath:
                "D:/Busybookie/Production/references/EP90/S01/reference.png",

              assetStrategy:
                "DATA_URI",
            },

            locallyExpectedCredits:
              60,
          },
        });
      },
    );

    it(
      "persists Veo acceptance and recovery metadata in submission schema version 1.3",
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

            recoveryMetadata: {
              request: {
                durationSeconds:
                  4,

                aspectRatio:
                  "16:9",

                resolution:
                  "720p",

                numberOfVideos:
                  1,

                nativeAudioExpected:
                  true,

                expectedOutputFps:
                  24,

                promptText:
                  "Busybookie durable Veo submission recovery metadata test.",

                sourceImagePath:
                  "D:/Busybookie/Production/references/EP91/S01/reference.png",

                imageMimeType:
                  "image/png",
              },

              costPolicy: {
                pricingReviewedOn:
                  "2026-09-22",

                centsPerSecond:
                  10,

                locallyExpectedCents:
                  40,
              },
            },
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
            "1.3",

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

          recoveryMetadata: {
            request: {
              durationSeconds:
                4,

              aspectRatio:
                "16:9",

              resolution:
                "720p",

              numberOfVideos:
                1,

              nativeAudioExpected:
                true,

              expectedOutputFps:
                24,

              promptText:
                "Busybookie durable Veo submission recovery metadata test.",

              sourceImagePath:
                "D:/Busybookie/Production/references/EP91/S01/reference.png",

              imageMimeType:
                "image/png",
            },

            costPolicy: {
              pricingReviewedOn:
                "2026-09-22",

              centsPerSecond:
                10,

              locallyExpectedCents:
                40,
            },
          },
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
