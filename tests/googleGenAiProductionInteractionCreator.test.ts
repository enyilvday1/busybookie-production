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
  join,
} from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const sdk =
  vi.hoisted(() => {
    const create =
      vi.fn();

    const get =
      vi.fn();

    const cancel =
      vi.fn();

    const constructorOptions:
      unknown[] = [];

    const instances:
      unknown[] = [];

    const clientInteractions:
      unknown[] = [];

    class GoogleGenAI {
      readonly interactions = {
        create,
        get,
        cancel,
      };

      constructor(
        options:
          unknown,
      ) {
        constructorOptions.push(
          options,
        );

        instances.push(
          this,
        );

        clientInteractions.push(
          this.interactions,
        );
      }
    }

    return {
      GoogleGenAI,
      create,
      get,
      cancel,
      constructorOptions,
      instances,
      clientInteractions,
    };
  });

vi.mock(
  "@google/genai",
  () => ({
    GoogleGenAI:
      sdk.GoogleGenAI,
  }),
);

import {
  createGoogleGenAiSingleShotProductionInteractionCreator,
} from "../src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.js";

import {
  submitGoogleGenAiSingleShot,
  type GoogleGenAiSingleShotInteractionRequest,
} from "../src/execution/providers/submitGoogleGenAiSingleShot.js";

import {
  loadGoogleGenAiPolicy,
} from "../src/validation/loadGoogleGenAiPolicy.js";

import {
  loadGoogleGenAiActivationPolicy,
} from "../src/validation/loadGoogleGenAiActivationPolicy.js";

import {
  GOOGLE_GENAI_CREATE_TIMEOUT_MS,
} from "../src/googleGenai/googleGenAiActivationLimits.js";

const PRODUCTION_SOURCE =
  "src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.ts";

const API_KEY =
  "test-google-genai-key";

const INTERACTION_ID =
  "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";

