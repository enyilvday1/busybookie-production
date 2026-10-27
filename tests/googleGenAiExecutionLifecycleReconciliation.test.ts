import {
  createHash,
} from "node:crypto";

import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  basename,
  join,
  relative,
} from "node:path";

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createExecutionReservation,
} from "../src/execution/createExecutionReservation.js";

import {
  createExecutionSubmission,
} from "../src/execution/createExecutionSubmission.js";

import {
  createExecutionCompletionPath,
} from "../src/execution/executionCompletionPath.js";

import {
  createExecutionSubmissionPath,
} from "../src/execution/executionSubmissionPath.js";

import {
  inspectExecutionLifecycle,
} from "../src/execution/inspectExecutionLifecycle.js";

import {
  materializeGoogleGenAiSingleShotOutput,
  type GoogleGenAiOutputFileSystem,
  type GoogleGenAiOutputRetriever,
  type GoogleGenAiOutputUriDownloader,
} from "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js";

import {
  persistGoogleGenAiSingleShotCompletion,
  type GoogleGenAiCompletionFileSystem,
} from "../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js";

import {
  recoverGoogleGenAiSingleShot,
} from "../src/execution/providers/recoverGoogleGenAiSingleShot.js";

import {
  GOOGLE_GENAI_ACTIVATION_LIMITS,
} from "../src/googleGenai/googleGenAiActivationLimits.js";

import type {
  GoogleGenAiInteractionReplayResult,
  GoogleGenAiPrepareOutputUri,
  GoogleGenAiRecoveryContext,
  GoogleGenAiReplayInteraction,
  GoogleGenAiSecureOutputTransportPolicy,
  GoogleGenAiVerifiedFileMetadata,
} from "../src/googleGenai/transport/googleGenAiSecureOutputTransport.types.js";

import {
  GoogleGenAiSecureOutputTransportError,
} from "../src/googleGenai/transport/googleGenAiSecureOutputTransportError.js";

// Pass-through wrappers: behavior is unchanged; tests inspect the exact
// local adapters and context the reconciler hands downstream.
vi.mock(
  "../src/execution/providers/recoverGoogleGenAiSingleShot.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<typeof import("../src/execution/providers/recoverGoogleGenAiSingleShot.js")>();

    return {
      ...actual,
      recoverGoogleGenAiSingleShot: vi.fn(actual.recoverGoogleGenAiSingleShot),
    };
  },
);

vi.mock(
  "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<typeof import("../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js")>();

    return {
      ...actual,
      materializeGoogleGenAiSingleShotOutput: vi.fn(actual.materializeGoogleGenAiSingleShotOutput),
    };
  },
);

vi.mock(
  "../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<typeof import("../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js")>();

    return {
      ...actual,
      persistGoogleGenAiSingleShotCompletion: vi.fn(actual.persistGoogleGenAiSingleShotCompletion),
    };
  },
);

import {
  reconcileGoogleGenAiExecutionLifecycle,
  type GoogleGenAiExecutionLifecycleReconciliationResult,
  type GoogleGenAiSubmittedRecoveryDependencies,
} from "../src/execution/reconcileGoogleGenAiExecutionLifecycle.js";

import type {
  ExecutionLifecycleReconciliationResult,
} from "../src/execution/reconcileExecutionLifecycle.js";

import {
  verifyGoogleGenAiDurableCompletion,
} from "../src/execution/verifyGoogleGenAiDurableCompletion.js";

import {
  createGoogleGenAiGenerationRecordPath,
} from "../src/googleGenai/audit/googleGenAiGenerationRecordPath.js";

import {
  createGoogleGenAiVideoOutputPath,
} from "../src/googleGenai/output/googleGenAiVideoOutputPath.js";

import type {
  GoogleGenAiPolicy,
} from "../src/schemas/googleGenAiPolicy.schema.js";

import {
  loadGoogleGenAiPolicy,
} from "../src/validation/loadGoogleGenAiPolicy.js";

const RECONCILER_SOURCE =
  "src/execution/reconcileGoogleGenAiExecutionLifecycle.ts";

const INTERACTION_ID =
  "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";

const RESERVATION_ID =
  "11111111-1111-4111-8111-111111111111";

const MAX_OUTPUT_BYTES =
  4096;

const TRANSPORT_POLICY:
  GoogleGenAiSecureOutputTransportPolicy =
  GOOGLE_GENAI_ACTIVATION_LIMITS;

const OUTPUT_URI =
  "https://generativelanguage.googleapis.com/v1beta/files/recon-123:download?alt=media";

// The durable submission fixture is written with submittedAt 12:01:00Z.
const SUBMITTED_AT_MS =
  Date.UTC(2026, 9, 24, 12, 1);

const HORIZON_MS =
  86_400_000;

const BUDGET_MS =
  1_200_000;

const temporaryDirectories:
  string[] = [];

let policySnapshot:
  GoogleGenAiPolicy;

beforeAll(
  async () => {
    policySnapshot =
      await loadGoogleGenAiPolicy();
  },
);

afterEach(
  async () => {
    vi.useRealTimers();

    vi.mocked(
      recoverGoogleGenAiSingleShot,
    ).mockClear();

    vi.mocked(
      materializeGoogleGenAiSingleShotOutput,
    ).mockClear();

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

function makeMp4(
  label:
    string =
      "busybookie-google-reconciliation-output",
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

async function makeMediaRoot():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-google-genai-reconciliation-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

async function reserve(
  mediaRoot:
    string,
  provider:
    "GOOGLE_GENAI" | "RUNWAY" =
      "GOOGLE_GENAI",
): Promise<void> {
  await createExecutionReservation(
    mediaRoot,
    {
      episodeId:
        "EP92",

      shotId:
        "S01",

      provider,
    },
    {
      now: () =>
        "2026-10-24T12:00:00.000Z",

      createReservationId: () =>
        RESERVATION_ID,
    },
  );
}

async function submittedShot():
Promise<string> {
  const mediaRoot =
    await makeMediaRoot();

  await reserve(
    mediaRoot,
  );

  await createExecutionSubmission(
    mediaRoot,
    {
      reservationId:
        RESERVATION_ID,

      episodeId:
        "EP92",

      shotId:
        "S01",

      provider:
        "GOOGLE_GENAI",

      providerExecutionId:
        INTERACTION_ID,

      recoveryMetadata: {
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
            "Busybookie Google reconciliation test.",

          sourceImagePath:
            join(
              mediaRoot,
              "references",
              "EP92",
              "S01",
              "reference.png",
            ),
        },

        policySnapshot,
      },
    },
    {
      now: () =>
        "2026-10-24T12:01:00.000Z",
    },
  );

  return mediaRoot;
}

function inlineRetriever(
  bytes:
    Buffer =
      OUTPUT_BYTES,
) {
  return vi.fn<GoogleGenAiOutputRetriever>(
    async (providerExecutionId) => ({
      id:
        providerExecutionId,

      status:
        "completed",

      outputVideo: {
        type:
          "video",

        mime_type:
          "video/mp4",

        data:
          bytes.toString(
            "base64",
          ),
      },
    }),
  );
}

function sha256Hex(
  bytes:
    Uint8Array,
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

/** Frozen replay observation in the exact B4V3 result shape. */
function replayObservation(
  providerExecutionId:
    string,
  status:
    unknown,
): GoogleGenAiInteractionReplayResult {
  return Object.freeze({
    id:
      providerExecutionId,

    status,

    outputVideo:
      status === "completed"
        ? Object.freeze({
            type:
              "video",

            mime_type:
              "video/mp4",

            uri:
              OUTPUT_URI,
          })
        : null,
  }) as GoogleGenAiInteractionReplayResult;
}

function replayer(
  status:
    unknown,
) {
  return vi.fn<GoogleGenAiReplayInteraction>(
    async (providerExecutionId) =>
      replayObservation(
        providerExecutionId,
        status,
      ),
  );
}

function metadataFor(
  bytes:
    Uint8Array =
      OUTPUT_BYTES,
): GoogleGenAiVerifiedFileMetadata {
  return Object.freeze({
    resource:
      Object.freeze({
        fileId:
          "recon-123",

        name:
          "files/recon-123",

        downloadUri:
          OUTPUT_URI,
      }),

    byteCount:
      bytes.byteLength,

    sha256:
      sha256Hex(
        bytes,
      ),

    mimeType:
      "video/mp4",

    expirationTime:
      "2026-10-26T12:00:00Z",

    expirationTimeMs:
      Date.UTC(2026, 9, 26, 12),
  });
}

function preparer(
  bytes:
    Uint8Array =
      OUTPUT_BYTES,
) {
  return vi.fn<GoogleGenAiPrepareOutputUri>(
    async () =>
      metadataFor(
        bytes,
      ),
  );
}

/** Streams bytes through the materializer sink in ordered 9-byte chunks. */
function streamingDownloader(
  bytes:
    Uint8Array =
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
        byteCount:
          bytes.byteLength,

        sha256:
          sha256Hex(
            bytes,
          ),

        mimeType:
          "video/mp4" as const,
      });
    },
  );
}

function transport(
  code:
    GoogleGenAiSecureOutputTransportError["code"],
  httpStatus?:
    number,
) {
  return new GoogleGenAiSecureOutputTransportError(
    code,
    httpStatus === undefined
      ? {}
      : {
          httpStatus,
        },
  );
}

async function settle<T>(
  promise:
    Promise<T>,
): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

/**
 * Condition-driven: yields with real setImmediate (only setTimeout and
 * clearTimeout are faked) until the condition holds. Real filesystem
 * completion is not bounded by any event-loop turn count; the existing
 * Vitest test timeout remains the only outer bound.
 */
async function turnsUntil(
  condition:
    () => boolean,
): Promise<void> {
  while (!condition()) {
    await new Promise(
      (resolve) =>
        setImmediate(
          resolve,
        ),
    );
  }

  expect(
    condition(),
  ).toBe(
    true,
  );
}

function unusedDownloader() {
  return vi.fn<GoogleGenAiOutputUriDownloader>(
    async () => {
      throw new Error(
        "URI downloader must not be called.",
      );
    },
  );
}

async function persistExternally(
  mediaRoot:
    string,
  bytes:
    Buffer =
      OUTPUT_BYTES,
): Promise<void> {
  const materializedOutput =
    await materializeGoogleGenAiSingleShotOutput(
      {
        mediaRoot,

        episodeId:
          "EP92",

        shotId:
          "S01",

        maxOutputBytes:
          MAX_OUTPUT_BYTES,
      },
      {
        retrieveOutput:
          inlineRetriever(
            bytes,
          ),

        downloadUri:
          unusedDownloader(),
      },
    );

  await persistGoogleGenAiSingleShotCompletion(
    {
      mediaRoot,

      episodeId:
        "EP92",

      shotId:
        "S01",

      materializedOutput,
    },
    {
      now: () =>
        "2026-10-24T12:05:00.000Z",
    },
  );
}

