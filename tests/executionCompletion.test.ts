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
  ExecutionCompletionSchema,
} from "../src/execution/executionCompletion.schema.js";

import {
  createExecutionCompletionPath,
} from "../src/execution/executionCompletionPath.js";

import {
  readExecutionCompletion,
} from "../src/execution/readExecutionCompletion.js";

const temporaryDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-execution-completion-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

const reservationDependencies = {
  now: () =>
    "2026-09-24T16:00:00.000Z",

  createReservationId: () =>
    "11111111-1111-4111-8111-111111111111",
};

const submissionDependencies = {
  now: () =>
    "2026-09-24T16:01:00.000Z",
};

const completionDependencies = {
  now: () =>
    "2026-09-24T16:02:00.000Z",
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

async function prepareRunwaySubmission(
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
          "task-completion-123",

        providerEstimatedCredits:
          60,
      },
      submissionDependencies,
    );

  return {
    reservation,
    submission,
  };
}

async function createGenerationRecord(
  mediaRoot:
    string,
  fileName:
    string,
): Promise<string> {
  const recordPath =
    join(
      mediaRoot,
      "generated-video",
      "EP90",
      "S01",
      fileName,
    );

  await mkdir(
    dirname(
      recordPath,
    ),
    {
      recursive:
        true,
    },
  );

  await writeFile(
    recordPath,
    "{}\n",
    "utf8",
  );

  return recordPath;
}

