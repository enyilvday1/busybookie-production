import {
  readFile,
} from "node:fs/promises";

import {
  join,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import * as contract from "../src/googleGenai/googleGenAiInteractionContract.js";

import {
  GOOGLE_GENAI_INTERACTION_LIFECYCLE_CLASSES,
  GOOGLE_GENAI_INTERACTION_STATUSES,
  classifyGoogleGenAiInteractionStatus,
  normalizeGoogleGenAiProviderExecutionId,
  type GoogleGenAiInteractionLifecycleClass,
  type GoogleGenAiInteractionStatus,
} from "../src/googleGenai/googleGenAiInteractionContract.js";

const PRODUCTION_SOURCE_PATH =
  join(
    process.cwd(),
    "src",
    "googleGenai",
    "googleGenAiInteractionContract.ts",
  );

const EXPECTED_MAPPING: Readonly<
  Record<
    GoogleGenAiInteractionStatus,
    GoogleGenAiInteractionLifecycleClass
  >
> = {
  queued:
    "PENDING",

  in_progress:
    "PENDING",

  completed:
    "SUCCESS",

  failed:
    "TERMINAL_FAILURE",

  cancelled:
    "TERMINAL_FAILURE",

  incomplete:
    "TERMINAL_FAILURE",

  budget_exceeded:
    "TERMINAL_FAILURE",

  requires_action:
    "ACTION_REQUIRED_UNSUPPORTED",
};

const NON_STRING_VALUES: ReadonlyArray<
  [
    string,
    unknown,
  ]
> = [
  [
    "null",
    null,
  ],
  [
    "undefined",
    undefined,
  ],
  [
    "0",
    0,
  ],
  [
    "123",
    123,
  ],
  [
    "NaN",
    Number.NaN,
  ],
  [
    "{}",
    {},
  ],
  [
    "[]",
    [],
  ],
  [
    "true",
    true,
  ],
  [
    "false",
    false,
  ],
];

describe(
  "Busybookie Google GenAI interaction identity contract",
  () => {
    it(
      "normalizes Interaction.id to providerExecutionId",
      () => {
        expect(
          normalizeGoogleGenAiProviderExecutionId({
            id:
              "interaction-123",
          }),
        ).toBe(
          "interaction-123",
        );
      },
    );

    it(
      "trims surrounding whitespace from Interaction.id",
      () => {
        expect(
          normalizeGoogleGenAiProviderExecutionId({
            id:
              "  interaction-123  ",
          }),
        ).toBe(
          "interaction-123",
        );

        expect(
          normalizeGoogleGenAiProviderExecutionId({
            id:
              "\tinteraction-123\n",
          }),
        ).toBe(
          "interaction-123",
        );
      },
    );

    it(
      "ignores unrelated SDK fields and returns only the normalized string",
      () => {
        const result =
          normalizeGoogleGenAiProviderExecutionId({
            id:
              "interaction-123",

            status:
              "queued",

            model:
              "gemini-omni-1.1-flash",
          });

        expect(
          typeof result,
        ).toBe("string");

        expect(result).toBe(
          "interaction-123",
        );
      },
    );

    it(
      "rejects empty and whitespace-only ids",
      () => {
        for (
          const id of [
            "",
            "   ",
            "\t\n",
          ]
        ) {
          expect(
            () =>
              normalizeGoogleGenAiProviderExecutionId({
                id,
              }),
            JSON.stringify(id),
          ).toThrow(
            /must not be empty/,
          );
        }
      },
    );

    it(
      "rejects missing and non-string ids",
      () => {
        expect(() =>
          normalizeGoogleGenAiProviderExecutionId(
            {},
          ),
        ).toThrow(
          /id must be a string; received undefined/,
        );

        for (
          const [
            label,
            id,
          ] of NON_STRING_VALUES
        ) {
          expect(
            () =>
              normalizeGoogleGenAiProviderExecutionId({
                id,
              }),
            label,
          ).toThrow(
            /id must be a string/,
          );
        }
      },
    );

    it(
      "rejects interaction values that are not objects",
      () => {
        for (
          const interaction of [
            null,
            undefined,
            "interaction-123",
            123,
            true,
            [],
            [
              "interaction-123",
            ],
          ]
        ) {
          expect(
            () =>
              normalizeGoogleGenAiProviderExecutionId(
                interaction,
              ),
            String(interaction),
          ).toThrow(
            /interaction must be an object/,
          );
        }
      },
    );

    it(
      "exposes no duplicate interactionId API or output field",
      async () => {
        expect(
          Object.keys(
            contract,
          ).filter(
            (name) =>
              /interactionId/i.test(
                name,
              ),
          ),
        ).toEqual([]);

        const source =
          await readFile(
            PRODUCTION_SOURCE_PATH,
            "utf8",
          );

        expect(source).not.toMatch(
          /interactionId|interaction_id/,
        );
      },
    );
  },
);

describe(
  "Busybookie Google GenAI interaction status contract",
  () => {
    it(
      "pins exactly the eight Interaction status literals of the installed SDK",
      () => {
        expect(
          [
            ...GOOGLE_GENAI_INTERACTION_STATUSES,
          ].sort(),
        ).toEqual([
          "budget_exceeded",
          "cancelled",
          "completed",
          "failed",
          "in_progress",
          "incomplete",
          "queued",
          "requires_action",
        ]);

        expect(
          Object.isFrozen(
            GOOGLE_GENAI_INTERACTION_STATUSES,
          ),
        ).toBe(true);

        expect(
          [
            ...GOOGLE_GENAI_INTERACTION_LIFECYCLE_CLASSES,
          ],
        ).toEqual([
          "PENDING",
          "SUCCESS",
          "TERMINAL_FAILURE",
          "ACTION_REQUIRED_UNSUPPORTED",
        ]);
      },
    );

    it(
      "matches the Interaction.status literals declared by the locally installed SDK",
      async () => {
        const packageJson =
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
          ) as {
            version: string;
          };

        const declarations =
          await readFile(
            join(
              process.cwd(),
              "node_modules",
              "@google",
              "genai",
              "dist",
              "node",
              "node.d.ts",
            ),
            "utf8",
          );

        // Any @google/genai upgrade must fail here and force review of
        // the pinned status literals and BusyBookie mapping.
        expect(
          packageJson.version,
        ).toBe("2.24.0");

        const lines =
          declarations.split(
            /\r?\n/,
          );

        // The public response type GoogleGenAIInteraction resolves via
        // interactions.Interaction -> Interaction$ -> Interaction.
        expect(
          declarations,
        ).toContain(
          "Omit<interactions.Interaction, \"steps\">",
        );

        expect(
          lines,
        ).toContain(
          "    export type Interaction = Interaction$;",
        );

        expect(
          lines,
        ).toContain(
          "declare type Interaction$ = Interaction;",
        );

        const interactionStarts =
          lines.flatMap(
            (
              line,
              index,
            ) =>
              line ===
              "declare type Interaction = {"
                ? [
                    index,
                  ]
                : [],
          );

        expect(
          interactionStarts,
          "exactly one Interaction declaration",
        ).toHaveLength(1);

        const start =
          interactionStarts[0] as number;

        const end =
          lines.findIndex(
            (
              line,
              index,
            ) =>
              index > start &&
              line === "};",
          );

        expect(
          end,
          "Interaction declaration must close",
        ).toBeGreaterThan(start);

        const interactionBody =
          lines.slice(
            start + 1,
            end,
          );

        expect(
          interactionBody.some(
            (line) =>
              /^(declare|export)\s/.test(
                line,
              ),
          ),
          "Interaction declaration must not span another top-level declaration",
        ).toBe(false);

        const statusFields =
          interactionBody.filter(
            (line) =>
              /^ {4}status\??:/.test(
                line,
              ),
          );

        expect(
          statusFields,
        ).toHaveLength(1);

        const statusField =
          /^ {4}status: (InteractionStatus_\d+);$/.exec(
            statusFields[0] as string,
          );

        expect(
          statusField,
          "Interaction.status must be a required InteractionStatus_* reference",
        ).not.toBeNull();

        const typeName =
          statusField?.[1] as string;

        const typePrefix =
          `declare type ${typeName} = `;

        const typeDeclarations =
          lines.filter(
            (line) =>
              line.startsWith(
                typePrefix,
              ),
          );

        expect(
          typeDeclarations,
          `exactly one ${typeName} declaration`,
        ).toHaveLength(1);

        const typeDeclaration =
          typeDeclarations[0] as string;

        expect(
          typeDeclaration.endsWith(
            ";",
          ),
        ).toBe(true);

        const members =
          typeDeclaration
            .slice(
              typePrefix.length,
              -1,
            )
            .split(
              " | ",
            );

        expect(
          members.at(-1),
          "SDK status type is expected to stay open-ended",
        ).toBe(
          "(string & {})",
        );

        const literalMembers =
          members.slice(
            0,
            -1,
          );

        expect(
          literalMembers.every(
            (member) =>
              /^"[a-z_]+"$/.test(
                member,
              ),
          ),
          literalMembers.join(" | "),
        ).toBe(true);

        expect(
          literalMembers
            .map(
              (member) =>
                member.slice(
                  1,
                  -1,
                ),
            )
            .sort(),
          "Interaction status literals changed; review the BusyBookie mapping",
        ).toEqual(
          [
            ...GOOGLE_GENAI_INTERACTION_STATUSES,
          ].sort(),
        );
      },
    );

    it(
      "classifies queued as PENDING",
      () => {
        expect(
          classifyGoogleGenAiInteractionStatus(
            "queued",
          ),
        ).toBe("PENDING");
      },
    );

    it(
      "classifies in_progress as PENDING",
      () => {
        expect(
          classifyGoogleGenAiInteractionStatus(
            "in_progress",
          ),
        ).toBe("PENDING");
      },
    );

    it(
      "classifies completed as SUCCESS",
      () => {
        expect(
          classifyGoogleGenAiInteractionStatus(
            "completed",
          ),
        ).toBe("SUCCESS");
      },
    );

    it(
      "classifies failed as TERMINAL_FAILURE",
      () => {
        expect(
          classifyGoogleGenAiInteractionStatus(
            "failed",
          ),
        ).toBe("TERMINAL_FAILURE");
      },
    );

    it(
      "classifies cancelled as TERMINAL_FAILURE",
      () => {
        expect(
          classifyGoogleGenAiInteractionStatus(
            "cancelled",
          ),
        ).toBe("TERMINAL_FAILURE");
      },
    );

    it(
      "classifies incomplete as TERMINAL_FAILURE",
      () => {
        expect(
          classifyGoogleGenAiInteractionStatus(
            "incomplete",
          ),
        ).toBe("TERMINAL_FAILURE");
      },
    );

    it(
      "classifies budget_exceeded as TERMINAL_FAILURE",
      () => {
        expect(
          classifyGoogleGenAiInteractionStatus(
            "budget_exceeded",
          ),
        ).toBe("TERMINAL_FAILURE");
      },
    );

    it(
      "classifies requires_action as ACTION_REQUIRED_UNSUPPORTED and as nothing else",
      () => {
        const result =
          classifyGoogleGenAiInteractionStatus(
            "requires_action",
          );

        expect(result).toBe(
          "ACTION_REQUIRED_UNSUPPORTED",
        );

        expect(result).not.toBe(
          "SUCCESS",
        );

        expect(result).not.toBe(
          "PENDING",
        );

        expect(result).not.toBe(
          "TERMINAL_FAILURE",
        );
      },
    );

    it(
      "classifies every pinned status exactly as the locked mapping",
      () => {
        expect(
          Object.fromEntries(
            GOOGLE_GENAI_INTERACTION_STATUSES.map(
              (status) => [
                status,
                classifyGoogleGenAiInteractionStatus(
                  status,
                ),
              ],
            ),
          ),
        ).toEqual(
          EXPECTED_MAPPING,
        );
      },
    );

    it(
      "allows SUCCESS only from completed",
      () => {
        expect(
          GOOGLE_GENAI_INTERACTION_STATUSES.filter(
            (status) =>
              classifyGoogleGenAiInteractionStatus(
                status,
              ) === "SUCCESS",
          ),
        ).toEqual([
          "completed",
        ]);
      },
    );

    it(
      "fails closed on empty, unknown, near-miss, and prototype-key strings",
      () => {
        for (
          const status of [
            "",
            " ",
            "future_status",
            "completed_v2",
            " completed",
            "completed ",
            "COMPLETED",
            "Completed",
            "succeeded",
            "success",
            "done",
            "toString",
            "constructor",
            "__proto__",
            "hasOwnProperty",
          ]
        ) {
          expect(
            () =>
              classifyGoogleGenAiInteractionStatus(
                status,
              ),
            JSON.stringify(status),
          ).toThrow(
            /status is not recognized/,
          );
        }
      },
    );

    it(
      "fails closed on non-string statuses",
      () => {
        for (
          const [
            label,
            status,
          ] of [
            ...NON_STRING_VALUES,
            [
              "String object",
              new String(
                "completed",
              ),
            ] as [
              string,
              unknown,
            ],
          ]
        ) {
          expect(
            () =>
              classifyGoogleGenAiInteractionStatus(
                status,
              ),
            label,
          ).toThrow(
            /status must be a string/,
          );
        }
      },
    );

    it(
      "is deterministic and returns only lifecycle class strings",
      () => {
        for (
          const status of GOOGLE_GENAI_INTERACTION_STATUSES
        ) {
          const first =
            classifyGoogleGenAiInteractionStatus(
              status,
            );

          expect(
            classifyGoogleGenAiInteractionStatus(
              status,
            ),
          ).toBe(first);

          expect(
            typeof first,
          ).toBe("string");

          expect(
            GOOGLE_GENAI_INTERACTION_LIFECYCLE_CLASSES,
          ).toContain(first);
        }
      },
    );
  },
);

