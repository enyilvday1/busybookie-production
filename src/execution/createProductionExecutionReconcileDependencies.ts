import {
  loadEnvironment,
} from "../validation/loadEnvironment.js";

import {
  loadProductionRules,
} from "../validation/loadProductionRules.js";

import {
  loadRunwayPolicy,
} from "../validation/loadRunwayPolicy.js";

import {
  loadVeoPolicy,
} from "../validation/loadVeoPolicy.js";

import {
  resolveAndValidateMediaRootPath,
} from "../validation/validateMediaRoot.js";

import {
  createRunwayTaskLookupClient,
} from "../runway/execution/createRunwayTaskLookupClient.js";

import {
  resumeRunwayGen45Task,
} from "../runway/execution/resumeRunwayGen45Task.js";

import {
  createVeoOperationLookupClient,
} from "../veo/execution/createVeoOperationLookupClient.js";

import {
  resumeVeoOperation,
} from "../veo/execution/resumeVeoOperation.js";

import {
  createVeoFileDownloadClient,
} from "../veo/output/createVeoFileDownloadClient.js";

import {
  recoverVeoOutput,
} from "../veo/output/recoverVeoOutput.js";

import type {
  RunExecutionReconcileCliDependencies,
} from "./cli/runExecutionReconcileCli.js";

import {
  inspectExecutionLifecycle,
} from "./inspectExecutionLifecycle.js";

import {
  reconcileExecutionLifecycle,
} from "./reconcileExecutionLifecycle.js";

// B5C-R1: recovery of an EXISTING Google submission only. Both are
// network-free to import and construct; no creator or submitter is wired.
import {
  reconcileGoogleGenAiExecutionLifecycle,
} from "./reconcileGoogleGenAiExecutionLifecycle.js";

import {
  createGoogleGenAiSingleShotSecureProductionRecovery,
} from "./providers/createGoogleGenAiSingleShotSecureProductionRecovery.js";

export type ProductionExecutionReconcileCompositionDependencies =
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
      typeof reconcileExecutionLifecycle;

    loadRunwayPolicy:
      typeof loadRunwayPolicy;

    createRunwayTaskLookupClient:
      typeof createRunwayTaskLookupClient;

    resumeRunwayTask:
      typeof resumeRunwayGen45Task;

    loadVeoPolicy:
      typeof loadVeoPolicy;

    createVeoOperationLookupClient:
      typeof createVeoOperationLookupClient;

    createVeoFileDownloadClient:
      typeof createVeoFileDownloadClient;

    resumeVeoOperation:
      typeof resumeVeoOperation;

    recoverVeoOutput:
      typeof recoverVeoOutput;

    reconcileGoogleLifecycle:
      typeof reconcileGoogleGenAiExecutionLifecycle;

    createGoogleSubmittedRecovery:
      typeof createGoogleGenAiSingleShotSecureProductionRecovery;
  }>;

const defaultDependencies:
  ProductionExecutionReconcileCompositionDependencies =
  Object.freeze({
    loadEnvironment,
    loadProductionRules,

    resolveMediaRoot:
      resolveAndValidateMediaRootPath,

    inspectLifecycle:
      inspectExecutionLifecycle,

    reconcileLifecycle:
      reconcileExecutionLifecycle,

    loadRunwayPolicy,
    createRunwayTaskLookupClient,

    resumeRunwayTask:
      resumeRunwayGen45Task,

    loadVeoPolicy,
    createVeoOperationLookupClient,
    createVeoFileDownloadClient,
    resumeVeoOperation,
    recoverVeoOutput,

    reconcileGoogleLifecycle:
      reconcileGoogleGenAiExecutionLifecycle,

    createGoogleSubmittedRecovery:
      createGoogleGenAiSingleShotSecureProductionRecovery,
  });

export function createProductionExecutionReconcileDependencies(
  dependencies:
    ProductionExecutionReconcileCompositionDependencies =
      defaultDependencies,
): RunExecutionReconcileCliDependencies {
  return Object.freeze({
    loadEnvironment:
      dependencies
        .loadEnvironment,

    loadProductionRules:
      dependencies
        .loadProductionRules,

    resolveMediaRoot:
      dependencies
        .resolveMediaRoot,

    inspectLifecycle:
      dependencies
        .inspectLifecycle,

    reconcileLifecycle:
      dependencies
        .reconcileLifecycle,

    loadRunwayPolicy:
      dependencies
        .loadRunwayPolicy,

    createRunwayTaskLookupClient:
      dependencies
        .createRunwayTaskLookupClient,

    resumeRunwayTask:
      dependencies
        .resumeRunwayTask,

    loadVeoPolicy:
      dependencies
        .loadVeoPolicy,

    createVeoOperationLookupClient:
      dependencies
        .createVeoOperationLookupClient,

    createVeoFileDownloadClient:
      dependencies
        .createVeoFileDownloadClient,

    resumeVeoOperation:
      dependencies
        .resumeVeoOperation,

    recoverVeoOutput:
      dependencies
        .recoverVeoOutput,

    reconcileGoogleLifecycle:
      dependencies
        .reconcileGoogleLifecycle,

    createGoogleSubmittedRecovery:
      dependencies
        .createGoogleSubmittedRecovery,
  });
}
