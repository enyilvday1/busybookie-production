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

import {
  parseAst,
} from "rolldown/parseAst";

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
  "src/execution/cli/runGoogleGenAiOperatorCli.ts",
  "src/execution/executeGoogleGenAiOperatorSingleShot.ts",
  "src/execution/executionSubmission.schema.ts",
  "src/execution/googleGenAiExecutionCompletion.schema.ts",
  "src/execution/inspectGoogleGenAiExecutionLifecycle.ts",
  "src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.ts",
  "src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.ts",
  "src/execution/providers/materializeGoogleGenAiSingleShotOutput.ts",
  "src/execution/providers/persistGoogleGenAiSingleShotCompletion.ts",
  "src/execution/providers/recoverGoogleGenAiSingleShot.ts",
  "src/execution/providers/submitGoogleGenAiSingleShot.ts",
  "src/execution/reconcileGoogleGenAiExecutionLifecycle.ts",
  "src/execution/verifyGoogleGenAiDurableCompletion.ts",
  "src/schemas/googleGenAiActivationPolicy.schema.ts",
] as const;

// B4X operator-only runner: the two new runtime consumers of foundation modules.
const GOOGLE_OPERATOR_ORCHESTRATOR =
  "src/execution/executeGoogleGenAiOperatorSingleShot.ts";

const GOOGLE_OPERATOR_ORCHESTRATOR_FOUNDATION_IMPORTS = [
  "../googleGenai/assets/readGoogleGenAiReferenceImage.js",
  "../googleGenai/googleGenAi.types.js",
  "../googleGenai/googleGenAiExpectedCost.js",
  "../schemas/googleGenAiPolicy.schema.js",
] as const;

const GOOGLE_OPERATOR_CLI =
  "src/execution/cli/runGoogleGenAiOperatorCli.ts";

const GOOGLE_OPERATOR_CLI_FOUNDATION_IMPORTS = [
  "../../googleGenai/transport/googleGenAiSecureOutputTransportError.js",
  "../../validation/loadGoogleGenAiPolicy.js",
] as const;

const GOOGLE_ACTIVATION_POLICY_SCHEMA =
  "src/schemas/googleGenAiActivationPolicy.schema.ts";

const GOOGLE_ACTIVATION_POLICY_SCHEMA_FOUNDATION_IMPORTS = [
  "../googleGenai/googleGenAi.types.js",
  "../googleGenai/googleGenAiActivationLimits.js",
] as const;

const GOOGLE_RECONCILIATION_SOURCES = {
  "src/execution/inspectGoogleGenAiExecutionLifecycle.ts": [
    "../googleGenai/googleGenAi.types.js",
    "./executionCompletionPath.js",
    "./executionReservation.schema.js",
    "./executionSubmission.schema.js",
    "./googleGenAiExecutionCompletion.schema.js",
    "./readExecutionReservation.js",
    "./readExecutionSubmission.js",
    "./readGoogleGenAiExecutionCompletion.js",
  ],
  "src/execution/verifyGoogleGenAiDurableCompletion.ts": [
    "../googleGenai/audit/googleGenAiGenerationRecord.schema.js",
    "../googleGenai/audit/googleGenAiGenerationRecordPath.js",
    "../googleGenai/audit/readGoogleGenAiGenerationRecord.js",
    "../googleGenai/googleGenAi.types.js",
    "../googleGenai/output/googleGenAiVideoOutputPath.js",
    "./googleGenAiExecutionCompletion.schema.js",
    "./inspectGoogleGenAiExecutionLifecycle.js",
    "node:crypto",
    "node:fs/promises",
    "node:path",
  ],
  "src/execution/reconcileGoogleGenAiExecutionLifecycle.ts": [
    "../googleGenai/audit/googleGenAiGenerationRecord.schema.js",
    "../googleGenai/googleGenAi.types.js",
    "../googleGenai/transport/googleGenAiSecureOutputTransport.types.js",
    "../googleGenai/transport/googleGenAiSecureOutputTransportError.js",
    "./googleGenAiExecutionCompletion.schema.js",
    "./inspectGoogleGenAiExecutionLifecycle.js",
    "./providers/materializeGoogleGenAiSingleShotOutput.js",
    "./providers/persistGoogleGenAiSingleShotCompletion.js",
    "./providers/recoverGoogleGenAiSingleShot.js",
    "./verifyGoogleGenAiDurableCompletion.js",
  ],
} as const;

const GOOGLE_RECONCILIATION_FOUNDATION_IMPORTS = {
  "src/execution/inspectGoogleGenAiExecutionLifecycle.ts": [
    "../googleGenai/googleGenAi.types.js",
  ],
  "src/execution/verifyGoogleGenAiDurableCompletion.ts": [
    "../googleGenai/audit/googleGenAiGenerationRecord.schema.js",
    "../googleGenai/audit/googleGenAiGenerationRecordPath.js",
    "../googleGenai/audit/readGoogleGenAiGenerationRecord.js",
    "../googleGenai/googleGenAi.types.js",
    "../googleGenai/output/googleGenAiVideoOutputPath.js",
  ],
  "src/execution/reconcileGoogleGenAiExecutionLifecycle.ts": [
    "../googleGenai/audit/googleGenAiGenerationRecord.schema.js",
    "../googleGenai/googleGenAi.types.js",
    "../googleGenai/transport/googleGenAiSecureOutputTransport.types.js",
    "../googleGenai/transport/googleGenAiSecureOutputTransportError.js",
  ],
} as const;

const GOOGLE_RECONCILIATION_MODULE_PATTERN =
  /inspectGoogleGenAiExecutionLifecycle|verifyGoogleGenAiDurableCompletion|reconcileGoogleGenAiExecutionLifecycle/;

const GOOGLE_RECONCILIATION_IMPORTERS = [
  "src/execution/cli/runGoogleGenAiOperatorCli.ts",
  "src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.ts",
  "src/execution/reconcileGoogleGenAiExecutionLifecycle.ts",
  "src/execution/verifyGoogleGenAiDurableCompletion.ts",
] as const;

