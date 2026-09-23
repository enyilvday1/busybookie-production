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
  ExecutionReservationSchema,
} from "../src/execution/executionReservation.schema.js";

import {
  createExecutionReservationPath,
} from "../src/execution/executionReservationPath.js";

import {
  readExecutionReservation,
} from "../src/execution/readExecutionReservation.js";

const temporaryDirectories: string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-execution-reservation-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

const fixedDependencies = {
  now: () =>
    "2026-09-23T20:00:00.000Z",
  createReservationId: () =>
    "11111111-1111-4111-8111-111111111111",
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(
        (directory) =>
          rm(
            directory,
            {
              recursive: true,
              force: true,
            },
          ),
      ),
  );
});

describe(
  "Busybookie execution reservation",
  () => {
    it(
      "uses one provider-neutral reservation path per episode shot",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        expect(
          createExecutionReservationPath(
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
            "EP90_S01.execution-reservation.json",
          ),
        );
      },
    );

    it(
      "creates and reads a durable Runway reservation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const result =
          await createExecutionReservation(
            mediaRoot,
            {
              episodeId: "EP90",
              shotId: "S01",
              provider: "RUNWAY",
            },
            fixedDependencies,
          );

        expect(result.record).toEqual({
          schemaVersion: "1.0",
          reservationId:
            "11111111-1111-4111-8111-111111111111",
          reservedAt:
            "2026-09-23T20:00:00.000Z",
          status: "RESERVED",
          episodeId: "EP90",
          shotId: "S01",
          provider: "RUNWAY",
        });

        const stored =
          JSON.parse(
            await readFile(
              result.reservationPath,
              "utf8",
            ),
          );

        expect(stored).toEqual(
          result.record,
        );

        await expect(
          readExecutionReservation(
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
      "blocks a duplicate reservation for the same shot",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createExecutionReservation(
          mediaRoot,
          {
            episodeId: "EP90",
            shotId: "S01",
            provider: "RUNWAY",
          },
          fixedDependencies,
        );

        await expect(
          createExecutionReservation(
            mediaRoot,
            {
              episodeId: "EP90",
              shotId: "S01",
              provider: "RUNWAY",
            },
            fixedDependencies,
          ),
        ).rejects.toThrow(
          /execution reservation already exists/i,
        );
      },
    );

    it(
      "does not allow a provider change to bypass an existing reservation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createExecutionReservation(
          mediaRoot,
          {
            episodeId: "EP90",
            shotId: "S01",
            provider: "RUNWAY",
          },
          fixedDependencies,
        );

        await expect(
          createExecutionReservation(
            mediaRoot,
            {
              episodeId: "EP90",
              shotId: "S01",
              provider: "VEO",
            },
            fixedDependencies,
          ),
        ).rejects.toThrow(
          /execution reservation already exists/i,
        );
      },
    );

    it(
      "allows exactly one winner when two reservations race for the same shot",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const attempts =
          await Promise.allSettled([
            createExecutionReservation(
              mediaRoot,
              {
                episodeId: "EP90",
                shotId: "S01",
                provider: "RUNWAY",
              },
              fixedDependencies,
            ),
            createExecutionReservation(
              mediaRoot,
              {
                episodeId: "EP90",
                shotId: "S01",
                provider: "RUNWAY",
              },
              fixedDependencies,
            ),
          ]);

        expect(
          attempts.filter(
            (attempt) =>
              attempt.status ===
              "fulfilled",
          ),
        ).toHaveLength(1);

        expect(
          attempts.filter(
            (attempt) =>
              attempt.status ===
              "rejected",
          ),
        ).toHaveLength(1);
      },
    );

    it(
      "allows different shots to reserve independently",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          Promise.all([
            createExecutionReservation(
              mediaRoot,
              {
                episodeId: "EP90",
                shotId: "S01",
                provider: "RUNWAY",
              },
              fixedDependencies,
            ),
            createExecutionReservation(
              mediaRoot,
              {
                episodeId: "EP90",
                shotId: "S02",
                provider: "VEO",
              },
              fixedDependencies,
            ),
          ]),
        ).resolves.toHaveLength(2);
      },
    );

    it(
      "rejects MANUAL as a paid execution reservation provider",
      () => {
        const parsed =
          ExecutionReservationSchema.safeParse({
            schemaVersion: "1.0",
            reservationId:
              "11111111-1111-4111-8111-111111111111",
            reservedAt:
              "2026-09-23T20:00:00.000Z",
            status: "RESERVED",
            episodeId: "EP90",
            shotId: "S01",
            provider: "MANUAL",
          });

        expect(parsed.success).toBe(false);
      },
    );

    it(
      "rejects malformed episode or shot identifiers",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          createExecutionReservation(
            mediaRoot,
            {
              episodeId: "../EP90",
              shotId: "S01",
              provider: "RUNWAY",
            },
            fixedDependencies,
          ),
        ).rejects.toThrow();

        await expect(
          createExecutionReservation(
            mediaRoot,
            {
              episodeId: "EP90",
              shotId: "../S01",
              provider: "RUNWAY",
            },
            fixedDependencies,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "treats an existing malformed reservation file as a blocking reservation",
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
          dirname(reservationPath),
          {
            recursive: true,
          },
        );

        await writeFile(
          reservationPath,
          "{damaged",
          "utf8",
        );

        await expect(
          createExecutionReservation(
            mediaRoot,
            {
              episodeId: "EP90",
              shotId: "S01",
              provider: "RUNWAY",
            },
            fixedDependencies,
          ),
        ).rejects.toThrow(
          /execution reservation already exists/i,
        );
      },
    );

    it(
      "returns null when no reservation exists",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readExecutionReservation(
            mediaRoot,
            "EP90",
            "S01",
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "fails closed when an existing reservation cannot be parsed",
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
          dirname(reservationPath),
          {
            recursive: true,
          },
        );

        await writeFile(
          reservationPath,
          "{damaged",
          "utf8",
        );

        await expect(
          readExecutionReservation(
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
