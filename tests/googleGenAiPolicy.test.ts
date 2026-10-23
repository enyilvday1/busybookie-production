import {
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
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  GoogleGenAiPolicySchema,
  type GoogleGenAiPolicy,
} from "../src/schemas/googleGenAiPolicy.schema.js";

import {
  DEFAULT_GOOGLE_GENAI_POLICY_PATH,
  loadGoogleGenAiPolicy,
} from "../src/validation/loadGoogleGenAiPolicy.js";

import {
  deriveGoogleGenAiVideoOutputMicroUsdPerSecond,
} from "../src/googleGenai/googleGenAiPricing.js";

import {
  GEMINI_OMNI_11_FLASH_MODEL,
  GOOGLE_GENAI_PROVIDER,
} from "../src/googleGenai/googleGenAi.types.js";

async function loadTrackedPolicyJson():
Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(
      DEFAULT_GOOGLE_GENAI_POLICY_PATH,
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function withPath(
  source:
    Record<string, unknown>,
  path:
    readonly string[],
  value:
    unknown,
): Record<string, unknown> {
  const clone =
    structuredClone(
      source,
    );

  let cursor:
    Record<string, unknown> =
      clone;

  for (
    const key of path.slice(
      0,
      -1,
    )
  ) {
    cursor =
      cursor[key] as Record<string, unknown>;
  }

  const last =
    path[path.length - 1] as string;

  if (
    value === undefined
  ) {
    delete cursor[last];
  } else {
    cursor[last] =
      value;
  }

  return clone;
}

function collectKeys(
  value:
    unknown,
): string[] {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return [];
  }

  return Object.entries(
    value,
  ).flatMap(
    ([
      key,
      nested,
    ]) => [
      key,
      ...collectKeys(
        nested,
      ),
    ],
  );
}