const GOOGLE_RECONCILIATION_FORBIDDEN_PATTERN =
  /@google\/genai|new GoogleGenAI|process\.env|loadEnvironment|\bfetch\s*\(|node:https?|node:net|node:child_process|interactions\.|\.create\(|\bfiles\.|submitGoogleGenAiSingleShot|createGoogleGenAiSingleShotProduction|\breadExecutionCompletion\b|\binspectExecutionLifecycle\b|\bclassifyExecutionLifecycle\b|\breconcileExecutionLifecycle\b|\bcreateExecutionCompletion\b|\brecoverExecutionCompletion\b|executionCompletion\.schema|executeSingleShot|evaluateShotProvider|assessPreReservationProviderOptimization|verifyCompletedShotForComposition|buildEpisodeCompositionPlan|resolveDurableShotVisualGenerationState|createProductionExecutionReconcileDependencies|runExecutionReconcileCli|\brename\s*\(|\bcopyFile\s*\(|\/runway\/|\/veo\/|\/routing\/|\/composition\/|\/cli\//;

const GOOGLE_READ_ONLY_RECONCILIATION_SOURCES = [
  "src/execution/inspectGoogleGenAiExecutionLifecycle.ts",
  "src/execution/verifyGoogleGenAiDurableCompletion.ts",
] as const;

const READ_ONLY_FORBIDDEN_WRITE_PATTERN =
  /\bwriteFile\b|\blink\s*\(|\bunlink\b|\bmkdir\b|\brename\b|\bcopyFile\b|\bappendFile\b|\btruncate\b|["'](?:w|wx|a|a\+|r\+|w\+)["']/;

const GOOGLE_COMPLETION_PERSISTENCE_SOURCES = {
  "src/googleGenai/audit/googleGenAiGenerationRecord.schema.ts": [
    "../../execution/executionReservation.schema.js",
    "../googleGenAi.types.js",
    "node:path",
    "zod",
  ],
  "src/googleGenai/audit/googleGenAiGenerationRecordPath.ts": [
    "../../execution/executionReservation.schema.js",
    "../output/googleGenAiVideoOutputPath.js",
    "node:path",
  ],
  "src/googleGenai/audit/readGoogleGenAiGenerationRecord.ts": [
    "./googleGenAiGenerationRecord.schema.js",
    "./googleGenAiGenerationRecordPath.js",
    "node:fs/promises",
  ],
  "src/execution/googleGenAiExecutionCompletion.schema.ts": [
    "../googleGenai/googleGenAi.types.js",
    "./executionReservation.schema.js",
    "zod",
  ],
  "src/execution/readGoogleGenAiExecutionCompletion.ts": [
    "./executionCompletionPath.js",
    "./googleGenAiExecutionCompletion.schema.js",
    "node:fs/promises",
  ],
  "src/execution/providers/persistGoogleGenAiSingleShotCompletion.ts": [
    "../../filesystem/hardLink.js",
    "../../googleGenai/audit/googleGenAiGenerationRecord.schema.js",
    "../../googleGenai/audit/googleGenAiGenerationRecordPath.js",
    "../../googleGenai/audit/readGoogleGenAiGenerationRecord.js",
    "../../googleGenai/googleGenAi.types.js",
    "../../googleGenai/output/googleGenAiVideoOutputPath.js",
    "../executionCompletionPath.js",
    "../googleGenAiExecutionCompletion.schema.js",
    "../readExecutionReservation.js",
    "../readExecutionSubmission.js",
    "../readGoogleGenAiExecutionCompletion.js",
    "./materializeGoogleGenAiSingleShotOutput.js",
    "node:crypto",
    "node:fs/promises",
    "node:path",
    "node:util",
  ],
} as const;

const GOOGLE_COMPLETION_SCHEMA_FOUNDATION_IMPORTS = [
  "../googleGenai/googleGenAi.types.js",
] as const;

const GOOGLE_COMPLETION_PERSISTENCE_ADAPTER =
  "src/execution/providers/persistGoogleGenAiSingleShotCompletion.ts";

const GOOGLE_COMPLETION_PERSISTENCE_ADAPTER_FOUNDATION_IMPORTS = [
  "../../googleGenai/audit/googleGenAiGenerationRecord.schema.js",
  "../../googleGenai/audit/googleGenAiGenerationRecordPath.js",
  "../../googleGenai/audit/readGoogleGenAiGenerationRecord.js",
  "../../googleGenai/googleGenAi.types.js",
  "../../googleGenai/output/googleGenAiVideoOutputPath.js",
] as const;

const GOOGLE_COMPLETION_PERSISTENCE_MODULE_PATTERN =
  /googleGenAiGenerationRecord|googleGenAiExecutionCompletion|readGoogleGenAiGenerationRecord|readGoogleGenAiExecutionCompletion|persistGoogleGenAiSingleShotCompletion/;

const GOOGLE_COMPLETION_PERSISTENCE_IMPORTERS = [
  "src/execution/inspectGoogleGenAiExecutionLifecycle.ts",
  "src/execution/providers/persistGoogleGenAiSingleShotCompletion.ts",
  "src/execution/readGoogleGenAiExecutionCompletion.ts",
  "src/execution/reconcileGoogleGenAiExecutionLifecycle.ts",
  "src/execution/verifyGoogleGenAiDurableCompletion.ts",
  "src/googleGenai/audit/readGoogleGenAiGenerationRecord.ts",
] as const;

const GOOGLE_COMPLETION_PERSISTENCE_FORBIDDEN_PATTERN =
  /@google\/genai|process\.env|\bfetch\s*\(|interactions\.|\bfiles\.|\brename\s*\(|\bcopyFile\s*\(|\bcreateExecutionCompletion\b|\brecoverExecutionCompletion\b|executionCompletion\.schema|\breadExecutionCompletion\b|reconcileExecutionLifecycle|inspectExecutionLifecycle|classifyExecutionLifecycle|executeSingleShot|evaluateShotProvider|assessPreReservationProviderOptimization|verifyCompletedShotForComposition|resolveDurableShotVisualGenerationState|writeRunwayGenerationRecord|writeVeoGenerationRecord|\/runway\/|\/veo\/|\/routing\//;

const GOOGLE_OUTPUT_PATH_MODULE =
  "src/googleGenai/output/googleGenAiVideoOutputPath.ts";

const GOOGLE_OUTPUT_PATH_MODULE_IMPORTS = [
  "node:crypto",
  "node:path",
] as const;

const GOOGLE_OUTPUT_MATERIALIZER =
  "src/execution/providers/materializeGoogleGenAiSingleShotOutput.ts";

const GOOGLE_OUTPUT_MATERIALIZER_FOUNDATION_IMPORTS = [
  "../../googleGenai/googleGenAi.types.js",
  "../../googleGenai/googleGenAiInteractionContract.js",
  "../../googleGenai/output/googleGenAiVideoOutputPath.js",
  "../../googleGenai/transport/googleGenAiSecureOutputTransport.types.js",
  "../../googleGenai/transport/googleGenAiSecureOutputTransportError.js",
] as const;

const GOOGLE_OUTPUT_MATERIALIZER_IMPORTS = [
  "../../filesystem/hardLink.js",
  "../../googleGenai/googleGenAi.types.js",
  "../../googleGenai/googleGenAiInteractionContract.js",
  "../../googleGenai/output/googleGenAiVideoOutputPath.js",
  "../../googleGenai/transport/googleGenAiSecureOutputTransport.types.js",
  "../../googleGenai/transport/googleGenAiSecureOutputTransportError.js",
  "../readExecutionSubmission.js",
  "node:crypto",
  "node:fs/promises",
  "node:path",
] as const;

const GOOGLE_PRODUCTION_OUTPUT_RETRIEVER =
  "src/execution/providers/createGoogleGenAiSingleShotProductionOutputRetriever.ts";

const GOOGLE_PRODUCTION_OUTPUT_RETRIEVER_IMPORTS = [
  "./materializeGoogleGenAiSingleShotOutput.js",
] as const;

const PROVIDER_OUTPUT_HELPER_PATTERN =
  /\/runway\/|\/veo\/|runwayOutputPath|veoOutputPath|downloadRunwayOutput|recoverRunwayOutput|persistVeoGeneratedVideo|recoverVeoOutput/;

const GOOGLE_RECOVERY_ADAPTER =
  "src/execution/providers/recoverGoogleGenAiSingleShot.ts";

const GOOGLE_RECOVERY_ADAPTER_FOUNDATION_IMPORTS = [
  "../../googleGenai/googleGenAi.types.js",
  "../../googleGenai/googleGenAiInteractionContract.js",
] as const;

const GOOGLE_RECOVERY_ADAPTER_IMPORTS = [
  "../../googleGenai/googleGenAi.types.js",
  "../../googleGenai/googleGenAiInteractionContract.js",
  "../readExecutionSubmission.js",
] as const;

const GOOGLE_PRODUCTION_INTERACTION_GETTER =
  "src/execution/providers/createGoogleGenAiSingleShotProductionInteractionGetter.ts";

const GOOGLE_PRODUCTION_INTERACTION_GETTER_IMPORTS = [
  "./recoverGoogleGenAiSingleShot.js",
] as const;

const GOOGLE_RECOVERY_RUNTIME_FORBIDDEN_PATTERN =
  /loadGoogleGenAiPolicy|loadEnvironment|createExecutionSubmission|createExecutionCompletion|reconcileExecutionLifecycle|evaluateShotProvider|assessPreReservationProviderOptimization|executeSingleShot|\/routing\/|\bfetch\s*\(|node:https?|node:net|node:child_process|process\.env/;

const APPROVED_CONSUMER_FOUNDATION_IMPORTS = [
  "../googleGenai/googleGenAi.types.js",
  "../schemas/googleGenAiPolicy.schema.js",
] as const;

const GOOGLE_SUBMISSION_ADAPTER =
  "src/execution/providers/submitGoogleGenAiSingleShot.ts";

const GOOGLE_SUBMISSION_ADAPTER_FOUNDATION_IMPORTS = [
  "../../googleGenai/assets/readGoogleGenAiReferenceImage.js",
  "../../googleGenai/googleGenAi.types.js",
  "../../googleGenai/googleGenAiActivationLimits.js",
  "../../googleGenai/googleGenAiExpectedCost.js",
  "../../schemas/googleGenAiPolicy.schema.js",
] as const;

const GOOGLE_SUBMISSION_ADAPTER_IMPORTS = [
  "../../googleGenai/assets/readGoogleGenAiReferenceImage.js",
  "../../googleGenai/googleGenAi.types.js",
  "../../googleGenai/googleGenAiActivationLimits.js",
  "../../googleGenai/googleGenAiExpectedCost.js",
  "../../schemas/googleGenAiActivationPolicy.schema.js",
  "../../schemas/googleGenAiPolicy.schema.js",
  "../executionReservation.schema.js",
  "../executionSubmission.schema.js",
  "./referenceImagePath.js",
  "node:path",
] as const;

const GOOGLE_ACTIVATION_AUTHORITY_SPECIFIER_PATTERN =
  /googleGenAiActivationPolicy\.schema|loadGoogleGenAiActivationPolicy|googleGenAiActivationLimits|googleGenAiExpectedCost|readGoogleGenAiReferenceImage/;

const GOOGLE_RECOVERY_SIDE_SOURCES = [
  "src/execution/googleGenAiExecutionCompletion.schema.ts",
  "src/execution/inspectGoogleGenAiExecutionLifecycle.ts",
  "src/execution/providers/createGoogleGenAiSingleShotProductionInteractionGetter.ts",
  "src/execution/providers/createGoogleGenAiSingleShotProductionOutputRetriever.ts",
  "src/execution/providers/materializeGoogleGenAiSingleShotOutput.ts",
  "src/execution/providers/persistGoogleGenAiSingleShotCompletion.ts",
  "src/execution/providers/recoverGoogleGenAiSingleShot.ts",
  "src/execution/readGoogleGenAiExecutionCompletion.ts",
  "src/execution/reconcileGoogleGenAiExecutionLifecycle.ts",
  "src/execution/verifyGoogleGenAiDurableCompletion.ts",
  "src/googleGenai/audit/googleGenAiGenerationRecord.schema.ts",
  "src/googleGenai/audit/googleGenAiGenerationRecordPath.ts",
  "src/googleGenai/audit/readGoogleGenAiGenerationRecord.ts",
  "src/googleGenai/googleGenAiInteractionContract.ts",
  "src/googleGenai/output/googleGenAiVideoOutputPath.ts",
  "src/googleGenai/transport/googleGenAiSecureOutputTransport.types.ts",
  "src/googleGenai/transport/googleGenAiSecureOutputTransportError.ts",
  "src/googleGenai/transport/parseGoogleGenAiInteractionSse.ts",
  "src/googleGenai/transport/replayGoogleGenAiInteraction.ts",
  "src/googleGenai/transport/validateGoogleGenAiFilesDownloadUri.ts",
  "src/googleGenai/transport/getGoogleGenAiFilesMetadata.ts",
  "src/googleGenai/transport/downloadGoogleGenAiFile.ts",
  "src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.ts",
] as const;

// The secure production recovery factory is the single recovery-side module
// allowed one activation-authority import: the frozen limits constant.
const GOOGLE_RECOVERY_SIDE_AUTHORITY_IMPORT_EXCEPTIONS: Readonly<Record<string, readonly string[]>> = {
  "src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.ts": [
    "../../googleGenai/googleGenAiActivationLimits.js",
  ],
};

const GOOGLE_PRODUCTION_INTERACTION_CREATOR =
  "src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.ts";

const GOOGLE_PRODUCTION_INTERACTION_CREATOR_IMPORTS = [
  "../../googleGenai/googleGenAiActivationLimits.js",
  "./submitGoogleGenAiSingleShot.js",
  "@google/genai",
] as const;

const GOOGLE_PRODUCTION_INTERACTION_CREATOR_FOUNDATION_IMPORTS = [
  "../../googleGenai/googleGenAiActivationLimits.js",
] as const;

const APPROVED_EXECUTION_GOOGLE_REFERENCES = [
  "src/execution/cli/runGoogleGenAiOperatorCli.ts",
  "src/execution/createExecutionSubmission.ts",
  "src/execution/executeGoogleGenAiOperatorSingleShot.ts",
  "src/execution/executionReservation.schema.ts",
  "src/execution/executionSubmission.schema.ts",
  "src/execution/googleGenAiExecutionCompletion.schema.ts",
  "src/execution/inspectGoogleGenAiExecutionLifecycle.ts",
  "src/execution/providers/buildGoogleGenAiSingleShotPrompt.ts",
  "src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.ts",
  "src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.ts",
  "src/execution/providers/materializeGoogleGenAiSingleShotOutput.ts",
  "src/execution/providers/persistGoogleGenAiSingleShotCompletion.ts",
  "src/execution/providers/recoverGoogleGenAiSingleShot.ts",
  "src/execution/providers/submitGoogleGenAiSingleShot.ts",
  "src/execution/reconcileGoogleGenAiExecutionLifecycle.ts",
  "src/execution/verifyGoogleGenAiDurableCompletion.ts",
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
          "src/googleGenai/assets/readGoogleGenAiReferenceImage.ts",
          "src/googleGenai/audit/googleGenAiGenerationRecord.schema.ts",
          "src/googleGenai/audit/googleGenAiGenerationRecordPath.ts",
          "src/googleGenai/audit/readGoogleGenAiGenerationRecord.ts",
          "src/googleGenai/googleGenAi.types.ts",
          "src/googleGenai/googleGenAiActivationLimits.ts",
          "src/googleGenai/googleGenAiExpectedCost.ts",
          "src/googleGenai/googleGenAiInteractionContract.ts",
          "src/googleGenai/googleGenAiPricing.ts",
          "src/googleGenai/output/googleGenAiVideoOutputPath.ts",
          "src/googleGenai/transport/downloadGoogleGenAiFile.ts",
          "src/googleGenai/transport/getGoogleGenAiFilesMetadata.ts",
          "src/googleGenai/transport/googleGenAiSecureOutputTransport.types.ts",
          "src/googleGenai/transport/googleGenAiSecureOutputTransportError.ts",
          "src/googleGenai/transport/parseGoogleGenAiInteractionSse.ts",
          "src/googleGenai/transport/replayGoogleGenAiInteraction.ts",
          "src/googleGenai/transport/validateGoogleGenAiFilesDownloadUri.ts",
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
                "src/execution/executionSubmission.schema.ts",
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

        expect(
          [
            ...new Set(
              consumerImports.get(
                GOOGLE_ACTIVATION_POLICY_SCHEMA,
              ),
            ),
          ].sort(),
        ).toEqual([
          ...GOOGLE_ACTIVATION_POLICY_SCHEMA_FOUNDATION_IMPORTS,
        ]);

        expect(
          [
            ...new Set(
              consumerImports.get(
                GOOGLE_OPERATOR_ORCHESTRATOR,
              ),
            ),
          ].sort(),
        ).toEqual([
          ...GOOGLE_OPERATOR_ORCHESTRATOR_FOUNDATION_IMPORTS,
        ]);

        expect(
          [
            ...new Set(
              consumerImports.get(
                GOOGLE_OPERATOR_CLI,
              ),
            ),
          ].sort(),
        ).toEqual([
          ...GOOGLE_OPERATOR_CLI_FOUNDATION_IMPORTS,
        ]);

        expect(
          [
            ...new Set(
              consumerImports.get(
                GOOGLE_PRODUCTION_INTERACTION_CREATOR,
              ),
            ),
          ].sort(),
        ).toEqual([
          ...GOOGLE_PRODUCTION_INTERACTION_CREATOR_FOUNDATION_IMPORTS,
        ]);

        expect(
          [
            ...new Set(
              consumerImports.get(
                GOOGLE_RECOVERY_ADAPTER,
              ),
            ),
          ].sort(),
        ).toEqual([
          ...GOOGLE_RECOVERY_ADAPTER_FOUNDATION_IMPORTS,
        ]);

        expect(
          [
            ...new Set(
              consumerImports.get(
                GOOGLE_OUTPUT_MATERIALIZER,
              ),
            ),
          ].sort(),
        ).toEqual([
          ...GOOGLE_OUTPUT_MATERIALIZER_FOUNDATION_IMPORTS,
        ]);

        expect(
          [
            ...new Set(
              consumerImports.get(
                "src/execution/googleGenAiExecutionCompletion.schema.ts",
              ),
            ),
          ].sort(),
        ).toEqual([
          ...GOOGLE_COMPLETION_SCHEMA_FOUNDATION_IMPORTS,
        ]);

        expect(
          [
            ...new Set(
              consumerImports.get(
                GOOGLE_COMPLETION_PERSISTENCE_ADAPTER,
              ),
            ),
          ].sort(),
        ).toEqual(
          [
            ...GOOGLE_COMPLETION_PERSISTENCE_ADAPTER_FOUNDATION_IMPORTS,
          ].sort(),
        );

        for (
          const [
            file,
            expectedFoundationImports,
          ] of Object.entries(
            GOOGLE_RECONCILIATION_FOUNDATION_IMPORTS,
          )
        ) {
          expect(
            [
              ...new Set(
                consumerImports.get(
                  file,
                ),
              ),
            ].sort(),
            file,
          ).toEqual(
            [
              ...expectedFoundationImports,
            ].sort(),
          );
        }
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
          /loadGoogleGenAiPolicy|loadEnvironment|googleGenai\/(?!googleGenAiActivationLimits\.js["'])|googleGenAiPolicy\.schema|createExecutionSubmission|createExecutionCompletion|reconcileExecutionLifecycle|evaluateShotProvider|assessPreReservationProviderOptimization|executeSingleShot|\/veo\/|\/runway\/|\bfetch\s*\(|node:https?|node:net|node:child_process|process\.env/,
        );
      },
    );

    it(
      "keeps the production interaction creator's dependency on the submission adapter type-only",
      async () => {
        const source =
          await readFile(
            join(
              ROOT,
              GOOGLE_PRODUCTION_INTERACTION_CREATOR,
            ),
            "utf8",
          );

        const submitStatements =
          [
            ...source.matchAll(
              /(?:^|\n)\s*((?:import|export)\b[^;]*?from\s*["']\.\/submitGoogleGenAiSingleShot\.js["'])/g,
            ),
          ].map(
            (match) =>
              match[1] ?? "",
          );

        expect(
          submitStatements.length,
        ).toBeGreaterThan(
          0,
        );

        for (
          const statement of submitStatements
        ) {
          // Only a top-level `import type` is erased from emitted JavaScript;
          // a value import or an inline `{ type X }` specifier keeps a
          // runtime load of the submission orchestrator.
          expect(
            statement,
          ).toMatch(
            /^import\s+type\s*\{[^}]*\}\s*from\s*["']\.\/submitGoogleGenAiSingleShot\.js["']$/,
          );
        }

        expect(
          source,
        ).not.toMatch(
          /import\(\s*["']\.\/submitGoogleGenAiSingleShot\.js["']\s*\)|require\(\s*["']\.\/submitGoogleGenAiSingleShot\.js["']\s*\)/,
        );

        expect(
          source,
        ).toMatch(
          /import\s*\{\s*GOOGLE_GENAI_CREATE_TIMEOUT_MS,?\s*\}\s*from\s*["']\.\.\/\.\.\/googleGenai\/googleGenAiActivationLimits\.js["']/,
        );
      },
    );

    it(
      "keeps the dormant same-ID recovery adapter on its exact minimal import set with no SDK or create machinery",
      async () => {
        const source =
          await readFile(
            join(
              ROOT,
              GOOGLE_RECOVERY_ADAPTER,
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
          ...GOOGLE_RECOVERY_ADAPTER_IMPORTS,
        ]);

        expect(
          RUNTIME_GOOGLE_SDK_IMPORT_PATTERN.test(
            source,
          ),
        ).toBe(
          false,
        );

        expect(
          GOOGLE_RECOVERY_RUNTIME_FORBIDDEN_PATTERN.test(
            source,
          ),
        ).toBe(
          false,
        );

        expect(
          source,
        ).not.toMatch(
          /@google\/genai|createGoogleGenAiSingleShotProductionInteractionCreator|createGoogleGenAiSingleShotProductionInteractionGetter|submitGoogleGenAiSingleShot|createInteraction|\.create\(|\.cancel\(|\.delete\(|\/veo\/|\/runway\//,
        );
      },
    );

    it(
      "keeps the dormant production interaction getter on its exact minimal import set",
      async () => {
        const source =
          await readFile(
            join(
              ROOT,
              GOOGLE_PRODUCTION_INTERACTION_GETTER,
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
          ...GOOGLE_PRODUCTION_INTERACTION_GETTER_IMPORTS,
        ]);

        expect(
          GOOGLE_RECOVERY_RUNTIME_FORBIDDEN_PATTERN.test(
            source,
          ),
        ).toBe(
          false,
        );

        expect(
          source,
        ).not.toMatch(
          /googleGenai\/|googleGenAiPolicy\.schema|createGoogleGenAiSingleShotProductionInteractionCreator|submitGoogleGenAiSingleShot|\.create\(|\.cancel\(|\.delete\(|\/veo\/|\/runway\//,
        );
      },
    );

    it(
      "keeps the Google output path module on node:crypto and node:path only",
      async () => {
        const source =
          await readFile(
            join(
              ROOT,
              GOOGLE_OUTPUT_PATH_MODULE,
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
          ...GOOGLE_OUTPUT_PATH_MODULE_IMPORTS,
        ]);

        expect(
          PROVIDER_OUTPUT_HELPER_PATTERN.test(
            source,
          ),
        ).toBe(
          false,
        );

        expect(
          source,
        ).not.toMatch(
          /process\.env|@google\/genai|\bfetch\s*\(/,
        );
      },
    );

    it(
      "keeps the dormant output materializer on its exact import set with no SDK, fetch, rename publication, or lifecycle writers",
      async () => {
        const source =
          await readFile(
            join(
              ROOT,
              GOOGLE_OUTPUT_MATERIALIZER,
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
          ...GOOGLE_OUTPUT_MATERIALIZER_IMPORTS,
        ]);

        expect(
          RUNTIME_GOOGLE_SDK_IMPORT_PATTERN.test(
            source,
          ),
        ).toBe(
          false,
        );

        expect(
          GOOGLE_RECOVERY_RUNTIME_FORBIDDEN_PATTERN.test(
            source,
          ),
        ).toBe(
          false,
        );

        expect(
          PROVIDER_OUTPUT_HELPER_PATTERN.test(
            source,
          ),
        ).toBe(
          false,
        );

        expect(
          source,
        ).not.toMatch(
          /@google\/genai|\brename\s*\(|\bcopyFile\s*\(|createWriteStream|\.download\(|\bfiles\.|createInteraction|\.create\(|\.cancel\(|\.delete\(/,
        );

        expect(
          source,
        ).toMatch(
          /fileSystem\.link\(/,
        );
      },
    );

    it(
      "keeps the dormant production output retriever on its exact import set with no create, download, or fetch",
      async () => {
        const source =
          await readFile(
            join(
              ROOT,
              GOOGLE_PRODUCTION_OUTPUT_RETRIEVER,
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
          ...GOOGLE_PRODUCTION_OUTPUT_RETRIEVER_IMPORTS,
        ]);

        expect(
          GOOGLE_RECOVERY_RUNTIME_FORBIDDEN_PATTERN.test(
            source,
          ),
        ).toBe(
          false,
        );

        expect(
          PROVIDER_OUTPUT_HELPER_PATTERN.test(
            source,
          ),
        ).toBe(
          false,
        );

        expect(
          source,
        ).not.toMatch(
          /googleGenai\/|googleGenAiPolicy\.schema|createGoogleGenAiSingleShotProductionInteraction|submitGoogleGenAiSingleShot|recoverGoogleGenAiSingleShot|\.create\(|\.cancel\(|\.delete\(|\.download\(|\bfiles\.|\bfetch\s*\(/,
        );
      },
    );

    it(
      "keeps the dormant Google completion persistence sources on their exact import sets with no SDK, network, shared completion writer, lifecycle, routing, or rename/copy publication",
      async () => {
        for (
          const [
            file,
            expectedImports,
          ] of Object.entries(
            GOOGLE_COMPLETION_PERSISTENCE_SOURCES,
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

          expect(
            [
              ...new Set(
                importSpecifiers(
                  source,
                ),
              ),
            ].sort(),
            file,
          ).toEqual(
            [
              ...expectedImports,
            ].sort(),
          );

          expect(
            RUNTIME_GOOGLE_SDK_IMPORT_PATTERN.test(
              source,
            ),
            file,
          ).toBe(
            false,
          );

          expect(
            GOOGLE_COMPLETION_PERSISTENCE_FORBIDDEN_PATTERN.test(
              source,
            ),
            file,
          ).toBe(
            false,
          );
        }

        const adapterSource =
          await readFile(
            join(
              ROOT,
              GOOGLE_COMPLETION_PERSISTENCE_ADAPTER,
            ),
            "utf8",
          );

        expect(
          adapterSource,
        ).toMatch(
          /fileSystem\.link\(/,
        );

        expect(
          adapterSource,
        ).toMatch(
          /import type \{\s*GoogleGenAiSingleShotOutputMaterializationResult,?\s*\} from "\.\/materializeGoogleGenAiSingleShotOutput\.js";/,
        );
      },
    );

    it(
      "keeps the dormant Google completion persistence modules unconsumed by runtime code",
      async () => {
        const importers: string[] =
          [];

        for (
          const file of [
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
          ]
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
            importSpecifiers(
              source,
            ).some(
              (specifier) =>
                GOOGLE_COMPLETION_PERSISTENCE_MODULE_PATTERN.test(
                  specifier,
                ),
            )
          ) {
            importers.push(
              file,
            );
          }
        }

        expect(
          importers.sort(),
        ).toEqual([
          ...GOOGLE_COMPLETION_PERSISTENCE_IMPORTERS,
        ]);
      },
    );

    it(
      "keeps the dormant Google reconciliation modules on their exact import sets with no SDK, network, create, shared lifecycle, downstream, or Runway/Veo coupling",
      async () => {
        for (
          const [
            file,
            expectedImports,
          ] of Object.entries(
            GOOGLE_RECONCILIATION_SOURCES,
          )
        ) {
          const raw =
            await readFile(
              join(
                ROOT,
                file,
              ),
              "utf8",
            );

          const code =
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
            [
              ...new Set(
                importSpecifiers(
                  raw,
                ),
              ),
            ].sort(),
            file,
          ).toEqual(
            [
              ...expectedImports,
            ].sort(),
          );

          expect(
            RUNTIME_GOOGLE_SDK_IMPORT_PATTERN.test(
              raw,
            ),
            file,
          ).toBe(
            false,
          );

          expect(
            GOOGLE_RECONCILIATION_FORBIDDEN_PATTERN.test(
              code,
            ),
            file,
          ).toBe(
            false,
          );
        }
      },
    );

    it(
      "keeps the Google inspection and durable verification modules free of write APIs",
      async () => {
        for (
          const file of GOOGLE_READ_ONLY_RECONCILIATION_SOURCES
        ) {
          const code =
            (
              await readFile(
                join(
                  ROOT,
                  file,
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
            READ_ONLY_FORBIDDEN_WRITE_PATTERN.test(
              code,
            ),
            file,
          ).toBe(
            false,
          );
        }
      },
    );

    it(
      "keeps the dormant Google reconciliation modules unconsumed by shared, downstream, CLI, routing, or production code",
      async () => {
        const importers: string[] =
          [];

        for (
          const file of [
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
          ]
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
            importSpecifiers(
              source,
            ).some(
              (specifier) =>
                GOOGLE_RECONCILIATION_MODULE_PATTERN.test(
                  specifier,
                ),
            )
          ) {
            importers.push(
              file,
            );
          }
        }

        expect(
          importers.sort(),
        ).toEqual([
          ...GOOGLE_RECONCILIATION_IMPORTERS,
        ]);
      },
    );

    it(
      "keeps package and environment configuration free of Google GenAI runtime activation",
      async () => {
        const manifest:
          unknown =
          JSON.parse(
            await readFile(
              join(
                ROOT,
                "package.json",
              ),
              "utf8",
            ),
          );

        expect(
          manifest,
        ).toMatchObject({
          dependencies: {
            "@google/genai":
              "^2.24.0",
          },
        });

        for (
          const file of [
            "src/schemas/environment.schema.ts",
            "src/validation/loadEnvironment.ts",
          ]
        ) {
          const source =
            await readFile(
              join(
                ROOT,
                file,
              ),
              "utf8",
            );

          expect(
            source,
            file,
          ).not.toMatch(
            /GOOGLE_GENAI|gemini-omni|googleGenai|GoogleGenAi/,
          );
        }
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

    it(
      "keeps the activation policy and new-submission switch out of every Google recovery-side module",
      async () => {
        for (
          const file of GOOGLE_RECOVERY_SIDE_SOURCES
        ) {
          const source =
            await readFile(
              join(
                ROOT,
                file,
              ),
              "utf8",
            );

          expect(
            importSpecifiers(
              source,
            ).filter(
              (specifier) =>
                GOOGLE_ACTIVATION_AUTHORITY_SPECIFIER_PATTERN.test(
                  specifier,
                ),
            ),
            file,
          ).toEqual(
            [
              ...(GOOGLE_RECOVERY_SIDE_AUTHORITY_IMPORT_EXCEPTIONS[file] ?? []),
            ],
          );

          expect(
            source,
            file,
          ).not.toMatch(
            /newSubmissionsEnabled|ActivationPolicy|GoogleGenAiNewSubmissionsDisabledError/,
          );
        }

        const submissionSource =
          await readFile(
            join(
              ROOT,
              GOOGLE_SUBMISSION_ADAPTER,
            ),
            "utf8",
          );

        expect(
          submissionSource,
        ).toMatch(
          /\.admission\s*\.newSubmissionsEnabled/,
        );
      },
    );
  },
);

// ---------------------------------------------------------------------------
// B4X operator-only Google runner (B4X1 lock sections 20-23). B4X ends the B4V
// zero-consumer dormancy on purpose; these assertions replace it with the EXACT
// approved consumer graph rather than removing enforcement.

const B4X_OPERATOR_MODULES = {
  promptBuilder: "src/execution/providers/buildGoogleGenAiSingleShotPrompt.ts",
  orchestrator: "src/execution/executeGoogleGenAiOperatorSingleShot.ts",
  composition: "src/execution/createGoogleGenAiOperatorProductionDependencies.ts",
  cliArgs: "src/execution/cli/googleGenAiOperatorCliArgs.ts",
  cli: "src/execution/cli/runGoogleGenAiOperatorCli.ts",
  script: "scripts/google-genai-operator.ts",
} as const;

const B4X_GOVERNED_RUNTIME_CONSUMERS: Readonly<Record<string, readonly string[]>> = {
  "src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.ts": [B4X_OPERATOR_MODULES.composition],
  "src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.ts": [B4X_OPERATOR_MODULES.composition],
  "src/execution/providers/createGoogleGenAiSingleShotProductionInteractionGetter.ts": [],
  "src/execution/providers/createGoogleGenAiSingleShotProductionOutputRetriever.ts": [],
  "src/execution/providers/submitGoogleGenAiSingleShot.ts": [B4X_OPERATOR_MODULES.orchestrator],
  "src/execution/reconcileGoogleGenAiExecutionLifecycle.ts": [B4X_OPERATOR_MODULES.cli],
  "src/execution/inspectGoogleGenAiExecutionLifecycle.ts": [
    B4X_OPERATOR_MODULES.cli,
    "src/execution/reconcileGoogleGenAiExecutionLifecycle.ts",
    "src/execution/verifyGoogleGenAiDurableCompletion.ts",
  ],
  "src/validation/loadGoogleGenAiActivationPolicy.ts": [B4X_OPERATOR_MODULES.cli],
  "src/validation/loadGoogleGenAiPolicy.ts": [B4X_OPERATOR_MODULES.cli],
  "src/googleGenai/googleGenAiExpectedCost.ts": [B4X_OPERATOR_MODULES.orchestrator, "src/execution/providers/submitGoogleGenAiSingleShot.ts"],
  "src/googleGenai/assets/readGoogleGenAiReferenceImage.ts": [B4X_OPERATOR_MODULES.orchestrator, "src/execution/providers/submitGoogleGenAiSingleShot.ts"],
  [B4X_OPERATOR_MODULES.promptBuilder]: [B4X_OPERATOR_MODULES.orchestrator],
  [B4X_OPERATOR_MODULES.orchestrator]: [B4X_OPERATOR_MODULES.cli],
  [B4X_OPERATOR_MODULES.composition]: [B4X_OPERATOR_MODULES.cli],
  [B4X_OPERATOR_MODULES.cliArgs]: [B4X_OPERATOR_MODULES.cli],
  [B4X_OPERATOR_MODULES.cli]: [B4X_OPERATOR_MODULES.script],
};

// Exact import maps of the new modules: "specifier" for a runtime import, "type:specifier" for a type-only import.
const B4X_OPERATOR_IMPORTS: Readonly<Record<string, readonly string[]>> = {
  [B4X_OPERATOR_MODULES.promptBuilder]: ["type:../../schemas/episodeManifest.schema.js"],
  [B4X_OPERATOR_MODULES.orchestrator]: [
    "../googleGenai/assets/readGoogleGenAiReferenceImage.js",
    "../googleGenai/googleGenAi.types.js",
    "../googleGenai/googleGenAiExpectedCost.js",
    "../validation/validateEpisodeProduction.js",
    "./providers/buildGoogleGenAiSingleShotPrompt.js",
    "./providers/submitGoogleGenAiSingleShot.js",
    "node:path",
    "type:../schemas/character.schema.js",
    "type:../schemas/episodeManifest.schema.js",
    "type:../schemas/googleGenAiPolicy.schema.js",
    "type:../schemas/productionRules.schema.js",
    "type:../validation/loadGoogleGenAiActivationPolicy.js",
    "type:./createExecutionReservation.js",
    "type:./createExecutionSubmission.js",
    "type:./inspectExecutionLifecycle.js",
    "type:./singleShotExecution.types.js",
  ],
  [B4X_OPERATOR_MODULES.composition]: [
    "./providers/createGoogleGenAiSingleShotProductionInteractionCreator.js",
    "./providers/createGoogleGenAiSingleShotSecureProductionRecovery.js",
  ],
  [B4X_OPERATOR_MODULES.cliArgs]: ["../executionReservation.schema.js"],
  [B4X_OPERATOR_MODULES.cli]: [
    "../../googleGenai/transport/googleGenAiSecureOutputTransportError.js",
    "../../validation/loadCharacterBible.js",
    "../../validation/loadEnvironment.js",
    "../../validation/loadEpisodeManifest.js",
    "../../validation/loadGoogleGenAiActivationPolicy.js",
    "../../validation/loadGoogleGenAiPolicy.js",
    "../../validation/loadProductionRules.js",
    "../../validation/validateEpisodeProduction.js",
    "../../validation/validateMediaRoot.js",
    "../createExecutionReservation.js",
    "../createExecutionSubmission.js",
    "../createGoogleGenAiOperatorProductionDependencies.js",
    "../createProductionVisualReferenceVerifier.js",
    "../executeGoogleGenAiOperatorSingleShot.js",
    "../inspectExecutionLifecycle.js",
    "../inspectGoogleGenAiExecutionLifecycle.js",
    "../readExecutionReservation.js",
    "../reconcileGoogleGenAiExecutionLifecycle.js",
    "./googleGenAiOperatorCliArgs.js",
    "node:crypto",
  ],
  [B4X_OPERATOR_MODULES.script]: ["../src/execution/cli/runGoogleGenAiOperatorCli.js"],
};

const B4X_OPERATOR_FORBIDDEN_PATTERN =
  /process\.env|console\.|util\.inspect|node:util|@google\/genai|\bfetch\s*\(|loadProviderRoutingPolicy|evaluateShotProvider|executeSingleShot\.js|createProductionSingleShotExecutionDependencies|createProductionExecutionReconcileDependencies|reconcileExecutionLifecycle\.js|runSingleShotExecutionCli|runExecutionReconcileCli|\/routing\/|\/runway\/|\/veo\/|\/composition\/|ProductionInteractionGetter|ProductionOutputRetriever|buildVeoPrompt|buildRunwayGen45Prompt|process\.exit\(/;

type B4xModuleReference = Readonly<{ specifier: string; typeOnly: boolean }>;

/** Every static, re-export, dynamic-import, require and import-equals reference (parser-decoded specifiers). */
function b4xModuleReferences(source: string, file: string): B4xModuleReference[] {
  const references: B4xModuleReference[] = [];
  const literal = (node: unknown): string | undefined => {
    const value = node as { type?: unknown; value?: unknown; expressions?: unknown[]; quasis?: { value?: { cooked?: unknown } }[] } | null;
    if (!value || typeof value !== "object") return undefined;
    if (value.type === "Literal" && typeof value.value === "string") return value.value;
    const cooked = value.quasis?.[0]?.value?.cooked;
    if (value.type === "TemplateLiteral" && value.expressions?.length === 0 && value.quasis?.length === 1 && typeof cooked === "string") return cooked;
    return undefined;
  };
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const child of node) visit(child); return; }
    const value = node as Record<string, unknown>;
    const bindings = (Array.isArray(value.specifiers) ? value.specifiers : []) as Record<string, unknown>[];
    const specifier = literal(value.source);
    if (value.type === "ImportDeclaration" && specifier !== undefined) {
      references.push({ specifier, typeOnly: value.importKind === "type" || (bindings.length > 0 && bindings.every((binding) => binding.type === "ImportSpecifier" && binding.importKind === "type")) });
    } else if ((value.type === "ExportNamedDeclaration" || value.type === "ExportAllDeclaration") && specifier !== undefined) {
      references.push({ specifier, typeOnly: value.exportKind === "type" || (bindings.length > 0 && bindings.every((binding) => binding.exportKind === "type")) });
    } else if (value.type === "ImportExpression" && specifier !== undefined) {
      references.push({ specifier, typeOnly: false });
    } else if (value.type === "CallExpression" && (value.callee as Record<string, unknown> | undefined)?.name === "require") {
      const required = literal(Array.isArray(value.arguments) ? value.arguments[0] : undefined);
      if (required !== undefined) references.push({ specifier: required, typeOnly: false });
    } else if (value.type === "TSImportEqualsDeclaration") {
      const reference = value.moduleReference as Record<string, unknown> | undefined;
      const required = reference?.type === "TSExternalModuleReference" ? literal(reference.expression) : undefined;
      if (required !== undefined) references.push({ specifier: required, typeOnly: value.importKind === "type" });
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(parseAst(source, { lang: "ts" }, file));
  return references;
}

function b4xResolve(file: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  return toPosix(relative(ROOT, resolve(dirname(join(ROOT, file)), specifier.replace(/\.js$/, ".ts"))));
}

async function b4xScan(): Promise<Readonly<{ runtime: Map<string, string[]>; any: Map<string, string[]> }>> {
  const runtime = new Map<string, string[]>();
  const any = new Map<string, string[]>();
  for (const file of [...await listTypeScriptFiles("src"), ...await listTypeScriptFiles("scripts")]) {
    const source = await readFile(join(ROOT, file), "utf8");
    for (const reference of b4xModuleReferences(source, file)) {
      const target = b4xResolve(file, reference.specifier);
      if (target === undefined) continue;
      if (!any.get(target)?.includes(file)) any.set(target, [...any.get(target) ?? [], file]);
      if (!reference.typeOnly && !runtime.get(target)?.includes(file)) runtime.set(target, [...runtime.get(target) ?? [], file]);
    }
  }
  return { runtime, any };
}

describe(
  "B4X operator-only Google runner boundary",
  () => {
    it("enforces the exact post-B4X runtime consumer graph of every governed Google module", async () => {
      const { runtime } = await b4xScan();
      for (const [target, consumers] of Object.entries(B4X_GOVERNED_RUNTIME_CONSUMERS)) {
        expect([...runtime.get(target) ?? []].sort(), target).toEqual([...consumers].sort());
      }
    });

    it("lets no shared, routing, automation, composition or status module reach the operator runner in any module form", async () => {
      const { any } = await b4xScan();
      expect([...any.get(B4X_OPERATOR_MODULES.promptBuilder) ?? []].sort()).toEqual([B4X_OPERATOR_MODULES.orchestrator]);
      expect([...any.get(B4X_OPERATOR_MODULES.orchestrator) ?? []].sort()).toEqual([B4X_OPERATOR_MODULES.cli]);
      expect([...any.get(B4X_OPERATOR_MODULES.composition) ?? []].sort()).toEqual([B4X_OPERATOR_MODULES.cli]);
      expect([...any.get(B4X_OPERATOR_MODULES.cliArgs) ?? []].sort()).toEqual([B4X_OPERATOR_MODULES.cli]);
      expect([...any.get(B4X_OPERATOR_MODULES.cli) ?? []].sort()).toEqual([B4X_OPERATOR_MODULES.script]);
      for (const scriptsFile of await listTypeScriptFiles("scripts")) {
        if (scriptsFile === B4X_OPERATOR_MODULES.script) continue;
        const source = await readFile(join(ROOT, scriptsFile), "utf8");
        expect(source, scriptsFile).not.toMatch(/GoogleGenAi|googleGenai|GOOGLE_GENAI|google-genai-operator/);
      }
    });

    it("keeps every new operator module on its exact import map", async () => {
      for (const [file, imports] of Object.entries(B4X_OPERATOR_IMPORTS)) {
        const source = await readFile(join(ROOT, file), "utf8");
        const actual = b4xModuleReferences(source, file).map((reference) => (reference.typeOnly ? `type:${reference.specifier}` : reference.specifier));
        expect(actual.sort(), file).toEqual([...imports].sort());
      }
    });

    it("keeps the new operator modules free of environment, console, SDK, network, routing, shared-dispatch and legacy recovery authority", async () => {
      for (const file of Object.values(B4X_OPERATOR_MODULES)) {
        const source = await readFile(join(ROOT, file), "utf8");
        expect(source, file).not.toMatch(B4X_OPERATOR_FORBIDDEN_PATTERN);
        if (file !== B4X_OPERATOR_MODULES.cli) expect(source, file).not.toMatch(/loadEnvironment|loadGoogleGenAiActivationPolicy\(/);
      }
    });

    it("keeps the committed activation policy default-off and the shared routing configuration Google-free", async () => {
      const policy: unknown = JSON.parse(await readFile(join(ROOT, "config/google-genai-activation-policy.json"), "utf8"));
      expect(policy).toMatchObject({ admission: { newSubmissionsEnabled: false } });
      for (const file of ["config/production-rules.json", "config/provider-routing-policy.json", "src/schemas/productionRules.schema.ts", "src/schemas/providerRoutingPolicy.schema.ts", "src/execution/singleShotExecution.types.ts", "src/execution/executeSingleShot.ts"]) {
        expect(await readFile(join(ROOT, file), "utf8"), file).not.toMatch(/GOOGLE_GENAI|GoogleGenAi|gemini-omni/);
      }
    });
  },
);
