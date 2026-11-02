import {
  createHash,
} from "node:crypto";

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
  createVisualAttemptAdmission,
} from "../src/execution/createVisualAttemptAdmission.js";

import {
  createVisualAttemptExecutionReservation,
  type CreateVisualAttemptExecutionReservationInput,
} from "../src/execution/createVisualAttemptExecutionReservation.js";

import {
  readVisualAttemptExecutionReservation,
  readVisualAttemptExecutionReservationEvidence,
} from "../src/execution/readVisualAttemptExecutionReservation.js";

import {
  createVisualAttemptExecutionReservationPath,
} from "../src/execution/visualAttemptExecutionPaths.js";

import type {
  VisualAttemptAdmission,
} from "../src/execution/visualAttemptAdmission.schema.js";

const temporaryDirectories:
  string[] = [];

const admissionId =
  "6f1e7d4c-1a2b-4c3d-8e9f-0a1b2c3d4e5f";

const reservationId =
  "7a2f8e5d-2b3c-4d5e-9f01-1b2c3d4e5f60";

const hashA =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const hashB =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const hashC =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const hashD =
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

async function makeTempDirectory():
  Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-attempt-reservation-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

async function createAdmission(
  mediaRoot:
    string,

  overrides:
    Readonly<{
      sceneId?:
        string;

      provider?:
        VisualAttemptAdmission[
          "provider"
        ];
    }> =
      {},
) {
  return createVisualAttemptAdmission(
    mediaRoot,
    {
      attemptNumber:
        2,

      episodeId:
        "EP93",

      sceneId:
        overrides.sceneId ??
        "SC01",

      shotId:
        "S01",

      provider:
        overrides.provider ??
        "GOOGLE_GENAI",

      manifestRawSha256:
        hashA,

      promptIdentitySha256:
        hashB,

      referenceIdentitySha256:
        hashC,

      previousAttemptNumber:
        1,

      previousAttemptQcSha256:
        hashD,
    },
    {
      now:
        () =>
          "2026-11-02T21:00:00.000Z",

      createAdmissionId:
        () =>
          admissionId,
    },
  );
}

function reservationInput(
  admission:
    Awaited<
      ReturnType<
        typeof createAdmission
      >
    >,

  overrides:
    Partial<
      CreateVisualAttemptExecutionReservationInput
    > =
      {},
): CreateVisualAttemptExecutionReservationInput {
  return {
    episodeId:
      admission.record.episodeId,

    sceneId:
      admission.record.sceneId,

    shotId:
      admission.record.shotId,

    attemptNumber:
      admission.record.attemptNumber,

    provider:
      admission.record.provider,

    expectedAdmissionId:
      admission.record.admissionId,

    expectedAdmissionSha256:
      admission.admissionSha256,

    ...overrides,
  };
}

const reservationDependencies = {
  now:
    () =>
      "2026-11-02T22:00:00.000Z",

  createReservationId:
    () =>
      reservationId,
};

async function rewriteReservation(
  reservationPath:
    string,

  mutate:
    (
      value:
        Record<
          string,
          unknown
        >,
    ) => void,
): Promise<void> {
  const raw =
    await readFile(
      reservationPath,
      "utf8",
    );

  const value =
    JSON.parse(
      raw,
    ) as Record<
      string,
      unknown
    >;

  mutate(
    value,
  );

  await writeFile(
    reservationPath,
    `${JSON.stringify(
      value,
      null,
      2,
    )}\n`,
    "utf8",
  );
}

afterEach(
  async () => {
    for (
      const directory of
        temporaryDirectories.splice(
          0,
        )
    ) {
      await rm(
        directory,
        {
          recursive:
            true,

          force:
            true,
        },
      );
    }
  },
);