describe(
  "Busybookie Google GenAI interaction contract boundary",
  () => {
    it(
      "has no imports of any kind",
      async () => {
        const source =
          await readFile(
            PRODUCTION_SOURCE_PATH,
            "utf8",
          );

        expect(source).not.toMatch(
          /^\s*import\b|\bimport\s*\(|\brequire\s*\(|^\s*export\s[^;]*\bfrom\s/m,
        );
      },
    );

    it(
      "contains no client, network, lifecycle-execution, or routing references",
      async () => {
        const source =
          await readFile(
            PRODUCTION_SOURCE_PATH,
            "utf8",
          );

        for (
          const forbidden of [
            "GoogleGenAI",
            "interactions.create",
            "interactions.get",
            "generateVideos",
            "getVideosOperation",
            "fetch(",
            "executeSingleShot",
            "createExecutionReservation",
            "createExecutionSubmission",
            "createExecutionCompletion",
            "reconcileExecutionLifecycle",
            "evaluateShotProvider",
            "assessPreReservationProviderOptimization",
            "XMLHttpRequest",
            "WebSocket",
            "node:http",
            "node:https",
            "node:net",
            "node:child_process",
            "process.env",
          ]
        ) {
          expect(
            source.includes(
              forbidden,
            ),
            forbidden,
          ).toBe(false);
        }
      },
    );

    it(
      "contains no fallback, retry, resubmission, or provider-switch behaviour",
      async () => {
        const source =
          await readFile(
            PRODUCTION_SOURCE_PATH,
            "utf8",
          );

        expect(source).not.toMatch(
          /runway|\bveo\b|fallback|retry|resubmi|submit|switch|provider[A-Z_]*select|\bscore\b|\brank/i,
        );
      },
    );

    it(
      "exports only the identity and status contract surface",
      () => {
        expect(
          Object.keys(
            contract,
          ).sort(),
        ).toEqual([
          "GOOGLE_GENAI_INTERACTION_LIFECYCLE_CLASSES",
          "GOOGLE_GENAI_INTERACTION_STATUSES",
          "classifyGoogleGenAiInteractionStatus",
          "normalizeGoogleGenAiProviderExecutionId",
        ]);
      },
    );
  },
);
