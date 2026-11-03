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
  vi,
} from "vitest";

import {
  createVisualAttemptExecutionCompletion,
} from "../src/execution/createVisualAttemptExecutionCompletion.js";

import {
  createVisualAttemptGenerationRecord,
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
  materializeGoogleGenAiSingleShotOutputFromDurableIdentity,
  type GoogleGenAiOutputUriDownloader,
} from "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js";

import {
  recoverGoogleGenAiSingleShotFromDurableIdentity,
} from "../src/execution/providers/recoverGoogleGenAiSingleShot.js";

const seamProbe =
  vi.hoisted(
    () => ({
      forceWrongRecoveryRequest: false,
      forceWrongMaterializationRequest: false,
    }),
  );

vi.mock(
  "../src/execution/providers/recoverGoogleGenAiSingleShot.js",
  async (
    importOriginal,
  ) => {
    const actual =
      await importOriginal<
        typeof import("../src/execution/providers/recoverGoogleGenAiSingleShot.js")
      >();

    return {
      ...actual,
      recoverGoogleGenAiSingleShotFromDurableIdentity:
        vi.fn(
          async (
            identity,
            dependencies,
          ) => {
            if (
              seamProbe.forceWrongRecoveryRequest
            ) {
              await dependencies.getInteraction(
                `${identity.providerExecutionId}-changed`,
              );
            }

            return actual.recoverGoogleGenAiSingleShotFromDurableIdentity(
              identity,
              dependencies,
            );
          },
        ),
    };
  },
);

vi.mock(
  "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js",
  async (
    importOriginal,
  ) => {
    const actual =
      await importOriginal<
        typeof import("../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js")
      >();

    return {
      ...actual,
      materializeGoogleGenAiSingleShotOutputFromDurableIdentity:
        vi.fn(
          async (
            input,
            identity,
            dependencies,
          ) => {
            if (
              seamProbe.forceWrongMaterializationRequest
            ) {
              await dependencies.retrieveOutput(
                `${identity.providerExecutionId}-changed`,
              );
            }

            return actual.materializeGoogleGenAiSingleShotOutputFromDurableIdentity(
              input,
              identity,
              dependencies,
            );
          },
        ),
    };
  },
);

import {
  reconcileGoogleGenAiVisualAttemptExecutionLifecycle,
  type GoogleGenAiSubmittedRecoveryDependencies,
} from "../src/execution/reconcileGoogleGenAiExecutionLifecycle.js";

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
  GOOGLE_GENAI_ACTIVATION_LIMITS,
} from "../src/googleGenai/googleGenAiActivationLimits.js";

import {
  createGoogleGenAiVideoOutputPath,
} from "../src/googleGenai/output/googleGenAiVideoOutputPath.js";

import type {
  GoogleGenAiInteractionReplayResult,
  GoogleGenAiPrepareOutputUri,
  GoogleGenAiReplayInteraction,
  GoogleGenAiSecureOutputTransportPolicy,
  GoogleGenAiVerifiedFileMetadata,
} from "../src/googleGenai/transport/googleGenAiSecureOutputTransport.types.js";

const EPISODE_ID =
  "EP93";

const SCENE_ID =
  "SC01";

const SHOT_ID =
  "S01";

const ATTEMPT_NUMBER =
  2;

const ADMISSION_ID =
  "f71c8cf1-a82d-4410-954f-6af17cc3ce22";

const RESERVATION_ID =
  "a83c34e2-fe66-47e1-9166-dd25e947003a";

const PROVIDER_EXECUTION_ID =
  "v1_ChdhdHRlbXB0LWF3YXJlLXJlY292ZXJ5LTAwMg";

const SUBMITTED_AT =
  "2026-11-03T11:02:00.000Z";

const SUBMITTED_AT_MS =
  Date.parse(
    SUBMITTED_AT,
  );

const OUTPUT_URI =
  "https://generativelanguage.googleapis.com/v1beta/files/attempt-2:download?alt=media";

const TRANSPORT_POLICY:
  GoogleGenAiSecureOutputTransportPolicy =
  GOOGLE_GENAI_ACTIVATION_LIMITS;

const roots: string[] =
  [];

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

