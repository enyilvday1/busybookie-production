import {
  createHash,
} from "node:crypto";

import {
  mkdir,
  mkdtemp,
  readdir,
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
  relative,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createVisualAttemptExecutionCompletion,
} from "../src/execution/createVisualAttemptExecutionCompletion.js";

import {
  createExecutionCompletionPath,
} from "../src/execution/executionCompletionPath.js";

import {
  createExecutionReservationPath,
} from "../src/execution/executionReservationPath.js";

import {
  createExecutionSubmissionPath,
} from "../src/execution/executionSubmissionPath.js";

import {
  inspectVisualAttemptExecutionLifecycle,
} from "../src/execution/inspectVisualAttemptExecutionLifecycle.js";

import {
  createVisualAttemptExecutionCompletionPath,
  createVisualAttemptExecutionReservationPath,
  createVisualAttemptExecutionSubmissionPath,
} from "../src/execution/visualAttemptExecutionPaths.js";

import {
  createVisualAttemptAdmissionPath,
} from "../src/execution/visualAttemptPaths.js";

import {
  createGoogleGenAiGenerationRecordPath,
} from "../src/googleGenai/audit/googleGenAiGenerationRecordPath.js";

import {
  createGoogleGenAiVideoOutputPath,
} from "../src/googleGenai/output/googleGenAiVideoOutputPath.js";

const roots: string[] = [];

afterEach(
  async () => {
    while (
      roots.length > 0
    ) {
      const root =
        roots.pop();

      if (
        root
      ) {
        await rm(
          root,
          {
            recursive: true,
            force: true,
          },
        );
      }
    }
  },
);

function sha256(
  bytes: string | Buffer,
): string {
  return createHash(
    "sha256",
  )
    .update(
      bytes,
    )
    .digest(
      "hex",
    );
}

function canonical(
  value: unknown,
): string {
  return `${JSON.stringify(
    value,
    null,
    2,
  )}\n`;
}

async function writeRaw(
  path: string,
  raw: string,
): Promise<string> {
  await mkdir(
    dirname(
      path,
    ),
    {
      recursive: true,
    },
  );

  await writeFile(
    path,
    raw,
    "utf8",
  );

  return raw;
}

async function writeCanonical(
  path: string,
  value: unknown,
): Promise<string> {
  return writeRaw(
    path,
    canonical(
      value,
    ),
  );
}

const EPISODE_ID = "EP93";
const SCENE_ID = "SC01";
const SHOT_ID = "S01";
const ATTEMPT_NUMBER = 2;
const ADMISSION_ID = "f71c8cf1-a82d-4410-954f-6af17cc3ce22";
const RESERVATION_ID = "a83c34e2-fe66-47e1-9166-dd25e947003a";
const PROVIDER_EXECUTION_ID = "interaction-attempt-2";

const recoveryMetadata = {
  request: {
    model: "gemini-omni-1.1-flash",
    background: true,
    store: true,
    stream: false,
    promptText: "Animate the approved Littleleaf Valley reference.",
    sourceImagePath: "C:\\Busybookie\\tests\\littleleaf_valley_storybook_village.png",
  },

  policySnapshot: {
    schemaVersion: "1.0",
    provider: "GOOGLE_GENAI",
    model: "gemini-omni-1.1-flash",
    pricingReviewedOn: "2026-10-23",

    pricingProvenance: {
      pricingSource: "GOOGLE_GEMINI_API_OFFICIAL_PRICING_PAGE",
      modelLifecycleSource: "GOOGLE_GEMINI_API_OFFICIAL_DEPRECATIONS_PAGE",
      verifiedOn: "2026-10-23",
    },

    pricing: {
      currency: "USD",
      fixedPointUnit: "MICRO_USD",
      tokensPerPricingUnit: 1000000,
      inputMicroUsdPerMillionTokens: 1500000,
      videoOutputMicroUsdPerMillionTokens: 17500000,
      videoOutput720pTokensPerSecond: 5792,
      knownVideoOutput720pMicroUsdPerSecond: 101360,
    },

    costCompleteness: {
      costScope: "KNOWN_VIDEO_OUTPUT_PLUS_SEPARATE_INPUT_COMPONENT",
      preReservationTotalCostExactlyKnown: false,
      inputTokenComponentIncludedInKnownCost: false,
    },
  },
} as const;

