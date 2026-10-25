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

import type {
  GoogleGenAI,
  Interactions,
} from "@google/genai";

import {
  ExecutionSubmissionInputSchema,
} from "../src/execution/executionSubmission.schema.js";

import type {
  ExecutionReservation,
} from "../src/execution/executionReservation.schema.js";

import {
  GoogleGenAiNewSubmissionsDisabledError,
  submitGoogleGenAiSingleShot,
  type GoogleGenAiCreatedInteraction,
  type GoogleGenAiInteractionCreator,
  type GoogleGenAiSingleShotInteractionRequest,
  type GoogleGenAiSingleShotSubmissionInput,
  type GoogleGenAiSubmissionAcceptance,
  type GoogleGenAiSubmissionAcceptedHandler,
} from "../src/execution/providers/submitGoogleGenAiSingleShot.js";

import type {
  GoogleGenAiPolicy,
} from "../src/schemas/googleGenAiPolicy.schema.js";

import {
  loadGoogleGenAiPolicy,
} from "../src/validation/loadGoogleGenAiPolicy.js";

import {
  loadGoogleGenAiActivationPolicy,
  type LoadedGoogleGenAiActivationPolicy,
} from "../src/validation/loadGoogleGenAiActivationPolicy.js";

import {
  GoogleGenAiExpectedCostRejectedError,
} from "../src/googleGenai/googleGenAiExpectedCost.js";

import {
  GoogleGenAiReferenceImageRejectedError,
} from "../src/googleGenai/assets/readGoogleGenAiReferenceImage.js";

const INTERACTION_ID =
  "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";

const PROMPT_TEXT =
  "Busybookie Google GenAI single-shot submission test.";

const IMAGE_BYTES =
  Buffer.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0x00,
    0xff,
    0x10,
    0x7f,
  ]);

const temporaryDirectories:
  string[] = [];

let policySnapshot:
  GoogleGenAiPolicy;

let checkedInActivationPolicy:
  LoadedGoogleGenAiActivationPolicy;

let enabledActivationPolicy:
  LoadedGoogleGenAiActivationPolicy;

beforeAll(
  async () => {
    policySnapshot =
      await loadGoogleGenAiPolicy();

    checkedInActivationPolicy =
      await loadGoogleGenAiActivationPolicy();

    // Test-only copy: the checked-in policy stays default-off.
    enabledActivationPolicy = {
      ...checkedInActivationPolicy,

      admission: {
        newSubmissionsEnabled:
          true,
      },
    };
  },
);

/**
 * Minimal byte fixtures that carry each supported format's real
 * signature, so production magic-byte validation is exercised as-is.
 */
function minimalImageBytes(
  mimeType:
    string,
): Buffer {
  const tail =
    Buffer.from(
      "busybookie-fixture",
      "utf8",
    );

  switch (mimeType) {
    case "image/png":
      return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        tail,
      ]);

    case "image/jpeg":
      return Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        tail,
      ]);

    case "image/webp":
      return Buffer.concat([
        Buffer.from("RIFF", "latin1"),
        Buffer.from([0x1a, 0x00, 0x00, 0x00]),
        Buffer.from("WEBPVP8 ", "latin1"),
        tail,
      ]);

    case "image/heic":
    case "image/heif": {
      const brand =
        mimeType === "image/heic"
          ? "heic"
          : "mif1";

      return Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x18]),
        Buffer.from(`ftyp${brand}`, "latin1"),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from(`mif1${brand}`, "latin1"),
        tail,
      ]);
    }

    case "image/gif":
      return Buffer.concat([
        Buffer.from("GIF89a", "latin1"),
        tail,
      ]);

    case "image/bmp":
      return Buffer.concat([
        Buffer.from("BM", "latin1"),
        Buffer.alloc(24),
        tail,
      ]);

    case "image/tiff":
      return Buffer.concat([
        Buffer.from([0x49, 0x49, 0x2a, 0x00]),
        tail,
      ]);

    default:
      throw new Error(
        `No fixture for ${mimeType}.`,
      );
  }
}

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

