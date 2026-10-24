import {
  link,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  basename,
  dirname,
  join,
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
  createExecutionSubmissionPath,
} from "../src/execution/executionSubmissionPath.js";

import {
  inspectExecutionLifecycle,
} from "../src/execution/inspectExecutionLifecycle.js";

import {
  readExecutionCompletion,
} from "../src/execution/readExecutionCompletion.js";

import {
  materializeGoogleGenAiSingleShotOutput,
  type GoogleGenAiOutputRetriever,
  type GoogleGenAiSingleShotOutputMaterializationResult,
} from "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js";

import {
  persistGoogleGenAiSingleShotCompletion,
  type GoogleGenAiCompletionFileHandle,
  type GoogleGenAiCompletionFileSystem,
  type GoogleGenAiSingleShotCompletionPersistenceInput,
} from "../src/execution/providers/persistGoogleGenAiSingleShotCompletion.js";

import {
  createGoogleGenAiGenerationRecordPath,
} from "../src/googleGenai/audit/googleGenAiGenerationRecordPath.js";

import type {
  GoogleGenAiPolicy,
} from "../src/schemas/googleGenAiPolicy.schema.js";

import {
  loadGoogleGenAiPolicy,
} from "../src/validation/loadGoogleGenAiPolicy.js";

const INTERACTION_ID =
  "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";

const RESERVATION_ID =
  "11111111-1111-4111-8111-111111111111";

const PROMPT_TEXT =
  "Busybookie confidential Google prompt for completion persistence.";

const reservationDependencies = {
  now: () =>
    "2026-10-24T12:00:00.000Z",

  createReservationId: () =>
    RESERVATION_ID,
};

const submissionDependencies = {
  now: () =>
    "2026-10-24T12:01:00.000Z",
};

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
  payloadLabel:
    string =
      "busybookie-google-completion-output",
): Buffer {
  const ftyp =
    Buffer.concat([
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
    ]);

  const payload =
    Buffer.from(
      payloadLabel,
      "utf8",
    );

  const mdatHeader =
    Buffer.alloc(
      8,
    );

  mdatHeader.writeUInt32BE(
    8 + payload.byteLength,
    0,
  );

  mdatHeader.write(
    "mdat",
    4,
    "latin1",
  );

  return Buffer.concat([
    ftyp,
    mdatHeader,
    payload,
  ]);
}

async function makeMediaRoot():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-google-genai-persistence-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

async function persistGoogleSubmission(
  mediaRoot:
    string,
): Promise<void> {
  const reservation =
    await createExecutionReservation(
      mediaRoot,
      {
        episodeId:
          "EP92",

        shotId:
          "S01",

        provider:
          "GOOGLE_GENAI",
      },
      reservationDependencies,
    );

  await createExecutionSubmission(
    mediaRoot,
    {
      reservationId:
        reservation.record
          .reservationId,

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
            PROMPT_TEXT,

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
    submissionDependencies,
  );
}

async function materialize(
  mediaRoot:
    string,
  bytes:
    Buffer =
      makeMp4(),
): Promise<GoogleGenAiSingleShotOutputMaterializationResult> {
  return materializeGoogleGenAiSingleShotOutput(
    {
      mediaRoot,

      episodeId:
        "EP92",

      shotId:
        "S01",

      maxOutputBytes:
        4096,
    },
    {
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

              data:
                bytes.toString(
                  "base64",
                ),
            },
          }),
        ),

      downloadUri:
        async () => {
          throw new Error(
            "URI downloader must not be called.",
          );
        },
    },
  );
}

async function prepareShot(
  mediaRoot?:
    string,
): Promise<
  Readonly<{
    mediaRoot:
      string;

    materializedOutput:
      GoogleGenAiSingleShotOutputMaterializationResult;
  }>
> {
  const root =
    mediaRoot ??
    (await makeMediaRoot());

  await persistGoogleSubmission(
    root,
  );

  return {
    mediaRoot:
      root,

    materializedOutput:
      await materialize(
        root,
      ),
  };
}

function persistenceInput(
  mediaRoot:
    string,
  materializedOutput:
    GoogleGenAiSingleShotOutputMaterializationResult,
): GoogleGenAiSingleShotCompletionPersistenceInput {
  return {
    mediaRoot,

    episodeId:
      "EP92",

    shotId:
      "S01",

    materializedOutput,
  };
}

