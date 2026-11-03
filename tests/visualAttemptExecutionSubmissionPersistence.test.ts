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
} from "../src/execution/createVisualAttemptExecutionReservation.js";

import {
  createVisualAttemptExecutionSubmission,
  type CreateVisualAttemptExecutionSubmissionInput,
} from "../src/execution/createVisualAttemptExecutionSubmission.js";

import {
  readVisualAttemptExecutionSubmission,
  readVisualAttemptExecutionSubmissionEvidence,
} from "../src/execution/readVisualAttemptExecutionSubmission.js";

import {
  createVisualAttemptExecutionSubmissionPath,
} from "../src/execution/visualAttemptExecutionPaths.js";

import {
  VisualAttemptGoogleGenAiRecoveryMetadataSchema,
  type VisualAttemptGoogleGenAiExecutionSubmission,
} from "../src/execution/visualAttemptExecutionLifecycle.schema.js";

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
        "busybookie-attempt-submission-",
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

async function createReservation(
  mediaRoot:
    string,

  admission:
    Awaited<
      ReturnType<
        typeof createAdmission
      >
    >,
) {
  return createVisualAttemptExecutionReservation(
    mediaRoot,
    {
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
    },
    {
      now:
        () =>
          "2026-11-02T22:00:00.000Z",

      createReservationId:
        () =>
          reservationId,
    },
  );
}

const recoveryMetadata =
  VisualAttemptGoogleGenAiRecoveryMetadataSchema
    .parse({
      request: {
        model:
          "gemini-omni-1.1-flash",

        background:
          true,

        store:
          true,

        stream:
          false,

        promptText:
          "Animate the approved Littleleaf Valley reference.",

        sourceImagePath:
          "D:\\Busybookie\\Production\\references\\littleleaf-valley\\littleleaf_valley_storybook_village.png",
      },

      policySnapshot: {
        schemaVersion:
          "1.0",

        provider:
          "GOOGLE_GENAI",

        model:
          "gemini-omni-1.1-flash",

        pricingReviewedOn:
          "2026-10-23",

        pricingProvenance: {
          pricingSource:
            "GOOGLE_GEMINI_API_OFFICIAL_PRICING_PAGE",

          modelLifecycleSource:
            "GOOGLE_GEMINI_API_OFFICIAL_DEPRECATIONS_PAGE",

          verifiedOn:
            "2026-10-23",
        },

        pricing: {
          currency:
            "USD",

          fixedPointUnit:
            "MICRO_USD",

          tokensPerPricingUnit:
            1000000,

          inputMicroUsdPerMillionTokens:
            1500000,

          videoOutputMicroUsdPerMillionTokens:
            17500000,

          videoOutput720pTokensPerSecond:
            5792,

          knownVideoOutput720pMicroUsdPerSecond:
            101360,
        },

        costCompleteness: {
          costScope:
            "KNOWN_VIDEO_OUTPUT_PLUS_SEPARATE_INPUT_COMPONENT",

          preReservationTotalCostExactlyKnown:
            false,

          inputTokenComponentIncludedInKnownCost:
            false,
        },
      },
    });

function submissionInput(
  admission:
    Awaited<
      ReturnType<
        typeof createAdmission
      >
    >,

  reservation:
    Awaited<
      ReturnType<
        typeof createReservation
      >
    >,

  overrides:
    Partial<
      CreateVisualAttemptExecutionSubmissionInput
    > =
      {},
): CreateVisualAttemptExecutionSubmissionInput {
  return {
    episodeId:
      reservation.record.episodeId,

    sceneId:
      reservation.record.sceneId,

    shotId:
      reservation.record.shotId,

    attemptNumber:
      reservation.record.attemptNumber,

    expectedAdmissionId:
      admission.record.admissionId,

    expectedAdmissionSha256:
      admission.admissionSha256,

    expectedReservationId:
      reservation.record.reservationId,

    expectedReservationSha256:
      reservation.reservationSha256,

    providerExecutionId:
      "interaction-test-2",

    recoveryMetadata,

    ...overrides,
  };
}

