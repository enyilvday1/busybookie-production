import {
  mkdtemp,
  mkdir,
  readFile,
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
  DialogueReservationSchema,
} from "../src/dialogue/dialogueReservation.schema.js";

import {
  createDialogueReservation,
} from "../src/dialogue/createDialogueReservation.js";

import {
  createDialogueReservationPath,
} from "../src/dialogue/dialogueReservationPath.js";

import {
  readDialogueReservation,
} from "../src/dialogue/readDialogueReservation.js";

async function makeTempDirectory():
  Promise<string> {
  return mkdtemp(
    join(
      tmpdir(),
      "busybookie-dialogue-reservation-",
    ),
  );
}

const fixedDependencies =
  Object.freeze({
    now:
      () =>
        "2026-10-01T19:00:00.000Z",

    createReservationId:
      () =>
        "11111111-1111-4111-8111-111111111111",
  });

const planKey =
  "a".repeat(
    64,
  );

function createInput(
  overrides:
    Partial<{
      episodeId: string;
      sceneId: string;
      shotId: string;
      dialogueLineId: string;
      planKey: string;
      provider: "RUNWAY";
    }> = {},
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

    ...overrides,
  };
}

describe(
  "Busybookie dialogue paid-generation reservation",
  () => {
    it(
      "creates a deterministic reservation path under the dialogue-line voice namespace",
      () => {
        const result =
          createDialogueReservationPath(
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
          /D:\/Busybookie\/Production\/voices\/EP02\/S02\/EP02_SC01_S02_L01\/EP02_SC01_S02_L01\.dialogue-reservation\.json$/,
        );
      },
    );

    it(
      "creates and reads a durable reservation bound to the canonical dialogue plan",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const result =
          await createDialogueReservation(
            mediaRoot,
            createInput(),
            fixedDependencies,
          );

        expect(
          result.record,
        ).toEqual({
          schemaVersion:
            "1.0",

          reservationId:
            "11111111-1111-4111-8111-111111111111",

          reservedAt:
            "2026-10-01T19:00:00.000Z",

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

          planKey,

          provider:
            "RUNWAY",
        });

        const stored =
          JSON.parse(
            await readFile(
              result.reservationPath,
              "utf8",
            ),
          );

        expect(
          stored,
        ).toEqual(
          result.record,
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
          result.record,
        );
      },
    );

    it(
      "blocks a second reservation for the same logical dialogue line even when the plan key changes",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await createDialogueReservation(
          mediaRoot,
          createInput(),
          fixedDependencies,
        );

        await expect(
          createDialogueReservation(
            mediaRoot,
            createInput({
              planKey:
                "b".repeat(
                  64,
                ),
            }),
            fixedDependencies,
          ),
        ).rejects.toThrow(
          /dialogue reservation already exists/i,
        );
      },
    );

    it(
      "allows exactly one winner when two reservations race for the same dialogue line",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const attempts =
          await Promise.allSettled([
            createDialogueReservation(
              mediaRoot,
              createInput(),
              fixedDependencies,
            ),

            createDialogueReservation(
              mediaRoot,
              createInput(),
              fixedDependencies,
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
      "allows different dialogue lines to reserve independently",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          Promise.all([
            createDialogueReservation(
              mediaRoot,
              createInput(),
              fixedDependencies,
            ),

            createDialogueReservation(
              mediaRoot,
              createInput({
                dialogueLineId:
                  "EP02_SC01_S02_L02",
              }),
              fixedDependencies,
            ),
          ]),
        ).resolves.toHaveLength(
          2,
        );
      },
    );

    it(
      "rejects a reservation whose dialogue-line identity does not match the selected scene and shot",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          createDialogueReservation(
            mediaRoot,
            createInput({
              sceneId:
                "SC02",
            }),
            fixedDependencies,
          ),
        ).rejects.toThrow(
          /dialogue line.*identity|identity.*dialogue line/i,
        );
      },
    );

    it(
      "rejects malformed plan keys and unsupported providers",
      () => {
        expect(
          DialogueReservationSchema.safeParse({
            schemaVersion:
              "1.0",

            reservationId:
              "11111111-1111-4111-8111-111111111111",

            reservedAt:
              "2026-10-01T19:00:00.000Z",

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
              "not-a-sha256",

            provider:
              "RUNWAY",
          }).success,
        ).toBe(
          false,
        );

        expect(
          DialogueReservationSchema.safeParse({
            schemaVersion:
              "1.0",

            reservationId:
              "11111111-1111-4111-8111-111111111111",

            reservedAt:
              "2026-10-01T19:00:00.000Z",

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

            planKey,

            provider:
              "VEO",
          }).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "treats an existing malformed reservation file as blocking",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const reservationPath =
          createDialogueReservationPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
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
          "{damaged",
          "utf8",
        );

        await expect(
          createDialogueReservation(
            mediaRoot,
            createInput(),
            fixedDependencies,
          ),
        ).rejects.toThrow(
          /dialogue reservation already exists/i,
        );
      },
    );

    it(
      "returns null when no reservation exists and fails closed when an existing reservation is malformed",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          readDialogueReservation(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
          ),
        ).resolves.toBeNull();

        const reservationPath =
          createDialogueReservationPath(
            mediaRoot,
            "EP02",
            "SC01",
            "S02",
            "EP02_SC01_S02_L01",
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
          "{damaged",
          "utf8",
        );

        await expect(
          readDialogueReservation(
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
  },
);
