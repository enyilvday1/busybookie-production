import {
  createHash,
} from "node:crypto";

import {
  appendFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  basename,
  dirname,
  join,
  relative,
  sep,
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
  createVisualAttemptGenerationRecord,
  type CreateVisualAttemptGenerationRecordInput,
} from "../src/execution/createVisualAttemptGenerationRecord.js";

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
// perturb durable evidence immediately before a given call. The writer source
// has no injection seam.
const inspectorProbe =
  vi.hoisted(
    () => ({
      calls: 0,
      beforeCall: null as ((call: number) => Promise<void>) | null,
    }),
  );

// Test-only pass-through around node:fs/promises `open`. It always opens the
// real file; a test may perturb the file just before open, after a read, make
// a read report early EOF, or make close fail.
const fsProbe =
  vi.hoisted(
    () => ({
      beforeOpen: null as ((path: string) => Promise<void>) | null,
      afterRead: null as ((call: number) => Promise<void>) | null,
      earlyEof: false,
      failClose: false,
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

vi.mock(
  "node:fs/promises",
  async (
    importOriginal,
  ) => {
    const actual =
      await importOriginal<
        typeof import("node:fs/promises")
      >();

    return {
      ...actual,
      open: async (
        ...args: Parameters<typeof actual.open>
      ) => {
        const beforeOpen =
          fsProbe.beforeOpen;

        if (
          beforeOpen
        ) {
          await beforeOpen(
            String(args[0]),
          );
        }

        const handle =
          await actual.open(
            ...args,
          );

        const read =
          handle.read.bind(
            handle,
          );

        let reads =
          0;

        handle.read =
          (async (
            ...readArgs: unknown[]
          ) => {
            reads += 1;

            if (
              fsProbe.earlyEof
            ) {
              return {
                bytesRead: 0,
                buffer: readArgs[0],
              };
            }

            const result =
              await (
                read as unknown as (...a: unknown[]) => Promise<unknown>
              )(
                ...readArgs,
              );

            const afterRead =
              fsProbe.afterRead;

            if (
              afterRead
            ) {
              await afterRead(
                reads,
              );
            }

            return result;
          }) as unknown as typeof handle.read;

        if (
          fsProbe.failClose
        ) {
          const close =
            handle.close.bind(
              handle,
            );

          handle.close =
            async () => {
              await close();

              throw new Error(
                "simulated close failure",
              );
            };
        }

        return handle;
      },
    };
  },
);

const WRITER_SOURCE =
  "src/execution/createVisualAttemptGenerationRecord.ts";

const roots: string[] = [];

function resetProbes(): void {
  inspectorProbe.calls = 0;
  inspectorProbe.beforeCall = null;
  fsProbe.beforeOpen = null;
  fsProbe.afterRead = null;
  fsProbe.earlyEof = false;
  fsProbe.failClose = false;
}

beforeEach(
  () => {
    resetProbes();
  },
);

afterEach(
  async () => {
    resetProbes();

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

async function exists(
  path: string,
): Promise<boolean> {
  try {
    await readFile(
      path,
    );

    return true;
  } catch {
    return false;
  }
}

const EPISODE_ID = "EP93";
const SCENE_ID = "SC01";
const SHOT_ID = "S01";
const ATTEMPT_NUMBER = 2;
const ADMISSION_ID = "f71c8cf1-a82d-4410-954f-6af17cc3ce22";
const RESERVATION_ID = "a83c34e2-fe66-47e1-9166-dd25e947003a";
const LEGACY_RESERVATION_ID = "0b6f3f8e-4c1d-4e7a-9a51-2f8f3c6d7e10";
const OTHER_RESERVATION_ID = "5d0c9a1e-7b2f-4c3d-8e9f-0a1b2c3d4e5f";
const PROVIDER_EXECUTION_ID = "interaction-attempt-2";
const RECORDED_AT = "2026-11-03T11:03:00.000Z";

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
        "busybookie-visual-attempt-generation-record-",
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
    writeOutput?: boolean;
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

  const shotDirectory =
    join(
      mediaRoot,
      "generated-video",
      EPISODE_ID,
      SHOT_ID,
    );

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

  if (
    options.writeOutput ?? true
  ) {
    await writeRaw(
      outputPath,
      outputBytes,
    );
  }

  const generationOutput = {
    outputIndex: 1,
    destinationPath: outputPath,
    bytes: outputBytes.byteLength,
    sha256: sha256(outputBytes),
    contentType: "video/mp4",
  };

  const expectedRecord = {
    schemaVersion: "1.0",
    recordedAt: RECORDED_AT,
    reservationId: RESERVATION_ID,
    provider: "GOOGLE_GENAI",
    episodeId: EPISODE_ID,
    shotId: SHOT_ID,
    providerExecutionId: PROVIDER_EXECUTION_ID,
    outputs: [
      generationOutput,
    ],
  };

  const input: CreateVisualAttemptGenerationRecordInput = {
    episodeId: EPISODE_ID,
    sceneId: SCENE_ID,
    shotId: SHOT_ID,
    attemptNumber: ATTEMPT_NUMBER,
    expectedAdmissionId: ADMISSION_ID,
    expectedAdmissionSha256: admissionSha256,
    expectedReservationId: RESERVATION_ID,
    expectedReservationSha256: reservationSha256,
    expectedSubmissionSha256: submissionSha256,
    expectedProviderExecutionId: PROVIDER_EXECUTION_ID,
    output: {
      outputPath,
      bytes: outputBytes.byteLength,
      sha256: sha256(outputBytes),
    },
  };

  if (
    reaches(stage, "COMPLETED")
  ) {
    await createVisualAttemptGenerationRecord(
      mediaRoot,
      input,
      {
        now: () => RECORDED_AT,
      },
    );

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
  }

  resetProbes();

  return {
    mediaRoot,
    admissionPath,
    reservationPath,
    submissionPath,
    completionPath,
    generationRecordPath,
    outputPath,
    shotDirectory,
    outputBytes,
    submissionRecord,
    generationOutput,
    expectedRecord,
    input,
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

function write(
  fixture: Readonly<{
    mediaRoot: string;
    input: CreateVisualAttemptGenerationRecordInput;
  }>,
  overrides: Partial<CreateVisualAttemptGenerationRecordInput> = {},
  now: string = RECORDED_AT,
) {
  return createVisualAttemptGenerationRecord(
    fixture.mediaRoot,
    {
      ...fixture.input,
      ...overrides,
    },
    {
      now: () => now,
    },
  );
}

function writeWithOutput(
  fixture: Fixture,
  output: Partial<CreateVisualAttemptGenerationRecordInput["output"]>,
) {
  return write(
    fixture,
    {
      output: {
        ...fixture.input.output,
        ...output,
      } as CreateVisualAttemptGenerationRecordInput["output"],
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

async function expectRejectedWithoutRecord(
  fixture: Fixture,
  operation: () => Promise<unknown>,
  message: RegExp,
): Promise<void> {
  const before =
    await snapshotTree(
      fixture.mediaRoot,
    );

  await expect(
    operation(),
  ).rejects.toThrow(
    message,
  );

  expect(
    await exists(
      fixture.generationRecordPath,
    ),
  ).toBe(
    false,
  );

  expect(
    await snapshotTree(
      fixture.mediaRoot,
    ),
  ).toEqual(
    before,
  );
}

describe(
  "attempt-aware Google generation-record persistence",
  () => {
    describe(
      "A. valid attempt 2",
      () => {
        it(
          "publishes the canonical generation record bound to the attempt-2 reservation",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const result =
              await write(fixture);

            expect(result.alreadyPresent).toBe(false);
            expect(result.generationRecordPath).toBe(fixture.generationRecordPath);
            expect(result.outputPath).toBe(fixture.outputPath);
            expect(result.record).toEqual(fixture.expectedRecord);
            expect(result.record.reservationId).toBe(RESERVATION_ID);
            expect(result.record.providerExecutionId).toBe(PROVIDER_EXECUTION_ID);

            expect(
              Object.keys(result).sort(),
            ).toEqual([
              "alreadyPresent",
              "generationRecordPath",
              "generationRecordSha256",
              "outputPath",
              "record",
            ]);

            const record =
              JSON.parse(
                await readFile(
                  fixture.generationRecordPath,
                  "utf8",
                ),
              ) as Record<string, unknown>;

            expect(record).toEqual(fixture.expectedRecord);
            expect(record).not.toHaveProperty("attemptNumber");
            expect(record).not.toHaveProperty("admissionId");
          },
        );

        it(
          "writes canonical raw bytes and returns their exact SHA-256",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const result =
              await write(fixture);

            const raw =
              await readFile(
                fixture.generationRecordPath,
              );

            expect(raw.toString("utf8")).toBe(
              canonical(
                fixture.expectedRecord,
              ),
            );

            expect(result.generationRecordSha256).toBe(
              sha256(raw),
            );
          },
        );

        it(
          "returns a frozen result and a deeply frozen record",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const result =
              await write(fixture);

            expect(Object.isFrozen(result)).toBe(true);
            expect(Object.isFrozen(result.record)).toBe(true);
            expect(Object.isFrozen(result.record.outputs)).toBe(true);
            expect(Object.isFrozen(result.record.outputs[0])).toBe(true);

            expect(
              () => {
                (result.record as { reservationId: string }).reservationId =
                  OTHER_RESERVATION_ID;
              },
            ).toThrow(
              TypeError,
            );

            expect(
              () => {
                (result as { alreadyPresent: boolean }).alreadyPresent =
                  true;
              },
            ).toThrow(
              TypeError,
            );
          },
        );

        it(
          "hashes an output larger than one chunk over exactly its bytes",
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
                "SUBMITTED",
                {
                  outputBytes,
                },
              );

            const result =
              await write(fixture);

            expect(result.record.outputs[0].bytes).toBe(outputBytes.byteLength);
            expect(result.record.outputs[0].sha256).toBe(sha256(outputBytes));
          },
        );
      },
    );

    describe(
      "B. create-once and restart",
      () => {
        it(
          "accepts an exact existing record on rerun with the same SHA and unchanged bytes",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const first =
              await write(fixture);

            const before =
              await readFile(
                fixture.generationRecordPath,
              );

            const second =
              await write(
                fixture,
                {},
                "2026-11-03T12:00:00.000Z",
              );

            expect(second.alreadyPresent).toBe(true);
            expect(second.generationRecordSha256).toBe(first.generationRecordSha256);
            expect(second.record).toEqual(first.record);
            expect(second.record.recordedAt).toBe(RECORDED_AT);
            expect(Object.isFrozen(second.record)).toBe(true);
            expect(Object.isFrozen(second.record.outputs[0])).toBe(true);

            expect(
              await readFile(
                fixture.generationRecordPath,
              ),
            ).toEqual(
              before,
            );
          },
        );

        it(
          "accepts an exact pre-existing canonical record with a different recordedAt",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const raw =
              await writeCanonical(
                fixture.generationRecordPath,
                {
                  ...fixture.expectedRecord,
                  recordedAt: "2026-11-03T10:59:00.000Z",
                },
              );

            const result =
              await write(fixture);

            expect(result.alreadyPresent).toBe(true);
            expect(result.generationRecordSha256).toBe(sha256(raw));
            expect(result.record.recordedAt).toBe("2026-11-03T10:59:00.000Z");

            expect(
              await readFile(
                fixture.generationRecordPath,
                "utf8",
              ),
            ).toBe(
              raw,
            );
          },
        );

        it(
          "keeps repeated sequential writes create-once",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const results = [
              await write(fixture),
              await write(fixture),
              await write(fixture),
            ];

            expect(
              results.map(
                (result) => result.alreadyPresent,
              ),
            ).toEqual([
              false,
              true,
              true,
            ]);

            expect(
              new Set(
                results.map(
                  (result) => result.generationRecordSha256,
                ),
              ).size,
            ).toBe(
              1,
            );
          },
        );

        it(
          "lets exactly one concurrent writer publish and never leaves a torn or extra file",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const settled =
              await Promise.allSettled([
                write(fixture),
                write(fixture),
                write(fixture),
              ]);

            const fulfilled =
              settled.flatMap(
                (outcome) =>
                  outcome.status === "fulfilled"
                    ? [outcome.value]
                    : [],
              );

            expect(
              fulfilled.filter(
                (result) => !result.alreadyPresent,
              ),
            ).toHaveLength(
              1,
            );

            // A loser either accepts the winner's exact record or fails closed
            // (for example while the winner's create-once copy is still being
            // written); it never replaces or repairs the published bytes.
            expect(
              settled.filter(
                (outcome) => outcome.status === "rejected",
              ).length + fulfilled.length,
            ).toBe(
              3,
            );

            const raw =
              await readFile(
                fixture.generationRecordPath,
                "utf8",
              );

            expect(raw).toBe(
              canonical(
                fixture.expectedRecord,
              ),
            );

            for (
              const result of fulfilled
            ) {
              expect(result.generationRecordSha256).toBe(sha256(raw));
            }

            expect(
              (
                await readdir(
                  fixture.shotDirectory,
                )
              ).filter(
                (name) => name.includes(".part-"),
              ),
            ).toEqual(
              [],
            );

            const rerun =
              await write(fixture);

            expect(rerun.alreadyPresent).toBe(true);
          },
        );
      },
    );

    describe(
      "C. conflicting existing record is preserved and refused",
      () => {
        type ConflictCase =
          [
            string,
            (fixture: Fixture) => string,
            RegExp,
          ];

        const cases: ConflictCase[] = [
          [
            "reservation mismatch",
            (fixture) =>
              canonical({
                ...fixture.expectedRecord,
                reservationId: OTHER_RESERVATION_ID,
              }),
            /belongs to reservation/,
          ],
          [
            "providerExecutionId mismatch",
            (fixture) =>
              canonical({
                ...fixture.expectedRecord,
                providerExecutionId: "interaction-other",
              }),
            /identity does not match the attempt-aware execution chain/,
          ],
          [
            "episode mismatch",
            (fixture) =>
              canonical({
                ...fixture.expectedRecord,
                episodeId: "EP94",
              }),
            /identity does not match the attempt-aware execution chain/,
          ],
          [
            "output SHA-256 mismatch",
            (fixture) =>
              canonical({
                ...fixture.expectedRecord,
                outputs: [
                  {
                    ...fixture.generationOutput,
                    sha256: "e".repeat(64),
                  },
                ],
              }),
            /output does not match the verified canonical output/,
          ],
          [
            "output byte mismatch",
            (fixture) =>
              canonical({
                ...fixture.expectedRecord,
                outputs: [
                  {
                    ...fixture.generationOutput,
                    bytes: fixture.generationOutput.bytes + 1,
                  },
                ],
              }),
            /output does not match the verified canonical output/,
          ],
          [
            "output destination mismatch",
            (fixture) =>
              canonical({
                ...fixture.expectedRecord,
                outputs: [
                  {
                    ...fixture.generationOutput,
                    destinationPath: join(
                      fixture.shotDirectory,
                      "other.mp4",
                    ),
                  },
                ],
              }),
            /output does not match the verified canonical output/,
          ],
          [
            "malformed JSON",
            () => "{",
            /not valid JSON and will not be overwritten/,
          ],
          [
            "schema-invalid JSON",
            () => canonical({}),
            /fails its schema and will not be overwritten/,
          ],
          [
            "noncanonical JSON",
            (fixture) => `${JSON.stringify(fixture.expectedRecord)}\n`,
            /not canonical and will not be overwritten/,
          ],
          [
            "truncated final file",
            (fixture) => {
              const raw =
                canonical(
                  fixture.expectedRecord,
                );

              return raw.slice(
                0,
                Math.floor(raw.length / 2),
              );
            },
            /not valid JSON and will not be overwritten/,
          ],
          [
            "empty final file",
            () => "",
            /not valid JSON and will not be overwritten/,
          ],
        ];

        it.each(cases)(
          "refuses an existing record with %s and preserves its exact bytes",
          async (
            _label,
            existing,
            message,
          ) => {
            const fixture =
              await makeFixture("SUBMITTED");

            const raw =
              existing(
                fixture,
              );

            await writeRaw(
              fixture.generationRecordPath,
              raw,
            );

            const before =
              await snapshotTree(
                fixture.mediaRoot,
              );

            await expect(
              write(fixture),
            ).rejects.toThrow(
              message,
            );

            expect(
              await readFile(
                fixture.generationRecordPath,
              ),
            ).toEqual(
              Buffer.from(
                raw,
              ),
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
      },
    );

    describe(
      "D. partial and completed lifecycle states",
      () => {
        it(
          "refuses NOT_ADMITTED and creates nothing",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const fixture =
              await makeFixture("SUBMITTED");

            await expect(
              createVisualAttemptGenerationRecord(
                mediaRoot,
                fixture.input,
              ),
            ).rejects.toThrow(
              "Attempt-aware generation-record persistence requires SUBMITTED lifecycle; received NOT_ADMITTED.",
            );

            expect(
              await readdir(mediaRoot),
            ).toEqual(
              [],
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
        ] as const)(
          "refuses a %s fixture as %s even with a valid output present",
          async (
            stage,
            state,
          ) => {
            const fixture =
              await makeFixture(stage);

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(fixture)),
              new RegExp(
                `requires SUBMITTED lifecycle; received ${state}\\.`,
              ),
            );

            expect(inspectorProbe.calls).toBe(1);
          },
        );

        it(
          "refuses COMPLETED and leaves the existing generation record and completion unchanged",
          async () => {
            const fixture =
              await makeFixture("COMPLETED");

            const before =
              await snapshotTree(
                fixture.mediaRoot,
              );

            await expect(
              write(fixture),
            ).rejects.toThrow(
              "Attempt-aware generation-record persistence requires SUBMITTED lifecycle; received COMPLETED.",
            );

            expect(
              await snapshotTree(
                fixture.mediaRoot,
              ),
            ).toEqual(
              before,
            );

            expect(inspectorProbe.calls).toBe(1);
          },
        );

        it(
          "refuses at the gate before touching a missing output",
          async () => {
            const fixture =
              await makeFixture(
                "RESERVED",
                {
                  writeOutput: false,
                },
              );

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(fixture)),
              /received RESERVED_ONLY/,
            );
          },
        );
      },
    );

    describe(
      "E. expected-value cross-checks",
      () => {
        it.each([
          [
            "expectedAdmissionId",
            {
              expectedAdmissionId: "00000000-0000-4000-8000-000000000000",
            },
            /admission ID does not match expected durable admission/,
          ],
          [
            "expectedAdmissionSha256",
            {
              expectedAdmissionSha256: "a".repeat(64),
            },
            /admission SHA-256 does not match expected durable admission/,
          ],
          [
            "expectedReservationId",
            {
              expectedReservationId: OTHER_RESERVATION_ID,
            },
            /reservation ID does not match expected durable reservation/,
          ],
          [
            "expectedReservationSha256",
            {
              expectedReservationSha256: "b".repeat(64),
            },
            /reservation SHA-256 does not match expected durable reservation/,
          ],
          [
            "expectedSubmissionSha256",
            {
              expectedSubmissionSha256: "c".repeat(64),
            },
            /submission SHA-256 does not match expected durable submission/,
          ],
          [
            "expectedProviderExecutionId",
            {
              expectedProviderExecutionId: "interaction-other",
            },
            /providerExecutionId does not match expected durable submission/,
          ],
          [
            "sceneId",
            {
              sceneId: "SC02",
            },
            /sceneId does not match the durable admission/,
          ],
        ] as const)(
          "refuses a %s mismatch and creates no record",
          async (
            _label,
            overrides,
            message,
          ) => {
            const fixture =
              await makeFixture("SUBMITTED");

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(
                fixture,
                overrides,
              )),
              message,
            );
          },
        );

        it(
          "never lets expectedProviderExecutionId choose the paths",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const otherOutputPath =
              createGoogleGenAiVideoOutputPath(
                fixture.mediaRoot,
                EPISODE_ID,
                SHOT_ID,
                "interaction-other",
              );

            await writeRaw(
              otherOutputPath,
              fixture.outputBytes,
            );

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(
                fixture,
                {
                  expectedProviderExecutionId: "interaction-other",
                  output: {
                    ...fixture.input.output,
                    outputPath: otherOutputPath,
                  },
                },
              )),
              /providerExecutionId does not match expected durable submission/,
            );

            expect(
              await exists(
                createGoogleGenAiGenerationRecordPath(
                  fixture.mediaRoot,
                  EPISODE_ID,
                  SHOT_ID,
                  "interaction-other",
                ),
              ),
            ).toBe(
              false,
            );
          },
        );
      },
    );

    describe(
      "F. forbidden caller-owned authority",
      () => {
        it.each([
          [
            "reservationId",
            RESERVATION_ID,
          ],
          [
            "providerExecutionId",
            PROVIDER_EXECUTION_ID,
          ],
          [
            "provider",
            "GOOGLE_GENAI",
          ],
          [
            "interactionId",
            PROVIDER_EXECUTION_ID,
          ],
          [
            "generationRecordPath",
            "C:\\elsewhere\\record.json",
          ],
          [
            "destinationPath",
            "C:\\elsewhere\\out.mp4",
          ],
          [
            "recordedAt",
            RECORDED_AT,
          ],
          [
            "outputs",
            [],
          ],
        ] as const)(
          "refuses an input owning %s before any inspection",
          async (
            field,
            value,
          ) => {
            const fixture =
              await makeFixture("SUBMITTED");

            await expectRejectedWithoutRecord(
              fixture,
              () => (createVisualAttemptGenerationRecord(
                fixture.mediaRoot,
                {
                  ...fixture.input,
                  [field]: value,
                } as unknown as CreateVisualAttemptGenerationRecordInput,
              )),
              new RegExp(
                `refuses caller-owned authority field ${field};`,
              ),
            );

            expect(inspectorProbe.calls).toBe(0);
          },
        );

        it.each([
          [
            "destinationPath",
            "C:\\elsewhere\\out.mp4",
          ],
          [
            "outputIndex",
            1,
          ],
          [
            "contentType",
            "video/mp4",
          ],
          [
            "providerExecutionId",
            PROVIDER_EXECUTION_ID,
          ],
        ] as const)(
          "refuses output evidence owning %s",
          async (
            field,
            value,
          ) => {
            const fixture =
              await makeFixture("SUBMITTED");

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(
                fixture,
                {
                  output: {
                    ...fixture.input.output,
                    [field]: value,
                  } as unknown as CreateVisualAttemptGenerationRecordInput["output"],
                },
              )),
              new RegExp(
                `refuses caller-owned output authority field ${field}\\.`,
              ),
            );

            expect(inspectorProbe.calls).toBe(0);
          },
        );

        it(
          "refuses missing output evidence",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(
                fixture,
                {
                  output: null as unknown as CreateVisualAttemptGenerationRecordInput["output"],
                },
              )),
              /requires output evidence/,
            );
          },
        );
      },
    );

    describe(
      "G. output validation",
      () => {
        it(
          "refuses a noncanonical output path in the shot directory",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const other =
              join(
                fixture.shotDirectory,
                "other.mp4",
              );

            await writeRaw(
              other,
              fixture.outputBytes,
            );

            await expectRejectedWithoutRecord(
              fixture,
              () => (writeWithOutput(
                fixture,
                {
                  outputPath: other,
                },
              )),
              /is not the canonical output path/,
            );
          },
        );

        it(
          "refuses a lexically escaping spelling of the canonical output path",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await expectRejectedWithoutRecord(
              fixture,
              () => (writeWithOutput(
                fixture,
                {
                  outputPath: [
                    fixture.shotDirectory,
                    "..",
                    SHOT_ID,
                    basename(
                      fixture.outputPath,
                    ),
                  ].join(
                    sep,
                  ),
                },
              )),
              /is not the canonical output path/,
            );
          },
        );

        it(
          "refuses an output path outside the media root",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const outside =
              join(
                fixture.mediaRoot,
                "..",
                basename(
                  fixture.outputPath,
                ),
              );

            await expectRejectedWithoutRecord(
              fixture,
              () => (writeWithOutput(
                fixture,
                {
                  outputPath: outside,
                },
              )),
              /is not the canonical output path/,
            );
          },
        );

        it(
          "refuses a missing output",
          async () => {
            const fixture =
              await makeFixture(
                "SUBMITTED",
                {
                  writeOutput: false,
                },
              );

            await mkdir(
              fixture.shotDirectory,
              {
                recursive: true,
              },
            );

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(fixture)),
              /output does not exist/,
            );
          },
        );

        it(
          "refuses a directory at the output path",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await rm(fixture.outputPath);
            await mkdir(fixture.outputPath);

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(fixture)),
              /output is not a regular file/,
            );
          },
        );

        it(
          "refuses a junction at the output path that escapes to an outside directory",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

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

            await symlink(
              outside,
              fixture.outputPath,
              "junction",
            );

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(fixture)),
              /output is not a regular file/,
            );
          },
        );

        it(
          "refuses a file symlink at the output path where the platform permits creating one",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const outside =
              join(
                fixture.mediaRoot,
                "outside.mp4",
              );

            await writeFile(
              outside,
              fixture.outputBytes,
            );

            await rm(fixture.outputPath);

            try {
              await symlink(
                outside,
                fixture.outputPath,
                "file",
              );
            } catch {
              // File symlinks need elevated privilege or developer mode on Windows.
              return;
            }

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(fixture)),
              /output is not a regular file/,
            );
          },
        );

        it(
          "refuses an empty output file",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await replaceOutput(
              fixture,
              Buffer.alloc(0),
            );

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(fixture)),
              /output is empty/,
            );
          },
        );

        it(
          "refuses a byte-size mismatch",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const declared =
              fixture.outputBytes.byteLength + 1;

            await expectRejectedWithoutRecord(
              fixture,
              () => (writeWithOutput(
                fixture,
                {
                  bytes: declared,
                },
              )),
              new RegExp(
                `output is ${fixture.outputBytes.byteLength} bytes; expected ${declared}`,
              ),
            );
          },
        );

        it(
          "refuses a SHA-256 mismatch",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await expectRejectedWithoutRecord(
              fixture,
              () => (writeWithOutput(
                fixture,
                {
                  sha256: "d".repeat(64),
                },
              )),
              new RegExp(
                `output SHA-256 ${sha256(fixture.outputBytes)} does not match expected ${"d".repeat(64)}`,
              ),
            );
          },
        );

        it(
          "refuses a same-size byte mutation of the output",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const corrupted =
              Buffer.from(
                fixture.outputBytes,
              );

            corrupted[0] =
              (corrupted[0] ?? 0) ^ 0xff;

            await replaceOutput(
              fixture,
              corrupted,
            );

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(fixture)),
              /output SHA-256 .* does not match expected/,
            );
          },
        );

        it.each([
          "A".repeat(64),
          "a".repeat(63),
          "g".repeat(64),
          "",
          42,
        ])(
          "refuses invalid SHA-256 format %s",
          async (
            value,
          ) => {
            const fixture =
              await makeFixture("SUBMITTED");

            await expectRejectedWithoutRecord(
              fixture,
              () => (writeWithOutput(
                fixture,
                {
                  sha256: value as string,
                },
              )),
              /lowercase 64-character hexadecimal digest/,
            );
          },
        );

        it.each([
          0,
          -1,
          1.5,
          Number.MAX_SAFE_INTEGER + 1,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          "33",
        ])(
          "refuses unsafe or non-positive byte count %s",
          async (
            value,
          ) => {
            const fixture =
              await makeFixture("SUBMITTED");

            await expectRejectedWithoutRecord(
              fixture,
              () => (writeWithOutput(
                fixture,
                {
                  bytes: value as number,
                },
              )),
              /positive safe integer/,
            );
          },
        );

        it(
          "detects an output that grows between lstat and open",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            fsProbe.beforeOpen =
              async (
                path,
              ) => {
                if (
                  path === fixture.outputPath
                ) {
                  await appendFile(
                    fixture.outputPath,
                    Buffer.from([
                      0x00,
                    ]),
                  );
                }
              };

            await expect(
              write(fixture),
            ).rejects.toThrow(
              /was replaced between lstat and open/,
            );

            expect(
              await exists(
                fixture.generationRecordPath,
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "detects an output replaced by a different same-size file between lstat and open",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            fsProbe.beforeOpen =
              async (
                path,
              ) => {
                if (
                  path === fixture.outputPath
                ) {
                  await rm(
                    fixture.outputPath,
                  );

                  await writeFile(
                    fixture.outputPath,
                    fixture.outputBytes,
                  );
                }
              };

            await expect(
              write(fixture),
            ).rejects.toThrow(
              /was replaced between lstat and open/,
            );

            expect(
              await exists(
                fixture.generationRecordPath,
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "fails on early EOF while hashing",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            fsProbe.earlyEof =
              true;

            await expect(
              write(fixture),
            ).rejects.toThrow(
              /ended before its declared size/,
            );

            expect(
              await exists(
                fixture.generationRecordPath,
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "detects an output that changes size while being hashed",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            fsProbe.afterRead =
              async (
                call,
              ) => {
                if (
                  call === 1
                ) {
                  await appendFile(
                    fixture.outputPath,
                    Buffer.from([
                      0x00,
                    ]),
                  );
                }
              };

            await expect(
              write(fixture),
            ).rejects.toThrow(
              /changed size while being hashed/,
            );

            expect(
              await exists(
                fixture.generationRecordPath,
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "preserves both the verification and the close failure",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            fsProbe.earlyEof =
              true;

            fsProbe.failClose =
              true;

            const error =
              await write(fixture).then(
                () => null,
                (reason: unknown) => reason,
              );

            expect(error).toBeInstanceOf(AggregateError);

            const errors =
              (error as AggregateError).errors.map(
                (entry: unknown) => String(entry),
              );

            expect(errors).toHaveLength(2);
            expect(errors[0]).toMatch(/ended before its declared size/);
            expect(errors[1]).toMatch(/simulated close failure/);

            expect(
              await exists(
                fixture.generationRecordPath,
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "does not swallow a close failure after a successful hash",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            fsProbe.failClose =
              true;

            await expect(
              write(fixture),
            ).rejects.toThrow(
              /simulated close failure/,
            );

            expect(
              await exists(
                fixture.generationRecordPath,
              ),
            ).toBe(
              false,
            );
          },
        );
      },
    );

    describe(
      "H. attempt isolation",
      () => {
        it(
          "refuses attempt 1 through replacement-attempt authority and leaves legacy evidence unchanged",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

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

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(
                fixture,
                {
                  attemptNumber: 1,
                },
              )),
              /replacement attempt number of at least 2/,
            );
          },
        );

        it.each([
          0,
          2.5,
        ])(
          "refuses non-replacement attempt number %s",
          async (
            attemptNumber,
          ) => {
            const fixture =
              await makeFixture("SUBMITTED");

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(
                fixture,
                {
                  attemptNumber,
                },
              )),
              /replacement attempt number/,
            );
          },
        );

        it(
          "ignores corrupt legacy attempt-1 lifecycle files beside attempt 2",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const legacyPaths = [
              createExecutionReservationPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID),
              createExecutionSubmissionPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID),
              createExecutionCompletionPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID),
            ];

            for (
              const legacyPath of legacyPaths
            ) {
              await writeRaw(
                legacyPath,
                "{",
              );
            }

            const result =
              await write(fixture);

            expect(result.record.reservationId).toBe(RESERVATION_ID);

            for (
              const legacyPath of legacyPaths
            ) {
              expect(
                await readFile(
                  legacyPath,
                  "utf8",
                ),
              ).toBe(
                "{",
              );
            }
          },
        );

        it(
          "refuses a legacy generation record at the same providerExecutionId path with a different reservation and leaves it unchanged",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const legacyRaw =
              await writeCanonical(
                fixture.generationRecordPath,
                {
                  ...fixture.expectedRecord,
                  recordedAt: "2026-10-30T09:00:00.000Z",
                  reservationId: LEGACY_RESERVATION_ID,
                },
              );

            await expect(
              write(fixture),
            ).rejects.toThrow(
              new RegExp(
                `belongs to reservation ${LEGACY_RESERVATION_ID}, not the attempt-aware reservation ${RESERVATION_ID}`,
              ),
            );

            expect(
              await readFile(
                fixture.generationRecordPath,
                "utf8",
              ),
            ).toBe(
              legacyRaw,
            );

            expect(
              await exists(
                fixture.completionPath,
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "ignores corrupt attempt-3 evidence when writing attempt 2 and leaves it unchanged",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const attempt3Paths = [
              createVisualAttemptAdmissionPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID, 3),
              createVisualAttemptExecutionReservationPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID, 3),
              createVisualAttemptExecutionSubmissionPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID, 3),
              createVisualAttemptExecutionCompletionPath(fixture.mediaRoot, EPISODE_ID, SHOT_ID, 3),
            ];

            for (
              const attempt3Path of attempt3Paths
            ) {
              await writeRaw(
                attempt3Path,
                "{",
              );
            }

            const result =
              await write(fixture);

            expect(result.record.reservationId).toBe(RESERVATION_ID);

            for (
              const attempt3Path of attempt3Paths
            ) {
              expect(
                await readFile(
                  attempt3Path,
                  "utf8",
                ),
              ).toBe(
                "{",
              );
            }
          },
        );

        it(
          "refuses attempt 3 when only attempt 2 is submitted",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await expectRejectedWithoutRecord(
              fixture,
              () => (write(
                fixture,
                {
                  attemptNumber: 3,
                },
              )),
              /requires SUBMITTED lifecycle; received NOT_ADMITTED/,
            );
          },
        );
      },
    );

    describe(
      "I. stale .part evidence",
      () => {
        it(
          "neither deletes nor adopts stale .part files",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const garbagePart =
              `${fixture.generationRecordPath}.part-999-stale-garbage`;

            const lookalikePart =
              `${fixture.generationRecordPath}.part-998-stale-lookalike`;

            await writeRaw(
              garbagePart,
              "{",
            );

            const lookalikeRaw =
              await writeCanonical(
                lookalikePart,
                {
                  ...fixture.expectedRecord,
                  recordedAt: "2026-11-01T00:00:00.000Z",
                },
              );

            const result =
              await write(fixture);

            expect(result.alreadyPresent).toBe(false);
            expect(result.record.recordedAt).toBe(RECORDED_AT);

            expect(
              await readFile(
                fixture.generationRecordPath,
                "utf8",
              ),
            ).toBe(
              canonical(
                fixture.expectedRecord,
              ),
            );

            expect(
              await readFile(
                garbagePart,
                "utf8",
              ),
            ).toBe(
              "{",
            );

            expect(
              await readFile(
                lookalikePart,
                "utf8",
              ),
            ).toBe(
              lookalikeRaw,
            );
          },
        );
      },
    );

    describe(
      "J. lineage reinspection",
      () => {
        it(
          "inspects exactly twice on fresh publication and on exact acceptance",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await write(fixture);

            expect(inspectorProbe.calls).toBe(2);

            inspectorProbe.calls = 0;

            await write(fixture);

            expect(inspectorProbe.calls).toBe(2);
          },
        );

        it(
          "does not reinspect when output verification fails",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            await rm(fixture.outputPath);

            await expect(
              write(fixture),
            ).rejects.toThrow(
              /output does not exist/,
            );

            expect(inspectorProbe.calls).toBe(1);
          },
        );

        it(
          "fails when the submission is rewritten before reinspection",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            inspectorProbe.beforeCall =
              async (
                call,
              ) => {
                if (
                  call === 2
                ) {
                  await writeCanonical(
                    fixture.submissionPath,
                    {
                      ...fixture.submissionRecord,
                      submittedAt: "2026-11-03T11:02:30.000Z",
                    },
                  );
                }
              };

            await expect(
              write(fixture),
            ).rejects.toThrow(
              /lineage changed during generation-record persistence .*reinspection reported SUBMITTED/,
            );

            expect(inspectorProbe.calls).toBe(2);
          },
        );

        it(
          "fails when a completion appears before reinspection",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            inspectorProbe.beforeCall =
              async (
                call,
              ) => {
                if (
                  call === 2
                ) {
                  await createVisualAttemptExecutionCompletion(
                    fixture.mediaRoot,
                    {
                      episodeId: EPISODE_ID,
                      sceneId: SCENE_ID,
                      shotId: SHOT_ID,
                      attemptNumber: ATTEMPT_NUMBER,
                      expectedAdmissionId: ADMISSION_ID,
                      expectedAdmissionSha256: fixture.admissionSha256,
                      expectedReservationId: RESERVATION_ID,
                      expectedReservationSha256: fixture.reservationSha256,
                      expectedSubmissionSha256: fixture.submissionSha256,
                    },
                    {
                      now: () => "2026-11-03T11:04:00.000Z",
                    },
                  );
                }
              };

            await expect(
              write(fixture),
            ).rejects.toThrow(
              /lineage changed during generation-record persistence .*reinspection reported COMPLETED/,
            );
          },
        );

        it(
          "fails when the lifecycle regresses before reinspection",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            inspectorProbe.beforeCall =
              async (
                call,
              ) => {
                if (
                  call === 2
                ) {
                  await rm(fixture.submissionPath);
                }
              };

            await expect(
              write(fixture),
            ).rejects.toThrow(
              /lineage changed during generation-record persistence .*reinspection reported RESERVED_ONLY/,
            );
          },
        );

        it(
          "fails when reinspection itself fails closed",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            inspectorProbe.beforeCall =
              async (
                call,
              ) => {
                if (
                  call === 2
                ) {
                  await writeRaw(
                    fixture.submissionPath,
                    "{",
                  );
                }
              };

            await expect(
              write(fixture),
            ).rejects.toThrow(
              /lineage changed during generation-record persistence .*reinspection failed/,
            );
          },
        );

        it(
          "source calls the inspector before and after publication and compares with isDeepStrictEqual",
          async () => {
            const source =
              await readFile(
                join(
                  process.cwd(),
                  WRITER_SOURCE,
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

            const body =
              source.slice(
                source.indexOf(
                  "export async function createVisualAttemptGenerationRecord(",
                ),
              );

            const firstInspection =
              body.indexOf(
                "await inspectVisualAttemptExecutionLifecycle(",
              );

            const publication =
              body.indexOf(
                "await publishVisualAttemptExecutionRecordCreateOnce(",
              );

            const reinspection =
              body.indexOf(
                "await requireStableLineage(",
              );

            expect(source).toContain(
              "export async function createVisualAttemptGenerationRecord(",
            );

            expect(firstInspection).toBeGreaterThan(0);
            expect(publication).toBeGreaterThan(firstInspection);
            expect(reinspection).toBeGreaterThan(publication);
          },
        );
      },
    );

    describe(
      "K. compatibility with Slice-2C, Slice-2D and Slice-2E",
      () => {
        it(
          "lets the existing completion writer consume the record, the inspector report COMPLETED and the verifier verify the output",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const written =
              await write(fixture);

            const completion =
              await createVisualAttemptExecutionCompletion(
                fixture.mediaRoot,
                {
                  episodeId: EPISODE_ID,
                  sceneId: SCENE_ID,
                  shotId: SHOT_ID,
                  attemptNumber: ATTEMPT_NUMBER,
                  expectedAdmissionId: ADMISSION_ID,
                  expectedAdmissionSha256: fixture.admissionSha256,
                  expectedReservationId: RESERVATION_ID,
                  expectedReservationSha256: fixture.reservationSha256,
                  expectedSubmissionSha256: fixture.submissionSha256,
                },
                {
                  now: () => "2026-11-03T11:04:00.000Z",
                },
              );

            expect(completion.generationRecordPath).toBe(written.generationRecordPath);
            expect(completion.generationRecordSha256).toBe(written.generationRecordSha256);

            const lifecycle =
              await inspectVisualAttemptExecutionLifecycle(
                fixture.mediaRoot,
                EPISODE_ID,
                SHOT_ID,
                ATTEMPT_NUMBER,
              );

            expect(lifecycle.state).toBe("COMPLETED");

            if (
              lifecycle.state !== "COMPLETED"
            ) {
              return;
            }

            expect(lifecycle.generationRecord.generationRecordSha256).toBe(
              written.generationRecordSha256,
            );

            expect(lifecycle.generationRecord.outputPath).toBe(written.outputPath);

            const verification =
              await verifyVisualAttemptDurableCompletion(
                fixture.mediaRoot,
                EPISODE_ID,
                SHOT_ID,
                ATTEMPT_NUMBER,
              );

            expect(verification.sha256).toBe(sha256(fixture.outputBytes));
            expect(verification.bytes).toBe(fixture.outputBytes.byteLength);
            expect(verification.reservationId).toBe(RESERVATION_ID);
            expect(verification.generationRecordSha256).toBe(written.generationRecordSha256);
          },
        );
      },
    );

    describe(
      "L. purity",
      () => {
        it(
          "adds only the generation record to the temporary media root",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            const before =
              await snapshotTree(
                fixture.mediaRoot,
              );

            const result =
              await write(fixture);

            const after =
              await snapshotTree(
                fixture.mediaRoot,
              );

            const recordKey =
              relative(
                fixture.mediaRoot,
                fixture.generationRecordPath,
              );

            expect(after).toEqual({
              ...before,
              [recordKey]: result.generationRecordSha256,
            });

            await write(fixture);

            expect(
              await snapshotTree(
                fixture.mediaRoot,
              ),
            ).toEqual(
              after,
            );
          },
        );

        it(
          "uses only temporary roots",
          async () => {
            const fixture =
              await makeFixture("SUBMITTED");

            expect(
              relative(
                tmpdir(),
                fixture.mediaRoot,
              ).startsWith(
                "..",
              ),
            ).toBe(
              false,
            );

            expect(
              fixture.generationRecordPath.startsWith(
                fixture.mediaRoot,
              ),
            ).toBe(
              true,
            );
          },
        );
      },
    );

    describe(
      "M. static source audit",
      () => {
        async function readWriterSource(): Promise<string> {
          return readFile(
            join(
              process.cwd(),
              WRITER_SOURCE,
            ),
            "utf8",
          );
        }

        it(
          "imports exactly the intended modules",
          async () => {
            const source =
              await readWriterSource();

            const specifiers =
              [
                ...source.matchAll(
                  /\bfrom\s*["']([^"']+)["']/g,
                ),
              ].map(
                (match) => match[1],
              );

            expect(
              [...new Set(specifiers)].sort(),
            ).toEqual([
              "../googleGenai/audit/googleGenAiGenerationRecord.schema.js",
              "../googleGenai/audit/googleGenAiGenerationRecordPath.js",
              "../googleGenai/output/googleGenAiVideoOutputPath.js",
              "./inspectVisualAttemptExecutionLifecycle.js",
              "./visualAttemptExecutionRecordPersistence.js",
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
            "environment or credential access",
            /process\.env|loadEnvironment|dotenv|apiKey|x-goog-api-key/,
          ],
          [
            "provider and transport modules",
            /\/providers\/|\/transport\/|googleGenAi\.types/,
          ],
          [
            "activation-policy authority",
            /ActivationPolicy|activationPolicy|activation-policy|ActivationLimits|newSubmissionsEnabled/,
          ],
          [
            "legacy lifecycle APIs",
            /inspectGoogleGenAiExecutionLifecycle|\binspectExecutionLifecycle\b|classifyExecutionLifecycle|readExecutionReservation|readExecutionSubmission|readExecutionCompletion|readGoogleGenAiExecutionCompletion|readGoogleGenAiGenerationRecord|verifyGoogleGenAiDurableCompletion|verifyLocalCompletedVisualExecution/,
          ],
          [
            "direct attempt evidence readers",
            /readVisualAttemptAdmission|readVisualAttemptExecution/,
          ],
          [
            "output creation, recovery and completion authority",
            /retrieveOutput|materialize|recoverGoogleGenAi|persistGoogleGenAi|submitGoogleGenAi|createVisualAttemptExecutionCompletion|createExecution|reconcile|download|interactions\.|\bfiles\./,
          ],
          [
            "runtime wiring",
            /\/cli\/|\/routing\/|\/runway\/|\/veo\/|executeSingleShot|runEpisodeAutomation/,
          ],
          [
            "direct filesystem mutation APIs",
            /\b(?:writeFile|appendFile|mkdir|mkdtemp|rename|copyFile|cp|unlink|rm|rmdir|truncate|symlink|link|utimes|chmod|chown|createWriteStream)\b/,
          ],
          [
            "writable open flags",
            /["'](?:w|wx|a|ax|a\+|r\+|w\+|rs\+)["']/,
          ],
          [
            "production media paths",
            /D:\\|D:\/|Busybookie[\\/]+Production/i,
          ],
          [
            "whole-file output reads",
            /readFile\(\s*outputPath|readFile\(\s*canonicalOutputPath/,
          ],
        ])(
          "contains no %s",
          async (
            _label,
            pattern,
          ) => {
            const source =
              await readWriterSource();

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
          "pins the primitives it relies on",
          async () => {
            const source =
              await readWriterSource();

            for (
              const token of [
                "lstat(",
                "realpath(",
                "open(",
                "isDeepStrictEqual(",
                "bigint: true",
                "AggregateError",
                "Object.hasOwn(",
                "GoogleGenAiGenerationRecordSchema",
                "createGoogleGenAiGenerationRecordPath(",
                "createGoogleGenAiVideoOutputPath(",
                "serializeVisualAttemptExecutionRecord(",
                "publishVisualAttemptExecutionRecordCreateOnce(",
                "lifecycle.submission.record.providerExecutionId",
                "lifecycle.reservation.record.reservationId",
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

            expect(
              source.match(
                /\bpublishVisualAttemptExecutionRecordCreateOnce\s*\(/g,
              ) ?? [],
            ).toHaveLength(
              1,
            );
          },
        );

        it(
          "exports exactly one runtime function",
          async () => {
            const module =
              await import(
                "../src/execution/createVisualAttemptGenerationRecord.js"
              );

            expect(
              Object.entries(
                module,
              ).filter(
                ([, value]) => typeof value === "function",
              ).map(
                ([name]) => name,
              ),
            ).toEqual([
              "createVisualAttemptGenerationRecord",
            ]);
          },
        );
      },
    );
  },
);
