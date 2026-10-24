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
  createExecutionSubmissionPath,
} from "../src/execution/executionSubmissionPath.js";

import {
  materializeGoogleGenAiSingleShotOutput,
  type GoogleGenAiOutputFileHandle,
  type GoogleGenAiOutputFileSystem,
  type GoogleGenAiOutputRetriever,
  type GoogleGenAiOutputUriDownloader,
  type GoogleGenAiSingleShotOutputMaterializationInput,
} from "../src/execution/providers/materializeGoogleGenAiSingleShotOutput.js";

import {
  createGoogleGenAiVideoOutputPath,
} from "../src/googleGenai/output/googleGenAiVideoOutputPath.js";

import type {
  GoogleGenAiPolicy,
} from "../src/schemas/googleGenAiPolicy.schema.js";

import {
  loadGoogleGenAiPolicy,
} from "../src/validation/loadGoogleGenAiPolicy.js";

const MATERIALIZER_SOURCE =
  "src/execution/providers/materializeGoogleGenAiSingleShotOutput.ts";

const INTERACTION_ID =
  "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";

const MAX_OUTPUT_BYTES =
  4096;

const DURABLE_RECORD_FILES = [
  "EP92_S01.execution-reservation.json",
  "EP92_S01.execution-submission.json",
];

