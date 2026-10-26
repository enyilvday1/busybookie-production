import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
  relative,
  sep,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  GOOGLE_GENAI_ACTIVATION_LIMITS,
  GOOGLE_GENAI_CREATE_TIMEOUT_MS,
} from "../src/googleGenai/googleGenAiActivationLimits.js";

import {
  GoogleGenAiActivationPolicySchema,
} from "../src/schemas/googleGenAiActivationPolicy.schema.js";

import {
  GenerationProviderSchema,
} from "../src/schemas/productionRules.schema.js";

import {
  DEFAULT_GOOGLE_GENAI_ACTIVATION_POLICY_PATH,
  loadGoogleGenAiActivationPolicy,
} from "../src/validation/loadGoogleGenAiActivationPolicy.js";

const ROOT =
  process.cwd();

const CONFIG_PATH =
  join(
    ROOT,
    "config",
    "google-genai-activation-policy.json",
  );

const temporaryDirectories:
  string[] = [];

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

async function checkedInJson():
Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(
      CONFIG_PATH,
      "utf8",
    ),
  ) as Record<string, unknown>;
}

async function writeTemporaryPolicy(
  contents:
    string,
): Promise<string> {
  const directory =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-google-activation-policy-",
      ),
    );

  temporaryDirectories.push(
    directory,
  );

  const path =
    join(
      directory,
      "policy.json",
    );

  await writeFile(
    path,
    contents,
  );

  return path;
}

function withSection(
  base:
    Record<string, unknown>,
  section:
    string,
  key:
    string,
  value:
    unknown,
): Record<string, unknown> {
  return {
    ...base,

    [section]: {
      ...(base[section] as Record<string, unknown>),

      [key]:
        value,
    },
  };
}

async function listSourceFiles(
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
        recursive:
          true,

        withFileTypes:
          true,
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
        relative(
          ROOT,
          join(
            entry.parentPath,
            entry.name,
          ),
        )
          .split(sep)
          .join("/"),
    );
}