function makeMp4(
  label: string =
    "busybookie-attempt-aware-reconciliation-output",
): Buffer {
  const payload =
    Buffer.from(
      label,
      "utf8",
    );

  const mdat =
    Buffer.alloc(
      8,
    );

  mdat.writeUInt32BE(
    8 + payload.byteLength,
    0,
  );

  mdat.write(
    "mdat",
    4,
    "latin1",
  );

  return Buffer.concat([
    Buffer.from([
      0x00,
      0x00,
      0x00,
      0x18,
    ]),
    Buffer.from(
      "ftypisom",
      "latin1",
    ),
    Buffer.from([
      0x00,
      0x00,
      0x02,
      0x00,
    ]),
    Buffer.from(
      "isommp41",
      "latin1",
    ),
    mdat,
    payload,
  ]);
}

const OUTPUT_BYTES =
  makeMp4();

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
  | "NONE"
  | "ADMITTED"
  | "RESERVED"
  | "SUBMITTED"
  | "COMPLETED";

const STAGE_ORDER: readonly Stage[] = [
  "NONE",
  "ADMITTED",
  "RESERVED",
  "SUBMITTED",
  "COMPLETED",
];

function reaches(
  stage: Stage,
  level: Stage,
): boolean {
  return STAGE_ORDER.indexOf(
    stage,
  ) >=
    STAGE_ORDER.indexOf(
      level,
    );
}

async function writeRaw(
  path: string,
  raw: string | Buffer,
): Promise<void> {
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

async function snapshotTree(
  root: string,
): Promise<Record<string, string>> {
  const result:
    Record<string, string> =
    {};

  for (
    const entry of await readdir(
      root,
      {
        recursive: true,
        withFileTypes: true,
      },
    )
  ) {
    const absolute =
      join(
        entry.parentPath,
        entry.name,
      );

    result[
      relative(
        root,
        absolute,
      )
    ] =
      entry.isFile()
        ? sha256(
            await readFile(
              absolute,
            ),
          )
        : "dir";
  }

  return result;
}

async function makeMediaRoot(): Promise<string> {
  const mediaRoot =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-attempt-google-reconciliation-",
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
    writeOutput?: boolean;
    outputBytes?: Buffer;
  }> = {},
) {
  const mediaRoot =
    await makeMediaRoot();

  const outputBytes =
    options.outputBytes ??
    OUTPUT_BYTES;

  const admissionPath =
    createVisualAttemptAdmissionPath(
      mediaRoot,
      EPISODE_ID,
      SHOT_ID,
      ATTEMPT_NUMBER,
    );

  const reservationPath =
    createVisualAttemptExecutionReservationPath(
      mediaRoot,
      EPISODE_ID,
      SHOT_ID,
      ATTEMPT_NUMBER,
    );

  const submissionPath =
    createVisualAttemptExecutionSubmissionPath(
      mediaRoot,
      EPISODE_ID,
      SHOT_ID,
      ATTEMPT_NUMBER,
    );

  const completionPath =
    createVisualAttemptExecutionCompletionPath(
      mediaRoot,
      EPISODE_ID,
      SHOT_ID,
      ATTEMPT_NUMBER,
    );

  const generationRecordPath =
    createGoogleGenAiGenerationRecordPath(
      mediaRoot,
      EPISODE_ID,
      SHOT_ID,
      PROVIDER_EXECUTION_ID,
    );

  const outputPath =
    createGoogleGenAiVideoOutputPath(
      mediaRoot,
      EPISODE_ID,
      SHOT_ID,
      PROVIDER_EXECUTION_ID,
    );

  let admissionSha256:
    string | undefined;

  let reservationSha256:
    string | undefined;

  let submissionSha256:
    string | undefined;

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

  if (
    reaches(
      stage,
      "ADMITTED",
    )
  ) {
    admissionSha256 =
      sha256(
        await writeCanonical(
          admissionPath,
          admissionRecord,
        ),
      );
  }

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
    admissionSha256:
      admissionSha256 ??
      "0".repeat(64),
    provider: "GOOGLE_GENAI",
  };

  if (
    reaches(
      stage,
      "RESERVED",
    )
  ) {
    reservationSha256 =
      sha256(
        await writeCanonical(
          reservationPath,
          reservationRecord,
        ),
      );
  }

  const submissionRecord = {
    schemaVersion: "1.0",
    submittedAt: SUBMITTED_AT,
    status: "SUBMITTED",
    reservationId: RESERVATION_ID,
    reservationSha256:
      reservationSha256 ??
      "0".repeat(64),
    episodeId: EPISODE_ID,
    sceneId: SCENE_ID,
    shotId: SHOT_ID,
    attemptNumber: ATTEMPT_NUMBER,
    admissionId: ADMISSION_ID,
    admissionSha256:
      admissionSha256 ??
      "0".repeat(64),
    provider: "GOOGLE_GENAI",
    providerExecutionId: PROVIDER_EXECUTION_ID,
    recoveryMetadata,
  };

  if (
    reaches(
      stage,
      "SUBMITTED",
    )
  ) {
    submissionSha256 =
      sha256(
        await writeCanonical(
          submissionPath,
          submissionRecord,
        ),
      );
  }

  if (
    options.writeOutput === true ||
    stage === "COMPLETED"
  ) {
    await writeRaw(
      outputPath,
      outputBytes,
    );
  }

  if (
    stage ===
      "COMPLETED"
  ) {
    await createVisualAttemptGenerationRecord(
      mediaRoot,
      {
        episodeId: EPISODE_ID,
        sceneId: SCENE_ID,
        shotId: SHOT_ID,
        attemptNumber: ATTEMPT_NUMBER,
        expectedAdmissionId: ADMISSION_ID,
        expectedAdmissionSha256: admissionSha256!,
        expectedReservationId: RESERVATION_ID,
        expectedReservationSha256: reservationSha256!,
        expectedSubmissionSha256: submissionSha256!,
        expectedProviderExecutionId: PROVIDER_EXECUTION_ID,
        output: {
          outputPath,
          bytes: outputBytes.byteLength,
          sha256: sha256(
            outputBytes,
          ),
        },
      },
      {
        now: () =>
          "2026-11-03T11:04:00.000Z",
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
        expectedAdmissionSha256: admissionSha256!,
        expectedReservationId: RESERVATION_ID,
        expectedReservationSha256: reservationSha256!,
        expectedSubmissionSha256: submissionSha256!,
      },
      {
        now: () =>
          "2026-11-03T11:05:00.000Z",
      },
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
    admissionRecord,
    reservationRecord,
    submissionRecord,
    admissionSha256,
    reservationSha256,
    submissionSha256,
  };
}

