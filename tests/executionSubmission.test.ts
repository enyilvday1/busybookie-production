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
  createExecutionReservation,
} from "../src/execution/createExecutionReservation.js";

import {
  createExecutionSubmission,
} from "../src/execution/createExecutionSubmission.js";

import {
  ExecutionSubmissionSchema,
} from "../src/execution/executionSubmission.schema.js";

import {
  createExecutionSubmissionPath,
} from "../src/execution/executionSubmissionPath.js";

import {
  readExecutionSubmission,
} from "../src/execution/readExecutionSubmission.js";

const temporaryDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-execution-submission-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

const reservationDependencies = {
  now: () =>
    "2026-09-24T12:00:00.000Z",

  createReservationId: () =>
    "11111111-1111-4111-8111-111111111111",
};

const submissionDependencies = {
  now: () =>
    "2026-09-24T12:01:00.000Z",
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
  "Busybookie execution submission",
  () => {
    it(
      "uses one provider-neutral submission path per episode shot",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        expect(
          createExecutionSubmissionPath(
            mediaRoot,
            "EP90",
            "S01",
          ),
        ).toBe(
          join(
            mediaRoot,
            "generated-video",
            "EP90",
            "S01",
            "EP90_S01.execution-submission.json",
          ),
        );
      },
    );

    it(
      "creates and reads a durable Runway submission linked to its reservation",
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

        const result =
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
                "task-runway-123",

              providerEstimatedCredits:
                60,
            },
            submissionDependencies,
          );

        expect(
          result.record,
        ).toEqual({
          schemaVersion:
            "1.1",

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
            "task-runway-123",

          providerEstimatedCredits:
            60,
        });

        const stored =
          JSON.parse(
            await readFile(
              result.submissionPath,
              "utf8",
            ),
          );

        expect(
          stored,
        ).toEqual(
          result.record,
        );

        await expect(
          readExecutionSubmission(
            mediaRoot,
            "EP90",
            "S01",
          ),
        ).resolves.toEqual(
          result.record,
        );
      },
    );

    it(
      "creates a durable Veo submission with an operation name",
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

        const result =
          await createExecutionSubmission(
            mediaRoot,
            {
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
            },
            submissionDependencies,
          );

        expect(
          result.record.provider,
        ).toBe(
          "VEO",
        );

        expect(
          result.record
            .providerExecutionId,
        ).toBe(
          "models/veo/operations/123",
        );
      },
    );

    it(
      "requires an existing durable reservation before recording submission",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          createExecutionSubmission(
            mediaRoot,
            {
              reservationId:
                "11111111-1111-4111-8111-111111111111",

              episodeId:
                "EP90",

              shotId:
                "S01",

              provider:
                "RUNWAY",

              providerExecutionId:
                "task-without-reservation",

              providerEstimatedCredits:
                60,
            },
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /reservation/i,
        );
      },
    );

    it(
      "rejects a reservation ID that does not match the durable reservation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

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
          createExecutionSubmission(
            mediaRoot,
            {
              reservationId:
                "22222222-2222-4222-8222-222222222222",

              episodeId:
                "EP90",

              shotId:
                "S01",

              provider:
                "RUNWAY",

              providerExecutionId:
                "task-wrong-reservation",

              providerEstimatedCredits:
                60,
            },
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /reservation/i,
        );
      },
    );

    it(
      "rejects a provider that does not match the durable reservation",
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
          createExecutionSubmission(
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
                "VEO",

              providerExecutionId:
                "operation-provider-mismatch",
            },
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /provider/i,
        );
      },
    );

    it(
      "rejects an empty provider execution ID",
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
          createExecutionSubmission(
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
                "   ",

              providerEstimatedCredits:
                60,
            },
            submissionDependencies,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "blocks a duplicate submission receipt for the same shot",
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

        const input = {
          reservationId:
            reservation.record
              .reservationId,

          episodeId:
            "EP90",

          shotId:
            "S01",

          provider:
            "RUNWAY" as const,

          providerExecutionId:
            "task-once-only",

          providerEstimatedCredits:
            60,
        };

        await createExecutionSubmission(
          mediaRoot,
          input,
          submissionDependencies,
        );

        await expect(
          createExecutionSubmission(
            mediaRoot,
            input,
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /execution submission already exists/i,
        );
      },
    );

    it(
      "allows exactly one winner when two submission writes race",
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

        const input = {
          reservationId:
            reservation.record
              .reservationId,

          episodeId:
            "EP90",

          shotId:
            "S01",

          provider:
            "RUNWAY" as const,

          providerExecutionId:
            "task-race",

          providerEstimatedCredits:
            60,
        };

        const attempts =
          await Promise.allSettled([
            createExecutionSubmission(
              mediaRoot,
              input,
              submissionDependencies,
            ),

            createExecutionSubmission(
              mediaRoot,
              input,
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

    it(
      "rejects MANUAL as a paid submission provider",
      () => {
        const parsed =
          ExecutionSubmissionSchema
            .safeParse({
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
                "MANUAL",

              providerExecutionId:
                "manual-123",
            });

        expect(
          parsed.success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "returns null when no submission receipt exists",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readExecutionSubmission(
            mediaRoot,
            "EP90",
            "S01",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "treats an existing malformed submission file as blocking and fails closed when read",
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
          "{damaged",
          "utf8",
        );

        await expect(
          createExecutionSubmission(
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
                "task-after-damage",

              providerEstimatedCredits:
                60,
            },
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /execution submission already exists/i,
        );

        await expect(
          readExecutionSubmission(
            mediaRoot,
            "EP90",
            "S01",
          ),
        ).rejects.toThrow(
          /not valid JSON/i,
        );
      },
    );
  },
);
