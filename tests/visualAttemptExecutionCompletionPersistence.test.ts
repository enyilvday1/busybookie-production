import {
  createHash,
} from "node:crypto";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  dirname,
  join,
} from "node:path";

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
  createVisualAttemptExecutionCompletion,
  type CreateVisualAttemptExecutionCompletionInput,
} from "../src/execution/createVisualAttemptExecutionCompletion.js";

import {
  readVisualAttemptExecutionCompletion,
  readVisualAttemptExecutionCompletionEvidence,
} from "../src/execution/readVisualAttemptExecutionCompletion.js";

import {
  createVisualAttemptAdmissionPath,
} from "../src/execution/visualAttemptPaths.js";

import {
  createVisualAttemptExecutionCompletionPath,
  createVisualAttemptExecutionReservationPath,
  createVisualAttemptExecutionSubmissionPath,
} from "../src/execution/visualAttemptExecutionPaths.js";

import {
  createGoogleGenAiGenerationRecordPath,
} from "../src/googleGenai/audit/googleGenAiGenerationRecordPath.js";

import {
  createGoogleGenAiVideoOutputPath,
} from "../src/googleGenai/output/googleGenAiVideoOutputPath.js";

const roots:
  string[] =
    [];

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

async function writeCanonical(
  path: string,
  value: unknown,
): Promise<string> {
  await mkdir(
    dirname(
      path,
    ),
    {
      recursive: true,
    },
  );

  const raw =
    canonical(
      value,
    );

  await writeFile(
    path,
    raw,
    "utf8",
  );

  return raw;
}

async function readMaybe(
  path: string,
): Promise<Buffer | null> {
  try {
    return await readFile(
      path,
    );
  } catch (
    error
  ) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

const policySnapshot = {
  schemaVersion: "1.0",
  provider: "GOOGLE_GENAI",
  model: "gemini-omni-1.1-flash",
  pricingReviewedOn: "2026-10-23",

  pricingProvenance: {
    pricingSource:
      "GOOGLE_GEMINI_API_OFFICIAL_PRICING_PAGE",
    modelLifecycleSource:
      "GOOGLE_GEMINI_API_OFFICIAL_DEPRECATIONS_PAGE",
    verifiedOn:
      "2026-10-23",
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
    costScope:
      "KNOWN_VIDEO_OUTPUT_PLUS_SEPARATE_INPUT_COMPONENT",
    preReservationTotalCostExactlyKnown:
      false,
    inputTokenComponentIncludedInKnownCost:
      false,
  },
} as const;

const recoveryMetadata = {
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
      "C:\\Busybookie\\tests\\littleleaf_valley_storybook_village.png",
  },

  policySnapshot,
} as const;