type Stage =
  | "ADMITTED"
  | "RESERVED"
  | "SUBMITTED"
  | "COMPLETED";

const STAGE_ORDER: readonly Stage[] = [
  "ADMITTED",
  "RESERVED",
  "SUBMITTED",
  "COMPLETED",
];

function reaches(
  stage: Stage,
  level: Stage,
): boolean {
  return STAGE_ORDER.indexOf(stage) >= STAGE_ORDER.indexOf(level);
}

async function makeMediaRoot(): Promise<string> {
  const mediaRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-visual-attempt-inspection-",
      ),
    );

  roots.push(
    mediaRoot,
  );

  return mediaRoot;
}

async function makeFixture(
  stage: Stage,
  options: Readonly<{
    provider?: "GOOGLE_GENAI" | "RUNWAY" | "VEO";
  }> = {},
) {
  const mediaRoot =
    await makeMediaRoot();

  const provider =
    options.provider ?? "GOOGLE_GENAI";

  const admissionPath =
    createVisualAttemptAdmissionPath(mediaRoot, EPISODE_ID, SHOT_ID, ATTEMPT_NUMBER);

  const reservationPath =
    createVisualAttemptExecutionReservationPath(mediaRoot, EPISODE_ID, SHOT_ID, ATTEMPT_NUMBER);

  const submissionPath =
    createVisualAttemptExecutionSubmissionPath(mediaRoot, EPISODE_ID, SHOT_ID, ATTEMPT_NUMBER);

  const completionPath =
    createVisualAttemptExecutionCompletionPath(mediaRoot, EPISODE_ID, SHOT_ID, ATTEMPT_NUMBER);

  const generationRecordPath =
    createGoogleGenAiGenerationRecordPath(mediaRoot, EPISODE_ID, SHOT_ID, PROVIDER_EXECUTION_ID);

  const outputPath =
    createGoogleGenAiVideoOutputPath(mediaRoot, EPISODE_ID, SHOT_ID, PROVIDER_EXECUTION_ID);

  const admissionRecord = {
    schemaVersion: "1.0",
    admissionId: ADMISSION_ID,
    attemptNumber: ATTEMPT_NUMBER,
    admittedAt: "2026-11-03T11:00:00.000Z",
    status: "ADMITTED",
    episodeId: EPISODE_ID,
    sceneId: SCENE_ID,
    shotId: SHOT_ID,
    provider,
    manifestRawSha256: "1".repeat(64),
    promptIdentitySha256: "2".repeat(64),
    referenceIdentitySha256: "3".repeat(64),
    previousAttemptNumber: 1,
    previousAttemptQcSha256: "4".repeat(64),
  };

  const admissionSha256 =
    sha256(
      await writeCanonical(
        admissionPath,
        admissionRecord,
      ),
    );

  const reservationRecord = {
    schemaVersion: "1.0",
    reservationId: RESERVATION_ID,
    reservedAt: "2026-11-03T11:01:00.000Z",
    status: "RESERVED",
    episodeId: EPISODE_ID,
    sceneId: SCENE_ID,
    shotId: SHOT_ID,
    attemptNumber: ATTEMPT_NUMBER,
    admissionId: ADMISSION_ID,
    admissionSha256,
    provider,
  };

  const reservationSha256 =
    sha256(
      canonical(
        reservationRecord,
      ),
    );

  if (
    reaches(stage, "RESERVED")
  ) {
    await writeCanonical(
      reservationPath,
      reservationRecord,
    );
  }

  const submissionRecord = {
    schemaVersion: "1.0",
    submittedAt: "2026-11-03T11:02:00.000Z",
    status: "SUBMITTED",
    reservationId: RESERVATION_ID,
    reservationSha256,
    episodeId: EPISODE_ID,
    sceneId: SCENE_ID,
    shotId: SHOT_ID,
    attemptNumber: ATTEMPT_NUMBER,
    admissionId: ADMISSION_ID,
    admissionSha256,
    provider: "GOOGLE_GENAI",
    providerExecutionId: PROVIDER_EXECUTION_ID,
    recoveryMetadata,
  };

  const submissionSha256 =
    sha256(
      canonical(
        submissionRecord,
      ),
    );

  if (
    reaches(stage, "SUBMITTED")
  ) {
    await writeCanonical(
      submissionPath,
      submissionRecord,
    );
  }

  const outputBytes =
    Buffer.from(
      "attempt-aware-google-video-output",
      "utf8",
    );

  const generationOutput = {
    outputIndex: 1,
    destinationPath: outputPath,
    bytes: outputBytes.byteLength,
    sha256: sha256(outputBytes),
    contentType: "video/mp4",
  };

  const generationRecord = {
    schemaVersion: "1.0",
    recordedAt: "2026-11-03T11:03:00.000Z",
    reservationId: RESERVATION_ID,
    provider: "GOOGLE_GENAI",
    episodeId: EPISODE_ID,
    shotId: SHOT_ID,
    providerExecutionId: PROVIDER_EXECUTION_ID,
    outputs: [
      generationOutput,
    ],
  };

  let generationRecordRaw: string | null =
    null;

  let completionRecord: Record<string, unknown> | null =
    null;

  if (
    reaches(stage, "COMPLETED")
  ) {
    await mkdir(
      dirname(
        outputPath,
      ),
      {
        recursive: true,
      },
    );

    await writeFile(
      outputPath,
      outputBytes,
    );

    generationRecordRaw =
      await writeCanonical(
        generationRecordPath,
        generationRecord,
      );

    // The real Slice-2C writer binds the full durable chain for COMPLETED fixtures.
    const created =
      await createVisualAttemptExecutionCompletion(
        mediaRoot,
        {
          episodeId: EPISODE_ID,
          sceneId: SCENE_ID,
          shotId: SHOT_ID,
          attemptNumber: ATTEMPT_NUMBER,
          expectedAdmissionId: ADMISSION_ID,
          expectedAdmissionSha256: admissionSha256,
          expectedReservationId: RESERVATION_ID,
          expectedReservationSha256: reservationSha256,
          expectedSubmissionSha256: submissionSha256,
        },
        {
          now: () => "2026-11-03T11:04:00.000Z",
        },
      );

    completionRecord = {
      ...created.record,
    };
  }

  return {
    mediaRoot,
    admissionPath,
    reservationPath,
    submissionPath,
    completionPath,
    generationRecordPath,
    outputPath,
    admissionRecord,
    reservationRecord,
    submissionRecord,
    generationOutput,
    generationRecord,
    generationRecordRaw,
    completionRecord,
    admissionSha256,
    reservationSha256,
    submissionSha256,
  };
}