function replayObservation(
  providerExecutionId: string,
  status: unknown,
): GoogleGenAiInteractionReplayResult {
  return Object.freeze({
    id: providerExecutionId,
    status,
    outputVideo:
      status === "completed"
        ? Object.freeze({
            type: "video",
            mime_type: "video/mp4",
            uri: OUTPUT_URI,
          })
        : null,
  }) as GoogleGenAiInteractionReplayResult;
}

function replayer(
  status: unknown =
    "completed",
) {
  return vi.fn<GoogleGenAiReplayInteraction>(
    async (
      providerExecutionId,
    ) =>
      replayObservation(
        providerExecutionId,
        status,
      ),
  );
}

function metadataFor(
  bytes: Uint8Array =
    OUTPUT_BYTES,
): GoogleGenAiVerifiedFileMetadata {
  return Object.freeze({
    resource:
      Object.freeze({
        fileId: "attempt-2",
        name: "files/attempt-2",
        downloadUri: OUTPUT_URI,
      }),
    byteCount: bytes.byteLength,
    sha256: sha256(
      Buffer.from(
        bytes,
      ),
    ),
    mimeType: "video/mp4",
    expirationTime: "2026-11-05T12:00:00Z",
    expirationTimeMs: Date.UTC(
      2026,
      10,
      5,
      12,
    ),
  });
}

function preparer(
  bytes: Uint8Array =
    OUTPUT_BYTES,
) {
  return vi.fn<GoogleGenAiPrepareOutputUri>(
    async () =>
      metadataFor(
        bytes,
      ),
  );
}

function streamingDownloader(
  bytes: Uint8Array =
    OUTPUT_BYTES,
) {
  return vi.fn<GoogleGenAiOutputUriDownloader>(
    async (
      _metadata,
      sink,
    ) => {
      for (
        let offset = 0;
        offset < bytes.byteLength;
        offset += 9
      ) {
        await sink.writeChunk(
          bytes.slice(
            offset,
            offset + 9,
          ),
        );
      }

      return Object.freeze({
        byteCount: bytes.byteLength,
        sha256: sha256(
          Buffer.from(
            bytes,
          ),
        ),
        mimeType: "video/mp4" as const,
      });
    },
  );
}

type RecoverySpies =
  Readonly<{
    dependencies: GoogleGenAiSubmittedRecoveryDependencies;
    replayInteraction: ReturnType<typeof replayer>;
    prepareUri: ReturnType<typeof preparer>;
    downloadUri: ReturnType<typeof streamingDownloader>;
  }>;