async function makeMediaRoot():
Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-google-genai-submission-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  return directory;
}

async function writeImage(
  path:
    string,
  bytes:
    Buffer =
      IMAGE_BYTES,
): Promise<string> {
  await mkdir(
    dirname(
      path,
    ),
    {
      recursive:
        true,
    },
  );

  await writeFile(
    path,
    bytes,
  );

  return path;
}

function referencePath(
  mediaRoot:
    string,
  fileName:
    string =
      "reference.png",
): string {
  return join(
    mediaRoot,
    "references",
    "EP92",
    "S01",
    fileName,
  );
}

function googleReservation(
  overrides:
    Partial<ExecutionReservation> =
      {},
): ExecutionReservation {
  return {
    schemaVersion:
      "1.0",

    reservationId:
      "11111111-1111-4111-8111-111111111111",

    reservedAt:
      "2026-10-24T12:00:00.000Z",

    status:
      "RESERVED",

    episodeId:
      "EP92",

    shotId:
      "S01",

    provider:
      "GOOGLE_GENAI",

    ...overrides,
  };
}

function createInteractionMock(
  result:
    GoogleGenAiCreatedInteraction =
      {
        id:
          INTERACTION_ID,
      },
) {
  return vi.fn<GoogleGenAiInteractionCreator>(
    async () =>
      result,
  );
}

function acceptanceMock() {
  return vi.fn<GoogleGenAiSubmissionAcceptedHandler>(
    async () => {},
  );
}

async function validInput(
  mediaRoot:
    string,
  overrides:
    Partial<GoogleGenAiSingleShotSubmissionInput> =
      {},
): Promise<GoogleGenAiSingleShotSubmissionInput> {
  const sourceImagePath =
    await writeImage(
      referencePath(
        mediaRoot,
      ),
    );

  return {
    mediaRoot,

    episodeId:
      "EP92",

    shotId:
      "S01",

    reservation:
      googleReservation(),

    sourceImagePath,

    promptText:
      PROMPT_TEXT,

    policySnapshot,

    activationPolicy:
      enabledActivationPolicy,

    resolution:
      "720p",

    onSubmissionAccepted:
      acceptanceMock(),

    ...overrides,
  };
}

function firstRequest(
  createInteraction:
    ReturnType<typeof createInteractionMock>,
): GoogleGenAiSingleShotInteractionRequest {
  const call =
    createInteraction.mock.calls[0];

  if (!call) {
    throw new Error(
      "createInteraction was not called.",
    );
  }

  return call[0];
}

function firstAcceptance(
  onSubmissionAccepted:
    ReturnType<typeof acceptanceMock>,
): GoogleGenAiSubmissionAcceptance {
  const call =
    onSubmissionAccepted.mock.calls[0];

  if (!call) {
    throw new Error(
      "onSubmissionAccepted was not called.",
    );
  }

  return call[0];
}