describe(
  "Busybookie Google GenAI provider foundation policy",
  () => {
    it(
      "loads the tracked Google GenAI policy",
      async () => {
        const policy =
          await loadGoogleGenAiPolicy();

        expect(policy).toEqual({
          schemaVersion:
            "1.0",

          provider:
            "GOOGLE_GENAI",

          model:
            "gemini-omni-1.1-flash",

          pricingReviewedOn:
            "2026-10-23",

          pricingProvenance: {
            pricingSource:
              "GOOGLE_GEMINI_API_OFFICIAL_PRICING_PAGE",

            modelLifecycleSource:
              "GOOGLE_GEMINI_API_OFFICIAL_DEPRECATIONS_PAGE",

            verifiedOn:
              "2026-10-23",
          },

          pricing: {
            currency:
              "USD",

            fixedPointUnit:
              "MICRO_USD",

            tokensPerPricingUnit:
              1_000_000,

            inputMicroUsdPerMillionTokens:
              1_500_000,

            videoOutputMicroUsdPerMillionTokens:
              17_500_000,

            videoOutput720pTokensPerSecond:
              5792,

            knownVideoOutput720pMicroUsdPerSecond:
              101_360,
          },

          costCompleteness: {
            costScope:
              "KNOWN_VIDEO_OUTPUT_PLUS_SEPARATE_INPUT_COMPONENT",

            preReservationTotalCostExactlyKnown:
              false,

            inputTokenComponentIncludedInKnownCost:
              false,
          },
        } satisfies GoogleGenAiPolicy);
      },
    );

    it(
      "uses the GOOGLE_GENAI provider identity and never VEO",
      async () => {
        const policy =
          await loadGoogleGenAiPolicy();

        expect(
          policy.provider,
        ).toBe(
          GOOGLE_GENAI_PROVIDER,
        );

        expect(
          policy.provider,
        ).not.toBe("VEO");

        const tracked =
          await loadTrackedPolicyJson();

        for (
          const provider of [
            "VEO",
            "veo",
            "GOOGLE",
            "GEMINI",
            "google_genai",
            "RUNWAY",
            "",
          ]
        ) {
          expect(
            GoogleGenAiPolicySchema.safeParse(
              withPath(
                tracked,
                [
                  "provider",
                ],
                provider,
              ),
            ).success,
          ).toBe(false);
        }

        expect(
          GoogleGenAiPolicySchema.safeParse(
            withPath(
              tracked,
              [
                "provider",
              ],
              undefined,
            ),
          ).success,
        ).toBe(false);
      },
    );

    it(
      "locks the model to gemini-omni-1.1-flash and rejects the shut-down Veo model",
      async () => {
        const policy =
          await loadGoogleGenAiPolicy();

        expect(
          policy.model,
        ).toBe(
          "gemini-omni-1.1-flash",
        );

        expect(
          GEMINI_OMNI_11_FLASH_MODEL,
        ).toBe(
          "gemini-omni-1.1-flash",
        );

        const tracked =
          await loadTrackedPolicyJson();

        for (
          const model of [
            "veo-3.1-fast-generate-preview",
            "veo-3.1-generate-preview",
            "gemini-omni-1.1-flash-latest",
            "Gemini-Omni-1.1-Flash",
            "",
          ]
        ) {
          expect(
            GoogleGenAiPolicySchema.safeParse(
              withPath(
                tracked,
                [
                  "model",
                ],
                model,
              ),
            ).success,
          ).toBe(false);
        }
      },
    );

    it(
      "does not accept the legacy Veo policy document",
      async () => {
        const veoPolicy =
          JSON.parse(
            await readFile(
              join(
                process.cwd(),
                "config",
                "veo-policy.json",
              ),
              "utf8",
            ),
          ) as unknown;

        expect(
          GoogleGenAiPolicySchema.safeParse(
            veoPolicy,
          ).success,
        ).toBe(false);
      },
    );

    it(
      "records an explicit pricing review date and explicit pricing provenance",
      async () => {
        const policy =
          await loadGoogleGenAiPolicy();

        expect(
          policy.pricingReviewedOn,
        ).toBe("2026-10-23");

        expect(
          policy.pricingProvenance.verifiedOn,
        ).toBe("2026-10-23");

        expect(
          policy.pricingProvenance.pricingSource,
        ).toBe(
          "GOOGLE_GEMINI_API_OFFICIAL_PRICING_PAGE",
        );

        expect(
          policy.pricingProvenance.modelLifecycleSource,
        ).toBe(
          "GOOGLE_GEMINI_API_OFFICIAL_DEPRECATIONS_PAGE",
        );

        expect(
          policy.pricingProvenance.pricingSource,
        ).not.toBe(
          policy.pricingProvenance.modelLifecycleSource,
        );

        const tracked =
          await loadTrackedPolicyJson();

        const rejected: Array<
          [
            readonly string[],
            unknown,
          ]
        > = [
          [
            [
              "pricingProvenance",
            ],
            undefined,
          ],
          [
            [
              "pricingProvenance",
              "pricingSource",
            ],
            undefined,
          ],
          [
            [
              "pricingProvenance",
              "modelLifecycleSource",
            ],
            undefined,
          ],
          [
            [
              "pricingProvenance",
              "pricingSource",
            ],
            "internet",
          ],
          [
            [
              "pricingProvenance",
              "pricingSource",
            ],
            "Google",
          ],
          [
            [
              "pricingProvenance",
              "modelLifecycleSource",
            ],
            "GOOGLE_GEMINI_API_OFFICIAL_PRICING_PAGE",
          ],
          [
            [
              "pricingProvenance",
              "verifiedOn",
            ],
            "2026-10-22",
          ],
          [
            [
              "pricingReviewedOn",
            ],
            undefined,
          ],
          [
            [
              "pricingReviewedOn",
            ],
            "23/10/2026",
          ],
          [
            [
              "pricingReviewedOn",
            ],
            "2026-10-23T00:00:00Z",
          ],
          [
            [
              "pricingProvenance",
              "verifiedOn",
            ],
            "2026-1-23",
          ],
        ];

        for (
          const [
            path,
            value,
          ] of rejected
        ) {
          expect(
            GoogleGenAiPolicySchema.safeParse(
              withPath(
                tracked,
                path,
                value,
              ),
            ).success,
            `${path.join(".")}=${String(value)}`,
          ).toBe(false);
        }
      },
    );

    it(
      "records the locked fixed-point MICRO_USD pricing inputs",
      async () => {
        const policy =
          await loadGoogleGenAiPolicy();

        expect(
          policy.pricing.currency,
        ).toBe("USD");

        expect(
          policy.pricing.fixedPointUnit,
        ).toBe("MICRO_USD");

        expect(
          policy.pricing.inputMicroUsdPerMillionTokens,
        ).toBe(1_500_000);

        expect(
          policy.pricing.videoOutputMicroUsdPerMillionTokens,
        ).toBe(17_500_000);

        expect(
          policy.pricing.videoOutput720pTokensPerSecond,
        ).toBe(5792);
      },
    );

    it(
      "derives the known 720p video-output component as exactly 101360 MICRO_USD per second",
      async () => {
        const policy =
          await loadGoogleGenAiPolicy();

        expect(
          deriveGoogleGenAiVideoOutputMicroUsdPerSecond(
            5792,
            17_500_000,
          ),
        ).toBe(101_360);

        expect(
          deriveGoogleGenAiVideoOutputMicroUsdPerSecond(
            policy.pricing.videoOutput720pTokensPerSecond,
            policy.pricing.videoOutputMicroUsdPerMillionTokens,
          ),
        ).toBe(
          policy.pricing.knownVideoOutput720pMicroUsdPerSecond,
        );

        expect(
          policy.pricing.knownVideoOutput720pMicroUsdPerSecond,
        ).toBe(101_360);
      },
    );

    it(
      "rejects pricing fields inconsistent with the derived video-output component",
      async () => {
        const tracked =
          await loadTrackedPolicyJson();

        for (
          const [
            path,
            value,
          ] of [
            [
              [
                "pricing",
                "knownVideoOutput720pMicroUsdPerSecond",
              ],
              101_361,
            ],
            [
              [
                "pricing",
                "knownVideoOutput720pMicroUsdPerSecond",
              ],
              100_000,
            ],
            [
              [
                "pricing",
                "videoOutput720pTokensPerSecond",
              ],
              5793,
            ],
            [
              [
                "pricing",
                "videoOutputMicroUsdPerMillionTokens",
              ],
              17_000_000,
            ],
          ] as const
        ) {
          expect(
            GoogleGenAiPolicySchema.safeParse(
              withPath(
                tracked,
                path,
                value,
              ),
            ).success,
            `${path.join(".")}=${String(value)}`,
          ).toBe(false);
        }
      },
    );

    it(
      "fails the derivation closed when the result is not an exact integer of MICRO_USD",
      () => {
        expect(() =>
          deriveGoogleGenAiVideoOutputMicroUsdPerSecond(
            5792,
            17_500_001,
          ),
        ).toThrow(
          /not an exact integer/,
        );

        expect(() =>
          deriveGoogleGenAiVideoOutputMicroUsdPerSecond(
            0,
            17_500_000,
          ),
        ).toThrow(
          /positive safe integer/,
        );

        expect(() =>
          deriveGoogleGenAiVideoOutputMicroUsdPerSecond(
            5792.5,
            17_500_000,
          ),
        ).toThrow(
          /positive safe integer/,
        );

        expect(() =>
          deriveGoogleGenAiVideoOutputMicroUsdPerSecond(
            Number.MAX_SAFE_INTEGER,
            17_500_000,
          ),
        ).toThrow(
          /overflowed/,
        );
      },
    );

    it(
      "keeps the complete pre-reservation request cost explicitly not exactly known",
      async () => {
        const policy =
          await loadGoogleGenAiPolicy();

        expect(
          policy.costCompleteness,
        ).toEqual({
          costScope:
            "KNOWN_VIDEO_OUTPUT_PLUS_SEPARATE_INPUT_COMPONENT",

          preReservationTotalCostExactlyKnown:
            false,

          inputTokenComponentIncludedInKnownCost:
            false,
        });

        const tracked =
          await loadTrackedPolicyJson();

        for (
          const [
            path,
            value,
          ] of [
            [
              [
                "costCompleteness",
                "preReservationTotalCostExactlyKnown",
              ],
              true,
            ],
            [
              [
                "costCompleteness",
                "inputTokenComponentIncludedInKnownCost",
              ],
              true,
            ],
            [
              [
                "costCompleteness",
                "costScope",
              ],
              "KNOWN_GENERATION_COST",
            ],
            [
              [
                "costCompleteness",
                "preReservationTotalCostExactlyKnown",
              ],
              undefined,
            ],
            [
              [
                "costCompleteness",
              ],
              undefined,
            ],
          ] as const
        ) {
          expect(
            GoogleGenAiPolicySchema.safeParse(
              withPath(
                tracked,
                path,
                value,
              ),
            ).success,
            `${path.join(".")}=${String(value)}`,
          ).toBe(false);
        }
      },
    );

    it(
      "rejects zero, negative, non-integral, unsafe, and coercible pricing values",
      async () => {
        const tracked =
          await loadTrackedPolicyJson();

        const fields = [
          "inputMicroUsdPerMillionTokens",
          "videoOutputMicroUsdPerMillionTokens",
          "videoOutput720pTokensPerSecond",
          "knownVideoOutput720pMicroUsdPerSecond",
        ] as const;

        const invalidValues = [
          0,
          -1,
          -1_500_000,
          1.5,
          0.10136,
          Number.MAX_SAFE_INTEGER + 1,
          Number.NaN,
          Number.POSITIVE_INFINITY,
          "1500000",
          null,
          undefined,
        ];

        for (
          const field of fields
        ) {
          for (
            const value of invalidValues
          ) {
            expect(
              GoogleGenAiPolicySchema.safeParse(
                withPath(
                  tracked,
                  [
                    "pricing",
                    field,
                  ],
                  value,
                ),
              ).success,
              `${field}=${String(value)}`,
            ).toBe(false);
          }
        }

        for (
          const [
            field,
            value,
          ] of [
            [
              "currency",
              "EUR",
            ],
            [
              "fixedPointUnit",
              "CENTS",
            ],
            [
              "tokensPerPricingUnit",
              1000,
            ],
          ] as const
        ) {
          expect(
            GoogleGenAiPolicySchema.safeParse(
              withPath(
                tracked,
                [
                  "pricing",
                  field,
                ],
                value,
              ),
            ).success,
            `${field}=${String(value)}`,
          ).toBe(false);
        }
      },
    );

    it(
      "rejects the legacy Veo centsPerSecond pricing shape",
      async () => {
        const tracked =
          await loadTrackedPolicyJson();

        expect(
          GoogleGenAiPolicySchema.safeParse(
            withPath(
              tracked,
              [
                "pricing",
                "centsPerSecond",
              ],
              10,
            ),
          ).success,
        ).toBe(false);
      },
    );

    it(
      "rejects unknown keys at every level and a wrong schema version",
      async () => {
        const tracked =
          await loadTrackedPolicyJson();

        for (
          const path of [
            [
              "automaticRoutingEnabled",
            ],
            [
              "operationName",
            ],
            [
              "pricingProvenance",
              "source",
            ],
            [
              "pricing",
              "score",
            ],
            [
              "costCompleteness",
              "rank",
            ],
          ]
        ) {
          expect(
            GoogleGenAiPolicySchema.safeParse(
              withPath(
                tracked,
                path,
                true,
              ),
            ).success,
            path.join("."),
          ).toBe(false);
        }

        for (
          const version of [
            "1.1",
            "2.0",
            1,
            undefined,
          ]
        ) {
          expect(
            GoogleGenAiPolicySchema.safeParse(
              withPath(
                tracked,
                [
                  "schemaVersion",
                ],
                version,
              ),
            ).success,
          ).toBe(false);
        }
      },
    );

    it(
      "exposes no routing, ranking, scoring, selection, or lifecycle fields",
      async () => {
        const policy =
          await loadGoogleGenAiPolicy();

        const forbidden =
          /rout|rank|score|select|eligib|fallback|switch|operation|interaction|enabled/i;

        expect(
          collectKeys(
            policy,
          ).filter(
            (key) =>
              forbidden.test(
                key,
              ),
          ),
        ).toEqual([]);
      },
    );

    describe(
      "loader fail-closed behaviour",
      () => {
        let directory:
          string;

        beforeAll(
          async () => {
            directory =
              await mkdtemp(
                join(
                  tmpdir(),
                  "busybookie-google-genai-policy-",
                ),
              );
          },
        );

        afterAll(
          async () => {
            await rm(
              directory,
              {
                recursive: true,
                force: true,
              },
            );
          },
        );

        it(
          "rejects a missing policy file with path context",
          async () => {
            const missing =
              join(
                directory,
                "missing.json",
              );

            await expect(
              loadGoogleGenAiPolicy(
                missing,
              ),
            ).rejects.toThrow(
              /Google GenAI policy could not be read: .*missing\.json/,
            );
          },
        );

        it(
          "rejects malformed and empty JSON with path context",
          async () => {
            for (
              const [
                name,
                content,
              ] of [
                [
                  "malformed.json",
                  "{ \"schemaVersion\": \"1.0\", ",
                ],
                [
                  "empty.json",
                  "",
                ],
              ]
            ) {
              const filePath =
                join(
                  directory,
                  name as string,
                );

              await writeFile(
                filePath,
                content as string,
                "utf8",
              );

              await expect(
                loadGoogleGenAiPolicy(
                  filePath,
                ),
              ).rejects.toThrow(
                /Google GenAI policy contains invalid JSON/,
              );
            }
          },
        );

        it(
          "rejects schema-invalid JSON values with path context",
          async () => {
            const tracked =
              await loadTrackedPolicyJson();

            for (
              const [
                name,
                value,
              ] of [
                [
                  "null.json",
                  null,
                ],
                [
                  "array.json",
                  [],
                ],
                [
                  "empty-object.json",
                  {},
                ],
                [
                  "veo-alias.json",
                  withPath(
                    tracked,
                    [
                      "provider",
                    ],
                    "VEO",
                  ),
                ],
              ] as const
            ) {
              const filePath =
                join(
                  directory,
                  name,
                );

              await writeFile(
                filePath,
                JSON.stringify(
                  value,
                ),
                "utf8",
              );

              await expect(
                loadGoogleGenAiPolicy(
                  filePath,
                ),
              ).rejects.toThrow(
                /Google GenAI policy validation failed: .*\.json/,
              );
            }
          },
        );

        it(
          "loads an explicitly supplied valid copy deterministically",
          async () => {
            const filePath =
              join(
                directory,
                "valid.json",
              );

            await writeFile(
              filePath,
              await readFile(
                DEFAULT_GOOGLE_GENAI_POLICY_PATH,
                "utf8",
              ),
              "utf8",
            );

            const first =
              await loadGoogleGenAiPolicy(
                filePath,
              );

            const second =
              await loadGoogleGenAiPolicy(
                filePath,
              );

            expect(first).toEqual(
              await loadGoogleGenAiPolicy(),
            );

            expect(second).toEqual(first);
          },
        );
      },
    );

    it(
      "performs no network work while loading",
      async () => {
        const fetchSpy =
          vi.spyOn(
            globalThis,
            "fetch",
          );

        try {
          await loadGoogleGenAiPolicy();

          expect(
            fetchSpy,
          ).not.toHaveBeenCalled();
        } finally {
          fetchSpy.mockRestore();
        }
      },
    );
  },
);