function generationRecordPathFor(
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

function completionPathFor(
  mediaRoot:
    string,
): string {
  return createExecutionCompletionPath(
    mediaRoot,
    "EP92",
    "S01",
  );
}

async function pathExists(
  path:
    string,
): Promise<boolean> {
  try {
    await readFile(
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

async function shotDirectoryEntries(
  mediaRoot:
    string,
): Promise<string[]> {
  return (
    await readdir(
      dirname(
        completionPathFor(
          mediaRoot,
        ),
      ),
    )
  ).sort();
}

type RecordingFileSystem =
  Readonly<{
    fileSystem:
      GoogleGenAiCompletionFileSystem;

    events:
      string[];
  }>;

function recordingFileSystem(
  overrides:
    Partial<GoogleGenAiCompletionFileSystem> =
      {},
): RecordingFileSystem {
  const events:
    string[] = [];

  const base:
    GoogleGenAiCompletionFileSystem = {
      mkdir:
        async (
          path,
          options,
        ) => {
          events.push(
            "mkdir",
          );

          return mkdir(
            path,
            options,
          );
        },

      open:
        async (
          path,
          flags,
        ) => {
          events.push(
            `open:${flags}:${basename(path)}`,
          );

          const handle =
            await open(
              path,
              flags,
            );

          const wrapped:
            GoogleGenAiCompletionFileHandle = {
              writeFile:
                async (data) => {
                  events.push(
                    "write",
                  );

                  await handle.writeFile(
                    data,
                  );
                },

              sync:
                async () => {
                  events.push(
                    "sync",
                  );

                  await handle.sync();
                },

              close:
                async () => {
                  events.push(
                    "close",
                  );

                  await handle.close();
                },
            };

          return wrapped;
        },

      link:
        async (
          existingPath,
          newPath,
        ) => {
          events.push(
            `link:${basename(newPath)}`,
          );

          await link(
            existingPath,
            newPath,
          );
        },

      unlink:
        async (path) => {
          events.push(
            `unlink:${basename(path)}`,
          );

          await unlink(
            path,
          );
        },
    };

  return {
    fileSystem: {
      ...base,
      ...overrides,
    },

    events,
  };
}

describe(
  "Busybookie dormant Google GenAI completion persistence",
  () => {
    describe(
      "fresh persistence and record contracts",
      () => {
        it(
          "publishes the generation record before the completion and returns a frozen durable result",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const recording =
              recordingFileSystem();

            const result =
              await persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  now: () =>
                    "2026-10-24T12:10:00.000Z",

                  fileSystem:
                    recording.fileSystem,
                },
              );

            const generationRecordName =
              basename(
                generationRecordPathFor(
                  mediaRoot,
                ),
              );

            const completionName =
              basename(
                completionPathFor(
                  mediaRoot,
                ),
              );

            expect(
              recording.events,
            ).toEqual([
              "mkdir",
              expect.stringMatching(
                new RegExp(
                  `^open:wx:\\.${generationRecordName.replace(/\./g, "\\.")}\\.[0-9a-f-]{36}\\.part$`,
                ),
              ),
              "write",
              "sync",
              "close",
              `link:${generationRecordName}`,
              expect.stringMatching(
                /^unlink:\..+\.part$/,
              ),
              "mkdir",
              expect.stringMatching(
                new RegExp(
                  `^open:wx:\\.${completionName.replace(/\./g, "\\.")}\\.[0-9a-f-]{36}\\.part$`,
                ),
              ),
              "write",
              "sync",
              "close",
              `link:${completionName}`,
              expect.stringMatching(
                /^unlink:\..+\.part$/,
              ),
            ]);

            expect(
              result,
            ).toStrictEqual({
              provider:
                "GOOGLE_GENAI",

              providerExecutionId:
                INTERACTION_ID,

              generationRecordPath:
                generationRecordPathFor(
                  mediaRoot,
                ),

              generationRecord: {
                schemaVersion:
                  "1.0",

                recordedAt:
                  "2026-10-24T12:10:00.000Z",

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
                      materializedOutput.outputPath,

                    bytes:
                      materializedOutput.byteCount,

                    sha256:
                      materializedOutput.sha256,

                    contentType:
                      "video/mp4",
                  },
                ],
              },

              generationRecordAlreadyPresent:
                false,

              completionPath:
                completionPathFor(
                  mediaRoot,
                ),

              completion: {
                schemaVersion:
                  "1.1",

                completedAt:
                  "2026-10-24T12:10:00.000Z",

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
                  generationRecordPathFor(
                    mediaRoot,
                  ),
              },

              completionAlreadyPresent:
                false,
            });

            expect(
              Object.isFrozen(
                result,
              ),
            ).toBe(
              true,
            );

            expect(
              Object.isFrozen(
                result.generationRecord,
              ),
            ).toBe(
              true,
            );

            expect(
              Object.isFrozen(
                result.completion,
              ),
            ).toBe(
              true,
            );

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              [
                "EP92_S01.execution-reservation.json",
                "EP92_S01.execution-submission.json",
                basename(
                  materializedOutput.outputPath,
                ),
                generationRecordName,
                completionName,
              ].sort(),
            );
          },
        );

        it(
          "serializes only authorized evidence with no request, recovery, policy, source, or transient fields",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            await persistGoogleGenAiSingleShotCompletion(
              persistenceInput(
                mediaRoot,
                materializedOutput,
              ),
            );

            const generationJson =
              await readFile(
                generationRecordPathFor(
                  mediaRoot,
                ),
                "utf8",
              );

            const completionJson =
              await readFile(
                completionPathFor(
                  mediaRoot,
                ),
                "utf8",
              );

            for (
              const json of [
                generationJson,
                completionJson,
              ]
            ) {
              expect(
                json.endsWith(
                  "}\n",
                ),
              ).toBe(
                true,
              );

              expect(
                json,
              ).not.toMatch(
                /promptText|sourceImagePath|sourceKind|alreadyPresent|interactionId|recoveryMetadata|policySnapshot|"background"|"store"|"stream"|apiKey|credential|authorization|token/i,
              );

              expect(
                json,
              ).not.toContain(
                PROMPT_TEXT,
              );

              expect(
                json,
              ).not.toContain(
                "reference.png",
              );
            }

            const generation:
              unknown =
              JSON.parse(
                generationJson,
              );

            const completion:
              unknown =
              JSON.parse(
                completionJson,
              );

            expect(
              Object.keys(
                typeof generation === "object" &&
                  generation !== null
                  ? generation
                  : {},
              ).sort(),
            ).toEqual([
              "episodeId",
              "outputs",
              "provider",
              "providerExecutionId",
              "recordedAt",
              "reservationId",
              "schemaVersion",
              "shotId",
            ]);

            expect(
              Object.keys(
                typeof completion === "object" &&
                  completion !== null
                  ? completion
                  : {},
              ).sort(),
            ).toEqual([
              "completedAt",
              "episodeId",
              "generationRecordPath",
              "provider",
              "providerExecutionId",
              "reservationId",
              "schemaVersion",
              "shotId",
              "status",
            ]);

            expect(
              completion,
            ).toMatchObject({
              generationRecordPath:
                generationRecordPathFor(
                  mediaRoot,
                ),
            });
          },
        );

        it(
          "keeps the shared completion reader and lifecycle inspection closed to the Google 1.1 completion",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            await persistGoogleGenAiSingleShotCompletion(
              persistenceInput(
                mediaRoot,
                materializedOutput,
              ),
            );

            await expect(
              readExecutionCompletion(
                mediaRoot,
                "EP92",
                "S01",
              ),
            ).rejects.toThrow();

            await expect(
              inspectExecutionLifecycle(
                mediaRoot,
                "EP92",
                "S01",
              ),
            ).rejects.toThrow();
          },
        );

        it(
          "leaves the durable submission byte-identical",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const submissionPath =
              createExecutionSubmissionPath(
                mediaRoot,
                "EP92",
                "S01",
              );

            const before =
              await readFile(
                submissionPath,
              );

            await persistGoogleGenAiSingleShotCompletion(
              persistenceInput(
                mediaRoot,
                materializedOutput,
              ),
            );

            expect(
              (
                await readFile(
                  submissionPath,
                )
              ).equals(
                before,
              ),
            ).toBe(
              true,
            );
          },
        );
      },
    );

    describe(
      "durable authority",
      () => {
        it(
          "requires a durable reservation",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const {
              materializedOutput,
            } =
              await prepareShot();

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
              ),
            ).rejects.toThrow(
              /requires a durable reservation/,
            );
          },
        );

        it(
          "requires a GOOGLE_GENAI reservation and submission",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await createExecutionReservation(
              mediaRoot,
              {
                episodeId:
                  "EP92",

                shotId:
                  "S01",

                provider:
                  "RUNWAY",
              },
              reservationDependencies,
            );

            const {
              materializedOutput,
            } =
              await prepareShot();

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
              ),
            ).rejects.toThrow(
              /requires a GOOGLE_GENAI reservation; received RUNWAY/,
            );
          },
        );

        it(
          "requires a durable GOOGLE_GENAI submission",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const submissionPath =
              createExecutionSubmissionPath(
                mediaRoot,
                "EP92",
                "S01",
              );

            await unlink(
              submissionPath,
            );

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
              ),
            ).rejects.toThrow(
              /requires a durable submission/,
            );

            await writeFile(
              submissionPath,
              JSON.stringify({
                schemaVersion:
                  "1.0",

                submittedAt:
                  "2026-10-24T12:01:00.000Z",

                status:
                  "SUBMITTED",

                reservationId:
                  RESERVATION_ID,

                episodeId:
                  "EP92",

                shotId:
                  "S01",

                provider:
                  "RUNWAY",

                providerExecutionId:
                  "task-runway-not-google",
              }),
              "utf8",
            );

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
              ),
            ).rejects.toThrow(
              /requires a GOOGLE_GENAI submission; received RUNWAY/,
            );

            expect(
              await pathExists(
                generationRecordPathFor(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );
          },
        );

        it.each([
          "providerExecutionId",
          "interactionId",
          "provider",
          "reservationId",
        ])(
          "rejects a caller-supplied %s override",
          async (field) => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                {
                  ...persistenceInput(
                    mediaRoot,
                    materializedOutput,
                  ),

                  [field]:
                    "caller-override",
                },
              ),
            ).rejects.toThrow(
              /does not accept a caller-supplied/,
            );

            expect(
              await pathExists(
                generationRecordPathFor(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "persists the durable submission providerExecutionId as the authoritative identity",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const result =
              await persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
              );

            expect(
              result.generationRecord
                .providerExecutionId,
            ).toBe(
              INTERACTION_ID,
            );

            expect(
              result.completion
                .providerExecutionId,
            ).toBe(
              INTERACTION_ID,
            );

            expect(
              result.completion
                .reservationId,
            ).toBe(
              RESERVATION_ID,
            );
          },
        );
      },
    );

    describe(
      "materialized evidence and local re-verification",
      () => {
        it.each([
          [
            "provider",
            {
              provider:
                "VEO",
            },
            /requires GOOGLE_GENAI materialized output/,
          ],
          [
            "providerExecutionId",
            {
              providerExecutionId:
                "v1_other-interaction",
            },
            /providerExecutionId does not match the durable submission/,
          ],
          [
            "outputIndex",
            {
              outputIndex:
                2,
            },
            /output index must be 1/,
          ],
          [
            "outputPath",
            {
              outputPath:
                "/elsewhere/output.mp4",
            },
            /does not match the canonical output path/,
          ],
          [
            "mimeType",
            {
              mimeType:
                "video/webm",
            },
            /MIME type must be video\/mp4/,
          ],
          [
            "zero byteCount",
            {
              byteCount:
                0,
            },
            /byteCount must be a positive safe integer/,
          ],
          [
            "malformed sha256",
            {
              sha256:
                "ABC",
            },
            /sha256 must be a lowercase/,
          ],
        ])(
          "rejects a materialized %s mismatch before writing",
          async (
            _label,
            override,
            message,
          ) => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const tampered =
              Object.assign(
                {},
                materializedOutput,
                override,
              );

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  tampered,
                ),
              ),
            ).rejects.toThrow(
              message,
            );

            expect(
              await pathExists(
                generationRecordPathFor(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );

            expect(
              await pathExists(
                completionPathFor(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "rejects a byte-count mismatch against the file on disk",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  {
                    ...materializedOutput,

                    byteCount:
                      materializedOutput.byteCount +
                      1,
                  },
                ),
              ),
            ).rejects.toThrow(
              /bytes; evidence records/,
            );

            expect(
              await pathExists(
                generationRecordPathFor(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "rejects a SHA-256 mismatch against the file on disk",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  {
                    ...materializedOutput,

                    sha256:
                      "0".repeat(
                        64,
                      ),
                  },
                ),
              ),
            ).rejects.toThrow(
              /does not match evidence/,
            );

            expect(
              await pathExists(
                generationRecordPathFor(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "rejects a non-regular output path",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            await unlink(
              materializedOutput.outputPath,
            );

            await mkdir(
              materializedOutput.outputPath,
            );

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
              ),
            ).rejects.toThrow(
              /not a regular file/,
            );
          },
        );

        it(
          "rejects a missing output file",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            await unlink(
              materializedOutput.outputPath,
            );

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
              ),
            ).rejects.toThrow(
              /does not exist/,
            );
          },
        );

        it(
          "rejects an empty output file",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            await writeFile(
              materializedOutput.outputPath,
              Buffer.alloc(
                0,
              ),
            );

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
              ),
            ).rejects.toThrow(
              /is empty/,
            );

            expect(
              await pathExists(
                generationRecordPathFor(
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
      "idempotent replay",
      () => {
        it(
          "succeeds on exact replay with both records already present and unchanged",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const first =
              await persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  now: () =>
                    "2026-10-24T12:10:00.000Z",
                },
              );

            const generationBefore =
              await readFile(
                first.generationRecordPath,
              );

            const completionBefore =
              await readFile(
                first.completionPath,
              );

            const second =
              await persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  now: () =>
                    "2026-10-24T13:00:00.000Z",
                },
              );

            expect(
              second.generationRecordAlreadyPresent,
            ).toBe(
              true,
            );

            expect(
              second.completionAlreadyPresent,
            ).toBe(
              true,
            );

            expect(
              second.completion
                .completedAt,
            ).toBe(
              "2026-10-24T12:10:00.000Z",
            );

            expect(
              (
                await readFile(
                  first.generationRecordPath,
                )
              ).equals(
                generationBefore,
              ),
            ).toBe(
              true,
            );

            expect(
              (
                await readFile(
                  first.completionPath,
                )
              ).equals(
                completionBefore,
              ),
            ).toBe(
              true,
            );
          },
        );

        it(
          "recovers the generation-record-only crash state by creating only the completion",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const completionName =
              basename(
                completionPathFor(
                  mediaRoot,
                ),
              );

            const crashing =
              recordingFileSystem({
                link:
                  async (
                    existingPath,
                    newPath,
                  ) => {
                    if (
                      basename(
                        newPath,
                      ) ===
                      completionName
                    ) {
                      throw Object.assign(
                        new Error(
                          "Simulated crash before completion publication.",
                        ),
                        {
                          code:
                            "EIO",
                        },
                      );
                    }

                    await link(
                      existingPath,
                      newPath,
                    );
                  },
              });

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  fileSystem:
                    crashing.fileSystem,
                },
              ),
            ).rejects.toThrow(
              /hard-link publication/,
            );

            expect(
              await pathExists(
                generationRecordPathFor(
                  mediaRoot,
                ),
              ),
            ).toBe(
              true,
            );

            expect(
              await pathExists(
                completionPathFor(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );

            const recovered =
              await persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
              );

            expect(
              recovered.generationRecordAlreadyPresent,
            ).toBe(
              true,
            );

            expect(
              recovered.completionAlreadyPresent,
            ).toBe(
              false,
            );

            expect(
              recovered.completion
                .generationRecordPath,
            ).toBe(
              generationRecordPathFor(
                mediaRoot,
              ),
            );
          },
        );

        it(
          "fails closed on a conflicting existing generation record without touching it",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const recordPath =
              generationRecordPathFor(
                mediaRoot,
              );

            const conflicting =
              JSON.stringify(
                {
                  schemaVersion:
                    "1.0",

                  recordedAt:
                    "2026-10-24T12:05:00.000Z",

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
                        materializedOutput.outputPath,

                      bytes:
                        materializedOutput.byteCount,

                      sha256:
                        "f".repeat(
                          64,
                        ),

                      contentType:
                        "video/mp4",
                    },
                  ],
                },
                null,
                2,
              );

            await writeFile(
              recordPath,
              conflicting,
              "utf8",
            );

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
              ),
            ).rejects.toThrow(
              /does not match the verified output evidence/,
            );

            expect(
              await readFile(
                recordPath,
                "utf8",
              ),
            ).toBe(
              conflicting,
            );

            expect(
              await pathExists(
                completionPathFor(
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
      "existing completion preflight",
      () => {
        async function persistedShot() {
          const prepared =
            await prepareShot();

          const result =
            await persistGoogleGenAiSingleShotCompletion(
              persistenceInput(
                prepared.mediaRoot,
                prepared.materializedOutput,
              ),
            );

          return {
            ...prepared,
            result,
          };
        }

        it(
          "accepts an existing valid completion with its valid generation record",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await persistedShot();

            const recording =
              recordingFileSystem();

            const replay =
              await persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  fileSystem:
                    recording.fileSystem,
                },
              );

            expect(
              replay.generationRecordAlreadyPresent &&
                replay.completionAlreadyPresent,
            ).toBe(
              true,
            );

            expect(
              recording.events,
            ).toEqual([]);
          },
        );

        it(
          "fails closed and creates no generation record when the referenced record is missing",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
              result,
            } =
              await persistedShot();

            await unlink(
              result.generationRecordPath,
            );

            const recording =
              recordingFileSystem();

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  fileSystem:
                    recording.fileSystem,
                },
              ),
            ).rejects.toThrow(
              /generation record is missing.*Refusing to recreate evidence/,
            );

            expect(
              recording.events,
            ).toEqual([]);

            expect(
              await pathExists(
                result.generationRecordPath,
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "fails closed and replaces nothing when the referenced record is corrupt",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
              result,
            } =
              await persistedShot();

            await unlink(
              result.generationRecordPath,
            );

            await writeFile(
              result.generationRecordPath,
              "{corrupt",
              "utf8",
            );

            const recording =
              recordingFileSystem();

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  fileSystem:
                    recording.fileSystem,
                },
              ),
            ).rejects.toThrow(
              /not valid JSON/,
            );

            expect(
              recording.events,
            ).toEqual([]);

            expect(
              await readFile(
                result.generationRecordPath,
                "utf8",
              ),
            ).toBe(
              "{corrupt",
            );
          },
        );

        it(
          "fails closed and replaces nothing when the referenced record conflicts",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
              result,
            } =
              await persistedShot();

            const conflicting =
              JSON.stringify({
                ...result.generationRecord,

                outputs: [
                  {
                    ...result.generationRecord
                      .outputs[0],

                    sha256:
                      "e".repeat(
                        64,
                      ),
                  },
                ],
              });

            await unlink(
              result.generationRecordPath,
            );

            await writeFile(
              result.generationRecordPath,
              conflicting,
              "utf8",
            );

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
              ),
            ).rejects.toThrow(
              /does not match the verified output evidence/,
            );

            expect(
              await readFile(
                result.generationRecordPath,
                "utf8",
              ),
            ).toBe(
              conflicting,
            );
          },
        );

        it(
          "fails closed before any publication when the completion references a non-canonical generation record",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
              result,
            } =
              await persistedShot();

            await unlink(
              result.completionPath,
            );

            await writeFile(
              result.completionPath,
              JSON.stringify({
                ...result.completion,

                generationRecordPath:
                  join(
                    mediaRoot,
                    "generated-video",
                    "EP92",
                    "S01",
                    "elsewhere.google-genai-generation.json",
                  ),
              }),
              "utf8",
            );

            await unlink(
              result.generationRecordPath,
            );

            const recording =
              recordingFileSystem();

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  fileSystem:
                    recording.fileSystem,
                },
              ),
            ).rejects.toThrow(
              /non-canonical generation record/,
            );

            expect(
              recording.events,
            ).toEqual([]);

            expect(
              await pathExists(
                result.generationRecordPath,
              ),
            ).toBe(
              false,
            );
          },
        );

        it.each([
          [
            "providerExecutionId",
            "v1_other-interaction",
          ],
          [
            "reservationId",
            "22222222-2222-4222-8222-222222222222",
          ],
        ])(
          "fails closed on an existing completion with a conflicting %s",
          async (
            field,
            value,
          ) => {
            const {
              mediaRoot,
              materializedOutput,
              result,
            } =
              await persistedShot();

            const conflicting =
              JSON.stringify({
                ...result.completion,

                [field]:
                  value,
              });

            await unlink(
              result.completionPath,
            );

            await writeFile(
              result.completionPath,
              conflicting,
              "utf8",
            );

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
              ),
            ).rejects.toThrow(
              /does not match durable execution evidence/,
            );

            expect(
              await readFile(
                result.completionPath,
                "utf8",
              ),
            ).toBe(
              conflicting,
            );
          },
        );

        it(
          "fails closed on an existing completion that is not a Google 1.1 document",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
              result,
            } =
              await persistedShot();

            await unlink(
              result.completionPath,
            );

            await writeFile(
              result.completionPath,
              JSON.stringify({
                ...result.completion,

                schemaVersion:
                  "1.0",

                provider:
                  "VEO",
              }),
              "utf8",
            );

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
              ),
            ).rejects.toThrow();
          },
        );
      },
    );

    describe(
      "hard-link publication and failure handling",
      () => {
        it(
          "treats EEXIST from an identical concurrent generation-record winner as success",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const recordName =
              basename(
                generationRecordPathFor(
                  mediaRoot,
                ),
              );

            const recording =
              recordingFileSystem({
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
                      const competitor:
                        unknown =
                        JSON.parse(
                          await readFile(
                            existingPath,
                            "utf8",
                          ),
                        );

                      await writeFile(
                        newPath,
                        JSON.stringify({
                          ...(
                            typeof competitor === "object" &&
                            competitor !== null
                              ? competitor
                              : {}
                          ),

                          recordedAt:
                            "2026-10-24T11:59:59.000Z",
                        }),
                        "utf8",
                      );
                    }

                    await link(
                      existingPath,
                      newPath,
                    );
                  },
              });

            const result =
              await persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  fileSystem:
                    recording.fileSystem,
                },
              );

            expect(
              result.generationRecordAlreadyPresent,
            ).toBe(
              true,
            );

            expect(
              result.generationRecord
                .recordedAt,
            ).toBe(
              "2026-10-24T11:59:59.000Z",
            );

            expect(
              result.completionAlreadyPresent,
            ).toBe(
              false,
            );
          },
        );

        it(
          "fails closed on EEXIST from a conflicting concurrent completion winner and never overwrites it",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const completionName =
              basename(
                completionPathFor(
                  mediaRoot,
                ),
              );

            let competitorJson =
              "";

            const recording =
              recordingFileSystem({
                link:
                  async (
                    existingPath,
                    newPath,
                  ) => {
                    if (
                      basename(
                        newPath,
                      ) ===
                      completionName
                    ) {
                      const candidate:
                        unknown =
                        JSON.parse(
                          await readFile(
                            existingPath,
                            "utf8",
                          ),
                        );

                      competitorJson =
                        JSON.stringify({
                          ...(
                            typeof candidate === "object" &&
                            candidate !== null
                              ? candidate
                              : {}
                          ),

                          reservationId:
                            "33333333-3333-4333-8333-333333333333",
                        });

                      await writeFile(
                        newPath,
                        competitorJson,
                        "utf8",
                      );
                    }

                    await link(
                      existingPath,
                      newPath,
                    );
                  },
              });

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  fileSystem:
                    recording.fileSystem,
                },
              ),
            ).rejects.toThrow(
              /does not match durable execution evidence/,
            );

            expect(
              await readFile(
                completionPathFor(
                  mediaRoot,
                ),
                "utf8",
              ),
            ).toBe(
              competitorJson,
            );

            expect(
              (
                await shotDirectoryEntries(
                  mediaRoot,
                )
              ).some(
                (entry) =>
                  entry.endsWith(
                    ".part",
                  ),
              ),
            ).toBe(
              false,
            );
          },
        );

        it.each([
          "EPERM",
          "ENOTSUP",
          "EXDEV",
          "EACCES",
        ])(
          "fails closed on a %s link error with no fallback, no completion, and temp cleanup",
          async (code) => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const linkFailure =
              Object.assign(
                new Error(
                  `Mock ${code} link failure.`,
                ),
                {
                  code,
                },
              );

            const recording =
              recordingFileSystem({
                link:
                  async () => {
                    throw linkFailure;
                  },
              });

            let caught:
              unknown;

            try {
              await persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  fileSystem:
                    recording.fileSystem,
                },
              );
            } catch (error) {
              caught =
                error;
            }

            expect(
              caught,
            ).toBeInstanceOf(
              Error,
            );

            if (
              !(caught instanceof Error)
            ) {
              throw new Error(
                "Expected an Error.",
              );
            }

            expect(
              caught.message,
            ).toMatch(
              /No rename, copy, or direct-write fallback is permitted/,
            );

            expect(
              caught.cause,
            ).toBe(
              linkFailure,
            );

            expect(
              recording.events.at(
                -1,
              ),
            ).toMatch(
              /^unlink:\..+\.part$/,
            );

            expect(
              await pathExists(
                generationRecordPathFor(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );

            expect(
              await pathExists(
                completionPathFor(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );

            expect(
              (
                await shotDirectoryEntries(
                  mediaRoot,
                )
              ).some(
                (entry) =>
                  entry.endsWith(
                    ".part",
                  ),
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "prevents publication of either record when fsync fails",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const syncFailure =
              new Error(
                "Mock fsync failure.",
              );

            const base =
              recordingFileSystem();

            const recording =
              recordingFileSystem({
                open:
                  async (
                    path,
                    flags,
                  ) => {
                    const handle =
                      await base.fileSystem.open(
                        path,
                        flags,
                      );

                    return {
                      ...handle,

                      sync:
                        async () => {
                          throw syncFailure;
                        },
                    };
                  },
              });

            await expect(
              persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  fileSystem:
                    recording.fileSystem,
                },
              ),
            ).rejects.toBe(
              syncFailure,
            );

            expect(
              recording.events.some(
                (event) =>
                  event.startsWith(
                    "link:",
                  ),
              ),
            ).toBe(
              false,
            );

            expect(
              await pathExists(
                generationRecordPathFor(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );

            expect(
              await pathExists(
                completionPathFor(
                  mediaRoot,
                ),
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "raises both the publication failure and the temp cleanup failure",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const linkFailure =
              Object.assign(
                new Error(
                  "Mock link failure.",
                ),
                {
                  code:
                    "EPERM",
                },
              );

            const cleanupFailure =
              new Error(
                "Mock temp cleanup failure.",
              );

            const recording =
              recordingFileSystem({
                link:
                  async () => {
                    throw linkFailure;
                  },

                unlink:
                  async () => {
                    throw cleanupFailure;
                  },
              });

            let caught:
              unknown;

            try {
              await persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  fileSystem:
                    recording.fileSystem,
                },
              );
            } catch (error) {
              caught =
                error;
            }

            expect(
              caught,
            ).toBeInstanceOf(
              AggregateError,
            );

            if (
              !(caught instanceof AggregateError)
            ) {
              throw new Error(
                "Expected an AggregateError.",
              );
            }

            expect(
              caught.errors[0],
            ).toBeInstanceOf(
              Error,
            );

            expect(
              caught.errors[0]
                ?.cause,
            ).toBe(
              linkFailure,
            );

            expect(
              caught.errors[1],
            ).toBe(
              cleanupFailure,
            );
          },
        );

        it(
          "raises a temp cleanup failure after a successful publication instead of swallowing it",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const cleanupFailure =
              new Error(
                "Mock temp cleanup failure.",
              );

            const recording =
              recordingFileSystem({
                unlink:
                  async () => {
                    throw cleanupFailure;
                  },
              });

            let caught:
              unknown;

            try {
              await persistGoogleGenAiSingleShotCompletion(
                persistenceInput(
                  mediaRoot,
                  materializedOutput,
                ),
                {
                  fileSystem:
                    recording.fileSystem,
                },
              );
            } catch (error) {
              caught =
                error;
            }

            expect(
              caught,
            ).toBeInstanceOf(
              Error,
            );

            if (
              !(caught instanceof Error)
            ) {
              throw new Error(
                "Expected an Error.",
              );
            }

            expect(
              caught.message,
            ).toMatch(
              /could not be removed/,
            );

            expect(
              caught.cause,
            ).toBe(
              cleanupFailure,
            );

            expect(
              await pathExists(
                completionPathFor(
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
      "real filesystem concurrency",
      () => {
        it(
          "converges for concurrent identical persistence with exactly one publisher per record",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const results =
              await Promise.all([
                persistGoogleGenAiSingleShotCompletion(
                  persistenceInput(
                    mediaRoot,
                    materializedOutput,
                  ),
                ),
                persistGoogleGenAiSingleShotCompletion(
                  persistenceInput(
                    mediaRoot,
                    materializedOutput,
                  ),
                ),
                persistGoogleGenAiSingleShotCompletion(
                  persistenceInput(
                    mediaRoot,
                    materializedOutput,
                  ),
                ),
              ]);

            expect(
              results.filter(
                (result) =>
                  !result.generationRecordAlreadyPresent,
              ),
            ).toHaveLength(
              1,
            );

            expect(
              results.filter(
                (result) =>
                  !result.completionAlreadyPresent,
              ),
            ).toHaveLength(
              1,
            );

            const completion:
              unknown =
              JSON.parse(
                await readFile(
                  completionPathFor(
                    mediaRoot,
                  ),
                  "utf8",
                ),
              );

            expect(
              completion,
            ).toMatchObject({
              schemaVersion:
                "1.1",

              provider:
                "GOOGLE_GENAI",
            });

            expect(
              (
                await shotDirectoryEntries(
                  mediaRoot,
                )
              ).some(
                (entry) =>
                  entry.endsWith(
                    ".part",
                  ),
              ),
            ).toBe(
              false,
            );
          },
        );

        it(
          "fails closed for a concurrent conflicting publisher and keeps the winner intact",
          async () => {
            const {
              mediaRoot,
              materializedOutput,
            } =
              await prepareShot();

            const recordPath =
              generationRecordPathFor(
                mediaRoot,
              );

            const conflictingWinner =
              JSON.stringify({
                schemaVersion:
                  "1.0",

                recordedAt:
                  "2026-10-24T12:00:30.000Z",

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
                      materializedOutput.outputPath,

                    bytes:
                      materializedOutput.byteCount +
                      7,

                    sha256:
                      "d".repeat(
                        64,
                      ),

                    contentType:
                      "video/mp4",
                  },
                ],
              });

            const settled =
              await Promise.allSettled([
                writeFile(
                  recordPath,
                  conflictingWinner,
                  {
                    encoding:
                      "utf8",

                    flag:
                      "wx",
                  },
                ),
                persistGoogleGenAiSingleShotCompletion(
                  persistenceInput(
                    mediaRoot,
                    materializedOutput,
                  ),
                ),
              ]);

            const persistence =
              settled[1];

            const competitor =
              settled[0];

            if (
              competitor?.status ===
              "fulfilled"
            ) {
              expect(
                persistence?.status,
              ).toBe(
                "rejected",
              );

              expect(
                await readFile(
                  recordPath,
                  "utf8",
                ),
              ).toBe(
                conflictingWinner,
              );

              expect(
                await pathExists(
                  completionPathFor(
                    mediaRoot,
                  ),
                ),
              ).toBe(
                false,
              );
            } else {
              expect(
                persistence?.status,
              ).toBe(
                "fulfilled",
              );

              expect(
                await readFile(
                  recordPath,
                  "utf8",
                ),
              ).not.toBe(
                conflictingWinner,
              );
            }
          },
        );
      },
    );
  },
);