describe(
  "Busybookie dormant Google GenAI single-shot submission adapter",
  () => {
    it(
      "creates exactly one interaction with the exact request and durably accepts its Interaction.id",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        const onSubmissionAccepted =
          acceptanceMock();

        const input =
          await validInput(
            mediaRoot,
            {
              onSubmissionAccepted,
            },
          );

        const createInteraction =
          createInteractionMock();

        const result =
          await submitGoogleGenAiSingleShot(
            input,
            {
              createInteraction,
            },
          );

        expect(
          createInteraction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledTimes(
          1,
        );

        const request =
          firstRequest(
            createInteraction,
          );

        expect(
          request,
        ).toStrictEqual({
          model:
            "gemini-omni-1.1-flash",

          input: [
            {
              type:
                "text",

              text:
                PROMPT_TEXT,
            },
            {
              type:
                "image",

              data:
                IMAGE_BYTES.toString(
                  "base64",
                ),

              mime_type:
                "image/png",
            },
          ],

          response_format: {
            type:
              "video",

            delivery:
              "uri",

            resolution:
              "720p",
          },

          background:
            true,

          store:
            true,

          stream:
            false,
        });

        expect(
          Object.keys(
            request,
          ).sort(),
        ).toEqual([
          "background",
          "input",
          "model",
          "response_format",
          "store",
          "stream",
        ]);

        // Duration is deliberately omitted (no evidenced literal).
        expect(
          Object.keys(
            request.response_format,
          ).sort(),
        ).toEqual([
          "delivery",
          "resolution",
          "type",
        ]);

        expect(
          request.input,
        ).toHaveLength(
          2,
        );

        expect(
          Object.keys(
            request.input[0],
          ).sort(),
        ).toEqual([
          "text",
          "type",
        ]);

        expect(
          Object.keys(
            request.input[1],
          ).sort(),
        ).toEqual([
          "data",
          "mime_type",
          "type",
        ]);

        expect(
          Buffer.from(
            request.input[1].data,
            "base64",
          ).equals(
            await readFile(
              input.sourceImagePath,
            ),
          ),
        ).toBe(
          true,
        );

        const acceptance =
          firstAcceptance(
            onSubmissionAccepted,
          );

        expect(
          acceptance,
        ).toStrictEqual({
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
                input.sourceImagePath,
            },

            policySnapshot,
          },
        });

        expect(
          Object.keys(
            acceptance,
          ),
        ).not.toContain(
          "interactionId",
        );

        expect(
          Object.keys(
            acceptance,
          ),
        ).not.toContain(
          "providerEstimatedCredits",
        );

        expect(
          JSON.stringify(
            acceptance.recoveryMetadata,
          ),
        ).not.toContain(
          IMAGE_BYTES.toString(
            "base64",
          ),
        );

        expect(
          result,
        ).toStrictEqual({
          providerExecutionId:
            INTERACTION_ID,
        });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "produces an acceptance that forms a valid durable GOOGLE_GENAI submission input",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        const onSubmissionAccepted =
          acceptanceMock();

        await submitGoogleGenAiSingleShot(
          await validInput(
            mediaRoot,
            {
              onSubmissionAccepted,
            },
          ),
          {
            createInteraction:
              createInteractionMock(),
          },
        );

        const acceptance =
          firstAcceptance(
            onSubmissionAccepted,
          );

        const reservation =
          googleReservation();

        expect(
          ExecutionSubmissionInputSchema
            .safeParse({
              reservationId:
                reservation.reservationId,

              episodeId:
                reservation.episodeId,

              shotId:
                reservation.shotId,

              ...acceptance,
            })
            .success,
        ).toBe(
          true,
        );
      },
    );

    it(
      "awaits the durable acceptance callback before returning",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        const events:
          string[] = [];

        let releaseAcceptance:
          () => void =
            () => {};

        const onSubmissionAccepted =
          vi.fn<GoogleGenAiSubmissionAcceptedHandler>(
            () =>
              new Promise<void>(
                (resolve) => {
                  events.push(
                    "acceptance-started",
                  );

                  releaseAcceptance =
                    () => {
                      events.push(
                        "acceptance-finished",
                      );

                      resolve();
                    };
                },
              ),
          );

        const createInteraction =
          vi.fn<GoogleGenAiInteractionCreator>(
            async () => {
              events.push(
                "create",
              );

              return {
                id:
                  INTERACTION_ID,
              };
            },
          );

        const pending =
          submitGoogleGenAiSingleShot(
            await validInput(
              mediaRoot,
              {
                onSubmissionAccepted,
              },
            ),
            {
              createInteraction,
            },
          ).then(
            (result) => {
              events.push(
                "returned",
              );

              return result;
            },
          );

        await vi.waitFor(
          () => {
            expect(
              onSubmissionAccepted,
            ).toHaveBeenCalledTimes(
              1,
            );
          },
        );

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              20,
            ),
        );

        expect(
          events,
        ).toEqual([
          "create",
          "acceptance-started",
        ]);

        releaseAcceptance();

        await expect(
          pending,
        ).resolves.toStrictEqual({
          providerExecutionId:
            INTERACTION_ID,
        });

        expect(
          events,
        ).toEqual([
          "create",
          "acceptance-started",
          "acceptance-finished",
          "returned",
        ]);
      },
    );

    it(
      "trims outer prompt and source-path whitespace and records exactly what was sent",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        const sourceImagePath =
          await writeImage(
            referencePath(
              mediaRoot,
            ),
          );

        const onSubmissionAccepted =
          acceptanceMock();

        const createInteraction =
          createInteractionMock();

        await submitGoogleGenAiSingleShot(
          await validInput(
            mediaRoot,
            {
              promptText:
                `  \n\t${PROMPT_TEXT}\t \n`,

              sourceImagePath:
                `  ${sourceImagePath}  `,

              onSubmissionAccepted,
            },
          ),
          {
            createInteraction,
          },
        );

        const request =
          firstRequest(
            createInteraction,
          );

        const acceptance =
          firstAcceptance(
            onSubmissionAccepted,
          );

        expect(
          request.input[0].text,
        ).toBe(
          PROMPT_TEXT,
        );

        expect(
          acceptance.recoveryMetadata
            .request
            .promptText,
        ).toBe(
          request.input[0].text,
        );

        expect(
          acceptance.recoveryMetadata
            .request
            .sourceImagePath,
        ).toBe(
          sourceImagePath,
        );

        expect(
          Buffer.from(
            request.input[1].data,
            "base64",
          ).equals(
            IMAGE_BYTES,
          ),
        ).toBe(
          true,
        );
      },
    );

    it.each([
      [
        ".png",
        "image/png",
      ],
      [
        ".jpg",
        "image/jpeg",
      ],
      [
        ".jpeg",
        "image/jpeg",
      ],
      [
        ".webp",
        "image/webp",
      ],
      [
        ".heic",
        "image/heic",
      ],
      [
        ".heif",
        "image/heif",
      ],
      [
        ".gif",
        "image/gif",
      ],
      [
        ".bmp",
        "image/bmp",
      ],
      [
        ".tif",
        "image/tiff",
      ],
      [
        ".tiff",
        "image/tiff",
      ],
      [
        ".PNG",
        "image/png",
      ],
      [
        ".JPG",
        "image/jpeg",
      ],
      [
        ".JpEg",
        "image/jpeg",
      ],
      [
        ".WEBP",
        "image/webp",
      ],
      [
        ".HEIC",
        "image/heic",
      ],
      [
        ".HEIF",
        "image/heif",
      ],
      [
        ".GIF",
        "image/gif",
      ],
      [
        ".BMP",
        "image/bmp",
      ],
      [
        ".TIF",
        "image/tiff",
      ],
      [
        ".TiFf",
        "image/tiff",
      ],
    ])(
      "maps %s to %s and sends the exact file bytes inline",
      async (
        extension,
        mimeType,
      ) => {
        const mediaRoot =
          await makeMediaRoot();

        const bytes =
          minimalImageBytes(
            mimeType,
          );

        const sourceImagePath =
          await writeImage(
            referencePath(
              mediaRoot,
              `mime-reference${extension}`,
            ),
            bytes,
          );

        const createInteraction =
          createInteractionMock();

        await submitGoogleGenAiSingleShot(
          await validInput(
            mediaRoot,
            {
              sourceImagePath,
            },
          ),
          {
            createInteraction,
          },
        );

        const image =
          firstRequest(
            createInteraction,
          ).input[1];

        expect(
          image.mime_type,
        ).toBe(
          mimeType,
        );

        expect(
          image.data,
        ).toBe(
          bytes.toString(
            "base64",
          ),
        );
      },
    );

    describe(
      "fails closed before creating any interaction",
      () => {
        async function expectNoCreate(
          build:
            (
              mediaRoot:
                string,
            ) =>
              Promise<
                Partial<GoogleGenAiSingleShotSubmissionInput>
              >,
          message?:
            RegExp,
        ): Promise<void> {
          const mediaRoot =
            await makeMediaRoot();

          const onSubmissionAccepted =
            acceptanceMock();

          const createInteraction =
            createInteractionMock();

          const attempt =
            submitGoogleGenAiSingleShot(
              await validInput(
                mediaRoot,
                {
                  onSubmissionAccepted,

                  ...(await build(
                    mediaRoot,
                  )),
                },
              ),
              {
                createInteraction,
              },
            );

          if (message) {
            await expect(
              attempt,
            ).rejects.toThrow(
              message,
            );
          } else {
            await expect(
              attempt,
            ).rejects.toThrow();
          }

          expect(
            createInteraction,
          ).toHaveBeenCalledTimes(
            0,
          );

          expect(
            onSubmissionAccepted,
          ).toHaveBeenCalledTimes(
            0,
          );
        }

        it(
          "rejects a blank prompt",
          async () => {
            await expectNoCreate(
              async () => ({
                promptText:
                  " \n\t ",
              }),
              /prompt text is required/i,
            );
          },
        );

        it(
          "rejects a blank source image path",
          async () => {
            await expectNoCreate(
              async () => ({
                sourceImagePath:
                  "   ",
              }),
              /reference image path is required/i,
            );
          },
        );

        it(
          "rejects a source image outside the media root references",
          async () => {
            await expectNoCreate(
              async (mediaRoot) => ({
                sourceImagePath:
                  await writeImage(
                    join(
                      mediaRoot,
                      "..",
                      `${mediaRoot.split(/[\\/]/).pop() ?? "root"}-outside.png`,
                    ),
                  ),
              }),
              /reference image must be inside/i,
            );
          },
        );

        it(
          "rejects a source image inside the media root but outside references",
          async () => {
            await expectNoCreate(
              async (mediaRoot) => ({
                sourceImagePath:
                  await writeImage(
                    join(
                      mediaRoot,
                      "generated-video",
                      "reference.png",
                    ),
                  ),
              }),
              /reference image must be inside/i,
            );
          },
        );

        it(
          "rejects a relative source image path",
          async () => {
            await expectNoCreate(
              async () => ({
                sourceImagePath:
                  "references/EP92/S01/reference.png",
              }),
              /must be absolute/i,
            );
          },
        );

        it.each([
          "reference.svg",
          "reference.txt",
          "reference",
          "reference.png.exe",
        ])(
          "rejects unsupported image file %s",
          async (fileName) => {
            await expectNoCreate(
              async (mediaRoot) => ({
                sourceImagePath:
                  await writeImage(
                    referencePath(
                      mediaRoot,
                      fileName,
                    ),
                  ),
              }),
              /extension is not supported/i,
            );
          },
        );

        it(
          "rejects a missing source image file",
          async () => {
            await expectNoCreate(
              async (mediaRoot) => ({
                sourceImagePath:
                  referencePath(
                    mediaRoot,
                    "missing.png",
                  ),
              }),
            );
          },
        );

        it.each([
          [
            "wrong model",
            {
              model:
                "gemini-omni-1.1-pro",
            },
          ],
          [
            "wrong provider",
            {
              provider:
                "VEO",
            },
          ],
          [
            "underived known output cost",
            {
              pricing: {
                currency:
                  "USD",

                fixedPointUnit:
                  "MICRO_USD",

                tokensPerPricingUnit:
                  1000000,

                inputMicroUsdPerMillionTokens:
                  1500000,

                videoOutputMicroUsdPerMillionTokens:
                  17500000,

                videoOutput720pTokensPerSecond:
                  5792,

                knownVideoOutput720pMicroUsdPerSecond:
                  101361,
              },
            },
          ],
          [
            "unknown secret field",
            {
              apiKey:
                "redacted-test-value",
            },
          ],
        ])(
          "rejects an invalid policy snapshot (%s)",
          async (
            _label,
            override,
          ) => {
            await expectNoCreate(
              async () => ({
                policySnapshot: {
                  ...policySnapshot,
                  ...override,
                },
              }),
            );
          },
        );

        it(
          "rejects an incomplete policy snapshot",
          async () => {
            const {
              pricing: _pricing,
              ...incomplete
            } =
              policySnapshot;

            await expectNoCreate(
              async () => ({
                policySnapshot:
                  incomplete,
              }),
            );
          },
        );

        it.each([
          "RUNWAY",
          "VEO",
        ] as const)(
          "rejects a %s reservation",
          async (provider) => {
            await expectNoCreate(
              async () => ({
                reservation:
                  googleReservation({
                    provider,
                  }),
              }),
              /must belong to GOOGLE_GENAI/i,
            );
          },
        );

        it(
          "rejects a reservation for a different episode",
          async () => {
            await expectNoCreate(
              async () => ({
                reservation:
                  googleReservation({
                    episodeId:
                      "EP93",
                  }),
              }),
              /does not match requested shot/i,
            );
          },
        );

        it(
          "rejects a reservation for a different shot",
          async () => {
            await expectNoCreate(
              async () => ({
                reservation:
                  googleReservation({
                    shotId:
                      "S02",
                  }),
              }),
              /does not match requested shot/i,
            );
          },
        );

        it(
          "rejects a malformed reservation record",
          async () => {
            await expectNoCreate(
              async () => ({
                reservation: {
                  ...googleReservation(),

                  status:
                    "SUBMITTED",
                },
              }),
            );
          },
        );

        it(
          "rejects every new submission under the checked-in default-off activation policy",
          async () => {
            expect(
              checkedInActivationPolicy
                .admission
                .newSubmissionsEnabled,
            ).toBe(
              false,
            );

            await expectNoCreate(
              async () => ({
                activationPolicy:
                  checkedInActivationPolicy,
              }),
              /new submissions are disabled/i,
            );
          },
        );

        it(
          "raises the typed kill-switch error before reading the reservation or the image",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const createInteraction =
              createInteractionMock();

            const attempt =
              submitGoogleGenAiSingleShot(
                {
                  ...(await validInput(
                    mediaRoot,
                  )),

                  activationPolicy:
                    checkedInActivationPolicy,

                  reservation:
                    "not-a-reservation",

                  sourceImagePath:
                    referencePath(
                      mediaRoot,
                      "missing.png",
                    ),
                },
                {
                  createInteraction,
                },
              );

            await expect(
              attempt,
            ).rejects.toBeInstanceOf(
              GoogleGenAiNewSubmissionsDisabledError,
            );

            await expect(
              attempt,
            ).rejects.toMatchObject({
              code:
                "NEW_SUBMISSIONS_DISABLED",
            });

            expect(
              createInteraction,
            ).toHaveBeenCalledTimes(
              0,
            );
          },
        );

        it.each([
          [
            "missing",
            (): unknown =>
              undefined,
          ],
          [
            "drifted create timeout",
            (): unknown => ({
              ...enabledActivationPolicy,

              timeouts: {
                ...enabledActivationPolicy.timeouts,

                createTimeoutMs:
                  120000,
              },
            }),
          ],
          [
            "string switch",
            (): unknown => ({
              ...enabledActivationPolicy,

              admission: {
                newSubmissionsEnabled:
                  "true",
              },
            }),
          ],
          [
            "unknown key",
            (): unknown => ({
              ...enabledActivationPolicy,

              environmentOverride:
                true,
            }),
          ],
        ])(
          "rejects an invalid activation policy (%s)",
          async (
            _label,
            buildPolicy,
          ) => {
            await expectNoCreate(
              async () => ({
                activationPolicy:
                  buildPolicy(),
              }),
            );
          },
        );

        it.each([
          "360p",
          "1080p",
          "4k",
        ])(
          "rejects %s because no authoritative local price exists",
          async (resolution) => {
            await expectNoCreate(
              async () => ({
                resolution,
              }),
              /PRICING_UNAVAILABLE/,
            );
          },
        );

        it.each([
          [
            "upper-case",
            "720P",
          ],
          [
            "unknown",
            "8k",
          ],
          [
            "numeric",
            720,
          ],
          [
            "missing",
            undefined,
          ],
        ])(
          "rejects a %s resolution",
          async (
            _label,
            resolution,
          ) => {
            await expectNoCreate(
              async () => ({
                resolution,
              }),
              /RESOLUTION_UNSUPPORTED/,
            );
          },
        );

        it(
          "raises the typed expected-cost error",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const createInteraction =
              createInteractionMock();

            await expect(
              submitGoogleGenAiSingleShot(
                await validInput(
                  mediaRoot,
                  {
                    resolution:
                      "1080p",
                  },
                ),
                {
                  createInteraction,
                },
              ),
            ).rejects.toBeInstanceOf(
              GoogleGenAiExpectedCostRejectedError,
            );

            expect(
              createInteraction,
            ).toHaveBeenCalledTimes(
              0,
            );
          },
        );

        it.each([
          [
            "empty file",
            "rejected-reference.png",
            Buffer.alloc(0),
            /EMPTY/,
          ],
          [
            "non-image content",
            "rejected-reference.png",
            Buffer.from(
              "not an image at all",
              "utf8",
            ),
            /UNSUPPORTED_SIGNATURE/,
          ],
          [
            "JPEG bytes behind a .png extension",
            "rejected-reference.png",
            minimalImageBytes(
              "image/jpeg",
            ),
            /SIGNATURE_MIME_MISMATCH/,
          ],
          [
            "one byte over the 10 MiB limit",
            "rejected-reference.png",
            Buffer.concat([
              minimalImageBytes(
                "image/png",
              ),
              Buffer.alloc(
                10485761 -
                  minimalImageBytes(
                    "image/png",
                  ).length,
              ),
            ]),
            /TOO_LARGE/,
          ],
        ])(
          "rejects a reference image with %s through the secure reader",
          async (
            _label,
            fileName,
            bytes,
            message,
          ) => {
            await expectNoCreate(
              async (mediaRoot) => ({
                sourceImagePath:
                  await writeImage(
                    referencePath(
                      mediaRoot,
                      fileName,
                    ),
                    bytes,
                  ),
              }),
              message,
            );
          },
        );

        it(
          "raises the typed reference-image error for a directory path",
          async () => {
            const mediaRoot =
              await makeMediaRoot();

            const directoryPath =
              referencePath(
                mediaRoot,
                "folder.png",
              );

            await mkdir(
              directoryPath,
              {
                recursive:
                  true,
              },
            );

            const createInteraction =
              createInteractionMock();

            await expect(
              submitGoogleGenAiSingleShot(
                await validInput(
                  mediaRoot,
                  {
                    sourceImagePath:
                      directoryPath,
                  },
                ),
                {
                  createInteraction,
                },
              ),
            ).rejects.toBeInstanceOf(
              GoogleGenAiReferenceImageRejectedError,
            );

            expect(
              createInteraction,
            ).toHaveBeenCalledTimes(
              0,
            );
          },
        );
      },
    );

    it.each([
      [
        "empty",
        "",
      ],
      [
        "whitespace",
        " \n\t ",
      ],
      [
        "non-string",
        12345,
      ],
      [
        "undefined",
        undefined,
      ],
    ])(
      "rejects a %s Interaction.id without recording or recreating",
      async (
        _label,
        id,
      ) => {
        const mediaRoot =
          await makeMediaRoot();

        const onSubmissionAccepted =
          acceptanceMock();

        const createInteraction =
          createInteractionMock({
            id,
          });

        await expect(
          submitGoogleGenAiSingleShot(
            await validInput(
              mediaRoot,
              {
                onSubmissionAccepted,
              },
            ),
            {
              createInteraction,
            },
          ),
        ).rejects.toThrow(
          /empty Interaction\.id/i,
        );

        expect(
          createInteraction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledTimes(
          0,
        );
      },
    );

    it.each([
      "v1_Chd-abc/DEF+123==",
      "  v1_padded-provider-id  ",
    ])(
      "preserves the provider Interaction.id %j exactly",
      async (id) => {
        const mediaRoot =
          await makeMediaRoot();

        const onSubmissionAccepted =
          acceptanceMock();

        const result =
          await submitGoogleGenAiSingleShot(
            await validInput(
              mediaRoot,
              {
                onSubmissionAccepted,
              },
            ),
            {
              createInteraction:
                createInteractionMock({
                  id,
                }),
            },
          );

        expect(
          firstAcceptance(
            onSubmissionAccepted,
          ).providerExecutionId,
        ).toBe(
          id,
        );

        expect(
          result.providerExecutionId,
        ).toBe(
          id,
        );
      },
    );

    it(
      "propagates a provider create failure without acceptance or retry",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        const onSubmissionAccepted =
          acceptanceMock();

        const providerError =
          new Error(
            "Mock Google GenAI create failure.",
          );

        const createInteraction =
          vi.fn<GoogleGenAiInteractionCreator>(
            async () => {
              throw providerError;
            },
          );

        await expect(
          submitGoogleGenAiSingleShot(
            await validInput(
              mediaRoot,
              {
                onSubmissionAccepted,
              },
            ),
            {
              createInteraction,
            },
          ),
        ).rejects.toBe(
          providerError,
        );

        expect(
          createInteraction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledTimes(
          0,
        );
      },
    );

    it(
      "reports an accepted but unrecorded interaction and never recreates it",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        const durableError =
          new Error(
            "Mock durable submission persistence failure.",
          );

        const onSubmissionAccepted =
          vi.fn<GoogleGenAiSubmissionAcceptedHandler>(
            async () => {
              throw durableError;
            },
          );

        const createInteraction =
          createInteractionMock();

        let caught:
          unknown;

        try {
          await submitGoogleGenAiSingleShot(
            await validInput(
              mediaRoot,
              {
                onSubmissionAccepted,
              },
            ),
            {
              createInteraction,
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
        ).toContain(
          INTERACTION_ID,
        );

        expect(
          caught.message,
        ).toMatch(
          /Google GenAI accepted paid interaction/,
        );

        expect(
          caught.message,
        ).toMatch(
          /could not durably record the submission/,
        );

        expect(
          caught.message,
        ).toContain(
          "Do not resubmit automatically.",
        );

        expect(
          caught.cause,
        ).toBe(
          durableError,
        );

        expect(
          createInteraction,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          onSubmissionAccepted,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );
  },
);

/**
 * Type-level binding to the installed @google/genai SDK. This function is
 * never called and the SDK import is type-only, so no client is created.
 * It compiles only if the exact adapter request is accepted by the SDK's
 * non-streaming create overload and its result exposes Interaction.id.
 */
function bindInstalledSdkCreate(
  client:
    GoogleGenAI,
): GoogleGenAiInteractionCreator {
  return (request) =>
    client.interactions.create(
      request,
    );
}

describe(
  "Busybookie Google GenAI SDK 2.24.0 request compatibility",
  () => {
    it(
      "pins the installed SDK version",
      async () => {
        const manifest:
          unknown =
          JSON.parse(
            await readFile(
              join(
                process.cwd(),
                "node_modules",
                "@google",
                "genai",
                "package.json",
              ),
              "utf8",
            ),
          );

        expect(
          manifest,
        ).toMatchObject({
          version:
            "2.24.0",
        });
      },
    );

    it(
      "keeps the exact request structurally assignable to the SDK non-streaming model create params",
      async () => {
        const mediaRoot =
          await makeMediaRoot();

        const createInteraction =
          createInteractionMock();

        await submitGoogleGenAiSingleShot(
          await validInput(
            mediaRoot,
          ),
          {
            createInteraction,
          },
        );

        const sdkRequest:
          Interactions.CreateModelInteractionParamsNonStreaming =
          firstRequest(
            createInteraction,
          );

        expect(
          sdkRequest.stream,
        ).toBe(
          false,
        );

        expect(
          typeof bindInstalledSdkCreate,
        ).toBe(
          "function",
        );
      },
    );
  },
);
