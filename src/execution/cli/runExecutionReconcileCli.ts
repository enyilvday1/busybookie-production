import {
  inspectExecutionLifecycle,
} from "../inspectExecutionLifecycle.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readBoundFile } from "../episodeInputBinding.js";
import { BoundEpisodeError } from "../boundEpisodeProduction.types.js";
import { ProductionRulesSchema } from "../../schemas/productionRules.schema.js";
import { RunwayPolicySchema } from "../../schemas/runwayPolicy.schema.js";
import { VeoPolicySchema } from "../../schemas/veoPolicy.schema.js";
import { acquireEpisodeExecutionGuard, releaseEpisodeExecutionGuard, checkedEpisodeExecutionData,
  assertCheckedEpisodeAdmission, readCheckedEpisodeJson, consumeEpisodeRecoveryDispatch,
  type CheckedEpisodeExecutionContext } from "../episodeExecutionGuard.js";

import type {
  ExecutionLifecycleReconciliationDependencies,
  ExecutionLifecycleReconciliationInput,
  ExecutionLifecycleReconciliationResult,
} from "../reconcileExecutionLifecycle.js";

import {
  loadEnvironment,
} from "../../validation/loadEnvironment.js";

import {
  loadProductionRules,
} from "../../validation/loadProductionRules.js";

import type {
  loadRunwayPolicy,
} from "../../validation/loadRunwayPolicy.js";

import type {
  loadVeoPolicy,
} from "../../validation/loadVeoPolicy.js";

import {
  resolveAndValidateMediaRootPath,
} from "../../validation/validateMediaRoot.js";

import type {
  createRunwayTaskLookupClient,
} from "../../runway/execution/createRunwayTaskLookupClient.js";

import type {
  resumeRunwayGen45Task,
} from "../../runway/execution/resumeRunwayGen45Task.js";

import type {
  createVeoOperationLookupClient,
} from "../../veo/execution/createVeoOperationLookupClient.js";

import type {
  resumeVeoOperation,
} from "../../veo/execution/resumeVeoOperation.js";

import type {
  createVeoFileDownloadClient,
} from "../../veo/output/createVeoFileDownloadClient.js";

import type {
  recoverVeoOutput,
} from "../../veo/output/recoverVeoOutput.js";

import type {
  GoogleGenAiSubmittedRecoveryDependencies,
  reconcileGoogleGenAiExecutionLifecycle,
} from "../reconcileGoogleGenAiExecutionLifecycle.js";

import {
  parseExecutionReconcileCliArgs,
} from "./executionReconcileCliArgs.js";

type ReconcileLifecycle =
  (
    input:
      ExecutionLifecycleReconciliationInput,

    dependencies:
      ExecutionLifecycleReconciliationDependencies,
  ) =>
    Promise<
      ExecutionLifecycleReconciliationResult
    >;

export type RunExecutionReconcileCliDependencies =
  Readonly<{
    loadEnvironment:
      typeof loadEnvironment;

    loadProductionRules:
      typeof loadProductionRules;

    resolveMediaRoot:
      typeof resolveAndValidateMediaRootPath;

    inspectLifecycle:
      typeof inspectExecutionLifecycle;

    reconcileLifecycle:
      ReconcileLifecycle;

    loadRunwayPolicy?:
      typeof loadRunwayPolicy;

    createRunwayTaskLookupClient?:
      typeof createRunwayTaskLookupClient;

    resumeRunwayTask?:
      typeof resumeRunwayGen45Task;

    loadVeoPolicy?:
      typeof loadVeoPolicy;

    createVeoOperationLookupClient?:
      typeof createVeoOperationLookupClient;

    createVeoFileDownloadClient?:
      typeof createVeoFileDownloadClient;

    resumeVeoOperation?:
      typeof resumeVeoOperation;

    recoverVeoOutput?:
      typeof recoverVeoOutput;

    reconcileGoogleLifecycle?:
      typeof reconcileGoogleGenAiExecutionLifecycle;

    createGoogleSubmittedRecovery?:
      (
        apiKey:
          string,
      ) =>
        GoogleGenAiSubmittedRecoveryDependencies;
  }>;