async function completedShot():
Promise<string> {
  const mediaRoot =
    await submittedShot();

  await persistExternally(
    mediaRoot,
  );

  return mediaRoot;
}

type RecoverySpies =
  Readonly<{
    dependencies:
      GoogleGenAiSubmittedRecoveryDependencies;

    replayInteraction:
      ReturnType<typeof replayer>;

    prepareUri:
      ReturnType<typeof preparer>;

    downloadUri:
      ReturnType<typeof streamingDownloader>;
  }>;

function recoverySpies(
  overrides:
    Partial<GoogleGenAiSubmittedRecoveryDependencies> =
      {},
  status:
    unknown =
      "completed",
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

      policy:
        TRANSPORT_POLICY,

      // Wall clock 19 minutes after submittedAt; monotonic time frozen.
      nowMs: () =>
        SUBMITTED_AT_MS +
        19 * 60_000,

      monotonicNowMs: () =>
        0,

      now: () =>
        "2026-10-24T12:20:00.000Z",

      ...overrides,
    },

    replayInteraction,
    prepareUri,
    downloadUri,
  };
}

function reconcile(
  mediaRoot:
    string,
  submittedRecovery?:
    GoogleGenAiSubmittedRecoveryDependencies,
): Promise<GoogleGenAiExecutionLifecycleReconciliationResult> {
  return reconcileGoogleGenAiExecutionLifecycle(
    {
      mediaRoot,

      episodeId:
        "EP92",

      shotId:
        "S01",
    },
    submittedRecovery === undefined
      ? {}
      : {
          submittedRecovery,
        },
  );
}

function recordPath(
  mediaRoot:
    string,
): string {
  return createGoogleGenAiGenerationRecordPath(
    mediaRoot,
    "EP92",
    "S01",
    INTERACTION_ID,
  );
}

function outputPath(
  mediaRoot:
    string,
): string {
  return createGoogleGenAiVideoOutputPath(
    mediaRoot,
    "EP92",
    "S01",
    INTERACTION_ID,
  );
}

function completionPath(
  mediaRoot:
    string,
): string {
  return createExecutionCompletionPath(
    mediaRoot,
    "EP92",
    "S01",
  );
}

