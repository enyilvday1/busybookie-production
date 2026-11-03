import {
  createHash,
} from "node:crypto";

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
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
  beforeEach,
  describe,
  expect,
  it,
  vi,
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
  verifyVisualAttemptDurableCompletion,
} from "../src/execution/verifyVisualAttemptDurableCompletion.js";

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

// Test-only pass-through around the real Slice-2D inspector. It always
// delegates to the real implementation; it only counts calls and lets a test
// perturb durable evidence immediately before a given call. The verifier
// source has no injection seam.
const inspectorProbe =
  vi.hoisted(
    () => ({
      calls: 0,
      beforeCall: null as ((call: number) => Promise<void>) | null,
    }),
  );

vi.mock(
  "../src/execution/inspectVisualAttemptExecutionLifecycle.js",
  async (
    importOriginal,
  ) => {
    const actual =
      await importOriginal<
        typeof import("../src/execution/inspectVisualAttemptExecutionLifecycle.js")
      >();

    return {
      ...actual,
      inspectVisualAttemptExecutionLifecycle: async (
        ...args: Parameters<typeof actual.inspectVisualAttemptExecutionLifecycle>
      ) => {
        inspectorProbe.calls += 1;

        const beforeCall =
          inspectorProbe.beforeCall;

        if (
          beforeCall
        ) {
          await beforeCall(
            inspectorProbe.calls,
          );
        }

        return actual.inspectVisualAttemptExecutionLifecycle(
          ...args,
        );
      },
    };
  },
);

const VERIFIER_SOURCE =
  "src/execution/verifyVisualAttemptDurableCompletion.ts";

const roots: string[] = [];

beforeEach(
  () => {
    inspectorProbe.calls = 0;
    inspectorProbe.beforeCall = null;
  },
);

afterEach(
  async () => {
    inspectorProbe.calls = 0;
    inspectorProbe.beforeCall = null;

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
  raw: string | Buffer,
): Promise<string | Buffer> {
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
  );

  return raw;
}

async function writeCanonical(
  path: string,
  value: unknown,
): Promise<string> {
  const raw =
    canonical(
      value,
    );

  await writeRaw(
    path,
    raw,
  );

  return raw;
}

const EPISODE_ID = "EP93";
const SCENE_ID = "SC01";
const SHOT_ID = "S01";
const ATTEMPT_NUMBER = 2;
const ADMISSION_ID = "f71c8cf1-a82d-4410-954f-6af17cc3ce22";
const RESERVATION_ID = "a83c34e2-fe66-47e1-9166-dd25e947003a";
const PROVIDER_EXECUTION_ID = "interaction-attempt-2";