export async function runExecutionReconcileCli(
  args:
    readonly string[],

  dependencies:
    RunExecutionReconcileCliDependencies,
  checkedContext?: CheckedEpisodeExecutionContext,
): Promise<void> {
  const options =
    parseExecutionReconcileCliArgs(
      args,
    );

  if (checkedContext) {
    const data = checkedEpisodeExecutionData(checkedContext);
    const action = data.plan.actions[0];
    if (action.kind !== "VISUAL_RECONCILE" || options.episodeId !== action.episodeId || options.shotId !== action.shotId) {
      throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
    }
    await assertCheckedEpisodeAdmission(checkedContext);
    const original = dependencies;
    const required = <T>(value: T | null): T => { if (value === null) throw new BoundEpisodeError("INPUT_BINDING_DRIFT"); return value; };
    dependencies = { ...original,
      loadProductionRules: async () => required(await readCheckedEpisodeJson(checkedContext, "PRODUCTION_RULES", value => ProductionRulesSchema.parse(value))),
      loadRunwayPolicy: async () => required(await readCheckedEpisodeJson(checkedContext, "RUNWAY_POLICY", value => RunwayPolicySchema.parse(value))),
      loadVeoPolicy: async () => required(await readCheckedEpisodeJson(checkedContext, "VEO_POLICY", value => VeoPolicySchema.parse(value))),
      reconcileLifecycle: async (...args) => {
        await assertCheckedEpisodeAdmission(checkedContext); consumeEpisodeRecoveryDispatch(data.invocation);
        return original.reconcileLifecycle(...args);
      },
      ...(original.reconcileGoogleLifecycle ? { reconcileGoogleLifecycle: async (...args: Parameters<NonNullable<RunExecutionReconcileCliDependencies["reconcileGoogleLifecycle"]>>) => {
        await assertCheckedEpisodeAdmission(checkedContext); consumeEpisodeRecoveryDispatch(data.invocation);
        return original.reconcileGoogleLifecycle!(...args);
      } } : {}),
    };
  }

  const env =
    dependencies
      .loadEnvironment();

  const rules =
    await dependencies
      .loadProductionRules();

  const mediaRoot =
    dependencies
      .resolveMediaRoot(
        env,
        rules,
      );

  if (checkedContext && mediaRoot !== checkedEpisodeExecutionData(checkedContext).plan.inputBinding.runtimeIdentity.mediaRoot) {
    throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
  }
  const standaloneGuard = checkedContext ? null : await (async () => {
    const manifest = await readBoundFile({ root: process.cwd(), canonicalPath: resolve(process.cwd(), "episodes", options.episodeId, "episode.json"),
      role: "MANIFEST", maxBytes: 1048576 });
    if (!manifest.binding.rawSha256) throw new BoundEpisodeError("INPUT_BINDING_DRIFT");
    return acquireEpisodeExecutionGuard({ mediaRoot, episodeId: options.episodeId,
      manifestRawSha256: manifest.binding.rawSha256, sessionId: randomUUID() });
  })();
  try {

  const lifecycle =
    await dependencies
      .inspectLifecycle(
        mediaRoot,
        options.episodeId,
        options.shotId,
      );

  const cachedInspectLifecycle:
    typeof inspectExecutionLifecycle =
    async () =>
      lifecycle;

  const reconciliationInput:
    ExecutionLifecycleReconciliationInput =
    {
      mediaRoot,
      episodeId:
        options.episodeId,
      shotId:
        options.shotId,
    };

  // B5C-R1: an EXISTING Google lifecycle (owned by its durable reservation)
  // is recovered only by the existing Google reconciler, exactly once. This
  // is recovery of an already-submitted job, never a new submission: no
  // create, no activation-policy read, no other provider and no fallback.
  if (
    lifecycle.state !==
      "NOTHING" &&
    lifecycle.reservation.provider ===
      "GOOGLE_GENAI"
  ) {
    if (
      lifecycle.state !==
        "SUBMITTED" &&
      lifecycle.state !==
        "COMPLETED"
    ) {
      throw new Error(
        `Execution reconciliation CLI currently supports SUBMITTED or COMPLETED lifecycle only; received ${lifecycle.state}.`,
      );
    }

    const reconcileGoogle =
      dependencies
        .reconcileGoogleLifecycle;

    if (!reconcileGoogle) {
      throw new Error(
        "Google GenAI reconciliation CLI requires the existing Google lifecycle reconciler.",
      );
    }

    const googleInput =
      {
        mediaRoot,
        episodeId:
          options.episodeId,
        shotId:
          options.shotId,
      };

    if (
      lifecycle.state ===
      "COMPLETED"
    ) {
      // Local durable-completion verification only: no credential, no
      // provider client and no network.
      await reconcileGoogle(
        googleInput,
        {},
      );

      return;
    }

    const createSubmittedRecovery =
      dependencies
        .createGoogleSubmittedRecovery;

    if (!createSubmittedRecovery) {
      throw new Error(
        "Google GenAI reconciliation CLI requires the existing secure recovery factory.",
      );
    }

    const geminiApiKey =
      env.GEMINI_API_KEY
        ?.trim();

    if (!geminiApiKey) {
      throw new Error(
        "Google GenAI reconciliation requires GEMINI_API_KEY.",
      );
    }

    await reconcileGoogle(
      googleInput,
      {
        submittedRecovery:
          createSubmittedRecovery(
            geminiApiKey,
          ),
      },
    );

    return;
  }

  if (
    lifecycle.state ===
    "COMPLETED"
  ) {
    await dependencies
      .reconcileLifecycle(
        reconciliationInput,
        {
          inspectLifecycle:
            cachedInspectLifecycle,
        },
      );

    return;
  }

  if (
    lifecycle.state !==
    "SUBMITTED"
  ) {
    throw new Error(
      `Execution reconciliation CLI currently supports SUBMITTED or COMPLETED lifecycle only; received ${lifecycle.state}.`,
    );
  }

  const submission =
    lifecycle.submission;

  if (
    submission.provider ===
    "VEO"
  ) {
    if (
      submission.schemaVersion !==
      "1.3"
    ) {
      await dependencies
        .reconcileLifecycle(
          reconciliationInput,
          {
            inspectLifecycle:
              cachedInspectLifecycle,
          },
        );

      return;
    }

    const loadVeoRecoveryPolicy =
      dependencies
        .loadVeoPolicy;

    if (!loadVeoRecoveryPolicy) {
      throw new Error(
        "Veo reconciliation CLI requires a Veo policy loader.",
      );
    }

    const createVeoLookupClient =
      dependencies
        .createVeoOperationLookupClient;

    if (!createVeoLookupClient) {
      throw new Error(
        "Veo reconciliation CLI requires a recovery-only operation lookup client factory.",
      );
    }

    const createVeoDownloadClient =
      dependencies
        .createVeoFileDownloadClient;

    if (!createVeoDownloadClient) {
      throw new Error(
        "Veo reconciliation CLI requires a recovery-only file download client factory.",
      );
    }

    const resumeExistingVeoOperation =
      dependencies
        .resumeVeoOperation;

    if (!resumeExistingVeoOperation) {
      throw new Error(
        "Veo reconciliation CLI requires a same-operation resume function.",
      );
    }

    const recoverExistingVeoOutput =
      dependencies
        .recoverVeoOutput;

    if (!recoverExistingVeoOutput) {
      throw new Error(
        "Veo reconciliation CLI requires an already-generated output recovery function.",
      );
    }

    const veoPolicy =
      await loadVeoRecoveryPolicy();

    const geminiApiKey =
      env.GEMINI_API_KEY
        ?.trim();

    if (!geminiApiKey) {
      throw new Error(
        "Veo reconciliation requires GEMINI_API_KEY.",
      );
    }

    const veoClient =
      createVeoLookupClient(
        geminiApiKey,
      );

    const veoFileClient =
      createVeoDownloadClient(
        geminiApiKey,
      );

    await dependencies
      .reconcileLifecycle(
        {
          ...reconciliationInput,

          veoPollIntervalMs:
            veoPolicy
              .operation
              .pollIntervalMs,

          veoTimeoutMs:
            veoPolicy
              .operation
              .timeoutMs,
        },
        {
          inspectLifecycle:
            cachedInspectLifecycle,

          resumeVeoOperation:
            (input) =>
              resumeExistingVeoOperation(
                veoClient,
                input,
              ),

          recoverVeoOutput:
            (
              generatedVideo,
              destinationPath,
            ) =>
              recoverExistingVeoOutput(
                generatedVideo,
                destinationPath,
                (downloadParameters) =>
                  veoFileClient
                    .files
                    .download(
                      downloadParameters,
                    ),
              ),
        },
      );

    return;
  }

  if (
    submission.provider !==
    "RUNWAY"
  ) {
    throw new Error(
      `Execution reconciliation CLI does not yet support SUBMITTED provider ${submission.provider}.`,
    );
  }

  if (
    submission.schemaVersion !==
    "1.2"
  ) {
    await dependencies
      .reconcileLifecycle(
        reconciliationInput,
        {
          inspectLifecycle:
            cachedInspectLifecycle,
        },
      );

    return;
  }

  const loadRunwayRecoveryPolicy =
    dependencies
      .loadRunwayPolicy;

  if (!loadRunwayRecoveryPolicy) {
    throw new Error(
      "Runway reconciliation CLI requires a Runway policy loader.",
    );
  }

  const createRunwayLookupClient =
    dependencies
      .createRunwayTaskLookupClient;

  if (!createRunwayLookupClient) {
    throw new Error(
      "Runway reconciliation CLI requires a recovery-only task lookup client factory.",
    );
  }

  const resumeRunwayTask =
    dependencies
      .resumeRunwayTask;

  if (!resumeRunwayTask) {
    throw new Error(
      "Runway reconciliation CLI requires a same-task resume function.",
    );
  }

  const runwayPolicy =
    await loadRunwayRecoveryPolicy();

  const runwayApiSecret =
    env.RUNWAYML_API_SECRET
      ?.trim();

  if (!runwayApiSecret) {
    throw new Error(
      "Runway reconciliation requires RUNWAYML_API_SECRET.",
    );
  }

  const runwayClient =
    createRunwayLookupClient({
      RUNWAYML_API_SECRET:
        runwayApiSecret,
    });

  await dependencies
    .reconcileLifecycle(
      {
        ...reconciliationInput,

        runwayWaitTimeoutMs:
          runwayPolicy
            .task
            .waitTimeoutMs,
      },
      {
        inspectLifecycle:
          cachedInspectLifecycle,

        resumeRunwayTask:
          (input) =>
            resumeRunwayTask(
              runwayClient,
              input,
            ),
      },
    );
  } finally { if (standaloneGuard) await releaseEpisodeExecutionGuard(standaloneGuard); }
}
