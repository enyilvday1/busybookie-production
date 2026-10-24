import {
  readFile,
} from "node:fs/promises";

import {
  join,
} from "node:path";

import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const sdk =
  vi.hoisted(() => {
    const get =
      vi.fn();

    const create =
      vi.fn();

    const cancel =
      vi.fn();

    const deleteInteraction =
      vi.fn();

    const constructorOptions:
      unknown[] = [];

    const clientInteractions:
      unknown[] = [];

    class GoogleGenAI {
      readonly interactions = {
        get,
        create,
        cancel,
        delete:
          deleteInteraction,
      };

      constructor(
        options:
          unknown,
      ) {
        constructorOptions.push(
          options,
        );

        clientInteractions.push(
          this.interactions,
        );
      }
    }

    return {
      GoogleGenAI,
      get,
      create,
      cancel,
      deleteInteraction,
      constructorOptions,
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
  createGoogleGenAiSingleShotProductionInteractionGetter,
} from "../src/execution/providers/createGoogleGenAiSingleShotProductionInteractionGetter.js";

const PRODUCTION_SOURCE =
  "src/execution/providers/createGoogleGenAiSingleShotProductionInteractionGetter.ts";

const API_KEY =
  "test-google-genai-key";

const INTERACTION_ID =
  "interaction_abc123";

function expectNoForbiddenSdkCalls():
void {
  expect(
    sdk.create,
  ).not.toHaveBeenCalled();

  expect(
    sdk.cancel,
  ).not.toHaveBeenCalled();

  expect(
    sdk.deleteInteraction,
  ).not.toHaveBeenCalled();
}

beforeEach(
  () => {
    sdk.get.mockReset();
    sdk.create.mockReset();
    sdk.cancel.mockReset();
    sdk.deleteInteraction.mockReset();
    sdk.constructorOptions.length = 0;
    sdk.clientInteractions.length = 0;
  },
);

describe(
  "Busybookie dormant Google GenAI production interaction getter",
  () => {
    describe(
      "credentials",
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
                createGoogleGenAiSingleShotProductionInteractionGetter(
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
          "rejects a runtime non-string API key before constructing the SDK client",
          () => {
            // Method parameters are bivariant, which lets this test model an
            // untyped JavaScript caller passing a number at runtime.
            const untypedCaller: {
              create(
                apiKey:
                  unknown,
              ): unknown;
            } = {
              create:
                createGoogleGenAiSingleShotProductionInteractionGetter,
            };

            expect(
              () =>
                untypedCaller.create(
                  12345,
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
          "trims the key and never echoes it in errors",
          async () => {
            sdk.get.mockRejectedValue(
              new Error(
                "Mock SDK failure.",
              ),
            );

            const getInteraction =
              createGoogleGenAiSingleShotProductionInteractionGetter(
                `  \n${API_KEY}\t `,
              );

            expect(
              sdk.constructorOptions[0],
            ).toStrictEqual({
              apiKey:
                API_KEY,
            });

            let message =
              "";

            try {
              await getInteraction(
                INTERACTION_ID,
              );
            } catch (error) {
              message =
                error instanceof Error
                  ? error.message
                  : String(error);
            }

            expect(
              message,
            ).not.toContain(
              API_KEY,
            );
          },
        );

        it(
          "reads no credential environment variables while constructing or getting",
          async () => {
            sdk.get.mockResolvedValue({
              id:
                INTERACTION_ID,

              status:
                "queued",
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
              await createGoogleGenAiSingleShotProductionInteractionGetter(
                API_KEY,
              )(
                INTERACTION_ID,
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
      },
    );

    describe(
      "client construction",
      () => {
        it(
          "constructs exactly one client with only the normalized apiKey and reuses it",
          async () => {
            sdk.get.mockResolvedValue({
              id:
                INTERACTION_ID,

              status:
                "in_progress",
            });

            const getInteraction =
              createGoogleGenAiSingleShotProductionInteractionGetter(
                API_KEY,
              );

            expect(
              sdk.constructorOptions,
            ).toStrictEqual([
              {
                apiKey:
                  API_KEY,
              },
            ]);

            await getInteraction(
              INTERACTION_ID,
            );

            await getInteraction(
              INTERACTION_ID,
            );

            expect(
              sdk.constructorOptions,
            ).toHaveLength(
              1,
            );

            expect(
              sdk.get,
            ).toHaveBeenCalledTimes(
              2,
            );

            for (
              const context of sdk.get.mock.contexts
            ) {
              expect(
                context,
              ).toBe(
                sdk.clientInteractions[0],
              );
            }
          },
        );
      },
    );

    describe(
      "exact get call",
      () => {
        it(
          "calls get once with the exact id, params, and options",
          async () => {
            sdk.get.mockResolvedValue({
              id:
                INTERACTION_ID,

              status:
                "completed",
            });

            await createGoogleGenAiSingleShotProductionInteractionGetter(
              API_KEY,
            )(
              INTERACTION_ID,
            );

            expect(
              sdk.get,
            ).toHaveBeenCalledTimes(
              1,
            );

            const call =
              sdk.get.mock.calls[0] ?? [];

            expect(
              call,
            ).toStrictEqual([
              "interaction_abc123",
              {
                stream:
                  false,

                include_input:
                  false,
              },
              {
                maxRetries:
                  0,
              },
            ]);

            expect(
              Object.keys(
                call[1] ?? {},
              ).sort(),
            ).toEqual([
              "include_input",
              "stream",
            ]);

            expect(
              Object.keys(
                call[2] ?? {},
              ),
            ).toEqual([
              "maxRetries",
            ]);

            expectNoForbiddenSdkCalls();
          },
        );

        it(
          "passes a valid id through without transforming it",
          async () => {
            const id =
              "v1_Chd-abc/DEF+123==";

            sdk.get.mockResolvedValue({
              id,

              status:
                "queued",
            });

            await createGoogleGenAiSingleShotProductionInteractionGetter(
              API_KEY,
            )(
              id,
            );

            expect(
              sdk.get.mock.calls[0]?.[0],
            ).toBe(
              id,
            );
          },
        );

        it.each([
          "",
          "   ",
        ])(
          "rejects providerExecutionId %j before calling the SDK",
          async (id) => {
            await expect(
              createGoogleGenAiSingleShotProductionInteractionGetter(
                API_KEY,
              )(
                id,
              ),
            ).rejects.toThrow(
              /requires a non-empty providerExecutionId/i,
            );

            expect(
              sdk.get,
            ).not.toHaveBeenCalled();

            expectNoForbiddenSdkCalls();
          },
        );
      },
    );

    describe(
      "return value",
      () => {
        it.each([
          [
            "normal",
            INTERACTION_ID,
            "completed",
          ],
          [
            "padded id and unknown status",
            "  padded  ",
            "something_new",
          ],
          [
            "non-string values",
            42,
            null,
          ],
          [
            "missing values",
            undefined,
            undefined,
          ],
        ])(
          "returns only the raw id and status (%s) in a frozen object",
          async (
            _label,
            id,
            status,
          ) => {
            sdk.get.mockResolvedValue({
              id,

              status,

              outputs: [
                {
                  type:
                    "video",
                },
              ],

              model:
                "gemini-omni-1.1-flash",
            });

            const result =
              await createGoogleGenAiSingleShotProductionInteractionGetter(
                API_KEY,
              )(
                INTERACTION_ID,
              );

            expect(
              result,
            ).toStrictEqual({
              id,
              status,
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
      },
    );

    describe(
      "error semantics",
      () => {
        it.each([
          [
            "Error",
            new Error(
              "Mock SDK failure.",
            ),
          ],
          [
            "non-Error",
            "connection reset",
          ],
          [
            "401",
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
            "404",
            Object.assign(
              new Error(
                "Not found.",
              ),
              {
                status:
                  404,
              },
            ),
          ],
          [
            "429",
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
            "503",
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
        ])(
          "fails closed on a %s rejection with one get and no replacement",
          async (
            _label,
            failure,
          ) => {
            sdk.get.mockRejectedValue(
              failure,
            );

            let caught:
              unknown;

            try {
              await createGoogleGenAiSingleShotProductionInteractionGetter(
                API_KEY,
              )(
                INTERACTION_ID,
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
              /same-ID interaction recovery failed/,
            );

            expect(
              caught.message,
            ).toContain(
              INTERACTION_ID,
            );

            expect(
              caught.message,
            ).toMatch(
              /must not create or resubmit a replacement interaction automatically/,
            );

            expect(
              caught.cause,
            ).toBe(
              failure,
            );

            expect(
              sdk.get,
            ).toHaveBeenCalledTimes(
              1,
            );

            expectNoForbiddenSdkCalls();
          },
        );
      },
    );

    it(
      "keeps the production source free of env access, create, cancel, delete, polling, timeouts, streaming, and retry loops",
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
          /process\.env|\.create\(|\.cancel\(|\.delete\(|\btimeout\b|api_version|last_event_id|httpOptions|vertexai|baseUrl|apiVersion|stream:\s*true|\bwhile\s*\(|\bfor\s*\(|setTimeout|setInterval|console\./,
        );

        expect(
          source.match(
            /\.get\(/g,
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
            /maxRetries/g,
          ) ?? [],
        ).toHaveLength(
          1,
        );
      },
    );
  },
);
