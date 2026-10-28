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
  inspectGoogleGenAiExecutionLifecycle,
} from "../src/execution/inspectGoogleGenAiExecutionLifecycle.js";

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
          "keeps the shared completion reader closed to the Google 1.1 completion while shared inspection dispatches to the Google inspector (B5C-R1)",
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

            // The shared RUNWAY/VEO completion parser is NOT widened.
            await expect(
              readExecutionCompletion(
                mediaRoot,
                "EP92",
                "S01",
              ),
            ).rejects.toThrow();

            // Shared inspection is keyed on the durable GOOGLE_GENAI
            // reservation and returns the Google inspector's authoritative
            // 1.1 completion unchanged.
            const google =
              await inspectGoogleGenAiExecutionLifecycle(
                mediaRoot,
                "EP92",
                "S01",
              );

            const shared =
              await inspectExecutionLifecycle(
                mediaRoot,
                "EP92",
                "S01",
              );

            expect(
              google.state,
            ).toBe(
              "COMPLETED",
            );

            expect(
              shared,
            ).toStrictEqual({
              state:
                "COMPLETED",

              reservation:
                google.reservation,

              submission:
                google.state === "COMPLETED"
                  ? google.submission
                  : undefined,

              completion:
                google.state === "COMPLETED"
                  ? google.completion
                  : undefined,
            });

            expect(
              shared.state === "COMPLETED"
                ? shared.completion
                : undefined,
            ).toMatchObject({
              schemaVersion:
                "1.1",

              provider:
                "GOOGLE_GENAI",
            });
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