describe(
  "Busybookie Google GenAI activation policy (B4U6)",
  () => {
    it(
      "loads the checked-in policy from the default path, strictly valid and frozen",
      async () => {
        expect(
          DEFAULT_GOOGLE_GENAI_ACTIVATION_POLICY_PATH,
        ).toBe(
          CONFIG_PATH,
        );

        const policy =
          await loadGoogleGenAiActivationPolicy();

        expect(policy.limits.filesMetadataMaxResponseBytes).toBe(65536);
        expect(policy.recovery.streamRecoveryFirstRetryDelayMs).toBe(5000);
        expect(policy.recovery.streamRecoverySecondRetryDelayMs).toBe(15000);
        expect(policy.recovery.filesDownloadRetryDelayMs).toBe(10000);
        expect(Object.isFrozen(GOOGLE_GENAI_ACTIVATION_LIMITS.limits)).toBe(true);
        expect(Object.isFrozen(GOOGLE_GENAI_ACTIVATION_LIMITS.recovery)).toBe(true);

        expect(
          Object.isFrozen(
            policy,
          ),
        ).toBe(
          true,
        );

        for (
          const section of [
            policy.admission,
            policy.cost,
            policy.limits,
            policy.timeouts,
            policy.recovery,
          ]
        ) {
          expect(
            Object.isFrozen(
              section,
            ),
          ).toBe(
            true,
          );
        }
      },
    );

    it(
      "keeps new Google submissions disabled in the checked-in policy",
      async () => {
        const policy =
          await loadGoogleGenAiActivationPolicy();

        expect(
          policy.admission,
        ).toStrictEqual({
          newSubmissionsEnabled:
            false,
        });
      },
    );

    it(
      "encodes every B4U5 value exactly",
      async () => {
        expect(
          await checkedInJson(),
        ).toStrictEqual({
          schemaVersion:
            "1.0",

          provider:
            "GOOGLE_GENAI",

          model:
            "gemini-omni-1.1-flash",

          admission: {
            newSubmissionsEnabled:
              false,
          },

          cost: {
            fixedPointUnit:
              "MICRO_USD",

            maxExpectedCostMicroUsd:
              2000000,

            inputReserveMicroUsd:
              500000,

            costAdmissionDurationSeconds:
              10,
          },

          limits: {
            filesMetadataMaxResponseBytes:
              65536,

            maxOutputBytes:
              268435456,

            maxReferenceImageBytes:
              10485760,

            sseMaxEventBytes:
              1048576,

            sseMaxResponseBytesPerAttempt:
              16777216,

            sseMaxEventsPerAttempt:
              512,
          },

          timeouts: {
            createTimeoutMs:
              60000,

            streamConnectHeadersTimeoutMs:
              30000,

            streamIdleTimeoutMs:
              120000,

            streamAttemptTimeoutMs:
              900000,

            filesMetadataTimeoutMs:
              30000,

            filesDownloadTimeoutMs:
              600000,

            reconciliationAttemptTimeoutMs:
              1200000,
          },

          recovery: {
            streamRecoveryFirstRetryDelayMs:
              5000,

            streamRecoverySecondRetryDelayMs:
              15000,

            filesDownloadRetryDelayMs:
              10000,

            automatedRemoteRecoveryHorizonMs:
              86400000,

            filesMinRemainingLifetimeMs:
              3600000,

            maxStreamRecoveryAttemptsPerReconciliation:
              3,

            maxFilesDownloadAttemptsPerReconciliation:
              2,
          },
        });
      },
    );

    it(
      "pins USD 2.00 cap, USD 0.50 reserve and the 10-second cost duration in MICRO_USD",
      () => {
        expect(
          GOOGLE_GENAI_ACTIVATION_LIMITS.cost,
        ).toStrictEqual({
          maxExpectedCostMicroUsd:
            2000000,

          inputReserveMicroUsd:
            500000,

          costAdmissionDurationSeconds:
            10,
        });

        expect(
          GOOGLE_GENAI_ACTIVATION_LIMITS.cost.maxExpectedCostMicroUsd /
            1_000_000,
        ).toBe(
          2,
        );

        expect(
          GOOGLE_GENAI_ACTIVATION_LIMITS.cost.inputReserveMicroUsd /
            1_000_000,
        ).toBe(
          0.5,
        );

        expect(
          GOOGLE_GENAI_CREATE_TIMEOUT_MS,
        ).toBe(
          60000,
        );

        expect(
          Object.isFrozen(
            GOOGLE_GENAI_ACTIVATION_LIMITS,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "accepts the switch only as a strict boolean (enabled fixture parses)",
      async () => {
        const base =
          await checkedInJson();

        expect(
          GoogleGenAiActivationPolicySchema.safeParse(
            withSection(
              base,
              "admission",
              "newSubmissionsEnabled",
              true,
            ),
          ).success,
        ).toBe(
          true,
        );

        for (
          const value of [
            "true",
            1,
            null,
            undefined,
          ]
        ) {
          expect(
            GoogleGenAiActivationPolicySchema.safeParse(
              withSection(
                base,
                "admission",
                "newSubmissionsEnabled",
                value,
              ),
            ).success,
          ).toBe(
            false,
          );
        }
      },
    );

    it.each([
      "schemaVersion",
      "provider",
      "model",
      "admission",
      "cost",
      "limits",
      "timeouts",
      "recovery",
    ])(
      "rejects a policy missing %s",
      async (key) => {
        const {
          [key]: _removed,
          ...rest
        } =
          await checkedInJson();

        expect(
          GoogleGenAiActivationPolicySchema.safeParse(
            rest,
          ).success,
        ).toBe(
          false,
        );
      },
    );

    it.each([
      ["cost", "maxExpectedCostMicroUsd"],
      ["cost", "inputReserveMicroUsd"],
      ["cost", "costAdmissionDurationSeconds"],
      ["limits", "maxOutputBytes"],
      ["limits", "filesMetadataMaxResponseBytes"],
      ["limits", "maxReferenceImageBytes"],
      ["limits", "sseMaxEventBytes"],
      ["limits", "sseMaxResponseBytesPerAttempt"],
      ["limits", "sseMaxEventsPerAttempt"],
      ["timeouts", "createTimeoutMs"],
      ["timeouts", "streamConnectHeadersTimeoutMs"],
      ["timeouts", "streamIdleTimeoutMs"],
      ["timeouts", "streamAttemptTimeoutMs"],
      ["timeouts", "filesMetadataTimeoutMs"],
      ["timeouts", "filesDownloadTimeoutMs"],
      ["timeouts", "reconciliationAttemptTimeoutMs"],
      ["recovery", "automatedRemoteRecoveryHorizonMs"],
      ["recovery", "filesMinRemainingLifetimeMs"],
      ["recovery", "maxStreamRecoveryAttemptsPerReconciliation"],
      ["recovery", "maxFilesDownloadAttemptsPerReconciliation"],
      ["recovery", "streamRecoveryFirstRetryDelayMs"],
      ["recovery", "streamRecoverySecondRetryDelayMs"],
      ["recovery", "filesDownloadRetryDelayMs"],
    ])(
      "rejects missing, mistyped, non-finite, non-positive and drifted %s.%s",
      async (
        section,
        key,
      ) => {
        const base =
          await checkedInJson();

        const current =
          (
            base[section] as Record<string, number>
          )[key] as number;

        const {
          [key]: _removed,
          ...missing
        } =
          base[section] as Record<string, unknown>;

        expect(
          GoogleGenAiActivationPolicySchema.safeParse({
            ...base,

            [section]:
              missing,
          }).success,
        ).toBe(
          false,
        );

        for (
          const invalid of [
            String(current),
            Number.NaN,
            Number.POSITIVE_INFINITY,
            -current,
            0,
            current + 1,
            current - 1,
            current + 0.5,
            null,
          ]
        ) {
          expect(
            GoogleGenAiActivationPolicySchema.safeParse(
              withSection(
                base,
                section,
                key,
                invalid,
              ),
            ).success,
            `${section}.${key}=${String(invalid)}`,
          ).toBe(
            false,
          );
        }
      },
    );

    it.each([
      ["top-level", (base: Record<string, unknown>) => ({ ...base, enabledByEnvironment: true })],
      ["admission", (base: Record<string, unknown>) => withSection(base, "admission", "force", true)],
      ["cost", (base: Record<string, unknown>) => withSection(base, "cost", "rate720p", 101360)],
      ["limits", (base: Record<string, unknown>) => withSection(base, "limits", "extra", 1)],
      ["timeouts", (base: Record<string, unknown>) => withSection(base, "timeouts", "retryMs", 1)],
      ["recovery", (base: Record<string, unknown>) => withSection(base, "recovery", "lastEventId", 1)],
    ])(
      "rejects an unknown %s key",
      async (
        _label,
        mutate,
      ) => {
        expect(
          GoogleGenAiActivationPolicySchema.safeParse(
            mutate(
              await checkedInJson(),
            ),
          ).success,
        ).toBe(
          false,
        );
      },
    );

    it.each([
      ["schemaVersion", "2.0"],
      ["provider", "VEO"],
      ["model", "gemini-omni-1.1-pro"],
    ])(
      "rejects an unsupported %s value",
      async (
        key,
        value,
      ) => {
        expect(
          GoogleGenAiActivationPolicySchema.safeParse({
            ...(await checkedInJson()),

            [key]:
              value,
          }).success,
        ).toBe(
          false,
        );

        expect(
          GoogleGenAiActivationPolicySchema.safeParse(
            withSection(
              await checkedInJson(),
              "cost",
              "fixedPointUnit",
              "USD",
            ),
          ).success,
        ).toBe(
          false,
        );
      },
    );

    it(
      "fails closed with actionable non-secret errors for missing, malformed, and invalid files",
      async () => {
        const missingPath =
          join(
            await mkdtemp(
              join(
                tmpdir(),
                "busybookie-google-activation-missing-",
              ),
            ),
            "absent.json",
          );

        temporaryDirectories.push(
          join(
            missingPath,
            "..",
          ),
        );

        await expect(
          loadGoogleGenAiActivationPolicy(
            missingPath,
          ),
        ).rejects.toThrow(
          /activation policy could not be read/,
        );

        await expect(
          loadGoogleGenAiActivationPolicy(
            await writeTemporaryPolicy(
              "{ not json",
            ),
          ),
        ).rejects.toThrow(
          /activation policy contains invalid JSON/,
        );

        const enabledWithDrift =
          withSection(
            withSection(
              await checkedInJson(),
              "admission",
              "newSubmissionsEnabled",
              true,
            ),
            "cost",
            "maxExpectedCostMicroUsd",
            5000000,
          );

        await expect(
          loadGoogleGenAiActivationPolicy(
            await writeTemporaryPolicy(
              JSON.stringify(
                enabledWithDrift,
              ),
            ),
          ),
        ).rejects.toThrow(
          /activation policy validation failed/,
        );
      },
    );

    it(
      "keeps the loader free of environment overrides and permissive defaults",
      async () => {
        const loader =
          await readFile(
            join(
              ROOT,
              "src/validation/loadGoogleGenAiActivationPolicy.ts",
            ),
            "utf8",
          );

        expect(
          loader,
        ).not.toMatch(
          /process\.env|dotenv|loadEnvironment|\?\?\s*(?:true|false)|\.default\(|\.catch\(|\.passthrough\(|\.optional\(/,
        );

        const schema =
          await readFile(
            join(
              ROOT,
              "src/schemas/googleGenAiActivationPolicy.schema.ts",
            ),
            "utf8",
          );

        expect(
          schema,
        ).not.toMatch(
          /\.default\(|\.catch\(|\.passthrough\(|\.optional\(|z\.any\(|z\.unknown\(/,
        );

        for (
          const file of [
            "src/schemas/environment.schema.ts",
            "src/validation/loadEnvironment.ts",
          ]
        ) {
          expect(
            await readFile(
              join(
                ROOT,
                file,
              ),
              "utf8",
            ),
            file,
          ).not.toMatch(
            /GOOGLE_GENAI|GEMINI_.*ENABLE|newSubmissionsEnabled|ActivationPolicy/,
          );
        }
      },
    );

    it(
      "limits activation-policy importers in src and scripts to the submission path, the dormant secure recovery factory and its own authority chain",
      async () => {
        const importers: string[] =
          [];

        for (
          const file of [
            ...(await listSourceFiles("src")),
            ...(await listSourceFiles("scripts")),
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

          const specifiers =
            [
              ...source.matchAll(
                /(?:import|export)\s[^;]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g,
              ),
            ].map(
              (match) =>
                match[1] ??
                match[2] ??
                match[3] ??
                "",
            );

          if (
            specifiers.some(
              (specifier) =>
                /googleGenAiActivationPolicy\.schema|loadGoogleGenAiActivationPolicy|googleGenAiActivationLimits|googleGenAiExpectedCost|readGoogleGenAiReferenceImage/.test(
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
          // B4X: the operator CLI runner loads the activation policy for execute only.
          "src/execution/cli/runGoogleGenAiOperatorCli.ts",
          // B4X: the operator orchestrator runs the pre-reservation cost and reference-image admission.
          "src/execution/executeGoogleGenAiOperatorSingleShot.ts",
          "src/execution/providers/createGoogleGenAiSingleShotProductionInteractionCreator.ts",
          // B4V7: the dormant secure recovery factory reads the frozen limits constant.
          "src/execution/providers/createGoogleGenAiSingleShotSecureProductionRecovery.ts",
          "src/execution/providers/submitGoogleGenAiSingleShot.ts",
          "src/googleGenai/googleGenAiExpectedCost.ts",
          "src/schemas/googleGenAiActivationPolicy.schema.ts",
          "src/validation/loadGoogleGenAiActivationPolicy.ts",
        ]);
      },
    );

    it(
      "references the new-submission switch only in the schema and the submission gate",
      async () => {
        const references: string[] =
          [];

        for (
          const file of await listSourceFiles(
            "src",
          )
        ) {
          if (
            (
              await readFile(
                join(
                  ROOT,
                  file,
                ),
                "utf8",
              )
            ).includes(
              "newSubmissionsEnabled",
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
          // B4X: the operator orchestrator checks the switch before any reservation.
          "src/execution/executeGoogleGenAiOperatorSingleShot.ts",
          "src/execution/providers/submitGoogleGenAiSingleShot.ts",
          "src/schemas/googleGenAiActivationPolicy.schema.ts",
        ]);
      },
    );

    it(
      "leaves the dormant runtime boundary unwidened",
      async () => {
        expect(
          GenerationProviderSchema.options,
        ).toEqual([
          "RUNWAY",
          "VEO",
          "KREA",
          "MANUAL",
        ]);

        const types =
          await readFile(
            join(
              ROOT,
              "src/execution/singleShotExecution.types.ts",
            ),
            "utf8",
          );

        expect(
          types,
        ).toMatch(
          /export type PaidExecutionProvider =\s*\|\s*"RUNWAY"\s*\|\s*"VEO";/,
        );

        const executeSingleShot =
          await readFile(
            join(
              ROOT,
              "src/execution/executeSingleShot.ts",
            ),
            "utf8",
          );

        expect(
          executeSingleShot,
        ).toMatch(
          /case "RUNWAY":\s*case "VEO":\s*return provider;/,
        );

        for (
          const file of [
            "src/execution/executeSingleShot.ts",
            "src/execution/singleShotExecution.types.ts",
            "src/execution/cli/runSingleShotExecutionCli.ts",
            "src/execution/createProductionSingleShotExecutionDependencies.ts",
            "src/execution/reconcileExecutionLifecycle.ts",
            "src/execution/createExecutionCompletion.ts",
            "src/composition/buildEpisodeCompositionPlan.ts",
            "src/composition/verifyCompletedShotForComposition.ts",
            "src/execution/resolveDurableShotVisualGenerationState.ts",
            "src/routing/evaluateShotProvider.ts",
          ]
        ) {
          expect(
            await readFile(
              join(
                ROOT,
                file,
              ),
              "utf8",
            ),
            file,
          ).not.toMatch(
            /GOOGLE_GENAI|GoogleGenAi|googleGenai|gemini-omni/,
          );
        }
      },
    );
  },
);
