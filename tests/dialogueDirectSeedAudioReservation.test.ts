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
  createDialogueReservation,
} from "../src/dialogue/createDialogueReservation.js";
import {
  readDialogueReservation,
} from "../src/dialogue/readDialogueReservation.js";

import {
  createDialogueDirectSeedAudioReservation,
} from "../src/dialogue/createDialogueDirectSeedAudioReservation.js";
import {
  readDialogueDirectSeedAudioReservation,
} from "../src/dialogue/readDialogueDirectSeedAudioReservation.js";
import {
  createDialogueDirectSeedAudioReservationPath,
} from "../src/dialogue/dialogueDirectSeedAudioLifecyclePaths.js";

const HISTORICAL_PLAN_KEY =
  "a".repeat(
    64,
  );

const SEED_AUDIO_PLAN_KEY =
  "b".repeat(
    64,
  );

const HISTORICAL_RESERVATION_ID =
  "11111111-1111-4111-8111-111111111111";

const SEED_AUDIO_RESERVATION_ID =
  "22222222-2222-4222-8222-222222222222";

const createdDirectories:
  string[] = [];

async function makeTempDirectory():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-direct-seed-audio-reservation-",
      ),
    );

  createdDirectories.push(
    directory,
  );

  return directory;
}

afterEach(
  async () => {
    await Promise.all(
      createdDirectories
        .splice(
          0,
        )
        .map(
          (
            directory,
          ) =>
            rm(
              directory,
              {
                recursive: true,
                force: true,
              },
            ),
        ),
    );
  },
);

function createInput(
  planKey:
    string,
) {
  return {
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
  };
}

describe(
  "BusyBookie direct SeedAudio plan-scoped reservation persistence",
  () => {
    it(
      "coexists with a completed-generation era historical singleton reservation without overwriting it",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const historical =
          await createDialogueReservation(
            mediaRoot,
            createInput(
              HISTORICAL_PLAN_KEY,
            ),
            {
              now:
                () =>
                  "2026-10-02T21:12:28.101Z",
              createReservationId:
                () =>
                  HISTORICAL_RESERVATION_ID,
            },
          );

        const direct =
          await createDialogueDirectSeedAudioReservation(
            mediaRoot,
            createInput(
              SEED_AUDIO_PLAN_KEY,
            ),
            {
              now:
                () =>
                  "2026-10-06T16:30:00.000Z",
              createReservationId:
                () =>
                  SEED_AUDIO_RESERVATION_ID,
            },
          );

        expect(
          direct.record,
        ).toEqual({
          schemaVersion:
            "1.0",
          reservationId:
            SEED_AUDIO_RESERVATION_ID,
          reservedAt:
            "2026-10-06T16:30:00.000Z",
          status:
            "RESERVED",
          ...createInput(
            SEED_AUDIO_PLAN_KEY,
          ),
        });

        expect(
          direct.reservationPath,
        ).toBe(
          createDialogueDirectSeedAudioReservationPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            SEED_AUDIO_PLAN_KEY,
          ),
        );

        expect(
          direct.reservationPath,
        ).not.toBe(
          historical
            .reservationPath,
        );

        await expect(
          readDialogueReservation(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
          ),
        ).resolves.toEqual(
          historical.record,
        );

        await expect(
          readDialogueDirectSeedAudioReservation(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            SEED_AUDIO_PLAN_KEY,
          ),
        ).resolves.toEqual(
          direct.record,
        );
      },
    );

    it(
      "returns null when the selected plan has no direct SeedAudio reservation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readDialogueDirectSeedAudioReservation(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            SEED_AUDIO_PLAN_KEY,
          ),
        ).resolves.toBeNull();
      },
    );

    it(
      "blocks a duplicate reservation for the same direct SeedAudio plan",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createDialogueDirectSeedAudioReservation(
          mediaRoot,
          createInput(
            SEED_AUDIO_PLAN_KEY,
          ),
        );

        await expect(
          createDialogueDirectSeedAudioReservation(
            mediaRoot,
            createInput(
              SEED_AUDIO_PLAN_KEY,
            ),
          ),
        ).rejects.toThrow(
          /dialogue direct SeedAudio reservation already exists/i,
        );
      },
    );

    it(
      "allows exactly one winner when two writers race for the same direct SeedAudio plan",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const attempts =
          await Promise.allSettled([
            createDialogueDirectSeedAudioReservation(
              mediaRoot,
              createInput(
                SEED_AUDIO_PLAN_KEY,
              ),
            ),
            createDialogueDirectSeedAudioReservation(
              mediaRoot,
              createInput(
                SEED_AUDIO_PLAN_KEY,
              ),
            ),
          ]);

        expect(
          attempts.filter(
            (
              result,
            ) =>
              result.status ===
              "fulfilled",
          ),
        ).toHaveLength(
          1,
        );

        expect(
          attempts.filter(
            (
              result,
            ) =>
              result.status ===
              "rejected",
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "fails closed when an existing plan-scoped reservation contains malformed durable evidence",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const reservationPath =
          createDialogueDirectSeedAudioReservationPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            SEED_AUDIO_PLAN_KEY,
          );

        await mkdir(
          dirname(
            reservationPath,
          ),
          {
            recursive: true,
          },
        );

        await writeFile(
          reservationPath,
          "{not-valid-json",
          "utf8",
        );

        await expect(
          readDialogueDirectSeedAudioReservation(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
            SEED_AUDIO_PLAN_KEY,
          ),
        ).rejects.toThrow(
          /not valid JSON/i,
        );

        expect(
          await readFile(
            reservationPath,
            "utf8",
          ),
        ).toBe(
          "{not-valid-json",
        );
      },
    );
  },
);