describe(
  "Busybookie Google GenAI completion persistence B4Y2O exFAT record publication",
  () => {
    const NOW = "2026-10-24T12:10:00.000Z";

    type FinalFault =
      | "partialThenFail"
      | "silentShort"
      | "ENOSPC"
      | "EIO"
      | "corruptSameLength"
      | "syncFail"
      | "closeFail";

    type ExfatOptions = Readonly<{
      // Final names whose hard link reports EISDIR (default: every record).
      eisdirFor?: (name: string) => boolean;
      // Injected non-EISDIR link failure (no EISDIR at all).
      linkError?: () => unknown;
      // Runs immediately before the exclusive final create (race / pre-existing entry).
      beforeFinalCreate?: (finalPath: string) => Promise<void>;
      fault?: FinalFault;
      faultFor?: string;
      failFinalUnlinkFor?: string;
      chunkedWrites?: boolean;
    }>;

    const coded = (message: string, code: string) => Object.assign(new Error(message), { code });

    /** Simulated exFAT record publication over a real temp media root; events record every step. */
    function exfatFileSystem(options: ExfatOptions = {}): RecordingFileSystem {
      const recording = recordingFileSystem();
      const { events } = recording;
      const base = recording.fileSystem;
      const fileSystem: GoogleGenAiCompletionFileSystem = {
        ...base,
        link: async (existingPath, newPath) => {
          const name = basename(newPath);
          if (options.linkError !== undefined) {
            events.push(`link:${name}`);
            throw options.linkError();
          }
          if (options.eisdirFor !== undefined && !options.eisdirFor(name)) return base.link(existingPath, newPath);
          events.push(`link:${name}`);
          throw coded("EISDIR: illegal operation on a directory, link SECRET", "EISDIR");
        },
        open: async (path, flags) => {
          const name = basename(path);
          if (name.startsWith(".")) return base.open(path, flags);
          await options.beforeFinalCreate?.(path);
          events.push(`open:${flags}:${name}`);
          const handle = await open(path, flags);
          const faulted = options.fault !== undefined && (options.faultFor === undefined || options.faultFor === name);
          return {
            writeFile: async (data) => {
              events.push(`write:${name}`);
              if (faulted && (options.fault === "ENOSPC" || options.fault === "EIO")) {
                throw coded(`${options.fault} SECRET final write`, options.fault);
              }
              if (faulted && options.fault === "partialThenFail") {
                const first = data.subarray(0, Math.max(1, Math.floor(data.byteLength / 2)));
                const { bytesWritten } = await handle.write(first, 0, first.byteLength, 0);
                events.push(`write:partial:${bytesWritten}`);
                throw coded("EIO SECRET second write", "EIO");
              }
              if (faulted && options.fault === "silentShort") {
                await handle.writeFile(data.subarray(0, data.byteLength - 7));
                return;
              }
              if (faulted && options.fault === "corruptSameLength") {
                const corrupted = Buffer.from(data);
                corrupted[corrupted.byteLength - 3] = 0x41;
                await handle.writeFile(corrupted);
                return;
              }
              if (options.chunkedWrites === true) {
                // Several genuinely short writes behind the complete-write primitive.
                let offset = 0;
                const step = Math.max(1, Math.ceil(data.byteLength / 3));
                while (offset < data.byteLength) {
                  const { bytesWritten } = await handle.write(data, offset, Math.min(step, data.byteLength - offset), offset);
                  events.push(`write:chunk:${name}`);
                  offset += bytesWritten;
                }
                return;
              }
              await handle.writeFile(data);
            },
            sync: async () => {
              if (faulted && options.fault === "syncFail") throw coded("EIO SECRET final sync", "EIO");
              await handle.sync();
              events.push(`sync:${name}`);
            },
            close: async () => {
              if (faulted && options.fault === "closeFail") {
                // The descriptor is really released, then the close stage reports failure.
                await handle.close();
                events.push(`close:fault:${name}`);
                throw coded("EIO SECRET final close", "EIO");
              }
              await handle.close();
              events.push(`close:${name}`);
            },
          };
        },
        unlink: async (path) => {
          if (basename(path) === options.failFinalUnlinkFor) {
            events.push(`unlink:fault:${basename(path)}`);
            throw coded("EBUSY SECRET unlink", "EBUSY");
          }
          return base.unlink(path);
        },
      };
      return { fileSystem, events };
    }

    async function settled(promise: Promise<unknown>): Promise<unknown> {
      try {
        await promise;
      } catch (error) {
        return error;
      }
      throw new Error("Expected the persistence to reject.");
    }

    const serialized = (record: unknown) => `${JSON.stringify(record, null, 2)}\n`;

    function names(mediaRoot: string) {
      return {
        generation: basename(generationRecordPathFor(mediaRoot)),
        completion: basename(completionPathFor(mediaRoot)),
      };
    }

    async function partEntries(mediaRoot: string): Promise<string[]> {
      return (await shotDirectoryEntries(mediaRoot)).filter((entry) => entry.endsWith(".part"));
    }

    function persist(
      shot: Awaited<ReturnType<typeof prepareShot>>,
      fileSystem: GoogleGenAiCompletionFileSystem,
    ) {
      return persistGoogleGenAiSingleShotCompletion(
        persistenceInput(shot.mediaRoot, shot.materializedOutput),
        { now: () => NOW, fileSystem },
      );
    }

    /** Publishes both records normally, captures their bytes, then removes them (a clean SUBMITTED shot). */
    async function seedRecordBytes(shot: Awaited<ReturnType<typeof prepareShot>>) {
      await persist(shot, recordingFileSystem().fileSystem);
      const generation = await readFile(generationRecordPathFor(shot.mediaRoot));
      const completion = await readFile(completionPathFor(shot.mediaRoot));
      await unlink(completionPathFor(shot.mediaRoot));
      await unlink(generationRecordPathFor(shot.mediaRoot));
      return { generation, completion };
    }

    function expectSanitized(error: unknown) {
      expect(String(error)).not.toMatch(/SECRET|EIO|ENOSPC|EBUSY|EISDIR/);
      expect(String(error)).not.toContain(INTERACTION_ID);
    }

    async function expectNoOwnedRecord(mediaRoot: string, name: string) {
      expect(await shotDirectoryEntries(mediaRoot)).not.toContain(name);
      expect(await partEntries(mediaRoot)).toEqual([]);
      expect(await pathExists(completionPathFor(mediaRoot))).toBe(false);
      expect((await inspectGoogleGenAiExecutionLifecycle(mediaRoot, "EP92", "S01")).state).toBe("SUBMITTED");
    }

    it("PT1 keeps the hard-link fast path: a successful link never creates a fallback final", async () => {
      const shot = await prepareShot();
      const recording = exfatFileSystem({ eisdirFor: () => false });
      const result = await persist(shot, recording.fileSystem);
      const { generation, completion } = names(shot.mediaRoot);
      expect(recording.events).toContain(`link:${generation}`);
      expect(recording.events).toContain(`link:${completion}`);
      expect(recording.events).not.toContain(`open:wx:${generation}`);
      expect(recording.events).not.toContain(`open:wx:${completion}`);
      expect(recording.events.filter((event) => event.startsWith("write:"))).toEqual([]);
      expect(await readFile(generationRecordPathFor(shot.mediaRoot), "utf8")).toBe(serialized(result.generationRecord));
      expect(await readFile(completionPathFor(shot.mediaRoot), "utf8")).toBe(serialized(result.completion));
    });

    it("PT2 publishes the GENERATION record through one exclusive final after EISDIR and re-reads it", async () => {
      const shot = await prepareShot();
      const { generation, completion } = names(shot.mediaRoot);
      const recording = exfatFileSystem({ eisdirFor: (name) => name === generation });
      const result = await persist(shot, recording.fileSystem);
      const at = (event: string) => recording.events.indexOf(event);
      expect(recording.events.filter((event) => event === `open:wx:${generation}`)).toHaveLength(1);
      expect(at(`link:${generation}`)).toBeLessThan(at(`open:wx:${generation}`));
      expect(at(`open:wx:${generation}`)).toBeLessThan(at(`write:${generation}`));
      expect(at(`write:${generation}`)).toBeLessThan(at(`sync:${generation}`));
      expect(at(`sync:${generation}`)).toBeLessThan(at(`close:${generation}`));
      expect(recording.events.slice(at(`close:${generation}`), at(`link:${completion}`))).toEqual([
        `close:${generation}`,
        expect.stringMatching(/^unlink:\..+\.part$/),
        "mkdir",
        expect.stringMatching(/^open:wx:\..+\.part$/),
        "write",
        "sync",
        "close",
      ]);
      expect(recording.events).not.toContain(`open:wx:${completion}`);
      expect(result.generationRecordAlreadyPresent).toBe(false);
      expect(await readFile(generationRecordPathFor(shot.mediaRoot), "utf8")).toBe(serialized(result.generationRecord));
      expect(await partEntries(shot.mediaRoot)).toEqual([]);
    });

    it("PT3 publishes the COMPLETION record through its own exclusive final after EISDIR", async () => {
      const shot = await prepareShot();
      const { generation, completion } = names(shot.mediaRoot);
      const recording = exfatFileSystem({ eisdirFor: (name) => name === completion });
      const result = await persist(shot, recording.fileSystem);
      expect(recording.events).not.toContain(`open:wx:${generation}`);
      expect(recording.events.filter((event) => event === `open:wx:${completion}`)).toHaveLength(1);
      expect(recording.events).toContain(`sync:${completion}`);
      expect(recording.events).toContain(`close:${completion}`);
      expect(result.completionAlreadyPresent).toBe(false);
      expect(await readFile(completionPathFor(shot.mediaRoot), "utf8")).toBe(serialized(result.completion));
      expect((await inspectGoogleGenAiExecutionLifecycle(shot.mediaRoot, "EP92", "S01")).state).toBe("COMPLETED");
      expect(await partEntries(shot.mediaRoot)).toEqual([]);
    });

    it("PT4 publishes BOTH records through the fallback with several short writes and exact bytes", async () => {
      const shot = await prepareShot();
      const { generation, completion } = names(shot.mediaRoot);
      const recording = exfatFileSystem({ chunkedWrites: true });
      const result = await persist(shot, recording.fileSystem);
      expect(recording.events.filter((event) => event === `write:chunk:${generation}`).length).toBeGreaterThan(1);
      expect(recording.events.filter((event) => event === `write:chunk:${completion}`).length).toBeGreaterThan(1);
      expect(result.generationRecordAlreadyPresent).toBe(false);
      expect(result.completionAlreadyPresent).toBe(false);
      expect(await readFile(generationRecordPathFor(shot.mediaRoot), "utf8")).toBe(serialized(result.generationRecord));
      expect(await readFile(completionPathFor(shot.mediaRoot), "utf8")).toBe(serialized(result.completion));
      expect(await partEntries(shot.mediaRoot)).toEqual([]);
      expect((await inspectGoogleGenAiExecutionLifecycle(shot.mediaRoot, "EP92", "S01")).state).toBe("COMPLETED");
    });

    it("PT5 reuses an exact existing generation record under EISDIR without rewriting it", async () => {
      const shot = await prepareShot();
      const { generation, completion } = names(shot.mediaRoot);
      await persist(shot, recordingFileSystem().fileSystem);
      await unlink(completionPathFor(shot.mediaRoot));
      const before = await readFile(generationRecordPathFor(shot.mediaRoot));
      const recording = exfatFileSystem();
      const result = await persist(shot, recording.fileSystem);
      expect(result.generationRecordAlreadyPresent).toBe(true);
      expect(recording.events).not.toContain(`open:wx:${generation}`);
      expect(recording.events).toContain(`open:wx:${completion}`);
      expect((await readFile(generationRecordPathFor(shot.mediaRoot))).equals(before)).toBe(true);
      expect(await pathExists(completionPathFor(shot.mediaRoot))).toBe(true);
    });

    it("PT6 accepts matching records that appear before the exclusive create (wx EEXIST) without writing", async () => {
      const shot = await prepareShot();
      const seeded = await seedRecordBytes(shot);
      const recording = exfatFileSystem({
        beforeFinalCreate: async (finalPath) => {
          await writeFile(finalPath, finalPath === completionPathFor(shot.mediaRoot) ? seeded.completion : seeded.generation, { flag: "wx" });
        },
      });
      const result = await persist(shot, recording.fileSystem);
      expect(result.generationRecordAlreadyPresent).toBe(true);
      expect(result.completionAlreadyPresent).toBe(true);
      expect(recording.events.filter((event) => event.startsWith("write:"))).toEqual([]);
      expect((await readFile(generationRecordPathFor(shot.mediaRoot))).equals(seeded.generation)).toBe(true);
      expect((await readFile(completionPathFor(shot.mediaRoot))).equals(seeded.completion)).toBe(true);
      expect(await partEntries(shot.mediaRoot)).toEqual([]);
    });

    it("NT1 rejects a different record (raced in, then pre-existing) and never overwrites or deletes it", async () => {
      const shot = await prepareShot();
      const seeded = await seedRecordBytes(shot);
      const different = JSON.parse(seeded.generation.toString("utf8"));
      different.outputs[0].bytes += 1;
      const differentBytes = Buffer.from(serialized(different), "utf8");
      const raced = exfatFileSystem({
        beforeFinalCreate: async (finalPath) => {
          if (finalPath === generationRecordPathFor(shot.mediaRoot)) await writeFile(finalPath, differentBytes, { flag: "wx" });
        },
      });
      const racedError = await settled(persist(shot, raced.fileSystem));
      expect(String(racedError)).toMatch(/does not match the verified output evidence/);
      expect((await readFile(generationRecordPathFor(shot.mediaRoot))).equals(differentBytes)).toBe(true);
      expect(raced.events.filter((event) => event.startsWith("write:"))).toEqual([]);
      // The same record now pre-exists: rejected again, still untouched.
      const preexisting = exfatFileSystem();
      expect(String(await settled(persist(shot, preexisting.fileSystem)))).toMatch(/does not match the verified output evidence/);
      expect((await readFile(generationRecordPathFor(shot.mediaRoot))).equals(differentBytes)).toBe(true);
      expect(await pathExists(completionPathFor(shot.mediaRoot))).toBe(false);
    });

    it("NT2 rejects a truncated record that wins the exclusive create and leaves it in place", async () => {
      const shot = await prepareShot();
      const seeded = await seedRecordBytes(shot);
      const truncated = seeded.generation.subarray(0, 40);
      const recording = exfatFileSystem({
        beforeFinalCreate: async (finalPath) => {
          if (finalPath === generationRecordPathFor(shot.mediaRoot)) await writeFile(finalPath, truncated, { flag: "wx" });
        },
      });
      await settled(persist(shot, recording.fileSystem));
      expect((await readFile(generationRecordPathFor(shot.mediaRoot))).equals(truncated)).toBe(true);
      expect(recording.events).not.toContain(`unlink:${basename(generationRecordPathFor(shot.mediaRoot))}`);
      expect(recording.events.filter((event) => event.startsWith("write:"))).toEqual([]);
      expect(await pathExists(completionPathFor(shot.mediaRoot))).toBe(false);
    });

    it("NT3 fails closed when a directory occupies the final path and leaves the directory untouched", async () => {
      const shot = await prepareShot();
      const recordPath = generationRecordPathFor(shot.mediaRoot);
      const recording = exfatFileSystem({
        beforeFinalCreate: async (finalPath) => {
          if (finalPath === recordPath) await mkdir(finalPath);
        },
      });
      await settled(persist(shot, recording.fileSystem));
      expect((await stat(recordPath)).isDirectory()).toBe(true);
      expect(recording.events.filter((event) => event.startsWith("write:"))).toEqual([]);
      expect(await pathExists(completionPathFor(shot.mediaRoot))).toBe(false);
    });

    const NON_EISDIR_LINK_FAILURES: ReadonlyArray<readonly [string, () => unknown]> = [
      ["EPERM", () => coded("EPERM SECRET", "EPERM")],
      ["EACCES", () => coded("EACCES SECRET", "EACCES")],
      ["ENOTSUP", () => coded("ENOTSUP SECRET", "ENOTSUP")],
      ["EXDEV", () => coded("EXDEV SECRET", "EXDEV")],
      ["EIO", () => coded("EIO SECRET", "EIO")],
      ["ENOENT", () => coded("ENOENT SECRET", "ENOENT")],
      ["unknown code", () => coded("SECRET", "UNKNOWN_CODE")],
      ["non-object", () => "EISDIR"],
    ];

    it.each(NON_EISDIR_LINK_FAILURES)("NT4 a %s link failure keeps the no-fallback error and never creates the final", async (_label, linkError) => {
      const shot = await prepareShot();
      const recording = exfatFileSystem({ linkError });
      const error = await settled(persist(shot, recording.fileSystem));
      expect(String(error)).toMatch(/No rename, copy, or direct-write fallback is permitted/);
      expect(recording.events.some((event) => /^open:wx:[^.]/.test(event))).toBe(false);
      await expectNoOwnedRecord(shot.mediaRoot, names(shot.mediaRoot).generation);
    });

    it("NT5 a positive partial write followed by a failing write removes the owned final and fails", async () => {
      const shot = await prepareShot();
      const { generation } = names(shot.mediaRoot);
      const recording = exfatFileSystem({ fault: "partialThenFail", faultFor: generation });
      const error = await settled(persist(shot, recording.fileSystem));
      expect(String(error)).toMatch(/exclusive-copy publication to .+ failed\./);
      expectSanitized(error);
      const partial = recording.events.find((event) => event.startsWith("write:partial:"));
      expect(Number(partial?.split(":")[2])).toBeGreaterThan(0);
      expect(recording.events.indexOf(`unlink:${generation}`)).toBeGreaterThan(recording.events.indexOf(partial ?? ""));
      await expectNoOwnedRecord(shot.mediaRoot, generation);
    });

    it("NT6 a silently short final is caught by the byte re-read and removed", async () => {
      const shot = await prepareShot();
      const { generation } = names(shot.mediaRoot);
      const recording = exfatFileSystem({ fault: "silentShort", faultFor: generation });
      const error = await settled(persist(shot, recording.fileSystem));
      expect((error as Error).cause).toMatchObject({ message: expect.stringMatching(/does not match the serialized record/) });
      expect(recording.events).toContain(`close:${generation}`);
      expect(recording.events).toContain(`unlink:${generation}`);
      await expectNoOwnedRecord(shot.mediaRoot, generation);
    });

    it.each(["ENOSPC", "EIO"] as const)("NT7 a %s final write failure removes the owned final, sanitized", async (code) => {
      const shot = await prepareShot();
      const { generation } = names(shot.mediaRoot);
      const recording = exfatFileSystem({ fault: code, faultFor: generation });
      const error = await settled(persist(shot, recording.fileSystem));
      expectSanitized(error);
      expect((error as Error).cause).toMatchObject({ code });
      expect(recording.events).toContain(`unlink:${generation}`);
      await expectNoOwnedRecord(shot.mediaRoot, generation);
    });

    it("NT8 a final sync failure never publishes and removes the owned final", async () => {
      const shot = await prepareShot();
      const { generation } = names(shot.mediaRoot);
      const recording = exfatFileSystem({ fault: "syncFail", faultFor: generation });
      const error = await settled(persist(shot, recording.fileSystem));
      expectSanitized(error);
      expect(recording.events).not.toContain(`sync:${generation}`);
      expect(recording.events).toContain(`unlink:${generation}`);
      await expectNoOwnedRecord(shot.mediaRoot, generation);
    });

    it("NT9 a fallback FINAL close failure is never success: no retried close, owned final removed", async () => {
      const shot = await prepareShot();
      const { generation } = names(shot.mediaRoot);
      const recording = exfatFileSystem({ fault: "closeFail", faultFor: generation });
      const error = await settled(persist(shot, recording.fileSystem));
      expectSanitized(error);
      const at = (event: string) => recording.events.indexOf(event);
      expect(at(`sync:${generation}`)).toBeLessThan(at(`close:fault:${generation}`));
      expect(recording.events.filter((event) => event.startsWith("close:") && event.endsWith(generation))).toEqual([`close:fault:${generation}`]);
      expect(at(`unlink:${generation}`)).toBeGreaterThan(at(`close:fault:${generation}`));
      await expectNoOwnedRecord(shot.mediaRoot, generation);
    });

    it("NT10 same-length corruption is caught by the byte re-read and the owned final removed", async () => {
      const shot = await prepareShot();
      const { generation } = names(shot.mediaRoot);
      const recording = exfatFileSystem({ fault: "corruptSameLength", faultFor: generation });
      const error = await settled(persist(shot, recording.fileSystem));
      expect((error as Error).cause).toMatchObject({ message: expect.stringMatching(/does not match the serialized record/) });
      expect(recording.events).toContain(`unlink:${generation}`);
      await expectNoOwnedRecord(shot.mediaRoot, generation);
    });

    it("NT11 an owned-final cleanup failure is surfaced as an AggregateError, never success", async () => {
      const shot = await prepareShot();
      const { generation } = names(shot.mediaRoot);
      const recording = exfatFileSystem({ fault: "EIO", faultFor: generation, failFinalUnlinkFor: generation });
      const error = await settled(persist(shot, recording.fileSystem));
      expect(error).toBeInstanceOf(AggregateError);
      expect(String(error)).toMatch(/partial record could not be removed/);
      expectSanitized(error);
      expect(recording.events).toContain(`unlink:fault:${generation}`);
      // The temp record is still cleaned up; no completion exists.
      expect(await partEntries(shot.mediaRoot)).toEqual([]);
      expect(await pathExists(completionPathFor(shot.mediaRoot))).toBe(false);
      expect((await inspectGoogleGenAiExecutionLifecycle(shot.mediaRoot, "EP92", "S01")).state).toBe("SUBMITTED");
    });

    it("NT12 generation success then completion failure stays SUBMITTED, and an offline retry reuses the generation record", async () => {
      const shot = await prepareShot();
      const { generation, completion } = names(shot.mediaRoot);
      const failing = exfatFileSystem({ fault: "syncFail", faultFor: completion });
      const error = await settled(persist(shot, failing.fileSystem));
      expectSanitized(error);
      expect(failing.events).toContain(`open:wx:${generation}`);
      const generationBytes = await readFile(generationRecordPathFor(shot.mediaRoot));
      expect(JSON.parse(generationBytes.toString("utf8"))).toMatchObject({
        providerExecutionId: INTERACTION_ID,
        reservationId: RESERVATION_ID,
        recordedAt: NOW,
      });
      expect(failing.events).toContain(`unlink:${completion}`);
      expect(await pathExists(completionPathFor(shot.mediaRoot))).toBe(false);
      expect(await partEntries(shot.mediaRoot)).toEqual([]);
      expect((await inspectGoogleGenAiExecutionLifecycle(shot.mediaRoot, "EP92", "S01")).state).toBe("SUBMITTED");

      // Offline retry: the generation record is verified and reused, never rewritten; completion then persists.
      const healthy = exfatFileSystem();
      const result = await persist(shot, healthy.fileSystem);
      expect(result.generationRecordAlreadyPresent).toBe(true);
      expect(result.completionAlreadyPresent).toBe(false);
      expect(healthy.events).not.toContain(`open:wx:${generation}`);
      expect((await readFile(generationRecordPathFor(shot.mediaRoot))).equals(generationBytes)).toBe(true);
      expect(await readFile(completionPathFor(shot.mediaRoot), "utf8")).toBe(serialized(result.completion));
      expect((await inspectGoogleGenAiExecutionLifecycle(shot.mediaRoot, "EP92", "S01")).state).toBe("COMPLETED");
    });

    it("NT13 a crash-left partial generation record fails closed and is never overwritten or deleted", async () => {
      const shot = await prepareShot();
      const seeded = await seedRecordBytes(shot);
      const crashLeft = seeded.generation.subarray(0, seeded.generation.byteLength - 20);
      await writeFile(generationRecordPathFor(shot.mediaRoot), crashLeft, { flag: "wx" });
      const recording = exfatFileSystem();
      await settled(persist(shot, recording.fileSystem));
      expect((await readFile(generationRecordPathFor(shot.mediaRoot))).equals(crashLeft)).toBe(true);
      expect(recording.events.some((event) => /^open:wx:[^.]/.test(event))).toBe(false);
      expect(recording.events.some((event) => event.startsWith("unlink:"))).toBe(false);
      expect(await pathExists(completionPathFor(shot.mediaRoot))).toBe(false);
    });
  },
);