type Fixture =
  Awaited<
    ReturnType<
      typeof makeFixture
    >
  >;

function inspect(
  fixture: Readonly<{
    mediaRoot: string;
  }>,
  attemptNumber: number = ATTEMPT_NUMBER,
) {
  return inspectVisualAttemptExecutionLifecycle(
    fixture.mediaRoot,
    EPISODE_ID,
    SHOT_ID,
    attemptNumber,
  );
}

function requireCompletionRecord(
  fixture: Fixture,
): Record<string, unknown> {
  if (
    fixture.completionRecord === null
  ) {
    throw new Error(
      "Fixture has no completion record.",
    );
  }

  return fixture.completionRecord;
}

async function rewriteCompletion(
  fixture: Fixture,
  patch: Record<string, unknown>,
): Promise<void> {
  await writeCanonical(
    fixture.completionPath,
    {
      ...requireCompletionRecord(
        fixture,
      ),
      ...patch,
    },
  );
}

/**
 * Replaces the generation record and re-binds the completion's
 * generationRecordSha256 to the new bytes so the check under test, not the
 * raw-byte hash check, is the one that must refuse.
 */
async function rewriteGenerationRecordBound(
  fixture: Fixture,
  value: unknown,
): Promise<void> {
  const raw =
    await writeCanonical(
      fixture.generationRecordPath,
      value,
    );

  await rewriteCompletion(
    fixture,
    {
      generationRecordSha256: sha256(raw),
    },
  );
}

async function snapshotTree(
  root: string,
): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};

  const entries =
    await readdir(
      root,
      {
        recursive: true,
        withFileTypes: true,
      },
    );

  for (
    const entry of entries
  ) {
    const fullPath =
      join(
        entry.parentPath,
        entry.name,
      );

    const key =
      relative(
        root,
        fullPath,
      );

    snapshot[key] =
      entry.isFile()
        ? sha256(await readFile(fullPath))
        : entry.isDirectory()
          ? "<dir>"
          : "<other>";
  }

  return snapshot;
}

