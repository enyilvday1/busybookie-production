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

import {
  GOOGLE_GENAI_ACTIVATION_LIMITS,
} from "../src/googleGenai/googleGenAiActivationLimits.js";

import type {
  GoogleGenAiDownloadedFile,
  GoogleGenAiPrepareOutputUri,
  GoogleGenAiRecoveryContext,
  GoogleGenAiSecureOutputTransportPolicy,
  GoogleGenAiVerifiedFileMetadata,
} from "../src/googleGenai/transport/googleGenAiSecureOutputTransport.types.js";

import {
  GoogleGenAiSecureOutputTransportError,
} from "../src/googleGenai/transport/googleGenAiSecureOutputTransportError.js";

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

const TRANSPORT_POLICY:
  GoogleGenAiSecureOutputTransportPolicy =
  GOOGLE_GENAI_ACTIVATION_LIMITS;

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
              write:
                async (
                  buffer,
                  offset,
                  length,
                  position,
                ) => {
                  events.push(
                    "pwrite",
                  );

                  return handle.write(
                    buffer,
                    offset,
                    length,
                    position,
                  );
                },

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
      "streaming uri source",
      () => {
        const URI =
          "https://generativelanguage.googleapis.com/v1beta/files/test-123:download?alt=media";

        const URI_BYTES =
          makeMp4(
            "uri-sourced-streaming-video-payload",
          );

        type Hooks =
          Readonly<{
            write?: (
              real: GoogleGenAiOutputFileHandle["write"],
              buffer: Uint8Array,
              offset: number,
              length: number,
              position: number,
            ) => Promise<Readonly<{ bytesWritten: number }>>;
            sync?: () => Promise<void>;
            close?: (real: () => Promise<void>) => Promise<void>;
            openWx?: (path: string) => Promise<GoogleGenAiOutputFileHandle> | undefined;
            link?: (existingPath: string, newPath: string) => Promise<void>;
            unlink?: (real: (path: string) => Promise<void>, path: string) => Promise<void>;
          }>;

        type Harness =
          Readonly<{
            fileSystem: GoogleGenAiOutputFileSystem;
            events: string[];
            writes: Array<Readonly<{ offset: number; length: number; position: number; bytes: number }>>;
            tempPaths: string[];
            unlinked: string[];
          }>;

        /** Real temporary-directory filesystem with an exact event log and per-operation faults. */
        function streamingFileSystem(
          hooks: Hooks = {},
          events: string[] = [],
        ): Harness {
          const writes: Array<Readonly<{ offset: number; length: number; position: number; bytes: number }>> = [];
          const tempPaths: string[] = [];
          const unlinked: string[] = [];
          const realUnlink = async (path: string) => { await unlink(path); };

          const fileSystem: GoogleGenAiOutputFileSystem = {
            mkdir: async (path, options) => { events.push("mkdir"); return mkdir(path, options); },
            lstat: async (path) => { events.push("lstat"); return lstat(path); },
            open: async (path, flags) => {
              events.push(`open:${flags}`);
              if (flags === "wx") {
                tempPaths.push(path);
                const injected = hooks.openWx?.(path);
                if (injected) return injected;
              }
              const handle = await open(path, flags);
              const realWrite: GoogleGenAiOutputFileHandle["write"] = (buffer, offset, length, position) =>
                handle.write(buffer, offset, length, position);
              return {
                write: async (buffer, offset, length, position) => {
                  const result = hooks.write
                    ? await hooks.write(realWrite, buffer, offset, length, position)
                    : await realWrite(buffer, offset, length, position);
                  writes.push({ offset, length, position, bytes: result?.bytesWritten });
                  events.push(`pwrite:${offset}:${length}:${position}`);
                  return result;
                },
                writeFile: async (data) => { events.push("writeFile"); await handle.writeFile(data); },
                sync: async () => { events.push("sync"); if (hooks.sync) await hooks.sync(); await handle.sync(); },
                close: async () => {
                  events.push("close");
                  const realClose = () => handle.close();
                  await (hooks.close ? hooks.close(realClose) : realClose());
                },
                read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
              };
            },
            link: async (existingPath, newPath) => {
              events.push("link");
              await (hooks.link ? hooks.link(existingPath, newPath) : link(existingPath, newPath));
            },
            unlink: async (path) => {
              events.push("unlink");
              unlinked.push(path);
              await (hooks.unlink ? hooks.unlink(realUnlink, path) : realUnlink(path));
            },
          };

          return { fileSystem, events, writes, tempPaths, unlinked };
        }

        function uriVideo(
          uri: string = URI,
        ) {
          return {
            type: "video",
            mime_type: "video/mp4",
            uri,
          };
        }

        function metadataFor(
          bytes: Uint8Array = URI_BYTES,
          overrides: Partial<GoogleGenAiVerifiedFileMetadata> = {},
        ): GoogleGenAiVerifiedFileMetadata {
          return Object.freeze({
            resource: Object.freeze({ fileId: "test-123", name: "files/test-123", downloadUri: URI }),
            byteCount: bytes.byteLength,
            sha256: sha256Hex(bytes),
            mimeType: "video/mp4",
            expirationTime: "2026-10-26T12:00:00Z",
            expirationTimeMs: Date.UTC(2026, 9, 26, 12),
            ...overrides,
          });
        }

        function chunked(
          bytes: Uint8Array,
          size: number,
        ): Uint8Array[] {
          const chunks: Uint8Array[] = [];
          for (let offset = 0; offset < bytes.byteLength; offset += size) chunks.push(bytes.slice(offset, offset + size));
          return chunks;
        }

        type DownloadPlan =
          Readonly<{
            chunks?: readonly Uint8Array[];
            result?: Partial<GoogleGenAiDownloadedFile>;
            failAfterChunks?: Readonly<{ count: number; error: unknown }>;
          }>;

        /** In-process downloader: streams planned chunks through the sink with ordered awaits. */
        function streamingDownloader(
          plans: readonly DownloadPlan[] = [{}],
          events?: string[],
        ) {
          let call = 0;
          return vi.fn<GoogleGenAiOutputUriDownloader>(async (_metadata, sink) => {
            const plan = plans[Math.min(call, plans.length - 1)]!;
            call += 1;
            events?.push("download");
            const chunks = plan.chunks ?? chunked(URI_BYTES, 7);
            let written = 0;
            for (const [index, chunk] of chunks.entries()) {
              if (plan.failAfterChunks && index === plan.failAfterChunks.count) throw plan.failAfterChunks.error;
              await sink.writeChunk(chunk);
              written += chunk.byteLength;
            }
            if (plan.failAfterChunks && plan.failAfterChunks.count >= chunks.length) throw plan.failAfterChunks.error;
            const streamed = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
            return Object.freeze({ byteCount: written, sha256: sha256Hex(streamed), mimeType: "video/mp4" as const, ...plan.result });
          });
        }

        function preparer(
          results: ReadonlyArray<GoogleGenAiVerifiedFileMetadata | Error> = [metadataFor()],
          events?: string[],
        ) {
          let call = 0;
          return vi.fn<GoogleGenAiPrepareOutputUri>(async () => {
            const result = results[Math.min(call, results.length - 1)]!;
            call += 1;
            events?.push("prepare");
            if (result instanceof Error) throw result;
            return result;
          });
        }

        function recoveryContext(
          remaining: number | (() => number) = 1_200_000,
          controller = new AbortController(),
        ): GoogleGenAiRecoveryContext {
          return Object.freeze({
            signal: controller.signal,
            remainingMs: typeof remaining === "function" ? remaining : () => remaining,
          });
        }

        function transport(
          code: GoogleGenAiSecureOutputTransportError["code"],
          httpStatus?: number,
        ) {
          return new GoogleGenAiSecureOutputTransportError(code, httpStatus === undefined ? {} : { httpStatus });
        }

        type UriSetup =
          Readonly<{
            mediaRoot: string;
            harness: Harness;
            prepareUri: ReturnType<typeof preparer>;
            downloadUri: ReturnType<typeof streamingDownloader>;
            context: GoogleGenAiRecoveryContext;
            run: (overrides?: Partial<Parameters<typeof materializeGoogleGenAiSingleShotOutput>[1]>, maxOutputBytes?: number) =>
              ReturnType<typeof materializeGoogleGenAiSingleShotOutput>;
          }>;

        async function uriSetup(
          options: Readonly<{
            prepared?: ReadonlyArray<GoogleGenAiVerifiedFileMetadata | Error>;
            plans?: readonly DownloadPlan[];
            hooks?: Hooks;
            context?: GoogleGenAiRecoveryContext;
            policy?: GoogleGenAiSecureOutputTransportPolicy;
            uri?: string;
          }> = {},
        ): Promise<UriSetup> {
          const mediaRoot = await makeMediaRoot();
          await persistSubmission(mediaRoot);
          const events: string[] = [];
          const harness = streamingFileSystem(options.hooks, events);
          const prepareUri = preparer(options.prepared, events);
          const downloadUri = streamingDownloader(options.plans, events);
          const context = options.context ?? recoveryContext();
          return {
            mediaRoot, harness, prepareUri, downloadUri, context,
            run: (overrides = {}, maxOutputBytes = MAX_OUTPUT_BYTES) =>
              materializeGoogleGenAiSingleShotOutput(
                materializationInput(mediaRoot, maxOutputBytes),
                {
                  retrieveOutput: retrieverReturning(uriVideo(options.uri)),
                  prepareUri, downloadUri, context,
                  policy: options.policy ?? TRANSPORT_POLICY,
                  fileSystem: harness.fileSystem,
                  ...overrides,
                },
              ),
          };
        }

        function withPolicy(
          patch: Readonly<{ limits?: object; timeouts?: object; recovery?: object }>,
        ): GoogleGenAiSecureOutputTransportPolicy {
          return {
            limits: { ...TRANSPORT_POLICY.limits, ...patch.limits },
            timeouts: { ...TRANSPORT_POLICY.timeouts, ...patch.timeouts },
            recovery: { ...TRANSPORT_POLICY.recovery, ...patch.recovery },
          } as GoogleGenAiSecureOutputTransportPolicy;
        }

        /** Records retry-delay arguments; "immediate" fires on the next macrotask, "held" never fires. */
        function retryTimers(
          mode: "immediate" | "held" = "immediate",
        ) {
          const delays: number[] = [];
          const realSetTimeout = globalThis.setTimeout;
          const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, delay?: number) => {
            delays.push(delay ?? 0);
            return realSetTimeout(handler, mode === "immediate" ? 0 : 2 ** 31 - 1);
          }) as typeof setTimeout);
          return { delays, restore: () => spy.mockRestore() };
        }

        async function expectOnlyDurableRecords(
          mediaRoot: string,
        ): Promise<void> {
          expect(await shotDirectoryEntries(mediaRoot)).toEqual(DURABLE_RECORD_FILES);
        }

        function expectSanitized(
          error: unknown,
          mediaRoot: string,
        ): void {
          const members = error instanceof AggregateError ? [error, ...error.errors] : [error];
          for (const member of members) {
            const text = String(member) + (member as Error).stack + JSON.stringify(member);
            for (const secret of [URI, mediaRoot, "test-123", sha256Hex(URI_BYTES), "SECRET"]) expect(text).not.toContain(secret);
            expect(Object.hasOwn(member as object, "cause")).toBe(false);
          }
        }

        describe(
          "URI dependency contract",
          () => {
            it.each([
              "prepareUri",
              "downloadUri",
              "policy",
              "context",
            ] as const)(
              "requires %s before any URI work and has no whole-buffer fallback",
              async (missing) => {
                const setup = await uriSetup();
                await expect(setup.run({ [missing]: undefined } as Partial<Parameters<typeof materializeGoogleGenAiSingleShotOutput>[1]>)).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" });
                expect(setup.prepareUri).not.toHaveBeenCalled();
                expect(setup.downloadUri).not.toHaveBeenCalled();
                expect(setup.harness.events).toEqual([]);
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it.each([
              ["zero policy maximum", { policy: withPolicy({ limits: { maxOutputBytes: 0 } }) }],
              ["fractional download timeout", { policy: withPolicy({ timeouts: { filesDownloadTimeoutMs: 1.5 } }) }],
              ["missing attempt ceiling", { policy: withPolicy({ recovery: { maxFilesDownloadAttemptsPerReconciliation: undefined } }) }],
              ["nonfinite retry delay", { policy: withPolicy({ recovery: { filesDownloadRetryDelayMs: Infinity } }) }],
              ["context without signal", { context: { remainingMs: () => 1_200_000 } as unknown as GoogleGenAiRecoveryContext }],
              ["context without budget", { context: { signal: new AbortController().signal } as unknown as GoogleGenAiRecoveryContext }],
            ] as const)(
              "rejects a malformed %s before any URI work",
              async (_label, overrides) => {
                const setup = await uriSetup();
                await expect(setup.run(overrides)).rejects.toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID" });
                expect(setup.prepareUri).not.toHaveBeenCalled();
                expect(setup.harness.events).toEqual([]);
              },
            );

            it(
              "keeps historical inline-only calls working with no URI dependencies at all",
              async () => {
                const mediaRoot = await makeMediaRoot();
                await persistSubmission(mediaRoot);
                const bytes = makeMp4("inline-without-uri-dependencies");
                const result = await materializeGoogleGenAiSingleShotOutput(
                  materializationInput(mediaRoot),
                  { retrieveOutput: retrieverReturning(inlineVideo(bytes)) },
                );
                expect(result).toMatchObject({ sourceKind: "INLINE_DATA", alreadyPresent: false, byteCount: bytes.byteLength, sha256: sha256Hex(bytes) });
                expect((await readFile(result.outputPath)).equals(bytes)).toBe(true);
              },
            );

            it(
              "never treats a legacy whole-buffer downloader result as published content",
              async () => {
                const setup = await uriSetup();
                const legacy = vi.fn(async () => new Uint8Array(URI_BYTES)) as unknown as GoogleGenAiOutputUriDownloader;
                await expect(setup.run({ downloadUri: legacy })).rejects.toMatchObject({ code: "DOWNLOAD_CONTENT_TYPE_INVALID" });
                expect(setup.harness.writes).toEqual([]);
                expect(setup.harness.events).not.toContain("link");
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it.each([
              ["http", "http://storage.example.com/video.mp4", /must use https/],
              ["ftp", "ftp://storage.example.com/video.mp4", /must use https/],
              ["file", "file:///C:/video.mp4", /must use https/],
              ["username", "https://user@storage.example.com/video.mp4", /must not contain user credentials/],
              ["username and password", "https://user:SECRET@storage.example.com/video.mp4", /must not contain user credentials/],
              ["not a URL", "storage.example.com/SECRET.mp4", /not a valid URL/],
              ["blank host", "https:///video.mp4", /hostname|not a valid URL|canonical/],
              ["non-canonical host case", "https://Storage.Example.com/video.mp4", /canonical/],
              ["non-canonical dot segments", "https://storage.example.com/a/../video.mp4", /canonical/],
              ["unencoded space", "https://storage.example.com/my video.mp4", /canonical/],
              ["backslash separators", "https:\\\\storage.example.com\\video.mp4", /canonical/],
            ] as const)(
              "rejects a %s uri with a static message before metadata or download",
              async (_label, uri, message) => {
                const setup = await uriSetup({ uri });
                const { error } = await setup.run().then(() => ({ error: undefined }), (caught: unknown) => ({ error: caught }));
                expect(error).toBeInstanceOf(Error);
                expect((error as Error).message).toMatch(message);
                expect(String(error) + (error as Error).stack).not.toContain("SECRET");
                expect(Object.hasOwn(error as object, "cause")).toBe(false);
                expect(setup.prepareUri).not.toHaveBeenCalled();
                expect(setup.downloadUri).not.toHaveBeenCalled();
              },
            );

            it(
              "passes the effective min(input, policy) bound to metadata and enforces it",
              async () => {
                const narrowing = await uriSetup();
                await narrowing.run();
                expect(narrowing.prepareUri.mock.calls[0]?.[0]).toStrictEqual({ uri: URI, maxOutputBytes: MAX_OUTPUT_BYTES });

                const policyBound = await uriSetup({ policy: withPolicy({ limits: { maxOutputBytes: URI_BYTES.byteLength - 1 } }) });
                await expect(policyBound.run()).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
                expect(policyBound.prepareUri.mock.calls[0]?.[0]).toStrictEqual({ uri: URI, maxOutputBytes: URI_BYTES.byteLength - 1 });
                expect(policyBound.downloadUri).not.toHaveBeenCalled();
                expect(policyBound.harness.events).not.toContain("open:wx");
              },
            );
          },
        );

        describe(
          "first publication and positional writes",
          () => {
            it(
              "prepares metadata before any filesystem work, streams into one exclusive temp, fsyncs, closes, then hard-links",
              async () => {
                const setup = await uriSetup();
                const result = await setup.run();
                expect(result).toEqual({
                  provider: "GOOGLE_GENAI",
                  providerExecutionId: INTERACTION_ID,
                  outputIndex: 1,
                  outputPath: outputPathFor(setup.mediaRoot),
                  mimeType: "video/mp4",
                  byteCount: URI_BYTES.byteLength,
                  sha256: sha256Hex(URI_BYTES),
                  sourceKind: "URI",
                  alreadyPresent: false,
                });
                expect(Object.isFrozen(result)).toBe(true);
                const writes = setup.harness.events.filter((event) => event.startsWith("pwrite:"));
                expect(setup.harness.events).toEqual([
                  "prepare", "mkdir", "lstat", "open:wx", "download", ...writes, "sync", "close", "link", "unlink",
                ]);
                expect(setup.harness.events).not.toContain("writeFile");
                expect(setup.downloadUri).toHaveBeenCalledTimes(1);
                const [metadata, , context] = setup.downloadUri.mock.calls[0]!;
                expect(metadata).toBe(await setup.prepareUri.mock.results[0]!.value);
                expect(context).toBe(setup.context);
                expect(setup.prepareUri.mock.calls[0]?.[1]).toBe(setup.context);
                expect(setup.harness.tempPaths).toHaveLength(1);
                const tempName = basename(setup.harness.tempPaths[0]!);
                const finalName = basename(result.outputPath);
                expect(tempName.startsWith(`.${finalName}.`)).toBe(true);
                expect(tempName.endsWith(".part")).toBe(true);
                expect(tempName.slice(finalName.length + 2, -".part".length)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
                expect(dirname(setup.harness.tempPaths[0]!)).toBe(dirname(result.outputPath));
                expect(setup.harness.unlinked).toEqual(setup.harness.tempPaths);
                expect((await readFile(result.outputPath)).equals(URI_BYTES)).toBe(true);
                expect(await shotDirectoryEntries(setup.mediaRoot)).toEqual([...DURABLE_RECORD_FILES, basename(result.outputPath)].sort());
              },
            );

            it(
              "writes each full chunk at its exact absolute position",
              async () => {
                const setup = await uriSetup({ plans: [{ chunks: chunked(URI_BYTES, 10) }] });
                await setup.run();
                let position = 0;
                expect(setup.harness.writes).toEqual(chunked(URI_BYTES, 10).map((chunk) => {
                  const entry = { offset: 0, length: chunk.byteLength, position, bytes: chunk.byteLength };
                  position += chunk.byteLength;
                  return entry;
                }));
              },
            );

            it.each([
              ["one short first write", (requested: number, call: number) => (call === 0 ? 3 : requested)],
              ["repeated short writes", (requested: number) => Math.min(requested, 3)],
              ["one-byte progress", () => 1],
            ] as const)(
              "loops on %s, advancing offset and position exactly",
              async (_label, progress) => {
                let call = 0;
                const setup = await uriSetup({
                  plans: [{ chunks: chunked(URI_BYTES, 16) }],
                  hooks: {
                    write: (real, buffer, offset, length, position) => {
                      const amount = Math.min(length, progress(length, call++));
                      return real(buffer, offset, amount, position);
                    },
                  },
                });
                const result = await setup.run();
                expect((await readFile(result.outputPath)).equals(URI_BYTES)).toBe(true);
                let expectedPosition = 0;
                for (const write of setup.harness.writes) {
                  expect(write.position).toBe(expectedPosition);
                  expect(write.bytes).toBeGreaterThan(0);
                  expectedPosition += write.bytes;
                }
                expect(expectedPosition).toBe(URI_BYTES.byteLength);
                expect(setup.harness.writes.some((write) => write.offset > 0)).toBe(true);
              },
            );

            it.each([
              ["zero progress", 0],
              ["negative progress", -1],
              ["fractional progress", 1.5],
              ["NaN progress", Number.NaN],
              ["excess progress", Number.MAX_SAFE_INTEGER],
              ["missing result", undefined],
            ] as const)(
              "fails closed on %s with TEMP_WRITE_FAILED, cleanup and no retry",
              async (_label, bytesWritten) => {
                const setup = await uriSetup({
                  hooks: { write: async () => (bytesWritten === undefined ? undefined : { bytesWritten }) as unknown as { bytesWritten: number } },
                });
                const { error } = await setup.run().then(() => ({ error: undefined }), (caught: unknown) => ({ error: caught }));
                expect(error).toMatchObject({ code: "TEMP_WRITE_FAILED", retryable: false });
                expectSanitized(error, setup.mediaRoot);
                expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                expect(setup.harness.events).not.toContain("sync");
                expect(setup.harness.events).not.toContain("link");
                expect(setup.harness.unlinked).toEqual(setup.harness.tempPaths);
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it(
              "maps a rejected positional write to TEMP_WRITE_FAILED without echoing the OS error",
              async () => {
                const setup = await uriSetup({ hooks: { write: async () => { throw new Error(`EIO SECRET ${URI}`); } } });
                const { error } = await setup.run().then(() => ({ error: undefined }), (caught: unknown) => ({ error: caught }));
                expect(error).toMatchObject({ code: "TEMP_WRITE_FAILED" });
                expectSanitized(error, setup.mediaRoot);
                expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it(
              "allows at most one active file write and rejects an overlapping chunk",
              async () => {
                const setup = await uriSetup();
                const overlapping = vi.fn<GoogleGenAiOutputUriDownloader>(async (_metadata, sink) => {
                  const first = sink.writeChunk(URI_BYTES.slice(0, 8));
                  const second = sink.writeChunk(URI_BYTES.slice(8));
                  await Promise.allSettled([first, second]);
                  await second;
                  return { byteCount: URI_BYTES.byteLength, sha256: sha256Hex(URI_BYTES), mimeType: "video/mp4" };
                });
                await expect(setup.run({ downloadUri: overlapping })).rejects.toMatchObject({ code: "TEMP_WRITE_FAILED" });
                expect(setup.harness.writes).toHaveLength(1);
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );
          },
        );

        describe(
          "independent integrity evidence",
          () => {
            it.each([
              ["downloader count disagreement", { result: { byteCount: URI_BYTES.byteLength + 1 } }, "DOWNLOAD_SIZE_MISMATCH"],
              ["downloader SHA disagreement", { result: { sha256: "0".repeat(64) } }, "DOWNLOAD_HASH_MISMATCH"],
              ["malformed downloader SHA", { result: { sha256: sha256Hex(URI_BYTES).toUpperCase() } }, "DOWNLOAD_HASH_MISMATCH"],
              ["downloader MIME disagreement", { result: { mimeType: "video/webm" as "video/mp4" } }, "DOWNLOAD_CONTENT_TYPE_INVALID"],
              ["short local stream with claimed full evidence", {
                chunks: [URI_BYTES.slice(0, 20)],
                result: { byteCount: URI_BYTES.byteLength, sha256: sha256Hex(URI_BYTES) },
              }, "DOWNLOAD_SIZE_MISMATCH"],
              ["altered local bytes with claimed metadata hash", {
                chunks: [Buffer.concat([URI_BYTES.subarray(0, 30), Buffer.from([URI_BYTES[30]! ^ 1]), URI_BYTES.subarray(31)])],
                result: { sha256: sha256Hex(URI_BYTES) },
              }, "DOWNLOAD_HASH_MISMATCH"],
            ] as const)(
              "rejects %s against materializer-local evidence and cleans the temp",
              async (_label, plan, code) => {
                const setup = await uriSetup({ plans: [plan] });
                const { error } = await setup.run().then(() => ({ error: undefined }), (caught: unknown) => ({ error: caught }));
                expect(error).toMatchObject({ code, retryable: false });
                expectSanitized(error, setup.mediaRoot);
                expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                expect(setup.harness.events).not.toContain("sync");
                expect(setup.harness.events).not.toContain("link");
                expect(setup.harness.unlinked).toEqual(setup.harness.tempPaths);
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it(
              "rejects a chunk beyond the metadata byteCount before writing it",
              async () => {
                const extra = Buffer.concat([URI_BYTES, Buffer.from([1, 2, 3])]);
                const setup = await uriSetup({ plans: [{ chunks: [extra.subarray(0, 40), extra.subarray(40)] }] });
                await expect(setup.run()).rejects.toMatchObject({ code: "DOWNLOAD_SIZE_MISMATCH" });
                expect(setup.harness.writes.reduce((total, write) => total + write.bytes, 0)).toBe(40);
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it(
              "rejects a chunk beyond the effective cap with DOWNLOAD_TOO_LARGE before writing it",
              async () => {
                const extra = Buffer.concat([URI_BYTES, Buffer.from([1])]);
                const setup = await uriSetup({ plans: [{ chunks: [extra.subarray(0, 12), extra.subarray(12)] }] });
                await expect(setup.run({}, URI_BYTES.byteLength)).rejects.toMatchObject({ code: "DOWNLOAD_TOO_LARGE" });
                expect(setup.harness.writes.reduce((total, write) => total + write.bytes, 0)).toBe(12);
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it(
              "accepts an MP4 whose 16-byte prefix is split across one-byte chunks and skips empty chunks",
              async () => {
                const setup = await uriSetup({ plans: [{ chunks: [new Uint8Array(0), ...chunked(URI_BYTES, 1), new Uint8Array(0)] }] });
                const result = await setup.run();
                expect(result.sha256).toBe(sha256Hex(URI_BYTES));
                expect(setup.harness.writes).toHaveLength(URI_BYTES.byteLength);
              },
            );

            function ftyp(
              boxSize: number,
              type = "ftyp",
              total = 40,
            ): Buffer {
              const bytes = Buffer.alloc(total, 0x61);
              bytes.writeUInt32BE(boxSize, 0);
              bytes.write(type, 4, "latin1");
              return bytes;
            }

            it.each([
              ["too short", Buffer.from("0000ftypisom", "latin1")],
              ["wrong box type", ftyp(24, "moov")],
              ["box size below minimum", ftyp(12)],
              ["box size beyond the actual byte count", ftyp(44)],
              ["misaligned compatible brands", ftyp(18)],
              ["extended 64-bit size form", ftyp(1)],
            ] as const)(
              "rejects streamed output with %s as DOWNLOAD_MP4_INVALID without publication",
              async (_label, bytes) => {
                const setup = await uriSetup({ prepared: [metadataFor(bytes)], plans: [{ chunks: chunked(bytes, 5) }] });
                await expect(setup.run()).rejects.toMatchObject({ code: "DOWNLOAD_MP4_INVALID", retryable: false });
                expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                expect(setup.harness.events).not.toContain("link");
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it(
              "accepts the smallest structurally valid MP4 prefix",
              async () => {
                const bytes = ftyp(16, "ftyp", 16);
                const setup = await uriSetup({ prepared: [metadataFor(bytes)], plans: [{ chunks: chunked(bytes, 3) }] });
                expect((await setup.run()).byteCount).toBe(16);
              },
            );
          },
        );

        describe(
          "existing final and publication races",
          () => {
            it(
              "returns an identical existing final as alreadyPresent without downloading or creating a temp",
              async () => {
                const setup = await uriSetup();
                await mkdir(dirname(outputPathFor(setup.mediaRoot)), { recursive: true });
                await writeFile(outputPathFor(setup.mediaRoot), URI_BYTES);
                const result = await setup.run();
                expect(result).toMatchObject({ alreadyPresent: true, sourceKind: "URI", byteCount: URI_BYTES.byteLength, sha256: sha256Hex(URI_BYTES) });
                expect(setup.downloadUri).not.toHaveBeenCalled();
                expect(setup.harness.events).toEqual(["prepare", "mkdir", "lstat", "open:r", "close"]);
              },
            );

            it.each([
              ["wrong size", async (path: string) => { await writeFile(path, Buffer.concat([URI_BYTES, Buffer.from([0])])); }],
              ["wrong hash", async (path: string) => { const other = Buffer.from(URI_BYTES); other[30] = other[30]! ^ 1; await writeFile(path, other); }],
              ["wrong file type", async (path: string) => { await mkdir(path); }],
            ] as const)(
              "rejects an existing final with %s as OUTPUT_PUBLICATION_CONFLICT and never touches it",
              async (_label, plant) => {
                const setup = await uriSetup();
                const finalPath = outputPathFor(setup.mediaRoot);
                await mkdir(dirname(finalPath), { recursive: true });
                await plant(finalPath);
                const before = await lstat(finalPath);
                const { error } = await setup.run().then(() => ({ error: undefined }), (caught: unknown) => ({ error: caught }));
                expect(error).toMatchObject({ code: "OUTPUT_PUBLICATION_CONFLICT" });
                expectSanitized(error, setup.mediaRoot);
                expect(setup.downloadUri).not.toHaveBeenCalled();
                expect(setup.harness.events).not.toContain("open:wx");
                expect(setup.harness.unlinked).toEqual([]);
                expect((await lstat(finalPath)).mtimeMs).toBe(before.mtimeMs);
              },
            );

            it(
              "rejects an existing final whose hash matches metadata but whose MP4 prefix is invalid",
              async () => {
                const invalid = Buffer.alloc(40, 0x62);
                const setup = await uriSetup({ prepared: [metadataFor(invalid)] });
                const finalPath = outputPathFor(setup.mediaRoot);
                await mkdir(dirname(finalPath), { recursive: true });
                await writeFile(finalPath, invalid);
                await expect(setup.run()).rejects.toMatchObject({ code: "OUTPUT_PUBLICATION_CONFLICT" });
                expect(setup.downloadUri).not.toHaveBeenCalled();
                expect((await readFile(finalPath)).equals(invalid)).toBe(true);
              },
            );

            it(
              "accepts an identical EEXIST race winner and still removes its own temp",
              async () => {
                const setup = await uriSetup({
                  hooks: {
                    link: async (_existing, newPath) => {
                      await writeFile(newPath, URI_BYTES);
                      throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
                    },
                  },
                });
                const result = await setup.run();
                expect(result.alreadyPresent).toBe(true);
                expect(setup.harness.unlinked).toEqual(setup.harness.tempPaths);
                expect(await shotDirectoryEntries(setup.mediaRoot)).toEqual([...DURABLE_RECORD_FILES, basename(result.outputPath)].sort());
              },
            );

            it(
              "rejects a conflicting EEXIST race winner without overwriting and removes its own temp",
              async () => {
                const foreign = makeMp4("foreign-race-winner");
                const setup = await uriSetup({
                  hooks: {
                    link: async (_existing, newPath) => {
                      await writeFile(newPath, foreign);
                      throw Object.assign(new Error("EEXIST"), { code: "EEXIST" });
                    },
                  },
                });
                await expect(setup.run()).rejects.toMatchObject({ code: "OUTPUT_PUBLICATION_CONFLICT" });
                expect((await readFile(outputPathFor(setup.mediaRoot))).equals(foreign)).toBe(true);
                expect(setup.harness.unlinked).toEqual(setup.harness.tempPaths);
              },
            );

            it.each([
              "EPERM",
              "EXDEV",
              "ENOTSUP",
            ])(
              "fails closed on non-EEXIST hard-link failure %s with no fallback publication",
              async (code) => {
                const setup = await uriSetup({
                  hooks: { link: async () => { throw Object.assign(new Error(`${code} SECRET ${URI}`), { code }); } },
                });
                const { error } = await setup.run().then(() => ({ error: undefined }), (caught: unknown) => ({ error: caught }));
                expect(error).toMatchObject({ code: "OUTPUT_PUBLICATION_FAILED", retryable: false });
                expectSanitized(error, setup.mediaRoot);
                expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                expect(setup.harness.events.filter((event) => event === "link")).toHaveLength(1);
                expect(setup.harness.events).not.toContain("writeFile");
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it(
              "surfaces TEMP_CLEANUP_FAILED after publication without removing the published final",
              async () => {
                const setup = await uriSetup({ hooks: { unlink: async () => { throw new Error(`EBUSY SECRET ${URI}`); } } });
                const { error } = await setup.run().then(() => ({ error: undefined }), (caught: unknown) => ({ error: caught }));
                expect(error).toMatchObject({ code: "TEMP_CLEANUP_FAILED" });
                expectSanitized(error, setup.mediaRoot);
                expect((await readFile(outputPathFor(setup.mediaRoot))).equals(URI_BYTES)).toBe(true);
                expect(setup.harness.unlinked).toEqual(setup.harness.tempPaths);
              },
            );
          },
        );

        describe(
          "failure cleanup ownership",
          () => {
            it.each([
              ["non-transient download failure", { plans: [{ failAfterChunks: { count: 2, error: transport("DOWNLOAD_HTTP_FAILED", 404) } }] }, "DOWNLOAD_HTTP_FAILED"],
              ["sink write failure", { hooks: { write: async () => { throw new Error("ENOSPC"); } } }, "TEMP_WRITE_FAILED"],
              ["provider hash mismatch", { plans: [{ result: { sha256: "1".repeat(64) } }] }, "DOWNLOAD_HASH_MISMATCH"],
              ["size mismatch", { plans: [{ chunks: [URI_BYTES.subarray(0, 25)] }] }, "DOWNLOAD_SIZE_MISMATCH"],
              ["sync failure", { hooks: { sync: async () => { throw new Error("EIO sync"); } } }, "TEMP_WRITE_FAILED"],
              ["close failure", { hooks: { close: async (real: () => Promise<void>) => { await real(); throw new Error("EIO close"); } } }, "TEMP_WRITE_FAILED"],
            ] as const)(
              "removes only its owned temp after %s and never retries",
              async (_label, options, code) => {
                const setup = await uriSetup(options as Parameters<typeof uriSetup>[0]);
                const { error } = await setup.run().then(() => ({ error: undefined }), (caught: unknown) => ({ error: caught }));
                expect(error).toMatchObject({ code });
                expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                expect(setup.downloadUri).toHaveBeenCalledTimes(1);
                expect(setup.harness.events).not.toContain("link");
                expect(setup.harness.unlinked).toEqual(setup.harness.tempPaths);
                expect(setup.harness.tempPaths).toHaveLength(1);
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it(
              "attempts close then unlink after a sync failure, with no link",
              async () => {
                const setup = await uriSetup({ hooks: { sync: async () => { throw new Error("EIO sync"); } } });
                await expect(setup.run()).rejects.toMatchObject({ code: "TEMP_WRITE_FAILED" });
                expect(setup.harness.events.slice(-3)).toEqual(["sync", "close", "unlink"]);
              },
            );

            it(
              "still unlinks its temp after a close failure, with no link",
              async () => {
                const setup = await uriSetup({ hooks: { close: async (real: () => Promise<void>) => { await real(); throw new Error("EIO close"); } } });
                await expect(setup.run()).rejects.toMatchObject({ code: "TEMP_WRITE_FAILED" });
                expect(setup.harness.events.slice(-3)).toEqual(["sync", "close", "unlink"]);
              },
            );

            it(
              "never unlinks a path whose exclusive open failed",
              async () => {
                const setup = await uriSetup({
                  hooks: { openWx: () => Promise.reject(Object.assign(new Error("EEXIST"), { code: "EEXIST" })) },
                });
                await expect(setup.run()).rejects.toMatchObject({ code: "TEMP_WRITE_FAILED" });
                expect(setup.harness.unlinked).toEqual([]);
                expect(setup.downloadUri).not.toHaveBeenCalled();
                expect(setup.prepareUri).toHaveBeenCalledTimes(1);
              },
            );

            it(
              "throws AggregateError of the sanitized primary and cleanup failures",
              async () => {
                const setup = await uriSetup({
                  plans: [{ result: { sha256: "2".repeat(64) } }],
                  hooks: { unlink: async () => { throw new Error(`EBUSY SECRET ${URI}`); } },
                });
                const { error } = await setup.run().then(() => ({ error: undefined }), (caught: unknown) => ({ error: caught }));
                expect(error).toBeInstanceOf(AggregateError);
                expect((error as AggregateError).errors.map((member: { code?: string }) => member.code)).toEqual(["DOWNLOAD_HASH_MISMATCH", "TEMP_CLEANUP_FAILED"]);
                expectSanitized(error, setup.mediaRoot);
              },
            );

            it(
              "maps cancellation during the download to OPERATION_ABORTED and cleans the temp",
              async () => {
                const controller = new AbortController();
                const setup = await uriSetup({ context: recoveryContext(1_200_000, controller) });
                const aborting = vi.fn<GoogleGenAiOutputUriDownloader>(async (_metadata, sink) => {
                  await sink.writeChunk(URI_BYTES.slice(0, 10));
                  controller.abort(new Error("SECRET caller abort"));
                  await sink.writeChunk(URI_BYTES.slice(10));
                  return { byteCount: URI_BYTES.byteLength, sha256: sha256Hex(URI_BYTES), mimeType: "video/mp4" };
                });
                const { error } = await setup.run({ downloadUri: aborting }).then(() => ({ error: undefined }), (caught: unknown) => ({ error: caught }));
                expect(error).toMatchObject({ code: "OPERATION_ABORTED", retryable: false });
                expectSanitized(error, setup.mediaRoot);
                expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it(
              "rechecks cancellation before sync and before link",
              async () => {
                const beforeSync = new AbortController();
                const syncSetup = await uriSetup({ context: recoveryContext(1_200_000, beforeSync) });
                const late = vi.fn<GoogleGenAiOutputUriDownloader>(async (metadata, sink, context) => {
                  const result = await syncSetup.downloadUri(metadata, sink, context);
                  beforeSync.abort(transport("RECONCILIATION_TIMEOUT"));
                  return result;
                });
                await expect(syncSetup.run({ downloadUri: late })).rejects.toMatchObject({ code: "RECONCILIATION_TIMEOUT" });
                expect(syncSetup.harness.events).not.toContain("sync");
                await expectOnlyDurableRecords(syncSetup.mediaRoot);

                const beforeLink = new AbortController();
                const linkSetup = await uriSetup({
                  context: recoveryContext(1_200_000, beforeLink),
                  hooks: { close: async (real: () => Promise<void>) => { await real(); beforeLink.abort(); } },
                });
                await expect(linkSetup.run()).rejects.toMatchObject({ code: "OPERATION_ABORTED" });
                expect(linkSetup.harness.events).toContain("sync");
                expect(linkSetup.harness.events).not.toContain("link");
                await expectOnlyDurableRecords(linkSetup.mediaRoot);
              },
            );
          },
        );

        describe(
          "B4V6C elapsed authority and primary-error sanitization",
          () => {
            function settled<T>(
              promise: Promise<T>,
            ): Promise<unknown> {
              return promise.then(() => undefined, (caught: unknown) => caught);
            }

            it(
              "F1 refuses sync and link when remainingMs() is already 0 after download but the signal is not aborted",
              async () => {
                let remaining = 1_200_000;
                const controller = new AbortController();
                const setup = await uriSetup({ context: recoveryContext(() => remaining, controller) });
                const exhausting = vi.fn<GoogleGenAiOutputUriDownloader>(async (metadata, sink, context) => {
                  const result = await setup.downloadUri(metadata, sink, context);
                  remaining = 0;
                  return result;
                });
                const error = await settled(setup.run({ downloadUri: exhausting }));
                expect(controller.signal.aborted).toBe(false);
                expect(error).toMatchObject({ code: "RECOVERY_BUDGET_EXHAUSTED", retryable: false });
                expect(setup.harness.events).not.toContain("sync");
                expect(setup.harness.events).not.toContain("link");
                expect(setup.harness.events.slice(-2)).toEqual(["close", "unlink"]);
                expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it.each([
              ["sync", true],
              ["close", true],
            ] as const)(
              "F1 lets an in-progress %s finish but admits no hard link after the budget reaches 0 during it",
              async (stage, syncRan) => {
                let remaining = 1_200_000;
                const setup = await uriSetup({
                  context: recoveryContext(() => remaining),
                  hooks: stage === "sync"
                    ? { sync: async () => { remaining = 0; } }
                    : { close: async (real: () => Promise<void>) => { await real(); remaining = -0.5; } },
                });
                const error = await settled(setup.run());
                expect(error).toMatchObject({ code: "RECOVERY_BUDGET_EXHAUSTED" });
                expect(setup.harness.events.includes("sync")).toBe(syncRan);
                expect(setup.harness.events).toContain("close");
                expect(setup.harness.events).not.toContain("link");
                expect(setup.harness.events.at(-1)).toBe("unlink");
                expect(setup.harness.unlinked).toEqual(setup.harness.tempPaths);
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it(
              "F1 still runs sync -> close -> admission -> hard link while authority remains",
              async () => {
                let reads = 0;
                const setup = await uriSetup({ context: recoveryContext(() => { reads += 1; return 1; }) });
                const result = await setup.run();
                expect(result.alreadyPresent).toBe(false);
                const tail = setup.harness.events.slice(setup.harness.events.indexOf("sync"));
                expect(tail).toEqual(["sync", "close", "link", "unlink"]);
                expect(reads).toBeGreaterThanOrEqual(3);
              },
            );

            const RAW_URI = URI.replace("test-123", "raw-999");

            function rawDependencyError(): Error {
              return Object.assign(
                new Error(`RAW_PROVIDER_SECRET ${RAW_URI}&token=SECRET`, { cause: new Error(`cause SECRET ${RAW_URI}`) }),
                { token: "SECRET", url: RAW_URI },
              );
            }

            function expectNoRawRetention(
              error: unknown,
              raw: Error,
            ): void {
              const members = error instanceof AggregateError ? [error, ...error.errors] : [error];
              for (const member of members) {
                expect(member).not.toBe(raw);
                expect(member).not.toBe(raw.cause);
                const text = String(member) + (member as Error).stack + JSON.stringify(member) + JSON.stringify(Object.getOwnPropertyNames(member).map((name) => String((member as Record<string, unknown>)[name])));
                for (const secret of ["RAW_PROVIDER_SECRET", "SECRET", RAW_URI, "raw-999"]) expect(text).not.toContain(secret);
                expect(Object.hasOwn(member as object, "cause")).toBe(false);
                expect(Object.hasOwn(member as object, "token")).toBe(false);
                expect(Object.hasOwn(member as object, "url")).toBe(false);
              }
            }

            it.each([
              ["owned-temp unlink failure", { unlink: async () => { throw new Error(`EBUSY SECRET ${RAW_URI}`); } }],
              ["owned-handle close failure", { close: async (real: () => Promise<void>) => { await real(); throw new Error(`EIO SECRET ${RAW_URI}`); } }],
            ] as const)(
              "F2 never aggregates a raw downloader Error when %s also occurs",
              async (_label, hooks) => {
                const raw = rawDependencyError();
                const setup = await uriSetup({ hooks, plans: [{ failAfterChunks: { count: 2, error: raw } }] });
                const error = await settled(setup.run());
                expect(error).toBeInstanceOf(AggregateError);
                const members = (error as AggregateError).errors as GoogleGenAiSecureOutputTransportError[];
                expect(members.map((member) => member.code)).toEqual(["SECURE_TRANSPORT_CONFIGURATION_INVALID", "TEMP_CLEANUP_FAILED"]);
                expect(members[0]!.retryable).toBe(false);
                for (const member of members) expect(member).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
                expectNoRawRetention(error, raw);
                expect(setup.prepareUri).toHaveBeenCalledTimes(1);
              },
            );

            it.each([
              ["downloader", (setup: UriSetup, raw: Error) => setup.run({ downloadUri: vi.fn<GoogleGenAiOutputUriDownloader>(async () => { throw raw; }) })],
              ["metadata preparation", (setup: UriSetup, raw: Error) => setup.run({ prepareUri: vi.fn<GoogleGenAiPrepareOutputUri>(async () => { throw raw; }) })],
            ] as const)(
              "F2 sanitizes a direct untyped %s failure without depending on a cleanup failure, and never retries it",
              async (_label, invoke) => {
                const timers = retryTimers();
                try {
                  const raw = rawDependencyError();
                  const setup = await uriSetup();
                  const error = await settled(invoke(setup, raw));
                  expect(error).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
                  expect(error).toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false });
                  expectNoRawRetention(error, raw);
                  expect(timers.delays).toEqual([]);
                  await expectOnlyDurableRecords(setup.mediaRoot);
                } finally {
                  timers.restore();
                }
              },
            );

            it(
              "F2 rebuilds a subclassed transport error to its closed code instead of retaining the subclass instance",
              async () => {
                class ForeignTransportError extends GoogleGenAiSecureOutputTransportError {}
                const foreign = new ForeignTransportError("DOWNLOAD_HTTP_FAILED", { httpStatus: 404 });
                const setup = await uriSetup({ plans: [{ failAfterChunks: { count: 1, error: foreign } }] });
                const error = await settled(setup.run());
                expect(error).not.toBe(foreign);
                expect(Object.getPrototypeOf(error)).toBe(GoogleGenAiSecureOutputTransportError.prototype);
                expect(error).toMatchObject({ code: "DOWNLOAD_HTTP_FAILED", httpStatus: 404, retryable: false });
              },
            );
          },
        );

        describe(
          "B4V6C2 genuine base-error normalization",
          () => {
            const HOSTILE_URI = "https://generativelanguage.googleapis.com/v1beta/files/hostile-777:download?alt=media&token=RAW_PROVIDER_SECRET";
            const HOSTILE_STACK = `RAW_PROVIDER_SECRET ${HOSTILE_URI}`;

            /** A genuine, normally constructed, frozen base instance whose runtime stack accessor accepts hostile content. */
            function hostileBaseError(
              code: GoogleGenAiSecureOutputTransportError["code"],
              httpStatus?: number,
            ): GoogleGenAiSecureOutputTransportError {
              const raw = transport(code, httpStatus);
              expect(Object.isFrozen(raw)).toBe(true);
              expect(Object.getPrototypeOf(raw)).toBe(GoogleGenAiSecureOutputTransportError.prototype);
              (raw as { stack?: string }).stack = HOSTILE_STACK;
              // Confirms the actual runtime behavior the review reproduced.
              expect(raw.stack).toBe(HOSTILE_STACK);
              expect(Object.isFrozen(raw)).toBe(true);
              return raw;
            }

            /** Recursively walks everything reachable from the outward failure. */
            function expectNoHostileReachable(
              outward: unknown,
              raw: object,
            ): void {
              const seen = new Set<unknown>();
              const visit = (value: unknown, path: string): void => {
                if (value === null || (typeof value !== "object" && typeof value !== "function")) {
                  if (typeof value === "string") {
                    expect(value, path).not.toContain("RAW_PROVIDER_SECRET");
                    expect(value, path).not.toContain("hostile-777");
                    expect(value, path).not.toContain(HOSTILE_URI);
                  }
                  return;
                }
                if (seen.has(value)) return;
                seen.add(value);
                expect(value, path).not.toBe(raw);
                if (value instanceof Error) {
                  visit(value.message, `${path}.message`);
                  visit(value.stack, `${path}.stack`);
                  visit(String(value), `${path}.toString`);
                  visit((value as { cause?: unknown }).cause, `${path}.cause`);
                }
                if (value instanceof AggregateError) {
                  value.errors.forEach((member, index) => visit(member, `${path}.errors[${index}]`));
                }
                for (const key of Reflect.ownKeys(value)) {
                  const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
                  const property = "value" in descriptor ? descriptor.value : (value as Record<PropertyKey, unknown>)[key];
                  visit(property, `${path}.${String(key)}`);
                }
              };
              visit(outward, "outward");
              expect(JSON.stringify(outward)).not.toContain("RAW_PROVIDER_SECRET");
            }

            function expectTrustedBase(
              value: unknown,
              code: GoogleGenAiSecureOutputTransportError["code"],
              retryable: boolean,
            ): void {
              expect(value).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
              expect(Object.getPrototypeOf(value)).toBe(GoogleGenAiSecureOutputTransportError.prototype);
              expect(value).toMatchObject({ code, retryable });
              expect((value as Error).message).toBe(`Google GenAI secure output transport failed (${code}).`);
              expect(Object.hasOwn(value as object, "cause")).toBe(false);
              expect(Object.isFrozen(value)).toBe(true);
            }

            function caught<T>(
              promise: Promise<T>,
            ): Promise<unknown> {
              return promise.then(() => undefined, (error: unknown) => error);
            }

            it(
              "CASE 1 rebuilds a genuine base error thrown by prepareUri into a fresh trusted instance",
              async () => {
                const raw = hostileBaseError("FILE_NOT_ACTIVE");
                const setup = await uriSetup();
                const outward = await caught(setup.run({ prepareUri: vi.fn<GoogleGenAiPrepareOutputUri>(async () => { throw raw; }) }));
                expect(outward).not.toBe(raw);
                expectTrustedBase(outward, "FILE_NOT_ACTIVE", false);
                expectNoHostileReachable(outward, raw);
                expect(setup.downloadUri).not.toHaveBeenCalled();
                await expectOnlyDurableRecords(setup.mediaRoot);
              },
            );

            it(
              "CASE 2 rebuilds a genuine nonretryable base error from downloadUri with successful cleanup, no retry and no publication",
              async () => {
                const timers = retryTimers();
                try {
                  const raw = hostileBaseError("DOWNLOAD_HASH_MISMATCH");
                  const setup = await uriSetup({ plans: [{ failAfterChunks: { count: 2, error: raw } }] });
                  const outward = await caught(setup.run());
                  expect(outward).not.toBe(raw);
                  expectTrustedBase(outward, "DOWNLOAD_HASH_MISMATCH", false);
                  expectNoHostileReachable(outward, raw);
                  expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                  expect(setup.downloadUri).toHaveBeenCalledTimes(1);
                  expect(timers.delays).toEqual([]);
                  expect(setup.harness.events).not.toContain("link");
                  expect(setup.harness.unlinked).toEqual(setup.harness.tempPaths);
                  await expectOnlyDurableRecords(setup.mediaRoot);
                } finally {
                  timers.restore();
                }
              },
            );

            it.each([
              ["CASE 3 owned-temp unlink failure", { unlink: async () => { throw new Error(`EBUSY ${HOSTILE_STACK}`); } }],
              ["CASE 4 owned-handle close failure", { close: async (real: () => Promise<void>) => { await real(); throw new Error(`EIO ${HOSTILE_STACK}`); } }],
            ] as const)(
              "%s aggregates only a fresh normalized primary and TEMP_CLEANUP_FAILED",
              async (_label, hooks) => {
                const raw = hostileBaseError("DOWNLOAD_HASH_MISMATCH");
                const setup = await uriSetup({ hooks, plans: [{ failAfterChunks: { count: 2, error: raw } }] });
                const outward = await caught(setup.run());
                expect(outward).toBeInstanceOf(AggregateError);
                const members = (outward as AggregateError).errors;
                expect(members).toHaveLength(2);
                expect(members[0]).not.toBe(raw);
                expectTrustedBase(members[0], "DOWNLOAD_HASH_MISMATCH", false);
                expect((members[0] as Error).stack).not.toContain("RAW_PROVIDER_SECRET");
                expect((members[0] as Error).stack).not.toContain(HOSTILE_URI);
                expectTrustedBase(members[1], "TEMP_CLEANUP_FAILED", false);
                expectNoHostileReachable(outward, raw);
                expect(setup.prepareUri).toHaveBeenCalledTimes(1);
              },
            );

            it(
              "preserves legitimate closed retry semantics after reconstruction (retryable code and httpStatus)",
              async () => {
                const timers = retryTimers();
                try {
                  const raw = hostileBaseError("DOWNLOAD_HTTP_FAILED", 503);
                  const setup = await uriSetup({ plans: [{ failAfterChunks: { count: 1, error: raw } }, { failAfterChunks: { count: 1, error: raw } }] });
                  const outward = await caught(setup.run());
                  expect(outward).not.toBe(raw);
                  expectTrustedBase(outward, "DOWNLOAD_HTTP_FAILED", true);
                  expect(outward).toMatchObject({ httpStatus: 503 });
                  expectNoHostileReachable(outward, raw);
                  expect(timers.delays).toEqual([10000]);
                  expect(setup.prepareUri).toHaveBeenCalledTimes(2);
                  expect(setup.downloadUri).toHaveBeenCalledTimes(2);
                } finally {
                  timers.restore();
                }
              },
            );

            it(
              "a reconstructed retryable genuine base error still allows the one bounded retry to succeed",
              async () => {
                const timers = retryTimers();
                try {
                  const raw = hostileBaseError("DOWNLOAD_TIMEOUT");
                  const setup = await uriSetup({ plans: [{ failAfterChunks: { count: 1, error: raw } }, {}] });
                  const result = await setup.run();
                  expect(result.sha256).toBe(sha256Hex(URI_BYTES));
                  expect(timers.delays).toEqual([10000]);
                  expect(setup.downloadUri).toHaveBeenCalledTimes(2);
                } finally {
                  timers.restore();
                }
              },
            );
          },
        );

        describe(
          "B4V6C3 closed transport-error classification",
          () => {
            const MARKER = "RAW_PROVIDER_SECRET";

            type Boundary = "prepareUri" | "downloadUri";

            type ClosedFields = Readonly<{
              code?: unknown;
              attempt?: unknown;
              httpStatus?: unknown;
              retryable?: unknown;
            }>;

            /**
             * A prototype-admitted, transport-looking value that was NOT made by
             * the trusted constructor (the B4V6R3 reproduction shape), carrying
             * hostile message/stack/cause/custom markers.
             */
            function forgedTransportError(
              fields: ClosedFields,
              options: Readonly<{ inherited?: boolean; accessor?: "throwing" | "valid" }> = {},
            ): GoogleGenAiSecureOutputTransportError {
              const descriptors: PropertyDescriptorMap = {
                message: { value: `${MARKER} message`, enumerable: true },
                stack: { value: `${MARKER} stack ${URI}&token=${MARKER}`, enumerable: true },
                cause: { value: new Error(`${MARKER} cause`), enumerable: true },
                providerBody: { value: `${MARKER} body`, enumerable: true },
              };
              for (const [key, value] of Object.entries(fields)) {
                descriptors[key] = { value, enumerable: true };
              }
              if (options.accessor) {
                descriptors.httpStatus = {
                  enumerable: true,
                  get: options.accessor === "throwing"
                    ? () => { throw new Error(`${MARKER} getter`); }
                    : () => 503,
                };
              }
              if (options.inherited) {
                const carrier = Object.create(GoogleGenAiSecureOutputTransportError.prototype, descriptors) as object;
                return Object.create(carrier, {
                  stack: { value: `${MARKER} stack`, enumerable: true },
                }) as GoogleGenAiSecureOutputTransportError;
              }
              return Object.create(GoogleGenAiSecureOutputTransportError.prototype, descriptors) as GoogleGenAiSecureOutputTransportError;
            }

            /** Throws each error once at the chosen boundary, then lets the next attempt succeed. */
            async function failingAt(
              boundary: Boundary,
              errors: readonly unknown[],
            ) {
              if (boundary === "downloadUri") {
                return uriSetup({ plans: [...errors.map((error) => ({ failAfterChunks: { count: 1, error } })), {}] });
              }
              // Throws every injected value (Error or not) by call index; the spy
              // counts each actual invocation, including throwing ones.
              const setup = await uriSetup();
              let call = 0;
              setup.prepareUri.mockImplementation(async () => {
                const index = call;
                call += 1;
                if (index < errors.length) throw errors[index];
                return metadataFor();
              });
              return setup;
            }

            function expectedCalls(
              boundary: Boundary,
              attempts: number,
              downloadSucceeded = false,
            ): Readonly<{ prepare: number; download: number }> {
              return boundary === "prepareUri"
                ? { prepare: attempts, download: downloadSucceeded ? 1 : 0 }
                : { prepare: attempts, download: attempts };
            }

            function settledError<T>(
              promise: Promise<T>,
            ): Promise<unknown> {
              return promise.then(() => undefined, (error: unknown) => error);
            }

            function expectFreshTrusted(
              outward: unknown,
              raw: unknown,
            ): void {
              expect(outward).not.toBe(raw);
              expect(outward).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
              expect(Object.getPrototypeOf(outward)).toBe(GoogleGenAiSecureOutputTransportError.prototype);
              expect(Object.isFrozen(outward)).toBe(true);
              expect(Object.hasOwn(outward as object, "cause")).toBe(false);
              expect(Object.hasOwn(outward as object, "providerBody")).toBe(false);
              const text = String(outward) + (outward as Error).stack + JSON.stringify(outward) + (outward as Error).message;
              expect(text).not.toContain(MARKER);
              expect(text).not.toContain(URI);
            }

            const BOUNDARIES: readonly Boundary[] = ["prepareUri", "downloadUri"];

            const MALFORMED: ReadonlyArray<readonly [string, () => unknown]> = [
              ["A decisive string status '404' with retryable=false", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: 1, httpStatus: "404", retryable: false })],
              ["A' string status '404' presented as retryable", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: 1, httpStatus: "404", retryable: true })],
              ["B NaN status", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: Number.NaN, retryable: true })],
              ["C out-of-range status 600", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: 600, retryable: true })],
              ["C' out-of-range status 99", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: 99, retryable: true })],
              ["C'' fractional status 503.5", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: 503.5, retryable: true })],
              ["D string attempt 'bad'", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: "bad", httpStatus: 503, retryable: true })],
              ["D' negative attempt", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: -1, httpStatus: 503, retryable: true })],
              ["D'' zero attempt", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: 0, httpStatus: 503, retryable: true })],
              ["D''' fractional attempt", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: 1.5, httpStatus: 503, retryable: true })],
              ["D'''' unsafe attempt", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: Number.MAX_SAFE_INTEGER + 1, httpStatus: 503, retryable: true })],
              ["E transient 503 contradicted by retryable=false", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: 503, retryable: false })],
              ["F nontransient 404 contradicted by retryable=true", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: 404, retryable: true })],
              ["G DOWNLOAD_TIMEOUT contradicted by retryable=false", () => forgedTransportError({ code: "DOWNLOAD_TIMEOUT", attempt: undefined, httpStatus: undefined, retryable: false })],
              ["H semantic fields inherited through the prototype chain", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: 503, retryable: true }, { inherited: true })],
              ["I throwing httpStatus getter", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, retryable: true }, { accessor: "throwing" })],
              ["I' accessor that would report a valid 503", () => forgedTransportError({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, retryable: true }, { accessor: "valid" })],
              ["J unknown code with transient-looking fields", () => forgedTransportError({ code: "NOT_A_CODE", attempt: undefined, httpStatus: 503, retryable: true })],
              ["K missing retryable field", () => forgedTransportError({ code: "DOWNLOAD_TIMEOUT", attempt: undefined, httpStatus: undefined })],
              ["K' missing attempt/httpStatus fields", () => forgedTransportError({ code: "DOWNLOAD_TIMEOUT", retryable: true })],
              ["L non-boolean retryable", () => forgedTransportError({ code: "DOWNLOAD_TIMEOUT", attempt: undefined, httpStatus: undefined, retryable: "true" })],
              ["M ordinary Error", () => new Error(`${MARKER} ordinary ${URI}`)],
              ["N wrong-prototype plain object with valid-looking fields", () => ({ code: "DOWNLOAD_HTTP_FAILED", attempt: undefined, httpStatus: 503, retryable: true, message: MARKER })],
            ];

            for (const boundary of BOUNDARIES) {
              it.each(MALFORMED)(
                `fails closed at ${boundary}: %s -> fresh CONFIG, nonretryable, no retry, one attempt`,
                async (_label, make) => {
                  const timers = retryTimers();
                  try {
                    const raw = make();
                    const setup = await failingAt(boundary, [raw]);
                    const outward = await settledError(setup.run());
                    expectFreshTrusted(outward, raw);
                    expect(outward).toMatchObject({ code: "SECURE_TRANSPORT_CONFIGURATION_INVALID", retryable: false, attempt: undefined, httpStatus: undefined });
                    expect(timers.delays).toEqual([]);
                    const calls = expectedCalls(boundary, 1);
                    expect(setup.prepareUri.mock.calls).toHaveLength(calls.prepare);
                    expect(setup.downloadUri.mock.calls).toHaveLength(calls.download);
                    expect(setup.harness.events).not.toContain("sync");
                    expect(setup.harness.events).not.toContain("link");
                    expect(setup.harness.unlinked).toEqual(setup.harness.tempPaths);
                    await expectOnlyDurableRecords(setup.mediaRoot);
                  } finally {
                    timers.restore();
                  }
                },
              );

              it(
                `positive control at ${boundary}: genuine base DOWNLOAD_HTTP_FAILED 503 keeps its status, retries once and succeeds`,
                async () => {
                  const timers = retryTimers();
                  try {
                    const setup = await failingAt(boundary, [transport("DOWNLOAD_HTTP_FAILED", 503)]);
                    const result = await setup.run();
                    expect(result.sha256).toBe(sha256Hex(URI_BYTES));
                    expect(timers.delays).toEqual([10000]);
                    const calls = expectedCalls(boundary, 2, true);
                    expect(setup.prepareUri.mock.calls).toHaveLength(calls.prepare);
                    expect(setup.downloadUri.mock.calls).toHaveLength(boundary === "prepareUri" ? 1 : 2);
                  } finally {
                    timers.restore();
                  }
                },
              );

              it(
                `positive control at ${boundary}: genuine base 503 on both attempts surfaces fresh 503/retryable after the two-attempt ceiling`,
                async () => {
                  const timers = retryTimers();
                  try {
                    const raw = transport("DOWNLOAD_HTTP_FAILED", 503);
                    const setup = await failingAt(boundary, [raw, raw]);
                    const outward = await settledError(setup.run());
                    expectFreshTrusted(outward, raw);
                    expect(outward).toMatchObject({ code: "DOWNLOAD_HTTP_FAILED", httpStatus: 503, retryable: true });
                    expect(timers.delays).toEqual([10000]);
                    const calls = expectedCalls(boundary, 2);
                    expect(setup.prepareUri.mock.calls).toHaveLength(calls.prepare);
                    expect(setup.downloadUri.mock.calls).toHaveLength(calls.download);
                  } finally {
                    timers.restore();
                  }
                },
              );

              it(
                `positive control at ${boundary}: genuine subclass 404 normalizes to a fresh base, nonretryable, no retry`,
                async () => {
                  class GenuineSubclassError extends GoogleGenAiSecureOutputTransportError {}
                  const timers = retryTimers();
                  try {
                    const raw = new GenuineSubclassError("DOWNLOAD_HTTP_FAILED", { httpStatus: 404 });
                    const setup = await failingAt(boundary, [raw]);
                    const outward = await settledError(setup.run());
                    expectFreshTrusted(outward, raw);
                    expect(outward).toMatchObject({ code: "DOWNLOAD_HTTP_FAILED", httpStatus: 404, retryable: false });
                    expect(timers.delays).toEqual([]);
                    const calls = expectedCalls(boundary, 1);
                    expect(setup.prepareUri.mock.calls).toHaveLength(calls.prepare);
                    expect(setup.downloadUri.mock.calls).toHaveLength(calls.download);
                  } finally {
                    timers.restore();
                  }
                },
              );

              it(
                `positive control at ${boundary}: genuine base with truly absent status stays transient (absent is not malformed)`,
                async () => {
                  const timers = retryTimers();
                  try {
                    const raw = transport("DOWNLOAD_HTTP_FAILED");
                    expect(Object.getOwnPropertyDescriptor(raw, "httpStatus")).toMatchObject({ value: undefined });
                    const setup = await failingAt(boundary, [raw, raw]);
                    const outward = await settledError(setup.run());
                    expectFreshTrusted(outward, raw);
                    expect(outward).toMatchObject({ code: "DOWNLOAD_HTTP_FAILED", httpStatus: undefined, retryable: true });
                    expect(timers.delays).toEqual([10000]);
                    expect(setup.prepareUri.mock.calls).toHaveLength(2);
                  } finally {
                    timers.restore();
                  }
                },
              );

              it(
                `positive control at ${boundary}: genuine DOWNLOAD_TIMEOUT keeps its retry semantics and the retry succeeds`,
                async () => {
                  const timers = retryTimers();
                  try {
                    const setup = await failingAt(boundary, [transport("DOWNLOAD_TIMEOUT")]);
                    const result = await setup.run();
                    expect(result.byteCount).toBe(URI_BYTES.byteLength);
                    expect(timers.delays).toEqual([10000]);
                    expect(setup.prepareUri.mock.calls).toHaveLength(2);
                  } finally {
                    timers.restore();
                  }
                },
              );
            }
          },
        );

        describe(
          "bounded two-attempt retry ownership",
          () => {
            it(
              "retries a transient download failure only after complete cleanup, with a fresh temp, metadata and evidence",
              async () => {
                const timers = retryTimers();
                try {
                  const setup = await uriSetup({
                    prepared: [metadataFor(), metadataFor(URI_BYTES, { expirationTime: "2026-10-26T13:00:00Z", expirationTimeMs: Date.UTC(2026, 9, 26, 13) })],
                    plans: [{ failAfterChunks: { count: 3, error: transport("DOWNLOAD_TIMEOUT") } }, {}],
                  });
                  const result = await setup.run();
                  expect(result).toMatchObject({ alreadyPresent: false, sha256: sha256Hex(URI_BYTES), byteCount: URI_BYTES.byteLength });
                  expect((await readFile(result.outputPath)).equals(URI_BYTES)).toBe(true);
                  expect(timers.delays).toEqual([10000]);
                  expect(setup.prepareUri).toHaveBeenCalledTimes(2);
                  expect(setup.downloadUri).toHaveBeenCalledTimes(2);
                  expect(setup.harness.tempPaths).toHaveLength(2);
                  expect(new Set(setup.harness.tempPaths).size).toBe(2);
                  expect(setup.harness.unlinked).toEqual(setup.harness.tempPaths);
                  const events = setup.harness.events;
                  const secondPrepare = events.lastIndexOf("prepare");
                  expect(events.indexOf("unlink")).toBeLessThan(secondPrepare);
                  expect(events.slice(0, secondPrepare)).not.toContain("sync");
                  // The second attempt restarts at absolute position 0 with fresh evidence.
                  const firstRestart = setup.harness.writes.findIndex((write, index) => index > 0 && write.position === 0);
                  expect(firstRestart).toBe(3);
                  expect(setup.harness.writes.slice(firstRestart).reduce((total, write) => total + write.bytes, 0)).toBe(URI_BYTES.byteLength);
                } finally {
                  timers.restore();
                }
              },
            );

            it(
              "lets a transient metadata failure consume an attempt with no temp or download",
              async () => {
                const timers = retryTimers();
                try {
                  const setup = await uriSetup({ prepared: [transport("FILES_METADATA_HTTP_FAILED", 503), metadataFor()] });
                  await setup.run();
                  expect(setup.prepareUri).toHaveBeenCalledTimes(2);
                  expect(setup.downloadUri).toHaveBeenCalledTimes(1);
                  expect(setup.harness.tempPaths).toHaveLength(1);
                  expect(setup.harness.events.slice(0, 2)).toEqual(["prepare", "prepare"]);
                  expect(timers.delays).toEqual([10000]);
                } finally {
                  timers.restore();
                }
              },
            );

            it.each([
              ["download, download", [metadataFor()], [{ failAfterChunks: { count: 1, error: transport("DOWNLOAD_HTTP_FAILED", 503) } }], 2],
              ["metadata, metadata", [transport("FILES_METADATA_TIMEOUT")], [{}], 0],
              ["metadata, download", [transport("FILES_METADATA_TIMEOUT"), metadataFor()], [{ failAfterChunks: { count: 0, error: transport("DOWNLOAD_HTTP_FAILED", 429) } }], 1],
            ] as const)(
              "never exceeds the two-attempt ceiling (%s transient failures)",
              async (_label, prepared, plans, downloads) => {
                const timers = retryTimers();
                try {
                  const setup = await uriSetup({ prepared, plans });
                  const { error } = await setup.run().then(() => ({ error: undefined }), (caught: unknown) => ({ error: caught }));
                  expect(error).toBeInstanceOf(GoogleGenAiSecureOutputTransportError);
                  expect((error as GoogleGenAiSecureOutputTransportError).retryable).toBe(true);
                  expect(setup.prepareUri).toHaveBeenCalledTimes(2);
                  expect(setup.downloadUri).toHaveBeenCalledTimes(downloads);
                  expect(timers.delays).toEqual([10000]);
                  expect(setup.harness.unlinked).toEqual(setup.harness.tempPaths);
                  await expectOnlyDurableRecords(setup.mediaRoot);
                } finally {
                  timers.restore();
                }
              },
            );

            it.each([
              ["metadata FILE_NOT_ACTIVE", { prepared: [transport("FILE_NOT_ACTIVE")] }, "FILE_NOT_ACTIVE", 0],
              ["metadata FILE_EXPIRATION_TOO_CLOSE", { prepared: [transport("FILE_EXPIRATION_TOO_CLOSE")] }, "FILE_EXPIRATION_TOO_CLOSE", 0],
              ["metadata HTTP 404", { prepared: [transport("FILES_METADATA_HTTP_FAILED", 404)] }, "FILES_METADATA_HTTP_FAILED", 0],
              ["download HTTP 403", { plans: [{ failAfterChunks: { count: 0, error: transport("DOWNLOAD_HTTP_FAILED", 403) } }] }, "DOWNLOAD_HTTP_FAILED", 1],
              ["download redirect", { plans: [{ failAfterChunks: { count: 0, error: transport("DOWNLOAD_REDIRECT_REJECTED", 302) } }] }, "DOWNLOAD_REDIRECT_REJECTED", 1],
              ["download provider hash mismatch", { plans: [{ failAfterChunks: { count: 9, error: transport("DOWNLOAD_HASH_MISMATCH") } }] }, "DOWNLOAD_HASH_MISMATCH", 1],
              ["untyped dependency error", { prepared: [new Error("arbitrary timeout text")] }, "SECURE_TRANSPORT_CONFIGURATION_INVALID", 0],
            ] as const)(
              "does not retry a semantic or untyped failure (%s)",
              async (_label, options, code, downloads) => {
                const timers = retryTimers();
                try {
                  const setup = await uriSetup(options as Parameters<typeof uriSetup>[0]);
                  const { error } = await setup.run().then(() => ({ error: undefined }), (caught: unknown) => ({ error: caught }));
                  expect(error).toMatchObject({ code, retryable: false });
                  expect(String(error) + (error as Error).stack).not.toContain("arbitrary timeout text");
                  expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                  expect(setup.downloadUri).toHaveBeenCalledTimes(downloads);
                  expect(timers.delays).toEqual([]);
                } finally {
                  timers.restore();
                }
              },
            );

            it(
              "does not retry after a sink write failure even when the downloader then reports a transient error",
              async () => {
                const timers = retryTimers();
                try {
                  const setup = await uriSetup({ hooks: { write: async () => { throw new Error("ENOSPC"); } } });
                  const masking = vi.fn<GoogleGenAiOutputUriDownloader>(async (_metadata, sink) => {
                    await sink.writeChunk(URI_BYTES.slice(0, 4)).catch(() => undefined);
                    throw transport("DOWNLOAD_TIMEOUT");
                  });
                  await expect(setup.run({ downloadUri: masking })).rejects.toMatchObject({ code: "DOWNLOAD_TIMEOUT" });
                  expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                  expect(masking).toHaveBeenCalledTimes(1);
                  expect(timers.delays).toEqual([]);
                } finally {
                  timers.restore();
                }
              },
            );

            it.each([
              ["close", { close: async (real: () => Promise<void>) => { await real(); throw new Error("EIO close"); } }],
              ["unlink", { unlink: async () => { throw new Error("EBUSY"); } }],
            ] as const)(
              "blocks any retry when transient-failure %s cleanup fails",
              async (_label, hooks) => {
                const timers = retryTimers();
                try {
                  const setup = await uriSetup({ hooks, plans: [{ failAfterChunks: { count: 1, error: transport("DOWNLOAD_TIMEOUT") } }] });
                  const { error } = await setup.run().then(() => ({ error: undefined }), (caught: unknown) => ({ error: caught }));
                  expect(error).toBeInstanceOf(AggregateError);
                  expect((error as AggregateError).errors.map((member: { code?: string }) => member.code)).toEqual(["DOWNLOAD_TIMEOUT", "TEMP_CLEANUP_FAILED"]);
                  expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                  expect(setup.harness.unlinked).toEqual(setup.harness.tempPaths);
                  expect(timers.delays).toEqual([]);
                } finally {
                  timers.restore();
                }
              },
            );

            it.each([
              ["name", { resource: Object.freeze({ fileId: "test-123", name: "files/other-456", downloadUri: URI }) }],
              ["byteCount", { byteCount: URI_BYTES.byteLength + 4 }],
              ["sha256", { sha256: "3".repeat(64) }],
            ] as const)(
              "fails FILE_IDENTITY_MISMATCH when retry metadata changes %s, never downloading the changed version",
              async (_label, change) => {
                const timers = retryTimers();
                try {
                  const setup = await uriSetup({
                    prepared: [metadataFor(), metadataFor(URI_BYTES, change)],
                    plans: [{ failAfterChunks: { count: 1, error: transport("DOWNLOAD_HTTP_FAILED") } }, {}],
                  });
                  await expect(setup.run()).rejects.toMatchObject({ code: "FILE_IDENTITY_MISMATCH", retryable: false });
                  expect(setup.prepareUri).toHaveBeenCalledTimes(2);
                  expect(setup.downloadUri).toHaveBeenCalledTimes(1);
                  expect(setup.harness.tempPaths).toHaveLength(1);
                } finally {
                  timers.restore();
                }
              },
            );

            it(
              "rejects metadata whose resource download URI differs from the replayed URI",
              async () => {
                const setup = await uriSetup({
                  prepared: [metadataFor(URI_BYTES, { resource: Object.freeze({ fileId: "test-123", name: "files/test-123", downloadUri: URI.replace("test-123", "other-456") }) })],
                });
                await expect(setup.run()).rejects.toMatchObject({ code: "FILE_IDENTITY_MISMATCH" });
                expect(setup.downloadUri).not.toHaveBeenCalled();
              },
            );

            it.each([
              ["exactly admitted", 640000, 2],
              ["one millisecond short", 639999.5, 1],
            ] as const)(
              "admits a retry only when delay plus a full next attempt fits the shared budget (%s)",
              async (_label, remaining, prepares) => {
                const timers = retryTimers();
                try {
                  const setup = await uriSetup({
                    context: recoveryContext(remaining),
                    plans: [{ failAfterChunks: { count: 1, error: transport("DOWNLOAD_TIMEOUT") } }, {}],
                  });
                  const outcome = await setup.run().then(() => undefined, (caught: unknown) => caught);
                  expect(setup.prepareUri).toHaveBeenCalledTimes(prepares);
                  if (prepares === 1) {
                    expect(outcome).toMatchObject({ code: "RECOVERY_BUDGET_EXHAUSTED" });
                    expect(timers.delays).toEqual([]);
                  } else {
                    expect(outcome).toBeUndefined();
                    expect(timers.delays).toEqual([10000]);
                  }
                } finally {
                  timers.restore();
                }
              },
            );

            it(
              "rechecks the budget after the wait before starting the next attempt",
              async () => {
                const timers = retryTimers();
                try {
                  // Read 1 admits the retry before waiting; read 2, after the
                  // wait, no longer fits a full metadata-plus-download attempt.
                  const budget = [1_200_000, 629_999.5];
                  let reads = 0;
                  const setup = await uriSetup({
                    context: recoveryContext(() => budget[Math.min(reads++, budget.length - 1)]!),
                    plans: [{ failAfterChunks: { count: 1, error: transport("DOWNLOAD_TIMEOUT") } }, {}],
                  });
                  await expect(setup.run()).rejects.toMatchObject({ code: "RECOVERY_BUDGET_EXHAUSTED" });
                  expect(timers.delays).toEqual([10000]);
                  expect(reads).toBe(2);
                  expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                } finally {
                  timers.restore();
                }
              },
            );

            it(
              "aborts the retry wait on cancellation and clears its timer",
              async () => {
                const timers = retryTimers("held");
                const clear = vi.spyOn(globalThis, "clearTimeout");
                try {
                  const controller = new AbortController();
                  const setup = await uriSetup({
                    context: recoveryContext(1_200_000, controller),
                    plans: [{ failAfterChunks: { count: 1, error: transport("DOWNLOAD_TIMEOUT") } }, {}],
                  });
                  const outcome = setup.run().then(() => undefined, (caught: unknown) => caught);
                  // Poll with setImmediate: the spied setTimeout must not drive the wait.
                  for (let turn = 0; turn < 10_000 && timers.delays.length === 0; turn += 1) {
                    await new Promise((resolve) => setImmediate(resolve));
                  }
                  expect(timers.delays).toEqual([10000]);
                  controller.abort(transport("RECONCILIATION_TIMEOUT"));
                  expect(await outcome).toMatchObject({ code: "RECONCILIATION_TIMEOUT" });
                  expect(clear).toHaveBeenCalled();
                  expect(setup.prepareUri).toHaveBeenCalledTimes(1);
                  await expectOnlyDurableRecords(setup.mediaRoot);
                } finally {
                  clear.mockRestore();
                  timers.restore();
                }
              },
            );

            it(
              "lets a retry find an identical final published meanwhile without downloading again",
              async () => {
                const timers = retryTimers();
                try {
                  const setup = await uriSetup({ plans: [{ failAfterChunks: { count: 1, error: transport("DOWNLOAD_TIMEOUT") } }] });
                  const failing = setup.downloadUri.getMockImplementation()!;
                  setup.downloadUri.mockImplementationOnce(async (metadata, sink, context) => {
                    const failure = await failing(metadata, sink, context).then(() => undefined, (caught: unknown) => caught);
                    const finalPath = outputPathFor(setup.mediaRoot);
                    await writeFile(finalPath, URI_BYTES);
                    throw failure;
                  });
                  const result = await setup.run();
                  expect(result.alreadyPresent).toBe(true);
                  expect(setup.downloadUri).toHaveBeenCalledTimes(1);
                  expect(setup.prepareUri).toHaveBeenCalledTimes(2);
                } finally {
                  timers.restore();
                }
              },
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