describe(
  "Busybookie execution completion",
  () => {
    it(
      "uses one provider-neutral completion path per episode shot",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        expect(
          createExecutionCompletionPath(
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
            "EP90_S01.execution-completion.json",
          ),
        );
      },
    );

    it(
      "creates and reads a durable completion linked to reservation and submission",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const {
          reservation,
        } =
          await prepareRunwaySubmission(
            mediaRoot,
          );

        const generationRecordPath =
          await createGenerationRecord(
            mediaRoot,
            "EP90_S01_task-completion-123.runway-generation.json",
          );

        const result =
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
                "task-completion-123",

              generationRecordPath,
            },
            completionDependencies,
          );

        expect(
          result.record,
        ).toEqual({
          schemaVersion:
            "1.0",

          completedAt:
            "2026-09-24T16:02:00.000Z",

          status:
            "COMPLETED",

          reservationId:
            "11111111-1111-4111-8111-111111111111",

          episodeId:
            "EP90",

          shotId:
            "S01",

          provider:
            "RUNWAY",

          providerExecutionId:
            "task-completion-123",

          generationRecordPath,
        });

        await expect(
          readExecutionCompletion(
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
      "requires an existing reservation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const generationRecordPath =
          await createGenerationRecord(
            mediaRoot,
            "orphan.runway-generation.json",
          );

        await expect(
          createExecutionCompletion(
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
                "task-orphan",

              generationRecordPath,
            },
            completionDependencies,
          ),
        ).rejects.toThrow(
          /reservation/i,
        );
      },
    );

    it(
      "requires an existing submission",
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

        const generationRecordPath =
          await createGenerationRecord(
            mediaRoot,
            "missing-submission.runway-generation.json",
          );

        await expect(
          createExecutionCompletion(
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
                "task-missing-submission",

              generationRecordPath,
            },
            completionDependencies,
          ),
        ).rejects.toThrow(
          /submission/i,
        );
      },
    );

    it(
      "rejects a provider execution ID that does not match submission",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const {
          reservation,
        } =
          await prepareRunwaySubmission(
            mediaRoot,
          );

        const generationRecordPath =
          await createGenerationRecord(
            mediaRoot,
            "wrong-id.runway-generation.json",
          );

        await expect(
          createExecutionCompletion(
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
                "task-wrong",

              generationRecordPath,
            },
            completionDependencies,
          ),
        ).rejects.toThrow(
          /provider execution/i,
        );
      },
    );

    it(
      "rejects a reservation ID that does not match the durable lifecycle",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await prepareRunwaySubmission(
          mediaRoot,
        );

        const generationRecordPath =
          await createGenerationRecord(
            mediaRoot,
            "wrong-reservation.runway-generation.json",
          );

        await expect(
          createExecutionCompletion(
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
                "task-completion-123",

              generationRecordPath,
            },
            completionDependencies,
          ),
        ).rejects.toThrow(
          /reservation/i,
        );
      },
    );

    it(
      "rejects a provider that does not match the lifecycle",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const {
          reservation,
        } =
          await prepareRunwaySubmission(
            mediaRoot,
          );

        const generationRecordPath =
          await createGenerationRecord(
            mediaRoot,
            "wrong-provider.runway-generation.json",
          );

        await expect(
          createExecutionCompletion(
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
                "task-completion-123",

              generationRecordPath,
            },
            completionDependencies,
          ),
        ).rejects.toThrow(
          /provider/i,
        );
      },
    );

    it(
      "requires the generation record to exist",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const {
          reservation,
        } =
          await prepareRunwaySubmission(
            mediaRoot,
          );

        const missingPath =
          join(
            mediaRoot,
            "generated-video",
            "EP90",
            "S01",
            "missing.runway-generation.json",
          );

        await expect(
          createExecutionCompletion(
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
                "task-completion-123",

              generationRecordPath:
                missingPath,
            },
            completionDependencies,
          ),
        ).rejects.toThrow(
          /generation record/i,
        );
      },
    );

    it(
      "rejects a generation record outside the selected shot directory",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const {
          reservation,
        } =
          await prepareRunwaySubmission(
            mediaRoot,
          );

        const outsidePath =
          join(
            mediaRoot,
            "generated-video",
            "EP90",
            "S02",
            "outside.runway-generation.json",
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
          createExecutionCompletion(
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
                "task-completion-123",

              generationRecordPath:
                outsidePath,
            },
            completionDependencies,
          ),
        ).rejects.toThrow(
          /shot directory/i,
        );
      },
    );

    it(
      "blocks a duplicate completion receipt",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const {
          reservation,
        } =
          await prepareRunwaySubmission(
            mediaRoot,
          );

        const generationRecordPath =
          await createGenerationRecord(
            mediaRoot,
            "duplicate.runway-generation.json",
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
            "task-completion-123",

          generationRecordPath,
        };

        await createExecutionCompletion(
          mediaRoot,
          input,
          completionDependencies,
        );

        await expect(
          createExecutionCompletion(
            mediaRoot,
            input,
            completionDependencies,
          ),
        ).rejects.toThrow(
          /execution completion already exists/i,
        );
      },
    );

    it(
      "allows exactly one winner when two completion writes race",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const {
          reservation,
        } =
          await prepareRunwaySubmission(
            mediaRoot,
          );

        const generationRecordPath =
          await createGenerationRecord(
            mediaRoot,
            "race.runway-generation.json",
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
            "task-completion-123",

          generationRecordPath,
        };

        const attempts =
          await Promise.allSettled([
            createExecutionCompletion(
              mediaRoot,
              input,
              completionDependencies,
            ),

            createExecutionCompletion(
              mediaRoot,
              input,
              completionDependencies,
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
      "rejects MANUAL as a completion provider",
      () => {
        const parsed =
          ExecutionCompletionSchema
            .safeParse({
              schemaVersion:
                "1.0",

              completedAt:
                "2026-09-24T16:02:00.000Z",

              status:
                "COMPLETED",

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

              generationRecordPath:
                "D:/Busybookie/manual.json",
            });

        expect(
          parsed.success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "returns null when no completion exists",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readExecutionCompletion(
            mediaRoot,
            "EP90",
            "S01",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "treats an existing malformed completion as blocking and fails closed when read",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const {
          reservation,
        } =
          await prepareRunwaySubmission(
            mediaRoot,
          );

        const generationRecordPath =
          await createGenerationRecord(
            mediaRoot,
            "damaged.runway-generation.json",
          );

        const completionPath =
          createExecutionCompletionPath(
            mediaRoot,
            "EP90",
            "S01",
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
          createExecutionCompletion(
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
                "task-completion-123",

              generationRecordPath,
            },
            completionDependencies,
          ),
        ).rejects.toThrow(
          /execution completion already exists/i,
        );

        await expect(
          readExecutionCompletion(
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