const DEFAULT_OUTPUT_BYTES =
  Buffer.from(
    "attempt-aware-google-video-output",
    "utf8",
  );

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
        "busybookie-visual-attempt-durable-verification-",
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
    outputBytes?: Buffer;
  }> = {},
) {
  const mediaRoot =
    await makeMediaRoot();

  const outputBytes =
    options.outputBytes ?? DEFAULT_OUTPUT_BYTES;

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
    provider: "GOOGLE_GENAI",
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
    provider: "GOOGLE_GENAI",
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

  let completionSha256: string | null =
    null;

  if (
    reaches(stage, "COMPLETED")
  ) {
    await writeRaw(
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

    completionSha256 =
      sha256(
        await readFile(
          completionPath,
        ),
      );
  }

  return {
    mediaRoot,
    admissionPath,
    reservationPath,
    submissionPath,
    completionPath,
    generationRecordPath,
    outputPath,
    outputBytes,
    submissionRecord,
    generationOutput,
    generationRecord,
    generationRecordRaw,
    completionRecord,
    completionSha256,
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

function verify(
  fixture: Readonly<{
    mediaRoot: string;
  }>,
  attemptNumber: number = ATTEMPT_NUMBER,
) {
  return verifyVisualAttemptDurableCompletion(
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

async function replaceOutput(
  fixture: Fixture,
  bytes: Buffer,
): Promise<void> {
  await rm(
    fixture.outputPath,
    {
      recursive: true,
      force: true,
    },
  );

  await writeFile(
    fixture.outputPath,
    bytes,
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
  "attempt-aware visual durable completion verification",
  () => {
    describe(
      "A. valid COMPLETED",
      () => {
        it(
          "verifies the exact durable output and returns the exact durable identity",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            const result =
              await verify(fixture);

            expect(
              result,
            ).toEqual({
              episodeId: EPISODE_ID,
              sceneId: SCENE_ID,
              shotId: SHOT_ID,
              attemptNumber: ATTEMPT_NUMBER,
              admissionId: ADMISSION_ID,
              reservationId: RESERVATION_ID,
              provider: "GOOGLE_GENAI",
              providerExecutionId: PROVIDER_EXECUTION_ID,
              admissionSha256: fixture.admissionSha256,
              reservationSha256: fixture.reservationSha256,
              submissionSha256: fixture.submissionSha256,
              completionSha256: fixture.completionSha256,
              completionPath: fixture.completionPath,
              generationRecordPath: fixture.generationRecordPath,
              generationRecordSha256: sha256(fixture.generationRecordRaw ?? ""),
              outputPath: fixture.outputPath,
              bytes: fixture.outputBytes.byteLength,
              sha256: sha256(fixture.outputBytes),
              contentType: "video/mp4",
              lifecycle: result.lifecycle,
            });

            expect(
              Object.keys(result).sort(),
            ).toEqual([
              "admissionId",
              "admissionSha256",
              "attemptNumber",
              "bytes",
              "completionPath",
              "completionSha256",
              "contentType",
              "episodeId",
              "generationRecordPath",
              "generationRecordSha256",
              "lifecycle",
              "outputPath",
              "provider",
              "providerExecutionId",
              "reservationId",
              "reservationSha256",
              "sceneId",
              "sha256",
              "shotId",
              "submissionSha256",
            ]);

            expect(result.bytes).toBe(
              (await readFile(fixture.outputPath)).byteLength,
            );
            expect(result.sha256).toBe(
              sha256(await readFile(fixture.outputPath)),
            );

            expect(result.lifecycle.state).toBe("COMPLETED");
            expect(result.lifecycle.completion.completionPath).toBe(fixture.completionPath);
            expect(result.lifecycle.generationRecord.outputPath).toBe(fixture.outputPath);

            expect(Object.isFrozen(result)).toBe(true);
            expect(Object.isFrozen(result.lifecycle)).toBe(true);
            expect(Object.isFrozen(result.lifecycle.generationRecord)).toBe(true);
          },
        );

        it(
          "verifies an output larger than one hash chunk",
          async () => {
            const outputBytes =
              Buffer.alloc(
                1024 * 1024 * 2 + 123,
              );

            for (
              let index = 0;
              index < outputBytes.byteLength;
              index += 1
            ) {
              outputBytes[index] =
                (index * 31) % 251;
            }

            const fixture =
              await makeFixture(
                "COMPLETED",
                {
                  outputBytes,
                },
              );

            const result =
              await verify(fixture);

            expect(result.bytes).toBe(outputBytes.byteLength);
            expect(result.sha256).toBe(sha256(outputBytes));
          },
        );

        it(
          "exports a four-parameter function",
          () => {
            expect(
              verifyVisualAttemptDurableCompletion.length,
            ).toBe(
              4,
            );
          },
        );
      },
    );

    describe(
      "B. partial lifecycle states",
      () => {
        it(
          "rejects NOT_ADMITTED",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await expect(
              verify({
                mediaRoot,
              }),
            ).rejects.toThrow(
              "Attempt-aware durable completion verification requires COMPLETED lifecycle; received NOT_ADMITTED.",
            );

            expect(inspectorProbe.calls).toBe(1);
          },
        );

        it.each([
          [
            "ADMITTED",
            "ADMITTED_ONLY",
          ],
          [
            "RESERVED",
            "RESERVED_ONLY",
          ],
          [
            "SUBMITTED",
            "SUBMITTED",
          ],
        ] as const)(
          "rejects a %s fixture as %s",
          async (
            stage,
            state,
          ) => {
            const fixture =
              await makeFixture(stage);

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              `Attempt-aware durable completion verification requires COMPLETED lifecycle; received ${state}.`,
            );

            expect(inspectorProbe.calls).toBe(1);
          },
        );

        it(
          "does not let a valid-looking output and generation record bypass the lifecycle gate",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await writeRaw(
              fixture.outputPath,
              fixture.outputBytes,
            );

            await writeCanonical(
              fixture.generationRecordPath,
              fixture.generationRecord,
            );

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /requires COMPLETED lifecycle; received SUBMITTED/,
            );
          },
        );

        it(
          "rejects at the gate before touching a non-file output entry",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await mkdir(
              fixture.outputPath,
              {
                recursive: true,
              },
            );

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /requires COMPLETED lifecycle; received SUBMITTED/,
            );
          },
        );
      },
    );

    describe(
      "C. output faults",
      () => {
        it(
          "rejects an absent output",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rm(fixture.outputPath);

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /durable output does not exist/,
            );
          },
        );

        it(
          "rejects a directory at the output path",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rm(fixture.outputPath);
            await mkdir(fixture.outputPath);

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /durable output is not a regular file/,
            );
          },
        );

        it(
          "rejects a junction at the output path that escapes to an outside directory",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            const outside =
              join(
                fixture.mediaRoot,
                "outside-target",
              );

            await mkdir(outside);

            await writeFile(
              join(
                outside,
                "copy.mp4",
              ),
              fixture.outputBytes,
            );

            await rm(fixture.outputPath);

            // A directory junction needs no elevated privilege on Windows and is
            // a directory symlink elsewhere; lstat must report it as non-regular.
            await symlink(
              outside,
              fixture.outputPath,
              "junction",
            );

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /durable output is not a regular file/,
            );
          },
        );

        it(
          "rejects an empty output file",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await replaceOutput(
              fixture,
              Buffer.alloc(0),
            );

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /durable output is empty/,
            );
          },
        );

        it(
          "rejects an output with one extra byte",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await replaceOutput(
              fixture,
              Buffer.concat([
                fixture.outputBytes,
                Buffer.from([
                  0x00,
                ]),
              ]),
            );

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              new RegExp(
                `durable output is ${fixture.outputBytes.byteLength + 1} bytes; generation record records ${fixture.outputBytes.byteLength}`,
              ),
            );
          },
        );

        it(
          "rejects a same-size byte mutation through SHA-256 mismatch",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            const corrupted =
              Buffer.from(
                fixture.outputBytes,
              );

            corrupted[corrupted.byteLength - 1] =
              (corrupted[corrupted.byteLength - 1] ?? 0) ^ 0xff;

            await replaceOutput(
              fixture,
              corrupted,
            );

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              new RegExp(
                `durable output SHA-256 ${sha256(corrupted)} does not match generation record ${sha256(fixture.outputBytes)}`,
              ),
            );
          },
        );
      },
    );

    describe(
      "D. location and confinement",
      () => {
        it(
          "accepts the canonical lexical output path",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            const result =
              await verify(fixture);

            expect(result.outputPath).toBe(
              createGoogleGenAiVideoOutputPath(
                fixture.mediaRoot,
                EPISODE_ID,
                SHOT_ID,
                PROVIDER_EXECUTION_ID,
              ),
            );

            expect(dirname(result.outputPath)).toBe(
              join(
                fixture.mediaRoot,
                "generated-video",
                EPISODE_ID,
                SHOT_ID,
              ),
            );
          },
        );

        it(
          "evaluates containment on real paths when the shot directory is reached through a junction",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            const shotDirectory =
              dirname(
                fixture.outputPath,
              );

            const relocated =
              join(
                fixture.mediaRoot,
                "relocated-shot",
              );

            await rename(
              shotDirectory,
              relocated,
            );

            await symlink(
              relocated,
              shotDirectory,
              "junction",
            );

            const result =
              await verify(fixture);

            expect(result.outputPath).toBe(fixture.outputPath);
            expect(result.sha256).toBe(sha256(fixture.outputBytes));
          },
        );

        it(
          "rejects a noncanonical destination path upstream in Slice-2D",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            const outside =
              join(
                fixture.mediaRoot,
                "outside.mp4",
              );

            await writeFile(
              outside,
              fixture.outputBytes,
            );

            await rewriteGenerationRecordBound(
              fixture,
              {
                ...fixture.generationRecord,
                outputs: [
                  {
                    ...fixture.generationOutput,
                    destinationPath: outside,
                  },
                ],
              },
            );

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /output destination is not the canonical output path/,
            );
          },
        );

        it(
          "rejects a noncanonical output name upstream in Slice-2D",
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
              verify(fixture),
            ).rejects.toThrow(
              /output destination is not the canonical output path/,
            );
          },
        );

        it(
          "rejects a noncanonical output index upstream in Slice-2D",
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
              verify(fixture),
            ).rejects.toThrow();

            expect(inspectorProbe.calls).toBe(1);
          },
        );
      },
    );

    describe(
      "E. durable chain faults before output access",
      () => {
        it(
          "rejects a missing generation record",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rm(fixture.generationRecordPath);

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /generation record required by a completed attempt-aware lifecycle is missing/,
            );
          },
        );

        it(
          "rejects changed generation-record bytes",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await writeRaw(
              fixture.generationRecordPath,
              `${fixture.generationRecordRaw ?? ""} `,
            );

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /generation record SHA-256 .* does not match attempt-aware completion/,
            );
          },
        );

        it(
          "rejects a completion generationRecordSha256 mismatch",
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
              verify(fixture),
            ).rejects.toThrow(
              /does not match attempt-aware completion/,
            );
          },
        );

        it(
          "rejects a modified submission whose SHA-256 no longer matches the completion",
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
              verify(fixture),
            ).rejects.toThrow(
              /completion is not bound to the exact durable submission SHA-256/,
            );
          },
        );

        it(
          "rejects a completion providerExecutionId that disagrees with the submission",
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
              verify(fixture),
            ).rejects.toThrow(
              /completion providerExecutionId does not match the durable submission/,
            );
          },
        );

        it(
          "rejects a completion without a submission even when the output is valid",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rm(fixture.submissionPath);

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /completion exists without a durable submission/,
            );
          },
        );
      },
    );

    describe(
      "F. attempt isolation",
      () => {
        it(
          "ignores corrupt legacy attempt-1 lifecycle files beside attempt 2",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

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
              await verify(fixture);

            expect(result.sha256).toBe(sha256(fixture.outputBytes));
          },
        );

        it(
          "ignores corrupt generation and output evidence for a different providerExecutionId",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            const legacyExecutionId =
              "interaction-legacy-attempt-1";

            await writeRaw(
              createGoogleGenAiGenerationRecordPath(
                fixture.mediaRoot,
                EPISODE_ID,
                SHOT_ID,
                legacyExecutionId,
              ),
              "{",
            );

            await writeRaw(
              createGoogleGenAiVideoOutputPath(
                fixture.mediaRoot,
                EPISODE_ID,
                SHOT_ID,
                legacyExecutionId,
              ),
              Buffer.alloc(0),
            );

            const result =
              await verify(fixture);

            expect(result.providerExecutionId).toBe(PROVIDER_EXECUTION_ID);
            expect(result.sha256).toBe(sha256(fixture.outputBytes));
          },
        );

        it.each([
          1,
          0,
          2.5,
        ])(
          "rejects non-replacement attempt number %s through replacement-attempt authority",
          async (
            attemptNumber,
          ) => {
            const fixture =
              await makeFixture("COMPLETED");

            await expect(
              verify(
                fixture,
                attemptNumber,
              ),
            ).rejects.toThrow(
              /replacement attempt number/,
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
              verify(
                {
                  mediaRoot,
                },
                1,
              ),
            ).rejects.toThrow(
              /legacy lifecycle/,
            );
          },
        );

        it(
          "ignores corrupt attempt-3 lifecycle evidence and output when verifying attempt 2",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

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

            await writeRaw(
              createGoogleGenAiVideoOutputPath(
                fixture.mediaRoot,
                EPISODE_ID,
                SHOT_ID,
                "interaction-attempt-3",
              ),
              Buffer.from("corrupt-attempt-3-output"),
            );

            const result =
              await verify(fixture);

            expect(result.attemptNumber).toBe(ATTEMPT_NUMBER);
            expect(result.sha256).toBe(sha256(fixture.outputBytes));
          },
        );
      },
    );

    describe(
      "G. lineage reinspection",
      () => {
        it(
          "inspects the lifecycle exactly twice on success",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await verify(fixture);

            expect(inspectorProbe.calls).toBe(2);
          },
        );

        it(
          "does not reinspect when output verification fails",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await rm(fixture.outputPath);

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /durable output does not exist/,
            );

            expect(inspectorProbe.calls).toBe(1);
          },
        );

        it(
          "rejects when the completion is rewritten before reinspection",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            inspectorProbe.beforeCall =
              async (
                call,
              ) => {
                if (
                  call === 2
                ) {
                  // Still a canonical COMPLETED chain, but different durable bytes.
                  await rewriteCompletion(
                    fixture,
                    {
                      completedAt: "2026-11-03T11:05:00.000Z",
                    },
                  );
                }
              };

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /lineage changed during verification .*reinspection reported COMPLETED/,
            );

            expect(inspectorProbe.calls).toBe(2);
          },
        );

        it(
          "rejects when the lifecycle regresses to SUBMITTED before reinspection",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            inspectorProbe.beforeCall =
              async (
                call,
              ) => {
                if (
                  call === 2
                ) {
                  await rm(fixture.completionPath);
                }
              };

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /lineage changed during verification .*reinspection reported SUBMITTED/,
            );
          },
        );

        it(
          "rejects when reinspection itself fails closed",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            inspectorProbe.beforeCall =
              async (
                call,
              ) => {
                if (
                  call === 2
                ) {
                  await rm(fixture.generationRecordPath);
                }
              };

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /lineage changed during verification .*reinspection failed/,
            );
          },
        );

        it(
          "reinspects only after the output bytes have been hashed",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            // Mutating the output immediately before the second inspection
            // cannot affect a hash that has already been computed; were the
            // reinspection ordered before hashing this would fail on SHA-256.
            inspectorProbe.beforeCall =
              async (
                call,
              ) => {
                if (
                  call === 2
                ) {
                  const corrupted =
                    Buffer.from(
                      fixture.outputBytes,
                    );

                  corrupted[0] =
                    (corrupted[0] ?? 0) ^ 0xff;

                  await writeFile(
                    fixture.outputPath,
                    corrupted,
                  );
                }
              };

            const result =
              await verify(fixture);

            expect(result.sha256).toBe(sha256(fixture.outputBytes));
            expect(inspectorProbe.calls).toBe(2);
          },
        );

        it(
          "source calls the inspector twice and compares with isDeepStrictEqual",
          async () => {
            const source =
              await readFile(
                join(
                  process.cwd(),
                  VERIFIER_SOURCE,
                ),
                "utf8",
              );

            expect(
              source.match(
                /\binspectVisualAttemptExecutionLifecycle\s*\(/g,
              ) ?? [],
            ).toHaveLength(
              2,
            );

            expect(
              source,
            ).toMatch(
              /isDeepStrictEqual\(\s*reinspection,\s*lifecycle,\s*\)/,
            );

            const hashCall =
              source.indexOf("await hashExactDurableBytes(");

            const reinspectionCall =
              source.indexOf("await requireStableLineage(");

            expect(hashCall).toBeGreaterThan(0);
            expect(reinspectionCall).toBeGreaterThan(hashCall);
          },
        );
      },
    );

    describe(
      "H. purity",
      () => {
        it(
          "leaves the tree unchanged after successful verification",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            const before =
              await snapshotTree(
                fixture.mediaRoot,
              );

            await verify(fixture);
            await verify(fixture);

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
          "leaves the tree unchanged after a partial-state rejection",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await writeRaw(
              fixture.outputPath,
              fixture.outputBytes,
            );

            const before =
              await snapshotTree(
                fixture.mediaRoot,
              );

            await expect(
              verify(fixture),
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
          "leaves the tree unchanged after a corrupted-output failure",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            await replaceOutput(
              fixture,
              Buffer.from(
                "x".repeat(
                  fixture.outputBytes.byteLength,
                ),
              ),
            );

            const before =
              await snapshotTree(
                fixture.mediaRoot,
              );

            await expect(
              verify(fixture),
            ).rejects.toThrow(
              /SHA-256/,
            );

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
          "creates nothing in an empty media root",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await expect(
              verify({
                mediaRoot,
              }),
            ).rejects.toThrow(
              /received NOT_ADMITTED/,
            );

            expect(
              await readdir(mediaRoot),
            ).toEqual(
              [],
            );
          },
        );
      },
    );

    describe(
      "I. static architecture audit",
      () => {
        async function readVerifierSource(): Promise<string> {
          return readFile(
            join(
              process.cwd(),
              VERIFIER_SOURCE,
            ),
            "utf8",
          );
        }

        it(
          "imports exactly the intended modules",
          async () => {
            const source =
              await readVerifierSource();

            const specifiers =
              [
                ...source.matchAll(
                  /\bfrom\s*["']([^"']+)["']/g,
                ),
              ].map(
                (match) => match[1],
              );

            expect(
              [...specifiers].sort(),
            ).toEqual([
              "./inspectVisualAttemptExecutionLifecycle.js",
              "node:crypto",
              "node:fs/promises",
              "node:path",
              "node:util",
            ]);

            expect(
              /\bimport\s*\(|\brequire\s*\(/.test(source),
            ).toBe(
              false,
            );
          },
        );

        it.each([
          [
            "Google SDK",
            /@google\/genai/,
          ],
          [
            "Google provider token",
            /GOOGLE_GENAI/,
          ],
          [
            "Google foundation modules",
            /googleGenai\//,
          ],
          [
            "fetch",
            /\bfetch\s*\(/,
          ],
          [
            "network modules",
            /node:https?|node:net|node:dgram|node:tls/,
          ],
          [
            "child processes",
            /node:child_process|\bspawn\b|\bexecFile\b/,
          ],
          [
            "environment access",
            /process\.env|loadEnvironment/,
          ],
          [
            "provider and transport modules",
            /\/providers\/|\/transport\//,
          ],
          [
            "activation-policy authority",
            /ActivationPolicy|activationPolicy|activation-policy|ActivationLimits|newSubmissionsEnabled/,
          ],
          [
            "legacy lifecycle APIs",
            /inspectGoogleGenAiExecutionLifecycle|inspectExecutionLifecycle|classifyExecutionLifecycle|readExecutionReservation|readExecutionSubmission|readExecutionCompletion|readGoogleGenAiExecutionCompletion|verifyGoogleGenAiDurableCompletion|verifyLocalCompletedVisualExecution/,
          ],
          [
            "writer, create, recovery and materialization authority",
            /createExecution|createVisualAttempt|persistGoogleGenAi|recoverGoogleGenAi|materializeGoogleGenAi|submitGoogleGenAi|reconcile/,
          ],
          [
            "filesystem mutation APIs",
            /\b(?:writeFile|appendFile|mkdir|mkdtemp|rename|copyFile|cp|unlink|rm|rmdir|truncate|symlink|link|utimes|chmod|chown|createWriteStream)\b/,
          ],
          [
            "writable open flags",
            /["'](?:w|wx|a|ax|a\+|r\+|w\+|rs\+)["']/,
          ],
        ])(
          "contains no %s",
          async (
            _label,
            pattern,
          ) => {
            const source =
              await readVerifierSource();

            expect(
              pattern.test(
                source,
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "pins the read-only output primitives it relies on",
          async () => {
            const source =
              await readVerifierSource();

            for (
              const token of [
                "lstat(",
                "realpath(",
                "open(",
                "isDeepStrictEqual(",
                "bigint: true",
                "AggregateError",
              ]
            ) {
              expect(
                source,
                token,
              ).toContain(
                token,
              );
            }

            expect(
              source,
            ).toMatch(
              /open\(\s*outputPath,\s*"r",\s*\)/,
            );
          },
        );

        it(
          "exports exactly one four-parameter function",
          async () => {
            const module =
              await import(
                "../src/execution/verifyVisualAttemptDurableCompletion.js"
              );

            const runtimeExports =
              Object.entries(
                module,
              ).filter(
                ([, value]) => typeof value === "function",
              );

            expect(
              runtimeExports.map(
                ([name]) => name,
              ),
            ).toEqual([
              "verifyVisualAttemptDurableCompletion",
            ]);

            expect(
              module.verifyVisualAttemptDurableCompletion.length,
            ).toBe(
              4,
            );
          },
        );
      },
    );
  },
);
