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
  ExecutionSubmissionInputSchema,
  ExecutionSubmissionSchema,
} from "../src/execution/executionSubmission.schema.js";

import {
  GoogleGenAiPolicySchema,
} from "../src/schemas/googleGenAiPolicy.schema.js";

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

const runwayRecoveryMetadata =
  Object.freeze({
    request:
      Object.freeze({
        durationSeconds:
          5,

        ratio:
          "1280:720",

        outputFormat:
          "mp4",

        promptText:
          "Busybookie execution submission recovery metadata test.",

        sourceImagePath:
          "D:/Busybookie/Production/references/EP90/S01/reference.png",

        assetStrategy:
          "DATA_URI",
      }),

    locallyExpectedCredits:
      60,
  });

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

              recoveryMetadata:
                runwayRecoveryMetadata,
            },
            submissionDependencies,
          );

        expect(
          result.record,
        ).toEqual({
          schemaVersion:
            "1.2",

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

          recoveryMetadata:
            runwayRecoveryMetadata,
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
                    "Busybookie Veo execution submission test.",

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

              recoveryMetadata:
                runwayRecoveryMetadata,
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

              recoveryMetadata:
                runwayRecoveryMetadata,
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
                    "Busybookie Veo execution submission test.",

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

              recoveryMetadata:
                runwayRecoveryMetadata,
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

          recoveryMetadata:
            runwayRecoveryMetadata,
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

          recoveryMetadata:
            runwayRecoveryMetadata,
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

              recoveryMetadata:
                runwayRecoveryMetadata,
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

const googleInteractionId =
  "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";

const googlePolicySnapshot =
  Object.freeze({
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
  });

const googleRecoveryMetadata =
  Object.freeze({
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
        "Busybookie Google GenAI durable submission test.",

      sourceImagePath:
        "D:/Busybookie/Production/references/EP92/S01/reference.png",
    },

    policySnapshot:
      googlePolicySnapshot,
  });

const googleSubmissionRecord =
  Object.freeze({
    schemaVersion:
      "1.4",

    submittedAt:
      "2026-09-24T12:01:00.000Z",

    status:
      "SUBMITTED",

    reservationId:
      "11111111-1111-4111-8111-111111111111",

    episodeId:
      "EP92",

    shotId:
      "S01",

    provider:
      "GOOGLE_GENAI",

    providerExecutionId:
      googleInteractionId,

    recoveryMetadata:
      googleRecoveryMetadata,
  });

const veoRecoveryMetadata =
  Object.freeze({
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
        "Busybookie Veo execution submission test.",

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
  });

const legacySubmissionBase =
  Object.freeze({
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

    providerExecutionId:
      "provider-execution-123",
  });

function withPath(
  source:
    object,
  path:
    readonly string[],
  value:
    unknown,
): Record<string, unknown> {
  const clone =
    structuredClone(
      source,
    ) as Record<string, unknown>;

  let cursor:
    Record<string, unknown> =
      clone;

  for (
    const key of path.slice(
      0,
      -1,
    )
  ) {
    cursor =
      cursor[key] as Record<string, unknown>;
  }

  const last =
    path[path.length - 1] as string;

  if (
    value === undefined
  ) {
    delete cursor[last];
  } else {
    cursor[last] =
      value;
  }

  return clone;
}

function acceptsSubmission(
  record:
    unknown,
): boolean {
  return ExecutionSubmissionSchema
    .safeParse(
      record,
    )
    .success;
}

describe(
  "Busybookie Google GenAI durable execution submission 1.4",
  () => {
    it(
      "accepts a valid persisted GOOGLE_GENAI submission 1.4",
      () => {
        expect(
          ExecutionSubmissionSchema
            .parse(
              googleSubmissionRecord,
            ),
        ).toEqual(
          googleSubmissionRecord,
        );
      },
    );

    it(
      "stores the Google Interaction.id only as providerExecutionId",
      () => {
        const parsed =
          ExecutionSubmissionSchema
            .parse(
              googleSubmissionRecord,
            );

        expect(
          parsed.providerExecutionId,
        ).toBe(
          googleInteractionId,
        );

        expect(
          Object.keys(
            parsed,
          ),
        ).not.toContain(
          "interactionId",
        );
      },
    );

    it(
      "rejects a duplicate top-level interactionId",
      () => {
        expect(
          acceptsSubmission({
            ...googleSubmissionRecord,

            interactionId:
              googleInteractionId,
          }),
        ).toBe(
          false,
        );
      },
    );

    it(
      "reads a manually persisted Google 1.4 record through the durable reader",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const submissionPath =
          createExecutionSubmissionPath(
            mediaRoot,
            "EP92",
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
            googleSubmissionRecord,
            null,
            2,
          ),
          "utf8",
        );

        await expect(
          readExecutionSubmission(
            mediaRoot,
            "EP92",
            "S01",
          ),
        ).resolves.toEqual(
          googleSubmissionRecord,
        );
      },
    );

    it(
      "fails closed when a persisted Google 1.4 record is invalid",
      async () => {
        const mediaRoot =
          await makeTempDirectory();

        const submissionPath =
          createExecutionSubmissionPath(
            mediaRoot,
            "EP92",
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
            withPath(
              googleSubmissionRecord,
              [
                "recoveryMetadata",
                "request",
                "store",
              ],
              false,
            ),
          ),
          "utf8",
        );

        await expect(
          readExecutionSubmission(
            mediaRoot,
            "EP92",
            "S01",
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects GOOGLE_GENAI through current submission write admission",
      () => {
        const {
          schemaVersion: _schemaVersion,
          submittedAt: _submittedAt,
          status: _status,
          ...googleInput
        } =
          googleSubmissionRecord;

        expect(
          ExecutionSubmissionInputSchema
            .safeParse(
              googleInput,
            )
            .success,
        ).toBe(
          false,
        );

        expect(
          ExecutionSubmissionInputSchema
            .safeParse({
              ...googleInput,

              recoveryMetadata:
                veoRecoveryMetadata,
            })
            .success,
        ).toBe(
          false,
        );

        expect(
          ExecutionSubmissionInputSchema
            .safeParse({
              ...googleInput,

              providerEstimatedCredits:
                60,

              recoveryMetadata:
                runwayRecoveryMetadata,
            })
            .success,
        ).toBe(
          false,
        );
      },
    );

    it.each([
      "1.0",
      "1.1",
      "1.2",
      "1.3",
    ])(
      "rejects GOOGLE_GENAI with Google recovery metadata at schemaVersion %s",
      (schemaVersion) => {
        expect(
          acceptsSubmission({
            ...googleSubmissionRecord,
            schemaVersion,
          }),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects GOOGLE_GENAI in each legacy version record shape",
      () => {
        expect(
          acceptsSubmission({
            ...legacySubmissionBase,

            schemaVersion:
              "1.0",

            provider:
              "GOOGLE_GENAI",
          }),
        ).toBe(
          false,
        );

        expect(
          acceptsSubmission({
            ...legacySubmissionBase,

            schemaVersion:
              "1.1",

            provider:
              "GOOGLE_GENAI",

            providerEstimatedCredits:
              60,
          }),
        ).toBe(
          false,
        );

        expect(
          acceptsSubmission({
            ...legacySubmissionBase,

            schemaVersion:
              "1.2",

            provider:
              "GOOGLE_GENAI",

            providerEstimatedCredits:
              60,

            recoveryMetadata:
              runwayRecoveryMetadata,
          }),
        ).toBe(
          false,
        );

        expect(
          acceptsSubmission({
            ...legacySubmissionBase,

            schemaVersion:
              "1.3",

            provider:
              "GOOGLE_GENAI",

            recoveryMetadata:
              veoRecoveryMetadata,
          }),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects RUNWAY and VEO as schemaVersion 1.4",
      () => {
        for (
          const provider of [
            "RUNWAY",
            "VEO",
            "MANUAL",
          ]
        ) {
          expect(
            acceptsSubmission({
              ...googleSubmissionRecord,
              provider,
            }),
          ).toBe(
            false,
          );
        }

        expect(
          acceptsSubmission({
            ...googleSubmissionRecord,

            provider:
              "RUNWAY",

            providerEstimatedCredits:
              60,

            recoveryMetadata:
              runwayRecoveryMetadata,
          }),
        ).toBe(
          false,
        );

        expect(
          acceptsSubmission({
            ...googleSubmissionRecord,

            provider:
              "VEO",

            recoveryMetadata:
              veoRecoveryMetadata,
          }),
        ).toBe(
          false,
        );
      },
    );

    it(
      "requires Google recoveryMetadata, request, and policySnapshot",
      () => {
        for (
          const path of [
            [
              "recoveryMetadata",
            ],
            [
              "recoveryMetadata",
              "request",
            ],
            [
              "recoveryMetadata",
              "policySnapshot",
            ],
          ]
        ) {
          expect(
            acceptsSubmission(
              withPath(
                googleSubmissionRecord,
                path,
                undefined,
              ),
            ),
            path.join("."),
          ).toBe(
            false,
          );
        }
      },
    );

    it(
      "keeps Google recoveryMetadata and request strict",
      () => {
        expect(
          acceptsSubmission(
            withPath(
              googleSubmissionRecord,
              [
                "recoveryMetadata",
                "operationName",
              ],
              "models/veo/operations/123",
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          acceptsSubmission(
            withPath(
              googleSubmissionRecord,
              [
                "recoveryMetadata",
                "request",
                "durationSeconds",
              ],
              8,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          acceptsSubmission(
            withPath(
              googleSubmissionRecord,
              [
                "recoveryMetadata",
                "request",
                "interactionId",
              ],
              googleInteractionId,
            ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it.each([
      [
        "model",
        "gemini-omni-1.1-pro",
      ],
      [
        "model",
        "veo-3.1-generate-preview",
      ],
      [
        "model",
        "",
      ],
      [
        "model",
        undefined,
      ],
      [
        "background",
        false,
      ],
      [
        "background",
        "true",
      ],
      [
        "background",
        undefined,
      ],
      [
        "store",
        false,
      ],
      [
        "store",
        "true",
      ],
      [
        "store",
        undefined,
      ],
      [
        "stream",
        true,
      ],
      [
        "stream",
        "false",
      ],
      [
        "stream",
        undefined,
      ],
      [
        "promptText",
        "",
      ],
      [
        "promptText",
        "   ",
      ],
      [
        "promptText",
        undefined,
      ],
      [
        "sourceImagePath",
        "",
      ],
      [
        "sourceImagePath",
        "  \t ",
      ],
      [
        "sourceImagePath",
        undefined,
      ],
    ])(
      "rejects request.%s = %j",
      (
        field,
        value,
      ) => {
        expect(
          acceptsSubmission(
            withPath(
              googleSubmissionRecord,
              [
                "recoveryMetadata",
                "request",
                field,
              ],
              value,
            ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "validates policySnapshot through the existing GoogleGenAiPolicySchema",
      () => {
        const parsed =
          ExecutionSubmissionSchema
            .parse(
              googleSubmissionRecord,
            );

        expect(
          parsed.schemaVersion ===
            "1.4"
            ? parsed.recoveryMetadata
                .policySnapshot
            : null,
        ).toEqual(
          GoogleGenAiPolicySchema
            .parse(
              googlePolicySnapshot,
            ),
        );

        const underivedSnapshot =
          withPath(
            googlePolicySnapshot,
            [
              "pricing",
              "knownVideoOutput720pMicroUsdPerSecond",
            ],
            101361,
          );

        expect(
          GoogleGenAiPolicySchema
            .safeParse(
              underivedSnapshot,
            )
            .success,
        ).toBe(
          false,
        );

        expect(
          acceptsSubmission(
            withPath(
              googleSubmissionRecord,
              [
                "recoveryMetadata",
                "policySnapshot",
              ],
              underivedSnapshot,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          acceptsSubmission(
            withPath(
              googleSubmissionRecord,
              [
                "recoveryMetadata",
                "policySnapshot",
                "pricingProvenance",
                "verifiedOn",
              ],
              "2026-10-22",
            ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it.each([
      [
        [
          "schemaVersion",
        ],
        "1.1",
      ],
      [
        [
          "provider",
        ],
        "VEO",
      ],
      [
        [
          "model",
        ],
        "gemini-omni-1.1-pro",
      ],
      [
        [
          "pricing",
        ],
        undefined,
      ],
      [
        [
          "pricingProvenance",
        ],
        undefined,
      ],
      [
        [
          "costCompleteness",
          "preReservationTotalCostExactlyKnown",
        ],
        true,
      ],
      [
        [
          "pricing",
          "inputMicroUsdPerMillionTokens",
        ],
        0,
      ],
      [
        [
          "pricingReviewedOn",
        ],
        "23/10/2026",
      ],
      [
        [
          "unexpected",
        ],
        "value",
      ],
    ])(
      "rejects a malformed or incomplete policySnapshot at %j",
      (
        path,
        value,
      ) => {
        expect(
          acceptsSubmission(
            withPath(
              googleSubmissionRecord,
              [
                "recoveryMetadata",
                "policySnapshot",
                ...path,
              ],
              value,
            ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects an empty policySnapshot object",
      () => {
        expect(
          acceptsSubmission(
            withPath(
              googleSubmissionRecord,
              [
                "recoveryMetadata",
                "policySnapshot",
              ],
              {},
            ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "rejects secret-like unknown fields at every strict boundary",
      () => {
        const secretFields = [
          "apiKey",
          "credentials",
          "credential",
          "secret",
          "authorization",
          "accessToken",
          "refreshToken",
        ];

        const boundaries:
          readonly (readonly string[])[] = [
            [],
            [
              "recoveryMetadata",
            ],
            [
              "recoveryMetadata",
              "request",
            ],
            [
              "recoveryMetadata",
              "policySnapshot",
            ],
          ];

        for (
          const boundary of boundaries
        ) {
          for (
            const field of secretFields
          ) {
            expect(
              acceptsSubmission(
                withPath(
                  googleSubmissionRecord,
                  [
                    ...boundary,
                    field,
                  ],
                  "redacted-test-value",
                ),
              ),
              [
                ...boundary,
                field,
              ].join("."),
            ).toBe(
              false,
            );
          }
        }
      },
    );
  },
);

describe(
  "Busybookie legacy execution submission version domains",
  () => {
    it.each([
      "RUNWAY",
      "VEO",
    ])(
      "keeps legacy schemaVersion 1.0 valid for %s",
      (provider) => {
        expect(
          acceptsSubmission({
            ...legacySubmissionBase,

            schemaVersion:
              "1.0",

            provider,
          }),
        ).toBe(
          true,
        );
      },
    );

    it(
      "keeps schemaVersion 1.1 and 1.2 RUNWAY-only",
      () => {
        const runwayV1_1 = {
          ...legacySubmissionBase,

          schemaVersion:
            "1.1",

          provider:
            "RUNWAY",

          providerEstimatedCredits:
            60,
        };

        const runwayV1_2 = {
          ...runwayV1_1,

          schemaVersion:
            "1.2",

          recoveryMetadata:
            runwayRecoveryMetadata,
        };

        expect(
          acceptsSubmission(
            runwayV1_1,
          ),
        ).toBe(
          true,
        );

        expect(
          acceptsSubmission(
            runwayV1_2,
          ),
        ).toBe(
          true,
        );

        expect(
          acceptsSubmission({
            ...runwayV1_1,

            provider:
              "VEO",
          }),
        ).toBe(
          false,
        );

        expect(
          acceptsSubmission({
            ...runwayV1_2,

            provider:
              "VEO",
          }),
        ).toBe(
          false,
        );
      },
    );

    it(
      "keeps schemaVersion 1.3 VEO-only",
      () => {
        const veoV1_3 = {
          ...legacySubmissionBase,

          schemaVersion:
            "1.3",

          provider:
            "VEO",

          recoveryMetadata:
            veoRecoveryMetadata,
        };

        expect(
          acceptsSubmission(
            veoV1_3,
          ),
        ).toBe(
          true,
        );

        expect(
          acceptsSubmission({
            ...veoV1_3,

            provider:
              "RUNWAY",
          }),
        ).toBe(
          false,
        );
      },
    );
  },
);