async function makeFixture() {
  const mediaRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-visual-attempt-completion-",
      ),
    );

  roots.push(
    mediaRoot,
  );

  const episodeId = "EP93";
  const sceneId = "SC01";
  const shotId = "S01";
  const attemptNumber = 2;

  const admissionId =
    "f71c8cf1-a82d-4410-954f-6af17cc3ce22";

  const reservationId =
    "a83c34e2-fe66-47e1-9166-dd25e947003a";

  const providerExecutionId =
    "interaction-attempt-2";

  const admissionRecord = {
    schemaVersion: "1.0",
    admissionId,
    attemptNumber,
    admittedAt: "2026-11-03T11:00:00.000Z",
    status: "ADMITTED",
    episodeId,
    sceneId,
    shotId,
    provider: "GOOGLE_GENAI",
    manifestRawSha256: "1".repeat(64),
    promptIdentitySha256: "2".repeat(64),
    referenceIdentitySha256: "3".repeat(64),
    previousAttemptNumber: 1,
    previousAttemptQcSha256: "4".repeat(64),
  } as const;

  const admissionPath =
    createVisualAttemptAdmissionPath(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  const admissionRaw =
    await writeCanonical(
      admissionPath,
      admissionRecord,
    );

  const admissionSha256 =
    sha256(
      admissionRaw,
    );

  const reservationRecord = {
    schemaVersion: "1.0",
    reservationId,
    reservedAt: "2026-11-03T11:01:00.000Z",
    status: "RESERVED",
    episodeId,
    sceneId,
    shotId,
    attemptNumber,
    admissionId,
    admissionSha256,
    provider: "GOOGLE_GENAI",
  } as const;

  const reservationPath =
    createVisualAttemptExecutionReservationPath(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  const reservationRaw =
    await writeCanonical(
      reservationPath,
      reservationRecord,
    );

  const reservationSha256 =
    sha256(
      reservationRaw,
    );

  const submissionRecord = {
    schemaVersion: "1.0",
    submittedAt: "2026-11-03T11:02:00.000Z",
    status: "SUBMITTED",
    reservationId,
    reservationSha256,
    episodeId,
    sceneId,
    shotId,
    attemptNumber,
    admissionId,
    admissionSha256,
    provider: "GOOGLE_GENAI",
    providerExecutionId,
    recoveryMetadata,
  } as const;

  const submissionPath =
    createVisualAttemptExecutionSubmissionPath(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  const submissionRaw =
    await writeCanonical(
      submissionPath,
      submissionRecord,
    );

  const submissionSha256 =
    sha256(
      submissionRaw,
    );

  const outputPath =
    createGoogleGenAiVideoOutputPath(
      mediaRoot,
      episodeId,
      shotId,
      providerExecutionId,
    );

  const outputBytes =
    Buffer.from(
      "attempt-aware-google-video-output",
      "utf8",
    );

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

  const generationRecord = {
    schemaVersion: "1.0",
    recordedAt: "2026-11-03T11:03:00.000Z",
    reservationId,
    provider: "GOOGLE_GENAI",
    episodeId,
    shotId,
    providerExecutionId,

    outputs: [
      {
        outputIndex: 1,
        destinationPath: outputPath,
        bytes: outputBytes.byteLength,
        sha256:
          sha256(
            outputBytes,
          ),
        contentType: "video/mp4",
      },
    ],
  } as const;

  const generationRecordPath =
    createGoogleGenAiGenerationRecordPath(
      mediaRoot,
      episodeId,
      shotId,
      providerExecutionId,
    );

  const generationRecordRaw =
    await writeCanonical(
      generationRecordPath,
      generationRecord,
    );

  const completionPath =
    createVisualAttemptExecutionCompletionPath(
      mediaRoot,
      episodeId,
      shotId,
      attemptNumber,
    );

  /*
   * IMPORTANT R31D correction:
   * widen this fixture to the exported production input contract rather
   * than preserving literal UUID values through `as const`.
   */
  const input:
    CreateVisualAttemptExecutionCompletionInput =
    {
      episodeId,
      sceneId,
      shotId,
      attemptNumber,
      expectedAdmissionId:
        admissionId,
      expectedAdmissionSha256:
        admissionSha256,
      expectedReservationId:
        reservationId,
      expectedReservationSha256:
        reservationSha256,
      expectedSubmissionSha256:
        submissionSha256,
    };

  return {
    mediaRoot,
    episodeId,
    sceneId,
    shotId,
    attemptNumber,
    admissionId,
    reservationId,
    providerExecutionId,
    admissionPath,
    reservationPath,
    submissionPath,
    completionPath,
    generationRecordPath,
    outputPath,
    admissionRecord,
    reservationRecord,
    submissionRecord,
    generationRecord,
    generationRecordRaw,
    outputBytes,
    admissionSha256,
    reservationSha256,
    submissionSha256,
    input,
  };
}

type Fixture =
  Awaited<
    ReturnType<
      typeof makeFixture
    >
  >;

const completionDependencies = {
  now:
    () =>
      "2026-11-03T11:04:00.000Z",
} as const;

async function expectRefusedWithoutEvidenceMutation(
  fixture: Fixture,

  input:
    CreateVisualAttemptExecutionCompletionInput =
      fixture.input,

  options:
    Readonly<{
      checkOutputBytes?: boolean;
    }> =
      {},
): Promise<void> {
  const generationBefore =
    await readMaybe(
      fixture.generationRecordPath,
    );

  const outputBefore =
    options.checkOutputBytes === false
      ? null
      : await readMaybe(
        fixture.outputPath,
      );

  await expect(
    createVisualAttemptExecutionCompletion(
      fixture.mediaRoot,
      input,
      completionDependencies,
    ),
  ).rejects.toThrow();

  expect(
    await readMaybe(
      fixture.completionPath,
    ),
  ).toBeNull();

  const generationAfter =
    await readMaybe(
      fixture.generationRecordPath,
    );

  expect(
    generationAfter === null,
  ).toBe(
    generationBefore === null,
  );

  if (
    generationBefore !== null &&
    generationAfter !== null
  ) {
    expect(
      generationAfter.equals(
        generationBefore,
      ),
    ).toBe(
      true,
    );
  }

  if (
    options.checkOutputBytes !== false
  ) {
    const outputAfter =
      await readMaybe(
        fixture.outputPath,
      );

    expect(
      outputAfter === null,
    ).toBe(
      outputBefore === null,
    );

    if (
      outputBefore !== null &&
      outputAfter !== null
    ) {
      expect(
        outputAfter.equals(
          outputBefore,
        ),
      ).toBe(
        true,
      );
    }
  }
}

describe(
  "attempt-aware visual execution completion persistence",
  () => {
    it(
      "creates canonical immutable completion bytes with exact durable hashes",
      async () => {
        const fixture =
          await makeFixture();

        const result =
          await createVisualAttemptExecutionCompletion(
            fixture.mediaRoot,
            fixture.input,
            completionDependencies,
          );

        const raw =
          await readFile(
            result.completionPath,
            "utf8",
          );

        expect(
          raw,
        ).toBe(
          canonical(
            result.record,
          ),
        );

        expect(
          result.completionSha256,
        ).toBe(
          sha256(
            raw,
          ),
        );

        expect(
          result.generationRecordPath,
        ).toBe(
          fixture.generationRecordPath,
        );

        expect(
          result.generationRecordSha256,
        ).toBe(
          sha256(
            fixture.generationRecordRaw,
          ),
        );

        expect(
          result.record.reservationSha256,
        ).toBe(
          fixture.reservationSha256,
        );

        expect(
          result.record.submissionSha256,
        ).toBe(
          fixture.submissionSha256,
        );

        expect(
          result.record.admissionSha256,
        ).toBe(
          fixture.admissionSha256,
        );
      },
    );

    it(
      "reads canonical completion evidence and exposes exact completion SHA-256",
      async () => {
        const fixture =
          await makeFixture();

        const created =
          await createVisualAttemptExecutionCompletion(
            fixture.mediaRoot,
            fixture.input,
            completionDependencies,
          );

        const evidence =
          await readVisualAttemptExecutionCompletionEvidence(
            fixture.mediaRoot,
            fixture.episodeId,
            fixture.shotId,
            fixture.attemptNumber,
          );

        expect(
          evidence?.record,
        ).toEqual(
          created.record,
        );

        expect(
          evidence?.completionPath,
        ).toBe(
          created.completionPath,
        );

        expect(
          evidence?.completionSha256,
        ).toBe(
          created.completionSha256,
        );

        expect(
          await readVisualAttemptExecutionCompletion(
            fixture.mediaRoot,
            fixture.episodeId,
            fixture.shotId,
            fixture.attemptNumber,
          ),
        ).toEqual(
          created.record,
        );
      },
    );

    it(
      "returns null when no completion exists",
      async () => {
        const mediaRoot =
          await mkdtemp(
            join(
              tmpdir(),
              "busybookie-visual-attempt-completion-missing-",
            ),
          );

        roots.push(
          mediaRoot,
        );

        expect(
          await readVisualAttemptExecutionCompletion(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).toBeNull();

        expect(
          await readVisualAttemptExecutionCompletionEvidence(
            mediaRoot,
            "EP93",
            "S01",
            2,
          ),
        ).toBeNull();
      },
    );

    it(
      "refuses duplicate completion creation without changing first durable bytes",
      async () => {
        const fixture =
          await makeFixture();

        const first =
          await createVisualAttemptExecutionCompletion(
            fixture.mediaRoot,
            fixture.input,
            completionDependencies,
          );

        const before =
          await readFile(
            first.completionPath,
          );

        await expect(
          createVisualAttemptExecutionCompletion(
            fixture.mediaRoot,
            fixture.input,
            completionDependencies,
          ),
        ).rejects.toThrow(
          /already exists/i,
        );

        expect(
          (
            await readFile(
              first.completionPath,
            )
          ).equals(
            before,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "allows exactly one winner for concurrent duplicate completion creation",
      async () => {
        const fixture =
          await makeFixture();

        const results =
          await Promise.allSettled([
            createVisualAttemptExecutionCompletion(
              fixture.mediaRoot,
              fixture.input,
              completionDependencies,
            ),
            createVisualAttemptExecutionCompletion(
              fixture.mediaRoot,
              fixture.input,
              completionDependencies,
            ),
          ]);

        expect(
          results.filter(
            (result) =>
              result.status === "fulfilled",
          ),
        ).toHaveLength(
          1,
        );

        expect(
          results.filter(
            (result) =>
              result.status === "rejected",
          ),
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "fails closed for invalid completion JSON",
      async () => {
        const fixture =
          await makeFixture();

        await writeFile(
          fixture.completionPath,
          "{",
          "utf8",
        );

        await expect(
          readVisualAttemptExecutionCompletion(
            fixture.mediaRoot,
            fixture.episodeId,
            fixture.shotId,
            fixture.attemptNumber,
          ),
        ).rejects.toThrow(
          /not valid JSON/i,
        );
      },
    );

    it(
      "fails closed for schema-invalid completion JSON",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.completionPath,
          {
            schemaVersion: "1.0",
            status: "COMPLETED",
          },
        );

        await expect(
          readVisualAttemptExecutionCompletion(
            fixture.mediaRoot,
            fixture.episodeId,
            fixture.shotId,
            fixture.attemptNumber,
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "fails closed for valid but noncanonical completion JSON",
      async () => {
        const fixture =
          await makeFixture();

        const created =
          await createVisualAttemptExecutionCompletion(
            fixture.mediaRoot,
            fixture.input,
            completionDependencies,
          );

        await writeFile(
          fixture.completionPath,
          JSON.stringify(
            created.record,
          ),
          "utf8",
        );

        await expect(
          readVisualAttemptExecutionCompletion(
            fixture.mediaRoot,
            fixture.episodeId,
            fixture.shotId,
            fixture.attemptNumber,
          ),
        ).rejects.toThrow(
          /not canonical/i,
        );
      },
    );

    it.each([
      [
        "episode",
        {
          episodeId: "EP94",
        },
      ],
      [
        "shot",
        {
          shotId: "S02",
        },
      ],
      [
        "attempt",
        {
          attemptNumber: 3,
        },
      ],
    ])(
      "fails closed when embedded %s identity disagrees with canonical completion path",
      async (
        _label,
        patch,
      ) => {
        const fixture =
          await makeFixture();

        const created =
          await createVisualAttemptExecutionCompletion(
            fixture.mediaRoot,
            fixture.input,
            completionDependencies,
          );

        await writeCanonical(
          fixture.completionPath,
          {
            ...created.record,
            ...patch,
          },
        );

        await expect(
          readVisualAttemptExecutionCompletion(
            fixture.mediaRoot,
            fixture.episodeId,
            fixture.shotId,
            fixture.attemptNumber,
          ),
        ).rejects.toThrow(
          /identity does not match/i,
        );
      },
    );

    it(
      "refuses completion when durable admission is missing",
      async () => {
        const fixture =
          await makeFixture();

        await rm(
          fixture.admissionPath,
          {
            force: true,
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses admission identity mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.admissionPath,
          {
            ...fixture.admissionRecord,
            sceneId: "SC02",
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses admission exact-byte SHA mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await expectRefusedWithoutEvidenceMutation(
          fixture,
          {
            ...fixture.input,
            expectedAdmissionSha256:
              "f".repeat(64),
          },
        );
      },
    );

    it(
      "refuses completion when durable reservation is missing",
      async () => {
        const fixture =
          await makeFixture();

        await rm(
          fixture.reservationPath,
          {
            force: true,
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses reservation identity mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.reservationPath,
          {
            ...fixture.reservationRecord,
            sceneId: "SC02",
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses reservation admission binding mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.reservationPath,
          {
            ...fixture.reservationRecord,
            admissionId:
              "11111111-1111-4111-8111-111111111111",
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses reservation ID mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await expectRefusedWithoutEvidenceMutation(
          fixture,
          {
            ...fixture.input,
            expectedReservationId:
              "22222222-2222-4222-8222-222222222222",
          },
        );
      },
    );

    it(
      "refuses reservation exact-byte SHA mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await expectRefusedWithoutEvidenceMutation(
          fixture,
          {
            ...fixture.input,
            expectedReservationSha256:
              "e".repeat(64),
          },
        );
      },
    );

    it(
      "refuses completion when durable submission is missing",
      async () => {
        const fixture =
          await makeFixture();

        await rm(
          fixture.submissionPath,
          {
            force: true,
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses submission identity mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.submissionPath,
          {
            ...fixture.submissionRecord,
            sceneId: "SC02",
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses submission reservation binding mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.submissionPath,
          {
            ...fixture.submissionRecord,
            reservationId:
              "33333333-3333-4333-8333-333333333333",
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses submission admission binding mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.submissionPath,
          {
            ...fixture.submissionRecord,
            admissionId:
              "44444444-4444-4444-8444-444444444444",
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses submission exact-byte SHA mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await expectRefusedWithoutEvidenceMutation(
          fixture,
          {
            ...fixture.input,
            expectedSubmissionSha256:
              "d".repeat(64),
          },
        );
      },
    );

    it(
      "refuses missing generation record without recreating it",
      async () => {
        const fixture =
          await makeFixture();

        await rm(
          fixture.generationRecordPath,
          {
            force: true,
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses invalid generation-record JSON",
      async () => {
        const fixture =
          await makeFixture();

        await writeFile(
          fixture.generationRecordPath,
          "{",
          "utf8",
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses generation-record schema failure",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.generationRecordPath,
          {
            ...fixture.generationRecord,
            outputs: [],
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses generation-record reservation ID mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.generationRecordPath,
          {
            ...fixture.generationRecord,
            reservationId:
              "55555555-5555-4555-8555-555555555555",
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses generation-record episode mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.generationRecordPath,
          {
            ...fixture.generationRecord,
            episodeId: "EP94",
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses generation-record shot mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.generationRecordPath,
          {
            ...fixture.generationRecord,
            shotId: "S02",
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses generation-record provider mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.generationRecordPath,
          {
            ...fixture.generationRecord,
            provider: "RUNWAY",
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses generation-record provider execution ID mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.generationRecordPath,
          {
            ...fixture.generationRecord,
            providerExecutionId:
              "different-interaction",
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses generation-record output count other than exactly one",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.generationRecordPath,
          {
            ...fixture.generationRecord,
            outputs: [
              ...fixture.generationRecord.outputs,
              fixture.generationRecord.outputs[0],
            ],
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses noncanonical output destination outside selected shot evidence",
      async () => {
        const fixture =
          await makeFixture();

        await writeCanonical(
          fixture.generationRecordPath,
          {
            ...fixture.generationRecord,
            outputs: [
              {
                ...fixture.generationRecord.outputs[0],
                destinationPath:
                  join(
                    fixture.mediaRoot,
                    "outside.mp4",
                  ),
              },
            ],
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses missing canonical output without creating replacement media",
      async () => {
        const fixture =
          await makeFixture();

        await rm(
          fixture.outputPath,
          {
            force: true,
          },
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses non-regular canonical output",
      async () => {
        const fixture =
          await makeFixture();

        await rm(
          fixture.outputPath,
          {
            force: true,
          },
        );

        await mkdir(
          fixture.outputPath,
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
          fixture.input,
          {
            checkOutputBytes: false,
          },
        );
      },
    );

    it(
      "refuses empty canonical output",
      async () => {
        const fixture =
          await makeFixture();

        await writeFile(
          fixture.outputPath,
          Buffer.alloc(0),
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses output byte-count mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await writeFile(
          fixture.outputPath,
          Buffer.concat([
            fixture.outputBytes,
            Buffer.from(
              "x",
            ),
          ]),
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );

    it(
      "refuses output SHA-256 mismatch",
      async () => {
        const fixture =
          await makeFixture();

        await writeFile(
          fixture.outputPath,
          Buffer.alloc(
            fixture.outputBytes.byteLength,
            120,
          ),
        );

        await expectRefusedWithoutEvidenceMutation(
          fixture,
        );
      },
    );
  },
);