describe(
  "attempt-aware visual execution lifecycle inspection",
  () => {
    describe(
      "lifecycle states",
      () => {
        it(
          "reports NOT_ADMITTED with validated identity and no provider identity when no attempt evidence exists",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const result =
              await inspect({
                mediaRoot,
              });

            expect(
              result,
            ).toEqual({
              state: "NOT_ADMITTED",
              episodeId: EPISODE_ID,
              shotId: SHOT_ID,
              attemptNumber: ATTEMPT_NUMBER,
            });

            expect(
              Object.keys(result).sort(),
            ).toEqual([
              "attemptNumber",
              "episodeId",
              "shotId",
              "state",
            ]);

            expect(
              "provider" in result,
            ).toBe(
              false,
            );

            expect(
              Object.isFrozen(result),
            ).toBe(
              true,
            );
          },
        );

        it(
          "reports ADMITTED_ONLY for a canonical admission alone",
          async () => {
            const fixture =
              await makeFixture("ADMITTED");

            const result =
              await inspect(fixture);

            expect(
              result.state,
            ).toBe(
              "ADMITTED_ONLY",
            );

            if (
              result.state !== "ADMITTED_ONLY"
            ) {
              return;
            }

            expect(result.episodeId).toBe(EPISODE_ID);
            expect(result.sceneId).toBe(SCENE_ID);
            expect(result.shotId).toBe(SHOT_ID);
            expect(result.attemptNumber).toBe(ATTEMPT_NUMBER);
            expect(result.admissionId).toBe(ADMISSION_ID);
            expect(result.provider).toBe("GOOGLE_GENAI");
            expect(result.admission.admissionSha256).toBe(fixture.admissionSha256);
            expect(result.admission.admissionPath).toBe(fixture.admissionPath);
            expect(Object.isFrozen(result)).toBe(true);
          },
        );

        it(
          "reports RESERVED_ONLY for canonical admission and reservation",
          async () => {
            const fixture =
              await makeFixture("RESERVED");

            const result =
              await inspect(fixture);

            expect(
              result.state,
            ).toBe(
              "RESERVED_ONLY",
            );

            if (
              result.state !== "RESERVED_ONLY"
            ) {
              return;
            }

            expect(result.reservationId).toBe(RESERVATION_ID);
            expect(result.reservation.reservationSha256).toBe(fixture.reservationSha256);
            expect(result.reservation.record.admissionSha256).toBe(fixture.admissionSha256);
            expect(result.provider).toBe("GOOGLE_GENAI");
            expect(Object.isFrozen(result)).toBe(true);
          },
        );

        it(
          "reports SUBMITTED for canonical admission, reservation and submission",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const result =
              await inspect(fixture);

            expect(
              result.state,
            ).toBe(
              "SUBMITTED",
            );

            if (
              result.state !== "SUBMITTED"
            ) {
              return;
            }

            expect(result.providerExecutionId).toBe(PROVIDER_EXECUTION_ID);
            expect(result.submission.submissionSha256).toBe(fixture.submissionSha256);
            expect(result.submission.record.reservationSha256).toBe(fixture.reservationSha256);
            expect(result.reservationId).toBe(RESERVATION_ID);
            expect(Object.isFrozen(result)).toBe(true);
          },
        );

        it(
          "reports COMPLETED with a verified canonical generation record and canonical output identity",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            const result =
              await inspect(fixture);

            expect(
              result.state,
            ).toBe(
              "COMPLETED",
            );

            if (
              result.state !== "COMPLETED"
            ) {
              return;
            }

            expect(result.providerExecutionId).toBe(PROVIDER_EXECUTION_ID);
            expect(result.completion.completionPath).toBe(fixture.completionPath);
            expect(result.completion.record.submissionSha256).toBe(fixture.submissionSha256);
            expect(result.generationRecord.generationRecordPath).toBe(fixture.generationRecordPath);
            expect(result.generationRecord.generationRecordSha256).toBe(
              sha256(fixture.generationRecordRaw ?? ""),
            );
            expect(result.generationRecord.outputPath).toBe(fixture.outputPath);
            expect(result.generationRecord.record.outputs).toHaveLength(1);
            expect(result.generationRecord.record.outputs[0].outputIndex).toBe(1);
            expect(result.generationRecord.record.outputs[0].destinationPath).toBe(fixture.outputPath);
            expect(Object.isFrozen(result)).toBe(true);
            expect(Object.isFrozen(result.generationRecord)).toBe(true);
          },
        );

        it(
          "does not read or verify the output video bytes when reporting COMPLETED",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await writeFile(
              fixture.outputPath,
              Buffer.from(
                "different-bytes-that-would-fail-output-verification",
              ),
            );

            expect(
              (await inspect(fixture)).state,
            ).toBe(
              "COMPLETED",
            );

            await rm(
              fixture.outputPath,
              {
                force: true,
              },
            );

            expect(
              (await inspect(fixture)).state,
            ).toBe(
              "COMPLETED",
            );
          },
        );
      },
    );

    describe(
      "attempt isolation",
      () => {
        it(
          "ignores attempt-1 legacy lifecycle files next to attempt 2",
          async () => {
            const fixture =
              await makeFixture("RESERVED");

            // Deliberately corrupt legacy files: reading them would throw.
            for (
              const legacyPath of [
                createExecutionReservationPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID),
                createExecutionSubmissionPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID),
                createExecutionCompletionPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID),
              ]
            ) {
              await writeRaw(
                legacyPath,
                "{",
              );
            }

            const result =
              await inspect(fixture);

            expect(
              result.state,
            ).toBe(
              "RESERVED_ONLY",
            );
          },
        );

        it(
          "reports NOT_ADMITTED for attempt 2 when only legacy attempt-1 evidence exists",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await writeRaw(
              createExecutionReservationPath(mediaRoot, EPISODE_ID, SHOT_ID),
              "{",
            );

            expect(
              (
                await inspect({
                  mediaRoot,
                })
              ).state,
            ).toBe(
              "NOT_ADMITTED",
            );
          },
        );

        it(
          "ignores attempt-3 evidence when inspecting attempt 2",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            for (
              const attempt3Path of [
                createVisualAttemptAdmissionPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID, 3),
                createVisualAttemptExecutionReservationPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID, 3),
                createVisualAttemptExecutionSubmissionPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID, 3),
                createVisualAttemptExecutionCompletionPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID, 3),
              ]
            ) {
              await writeRaw(
                attempt3Path,
                "{",
              );
            }

            expect(
              (await inspect(fixture)).state,
            ).toBe(
              "SUBMITTED",
            );
          },
        );

        it.each([
          1,
          0,
          -2,
          2.5,
          Number.NaN,
        ])(
          "rejects non-replacement attempt number %s",
          async (
            attemptNumber,
          ) => {
            const mediaRoot =
              await makeMediaRoot();

            await expect(
              inspect(
                {
                  mediaRoot,
                },
                attemptNumber,
              ),
            ).rejects.toThrow(
              /replacement attempt number/i,
            );
          },
        );

        it(
          "rejects attempt 1 even when legacy lifecycle evidence exists",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await writeRaw(
              createExecutionReservationPath(mediaRoot, EPISODE_ID, SHOT_ID),
              "{}",
            );

            await expect(
              inspect(
                {
                  mediaRoot,
                },
                1,
              ),
            ).rejects.toThrow(
              /legacy lifecycle/i,
            );
          },
        );

        it(
          "rejects invalid episode and shot identity",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await expect(
              inspectVisualAttemptExecutionLifecycle(
                mediaRoot,
                "EPISODE93",
                SHOT_ID,
                ATTEMPT_NUMBER,
              ),
            ).rejects.toThrow();

            await expect(
              inspectVisualAttemptExecutionLifecycle(
                mediaRoot,
                EPISODE_ID,
                "../S01",
                ATTEMPT_NUMBER,
              ),
            ).rejects.toThrow();
          },
        );
      },
    );

    describe(
      "orphan evidence fails closed",
      () => {
        it(
          "refuses a reservation without an admission",
          async () => {
            const fixture =
              await makeFixture("RESERVED");

            await rm(fixture.admissionPath);

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /reservation exists without a durable admission/i,
            );
          },
        );

        it(
          "refuses a submission without an admission",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await rm(fixture.admissionPath);
            await rm(fixture.reservationPath);

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /submission exists without a durable admission/i,
            );
          },
        );

        it(
          "refuses a completion without an admission",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rm(fixture.admissionPath);
            await rm(fixture.reservationPath);
            await rm(fixture.submissionPath);

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /completion exists without a durable admission/i,
            );
          },
        );

        it(
          "refuses a submission without a reservation",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await rm(fixture.reservationPath);

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /submission exists without a durable reservation/i,
            );
          },
        );

        it(
          "refuses a completion without a reservation",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rm(fixture.reservationPath);
            await rm(fixture.submissionPath);

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /completion exists without a durable reservation/i,
            );
          },
        );

        it(
          "refuses a completion without a submission",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rm(fixture.submissionPath);

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /completion exists without a durable submission/i,
            );
          },
        );
      },
    );

    describe(
      "durable evidence corruption fails closed",
      () => {
        it(
          "refuses malformed admission JSON instead of reporting NOT_ADMITTED",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await writeRaw(
              createVisualAttemptAdmissionPath(mediaRoot, EPISODE_ID, SHOT_ID, ATTEMPT_NUMBER),
              "{",
            );

            await expect(
              inspect({
                mediaRoot,
              }),
            ).rejects.toThrow(
              /not valid JSON/i,
            );
          },
        );

        it(
          "refuses malformed reservation JSON",
          async () => {
            const fixture =
              await makeFixture("RESERVED");

            await writeRaw(
              fixture.reservationPath,
              "{",
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /not valid JSON/i,
            );
          },
        );

        it(
          "refuses noncanonical admission bytes",
          async () => {
            const fixture =
              await makeFixture("ADMITTED");

            await writeRaw(
              fixture.admissionPath,
              JSON.stringify(fixture.admissionRecord),
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /not canonical/i,
            );
          },
        );

        it(
          "refuses noncanonical submission bytes",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await writeRaw(
              fixture.submissionPath,
              JSON.stringify(fixture.submissionRecord),
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /not canonical/i,
            );
          },
        );

        it(
          "refuses noncanonical completion bytes",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await writeRaw(
              fixture.completionPath,
              JSON.stringify(requireCompletionRecord(fixture)),
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /not canonical/i,
            );
          },
        );

        it(
          "refuses embedded reservation path identity mismatch",
          async () => {
            const fixture =
              await makeFixture("RESERVED");

            await writeCanonical(
              fixture.reservationPath,
              {
                ...fixture.reservationRecord,
                shotId: "S02",
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /identity does not match its canonical path/i,
            );
          },
        );

        it(
          "refuses reservation scene identity that disagrees with admission",
          async () => {
            const fixture =
              await makeFixture("RESERVED");

            await writeCanonical(
              fixture.reservationPath,
              {
                ...fixture.reservationRecord,
                sceneId: "SC02",
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /reservation identity does not match the durable admission/i,
            );
          },
        );

        it(
          "refuses reservation admission ID mismatch",
          async () => {
            const fixture =
              await makeFixture("RESERVED");

            await writeCanonical(
              fixture.reservationPath,
              {
                ...fixture.reservationRecord,
                admissionId: "11111111-1111-4111-8111-111111111111",
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /reservation is not bound to the exact durable admission/i,
            );
          },
        );

        it(
          "refuses admission SHA-256 mismatch in reservation",
          async () => {
            const fixture =
              await makeFixture("RESERVED");

            await writeCanonical(
              fixture.reservationPath,
              {
                ...fixture.reservationRecord,
                admissionSha256: "f".repeat(64),
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /reservation is not bound to the exact durable admission/i,
            );
          },
        );

        it(
          "refuses a modified admission whose SHA-256 no longer matches downstream evidence",
          async () => {
            const fixture =
              await makeFixture("RESERVED");

            await writeCanonical(
              fixture.admissionPath,
              {
                ...fixture.admissionRecord,
                manifestRawSha256: "9".repeat(64),
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /reservation is not bound to the exact durable admission/i,
            );
          },
        );

        it(
          "refuses reservation provider that disagrees with admission",
          async () => {
            const fixture =
              await makeFixture("RESERVED");

            await writeCanonical(
              fixture.reservationPath,
              {
                ...fixture.reservationRecord,
                provider: "RUNWAY",
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /reservation provider RUNWAY does not match admission provider/i,
            );
          },
        );

        it(
          "refuses reservation SHA-256 mismatch in submission",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await writeCanonical(
              fixture.submissionPath,
              {
                ...fixture.submissionRecord,
                reservationSha256: "e".repeat(64),
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /submission is not bound to the exact durable reservation/i,
            );
          },
        );

        it(
          "refuses reservation ID mismatch in submission",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await writeCanonical(
              fixture.submissionPath,
              {
                ...fixture.submissionRecord,
                reservationId: "33333333-3333-4333-8333-333333333333",
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /submission is not bound to the exact durable reservation/i,
            );
          },
        );

        it(
          "refuses admission SHA-256 mismatch in submission",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await writeCanonical(
              fixture.submissionPath,
              {
                ...fixture.submissionRecord,
                admissionSha256: "f".repeat(64),
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /submission is not bound to the exact durable admission/i,
            );
          },
        );

        it(
          "refuses submission scene identity that disagrees with admission",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await writeCanonical(
              fixture.submissionPath,
              {
                ...fixture.submissionRecord,
                sceneId: "SC02",
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /submission identity does not match the durable admission/i,
            );
          },
        );

        it(
          "refuses submission SHA-256 mismatch in completion",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rewriteCompletion(
              fixture,
              {
                submissionSha256: "d".repeat(64),
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /completion is not bound to the exact durable submission SHA-256/i,
            );
          },
        );

        it(
          "refuses a modified submission whose SHA-256 no longer matches the completion",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await writeCanonical(
              fixture.submissionPath,
              {
                ...fixture.submissionRecord,
                submittedAt: "2026-11-03T11:02:30.000Z",
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /completion is not bound to the exact durable submission SHA-256/i,
            );
          },
        );

        it(
          "refuses reservation SHA-256 mismatch in completion",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rewriteCompletion(
              fixture,
              {
                reservationSha256: "e".repeat(64),
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /completion is not bound to the exact durable reservation/i,
            );
          },
        );

        it(
          "refuses admission SHA-256 mismatch in completion",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rewriteCompletion(
              fixture,
              {
                admissionSha256: "f".repeat(64),
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /completion is not bound to the exact durable admission/i,
            );
          },
        );

        it(
          "refuses completion providerExecutionId mismatch with the durable submission",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rewriteCompletion(
              fixture,
              {
                providerExecutionId: "interaction-other",
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /completion providerExecutionId does not match the durable submission/i,
            );
          },
        );

        it(
          "refuses completion scene identity that disagrees with admission",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rewriteCompletion(
              fixture,
              {
                sceneId: "SC02",
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /completion identity does not match the durable admission/i,
            );
          },
        );
      },
    );

    describe(
      "generation-record corruption fails closed",
      () => {
        it(
          "refuses a missing generation record for a completed lifecycle",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rm(fixture.generationRecordPath);

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /generation record required by a completed attempt-aware lifecycle is missing/i,
            );
          },
        );

        it(
          "refuses altered raw generation-record bytes",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await writeRaw(
              fixture.generationRecordPath,
              `${fixture.generationRecordRaw ?? ""} `,
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /generation record SHA-256 .* does not match attempt-aware completion/i,
            );
          },
        );

        it(
          "refuses a modified generation-record SHA-256 in the completion",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rewriteCompletion(
              fixture,
              {
                generationRecordSha256: "c".repeat(64),
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /does not match attempt-aware completion/i,
            );
          },
        );

        it(
          "refuses invalid generation-record JSON even when its hash is bound",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            const raw =
              await writeRaw(
                fixture.generationRecordPath,
                "{",
              );

            await rewriteCompletion(
              fixture,
              {
                generationRecordSha256: sha256(raw),
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /generation record is not valid JSON/i,
            );
          },
        );

        it(
          "refuses a schema-invalid generation record",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rewriteGenerationRecordBound(
              fixture,
              {
                ...fixture.generationRecord,
                outputs: [],
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow();
          },
        );

        it(
          "refuses a generation record with more than one output",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rewriteGenerationRecordBound(
              fixture,
              {
                ...fixture.generationRecord,
                outputs: [
                  fixture.generationOutput,
                  fixture.generationOutput,
                ],
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow();
          },
        );

        it(
          "refuses a non-Google generation-record provider",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rewriteGenerationRecordBound(
              fixture,
              {
                ...fixture.generationRecord,
                provider: "RUNWAY",
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow();
          },
        );

        it.each([
          [
            "reservationId",
            {
              reservationId: "55555555-5555-4555-8555-555555555555",
            },
          ],
          [
            "episodeId",
            {
              episodeId: "EP94",
            },
          ],
          [
            "shotId",
            {
              shotId: "S02",
            },
          ],
          [
            "providerExecutionId",
            {
              providerExecutionId: "interaction-other",
            },
          ],
        ])(
          "refuses a generation record with the wrong %s",
          async (
            _label,
            patch,
          ) => {
            const fixture =
              await makeFixture("COMPLETED");

            await rewriteGenerationRecordBound(
              fixture,
              {
                ...fixture.generationRecord,
                ...patch,
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /generation record identity does not match the verified attempt-aware execution chain/i,
            );
          },
        );

        it(
          "refuses a noncanonical completion generationRecordPath",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            const elsewhere =
              join(
                fixture.mediaRoot,
                "elsewhere.google-genai-generation.json",
              );

            await writeRaw(
              elsewhere,
              fixture.generationRecordRaw ?? "",
            );

            await rewriteCompletion(
              fixture,
              {
                generationRecordPath: elsewhere,
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /generationRecordPath is not the canonical Google generation record path/i,
            );
          },
        );

        it(
          "refuses a noncanonical output destination path",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rewriteGenerationRecordBound(
              fixture,
              {
                ...fixture.generationRecord,
                outputs: [
                  {
                    ...fixture.generationOutput,
                    destinationPath: join(fixture.mediaRoot, "outside.mp4"),
                  },
                ],
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /output destination is not the canonical output path/i,
            );
          },
        );

        it(
          "refuses an output destination carrying a noncanonical output index",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rewriteGenerationRecordBound(
              fixture,
              {
                ...fixture.generationRecord,
                outputs: [
                  {
                    ...fixture.generationOutput,
                    destinationPath: fixture.outputPath.replace(
                      /_01\.mp4$/,
                      "_02.mp4",
                    ),
                  },
                ],
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /output destination is not the canonical output path/i,
            );
          },
        );

        it(
          "refuses a noncanonical output index",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rewriteGenerationRecordBound(
              fixture,
              {
                ...fixture.generationRecord,
                outputs: [
                  {
                    ...fixture.generationOutput,
                    outputIndex: 2,
                  },
                ],
              },
            );

            await expect(
              inspect(fixture),
            ).rejects.toThrow();
          },
        );
      },
    );

    describe(
      "provider boundary",
      () => {
        it.each([
          "RUNWAY",
          "VEO",
        ] as const)(
          "refuses an admitted %s lifecycle instead of classifying it",
          async (
            provider,
          ) => {
            const fixture =
              await makeFixture(
                "ADMITTED",
                {
                  provider,
                },
              );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              new RegExp(
                `supports only the Google GenAI provider; admission declares provider ${provider}`,
              ),
            );
          },
        );

        it(
          "refuses a non-Google admitted lifecycle that also has a matching reservation",
          async () => {
            const fixture =
              await makeFixture(
                "RESERVED",
                {
                  provider: "RUNWAY",
                },
              );

            await expect(
              inspect(fixture),
            ).rejects.toThrow(
              /supports only the Google GenAI provider/i,
            );
          },
        );
      },
    );

    describe(
      "purity",
      () => {
        it(
          "does not alter the fixture directory listing or bytes for any lifecycle state",
          async () => {
            for (
              const stage of STAGE_ORDER
            ) {
              const fixture =
                await makeFixture(stage);

              const before =
                await snapshotTree(
                  fixture.mediaRoot,
                );

              await inspect(fixture);
              await inspect(fixture);

              expect(
                await snapshotTree(
                  fixture.mediaRoot,
                ),
                stage,
              ).toEqual(
                before,
              );
            }
          },
        );

        it(
          "does not alter fixtures when inspection fails closed",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rm(fixture.submissionPath);

            const before =
              await snapshotTree(
                fixture.mediaRoot,
              );

            await expect(
              inspect(fixture),
            ).rejects.toThrow();

            expect(
              await snapshotTree(
                fixture.mediaRoot,
              ),
            ).toEqual(
              before,
            );
          },
        );

        it(
          "creates no directories when inspecting an empty media root",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await inspect({
              mediaRoot,
            });

            expect(
              await readdir(mediaRoot),
            ).toEqual(
              [],
            );
          },
        );
      },
    );
  },
);
