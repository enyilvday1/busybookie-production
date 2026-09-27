import {
  mkdir,
  mkdtemp,
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
  createExecutionCompletion,
} from "../src/execution/createExecutionCompletion.js";

import {
  createExecutionReservation,
} from "../src/execution/createExecutionReservation.js";

import {
  createExecutionSubmission,
} from "../src/execution/createExecutionSubmission.js";

import {
  createExecutionReservationPath,
} from "../src/execution/executionReservationPath.js";

import {
  createExecutionSubmissionPath,
} from "../src/execution/executionSubmissionPath.js";

import {
  inspectExecutionLifecycle,
} from "../src/execution/inspectExecutionLifecycle.js";

const temporaryDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-execution-lifecycle-inspection-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

const reservationDependencies = {
  now: () =>
    "2026-09-25T19:00:00.000Z",

  createReservationId: () =>
    "11111111-1111-4111-8111-111111111111",
};

const submissionDependencies = {
  now: () =>
    "2026-09-25T19:01:00.000Z",
};

const completionDependencies = {
  now: () =>
    "2026-09-25T19:02:00.000Z",
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

async function prepareSubmission(
  mediaRoot:
    string,
) {
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

  const submission =
    await createExecutionSubmission(
      mediaRoot,
      {
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
          "task-runway-inspection-123",

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
              "Busybookie lifecycle inspection recovery test.",

            sourceImagePath:
              "D:/Busybookie/Production/references/EP90/S01/reference.png",

            assetStrategy:
              "DATA_URI",
          },

          locallyExpectedCredits:
            60,
        },
      },
      submissionDependencies,
    );

  return {
    reservation,
    submission,
  };
}

describe(
  "Busybookie execution lifecycle inspection",
  () => {
    it(
      "reports NOTHING when no durable lifecycle records exist",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          inspectExecutionLifecycle(
            mediaRoot,
            "EP90",
            "S01",
          ),
        ).resolves.toEqual({
          state:
            "NOTHING",
        });
      },
    );

    it(
      "reports RESERVED_ONLY from the durable reservation",
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

        await expect(
          inspectExecutionLifecycle(
            mediaRoot,
            "EP90",
            "S01",
          ),
        ).resolves.toEqual({
          state:
            "RESERVED_ONLY",

          reservation:
            reservation.record,
        });
      },
    );

    it(
      "reports SUBMITTED from durable reservation and submission records",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const {
          reservation,
          submission,
        } =
          await prepareSubmission(
            mediaRoot,
          );

        await expect(
          inspectExecutionLifecycle(
            mediaRoot,
            "EP90",
            "S01",
          ),
        ).resolves.toEqual({
          state:
            "SUBMITTED",

          reservation:
            reservation.record,

          submission:
            submission.record,
        });
      },
    );

    it(
      "reports COMPLETED from a fully durable lifecycle",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const {
          reservation,
          submission,
        } =
          await prepareSubmission(
            mediaRoot,
          );

        const generationRecordPath =
          join(
            mediaRoot,
            "generated-video",
            "EP90",
            "S01",
            "EP90_S01_task-runway-inspection-123.runway-generation.json",
          );

        await mkdir(
          dirname(
            generationRecordPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          generationRecordPath,
          "{}\n",
          "utf8",
        );

        const completion =
          await createExecutionCompletion(
            mediaRoot,
            {
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
                submission.record
                  .providerExecutionId,

              generationRecordPath,
            },
            completionDependencies,
          );

        await expect(
          inspectExecutionLifecycle(
            mediaRoot,
            "EP90",
            "S01",
          ),
        ).resolves.toEqual({
          state:
            "COMPLETED",

          reservation:
            reservation.record,

          submission:
            submission.record,

          completion:
            completion.record,
        });
      },
    );

    it(
      "fails closed when a durable reservation record is malformed",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const reservationPath =
          createExecutionReservationPath(
            mediaRoot,
            "EP90",
            "S01",
          );

        await mkdir(
          dirname(
            reservationPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          reservationPath,
          "{not-valid-json",
          "utf8",
        );

        await expect(
          inspectExecutionLifecycle(
            mediaRoot,
            "EP90",
            "S01",
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "fails closed when a submission exists without a reservation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const submissionPath =
          createExecutionSubmissionPath(
            mediaRoot,
            "EP90",
            "S01",
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
          JSON.stringify(
            {
              schemaVersion:
                "1.0",

              submittedAt:
                "2026-09-25T19:01:00.000Z",

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
                "task-orphan-submission",
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );

        await expect(
          inspectExecutionLifecycle(
            mediaRoot,
            "EP90",
            "S01",
          ),
        ).rejects.toThrow(
          /reservation/i,
        );
      },
    );
  },
);