describe(
  "attempt-aware visual execution reservation persistence",
  () => {
    it(
      "creates canonical immutable reservation bytes bound to the durable admission",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const created =
          await createVisualAttemptExecutionReservation(
            mediaRoot,
            reservationInput(
              admission,
            ),
            reservationDependencies,
          );

        expect(
          created.reservationPath,
        ).toBe(
          createVisualAttemptExecutionReservationPath(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        );

        expect(
          created.record,
        ).toEqual({
          schemaVersion:
            "1.0",

          reservationId,

          reservedAt:
            "2026-11-02T22:00:00.000Z",

          status:
            "RESERVED",

          episodeId:
            "EP93",

          sceneId:
            "SC01",

          shotId:
            "S01",

          attemptNumber:
            2,

          admissionId:
            admission.record.admissionId,

          admissionSha256:
            admission.admissionSha256,

          provider:
            "GOOGLE_GENAI",
        });

        const raw =
          await readFile(
            created.reservationPath,
            "utf8",
          );

        expect(
          raw,
        ).toBe(
          `${JSON.stringify(
            created.record,
            null,
            2,
          )}\n`,
        );

        const expectedSha =
          createHash(
            "sha256",
          )
            .update(
              raw,
            )
            .digest(
              "hex",
            );

        expect(
          created.reservationSha256,
        ).toBe(
          expectedSha,
        );
      },
    );

    it(
      "reads canonical reservation evidence and exposes its exact byte SHA-256",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const created =
          await createVisualAttemptExecutionReservation(
            mediaRoot,
            reservationInput(
              admission,
            ),
            reservationDependencies,
          );

        const evidence =
          await readVisualAttemptExecutionReservationEvidence(
            mediaRoot,
            "EP93",
            "S01",
            2,
          );

        expect(
          evidence,
        ).not.toBeNull();

        expect(
          evidence?.record,
        ).toEqual(
          created.record,
        );

        expect(
          evidence?.reservationPath,
        ).toBe(
          created.reservationPath,
        );

        expect(
          evidence?.reservationSha256,
        ).toBe(
          created.reservationSha256,
        );

        expect(
          await readVisualAttemptExecutionReservation(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).toEqual(
          created.record,
        );
      },
    );

    it(
      "returns null when no reservation exists",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        expect(
          await readVisualAttemptExecutionReservation(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).toBeNull();

        expect(
          await readVisualAttemptExecutionReservationEvidence(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).toBeNull();
      },
    );

    it(
      "refuses a duplicate reservation without changing the first durable bytes",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const input =
          reservationInput(
            admission,
          );

        const first =
          await createVisualAttemptExecutionReservation(
            mediaRoot,
            input,
            reservationDependencies,
          );

        const before =
          await readFile(
            first.reservationPath,
          );

        await expect(
          createVisualAttemptExecutionReservation(
            mediaRoot,
            input,
            reservationDependencies,
          ),
        ).rejects.toThrow(
          /already exists/i,
        );

        const after =
          await readFile(
            first.reservationPath,
          );

        expect(
          after.equals(
            before,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "allows exactly one winner for concurrent duplicate reservation creation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const input =
          reservationInput(
            admission,
          );

        const results =
          await Promise.allSettled([
            createVisualAttemptExecutionReservation(
              mediaRoot,
              input,
              reservationDependencies,
            ),

            createVisualAttemptExecutionReservation(
              mediaRoot,
              input,
              reservationDependencies,
            ),
          ]);

        expect(
          results.filter(
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
          results.filter(
            (
              result,
            ) =>
              result.status ===
              "rejected",
          ),
        ).toHaveLength(
          1,
        );

        expect(
          await readVisualAttemptExecutionReservation(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).not.toBeNull();
      },
    );

    it(
      "fails closed for invalid JSON",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const reservationPath =
          createVisualAttemptExecutionReservationPath(
            mediaRoot,
            "EP93",
            "S01",
            2,
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
          "{ invalid",
          "utf8",
        );

        await expect(
          readVisualAttemptExecutionReservation(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).rejects.toThrow(
          /not valid JSON/i,
        );
      },
    );

    it(
      "fails closed for schema-invalid JSON",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const reservationPath =
          createVisualAttemptExecutionReservationPath(
            mediaRoot,
            "EP93",
            "S01",
            2,
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
          `${JSON.stringify(
            {
              invalid:
                true,
            },
            null,
            2,
          )}\n`,
          "utf8",
        );

        await expect(
          readVisualAttemptExecutionReservation(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "fails closed for valid but noncanonical reservation JSON",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const created =
          await createVisualAttemptExecutionReservation(
            mediaRoot,
            reservationInput(
              admission,
            ),
            reservationDependencies,
          );

        await writeFile(
          created.reservationPath,
          JSON.stringify(
            created.record,
          ),
          "utf8",
        );

        await expect(
          readVisualAttemptExecutionReservation(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).rejects.toThrow(
          /bytes are not canonical/i,
        );
      },
    );

    it.each([
      [
        "episode",
        "episodeId",
        "EP94",
      ],
      [
        "shot",
        "shotId",
        "S02",
      ],
      [
        "attempt",
        "attemptNumber",
        3,
      ],
    ] as const)(
      "fails closed when embedded %s identity disagrees with the canonical path",
      async (
        _label,
        field,
        value,
      ) => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const created =
          await createVisualAttemptExecutionReservation(
            mediaRoot,
            reservationInput(
              admission,
            ),
            reservationDependencies,
          );

        await rewriteReservation(
          created.reservationPath,
          (
            record,
          ) => {
            record[field] =
              value;
          },
        );

        await expect(
          readVisualAttemptExecutionReservation(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).rejects.toThrow(
          /identity does not match/i,
        );
      },
    );

    it(
      "refuses reservation creation when the durable admission is absent",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          createVisualAttemptExecutionReservation(
            mediaRoot,
            {
              episodeId:
                "EP93",

              sceneId:
                "SC01",

              shotId:
                "S01",

              attemptNumber:
                2,

              provider:
                "GOOGLE_GENAI",

              expectedAdmissionId:
                admissionId,

              expectedAdmissionSha256:
                "e".repeat(
                  64,
                ),
            },
            reservationDependencies,
          ),
        ).rejects.toThrow(
          /requires an existing durable admission/i,
        );
      },
    );

    it(
      "refuses a scene mismatch against the durable admission",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        await expect(
          createVisualAttemptExecutionReservation(
            mediaRoot,
            reservationInput(
              admission,
              {
                sceneId:
                  "SC02",
              },
            ),
            reservationDependencies,
          ),
        ).rejects.toThrow(
          /scene identity/i,
        );
      },
    );

    it(
      "refuses a provider mismatch against the durable admission",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        await expect(
          createVisualAttemptExecutionReservation(
            mediaRoot,
            reservationInput(
              admission,
              {
                provider:
                  "RUNWAY",
              },
            ),
            reservationDependencies,
          ),
        ).rejects.toThrow(
          /provider/i,
        );
      },
    );

    it(
      "refuses an admission ID mismatch",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        await expect(
          createVisualAttemptExecutionReservation(
            mediaRoot,
            reservationInput(
              admission,
              {
                expectedAdmissionId:
                  "8b3f9e6d-3c4d-4e5f-8a01-2c3d4e5f6071",
              },
            ),
            reservationDependencies,
          ),
        ).rejects.toThrow(
          /admission ID/i,
        );
      },
    );

    it(
      "refuses an admission exact-byte SHA-256 mismatch",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        await expect(
          createVisualAttemptExecutionReservation(
            mediaRoot,
            reservationInput(
              admission,
              {
                expectedAdmissionSha256:
                  "f".repeat(
                    64,
                  ),
              },
            ),
            reservationDependencies,
          ),
        ).rejects.toThrow(
          /SHA-256/i,
        );
      },
    );
  },
);
