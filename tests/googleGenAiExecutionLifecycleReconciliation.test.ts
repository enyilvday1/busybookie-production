import {
  createHash,
} from "node:crypto";

import {
  link,
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
  materializeGoogleGenAiSingleShotOutput,
  type GoogleGenAiOutputRetriever,
  type GoogleGenAiOutputUriDownloader,
} from "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js";

import {
  persistGoogleGenAiSingleShotCompletion,
  type GoogleGenAiCompletionFileSystem,
} from "../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js";

import type {
  GoogleGenAiInteractionGetter,
} from "../src/execution/providers/recoverGoogleGenAiSingleShot.js";

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

function statusGetter(
  status:
    unknown,
) {
  return vi.fn<GoogleGenAiInteractionGetter>(
    async (providerExecutionId) => ({
      id:
        providerExecutionId,

      status,
    }),
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

    getInteraction:
      ReturnType<typeof statusGetter>;

    retrieveOutput:
      ReturnType<typeof inlineRetriever>;

    downloadUri:
      ReturnType<typeof unusedDownloader>;
  }>;

function recoverySpies(
  overrides:
    Partial<GoogleGenAiSubmittedRecoveryDependencies> =
      {},
  status:
    unknown =
      "completed",
): RecoverySpies {
  const getInteraction =
    statusGetter(
      status,
    );

  const retrieveOutput =
    inlineRetriever();

  const downloadUri =
    unusedDownloader();

  return {
    dependencies: {
      getInteraction,
      retrieveOutput,
      downloadUri,

      maxOutputBytes:
        MAX_OUTPUT_BYTES,

      now: () =>
        "2026-10-24T12:20:00.000Z",

      ...overrides,
    },

    getInteraction,
    retrieveOutput,
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
              spies.getInteraction,
            ).not.toHaveBeenCalled();

            expect(
              spies.retrieveOutput,
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
              spies.getInteraction,
            ).not.toHaveBeenCalled();

            expect(
              spies.retrieveOutput,
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
              spies.getInteraction,
            ).not.toHaveBeenCalled();
          },
        );

        it.each([
          [
            "missing submittedRecovery",
            undefined,
          ],
          [
            "zero maxOutputBytes",
            {
              maxOutputBytes:
                0,
            },
          ],
          [
            "fractional maxOutputBytes",
            {
              maxOutputBytes:
                1.5,
            },
          ],
        ])(
          "throws before any GET for SUBMITTED with %s",
          async (
            _label,
            overrides,
          ) => {
            const mediaRoot =
              await submittedShot();

            const spies =
              recoverySpies(
                overrides ?? {},
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
            ).rejects.toThrow(
              "Google GenAI SUBMITTED reconciliation requires injected same-ID recovery dependencies (getInteraction, retrieveOutput, downloadUri, maxOutputBytes).",
            );

            expect(
              spies.getInteraction,
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
          "throws before any GET when a recovery function is missing at runtime",
          async () => {
            const mediaRoot =
              await submittedShot();

            const getInteraction =
              statusGetter(
                "completed",
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

                    maxOutputBytes:
                      MAX_OUTPUT_BYTES,
                  },
                },
              ),
            ).rejects.toThrow(
              /requires injected same-ID recovery dependencies/,
            );

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
              spies.getInteraction,
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
              spies.getInteraction,
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
              spies.getInteraction,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              spies.retrieveOutput,
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
              spies.getInteraction,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              spies.retrieveOutput,
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
              spies.retrieveOutput,
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
              spies.retrieveOutput,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "D59 propagates a getter error unchanged",
          async () => {
            const mediaRoot =
              await submittedShot();

            const failure =
              new Error(
                "Mock same-ID get failure.",
              );

            const spies =
              recoverySpies({
                getInteraction:
                  vi.fn<GoogleGenAiInteractionGetter>(
                    async () => {
                      throw failure;
                    },
                  ),
              });

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toBe(
              failure,
            );

            expect(
              spies.retrieveOutput,
            ).not.toHaveBeenCalled();
          },
        );
      },
    );

    describe(
      "SUBMITTED success pipeline",
      () => {
        it(
          "D48/D49/D60/D69/D71 recovers with exactly two same-ID GETs and returns the freshly verified RECOVERED_SUBMISSION",
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
              spies.getInteraction,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              spies.getInteraction,
            ).toHaveBeenCalledWith(
              INTERACTION_ID,
            );

            expect(
              spies.retrieveOutput,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              spies.retrieveOutput,
            ).toHaveBeenCalledWith(
              INTERACTION_ID,
            );

            expect(
              spies.downloadUri,
            ).not.toHaveBeenCalled();

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

            const spies =
              recoverySpies({
                retrieveOutput:
                  inlineRetriever(
                    Buffer.from(
                      "not an mp4 payload at all",
                      "utf8",
                    ),
                  ),
              });

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toThrow(
              /MP4|ftyp/,
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
          "D62 propagates an output retrieval error",
          async () => {
            const mediaRoot =
              await submittedShot();

            const failure =
              new Error(
                "Mock output retrieval failure.",
              );

            const spies =
              recoverySpies({
                retrieveOutput:
                  vi.fn<GoogleGenAiOutputRetriever>(
                    async () => {
                      throw failure;
                    },
                  ),
              });

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toBe(
              failure,
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
          "D63 forwards the injected maxOutputBytes to materialization",
          async () => {
            const mediaRoot =
              await submittedShot();

            const spies =
              recoverySpies({
                maxOutputBytes:
                  OUTPUT_BYTES.byteLength -
                  1,
              });

            await expect(
              reconcile(
                mediaRoot,
                spies.dependencies,
              ),
            ).rejects.toThrow(
              /exceeding maxOutputBytes/,
            );
          },
        );

        it(
          "D64 forwards the injected URI downloader exactly once",
          async () => {
            const mediaRoot =
              await submittedShot();

            const uri =
              "https://storage.example.com/videos/google-output.mp4";

            const downloadUri =
              vi.fn<GoogleGenAiOutputUriDownloader>(
                async () =>
                  new Uint8Array(
                    OUTPUT_BYTES,
                  ),
              );

            const spies =
              recoverySpies({
                retrieveOutput:
                  vi.fn<GoogleGenAiOutputRetriever>(
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

                        uri,
                      },
                    }),
                  ),

                downloadUri,
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
              downloadUri,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              downloadUri.mock.calls[0]?.[0],
            ).toStrictEqual({
              uri,

              maxOutputBytes:
                MAX_OUTPUT_BYTES,
            });
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

            const getInteraction =
              vi.fn<GoogleGenAiInteractionGetter>(
                async (providerExecutionId) => {
                  await persistExternally(
                    mediaRoot,
                  );

                  return {
                    id:
                      providerExecutionId,

                    status:
                      "completed",
                  };
                },
              );

            const spies =
              recoverySpies({
                getInteraction,
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

            const getInteraction =
              vi.fn<GoogleGenAiInteractionGetter>(
                async (providerExecutionId) => {
                  await writeFile(
                    completionPath(
                      mediaRoot,
                    ),
                    conflicting,
                    "utf8",
                  );

                  return {
                    id:
                      providerExecutionId,

                    status:
                      "completed",
                  };
                },
              );

            const spies =
              recoverySpies({
                getInteraction,
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