const submissionDependencies = {
  now:
    () =>
      "2026-11-02T22:41:00.000Z",
};

async function rewriteJson(
  path:
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
      path,
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
    path,
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
  "attempt-aware visual execution submission persistence",
  () => {
    it(
      "creates canonical immutable submission bytes bound to durable admission and reservation evidence",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        const created =
          await createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
            ),
            submissionDependencies,
          );

        expect(
          created.record,
        ).toEqual({
          schemaVersion:
            "1.0",

          submittedAt:
            "2026-11-02T22:41:00.000Z",

          status:
            "SUBMITTED",

          reservationId:
            reservation.record.reservationId,

          reservationSha256:
            reservation.reservationSha256,

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

          providerExecutionId:
            "interaction-test-2",

          recoveryMetadata,
        });

        expect(
          created.submissionPath,
        ).toBe(
          createVisualAttemptExecutionSubmissionPath(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        );

        const raw =
          await readFile(
            created.submissionPath,
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
          created.submissionSha256,
        ).toBe(
          expectedSha,
        );
      },
    );

    it(
      "reads canonical submission evidence and exposes its exact byte SHA-256",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        const created =
          await createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
            ),
            submissionDependencies,
          );

        const evidence =
          await readVisualAttemptExecutionSubmissionEvidence(
            mediaRoot,
            "EP93",
            "S01",
            2,
          );

        expect(
          evidence?.record,
        ).toEqual(
          created.record,
        );

        expect(
          evidence?.submissionPath,
        ).toBe(
          created.submissionPath,
        );

        expect(
          evidence?.submissionSha256,
        ).toBe(
          created.submissionSha256,
        );

        expect(
          await readVisualAttemptExecutionSubmission(
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
      "returns null when no submission exists",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        expect(
          await readVisualAttemptExecutionSubmission(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).toBeNull();

        expect(
          await readVisualAttemptExecutionSubmissionEvidence(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).toBeNull();
      },
    );

    it(
      "refuses a duplicate submission without changing the first durable bytes",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        const input =
          submissionInput(
            admission,
            reservation,
          );

        const first =
          await createVisualAttemptExecutionSubmission(
            mediaRoot,
            input,
            submissionDependencies,
          );

        const before =
          await readFile(
            first.submissionPath,
          );

        await expect(
          createVisualAttemptExecutionSubmission(
            mediaRoot,
            input,
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /already exists/i,
        );

        const after =
          await readFile(
            first.submissionPath,
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
      "allows exactly one winner for concurrent duplicate submission creation",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        const input =
          submissionInput(
            admission,
            reservation,
          );

        const results =
          await Promise.allSettled([
            createVisualAttemptExecutionSubmission(
              mediaRoot,
              input,
              submissionDependencies,
            ),

            createVisualAttemptExecutionSubmission(
              mediaRoot,
              input,
              submissionDependencies,
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
      },
    );

    it(
      "fails closed for invalid submission JSON",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const submissionPath =
          createVisualAttemptExecutionSubmissionPath(
            mediaRoot,
            "EP93",
            "S01",
            2,
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
          "{ invalid",
          "utf8",
        );

        await expect(
          readVisualAttemptExecutionSubmission(
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
      "fails closed for schema-invalid submission JSON",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const submissionPath =
          createVisualAttemptExecutionSubmissionPath(
            mediaRoot,
            "EP93",
            "S01",
            2,
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
          readVisualAttemptExecutionSubmission(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "fails closed for valid but noncanonical submission JSON",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        const created =
          await createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
            ),
            submissionDependencies,
          );

        await writeFile(
          created.submissionPath,
          JSON.stringify(
            created.record,
          ),
          "utf8",
        );

        await expect(
          readVisualAttemptExecutionSubmission(
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

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        const created =
          await createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
            ),
            submissionDependencies,
          );

        await rewriteJson(
          created.submissionPath,
          (
            record,
          ) => {
            record[field] =
              value;
          },
        );

        await expect(
          readVisualAttemptExecutionSubmission(
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
      "refuses submission creation when the durable reservation is absent",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        await expect(
          createVisualAttemptExecutionSubmission(
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

              expectedAdmissionId:
                admissionId,

              expectedAdmissionSha256:
                "a".repeat(
                  64,
                ),

              expectedReservationId:
                reservationId,

              expectedReservationSha256:
                "b".repeat(
                  64,
                ),

              providerExecutionId:
                "interaction-test-2",

              recoveryMetadata,
            },
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /requires an existing durable attempt-aware reservation/i,
        );
      },
    );

    it(
      "refuses a reservation scene mismatch",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        await expect(
          createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
              {
                sceneId:
                  "SC02",
              },
            ),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /reservation identity/i,
        );
      },
    );

    it(
      "refuses a reservation admission ID mismatch",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        await expect(
          createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
              {
                expectedAdmissionId:
                  "8b3f9e6d-3c4d-4e5f-8a01-2c3d4e5f6071",
              },
            ),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /reservation admission ID/i,
        );
      },
    );

    it(
      "refuses a reservation admission SHA mismatch",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        await expect(
          createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
              {
                expectedAdmissionSha256:
                  "e".repeat(
                    64,
                  ),
              },
            ),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /reservation admission SHA-256/i,
        );
      },
    );

    it(
      "refuses a reservation ID mismatch",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        await expect(
          createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
              {
                expectedReservationId:
                  "9c4a0f7e-4d5e-4f60-8b12-3d4e5f607182",
              },
            ),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /reservation ID/i,
        );
      },
    );

    it(
      "refuses a reservation exact-byte SHA mismatch",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        await expect(
          createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
              {
                expectedReservationSha256:
                  "f".repeat(
                    64,
                  ),
              },
            ),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /reservation SHA-256/i,
        );
      },
    );

    it(
      "refuses a durable reservation whose provider is not the canonical submission provider",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
            {
              provider:
                "RUNWAY",
            },
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        await expect(
          createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
            ),
            submissionDependencies,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "refuses submission creation when the durable admission is missing",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        await rm(
          admission.admissionPath,
        );

        await expect(
          createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
            ),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /requires the durable admission/i,
        );
      },
    );

    it(
      "refuses an admission and reservation identity mismatch",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        await rewriteJson(
          admission.admissionPath,
          (
            record,
          ) => {
            record.sceneId =
              "SC02";
          },
        );

        await expect(
          createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
            ),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /admission identity/i,
        );
      },
    );

    it(
      "refuses an admission and reservation provider mismatch",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        await rewriteJson(
          admission.admissionPath,
          (
            record,
          ) => {
            record.provider =
              "RUNWAY";
          },
        );

        await expect(
          createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
            ),
            submissionDependencies,
          ),
        ).rejects.toThrow(
          /admission provider/i,
        );
      },
    );

    it(
      "refuses an empty providerExecutionId",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        await expect(
          createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
              {
                providerExecutionId:
                  "",
              },
            ),
            submissionDependencies,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "refuses invalid recoveryMetadata",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const admission =
          await createAdmission(
            mediaRoot,
          );

        const reservation =
          await createReservation(
            mediaRoot,
            admission,
          );

        await expect(
          createVisualAttemptExecutionSubmission(
            mediaRoot,
            submissionInput(
              admission,
              reservation,
              {
                recoveryMetadata:
                  {
                    invalid:
                      true,
                  } as unknown as VisualAttemptGoogleGenAiExecutionSubmission[
                    "recoveryMetadata"
                  ],
              },
            ),
            submissionDependencies,
          ),
        ).rejects.toThrow();
      },
    );
  },
);