const reservationDependencies = {
  now: () =>
    "2026-10-24T12:00:00.000Z",

  createReservationId: () =>
    "11111111-1111-4111-8111-111111111111",
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
      "busybookie-google-output",
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

async function makeMediaRoot():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-google-genai-output-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

async function persistSubmission(
  mediaRoot:
    string,
  provider:
    "GOOGLE_GENAI" | "VEO" =
      "GOOGLE_GENAI",
): Promise<void> {
  const reservation =
    await createExecutionReservation(
      mediaRoot,
      {
        episodeId:
          "EP92",

        shotId:
          "S01",

        provider,
      },
      reservationDependencies,
    );

  if (provider === "VEO") {
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
          "VEO",

        providerExecutionId:
          "models/veo/operations/google-alias-check",

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
              "Busybookie Veo submission for Google materialization test.",

            sourceImagePath:
              "D:/Busybookie/Production/references/EP92/S01/reference.png",

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

    return;
  }

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
            "Busybookie Google GenAI materialization test.",

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

function materializationInput(
  mediaRoot:
    string,
  maxOutputBytes:
    number =
      MAX_OUTPUT_BYTES,
): GoogleGenAiSingleShotOutputMaterializationInput {
  return {
    mediaRoot,

    episodeId:
      "EP92",

    shotId:
      "S01",

    maxOutputBytes,
  };
}

function outputPathFor(
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

function inlineVideo(
  bytes:
    Buffer =
      makeMp4(),
) {
  return {
    type:
      "video",

    mime_type:
      "video/mp4",

    data:
      bytes.toString(
        "base64",
      ),
  };
}

function retrieverReturning(
  outputVideo:
    unknown,
  overrides:
    Readonly<{
      id?:
        unknown;

      status?:
        unknown;
    }> =
      {},
) {
  return vi.fn<GoogleGenAiOutputRetriever>(
    async (providerExecutionId) => ({
      id:
        "id" in overrides
          ? overrides.id
          : providerExecutionId,

      status:
        "status" in overrides
          ? overrides.status
          : "completed",

      outputVideo,
    }),
  );
}

function downloaderReturning(
  bytes:
    Uint8Array,
) {
  return vi.fn<GoogleGenAiOutputUriDownloader>(
    async () =>
      bytes,
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

type RecordingFileSystem =
  Readonly<{
    fileSystem:
      GoogleGenAiOutputFileSystem;

    events:
      string[];

    openedPaths:
      Array<
        Readonly<{
          path:
            string;

          flags:
            string;
        }>
      >;
  }>;

function recordingFileSystem(
  overrides:
    Partial<GoogleGenAiOutputFileSystem> =
      {},
): RecordingFileSystem {
  const events:
    string[] = [];

  const openedPaths:
    Array<
      Readonly<{
        path:
          string;

        flags:
          string;
      }>
    > = [];

  const base:
    GoogleGenAiOutputFileSystem = {
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
            `open:${flags}`,
          );

          openedPaths.push({
            path,
            flags,
          });

          const handle =
            await open(
              path,
              flags,
            );

          const wrapped:
            GoogleGenAiOutputFileHandle = {
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

              read:
                (
                  buffer,
                  offset,
                  length,
                  position,
                ) =>
                  handle.read(
                    buffer,
                    offset,
                    length,
                    position,
                  ),
            };

          return wrapped;
        },

      link:
        async (
          existingPath,
          newPath,
        ) => {
          events.push(
            "link",
          );

          await link(
            existingPath,
            newPath,
          );
        },

      unlink:
        async (path) => {
          events.push(
            "unlink",
          );

          await unlink(
            path,
          );
        },

      lstat:
        async (path) => {
          events.push(
            "lstat",
          );

          return lstat(
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

    openedPaths,
  };
}

async function shotDirectoryEntries(
  mediaRoot:
    string,
): Promise<string[]> {
  return (
    await readdir(
      dirname(
        outputPathFor(
          mediaRoot,
        ),
      ),
    )
  ).sort();
}

describe(
  "Busybookie dormant Google GenAI output materialization",
  () => {
    describe(
      "authority and lifecycle",
      () => {
        it(
          "requires a durable GOOGLE_GENAI submission before retrieval",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const retrieveOutput =
              retrieverReturning(
                inlineVideo(),
              );

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput,
                  downloadUri:
                    unusedDownloader(),
                },
              ),
            ).rejects.toThrow(
              /requires a durable execution submission/,
            );

            await persistSubmission(
              mediaRoot,
              "VEO",
            );

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput,
                  downloadUri:
                    unusedDownloader(),
                },
              ),
            ).rejects.toThrow(
              /requires a GOOGLE_GENAI execution submission; received VEO/,
            );

            expect(
              retrieveOutput,
            ).not.toHaveBeenCalled();
          },
        );

        it.each([
          "providerExecutionId",
          "interactionId",
          "provider",
        ])(
          "rejects a caller-supplied %s override before reading or retrieving",
          async (field) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const retrieveOutput =
              retrieverReturning(
                inlineVideo(),
              );

            const widenedInput = {
              ...materializationInput(
                mediaRoot,
              ),

              [field]:
                field === "provider"
                  ? "VEO"
                  : "v1_replacement-interaction",
            };

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                widenedInput,
                {
                  retrieveOutput,
                  downloadUri:
                    unusedDownloader(),
                },
              ),
            ).rejects.toThrow(
              /does not accept a caller-supplied/,
            );

            expect(
              retrieveOutput,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "retrieves exactly the persisted providerExecutionId once",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const retrieveOutput =
              retrieverReturning(
                inlineVideo(),
              );

            await materializeGoogleGenAiSingleShotOutput(
              materializationInput(
                mediaRoot,
              ),
              {
                retrieveOutput,
                downloadUri:
                  unusedDownloader(),
              },
            );

            expect(
              retrieveOutput,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              retrieveOutput,
            ).toHaveBeenCalledWith(
              INTERACTION_ID,
            );
          },
        );

        it.each([
          [
            "different",
            "v1_other",
          ],
          [
            "padded",
            ` ${INTERACTION_ID} `,
          ],
          [
            "blank",
            "  ",
          ],
          [
            "numeric",
            7,
          ],
          [
            "missing",
            undefined,
          ],
        ])(
          "rejects a %s returned interaction id without writing",
          async (
            _label,
            id,
          ) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(),
                      {
                        id,
                      },
                    ),
                  downloadUri:
                    unusedDownloader(),
                },
              ),
            ).rejects.toThrow(
              /interaction id|does not match durable providerExecutionId/,
            );

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              DURABLE_RECORD_FILES,
            );
          },
        );

        it.each([
          [
            "queued",
            /PENDING/,
          ],
          [
            "in_progress",
            /PENDING/,
          ],
          [
            "failed",
            /TERMINAL_FAILURE/,
          ],
          [
            "cancelled",
            /TERMINAL_FAILURE/,
          ],
          [
            "incomplete",
            /TERMINAL_FAILURE/,
          ],
          [
            "budget_exceeded",
            /TERMINAL_FAILURE/,
          ],
          [
            "requires_action",
            /ACTION_REQUIRED_UNSUPPORTED/,
          ],
          [
            "succeeded",
            /not recognized/,
          ],
          [
            "",
            /not recognized/,
          ],
          [
            undefined,
            /must be a string/,
          ],
        ])(
          "rejects remote status %j without writing",
          async (
            status,
            message,
          ) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(),
                      {
                        status,
                      },
                    ),
                  downloadUri:
                    unusedDownloader(),
                },
              ),
            ).rejects.toThrow(
              message,
            );

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              DURABLE_RECORD_FILES,
            );
          },
        );
      },
    );

    describe(
      "maxOutputBytes and output_video validation",
      () => {
        it.each([
          0,
          -1,
          1.5,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          Number.MAX_SAFE_INTEGER + 1,
        ])(
          "rejects maxOutputBytes %s before retrieval",
          async (maxOutputBytes) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const retrieveOutput =
              retrieverReturning(
                inlineVideo(),
              );

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                  maxOutputBytes,
                ),
                {
                  retrieveOutput,
                  downloadUri:
                    unusedDownloader(),
                },
              ),
            ).rejects.toThrow(
              /maxOutputBytes as a positive safe integer/,
            );

            expect(
              retrieveOutput,
            ).not.toHaveBeenCalled();
          },
        );

        it.each([
          [
            "missing output_video",
            undefined,
            /output_video must be an object/,
          ],
          [
            "array output_video",
            [],
            /output_video must be an object/,
          ],
          [
            "string output_video",
            "video",
            /output_video must be an object/,
          ],
          [
            "wrong type",
            {
              ...inlineVideo(),

              type:
                "image",
            },
            /type must be "video"/,
          ],
          [
            "missing mime_type",
            {
              type:
                "video",

              data:
                makeMp4().toString(
                  "base64",
                ),
            },
            /mime_type is required/,
          ],
          [
            "non-mp4 mime_type",
            {
              ...inlineVideo(),

              mime_type:
                "video/webm",
            },
            /mime_type must be video\/mp4/,
          ],
          [
            "neither data nor uri",
            {
              type:
                "video",

              mime_type:
                "video/mp4",
            },
            /exactly one of data or uri\./,
          ],
          [
            "both data and uri",
            {
              ...inlineVideo(),

              uri:
                "https://storage.example.com/video.mp4",
            },
            /not both/,
          ],
          [
            "blank data",
            {
              type:
                "video",

              mime_type:
                "video/mp4",

              data:
                "   ",
            },
            /data must not be blank/,
          ],
          [
            "blank uri",
            {
              type:
                "video",

              mime_type:
                "video/mp4",

              uri:
                "",
            },
            /uri must not be blank/,
          ],
          [
            "non-string data",
            {
              type:
                "video",

              mime_type:
                "video/mp4",

              data:
                42,
            },
            /data must be a string/,
          ],
        ])(
          "rejects %s without writing",
          async (
            _label,
            outputVideo,
            message,
          ) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const downloadUri =
              unusedDownloader();

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      outputVideo,
                    ),
                  downloadUri,
                },
              ),
            ).rejects.toThrow(
              message,
            );

            expect(
              downloadUri,
            ).not.toHaveBeenCalled();

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              DURABLE_RECORD_FILES,
            );
          },
        );
      },
    );

    describe(
      "inline data",
      () => {
        function base64WithMutation(
          mutate:
            (base64: string) => string,
        ): string {
          return mutate(
            makeMp4().toString(
              "base64",
            ),
          );
        }

        it.each([
          [
            "internal whitespace",
            base64WithMutation(
              (base64) =>
                `${base64.slice(0, 8)} ${base64.slice(8)}`,
            ),
          ],
          [
            "newline",
            base64WithMutation(
              (base64) =>
                `${base64.slice(0, 8)}\n${base64.slice(8)}`,
            ),
          ],
          [
            "illegal characters",
            base64WithMutation(
              (base64) =>
                `${base64.slice(0, 4)}*!@#${base64.slice(8)}`,
            ),
          ],
          [
            "url-safe alphabet",
            "AAAAGGZ0eXBpc29tAAACAGlzb21tcDQx-_-_",
          ],
          [
            "missing padding",
            "AAAAGGZ0eXBpc29tAA",
          ],
          [
            "padding in the middle",
            "AAAA=AAAAAAA",
          ],
          [
            "excess padding",
            "AAAAAA===",
          ],
          [
            "noncanonical trailing bits",
            "AAAAGGZ0eXBpc29tAAACAGlzb21tcDQxAB==",
          ],
        ])(
          "rejects %s base64 without writing",
          async (
            _label,
            data,
          ) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning({
                      type:
                        "video",

                      mime_type:
                        "video/mp4",

                      data,
                    }),
                  downloadUri:
                    unusedDownloader(),
                },
              ),
            ).rejects.toThrow(
              /strict standard Base64|not canonical Base64/,
            );

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              DURABLE_RECORD_FILES,
            );
          },
        );

        it(
          "rejects oversized inline data before decoding or writing",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const bytes =
              makeMp4();

            const fromSpy =
              vi.spyOn(
                Buffer,
                "from",
              );

            const recording =
              recordingFileSystem();

            try {
              await expect(
                materializeGoogleGenAiSingleShotOutput(
                  materializationInput(
                    mediaRoot,
                    bytes.byteLength - 1,
                  ),
                  {
                    retrieveOutput:
                      retrieverReturning(
                        inlineVideo(
                          bytes,
                        ),
                      ),
                    downloadUri:
                      unusedDownloader(),
                    fileSystem:
                      recording.fileSystem,
                  },
                ),
              ).rejects.toThrow(
                /would decode to \d+ bytes, exceeding maxOutputBytes/,
              );

              expect(
                fromSpy.mock.calls.some(
                  (call) =>
                    call.includes(
                      "base64",
                    ),
                ),
              ).toBe(
                false,
              );
            } finally {
              fromSpy.mockRestore();
            }

            expect(
              recording.events,
            ).toEqual([]);
          },
        );

        it(
          "accepts inline data exactly at maxOutputBytes",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const bytes =
              makeMp4();

            const result =
              await materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                  bytes.byteLength,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(
                        bytes,
                      ),
                    ),
                  downloadUri:
                    unusedDownloader(),
                },
              );

            expect(
              result.byteCount,
            ).toBe(
              bytes.byteLength,
            );
          },
        );

        it(
          "rejects zero decoded bytes",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning({
                      type:
                        "video",

                      mime_type:
                        "video/mp4",

                      data:
                        "====",
                    }),
                  downloadUri:
                    unusedDownloader(),
                },
              ),
            ).rejects.toThrow(
              /strict standard Base64|must not be empty/,
            );
          },
        );

        it.each([
          [
            "too short",
            Buffer.from(
              "0000ftyp",
              "latin1",
            ),
          ],
          [
            "missing ftyp",
            Buffer.concat([
              Buffer.from([
                0,
                0,
                0,
                24,
              ]),
              Buffer.from(
                "moovisom\u0000\u0000\u0002\u0000isommp41",
                "latin1",
              ),
            ]),
          ],
          [
            "box size larger than data",
            (() => {
              const bytes =
                makeMp4();

              bytes.writeUInt32BE(
                bytes.byteLength + 1,
                0,
              );

              return bytes;
            })(),
          ],
          [
            "box size below minimum",
            (() => {
              const bytes =
                makeMp4();

              bytes.writeUInt32BE(
                8,
                0,
              );

              return bytes;
            })(),
          ],
          [
            "misaligned compatible brands",
            (() => {
              const bytes =
                makeMp4();

              bytes.writeUInt32BE(
                22,
                0,
              );

              return bytes;
            })(),
          ],
          [
            "plain text",
            Buffer.from(
              "this is definitely not an mp4 file",
              "utf8",
            ),
          ],
        ])(
          "rejects inline bytes with %s MP4 structure",
          async (
            _label,
            bytes,
          ) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(
                        bytes,
                      ),
                    ),
                  downloadUri:
                    unusedDownloader(),
                },
              ),
            ).rejects.toThrow(
              /MP4|ftyp/,
            );

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              DURABLE_RECORD_FILES,
            );
          },
        );

        it(
          "materializes valid bounded inline MP4 bytes without calling the URI downloader",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const bytes =
              makeMp4();

            const downloadUri =
              unusedDownloader();

            const result =
              await materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(
                        bytes,
                      ),
                    ),
                  downloadUri,
                },
              );

            expect(
              result,
            ).toStrictEqual({
              provider:
                "GOOGLE_GENAI",

              providerExecutionId:
                INTERACTION_ID,

              outputIndex:
                1,

              outputPath:
                outputPathFor(
                  mediaRoot,
                ),

              mimeType:
                "video/mp4",

              byteCount:
                bytes.byteLength,

              sha256:
                sha256Hex(
                  bytes,
                ),

              sourceKind:
                "INLINE_DATA",

              alreadyPresent:
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
              result.sha256,
            ).toMatch(
              /^[0-9a-f]{64}$/,
            );

            expect(
              (
                await readFile(
                  result.outputPath,
                )
              ).equals(
                bytes,
              ),
            ).toBe(
              true,
            );

            expect(
              downloadUri,
            ).not.toHaveBeenCalled();

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              [
                ...DURABLE_RECORD_FILES,
                basename(
                  result.outputPath,
                ),
              ].sort(),
            );
          },
        );
      },
    );

    describe(
      "uri source",
      () => {
        function uriVideo(
          uri:
            string,
        ) {
          return {
            type:
              "video",

            mime_type:
              "video/mp4",

            uri,
          };
        }

        it.each([
          [
            "http",
            "http://storage.example.com/video.mp4",
            /must use https/,
          ],
          [
            "ftp",
            "ftp://storage.example.com/video.mp4",
            /must use https/,
          ],
          [
            "file",
            "file:///C:/video.mp4",
            /must use https/,
          ],
          [
            "username",
            "https://user@storage.example.com/video.mp4",
            /must not contain user credentials/,
          ],
          [
            "username and password",
            "https://user:secret@storage.example.com/video.mp4",
            /must not contain user credentials/,
          ],
          [
            "not a URL",
            "storage.example.com/video.mp4",
            /not a valid URL/,
          ],
          [
            "blank host",
            "https:///video.mp4",
            /hostname|not a valid URL|canonical/,
          ],
          [
            "non-canonical host case",
            "https://Storage.Example.com/video.mp4",
            /canonical/,
          ],
          [
            "non-canonical dot segments",
            "https://storage.example.com/a/../video.mp4",
            /canonical/,
          ],
          [
            "unencoded space",
            "https://storage.example.com/my video.mp4",
            /canonical/,
          ],
          [
            "backslash separators",
            "https:\\\\storage.example.com\\video.mp4",
            /canonical/,
          ],
        ])(
          "rejects a %s uri before downloading",
          async (
            _label,
            uri,
            message,
          ) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const downloadUri =
              unusedDownloader();

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      uriVideo(
                        uri,
                      ),
                    ),
                  downloadUri,
                },
              ),
            ).rejects.toThrow(
              message,
            );

            expect(
              downloadUri,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "downloads exactly once with the exact uri and maxOutputBytes and materializes valid bytes",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const uri =
              "https://storage.example.com/videos/output.mp4?token=abc";

            const bytes =
              makeMp4(
                "uri-sourced-video",
              );

            const downloadUri =
              downloaderReturning(
                new Uint8Array(
                  bytes,
                ),
              );

            const result =
              await materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      uriVideo(
                        uri,
                      ),
                    ),
                  downloadUri,
                },
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

            expect(
              result.sourceKind,
            ).toBe(
              "URI",
            );

            expect(
              result.sha256,
            ).toBe(
              sha256Hex(
                bytes,
              ),
            );

            expect(
              (
                await readFile(
                  result.outputPath,
                )
              ).equals(
                bytes,
              ),
            ).toBe(
              true,
            );
          },
        );

        it.each([
          [
            "zero-byte",
            new Uint8Array(),
            /must not be empty/,
          ],
          [
            "oversized",
            new Uint8Array(
              MAX_OUTPUT_BYTES + 1,
            ),
            /exceeding maxOutputBytes/,
          ],
          [
            "invalid MP4",
            new Uint8Array(
              Buffer.from(
                "not an mp4 payload at all",
                "utf8",
              ),
            ),
            /MP4|ftyp/,
          ],
        ])(
          "rejects a %s downloader result without writing",
          async (
            _label,
            bytes,
            message,
          ) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const downloadUri =
              downloaderReturning(
                bytes,
              );

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      uriVideo(
                        "https://storage.example.com/video.mp4",
                      ),
                    ),
                  downloadUri,
                },
              ),
            ).rejects.toThrow(
              message,
            );

            expect(
              downloadUri,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              DURABLE_RECORD_FILES,
            );
          },
        );

        it(
          "propagates a downloader failure once without retrying or writing",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const failure =
              new Error(
                "Mock bounded download failure.",
              );

            const downloadUri =
              vi.fn<GoogleGenAiOutputUriDownloader>(
                async () => {
                  throw failure;
                },
              );

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      uriVideo(
                        "https://storage.example.com/video.mp4",
                      ),
                    ),
                  downloadUri,
                },
              ),
            ).rejects.toBe(
              failure,
            );

            expect(
              downloadUri,
            ).toHaveBeenCalledTimes(
              1,
            );

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              DURABLE_RECORD_FILES,
            );
          },
        );
      },
    );

    describe(
      "hard-link publication",
      () => {
        it(
          "writes an exclusive same-directory temp file, fsyncs and closes it, then hard-links it",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const recording =
              recordingFileSystem();

            const result =
              await materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(),
                    ),
                  downloadUri:
                    unusedDownloader(),
                  fileSystem:
                    recording.fileSystem,
                },
              );

            expect(
              recording.events,
            ).toEqual([
              "mkdir",
              "lstat",
              "open:wx",
              "write",
              "sync",
              "close",
              "link",
              "unlink",
            ]);

            const temporaryOpen =
              recording.openedPaths[0];

            expect(
              temporaryOpen?.flags,
            ).toBe(
              "wx",
            );

            expect(
              dirname(
                temporaryOpen?.path ?? "",
              ),
            ).toBe(
              dirname(
                result.outputPath,
              ),
            );

            expect(
              temporaryOpen?.path,
            ).not.toBe(
              result.outputPath,
            );

            expect(
              basename(
                temporaryOpen?.path ?? "",
              ),
            ).toMatch(
              /^\..+\.[0-9a-f-]{36}\.part$/,
            );

            expect(
              recording.openedPaths.some(
                (entry) =>
                  entry.path ===
                    result.outputPath &&
                  entry.flags !==
                    "r",
              ),
            ).toBe(
              false,
            );

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              [
                ...DURABLE_RECORD_FILES,
                basename(
                  result.outputPath,
                ),
              ].sort(),
            );
          },
        );

        it(
          "randomizes the temporary file name across publications",
          async () => {
            const temporaryNames:
              string[] = [];

            for (
              const attempt of [
                1,
                2,
              ]
            ) {
              const mediaRoot =
                await makeMediaRoot();

              await persistSubmission(
                mediaRoot,
              );

              const recording =
                recordingFileSystem();

              await materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(
                        makeMp4(
                          `attempt-${attempt}`,
                        ),
                      ),
                    ),
                  downloadUri:
                    unusedDownloader(),
                  fileSystem:
                    recording.fileSystem,
                },
              );

              temporaryNames.push(
                basename(
                  recording.openedPaths[0]?.path ?? "",
                ),
              );
            }

            expect(
              temporaryNames[0],
            ).not.toBe(
              temporaryNames[1],
            );
          },
        );

        it(
          "returns alreadyPresent for an existing identical final file without re-publishing",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const bytes =
              makeMp4();

            await materializeGoogleGenAiSingleShotOutput(
              materializationInput(
                mediaRoot,
              ),
              {
                retrieveOutput:
                  retrieverReturning(
                    inlineVideo(
                      bytes,
                    ),
                  ),
                downloadUri:
                  unusedDownloader(),
              },
            );

            const recording =
              recordingFileSystem();

            const result =
              await materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(
                        bytes,
                      ),
                    ),
                  downloadUri:
                    unusedDownloader(),
                  fileSystem:
                    recording.fileSystem,
                },
              );

            expect(
              result.alreadyPresent,
            ).toBe(
              true,
            );

            expect(
              recording.events,
            ).toEqual([
              "mkdir",
              "lstat",
              "open:r",
              "close",
            ]);
          },
        );

        it(
          "fails closed when the existing final file has a different byte count",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const finalPath =
              outputPathFor(
                mediaRoot,
              );

            const existing =
              makeMp4(
                "a-longer-different-existing-video",
              );

            await writeFile(
              finalPath,
              existing,
            );

            const recording =
              recordingFileSystem();

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(),
                    ),
                  downloadUri:
                    unusedDownloader(),
                  fileSystem:
                    recording.fileSystem,
                },
              ),
            ).rejects.toThrow(
              /already exists with \d+ bytes; expected \d+\. Refusing to replace it/,
            );

            expect(
              recording.events,
            ).toEqual([
              "mkdir",
              "lstat",
            ]);

            expect(
              (
                await readFile(
                  finalPath,
                )
              ).equals(
                existing,
              ),
            ).toBe(
              true,
            );
          },
        );

        it(
          "fails closed when the existing final file has the same size but a different SHA-256",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const finalPath =
              outputPathFor(
                mediaRoot,
              );

            const expected =
              makeMp4(
                "content-A",
              );

            const existing =
              makeMp4(
                "content-B",
              );

            expect(
              existing.byteLength,
            ).toBe(
              expected.byteLength,
            );

            await writeFile(
              finalPath,
              existing,
            );

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(
                        expected,
                      ),
                    ),
                  downloadUri:
                    unusedDownloader(),
                },
              ),
            ).rejects.toThrow(
              /already exists with SHA-256 [0-9a-f]{64}; expected [0-9a-f]{64}\. Refusing to replace it/,
            );

            expect(
              (
                await readFile(
                  finalPath,
                )
              ).equals(
                existing,
              ),
            ).toBe(
              true,
            );
          },
        );

        it(
          "fails closed when the final path is a directory",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            await mkdir(
              outputPathFor(
                mediaRoot,
              ),
            );

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(),
                    ),
                  downloadUri:
                    unusedDownloader(),
                },
              ),
            ).rejects.toThrow(
              /not a regular file/,
            );
          },
        );

        it(
          "treats EEXIST from an identical concurrent publisher as alreadyPresent without overwriting",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const bytes =
              makeMp4();

            const finalPath =
              outputPathFor(
                mediaRoot,
              );

            const recording =
              recordingFileSystem({
                link:
                  async (
                    existingPath,
                    newPath,
                  ) => {
                    await writeFile(
                      newPath,
                      bytes,
                    );

                    await link(
                      existingPath,
                      newPath,
                    );
                  },
              });

            const result =
              await materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(
                        bytes,
                      ),
                    ),
                  downloadUri:
                    unusedDownloader(),
                  fileSystem:
                    recording.fileSystem,
                },
              );

            expect(
              result.alreadyPresent,
            ).toBe(
              true,
            );

            expect(
              (
                await readFile(
                  finalPath,
                )
              ).equals(
                bytes,
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
                ...DURABLE_RECORD_FILES,
                basename(
                  finalPath,
                ),
              ].sort(),
            );
          },
        );

        it(
          "fails closed on EEXIST from a conflicting concurrent publisher and never overwrites it",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const finalPath =
              outputPathFor(
                mediaRoot,
              );

            const competitor =
              makeMp4(
                "competitor-B",
              );

            const recording =
              recordingFileSystem({
                link:
                  async (
                    existingPath,
                    newPath,
                  ) => {
                    await writeFile(
                      newPath,
                      competitor,
                    );

                    await link(
                      existingPath,
                      newPath,
                    );
                  },
              });

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(
                        makeMp4(
                          "ours-A-ok",
                        ),
                      ),
                    ),
                  downloadUri:
                    unusedDownloader(),
                  fileSystem:
                    recording.fileSystem,
                },
              ),
            ).rejects.toThrow(
              /Refusing to replace it/,
            );

            expect(
              (
                await readFile(
                  finalPath,
                )
              ).equals(
                competitor,
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
                ...DURABLE_RECORD_FILES,
                basename(
                  finalPath,
                ),
              ].sort(),
            );
          },
        );

        it.each([
          [
            "EPERM (hard links unsupported)",
            "EPERM",
          ],
          [
            "ENOTSUP",
            "ENOTSUP",
          ],
          [
            "EXDEV (cross-device)",
            "EXDEV",
          ],
          [
            "EACCES",
            "EACCES",
          ],
        ])(
          "fails closed on a %s link error, cleans up the temp file, and never falls back",
          async (
            _label,
            code,
          ) => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

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
              await materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(),
                    ),
                  downloadUri:
                    unusedDownloader(),
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
              /hard-link publication .* failed\. No rename, copy, or direct-write fallback is permitted/,
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
            ).toBe(
              "unlink",
            );

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              DURABLE_RECORD_FILES,
            );
          },
        );

        it(
          "fails closed when the exclusive temp file already exists",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const recording =
              recordingFileSystem({
                open:
                  async (
                    _path,
                    flags,
                  ) => {
                    throw Object.assign(
                      new Error(
                        `Mock ${flags} EEXIST.`,
                      ),
                      {
                        code:
                          "EEXIST",
                      },
                    );
                  },
              });

            await expect(
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(),
                    ),
                  downloadUri:
                    unusedDownloader(),
                  fileSystem:
                    recording.fileSystem,
                },
              ),
            ).rejects.toThrow(
              /Mock wx EEXIST/,
            );

            expect(
              recording.events,
            ).not.toContain(
              "link",
            );

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              DURABLE_RECORD_FILES,
            );
          },
        );

        it(
          "removes the temp file and does not publish when fsync fails",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

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
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(),
                    ),
                  downloadUri:
                    unusedDownloader(),
                  fileSystem:
                    recording.fileSystem,
                },
              ),
            ).rejects.toBe(
              syncFailure,
            );

            expect(
              recording.events,
            ).not.toContain(
              "link",
            );

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              DURABLE_RECORD_FILES,
            );
          },
        );

        it(
          "publishes once for concurrent identical materializations",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const bytes =
              makeMp4();

            const results =
              await Promise.all([
                materializeGoogleGenAiSingleShotOutput(
                  materializationInput(
                    mediaRoot,
                  ),
                  {
                    retrieveOutput:
                      retrieverReturning(
                        inlineVideo(
                          bytes,
                        ),
                      ),
                    downloadUri:
                      unusedDownloader(),
                  },
                ),
                materializeGoogleGenAiSingleShotOutput(
                  materializationInput(
                    mediaRoot,
                  ),
                  {
                    retrieveOutput:
                      retrieverReturning(
                        inlineVideo(
                          bytes,
                        ),
                      ),
                    downloadUri:
                      unusedDownloader(),
                  },
                ),
              ]);

            expect(
              results
                .map(
                  (result) =>
                    result.alreadyPresent,
                )
                .sort(),
            ).toEqual([
              false,
              true,
            ]);

            expect(
              (
                await readFile(
                  outputPathFor(
                    mediaRoot,
                  ),
                )
              ).equals(
                bytes,
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
                ...DURABLE_RECORD_FILES,
                basename(
                  outputPathFor(
                    mediaRoot,
                  ),
                ),
              ].sort(),
            );
          },
        );

        it(
          "lets exactly one of two conflicting concurrent materializations win",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

            const contentA =
              makeMp4(
                "conflict-A",
              );

            const contentB =
              makeMp4(
                "conflict-B",
              );

            const settled =
              await Promise.allSettled([
                materializeGoogleGenAiSingleShotOutput(
                  materializationInput(
                    mediaRoot,
                  ),
                  {
                    retrieveOutput:
                      retrieverReturning(
                        inlineVideo(
                          contentA,
                        ),
                      ),
                    downloadUri:
                      unusedDownloader(),
                  },
                ),
                materializeGoogleGenAiSingleShotOutput(
                  materializationInput(
                    mediaRoot,
                  ),
                  {
                    retrieveOutput:
                      retrieverReturning(
                        inlineVideo(
                          contentB,
                        ),
                      ),
                    downloadUri:
                      unusedDownloader(),
                  },
                ),
              ]);

            const fulfilled =
              settled.filter(
                (entry) =>
                  entry.status ===
                  "fulfilled",
              );

            const rejected =
              settled.filter(
                (entry) =>
                  entry.status ===
                  "rejected",
              );

            expect(
              fulfilled,
            ).toHaveLength(
              1,
            );

            expect(
              rejected,
            ).toHaveLength(
              1,
            );

            const winner =
              fulfilled[0];

            const loser =
              rejected[0];

            if (
              winner?.status !==
                "fulfilled" ||
              loser?.status !==
                "rejected"
            ) {
              throw new Error(
                "Expected one fulfilled and one rejected materialization.",
              );
            }

            expect(
              String(
                loser.reason,
              ),
            ).toMatch(
              /Refusing to replace it/,
            );

            expect(
              sha256Hex(
                await readFile(
                  outputPathFor(
                    mediaRoot,
                  ),
                ),
              ),
            ).toBe(
              winner.value.sha256,
            );

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              [
                ...DURABLE_RECORD_FILES,
                basename(
                  outputPathFor(
                    mediaRoot,
                  ),
                ),
              ].sort(),
            );
          },
        );
      },
    );

    describe(
      "durability boundary",
      () => {
        it(
          "leaves the durable submission byte-identical and writes no completion or generation record",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            await persistSubmission(
              mediaRoot,
            );

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

            const result =
              await materializeGoogleGenAiSingleShotOutput(
                materializationInput(
                  mediaRoot,
                ),
                {
                  retrieveOutput:
                    retrieverReturning(
                      inlineVideo(),
                    ),
                  downloadUri:
                    unusedDownloader(),
                },
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

            expect(
              await shotDirectoryEntries(
                mediaRoot,
              ),
            ).toEqual(
              [
                ...DURABLE_RECORD_FILES,
                basename(
                  result.outputPath,
                ),
              ].sort(),
            );
          },
        );

        it(
          "keeps the materializer source free of fetch, env, rename/copy publication, SDK, and lifecycle writers",
          async () => {
            const raw =
              await readFile(
                join(
                  process.cwd(),
                  MATERIALIZER_SOURCE,
                ),
                "utf8",
              );

            const source =
              raw
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
              /\bfetch\s*\(|process\.env|\brename\s*\(|\bcopyFile\s*\(|\bcp\s*\(|createWriteStream|@google\/genai|createExecutionCompletion|reconcileExecutionLifecycle|createExecutionSubmission|executeSingleShot|evaluateShotProvider|assessPreReservationProviderOptimization|\/runway\/|\/veo\//,
            );

            const fsImport =
              /import\s*\{([^}]*)\}\s*from\s*"node:fs\/promises";/.exec(
                source,
              );

            expect(
              fsImport?.[1]
                ?.split(
                  ",",
                )
                .map(
                  (name) =>
                    name.trim(),
                )
                .filter(
                  Boolean,
                )
                .sort(),
            ).toEqual([
              "link",
              "lstat",
              "mkdir",
              "open",
              "unlink",
            ]);
          },
        );
      },
    );
  },
);
