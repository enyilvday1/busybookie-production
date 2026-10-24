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
  "src/execution/providers/submitGoogleGenAiSingleShot.ts",
] as const;

const APPROVED_CONSUMER_FOUNDATION_IMPORTS = [
  "../googleGenai/googleGenAi.types.js",
  "../schemas/googleGenAiPolicy.schema.js",
] as const;

const GOOGLE_SUBMISSION_ADAPTER =
  "src/execution/providers/submitGoogleGenAiSingleShot.ts";

const GOOGLE_SUBMISSION_ADAPTER_FOUNDATION_IMPORTS = [
  "../../googleGenai/googleGenAi.types.js",
  "../../schemas/googleGenAiPolicy.schema.js",
] as const;

const GOOGLE_SUBMISSION_ADAPTER_IMPORTS = [
  "../../googleGenai/googleGenAi.types.js",
  "../../schemas/googleGenAiPolicy.schema.js",
  "../executionReservation.schema.js",
  "../executionSubmission.schema.js",
  "./referenceImagePath.js",
  "node:fs/promises",
  "node:path",
] as const;

const GOOGLE_PRODUCTION_INTERACTION_CREATOR =
  "src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.ts";

const GOOGLE_PRODUCTION_INTERACTION_CREATOR_IMPORTS = [
  "./submitGoogleGenAiSingleShot.js",
  "@google/genai",
] as const;

const APPROVED_EXECUTION_GOOGLE_REFERENCES = [
  "src/execution/createExecutionSubmission.ts",
  "src/execution/executionReservation.schema.ts",
  "src/execution/executionSubmission.schema.ts",
  "src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.ts",
  "src/execution/providers/submitGoogleGenAiSingleShot.ts",
] as const;

const APPROVED_RUNTIME_GOOGLE_SDK_IMPORTERS = [
  "src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.ts",
  "src/veo/createVeoClient.ts",
  "src/veo/execution/resumeVeoOperation.ts",
] as const;

const RUNTIME_GOOGLE_SDK_IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s*["']@google\/genai["']|import\(\s*["']@google\/genai["']\s*\)|require\(\s*["']@google\/genai["']\s*\)/;

const DURABLE_SUBMISSION_WRITER =
  "src/execution/createExecutionSubmission.ts";

const DURABLE_SUBMISSION_WRITER_IMPORTS = [
  "./executionSubmission.schema.js",
  "./executionSubmissionPath.js",
  "./readExecutionReservation.js",
  "node:crypto",
  "node:fs",
  "node:fs/promises",
  "node:path",
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

        expect(
          [
            ...new Set(
              consumerImports.get(
                GOOGLE_SUBMISSION_ADAPTER,
              ),
            ),
          ].sort(),
        ).toEqual([
          ...GOOGLE_SUBMISSION_ADAPTER_FOUNDATION_IMPORTS,
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
            ) ||
            RUNTIME_GOOGLE_SDK_IMPORT_PATTERN.test(
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

    it(
      "limits runtime @google/genai imports in src to the legacy Veo client paths and the dormant production binding",
      async () => {
        const runtimeImporters: string[] =
          [];

        for (
          const file of await listTypeScriptFiles(
            "src",
          )
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
            RUNTIME_GOOGLE_SDK_IMPORT_PATTERN.test(
              source,
            )
          ) {
            runtimeImporters.push(
              file,
            );
          }
        }

        expect(
          runtimeImporters.sort(),
        ).toEqual([
          ...APPROVED_RUNTIME_GOOGLE_SDK_IMPORTERS,
        ]);
      },
    );

    it(
      "keeps the dormant production interaction creator on its exact minimal import set",
      async () => {
        const source =
          await readFile(
            join(
              ROOT,
              GOOGLE_PRODUCTION_INTERACTION_CREATOR,
            ),
            "utf8",
          );

        expect(
          [
            ...new Set(
              importSpecifiers(
                source,
              ),
            ),
          ].sort(),
        ).toEqual([
          ...GOOGLE_PRODUCTION_INTERACTION_CREATOR_IMPORTS,
        ]);

        expect(
          source,
        ).not.toMatch(
          /loadGoogleGenAiPolicy|loadEnvironment|googleGenai\/|googleGenAiPolicy\.schema|createExecutionSubmission|createExecutionCompletion|reconcileExecutionLifecycle|evaluateShotProvider|assessPreReservationProviderOptimization|executeSingleShot|\/veo\/|\/runway\/|\bfetch\s*\(|node:https?|node:net|node:child_process|process\.env/,
        );
      },
    );

    it(
      "keeps the durable submission writer free of Google runtime, loader, network, and provider imports",
      async () => {
        const source =
          await readFile(
            join(
              ROOT,
              DURABLE_SUBMISSION_WRITER,
            ),
            "utf8",
          );

        expect(
          [
            ...new Set(
              importSpecifiers(
                source,
              ),
            ),
          ].sort(),
        ).toEqual([
          ...DURABLE_SUBMISSION_WRITER_IMPORTS,
        ]);

        expect(
          source,
        ).not.toMatch(
          /@google\/genai|loadGoogleGenAiPolicy|\bfetch\s*\(|node:https?|node:net|\/providers\/|\/veo\/|\/runway\//,
        );
      },
    );

    it(
      "keeps the dormant Google submission adapter on its exact minimal import set",
      async () => {
        const source =
          await readFile(
            join(
              ROOT,
              GOOGLE_SUBMISSION_ADAPTER,
            ),
            "utf8",
          );

        expect(
          [
            ...new Set(
              importSpecifiers(
                source,
              ),
            ),
          ].sort(),
        ).toEqual([
          ...GOOGLE_SUBMISSION_ADAPTER_IMPORTS,
        ]);

        expect(
          source,
        ).not.toMatch(
          /@google\/genai|loadGoogleGenAiPolicy|createExecutionSubmission|createExecutionCompletion|reconcileExecutionLifecycle|evaluateShotProvider|assessPreReservationProviderOptimization|\bfetch\s*\(|node:https?|node:net|node:child_process|process\.env/,
        );
      },
    );
  },
);