function recoverySpies(
  status: unknown =
    "completed",
  overrides:
    Partial<GoogleGenAiSubmittedRecoveryDependencies> =
      {},
): RecoverySpies {
  const replayInteraction =
    replayer(
      status,
    );

  const prepareUri =
    preparer();

  const downloadUri =
    streamingDownloader();

  return {
    dependencies: {
      replayInteraction,
      prepareUri,
      downloadUri,
      policy: TRANSPORT_POLICY,
      nowMs: () =>
        SUBMITTED_AT_MS +
        19 * 60_000,
      monotonicNowMs: () =>
        0,
      now: () =>
        "2026-11-03T11:05:00.000Z",
      ...overrides,
    },
    replayInteraction,
    prepareUri,
    downloadUri,
  };
}

function reconcile(
  mediaRoot: string,
  submittedRecovery?:
    GoogleGenAiSubmittedRecoveryDependencies,
) {
  return reconcileGoogleGenAiVisualAttemptExecutionLifecycle(
    {
      mediaRoot,
      episodeId: EPISODE_ID,
      shotId: SHOT_ID,
      attemptNumber: ATTEMPT_NUMBER,
    },
    submittedRecovery === undefined
      ? {}
      : {
          submittedRecovery,
        },
  );
}

async function seedGenerationRecordOnly(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
): Promise<void> {
  await writeRaw(
    fixture.outputPath,
    fixture.outputBytes,
  );

  await createVisualAttemptGenerationRecord(
    fixture.mediaRoot,
    {
      episodeId: EPISODE_ID,
      sceneId: SCENE_ID,
      shotId: SHOT_ID,
      attemptNumber: ATTEMPT_NUMBER,
      expectedAdmissionId: ADMISSION_ID,
      expectedAdmissionSha256: fixture.admissionSha256!,
      expectedReservationId: RESERVATION_ID,
      expectedReservationSha256: fixture.reservationSha256!,
      expectedSubmissionSha256: fixture.submissionSha256!,
      expectedProviderExecutionId: PROVIDER_EXECUTION_ID,
      output: {
        outputPath: fixture.outputPath,
        bytes: fixture.outputBytes.byteLength,
        sha256: sha256(
          fixture.outputBytes,
        ),
      },
    },
    {
      now: () =>
        "2026-11-03T11:04:00.000Z",
    },
  );
}

