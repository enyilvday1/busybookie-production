import {
  inspectExecutionLifecycle,
} from "../inspectExecutionLifecycle.js";

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
  }>;

export async function runExecutionReconcileCli(
  args:
    readonly string[],

  dependencies:
    RunExecutionReconcileCliDependencies,
): Promise<void> {
  const options =
    parseExecutionReconcileCliArgs(
      args,
    );

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
}