async function exists(
  path:
    string,
): Promise<boolean> {
  try {
    await stat(
      path,
    );

    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code ===
        "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}

async function snapshot(
  root:
    string,
): Promise<Record<string, string>> {
  const result:
    Record<string, string> = {};

  for (
    const entry of await readdir(
      root,
      {
        recursive:
          true,

        withFileTypes:
          true,
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
        ? createHash(
            "sha256",
          )
            .update(
              await readFile(
                absolute,
              ),
            )
            .digest(
              "hex",
            )
        : "dir";
  }

  return result;
}

async function readJsonObject(
  path:
    string,
): Promise<Record<string, unknown>> {
  const parsed:
    unknown =
    JSON.parse(
      await readFile(
        path,
        "utf8",
      ),
    );

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "Expected a JSON object.",
    );
  }

  return Object.fromEntries(
    Object.entries(
      parsed,
    ),
  );
}

function linkHookFileSystem(
  onLinked:
    (
      finalPath: string,
    ) => Promise<void>,
): GoogleGenAiCompletionFileSystem {
  return {
    mkdir:
      (
        path,
        options,
      ) =>
        mkdir(
          path,
          options,
        ),

    open:
      async (
        path,
        flags,
      ) => {
        const handle =
          await open(
            path,
            flags,
          );

        return {
          writeFile:
            (data) =>
              handle.writeFile(
                data,
              ),

          sync:
            () =>
              handle.sync(),

          close:
            () =>
              handle.close(),
        };
      },

    link:
      async (
        existingPath,
        newPath,
      ) => {
        await link(
          existingPath,
          newPath,
        );

        await onLinked(
          newPath,
        );
      },

    unlink:
      (path) =>
        unlink(
          path,
        ),
  };
}

type GoogleResultAssignableToSharedResult =
  GoogleGenAiExecutionLifecycleReconciliationResult extends ExecutionLifecycleReconciliationResult
    ? true
    : false;

describe(
  "Busybookie dormant Google GenAI lifecycle reconciliation",
  () => {
    describe(
      "COMPLETED verification only",
      () => {
        it(
          "C44 never repairs beneath an existing completion when its generation record is missing",
          async () => {
            const mediaRoot =
              await completedShot();

            await unlink(
              recordPath(
                mediaRoot,
              ),
            );

            const spies =
              recoverySpies();

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toThrow(
              /generation record is missing for a durable completion/,
            );

            expect(
              await exists(
                recordPath(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );

            expect(
              spies.replayInteraction,
            ).not.toHaveBeenCalled();

            expect(
              spies.prepareUri,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "C45/C46/C47/E72/E73/E75/E76 returns DURABLE_COMPLETION with zero provider calls, zero materialization, and zero writes",
          async () => {
            const mediaRoot =
              await completedShot();

            const spies =
              recoverySpies();

            const before =
              await snapshot(
                mediaRoot,
              );

            const result =
              await reconcile(
                mediaRoot,
                spies.dependencies,
              );

            const verification =
              await verifyGoogleGenAiDurableCompletion(
                mediaRoot,
                "EP92",
                "S01",
              );

            expect(
              result,
            ).toStrictEqual({
              lifecycleState:
                "COMPLETED",

              reconciliationMode:
                "DURABLE_COMPLETION",

              provider:
                "GOOGLE_GENAI",

              providerExecutionId:
                INTERACTION_ID,

              generationRecord:
                verification.generationRecord,

              generationRecordPath:
                recordPath(
                  mediaRoot,
                ),

              completion:
                verification.completion,

              completionPath:
                completionPath(
                  mediaRoot,
                ),
            });

            expect(
              Object.isFrozen(
                result,
              ),
            ).toBe(
              true,
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
              await snapshot(
                mediaRoot,
              ),
            ).toStrictEqual(
              before,
            );
          },
        );

        it(
          "verifies a durable completion offline with no recovery dependencies at all",
          async () => {
            const mediaRoot =
              await completedShot();

            const result =
              await reconcile(
                mediaRoot,
              );

            expect(
              result.reconciliationMode,
            ).toBe(
              "DURABLE_COMPLETION",
            );
          },
        );

        it(
          "E74 keeps the Google result type outside the shared reconciliation result union at compile time",
          () => {
            const proof:
              GoogleResultAssignableToSharedResult =
              false;

            expect(
              proof,
            ).toBe(
              false,
            );
          },
        );
      },
    );

    describe(
      "state and dependency guards",
      () => {
        it(
          "throws for RESERVED_ONLY without contacting the provider",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await reserve(
              mediaRoot,
            );

            const spies =
              recoverySpies();

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toThrow(
              "Google GenAI lifecycle reconciliation requires SUBMITTED or COMPLETED state; received RESERVED_ONLY.",
            );

            expect(
              spies.replayInteraction,
            ).not.toHaveBeenCalled();
          },
        );

        it.each([
          ["missing submittedRecovery", undefined],
          ["legacy maxOutputBytes field", { maxOutputBytes: MAX_OUTPUT_BYTES }],
          ["legacy getInteraction field", { getInteraction: async () => ({ id: INTERACTION_ID, status: "completed" }) }],
          ["legacy retrieveOutput field", { retrieveOutput: inlineRetriever() }],
          ["missing replayInteraction", { replayInteraction: undefined }],
          ["missing prepareUri", { prepareUri: undefined }],
          ["missing downloadUri", { downloadUri: undefined }],
          ["missing policy", { policy: undefined }],
          ["zero invocation budget", { policy: { ...TRANSPORT_POLICY, timeouts: { ...TRANSPORT_POLICY.timeouts, reconciliationAttemptTimeoutMs: 0 } } }],
          ["fractional recovery horizon", { policy: { ...TRANSPORT_POLICY, recovery: { ...TRANSPORT_POLICY.recovery, automatedRemoteRecoveryHorizonMs: 1.5 } } }],
          ["missing output maximum", { policy: { ...TRANSPORT_POLICY, limits: { ...TRANSPORT_POLICY.limits, maxOutputBytes: undefined } } }],
          ["non-function wall clock", { nowMs: 5 }],
          ["non-function monotonic clock", { monotonicNowMs: "0" }],
        ])(
          "throws SECURE_TRANSPORT_CONFIGURATION_INVALID before any replay for SUBMITTED with %s",
          async (
            _label,
            overrides,
          ) => {
            const mediaRoot =
              await submittedShot();

            const spies =
              recoverySpies(
                (overrides ?? {}) as Partial<GoogleGenAiSubmittedRecoveryDependencies>,
              );

            const before =
              await snapshot(
                mediaRoot,
              );

            await expect(
              reconcile(
                mediaRoot,
                overrides === undefined
                  ? undefined
                  : spies.dependencies,
              ),
            ).rejects.toMatchObject({
              code:
                "SECURE_TRANSPORT_CONFIGURATION_INVALID",
            });

            expect(
              spies.replayInteraction,
            ).not.toHaveBeenCalled();

            expect(
              spies.prepareUri,
            ).not.toHaveBeenCalled();

            expect(
              await snapshot(
                mediaRoot,
              ),
            ).toStrictEqual(
              before,
            );
          },
        );

        it(
          "refuses the superseded split dependency object at runtime without any fallback",
          async () => {
            const mediaRoot =
              await submittedShot();

            const getInteraction =
              vi.fn(
                async () => ({
                  id:
                    INTERACTION_ID,

                  status:
                    "completed",
                }),
              );

            const untypedCaller: {
              reconcile(
                input:
                  unknown,
                dependencies:
                  unknown,
              ): Promise<unknown>;
            } = {
              reconcile:
                reconcileGoogleGenAiExecutionLifecycle,
            };

            await expect(
              untypedCaller.reconcile(
                {
                  mediaRoot,

                  episodeId:
                    "EP92",

                  shotId:
                    "S01",
                },
                {
                  submittedRecovery: {
                    getInteraction,

                    retrieveOutput:
                      inlineRetriever(),

                    downloadUri:
                      unusedDownloader(),

                    maxOutputBytes:
                      MAX_OUTPUT_BYTES,
                  },
                },
              ),
            ).rejects.toMatchObject({
              code:
                "SECURE_TRANSPORT_CONFIGURATION_INVALID",
            });

            expect(
              getInteraction,
            ).not.toHaveBeenCalled();
          },
        );

        it.each([
          "providerExecutionId",
          "interactionId",
          "provider",
          "reservationId",
          "generationRecordPath",
          "outputPath",
        ])(
          "rejects a caller-supplied %s before reading anything",
          async (field) => {
            const mediaRoot =
              await submittedShot();

            const spies =
              recoverySpies();

            await expect(
              reconcileGoogleGenAiExecutionLifecycle(
                {
                  mediaRoot,

                  episodeId:
                    "EP92",

                  shotId:
                    "S01",

                  [field]:
                    "caller-override",
                },
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

        it(
          "F82 refuses a non-Google lifecycle without contacting any provider",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await reserve(
              mediaRoot,
              "RUNWAY",
            );

            const spies =
              recoverySpies();

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toThrow(
              /requires a GOOGLE_GENAI reservation; received RUNWAY/,
            );

            expect(
              spies.replayInteraction,
            ).not.toHaveBeenCalled();
          },
        );
      },
    );

    describe(
      "SUBMITTED remote status handling",
      () => {
        it.each([
          "queued",
          "in_progress",
        ])(
          "D50/D51 %s throws the exact pending error after exactly one GET with no materialization or writes",
          async (status) => {
            const mediaRoot =
              await submittedShot();

            const spies =
              recoverySpies(
                {},
                status,
              );

            const before =
              await snapshot(
                mediaRoot,
              );

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toThrow(
              `Google GenAI interaction ${INTERACTION_ID} is still pending (remote status ${status}). No durable completion exists yet; reconcile again later. Do not resubmit automatically.`,
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
              await snapshot(
                mediaRoot,
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
          "D52-D55 %s throws the exact terminal error after exactly one GET with no writes",
          async (status) => {
            const mediaRoot =
              await submittedShot();

            const spies =
              recoverySpies(
                {},
                status,
              );

            const before =
              await snapshot(
                mediaRoot,
              );

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toThrow(
              `Google GenAI interaction ${INTERACTION_ID} ended without a materializable result (remote status ${status}). No completion was recorded. Do not resubmit automatically; operator review is required.`,
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
              await snapshot(
                mediaRoot,
              ),
            ).toStrictEqual(
              before,
            );
          },
        );

        it(
          "D56 requires_action fails closed as unsupported",
          async () => {
            const mediaRoot =
              await submittedShot();

            const spies =
              recoverySpies(
                {},
                "requires_action",
              );

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toThrow(
              /requires client action, which Busybookie does not support/,
            );

            expect(
              spies.prepareUri,
            ).not.toHaveBeenCalled();
          },
        );

        it.each([
          [
            "D57 unknown string",
            "succeeded",
            /not recognized/,
          ],
          [
            "D58 blank",
            "",
            /not recognized/,
          ],
          [
            "D58 non-string",
            7,
            /must be a string/,
          ],
        ])(
          "%s status fails closed",
          async (
            _label,
            status,
            message,
          ) => {
            const mediaRoot =
              await submittedShot();

            const spies =
              recoverySpies(
                {},
                status,
              );

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toThrow(
              message,
            );

            expect(
              spies.prepareUri,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "D59 propagates a closed replay error as a fresh instance with its exact semantics and no downstream work",
          async () => {
            const mediaRoot =
              await submittedShot();

            const failure =
              transport(
                "SSE_HTTP_FAILED",
                503,
              );

            const spies =
              recoverySpies({
                replayInteraction:
                  vi.fn<GoogleGenAiReplayInteraction>(
                    async () => {
                      throw failure;
                    },
                  ),
              });

            const outward =
              await settle(
                reconcile(
                  mediaRoot,
                  spies.dependencies,
                ),
              );

            // Never by identity; the closed semantics survive unchanged.
            expect(
              outward,
            ).not.toBe(
              failure,
            );

            expect(
              Object.getPrototypeOf(
                outward,
              ),
            ).toBe(
              GoogleGenAiSecureOutputTransportError.prototype,
            );

            expect(
              outward,
            ).toMatchObject({
              code:
                "SSE_HTTP_FAILED",

              httpStatus:
                503,

              retryable:
                true,
            });

            expect(
              spies.prepareUri,
            ).not.toHaveBeenCalled();
          },
        );
      },
    );

    describe(
      "SUBMITTED success pipeline",
      () => {
        it(
          "D48/D49/D60/D69/D71 recovers from exactly one replay observation, streams the output once and returns the freshly verified RECOVERED_SUBMISSION",
          async () => {
            const mediaRoot =
              await submittedShot();

            const spies =
              recoverySpies();

            const result =
              await reconcile(
                mediaRoot,
                spies.dependencies,
              );

            expect(
              spies.replayInteraction,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              spies.replayInteraction.mock.calls[0]?.[0],
            ).toBe(
              INTERACTION_ID,
            );

            expect(
              spies.prepareUri,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              spies.prepareUri.mock.calls[0]?.[0],
            ).toStrictEqual({
              uri:
                OUTPUT_URI,

              maxOutputBytes:
                TRANSPORT_POLICY.limits.maxOutputBytes,
            });

            expect(
              spies.downloadUri,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              (
                await readFile(
                  outputPath(
                    mediaRoot,
                  ),
                )
              ).equals(
                OUTPUT_BYTES,
              ),
            ).toBe(
              true,
            );

            const verification =
              await verifyGoogleGenAiDurableCompletion(
                mediaRoot,
                "EP92",
                "S01",
              );

            expect(
              result,
            ).toStrictEqual({
              lifecycleState:
                "COMPLETED",

              reconciliationMode:
                "RECOVERED_SUBMISSION",

              remoteStatus:
                "completed",

              provider:
                "GOOGLE_GENAI",

              providerExecutionId:
                INTERACTION_ID,

              generationRecord:
                verification.generationRecord,

              generationRecordPath:
                recordPath(
                  mediaRoot,
                ),

              completion:
                verification.completion,

              completionPath:
                completionPath(
                  mediaRoot,
                ),
            });

            expect(
              result.completion
                .completedAt,
            ).toBe(
              "2026-10-24T12:20:00.000Z",
            );
          },
        );

        it(
          "D61/D67 a materialization failure writes no generation record or completion",
          async () => {
            const mediaRoot =
              await submittedShot();

            const invalid =
              Buffer.from(
                "not an mp4 payload at all",
                "utf8",
              );

            const spies =
              recoverySpies({
                prepareUri:
                  preparer(
                    invalid,
                  ),

                downloadUri:
                  streamingDownloader(
                    invalid,
                  ),
              });

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toMatchObject({
              code:
                "DOWNLOAD_MP4_INVALID",
            });

            expect(
              await exists(
                recordPath(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );

            expect(
              await exists(
                completionPath(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );

            expect(
              await exists(
                outputPath(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "D62 propagates a metadata preparation error as a fresh sanitized instance with no download or completion",
          async () => {
            const mediaRoot =
              await submittedShot();

            const failure =
              transport(
                "FILE_NOT_ACTIVE",
              );

            // A genuine frozen base instance whose stack accessor accepts
            // hostile dependency-owned content.
            (failure as { stack?: string }).stack =
              `RAW_PROVIDER_SECRET ${OUTPUT_URI}&token=RAW_PROVIDER_SECRET`;

            expect(
              failure.stack,
            ).toContain(
              "RAW_PROVIDER_SECRET",
            );

            const spies =
              recoverySpies({
                prepareUri:
                  vi.fn<GoogleGenAiPrepareOutputUri>(
                    async () => {
                      throw failure;
                    },
                  ),
              });

            const outward =
              await settle(
                reconcile(
                  mediaRoot,
                  spies.dependencies,
                ),
              );

            // Dependency-owned identity never crosses the materializer boundary.
            expect(
              outward,
            ).not.toBe(
              failure,
            );

            expect(
              Object.getPrototypeOf(
                outward,
              ),
            ).toBe(
              GoogleGenAiSecureOutputTransportError.prototype,
            );

            expect(
              outward,
            ).toMatchObject({
              code:
                "FILE_NOT_ACTIVE",

              retryable:
                false,
            });

            expect(
              String(outward) +
                (outward as Error).stack +
                JSON.stringify(outward),
            ).not.toMatch(
              /RAW_PROVIDER_SECRET|recon-123/,
            );

            expect(
              Object.hasOwn(
                outward as object,
                "cause",
              ),
            ).toBe(
              false,
            );

            expect(
              spies.downloadUri,
            ).not.toHaveBeenCalled();

            expect(
              await exists(
                completionPath(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "D63 bounds materialization by the policy output maximum",
          async () => {
            const mediaRoot =
              await submittedShot();

            const spies =
              recoverySpies({
                policy: {
                  ...TRANSPORT_POLICY,

                  limits: {
                    ...TRANSPORT_POLICY.limits,

                    maxOutputBytes:
                      OUTPUT_BYTES.byteLength -
                      1,
                  },
                },
              });

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toMatchObject({
              code:
                "FILE_TOO_LARGE",
            });

            expect(
              spies.prepareUri.mock.calls[0]?.[0],
            ).toStrictEqual({
              uri:
                OUTPUT_URI,

              maxOutputBytes:
                OUTPUT_BYTES.byteLength -
                1,
            });

            expect(
              spies.downloadUri,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "D64 forwards the injected streaming downloader exactly once with the prepared metadata and shared context",
          async () => {
            const mediaRoot =
              await submittedShot();

            const spies =
              recoverySpies();

            const result =
              await reconcile(
                mediaRoot,
                spies.dependencies,
              );

            expect(
              result.reconciliationMode,
            ).toBe(
              "RECOVERED_SUBMISSION",
            );

            expect(
              spies.downloadUri,
            ).toHaveBeenCalledTimes(
              1,
            );

            const [
              metadata,
              sink,
              context,
            ] =
              spies.downloadUri.mock.calls[0]!;

            expect(
              metadata,
            ).toBe(
              await spies.prepareUri.mock.results[0]!.value,
            );

            expect(
              typeof sink.writeChunk,
            ).toBe(
              "function",
            );

            expect(
              context,
            ).toBe(
              spies.replayInteraction.mock.calls[0]?.[1],
            );

            expect(
              context,
            ).toBe(
              spies.prepareUri.mock.calls[0]?.[1],
            );
          },
        );

        it(
          "D68 fails closed on a persistence conflict with a pre-existing generation record",
          async () => {
            const mediaRoot =
              await submittedShot();

            const conflicting =
              JSON.stringify({
                schemaVersion:
                  "1.0",

                recordedAt:
                  "2026-10-24T12:02:00.000Z",

                reservationId:
                  RESERVATION_ID,

                provider:
                  "GOOGLE_GENAI",

                episodeId:
                  "EP92",

                shotId:
                  "S01",

                providerExecutionId:
                  INTERACTION_ID,

                outputs: [
                  {
                    outputIndex:
                      1,

                    destinationPath:
                      outputPath(
                        mediaRoot,
                      ),

                    bytes:
                      OUTPUT_BYTES.byteLength,

                    sha256:
                      "b".repeat(
                        64,
                      ),

                    contentType:
                      "video/mp4",
                  },
                ],
              });

            await writeFile(
              recordPath(
                mediaRoot,
              ),
              conflicting,
              "utf8",
            );

            const spies =
              recoverySpies();

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toThrow(
              /does not match the verified output evidence/,
            );

            expect(
              await readFile(
                recordPath(
                  mediaRoot,
                ),
                "utf8",
              ),
            ).toBe(
              conflicting,
            );

            expect(
              await exists(
                completionPath(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "D70 a failed fresh verification after persistence prevents RECOVERED_SUBMISSION",
          async () => {
            const mediaRoot =
              await submittedShot();

            const completionName =
              basename(
                completionPath(
                  mediaRoot,
                ),
              );

            const spies =
              recoverySpies({
                completionFileSystem:
                  linkHookFileSystem(
                    async (finalPath) => {
                      if (
                        basename(
                          finalPath,
                        ) ===
                        completionName
                      ) {
                        const corrupted =
                          Buffer.from(
                            OUTPUT_BYTES,
                          );

                        corrupted[0] =
                          (corrupted[0] ?? 0) ^ 0x01;

                        await unlink(
                          outputPath(
                            mediaRoot,
                          ),
                        );

                        await writeFile(
                          outputPath(
                            mediaRoot,
                          ),
                          corrupted,
                        );
                      }
                    },
                  ),
              });

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toThrow(
              /durable output SHA-256 [0-9a-f]{64} does not match generation record/,
            );

            expect(
              await exists(
                completionPath(
                  mediaRoot,
                ),
              ),
            ).toBe(
              true,
            );
          },
        );
      },
    );

    describe(
      "concurrency and races",
      () => {
        it(
          "F77/F78 concurrent identical recoveries converge and both return the verified durable winner",
          async () => {
            const mediaRoot =
              await submittedShot();

            const first =
              recoverySpies();

            const second =
              recoverySpies();

            const results =
              await Promise.all([
                reconcile(
                  mediaRoot,
                  first.dependencies,
                ),
                reconcile(
                  mediaRoot,
                  second.dependencies,
                ),
              ]);

            expect(
              results[0],
            ).toStrictEqual(
              results[1],
            );

            expect(
              results[0]
                ?.reconciliationMode,
            ).toBe(
              "RECOVERED_SUBMISSION",
            );

            expect(
              (
                await readdir(
                  join(
                    mediaRoot,
                    "generated-video",
                    "EP92",
                    "S01",
                  ),
                )
              ).filter(
                (entry) =>
                  entry.endsWith(
                    ".part",
                  ),
              ),
            ).toEqual(
              [],
            );
          },
        );

        it(
          "F79/F80 a conflicting concurrent generation-record winner fails closed and is never overwritten",
          async () => {
            const mediaRoot =
              await submittedShot();

            const recordName =
              basename(
                recordPath(
                  mediaRoot,
                ),
              );

            let competitor =
              "";

            const spies =
              recoverySpies({
                completionFileSystem: {
                  ...linkHookFileSystem(
                    async () => {},
                  ),

                  link:
                    async (
                      existingPath,
                      newPath,
                    ) => {
                      if (
                        basename(
                          newPath,
                        ) ===
                        recordName
                      ) {
                        const candidate =
                          await readJsonObject(
                            existingPath,
                          );

                        competitor =
                          JSON.stringify({
                            ...candidate,

                            reservationId:
                              "66666666-6666-4666-8666-666666666666",
                          });

                        await writeFile(
                          newPath,
                          competitor,
                          "utf8",
                        );
                      }

                      await link(
                        existingPath,
                        newPath,
                      );
                    },
                },
              });

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toThrow(
              /does not match the verified output evidence/,
            );

            expect(
              await readFile(
                recordPath(
                  mediaRoot,
                ),
                "utf8",
              ),
            ).toBe(
              competitor,
            );

            expect(
              await exists(
                completionPath(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "G83 a matching completion published after inspection still converges",
          async () => {
            const mediaRoot =
              await submittedShot();

            const replayInteraction =
              vi.fn<GoogleGenAiReplayInteraction>(
                async (providerExecutionId) => {
                  await persistExternally(
                    mediaRoot,
                  );

                  return replayObservation(
                    providerExecutionId,
                    "completed",
                  );
                },
              );

            const spies =
              recoverySpies({
                replayInteraction,
              });

            const result =
              await reconcile(
                mediaRoot,
                spies.dependencies,
              );

            expect(
              result.reconciliationMode,
            ).toBe(
              "RECOVERED_SUBMISSION",
            );

            expect(
              result.completion
                .completedAt,
            ).toBe(
              "2026-10-24T12:05:00.000Z",
            );
          },
        );

        it(
          "G84/G85/G86 a conflicting completion published after inspection fails closed without repair or cleanup",
          async () => {
            const mediaRoot =
              await submittedShot();

            const conflicting =
              JSON.stringify({
                schemaVersion:
                  "1.1",

                completedAt:
                  "2026-10-24T12:06:00.000Z",

                status:
                  "COMPLETED",

                reservationId:
                  RESERVATION_ID,

                episodeId:
                  "EP92",

                shotId:
                  "S01",

                provider:
                  "GOOGLE_GENAI",

                providerExecutionId:
                  INTERACTION_ID,

                generationRecordPath:
                  join(
                    mediaRoot,
                    "generated-video",
                    "EP92",
                    "S01",
                    "foreign.google-genai-generation.json",
                  ),
              });

            const replayInteraction =
              vi.fn<GoogleGenAiReplayInteraction>(
                async (providerExecutionId) => {
                  await writeFile(
                    completionPath(
                      mediaRoot,
                    ),
                    conflicting,
                    "utf8",
                  );

                  return replayObservation(
                    providerExecutionId,
                    "completed",
                  );
                },
              );

            const spies =
              recoverySpies({
                replayInteraction,
              });

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toThrow(
              /non-canonical generation record/,
            );

            expect(
              await readFile(
                completionPath(
                  mediaRoot,
                ),
                "utf8",
              ),
            ).toBe(
              conflicting,
            );

            expect(
              await exists(
                recordPath(
                  mediaRoot,
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
      "secure recovery authority",
      () => {
        type Clocks = {
          wall: number;
          monotonic: number;
        };

        function clocked(
          clocks: Clocks,
          overrides: Partial<GoogleGenAiSubmittedRecoveryDependencies> = {},
          status: unknown = "completed",
        ): RecoverySpies {
          return recoverySpies(
            {
              nowMs: () => clocks.wall,
              monotonicNowMs: () => clocks.monotonic,
              ...overrides,
            },
            status,
          );
        }

        function defaultClocks(): Clocks {
          return { wall: SUBMITTED_AT_MS + 19 * 60_000, monotonic: 0 };
        }

        type OutputFaults = Readonly<{
          failUnlink?: boolean;
          failClose?: boolean;
          onSync?: () => void;
          onClose?: () => void;
          onLink?: () => void;
        }>;

        /**
         * Real output filesystem with an event log, optional unlink/close
         * faults, and hooks that move injected clocks while an operation is in
         * progress (the parent timer callback is not delivered by these hooks).
         */
        function outputFileSystem(
          events: string[],
          faults: boolean | OutputFaults = false,
        ): GoogleGenAiOutputFileSystem {
          const options: OutputFaults = typeof faults === "boolean" ? { failUnlink: faults } : faults;
          return {
            mkdir: (path, options) => mkdir(path, options),
            lstat: (path) => lstat(path),
            open: async (path, flags) => {
              const handle = await open(path, flags);
              return {
                write: (buffer, offset, length, position) => handle.write(buffer, offset, length, position),
                writeFile: (data) => handle.writeFile(data),
                sync: async () => { events.push("sync"); await handle.sync(); options.onSync?.(); },
                close: async () => {
                  events.push("close");
                  await handle.close();
                  options.onClose?.();
                  if (options.failClose) throw new Error(`EIO close ${path}`);
                },
                read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
              };
            },
            link: async (existingPath, newPath) => { events.push("link"); await link(existingPath, newPath); options.onLink?.(); },
            unlink: async (path) => {
              events.push("unlink");
              if (options.failUnlink) throw new Error(`EBUSY ${path}`);
              await unlink(path);
            },
          };
        }

        function expectSanitizedMembers(
          error: unknown,
          mediaRoot: string,
        ): void {
          const members = error instanceof AggregateError ? [error, ...error.errors] : [error];
          for (const member of members) {
            const text = String(member) + (member as Error).stack + JSON.stringify(member);
            for (const secret of [mediaRoot, OUTPUT_URI, "SECRET", "EBUSY", "EIO"]) expect(text).not.toContain(secret);
            expect(Object.hasOwn(member as object, "cause")).toBe(false);
          }
        }

        async function partFiles(
          mediaRoot: string,
        ): Promise<string[]> {
          const directory = join(mediaRoot, "generated-video", "EP92", "S01");
          return (await readdir(directory).catch(() => [] as string[])).filter((entry) => entry.endsWith(".part"));
        }

        it(
          "keeps the COMPLETED path offline even when submitted dependencies are absent or malformed",
          async () => {
            const mediaRoot = await completedShot();
            // completedShot's own setup materializes through the wrapper.
            vi.mocked(materializeGoogleGenAiSingleShotOutput).mockClear();
            const before = await snapshot(mediaRoot);
            const result = await reconcileGoogleGenAiExecutionLifecycle(
              { mediaRoot, episodeId: "EP92", shotId: "S01" },
              { submittedRecovery: { replayInteraction: 7, policy: null } as unknown as GoogleGenAiSubmittedRecoveryDependencies },
            );
            expect(result.reconciliationMode).toBe("DURABLE_COMPLETION");
            const spies = recoverySpies();
            await reconcile(mediaRoot, spies.dependencies);
            expect(spies.replayInteraction).not.toHaveBeenCalled();
            expect(spies.prepareUri).not.toHaveBeenCalled();
            expect(spies.downloadUri).not.toHaveBeenCalled();
            expect(vi.mocked(materializeGoogleGenAiSingleShotOutput)).not.toHaveBeenCalled();
            expect(await snapshot(mediaRoot)).toStrictEqual(before);
          },
        );

        it.each([
          ["a future submittedAt", SUBMITTED_AT_MS - 1, "SECURE_TRANSPORT_CONFIGURATION_INVALID"],
          ["the exact horizon boundary", SUBMITTED_AT_MS + HORIZON_MS, "RECOVERY_HORIZON_EXCEEDED"],
          ["an expired horizon", SUBMITTED_AT_MS + HORIZON_MS + 60_000, "RECOVERY_HORIZON_EXCEEDED"],
        ] as const)(
          "refuses %s before any replay",
          async (_label, wall, code) => {
            const mediaRoot = await submittedShot();
            const spies = clocked({ wall, monotonic: 0 });
            const before = await snapshot(mediaRoot);
            await expect(reconcile(mediaRoot, spies.dependencies)).rejects.toMatchObject({ code });
            expect(spies.replayInteraction).not.toHaveBeenCalled();
            expect(await snapshot(mediaRoot)).toStrictEqual(before);
          },
        );

        it(
          "refuses an invalid durable submittedAt before any replay",
          async () => {
            // The durable submission schema already rejects these; the
            // reconciler's own strict parse is defense in depth behind it.
            for (const submittedAt of ["2026-02-30T12:01:00.000Z", "2026-10-24T12:01:00+00:00", "not-a-timestamp"]) {
              const mediaRoot = await submittedShot();
              const submissionPath = createExecutionSubmissionPath(mediaRoot, "EP92", "S01");
              const submission = await readJsonObject(submissionPath);
              await writeFile(submissionPath, JSON.stringify({ ...submission, submittedAt }, null, 2), "utf8");
              const spies = recoverySpies();
              await expect(reconcile(mediaRoot, spies.dependencies)).rejects.toThrow();
              expect(spies.replayInteraction).not.toHaveBeenCalled();
              expect(spies.prepareUri).not.toHaveBeenCalled();
            }
          },
        );

        it(
          "admits recovery one millisecond inside the horizon with the horizon-bound remaining budget",
          async () => {
            const mediaRoot = await submittedShot();
            const sentinel = new Error("sentinel after admission");
            let observedRemaining: number | undefined;
            const spies = clocked({ wall: SUBMITTED_AT_MS + HORIZON_MS - 1, monotonic: 0 }, {
              replayInteraction: vi.fn<GoogleGenAiReplayInteraction>(async (_id, context) => {
                observedRemaining = context.remainingMs();
                throw sentinel;
              }),
            });
            await expect(reconcile(mediaRoot, spies.dependencies)).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false });
            expect(observedRemaining).toBe(1);
          },
        );

        it(
          "spends the 1200000-ms invocation budget on monotonic time and wall movement never enlarges it",
          async () => {
            const mediaRoot = await submittedShot();
            const clocks = defaultClocks();
            const observed: number[] = [];
            const sentinel = new Error("sentinel after budget observations");
            const spies = clocked(clocks, {
              replayInteraction: vi.fn<GoogleGenAiReplayInteraction>(async (_id, context) => {
                observed.push(context.remainingMs());
                clocks.monotonic += 1_000_000;
                clocks.wall -= 10 * 60 * 60 * 1000;
                observed.push(context.remainingMs());
                clocks.wall = SUBMITTED_AT_MS + HORIZON_MS - 50_000;
                observed.push(context.remainingMs());
                throw sentinel;
              }),
            });
            await expect(reconcile(mediaRoot, spies.dependencies)).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false });
            expect(observed).toEqual([BUDGET_MS, BUDGET_MS - 1_000_000, 50_000]);
          },
        );

        it.each([
          ["monotonic budget", (clocks: Clocks) => { clocks.monotonic += BUDGET_MS; }, "RECONCILIATION_TIMEOUT"],
          ["wall-clock horizon", (clocks: Clocks) => { clocks.wall = SUBMITTED_AT_MS + HORIZON_MS; }, "RECOVERY_HORIZON_EXCEEDED"],
        ] as const)(
          "stops after the replay when the %s is exhausted, before metadata, download or writes",
          async (_label, elapse, code) => {
            const mediaRoot = await submittedShot();
            const clocks = defaultClocks();
            const spies = clocked(clocks, {
              replayInteraction: vi.fn<GoogleGenAiReplayInteraction>(async (id) => {
                elapse(clocks);
                return replayObservation(id, "completed");
              }),
            });
            const before = await snapshot(mediaRoot);
            await expect(reconcile(mediaRoot, spies.dependencies)).rejects.toMatchObject({ code });
            expect(spies.prepareUri).not.toHaveBeenCalled();
            expect(spies.downloadUri).not.toHaveBeenCalled();
            expect(await snapshot(mediaRoot)).toStrictEqual(before);
          },
        );

        it.each([
          ["invocation budget", SUBMITTED_AT_MS + 19 * 60_000, BUDGET_MS, "RECONCILIATION_TIMEOUT"],
          ["recovery horizon", SUBMITTED_AT_MS + HORIZON_MS - 30_000, 30_000, "RECOVERY_HORIZON_EXCEEDED"],
        ] as const)(
          "arms one parent deadline at the smaller %s and aborts the shared context with its typed reason",
          async (_label, wall, deadline, code) => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const mediaRoot = await submittedShot();
            let signal: AbortSignal | undefined;
            const spies = clocked({ wall, monotonic: 0 }, {
              replayInteraction: vi.fn<GoogleGenAiReplayInteraction>((_id, context) => {
                signal = context.signal;
                return new Promise((_resolve, reject) => {
                  context.signal.addEventListener("abort", () => reject(new Error("SECRET raw transport symptom")), { once: true });
                });
              }),
            });
            const outcome = settle(reconcile(mediaRoot, spies.dependencies));
            await turnsUntil(() => signal !== undefined);
            expect(vi.getTimerCount()).toBe(1);
            await vi.advanceTimersByTimeAsync(deadline - 1);
            expect(signal!.aborted).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            const error = await outcome;
            expect(error).toMatchObject({ code });
            expect(signal!.reason).toBe(error);
            expect(String(error) + (error as Error).stack).not.toContain("SECRET");
            expect(vi.getTimerCount()).toBe(0);
          },
        );

        it(
          "replays once, binds both local adapters to the SAME observation and passes one shared context downstream",
          async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const mediaRoot = await submittedShot();
            const spies = recoverySpies();
            const result = await reconcile(mediaRoot, spies.dependencies);
            expect(result.reconciliationMode).toBe("RECOVERED_SUBMISSION");
            expect(vi.getTimerCount()).toBe(0);

            const observation = await spies.replayInteraction.mock.results[0]!.value;
            const context = spies.replayInteraction.mock.calls[0]![1];
            expect(spies.replayInteraction).toHaveBeenCalledTimes(1);
            expect(spies.replayInteraction.mock.calls[0]![0]).toBe(INTERACTION_ID);

            const recoverCalls = vi.mocked(recoverGoogleGenAiSingleShot).mock.calls;
            expect(recoverCalls).toHaveLength(1);
            const getInteraction = recoverCalls[0]![1].getInteraction;
            expect(await getInteraction(INTERACTION_ID)).toBe(observation);

            const materializeCalls = vi.mocked(materializeGoogleGenAiSingleShotOutput).mock.calls;
            expect(materializeCalls).toHaveLength(1);
            const [input, dependencies] = materializeCalls[0]!;
            expect(input.maxOutputBytes).toBe(TRANSPORT_POLICY.limits.maxOutputBytes);
            expect(await dependencies.retrieveOutput(INTERACTION_ID)).toBe(observation);
            expect(dependencies.context).toBe(context);
            expect(dependencies.policy).toBe(TRANSPORT_POLICY);
            expect(dependencies.prepareUri).toBe(spies.prepareUri);
            expect(dependencies.downloadUri).toBe(spies.downloadUri);
            expect(spies.prepareUri.mock.calls[0]![1]).toBe(context);
            expect(spies.downloadUri.mock.calls[0]![2]).toBe(context);

            await expect(getInteraction("v1_other-interaction")).rejects.toThrow(/changed after lifecycle inspection; refusing a second replay/);
            await expect(dependencies.retrieveOutput("v1_other-interaction")).rejects.toThrow(/refusing a second replay/);
            expect(spies.replayInteraction).toHaveBeenCalledTimes(1);
          },
        );

        it.each([
          "queued",
          "in_progress",
          "failed",
          "cancelled",
          "incomplete",
          "budget_exceeded",
          "requires_action",
          "unknown_status",
        ])(
          "never materializes, downloads or persists for a %s observation",
          async (status) => {
            const mediaRoot = await submittedShot();
            const spies = recoverySpies({}, status);
            const before = await snapshot(mediaRoot);
            await expect(reconcile(mediaRoot, spies.dependencies)).rejects.toThrow();
            expect(spies.replayInteraction).toHaveBeenCalledTimes(1);
            expect(vi.mocked(materializeGoogleGenAiSingleShotOutput)).not.toHaveBeenCalled();
            expect(spies.prepareUri).not.toHaveBeenCalled();
            expect(spies.downloadUri).not.toHaveBeenCalled();
            expect(await snapshot(mediaRoot)).toStrictEqual(before);
          },
        );

        it(
          "fails closed without a second replay when the durable submission identity changes after inspection",
          async () => {
            const mediaRoot = await submittedShot();
            const submissionPath = createExecutionSubmissionPath(mediaRoot, "EP92", "S01");
            const replayInteraction = vi.fn<GoogleGenAiReplayInteraction>(async (id) => {
              const submission = await readJsonObject(submissionPath);
              await writeFile(submissionPath, JSON.stringify({ ...submission, providerExecutionId: `${INTERACTION_ID}0` }, null, 2), "utf8");
              return replayObservation(id, "completed");
            });
            const spies = recoverySpies({ replayInteraction });
            await expect(reconcile(mediaRoot, spies.dependencies)).rejects.toThrow(/changed after lifecycle inspection; refusing a second replay/);
            expect(replayInteraction).toHaveBeenCalledTimes(1);
            expect(replayInteraction.mock.calls[0]![0]).toBe(INTERACTION_ID);
            expect(spies.prepareUri).not.toHaveBeenCalled();
            expect(spies.downloadUri).not.toHaveBeenCalled();
            expect(await exists(completionPath(mediaRoot))).toBe(false);
            expect(await exists(recordPath(mediaRoot))).toBe(false);
          },
        );

        it(
          "does not persist completion when post-publication temp cleanup fails",
          async () => {
            const mediaRoot = await submittedShot();
            const events: string[] = [];
            const spies = recoverySpies({ outputFileSystem: outputFileSystem(events, true) });
            const error = await settle(reconcile(mediaRoot, spies.dependencies));
            expect(error).toMatchObject({ code: "TEMP_CLEANUP_FAILED" });
            expect(String(error) + (error as Error).stack).not.toContain(mediaRoot);
            expect((await readFile(outputPath(mediaRoot))).equals(OUTPUT_BYTES)).toBe(true);
            expect(await exists(recordPath(mediaRoot))).toBe(false);
            expect(await exists(completionPath(mediaRoot))).toBe(false);
          },
        );

        it(
          "F1 admits no sync or link once the budget is exhausted after download while the parent timer is still undelivered",
          async () => {
            const mediaRoot = await submittedShot();
            const clocks = defaultClocks();
            const events: string[] = [];
            let signalAbortedAtExpiry: boolean | undefined;
            const spies = clocked(clocks, { outputFileSystem: outputFileSystem(events) });
            const streaming = spies.downloadUri.getMockImplementation()!;
            spies.downloadUri.mockImplementationOnce(async (metadata, sink, context) => {
              const result = await streaming(metadata, sink, context);
              clocks.monotonic += BUDGET_MS;
              signalAbortedAtExpiry = context.signal.aborted;
              expect(context.remainingMs()).toBe(0);
              return result;
            });
            const error = await settle(reconcile(mediaRoot, spies.dependencies));
            expect(error).toMatchObject({ code: "RECONCILIATION_TIMEOUT" });
            expect(signalAbortedAtExpiry).toBe(false);
            expect(events).not.toContain("sync");
            expect(events).not.toContain("link");
            expect(events).toContain("close");
            expect(events).toContain("unlink");
            expect(await exists(outputPath(mediaRoot))).toBe(false);
            expect(await partFiles(mediaRoot)).toEqual([]);
            expect(await exists(recordPath(mediaRoot))).toBe(false);
            expect(await exists(completionPath(mediaRoot))).toBe(false);

            const later = recoverySpies();
            const result = await reconcile(mediaRoot, later.dependencies);
            expect(result.reconciliationMode).toBe("RECOVERED_SUBMISSION");
            expect(later.downloadUri).toHaveBeenCalledTimes(1);
            expect(later.replayInteraction).toHaveBeenCalledTimes(1);
          },
        );

        it.each([
          ["the invocation budget reaches exactly 0 during sync", "onSync", (clocks: Clocks) => { clocks.monotonic = BUDGET_MS; }, "RECONCILIATION_TIMEOUT", true],
          ["the durable horizon boundary is reached during sync", "onSync", (clocks: Clocks) => { clocks.wall = SUBMITTED_AT_MS + HORIZON_MS; }, "RECOVERY_HORIZON_EXCEEDED", true],
          ["the invocation budget expires during close", "onClose", (clocks: Clocks) => { clocks.monotonic = BUDGET_MS + 1; }, "RECONCILIATION_TIMEOUT", true],
          ["the durable horizon expires during close", "onClose", (clocks: Clocks) => { clocks.wall = SUBMITTED_AT_MS + HORIZON_MS + 1; }, "RECOVERY_HORIZON_EXCEEDED", true],
        ] as const)(
          "F1 never starts hard-link publication when %s",
          async (_label, hook, elapse, code, syncRan) => {
            const mediaRoot = await submittedShot();
            const clocks = defaultClocks();
            const events: string[] = [];
            const spies = clocked(clocks, { outputFileSystem: outputFileSystem(events, { [hook]: () => elapse(clocks) }) });
            const error = await settle(reconcile(mediaRoot, spies.dependencies));
            expect(error).toMatchObject({ code });
            expect(events.includes("sync")).toBe(syncRan);
            expect(events).toContain("close");
            expect(events).not.toContain("link");
            expect(events.at(-1)).toBe("unlink");
            expect(await exists(outputPath(mediaRoot))).toBe(false);
            expect(await partFiles(mediaRoot)).toEqual([]);
            expect(await exists(completionPath(mediaRoot))).toBe(false);
          },
        );

        it(
          "F1 keeps the normal unexpired order sync -> close -> admission -> hard link -> temp removal",
          async () => {
            const mediaRoot = await submittedShot();
            const events: string[] = [];
            const spies = recoverySpies({ outputFileSystem: outputFileSystem(events) });
            const result = await reconcile(mediaRoot, spies.dependencies);
            expect(result.reconciliationMode).toBe("RECOVERED_SUBMISSION");
            expect(events).toEqual(["sync", "close", "link", "unlink"]);
          },
        );

        /** Simulated exFAT publication: every link reports EISDIR; optional faults on the exclusive final only. */
        function exfatOutputFileSystem(
          events: string[],
          failAt?: "write" | "sync" | "corrupt" | "close",
        ): GoogleGenAiOutputFileSystem {
          const base = outputFileSystem(events);
          let finalPath: string | undefined;
          return {
            ...base,
            link: async (_existingPath, newPath) => {
              events.push("link");
              finalPath = newPath;
              throw Object.assign(new Error("EISDIR SECRET"), { code: "EISDIR" });
            },
            open: async (path, flags) => {
              const handle = await base.open(path, flags);
              if (path !== finalPath || flags !== "wx") return handle;
              events.push("open:final:wx");
              return {
                ...handle,
                write: async (buffer, offset, length, position) => {
                  if (failAt === "write") throw Object.assign(new Error("ENOSPC SECRET"), { code: "ENOSPC" });
                  if (failAt !== "corrupt") return handle.write(buffer, offset, length, position);
                  const corrupted = Buffer.from(buffer.subarray(offset, offset + length)).fill(0x41, 16);
                  return handle.write(corrupted, 0, corrupted.byteLength, position);
                },
                sync: async () => {
                  if (failAt === "sync") throw new Error("EIO SECRET");
                  await handle.sync();
                  events.push("sync:final");
                },
                close: async () => {
                  if (failAt !== "close") return handle.close();
                  // The descriptor is really released, then the close stage reports failure.
                  events.push(`close:final:bytes=${(await lstat(path)).size}`);
                  await handle.close();
                  events.push("close:final:fault");
                  throw Object.assign(new Error("EIO SECRET close"), { code: "EIO" });
                },
              };
            },
          };
        }

        it(
          "B4Y2L persists completion only after the exFAT exclusive-copy publication is verified",
          async () => {
            const mediaRoot = await submittedShot();
            const events: string[] = [];
            const spies = recoverySpies({ outputFileSystem: exfatOutputFileSystem(events) });
            const result = await reconcile(mediaRoot, spies.dependencies);
            expect(result.reconciliationMode).toBe("RECOVERED_SUBMISSION");
            expect(events.filter((event) => event === "open:final:wx")).toHaveLength(1);
            expect((await readFile(outputPath(mediaRoot))).equals(OUTPUT_BYTES)).toBe(true);
            expect(await partFiles(mediaRoot)).toEqual([]);
            expect(await exists(recordPath(mediaRoot))).toBe(true);
            expect(await exists(completionPath(mediaRoot))).toBe(true);
          },
        );

        it.each(["write", "sync", "corrupt"] as const)(
          "B4Y2L N12 never persists completion when the exFAT exclusive-copy publication fails at %s",
          async (failAt) => {
            const mediaRoot = await submittedShot();
            const events: string[] = [];
            const spies = recoverySpies({ outputFileSystem: exfatOutputFileSystem(events, failAt) });
            const error = await settle(reconcile(mediaRoot, spies.dependencies));
            expect(error).toMatchObject({ code: "OUTPUT_PUBLICATION_FAILED", retryable: false });
            expectSanitizedMembers(error, mediaRoot);
            expect(events.filter((event) => event === "open:final:wx")).toHaveLength(1);
            expect(await exists(outputPath(mediaRoot))).toBe(false);
            expect(await partFiles(mediaRoot)).toEqual([]);
            expect(await exists(recordPath(mediaRoot))).toBe(false);
            expect(await exists(completionPath(mediaRoot))).toBe(false);
          },
        );

        it(
          "B4Y2L1 N12 never persists completion when the exFAT exclusive-copy publication fails at close",
          async () => {
            const mediaRoot = await submittedShot();
            const durableFiles = (entries: Record<string, string>) =>
              Object.fromEntries(Object.entries(entries).filter(([, digest]) => digest !== "dir"));
            const lifecycleBefore = await inspectExecutionLifecycle(mediaRoot, "EP92", "S01");
            const before = durableFiles(await snapshot(mediaRoot));
            vi.mocked(persistGoogleGenAiSingleShotCompletion).mockClear();
            const events: string[] = [];
            const spies = recoverySpies({ outputFileSystem: exfatOutputFileSystem(events, "close") });
            const error = await settle(reconcile(mediaRoot, spies.dependencies));

            // Fallback entered, final exclusively acquired, all bytes copied and synced, then the final close faulted.
            const at = (event: string) => events.indexOf(event);
            expect(events.filter((event) => event === "link")).toHaveLength(1);
            expect(events.filter((event) => event === "open:final:wx")).toHaveLength(1);
            expect(events.filter((event) => event === "close:final:fault")).toHaveLength(1);
            expect(at("link")).toBeLessThan(at("open:final:wx"));
            expect(at("open:final:wx")).toBeLessThan(at("sync:final"));
            expect(at("sync:final")).toBeLessThan(at(`close:final:bytes=${OUTPUT_BYTES.byteLength}`));
            expect(at(`close:final:bytes=${OUTPUT_BYTES.byteLength}`)).toBeLessThan(at("close:final:fault"));
            expect(events.slice(at("close:final:fault"))).toContain("unlink");

            expect(error).toMatchObject({ code: "OUTPUT_PUBLICATION_FAILED", retryable: false });
            expectSanitizedMembers(error, mediaRoot);
            expect(vi.mocked(materializeGoogleGenAiSingleShotOutput)).toHaveBeenCalledTimes(1);
            expect(vi.mocked(persistGoogleGenAiSingleShotCompletion)).toHaveBeenCalledTimes(0);
            expect(spies.replayInteraction).toHaveBeenCalledTimes(1);

            expect(await exists(outputPath(mediaRoot))).toBe(false);
            expect(await partFiles(mediaRoot)).toEqual([]);
            expect(await exists(recordPath(mediaRoot))).toBe(false);
            expect(await exists(completionPath(mediaRoot))).toBe(false);

            const lifecycleAfter = await inspectExecutionLifecycle(mediaRoot, "EP92", "S01");
            expect(lifecycleAfter.state).toBe("SUBMITTED");
            expect(lifecycleAfter).toStrictEqual(lifecycleBefore);
            expect(lifecycleAfter).toMatchObject({
              reservation: { reservationId: RESERVATION_ID },
              submission: { reservationId: RESERVATION_ID, providerExecutionId: INTERACTION_ID },
            });
            expect(durableFiles(await snapshot(mediaRoot))).toStrictEqual(before);
          },
        );

        it(
          "does not persist when the invocation expires after publication, and a later invocation converges idempotently",
          async () => {
            const mediaRoot = await submittedShot();
            const clocks = defaultClocks();
            const events: string[] = [];
            const spies = clocked(clocks, { outputFileSystem: outputFileSystem(events, { onLink: () => { clocks.monotonic += BUDGET_MS; } }) });
            await expect(reconcile(mediaRoot, spies.dependencies)).rejects.toMatchObject({ code: "RECONCILIATION_TIMEOUT" });
            expect(events).toEqual(["sync", "close", "link", "unlink"]);
            expect((await readFile(outputPath(mediaRoot))).equals(OUTPUT_BYTES)).toBe(true);
            expect(await exists(recordPath(mediaRoot))).toBe(false);
            expect(await exists(completionPath(mediaRoot))).toBe(false);

            const later = recoverySpies();
            const result = await reconcile(mediaRoot, later.dependencies);
            expect(result.reconciliationMode).toBe("RECOVERED_SUBMISSION");
            expect(later.downloadUri).not.toHaveBeenCalled();
            expect(later.replayInteraction).toHaveBeenCalledTimes(1);
          },
        );

        it.each([
          ["owned-temp unlink failure", { failUnlink: true }],
          ["owned-handle close failure", { failClose: true }],
        ] as const)(
          "F3 keeps the parent RECONCILIATION_TIMEOUT primary and preserves TEMP_CLEANUP_FAILED after %s",
          async (_label, faults) => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const mediaRoot = await submittedShot();
            const events: string[] = [];
            let parentSignal: AbortSignal | undefined;
            const spies = recoverySpies({
              outputFileSystem: outputFileSystem(events, faults),
              downloadUri: vi.fn<GoogleGenAiOutputUriDownloader>(async (_metadata, sink, context) => {
                parentSignal = context.signal;
                await sink.writeChunk(OUTPUT_BYTES.slice(0, 9));
                // Deliver the actual captured parent deadline callback.
                vi.advanceTimersByTime(BUDGET_MS);
                expect(context.signal.aborted).toBe(true);
                throw transport("RECONCILIATION_TIMEOUT");
              }),
            });
            const error = await settle(reconcile(mediaRoot, spies.dependencies));
            expect(error).toBeInstanceOf(AggregateError);
            expect(error).not.toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
            const members = (error as AggregateError).errors as GoogleGenAiSecureOutputTransportError[];
            expect(members.map((member) => member.code)).toEqual(["RECONCILIATION_TIMEOUT", "TEMP_CLEANUP_FAILED"]);
            expect(members[0]).toBe(parentSignal!.reason);
            expect(members[1]!.retryable).toBe(false);
            for (const member of members) expect(member).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
            expectSanitizedMembers(error, mediaRoot);
            expect(events).not.toContain("sync");
            expect(events).not.toContain("link");
            expect(events).toContain("unlink");
            expect(await exists(recordPath(mediaRoot))).toBe(false);
            expect(await exists(completionPath(mediaRoot))).toBe(false);
            expect(vi.getTimerCount()).toBe(0);
          },
        );

        it(
          "F3 keeps a parent RECOVERY_HORIZON_EXCEEDED primary with a sanitized raw primary replaced and cleanup evidence kept",
          async () => {
            const mediaRoot = await submittedShot();
            const clocks = defaultClocks();
            const events: string[] = [];
            const spies = clocked(clocks, {
              outputFileSystem: outputFileSystem(events, { failUnlink: true }),
              downloadUri: vi.fn<GoogleGenAiOutputUriDownloader>(async (_metadata, sink) => {
                await sink.writeChunk(OUTPUT_BYTES.slice(0, 9));
                clocks.wall = SUBMITTED_AT_MS + HORIZON_MS;
                throw Object.assign(new Error(`RAW_PROVIDER_SECRET ${OUTPUT_URI}`), { token: "SECRET" });
              }),
            });
            const error = await settle(reconcile(mediaRoot, spies.dependencies));
            expect(error).toBeInstanceOf(AggregateError);
            expect(((error as AggregateError).errors as GoogleGenAiSecureOutputTransportError[]).map((member) => member.code))
              .toEqual(["RECOVERY_HORIZON_EXCEEDED", "TEMP_CLEANUP_FAILED"]);
            expectSanitizedMembers(error, mediaRoot);
            expect(JSON.stringify((error as AggregateError).errors)).not.toContain("RAW_PROVIDER_SECRET");
            expect(await exists(completionPath(mediaRoot))).toBe(false);
          },
        );

        it(
          "F3 keeps the simple parent reason when cleanup succeeds",
          async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const mediaRoot = await submittedShot();
            const spies = recoverySpies({
              downloadUri: vi.fn<GoogleGenAiOutputUriDownloader>(async (_metadata, sink) => {
                await sink.writeChunk(OUTPUT_BYTES.slice(0, 9));
                vi.advanceTimersByTime(BUDGET_MS);
                throw transport("RECONCILIATION_TIMEOUT");
              }),
            });
            const error = await settle(reconcile(mediaRoot, spies.dependencies));
            expect(error).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
            expect(error).not.toBeInstanceOf(AggregateError);
            expect(error).toMatchObject({ code: "RECONCILIATION_TIMEOUT" });
            expect(await partFiles(mediaRoot)).toEqual([]);
          },
        );

        it(
          "refuses a second Files attempt that could outlive the shared invocation authority",
          async () => {
            const mediaRoot = await submittedShot();
            const clocks = defaultClocks();
            const spies = clocked(clocks);
            spies.downloadUri.mockImplementationOnce(async (_metadata, sink) => {
              await sink.writeChunk(OUTPUT_BYTES.slice(0, 9));
              clocks.monotonic += 600_000;
              throw transport("DOWNLOAD_TIMEOUT");
            });
            await expect(reconcile(mediaRoot, spies.dependencies)).rejects.toMatchObject({ code: "RECOVERY_BUDGET_EXHAUSTED" });
            expect(spies.prepareUri).toHaveBeenCalledTimes(1);
            expect(spies.downloadUri).toHaveBeenCalledTimes(1);
            expect(await partFiles(mediaRoot)).toEqual([]);
            expect(await exists(completionPath(mediaRoot))).toBe(false);
          },
        );

        it(
          "runs at most two Files attempts on the shared context, waiting the published 10000 ms between them",
          async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const mediaRoot = await submittedShot();
            const spies = recoverySpies();
            spies.downloadUri.mockImplementationOnce(async () => {
              throw transport("DOWNLOAD_HTTP_FAILED", 503);
            });
            const outcome = reconcile(mediaRoot, spies.dependencies);
            await turnsUntil(() => vi.getTimerCount() === 2);
            await vi.advanceTimersByTimeAsync(9_999);
            expect(spies.prepareUri).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            const result = await outcome;
            expect(result.reconciliationMode).toBe("RECOVERED_SUBMISSION");
            expect(spies.replayInteraction).toHaveBeenCalledTimes(1);
            expect(spies.prepareUri).toHaveBeenCalledTimes(2);
            expect(spies.downloadUri).toHaveBeenCalledTimes(2);
            const context = spies.replayInteraction.mock.calls[0]![1];
            for (const call of spies.prepareUri.mock.calls) expect(call[1]).toBe(context);
            for (const call of spies.downloadUri.mock.calls) expect(call[2]).toBe(context);
            expect(vi.getTimerCount()).toBe(0);
          },
        );

        it(
          "awaits owned-temp cleanup after the parent deadline aborts a download",
          async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const mediaRoot = await submittedShot();
            let streaming = false;
            const spies = recoverySpies({
              downloadUri: vi.fn<GoogleGenAiOutputUriDownloader>(async (_metadata, sink, context) => {
                await sink.writeChunk(OUTPUT_BYTES.slice(0, 9));
                streaming = true;
                await new Promise((_resolve, reject) => {
                  context.signal.addEventListener("abort", () => reject(transport("RECONCILIATION_TIMEOUT")), { once: true });
                });
                throw new Error("unreachable");
              }),
            });
            const outcome = settle(reconcile(mediaRoot, spies.dependencies));
            await turnsUntil(() => streaming);
            await vi.advanceTimersByTimeAsync(BUDGET_MS);
            expect(await outcome).toMatchObject({ code: "RECONCILIATION_TIMEOUT" });
            expect(await partFiles(mediaRoot)).toEqual([]);
            expect(await exists(outputPath(mediaRoot))).toBe(false);
            expect(await exists(completionPath(mediaRoot))).toBe(false);
          },
        );

        it(
          "rechecks the shared cancellation before sync and link",
          async () => {
            vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
            const mediaRoot = await submittedShot();
            const events: string[] = [];
            const spies = recoverySpies({ outputFileSystem: outputFileSystem(events) });
            const streaming = spies.downloadUri.getMockImplementation()!;
            spies.downloadUri.mockImplementationOnce(async (metadata, sink, context) => {
              const result = await streaming(metadata, sink, context);
              vi.advanceTimersByTime(BUDGET_MS);
              expect(context.signal.aborted).toBe(true);
              return result;
            });
            await expect(reconcile(mediaRoot, spies.dependencies)).rejects.toMatchObject({ code: "RECONCILIATION_TIMEOUT" });
            expect(events).not.toContain("sync");
            expect(events).not.toContain("link");
            expect(await partFiles(mediaRoot)).toEqual([]);
            expect(await exists(outputPath(mediaRoot))).toBe(false);
          },
        );
      },
    );

    describe(
      "source-level guarantees",
      () => {
        it(
          "D65/D66/F81 creates no production downloader, hard-codes no maxOutputBytes, and has no create or resubmission path",
          async () => {
            const source =
              (
                await readFile(
                  join(
                    process.cwd(),
                    RECONCILER_SOURCE,
                  ),
                  "utf8",
                )
              )
                .replace(
                  /\/\*[\s\S]*?\*\//g,
                  "",
                )
                .replace(
                  /\/\/.*$/gm,
                  "",
                );

            expect(
              source,
            ).not.toMatch(
              /maxOutputBytes\s*[:=]\s*\d|\bfetch\s*\(|@google\/genai|new GoogleGenAI|createGoogleGenAiSingleShotProduction|submitGoogleGenAiSingleShot|interactions\.create|\.create\(|process\.env|loadEnvironment|\/runway\/|\/veo\//,
            );
          },
        );
      },
    );
  },
);

// ---- B4V8C closed dependency-error boundary fixtures (synthetic data only) ----
const B4V8C_MARKER = "SYNTHETIC_DEPENDENCY_SECRET";
const B4V8C_URI = "https://generativelanguage.googleapis.com/v1beta/files/hostile-999:download?alt=media";
type B4v8cCode = GoogleGenAiSecureOutputTransportError["code"];
const b4v8cGetterReads = { count: 0 };

/** Genuine constructor-produced frozen base error whose runtime stack accessor accepts hostile content. */
function b4v8cHostileBase(code: B4v8cCode, details: { attempt?: number; httpStatus?: number } = {}): GoogleGenAiSecureOutputTransportError {
  const raw = new GoogleGenAiSecureOutputTransportError(code, details);
  expect(Object.isFrozen(raw)).toBe(true);
  (raw as { stack?: string }).stack = `${B4V8C_MARKER} ${B4V8C_URI}`;
  expect(raw.stack).toContain(B4V8C_MARKER);
  return raw;
}

/** Transport-prototype candidate NOT built by the trusted constructor, carrying hostile data. */
function b4v8cForged(fields: Record<string, unknown>, getters: readonly string[] = [], inherited = false): GoogleGenAiSecureOutputTransportError {
  const descriptors: PropertyDescriptorMap = {
    message: { value: `${B4V8C_MARKER} message`, enumerable: true },
    stack: { value: `${B4V8C_MARKER} ${B4V8C_URI}`, enumerable: true },
    cause: { value: new Error(`${B4V8C_MARKER} cause`), enumerable: true },
    providerBody: { value: `${B4V8C_MARKER} body`, enumerable: true },
  };
  for (const [field, value] of Object.entries(fields)) descriptors[field] = { value, enumerable: true };
  for (const field of getters) {
    descriptors[field] = { enumerable: true, get: () => { b4v8cGetterReads.count += 1; throw new Error(`${B4V8C_MARKER} getter ${field}`); } };
  }
  const carrier = Object.create(GoogleGenAiSecureOutputTransportError.prototype, descriptors) as object;
  return (inherited ? Object.create(carrier) : carrier) as GoogleGenAiSecureOutputTransportError;
}

function b4v8cOrdinary(): Error {
  return Object.assign(new Error(`${B4V8C_MARKER} ordinary ${B4V8C_URI}`, { cause: new Error(`${B4V8C_MARKER} cause`) }), { providerBody: `${B4V8C_MARKER} body` });
}

const B4V8C_VALID_FIELDS = { code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: 503, retryable: true } as const;
const B4V8C_MALFORMED: ReadonlyArray<readonly [string, () => unknown]> = [
  ["string status '404'", () => b4v8cForged({ code: "DOWNLOAD_HTTP_FAILED", attempt: 1, httpStatus: "404", retryable: false })],
  ["NaN status", () => b4v8cForged({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: Number.NaN, retryable: true })],
  ["out-of-range status 600", () => b4v8cForged({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: 600, retryable: true })],
  ["invalid attempt -1", () => b4v8cForged({ code: "DOWNLOAD_HTTP_FAILED", attempt: -1, httpStatus: 503, retryable: true })],
  ["contradictory 503 with retryable=false", () => b4v8cForged({ ...B4V8C_VALID_FIELDS, retryable: false })],
  ["contradictory 404 with retryable=true", () => b4v8cForged({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: 404, retryable: true })],
  ["contradictory timeout with retryable=false", () => b4v8cForged({ code: "DOWNLOAD_TIMEOUT", attempt: undefined, httpStatus: undefined, retryable: false })],
  ["inherited semantic fields", () => b4v8cForged({ ...B4V8C_VALID_FIELDS }, [], true)],
  ["unknown code", () => b4v8cForged({ code: "NOT_A_CODE", attempt: undefined, httpStatus: 503, retryable: true })],
  ["missing retryable field", () => b4v8cForged({ code: "DOWNLOAD_TIMEOUT", attempt: undefined, httpStatus: undefined })],
];
const B4V8C_ACCESSOR_FIELDS = ["code", "attempt", "httpStatus", "retryable"] as const;
function b4v8cAccessorBacked(field: typeof B4V8C_ACCESSOR_FIELDS[number]): GoogleGenAiSecureOutputTransportError {
  const fields: Record<string, unknown> = { ...B4V8C_VALID_FIELDS };
  delete fields[field];
  return b4v8cForged(fields, [field]);
}

/** Outward error is a fresh trusted base instance with nothing dependency-owned reachable. */
function b4v8cExpectSanitized(outward: unknown, raw: unknown): void {
  expect(outward).not.toBe(raw);
  expect(outward).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
  expect(Object.getPrototypeOf(outward)).toBe(GoogleGenAiSecureOutputTransportError.prototype);
  expect(Object.isFrozen(outward)).toBe(true);
  for (const field of ["cause", "providerBody"]) expect(Object.hasOwn(outward as object, field)).toBe(false);
  const seen = new Set<unknown>();
  const visit = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      for (const secret of [B4V8C_MARKER, B4V8C_URI, "hostile-999"]) expect(value, path).not.toContain(secret);
      return;
    }
    if (value === null || (typeof value !== "object" && typeof value !== "function") || seen.has(value)) return;
    seen.add(value);
    expect(value, path).not.toBe(raw);
    if (value instanceof Error) { visit(value.message, `${path}.message`); visit(value.stack, `${path}.stack`); visit(String(value), `${path}.toString`); }
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if ("value" in descriptor) visit(descriptor.value, `${path}.${String(key)}`);
    }
  };
  visit(outward, "outward");
  expect(JSON.stringify(outward)).not.toContain(B4V8C_MARKER);
}

describe("B4V8C reconciler declared replay-dependency error boundary", () => {
  beforeEach(() => { b4v8cGetterReads.count = 0; });

  async function reconcileWithReplayFailure(make: () => unknown, overrides: Partial<GoogleGenAiSubmittedRecoveryDependencies> = {}) {
    const mediaRoot = await submittedShot();
    let raw: unknown;
    const replayInteraction = vi.fn<GoogleGenAiReplayInteraction>(async () => { throw (raw = make()); });
    const spies = recoverySpies({ replayInteraction, ...overrides });
    const outward = await settle(reconcile(mediaRoot, spies.dependencies));
    return { outward, raw: raw as unknown, replayInteraction, spies, mediaRoot };
  }

  it("normalizes an ordinary replay Error (message, cause, providerBody) to fresh nonretryable CONFIG", async () => {
    const { outward, raw, replayInteraction, spies } = await reconcileWithReplayFailure(b4v8cOrdinary);
    expect(outward).toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false });
    b4v8cExpectSanitized(outward, raw);
    expect(replayInteraction).toHaveBeenCalledTimes(1);
    expect(spies.prepareUri).not.toHaveBeenCalled();
  });

  it("reconstructs a hostile genuine frozen transport error freshly with its exact semantics", async () => {
    const hostile = b4v8cHostileBase("SSE_PROVIDER_ERROR");
    const { outward } = await reconcileWithReplayFailure(() => hostile);
    expect(outward).toMatchObject({ code: "SSE_PROVIDER_ERROR", retryable: false });
    b4v8cExpectSanitized(outward, hostile);
  });

  it.each(B4V8C_MALFORMED)("fails a %s replay dependency error closed as nonretryable CONFIG", async (_label, make) => {
    const { outward, raw } = await reconcileWithReplayFailure(make);
    expect(outward).toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false });
    b4v8cExpectSanitized(outward, raw);
  });

  it.each(B4V8C_ACCESSOR_FIELDS)("never executes an accessor-backed %s getter of a replay dependency error", async (field) => {
    const { outward, raw } = await reconcileWithReplayFailure(() => b4v8cAccessorBacked(field));
    expect(b4v8cGetterReads.count).toBe(0);
    expect(outward).toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false });
    b4v8cExpectSanitized(outward, raw);
  });

  it("keeps a genuine subclass and genuine retry semantics, reconstructed freshly", async () => {
    class GenuineSubclass extends GoogleGenAiSecureOutputTransportError {}
    const subclass = new GenuineSubclass("SSE_HTTP_FAILED", { httpStatus: 404 });
    const first = await reconcileWithReplayFailure(() => subclass);
    expect(first.outward).toMatchObject({ code: "SSE_HTTP_FAILED", httpStatus: 404, retryable: false });
    b4v8cExpectSanitized(first.outward, subclass);
    const transient = b4v8cHostileBase("SSE_HTTP_FAILED", { attempt: 3, httpStatus: 503 });
    const second = await reconcileWithReplayFailure(() => transient);
    expect(second.outward).toMatchObject({ code: "SSE_HTTP_FAILED", attempt: 3, httpStatus: 503, retryable: true });
    b4v8cExpectSanitized(second.outward, transient);
  });

  it("is semantically stable across repeated normalization (fresh CONFIG stays CONFIG)", async () => {
    const config = new GoogleGenAiSecureOutputTransportError("SECURE_TRANSPORT_CONFIGURATION_INVALID");
    const { outward } = await reconcileWithReplayFailure(() => config);
    expect(outward).toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false, attempt: undefined, httpStatus: undefined });
    expect(outward).not.toBe(config);
  });

  it("keeps first parent-reason precedence: an expired invocation budget wins over a malformed replay error", async () => {
    let monotonic = 0;
    const malformed = B4V8C_MALFORMED[0]![1];
    const { outward, raw } = await reconcileWithReplayFailure(() => { monotonic = BUDGET_MS; return malformed(); }, { monotonicNowMs: () => monotonic });
    expect(outward).toMatchObject({ code: "RECONCILIATION_TIMEOUT" });
    expect(outward).not.toBeInstanceOf(AggregateError);
    b4v8cExpectSanitized(outward, raw);
  });
});