afterEach(
  async () => {
    seamProbe.forceWrongRecoveryRequest =
      false;
    seamProbe.forceWrongMaterializationRequest =
      false;

    vi.mocked(
      recoverGoogleGenAiSingleShotFromDurableIdentity,
    ).mockClear();

    vi.mocked(
      materializeGoogleGenAiSingleShotOutputFromDurableIdentity,
    ).mockClear();

    while (
      roots.length > 0
    ) {
      const root =
        roots.pop();

      if (root) {
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

describe(
  "attempt-aware Google GenAI lifecycle reconciliation",
  () => {
    it(
      "keeps the durable recovery seam fail-closed on an empty providerExecutionId before observation",
      async () => {
        const getInteraction =
          vi.fn(
            async () => ({
              id: PROVIDER_EXECUTION_ID,
              status: "completed",
            }),
          );

        await expect(
          recoverGoogleGenAiSingleShotFromDurableIdentity(
            {
              episodeId: EPISODE_ID,
              shotId: SHOT_ID,
              providerExecutionId: "   ",
            },
            {
              getInteraction,
            },
          ),
        ).rejects.toThrow(
          /empty providerExecutionId/,
        );

        expect(
          getInteraction,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "keeps the durable materialization seam fail-closed on input/identity mismatch before retrieval",
      async () => {
        const retrieveOutput =
          vi.fn(
            async () => ({
              id: PROVIDER_EXECUTION_ID,
              status: "completed",
              outputVideo: null,
            }),
          );

        await expect(
          materializeGoogleGenAiSingleShotOutputFromDurableIdentity(
            {
              mediaRoot: "C:\\Busybookie\\tests",
              episodeId: EPISODE_ID,
              shotId: SHOT_ID,
              maxOutputBytes: 4096,
            },
            {
              episodeId: "EP94",
              shotId: SHOT_ID,
              providerExecutionId: PROVIDER_EXECUTION_ID,
            },
            {
              retrieveOutput,
            },
          ),
        ).rejects.toThrow(
          /input identity does not match the durable identity/,
        );

        expect(
          retrieveOutput,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "A verifies an already-COMPLETED attempt offline without requiring recovery dependencies or changing durable bytes",
      async () => {
        const fixture =
          await makeFixture(
            "COMPLETED",
          );

        const before =
          await snapshotTree(
            fixture.mediaRoot,
          );

        const result =
          await reconcileGoogleGenAiVisualAttemptExecutionLifecycle(
            {
              mediaRoot: fixture.mediaRoot,
              episodeId: EPISODE_ID,
              shotId: SHOT_ID,
              attemptNumber: ATTEMPT_NUMBER,
            },
            {
              submittedRecovery:
                {
                  replayInteraction: 7,
                  policy: null,
                } as unknown as GoogleGenAiSubmittedRecoveryDependencies,
            },
          );

        expect(
          result.reconciliationMode,
        ).toBe(
          "DURABLE_COMPLETION",
        );

        expect(
          result.verification,
        ).toEqual(
          await verifyVisualAttemptDurableCompletion(
            fixture.mediaRoot,
            EPISODE_ID,
            SHOT_ID,
            ATTEMPT_NUMBER,
          ),
        );

        expect(
          vi.mocked(
            recoverGoogleGenAiSingleShotFromDurableIdentity,
          ),
        ).not.toHaveBeenCalled();

        expect(
          vi.mocked(
            materializeGoogleGenAiSingleShotOutputFromDurableIdentity,
          ),
        ).not.toHaveBeenCalled();

        expect(
          await snapshotTree(
            fixture.mediaRoot,
          ),
        ).toStrictEqual(
          before,
        );
      },
    );

    it.each([
      ["NONE", "NOT_ADMITTED"],
      ["ADMITTED", "ADMITTED_ONLY"],
      ["RESERVED", "RESERVED_ONLY"],
    ] as const)(
      "B fails closed from %s/%s before replay or durable output work",
      async (
        stage,
        state,
      ) => {
        const fixture =
          await makeFixture(
            stage,
          );

        const spies =
          recoverySpies();

        const before =
          await snapshotTree(
            fixture.mediaRoot,
          );

        await expect(
          reconcile(
            fixture.mediaRoot,
            spies.dependencies,
          ),
        ).rejects.toThrow(
          `requires SUBMITTED or COMPLETED state; received ${state}`,
        );

        expect(
          spies.replayInteraction,
        ).not.toHaveBeenCalled();

        expect(
          spies.prepareUri,
        ).not.toHaveBeenCalled();

        expect(
          spies.downloadUri,
        ).not.toHaveBeenCalled();

        expect(
          await snapshotTree(
            fixture.mediaRoot,
          ),
        ).toStrictEqual(
          before,
        );
      },
    );

    it.each([
      "admissionId",
      "admissionSha256",
      "reservationId",
      "reservationSha256",
      "submissionSha256",
      "provider",
      "providerExecutionId",
      "generationRecordPath",
      "outputPath",
    ] as const)(
      "B2 rejects caller-owned %s authority before provider replay",
      async (
        field,
      ) => {
        const fixture =
          await makeFixture(
            "SUBMITTED",
          );

        const spies =
          recoverySpies();

        const input = {
          mediaRoot: fixture.mediaRoot,
          episodeId: EPISODE_ID,
          shotId: SHOT_ID,
          attemptNumber: ATTEMPT_NUMBER,
          [field]: "caller-override",
        };

        await expect(
          reconcileGoogleGenAiVisualAttemptExecutionLifecycle(
            input,
            {
              submittedRecovery:
                spies.dependencies,
            },
          ),
        ).rejects.toThrow(
          /does not accept a caller-supplied/,
        );

        expect(
          spies.replayInteraction,
        ).not.toHaveBeenCalled();
      },
    );

    it.each([
      "queued",
      "in_progress",
    ])(
      "C rejects SUBMITTED %s after exactly one replay with no materialization or durable records",
      async (
        status,
      ) => {
        const fixture =
          await makeFixture(
            "SUBMITTED",
          );

        const spies =
          recoverySpies(
            status,
          );

        const before =
          await snapshotTree(
            fixture.mediaRoot,
          );

        await expect(
          reconcile(
            fixture.mediaRoot,
            spies.dependencies,
          ),
        ).rejects.toThrow(
          /still pending/,
        );

        expect(
          spies.replayInteraction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          spies.prepareUri,
        ).not.toHaveBeenCalled();

        expect(
          spies.downloadUri,
        ).not.toHaveBeenCalled();

        expect(
          await snapshotTree(
            fixture.mediaRoot,
          ),
        ).toStrictEqual(
          before,
        );
      },
    );

    it.each([
      "failed",
      "cancelled",
      "incomplete",
      "budget_exceeded",
    ])(
      "D rejects SUBMITTED %s after exactly one replay with no materialization or durable records",
      async (
        status,
      ) => {
        const fixture =
          await makeFixture(
            "SUBMITTED",
          );

        const spies =
          recoverySpies(
            status,
          );

        const before =
          await snapshotTree(
            fixture.mediaRoot,
          );

        await expect(
          reconcile(
            fixture.mediaRoot,
            spies.dependencies,
          ),
        ).rejects.toThrow(
          /ended without a materializable result/,
        );

        expect(
          spies.replayInteraction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          spies.prepareUri,
        ).not.toHaveBeenCalled();

        expect(
          spies.downloadUri,
        ).not.toHaveBeenCalled();

        expect(
          await snapshotTree(
            fixture.mediaRoot,
          ),
        ).toStrictEqual(
          before,
        );
      },
    );

    it(
      "E recovers SUBMITTED SUCCESS through output, generation record, completion and final durable verification using one frozen replay observation",
      async () => {
        const fixture =
          await makeFixture(
            "SUBMITTED",
          );

        const legacyCompletionPath =
          createExecutionCompletionPath(
            fixture.mediaRoot,
            EPISODE_ID,
            SHOT_ID,
          );

        const legacySentinel =
          "immutable-legacy-completion-sentinel\n";

        await writeRaw(
          legacyCompletionPath,
          legacySentinel,
        );

        const spies =
          recoverySpies();

        const result =
          await reconcile(
            fixture.mediaRoot,
            spies.dependencies,
          );

        expect(
          result.reconciliationMode,
        ).toBe(
          "RECOVERED_SUBMISSION",
        );

        if (
          result.reconciliationMode !==
          "RECOVERED_SUBMISSION"
        ) {
          throw new Error(
            "Expected recovered visual-attempt reconciliation result.",
          );
        }

        expect(
          result.remoteStatus,
        ).toBe(
          "completed",
        );

        expect(
          spies.replayInteraction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          spies.replayInteraction,
        ).toHaveBeenCalledWith(
          PROVIDER_EXECUTION_ID,
          expect.any(Object),
        );

        expect(
          vi.mocked(
            recoverGoogleGenAiSingleShotFromDurableIdentity,
          ),
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          vi.mocked(
            materializeGoogleGenAiSingleShotOutputFromDurableIdentity,
          ),
        ).toHaveBeenCalledTimes(
          1,
        );

        const observation =
          await spies.replayInteraction
            .mock.results[0]!.value;

        const recoveryCall =
          vi.mocked(
            recoverGoogleGenAiSingleShotFromDurableIdentity,
          ).mock.calls[0]!;

        const materializationCall =
          vi.mocked(
            materializeGoogleGenAiSingleShotOutputFromDurableIdentity,
          ).mock.calls[0]!;

        expect(
          recoveryCall[0],
        ).toBe(
          materializationCall[1],
        );

        expect(
          await recoveryCall[1].getInteraction(
            PROVIDER_EXECUTION_ID,
          ),
        ).toBe(
          observation,
        );

        expect(
          await materializationCall[2].retrieveOutput(
            PROVIDER_EXECUTION_ID,
          ),
        ).toBe(
          observation,
        );

        expect(
          spies.replayInteraction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          spies.prepareUri,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          spies.downloadUri,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          await readFile(
            fixture.outputPath,
          ),
        ).toEqual(
          OUTPUT_BYTES,
        );

        expect(
          await exists(
            fixture.generationRecordPath,
          ),
        ).toBe(
          true,
        );

        expect(
          await exists(
            fixture.completionPath,
          ),
        ).toBe(
          true,
        );

        expect(
          result.verification,
        ).toEqual(
          await verifyVisualAttemptDurableCompletion(
            fixture.mediaRoot,
            EPISODE_ID,
            SHOT_ID,
            ATTEMPT_NUMBER,
          ),
        );

        expect(
          await readFile(
            legacyCompletionPath,
            "utf8",
          ),
        ).toBe(
          legacySentinel,
        );
      },
    );

    it(
      "F rejects a replay observation whose interaction id differs from the durable attempt submission",
      async () => {
        const fixture =
          await makeFixture(
            "SUBMITTED",
          );

        const replayInteraction =
          vi.fn<GoogleGenAiReplayInteraction>(
            async () =>
              replayObservation(
                "v1_wrong-interaction",
                "completed",
              ),
          );

        const spies =
          recoverySpies(
            "completed",
            {
              replayInteraction,
            },
          );

        await expect(
          reconcile(
            fixture.mediaRoot,
            spies.dependencies,
          ),
        ).rejects.toThrow(
          /does not match durable providerExecutionId/,
        );

        expect(
          replayInteraction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          spies.prepareUri,
        ).not.toHaveBeenCalled();

        expect(
          await exists(
            fixture.completionPath,
          ),
        ).toBe(
          false,
        );
      },
    );

    it.each([
      "recovery",
      "materialization",
    ] as const)(
      "G fails closed without a second replay when the %s adapter requests a changed providerExecutionId",
      async (
        adapter,
      ) => {
        const fixture =
          await makeFixture(
            "SUBMITTED",
          );

        if (
          adapter ===
          "recovery"
        ) {
          seamProbe.forceWrongRecoveryRequest =
            true;
        } else {
          seamProbe.forceWrongMaterializationRequest =
            true;
        }

        const spies =
          recoverySpies();

        await expect(
          reconcile(
            fixture.mediaRoot,
            spies.dependencies,
          ),
        ).rejects.toThrow(
          /refusing a second replay/,
        );

        expect(
          spies.replayInteraction,
        ).toHaveBeenCalledTimes(
          1,
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
      "H restart-safely reuses an existing exact canonical output",
      async () => {
        const fixture =
          await makeFixture(
            "SUBMITTED",
            {
              writeOutput: true,
            },
          );

        const spies =
          recoverySpies();

        const result =
          await reconcile(
            fixture.mediaRoot,
            spies.dependencies,
          );

        expect(
          result.reconciliationMode,
        ).toBe(
          "RECOVERED_SUBMISSION",
        );

        expect(
          spies.replayInteraction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          spies.prepareUri,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          spies.downloadUri,
        ).not.toHaveBeenCalled();

        expect(
          await readFile(
            fixture.outputPath,
          ),
        ).toEqual(
          OUTPUT_BYTES,
        );
      },
    );

    it(
      "I fails closed and never overwrites an existing conflicting canonical output",
      async () => {
        const conflicting =
          makeMp4(
            "conflicting-attempt-output",
          );

        const fixture =
          await makeFixture(
            "SUBMITTED",
            {
              writeOutput: true,
              outputBytes: conflicting,
            },
          );

        const before =
          await readFile(
            fixture.outputPath,
          );

        const spies =
          recoverySpies();

        await expect(
          reconcile(
            fixture.mediaRoot,
            spies.dependencies,
          ),
        ).rejects.toMatchObject({
          code: "OUTPUT_PUBLICATION_CONFLICT",
        });

        expect(
          spies.replayInteraction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          await readFile(
            fixture.outputPath,
          ),
        ).toEqual(
          before,
        );

        expect(
          await exists(
            fixture.generationRecordPath,
          ),
        ).toBe(
          false,
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
      "J resumes from an exact existing generation record when completion is still absent",
      async () => {
        const fixture =
          await makeFixture(
            "SUBMITTED",
          );

        await seedGenerationRecordOnly(
          fixture,
        );

        const generationBefore =
          await readFile(
            fixture.generationRecordPath,
          );

        expect(
          await exists(
            fixture.completionPath,
          ),
        ).toBe(
          false,
        );

        const spies =
          recoverySpies();

        const result =
          await reconcile(
            fixture.mediaRoot,
            spies.dependencies,
          );

        expect(
          result.reconciliationMode,
        ).toBe(
          "RECOVERED_SUBMISSION",
        );

        expect(
          spies.downloadUri,
        ).not.toHaveBeenCalled();

        expect(
          await readFile(
            fixture.generationRecordPath,
          ),
        ).toEqual(
          generationBefore,
        );

        expect(
          await exists(
            fixture.completionPath,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "K rejects a misbound current-attempt submission before any provider replay or output work",
      async () => {
        const fixture =
          await makeFixture(
            "SUBMITTED",
          );

        await writeCanonical(
          fixture.submissionPath,
          {
            ...fixture.submissionRecord,
            reservationSha256:
              "f".repeat(
                64,
              ),
          },
        );

        const spies =
          recoverySpies();

        await expect(
          reconcile(
            fixture.mediaRoot,
            spies.dependencies,
          ),
        ).rejects.toThrow();

        expect(
          spies.replayInteraction,
        ).not.toHaveBeenCalled();

        expect(
          spies.prepareUri,
        ).not.toHaveBeenCalled();

        expect(
          spies.downloadUri,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "L derives Attempt-2 authority only from Attempt-2 evidence even when legacy and Attempt-3 lifecycle files are corrupt",
      async () => {
        const fixture =
          await makeFixture(
            "SUBMITTED",
          );

        const unrelatedPaths = [
          createExecutionReservationPath(
            fixture.mediaRoot,
            EPISODE_ID,
            SHOT_ID,
          ),
          createExecutionSubmissionPath(
            fixture.mediaRoot,
            EPISODE_ID,
            SHOT_ID,
          ),
          createExecutionCompletionPath(
            fixture.mediaRoot,
            EPISODE_ID,
            SHOT_ID,
          ),
          createVisualAttemptExecutionReservationPath(
            fixture.mediaRoot,
            EPISODE_ID,
            SHOT_ID,
            3,
          ),
          createVisualAttemptExecutionSubmissionPath(
            fixture.mediaRoot,
            EPISODE_ID,
            SHOT_ID,
            3,
          ),
        ];

        const unrelatedSentinel =
          "{corrupt-unrelated-evidence\n";

        for (
          const path of unrelatedPaths
        ) {
          await writeRaw(
            path,
            unrelatedSentinel,
          );
        }

        const spies =
          recoverySpies();

        const result =
          await reconcile(
            fixture.mediaRoot,
            spies.dependencies,
          );

        expect(
          result.verification.attemptNumber,
        ).toBe(
          ATTEMPT_NUMBER,
        );

        expect(
          result.verification.providerExecutionId,
        ).toBe(
          PROVIDER_EXECUTION_ID,
        );

        expect(
          spies.replayInteraction,
        ).toHaveBeenCalledTimes(
          1,
        );

        for (
          const path of unrelatedPaths
        ) {
          expect(
            await readFile(
              path,
              "utf8",
            ),
          ).toBe(
            unrelatedSentinel,
          );
        }
      },
    );

    it(
      "M1 preserves the legacy reconciliation invocation budget and rejects expiry before replay",
      async () => {
        const fixture =
          await makeFixture(
            "SUBMITTED",
          );

        let monotonicCalls =
          0;

        const spies =
          recoverySpies(
            "completed",
            {
              monotonicNowMs: () => {
                const value =
                  monotonicCalls === 0
                    ? 0
                    : TRANSPORT_POLICY.timeouts
                        .reconciliationAttemptTimeoutMs;

                monotonicCalls +=
                  1;

                return value;
              },
            },
          );

        const before =
          await snapshotTree(
            fixture.mediaRoot,
          );

        await expect(
          reconcile(
            fixture.mediaRoot,
            spies.dependencies,
          ),
        ).rejects.toMatchObject({
          code: "RECONCILIATION_TIMEOUT",
        });

        expect(
          spies.replayInteraction,
        ).not.toHaveBeenCalled();

        expect(
          await snapshotTree(
            fixture.mediaRoot,
          ),
        ).toStrictEqual(
          before,
        );
      },
    );

    it(
      "M preserves the legacy recovery horizon and rejects an expired SUBMITTED attempt before replay",
      async () => {
        const fixture =
          await makeFixture(
            "SUBMITTED",
          );

        const spies =
          recoverySpies(
            "completed",
            {
              nowMs: () =>
                SUBMITTED_AT_MS +
                TRANSPORT_POLICY.recovery
                  .automatedRemoteRecoveryHorizonMs,
            },
          );

        const before =
          await snapshotTree(
            fixture.mediaRoot,
          );

        await expect(
          reconcile(
            fixture.mediaRoot,
            spies.dependencies,
          ),
        ).rejects.toMatchObject({
          code: "RECOVERY_HORIZON_EXCEEDED",
        });

        expect(
          spies.replayInteraction,
        ).not.toHaveBeenCalled();

        expect(
          await snapshotTree(
            fixture.mediaRoot,
          ),
        ).toStrictEqual(
          before,
        );
      },
    );
  },
);
