import {
  readdir,
  readFile,
} from "node:fs/promises";

import {
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

const ROOT =
  process.cwd();

const FOUNDATION_FILES = [
  "src/googleGenai/googleGenAi.types.ts",
  "src/googleGenai/googleGenAiPricing.ts",
  "src/schemas/googleGenAiPolicy.schema.ts",
  "src/validation/loadGoogleGenAiPolicy.ts",
] as const;

const ALLOWED_EXTERNAL_IMPORTS =
  new Set([
    "node:fs/promises",
    "node:path",
    "zod",
  ]);

const FOUNDATION_MODULE_PATTERN =
  /googleGenai\/|googleGenAiPolicy\.schema|loadGoogleGenAiPolicy/;

const APPROVED_FOUNDATION_CONSUMERS = [
  "src/execution/executionSubmission.schema.ts",
] as const;

const APPROVED_CONSUMER_FOUNDATION_IMPORTS = [
  "../googleGenai/googleGenAi.types.js",
  "../schemas/googleGenAiPolicy.schema.js",
] as const;

const APPROVED_EXECUTION_GOOGLE_REFERENCES = [
  "src/execution/executionReservation.schema.ts",
  "src/execution/executionSubmission.schema.ts",
] as const;

const GOOGLE_REFERENCE_PATTERN =
  /GOOGLE_GENAI|gemini-omni/;

function toPosix(
  path:
    string,
): string {
  return path
    .split(sep)
    .join("/");
}

function importSpecifiers(
  source:
    string,
): string[] {
  const pattern =
    /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

  return [
    ...source.matchAll(
      pattern,
    ),
  ].map(
    (match) =>
      match[1] ??
      match[2] ??
      match[3] ??
      "",
  );
}

async function listTypeScriptFiles(
  directory:
    string,
): Promise<string[]> {
  const entries =
    await readdir(
      join(
        ROOT,
        directory,
      ),
      {
        recursive: true,
        withFileTypes: true,
      },
    );

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(
          ".ts",
        ),
    )
    .map(
      (entry) =>
        toPosix(
          relative(
            ROOT,
            join(
              entry.parentPath,
              entry.name,
            ),
          ),
        ),
    );
}

describe(
  "Busybookie Google GenAI foundation boundary",
  () => {
    it(
      "contains exactly the expected foundation source files under src/googleGenai",
      async () => {
        expect(
          (
            await listTypeScriptFiles(
              "src/googleGenai",
            )
          ).sort(),
        ).toEqual([
          "src/googleGenai/googleGenAi.types.ts",
          "src/googleGenai/googleGenAiInteractionContract.ts",
          "src/googleGenai/googleGenAiPricing.ts",
        ]);
      },
    );

    it(
      "imports no SDK, network, process, or legacy Veo module from foundation files",
      async () => {
        for (
          const file of FOUNDATION_FILES
        ) {
          const source =
            await readFile(
              join(
                ROOT,
                file,
              ),
              "utf8",
            );

          for (
            const specifier of importSpecifiers(
              source,
            )
          ) {
            if (
              specifier.startsWith(
                ".",
              )
            ) {
              const target =
                toPosix(
                  relative(
                    ROOT,
                    resolve(
                      ROOT,
                      dirname(
                        file,
                      ),
                      specifier.replace(
                        /\.js$/,
                        ".ts",
                      ),
                    ),
                  ),
                );

              expect(
                (
                  FOUNDATION_FILES as readonly string[]
                ).includes(
                  target,
                ),
                `${file} imports ${specifier}`,
              ).toBe(true);

              continue;
            }

            expect(
              ALLOWED_EXTERNAL_IMPORTS.has(
                specifier,
              ),
              `${file} imports ${specifier}`,
            ).toBe(true);
          }

          expect(
            source,
            file,
          ).not.toMatch(
            /@google\/genai|\bfetch\s*\(|node:https?|node:net|node:child_process|\/veo\//,
          );
        }
      },
    );

    it(
      "allows exactly one approved foundation consumer in src or scripts",
      async () => {
        const candidates = [
          ...(
            await listTypeScriptFiles(
              "src",
            )
          ),
          ...(
            await listTypeScriptFiles(
              "scripts",
            )
          ),
        ].filter(
          (file) =>
            !(
              FOUNDATION_FILES as readonly string[]
            ).includes(
              file,
            ),
        );

        const consumers: string[] =
          [];

        const consumerImports =
          new Map<string, string[]>();

        for (
          const file of candidates
        ) {
          const source =
            await readFile(
              join(
                ROOT,
                file,
              ),
              "utf8",
            );

          const foundationImports =
            importSpecifiers(
              source,
            ).filter(
              (specifier) =>
                FOUNDATION_MODULE_PATTERN.test(
                  specifier,
                ),
            );

          if (
            foundationImports.length >
            0
          ) {
            consumers.push(
              file,
            );

            consumerImports.set(
              file,
              foundationImports,
            );
          }
        }

        expect(
          consumers.sort(),
        ).toEqual([
          ...APPROVED_FOUNDATION_CONSUMERS,
        ]);

        expect(
          [
            ...new Set(
              consumerImports.get(
                APPROVED_FOUNDATION_CONSUMERS[0],
              ),
            ),
          ].sort(),
        ).toEqual([
          ...APPROVED_CONSUMER_FOUNDATION_IMPORTS,
        ]);
      },
    );

    it(
      "leaves routing and legacy Veo code without any GOOGLE_GENAI reference",
      async () => {
        const files = [
          ...(
            await listTypeScriptFiles(
              "src/routing",
            )
          ),
          ...(
            await listTypeScriptFiles(
              "src/veo",
            )
          ),
        ];

        expect(
          files.length,
        ).toBeGreaterThan(0);

        const references: string[] =
          [];

        for (
          const file of files
        ) {
          const source =
            await readFile(
              join(
                ROOT,
                file,
              ),
              "utf8",
            );

          if (
            GOOGLE_REFERENCE_PATTERN.test(
              source,
            )
          ) {
            references.push(
              file,
            );
          }
        }

        expect(
          references,
        ).toEqual([]);
      },
    );

    it(
      "limits execution GOOGLE_GENAI references to the exact durable schema files",
      async () => {
        const files =
          await listTypeScriptFiles(
            "src/execution",
          );

        expect(
          files.length,
        ).toBeGreaterThan(0);

        const references: string[] =
          [];

        for (
          const file of files
        ) {
          const source =
            await readFile(
              join(
                ROOT,
                file,
              ),
              "utf8",
            );

          if (
            GOOGLE_REFERENCE_PATTERN.test(
              source,
            )
          ) {
            references.push(
              file,
            );
          }
        }

        expect(
          references.sort(),
        ).toEqual([
          ...APPROVED_EXECUTION_GOOGLE_REFERENCES,
        ]);
      },
    );
  },
);