function makeRequest():
GoogleGenAiSingleShotInteractionRequest {
  return {
    model:
      "gemini-omni-1.1-flash",

    input: [
      {
        type:
          "text",

        text:
          "Busybookie Google GenAI production creator test.",
      },
      {
        type:
          "image",

        data:
          "iVBORw0KGgo=",

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
  };
}

const temporaryDirectories:
  string[] = [];

beforeEach(
  () => {
    sdk.create.mockReset();
    sdk.get.mockReset();
    sdk.cancel.mockReset();
    sdk.constructorOptions.length = 0;
    sdk.instances.length = 0;
    sdk.clientInteractions.length = 0;
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

describe(
  "Busybookie dormant Google GenAI production interaction creator",
  () => {
    it.each([
      "",
      "   ",
      " \n\t ",
    ])(
      "rejects API key %j before constructing the SDK client",
      (apiKey) => {
        expect(
          () =>
            createGoogleGenAiSingleShotProductionInteractionCreator(
              apiKey,
            ),
        ).toThrow(
          "Google GenAI API key is required.",
        );

        expect(
          sdk.constructorOptions,
        ).toHaveLength(
          0,
        );
      },
    );

    it(
      "does not echo the supplied key in the validation error",
      () => {
        let message =
          "";

        try {
          createGoogleGenAiSingleShotProductionInteractionCreator(
            "\t \n",
          );
        } catch (error) {
          message =
            error instanceof Error
              ? error.message
              : String(error);
        }

        expect(
          message,
        ).toBe(
          "Google GenAI API key is required.",
        );
      },
    );

    it(
      "constructs exactly one SDK client with only the trimmed apiKey",
      () => {
        createGoogleGenAiSingleShotProductionInteractionCreator(
          `  \n${API_KEY}\t `,
        );

        expect(
          sdk.constructorOptions,
        ).toHaveLength(
          1,
        );

        expect(
          sdk.constructorOptions[0],
        ).toStrictEqual({
          apiKey:
            API_KEY,
        });

        expect(
          Object.keys(
            sdk.constructorOptions[0] ?? {},
          ),
        ).toEqual([
          "apiKey",
        ]);
      },
    );

    it(
      "reuses the same SDK client across creator calls without constructing another",
      async () => {
        sdk.create.mockResolvedValue({
          id:
            INTERACTION_ID,
        });

        const createInteraction =
          createGoogleGenAiSingleShotProductionInteractionCreator(
            API_KEY,
          );

        await createInteraction(
          makeRequest(),
        );

        await createInteraction(
          makeRequest(),
        );

        expect(
          sdk.constructorOptions,
        ).toHaveLength(
          1,
        );

        expect(
          sdk.instances,
        ).toHaveLength(
          1,
        );

        expect(
          sdk.create,
        ).toHaveBeenCalledTimes(
          2,
        );

        expect(
          sdk.create.mock.contexts,
        ).toHaveLength(
          2,
        );

        for (
          const context of sdk.create.mock.contexts
        ) {
          expect(
            context,
          ).toBe(
            sdk.clientInteractions[0],
          );
        }
      },
    );

    it(
      "passes the exact request object unchanged with exactly { maxRetries: 0, timeout: 60000 }",
      async () => {
        sdk.create.mockResolvedValue({
          id:
            INTERACTION_ID,
        });

        const createInteraction =
          createGoogleGenAiSingleShotProductionInteractionCreator(
            API_KEY,
          );

        const request =
          makeRequest();

        const snapshot =
          structuredClone(
            request,
          );

        await createInteraction(
          request,
        );

        expect(
          sdk.create,
        ).toHaveBeenCalledTimes(
          1,
        );

        const call =
          sdk.create.mock.calls[0] ?? [];

        expect(
          call,
        ).toHaveLength(
          2,
        );

        expect(
          call[0],
        ).toBe(
          request,
        );

        expect(
          request,
        ).toStrictEqual(
          snapshot,
        );

        expect(
          call[1],
        ).toStrictEqual({
          maxRetries:
            0,

          timeout:
            60000,
        });

        expect(
          sdk.get,
        ).not.toHaveBeenCalled();

        expect(
          sdk.cancel,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "makes exactly one SDK create per creator call, never extra retries",
      async () => {
        sdk.create.mockResolvedValue({
          id:
            INTERACTION_ID,
        });

        const createInteraction =
          createGoogleGenAiSingleShotProductionInteractionCreator(
            API_KEY,
          );

        await createInteraction(
          makeRequest(),
        );

        expect(
          sdk.create,
        ).toHaveBeenCalledTimes(
          1,
        );

        await createInteraction(
          makeRequest(),
        );

        expect(
          sdk.create,
        ).toHaveBeenCalledTimes(
          2,
        );

        for (
          const call of sdk.create.mock.calls
        ) {
          expect(
            call[1],
          ).toStrictEqual({
            maxRetries:
              0,

            timeout:
              60000,
          });
        }
      },
    );

    it(
      "returns only the raw Interaction.id in a frozen object",
      async () => {
        sdk.create.mockResolvedValue({
          id:
            INTERACTION_ID,

          status:
            "in_progress",

          model:
            "gemini-omni-1.1-flash",

          steps:
            [],
        });

        const result =
          await createGoogleGenAiSingleShotProductionInteractionCreator(
            API_KEY,
          )(
            makeRequest(),
          );

        expect(
          result,
        ).toStrictEqual({
          id:
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

    it.each([
      [
        "padded string",
        "  v1_padded  ",
      ],
      [
        "blank string",
        "   ",
      ],
      [
        "number",
        42,
      ],
      [
        "null",
        null,
      ],
      [
        "undefined",
        undefined,
      ],
    ])(
      "preserves a raw %s Interaction.id without validation or coercion",
      async (
        _label,
        id,
      ) => {
        sdk.create.mockResolvedValue({
          id,
        });

        const result =
          await createGoogleGenAiSingleShotProductionInteractionCreator(
            API_KEY,
          )(
            makeRequest(),
          );

        expect(
          result.id,
        ).toBe(
          id,
        );

        expect(
          sdk.create,
        ).toHaveBeenCalledTimes(
          1,
        );
      },
    );

    it.each([
      [
        "SDK error",
        new Error(
          "Mock SDK failure.",
        ),
      ],
      [
        "timeout",
        Object.assign(
          new Error(
            "Request timed out.",
          ),
          {
            name:
              "APIConnectionTimeoutError",
          },
        ),
      ],
      [
        "AbortSignal.timeout TimeoutError",
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      ],
      [
        "HTTP 429",
        Object.assign(
          new Error(
            "Too many requests.",
          ),
          {
            status:
              429,
          },
        ),
      ],
      [
        "HTTP 503",
        Object.assign(
          new Error(
            "Service unavailable.",
          ),
          {
            status:
              503,
          },
        ),
      ],
      [
        "HTTP 401",
        Object.assign(
          new Error(
            "Unauthenticated.",
          ),
          {
            status:
              401,
          },
        ),
      ],
      [
        "non-Error rejection",
        "connection reset",
      ],
    ])(
      "fails closed on a rejected create (%s) with one call and no resubmission",
      async (
        _label,
        failure,
      ) => {
        sdk.create.mockRejectedValue(
          failure,
        );

        const createInteraction =
          createGoogleGenAiSingleShotProductionInteractionCreator(
            API_KEY,
          );

        let caught:
          unknown;

        try {
          await createInteraction(
            makeRequest(),
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
          "Do not resubmit automatically.",
        );

        expect(
          caught.message,
        ).not.toContain(
          API_KEY,
        );

        expect(
          caught.cause,
        ).toBe(
          failure,
        );

        expect(
          sdk.create,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          sdk.create.mock.calls[0]?.[1],
        ).toStrictEqual({
          maxRetries:
            0,

          timeout:
            60000,
        });

        expect(
          sdk.get,
        ).not.toHaveBeenCalled();

        expect(
          sdk.cancel,
        ).not.toHaveBeenCalled();

        expect(
          sdk.constructorOptions,
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "reads no credential environment variables while constructing or creating",
      async () => {
        sdk.create.mockResolvedValue({
          id:
            INTERACTION_ID,
        });

        const originalEnv =
          process.env;

        const reads:
          string[] = [];

        process.env =
          new Proxy(
            originalEnv,
            {
              get(
                target,
                key,
                receiver,
              ) {
                if (
                  typeof key ===
                  "string"
                ) {
                  reads.push(
                    key,
                  );
                }

                return Reflect.get(
                  target,
                  key,
                  receiver,
                );
              },
            },
          );

        try {
          await createGoogleGenAiSingleShotProductionInteractionCreator(
            API_KEY,
          )(
            makeRequest(),
          );
        } finally {
          process.env =
            originalEnv;
        }

        expect(
          reads.filter(
            (key) =>
              /GEMINI|GOOGLE|API_KEY/i.test(
                key,
              ),
          ),
        ).toEqual([]);
      },
    );

    it(
      "keeps the production source free of env access, polling, cancellation, extra timeouts, client retry options, and retry loops",
      async () => {
        const source =
          (
            await readFile(
              join(
                process.cwd(),
                PRODUCTION_SOURCE,
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
          /process\.env|\.get\(|\bcancel\b|httpOptions|retryOptions|vertexai|project\s*:|location\s*:|baseUrl|apiVersion|\bwhile\s*\(|\bfor\s*\(|setTimeout|console\./,
        );

        // The only permitted timeout is the frozen B4U5 create timeout,
        // passed once as an SDK request option alongside maxRetries: 0.
        expect(
          source.match(
            /\btimeout\b/g,
          ) ?? [],
        ).toHaveLength(
          1,
        );

        expect(
          source,
        ).toMatch(
          /timeout:\s*GOOGLE_GENAI_CREATE_TIMEOUT_MS,/,
        );

        expect(
          GOOGLE_GENAI_CREATE_TIMEOUT_MS,
        ).toBe(
          60000,
        );

        expect(
          source.match(
            /\.create\(/g,
          ) ?? [],
        ).toHaveLength(
          1,
        );

        expect(
          source.match(
            /new GoogleGenAI\(/g,
          ) ?? [],
        ).toHaveLength(
          1,
        );

        expect(
          source.match(
            /maxRetries:\s*0,/g,
          ) ?? [],
        ).toHaveLength(
          1,
        );

        expect(
          source.match(
            /maxRetries/g,
          ) ?? [],
        ).toHaveLength(
          1,
        );
      },
    );

    it(
      "lets the dormant adapter remain the sole Interaction.id validator",
      async () => {
        const mediaRoot =
          await mkdtemp(
            join(
              tmpdir(),
              "busybookie-google-genai-creator-",
            ),
          );

        temporaryDirectories.push(
          mediaRoot,
        );

        const sourceImagePath =
          join(
            mediaRoot,
            "references",
            "EP92",
            "S01",
            "reference.png",
          );

        await mkdir(
          join(
            mediaRoot,
            "references",
            "EP92",
            "S01",
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          sourceImagePath,
          Buffer.from([
            0x89,
            0x50,
            0x4e,
            0x47,
            0x0d,
            0x0a,
            0x1a,
            0x0a,
          ]),
        );

        sdk.create.mockResolvedValue({
          id:
            "   ",
        });

        const checkedInActivationPolicy =
          await loadGoogleGenAiActivationPolicy();

        const onSubmissionAccepted =
          vi.fn(
            async () => {},
          );

        await expect(
          submitGoogleGenAiSingleShot(
            {
              mediaRoot,

              episodeId:
                "EP92",

              shotId:
                "S01",

              reservation: {
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
              },

              sourceImagePath,

              promptText:
                "Busybookie adapter composition test.",

              policySnapshot:
                await loadGoogleGenAiPolicy(),

              activationPolicy: {
                ...checkedInActivationPolicy,

                admission: {
                  newSubmissionsEnabled:
                    true,
                },
              },

              resolution:
                "720p",

              onSubmissionAccepted,
            },
            {
              createInteraction:
                createGoogleGenAiSingleShotProductionInteractionCreator(
                  API_KEY,
                ),
            },
          ),
        ).rejects.toThrow(
          /empty Interaction\.id/i,
        );

        expect(
          sdk.create,
        ).toHaveBeenCalledTimes(
          1,
        );

        expect(
          sdk.create.mock.calls[0]?.[1],
        ).toStrictEqual({
          maxRetries:
            0,

          timeout:
            60000,
        });

        expect(
          onSubmissionAccepted,
        ).not.toHaveBeenCalled();
      },
    );
  },
);
