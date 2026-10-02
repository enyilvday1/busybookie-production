import {
  createRunwayTaskLookupClient,
} from "../runway/execution/createRunwayTaskLookupClient.js";

import type {
  RunwayCredentialSource,
} from "../runway/runway.types.js";

import {
  loadDialogueVoicePolicy,
} from "../validation/loadDialogueVoicePolicy.js";

import {
  inspectDialogueLifecycle,
} from "./inspectDialogueLifecycle.js";

import {
  reconcileDialogueLifecycle,
  type DialogueLifecycleReconciliationInput,
  type DialogueLifecycleReconciliationResult,
} from "./reconcileDialogueLifecycle.js";

import {
  resumeRunwayElevenV3Task,
} from "./resumeRunwayElevenV3Task.js";

export type RunwayDialogueProductionReconciliationInput =
  Omit<
    DialogueLifecycleReconciliationInput,
    "runwayWaitTimeoutMs"
  >;

export type RunwayDialogueProductionReconciler =
  (
    input:
      RunwayDialogueProductionReconciliationInput,
  ) =>
    Promise<
      DialogueLifecycleReconciliationResult
    >;

export type RunwayDialogueProductionReconcilerDependencies =
  Readonly<{
    inspectLifecycle:
      typeof inspectDialogueLifecycle;

    loadPolicy:
      typeof loadDialogueVoicePolicy;

    createLookupClient:
      typeof createRunwayTaskLookupClient;

    resumeRunwayTask:
      typeof resumeRunwayElevenV3Task;

    reconcileLifecycle:
      typeof reconcileDialogueLifecycle;
  }>;

const defaultDependencies:
  RunwayDialogueProductionReconcilerDependencies =
    Object.freeze({
      inspectLifecycle:
        inspectDialogueLifecycle,

      loadPolicy:
        loadDialogueVoicePolicy,

      createLookupClient:
        createRunwayTaskLookupClient,

      resumeRunwayTask:
        resumeRunwayElevenV3Task,

      reconcileLifecycle:
        reconcileDialogueLifecycle,
    });

function createCachedLifecycleInspector(
  input:
    RunwayDialogueProductionReconciliationInput,

  lifecycle:
    Awaited<
      ReturnType<
        typeof inspectDialogueLifecycle
      >
    >,
): typeof inspectDialogueLifecycle {
  return async (
    mediaRoot,
    episodeId,
    sceneId,
    shotId,
    dialogueLineId,
  ) => {
    if (
      mediaRoot !==
        input.mediaRoot ||
      episodeId !==
        input.episodeId ||
      sceneId !==
        input.sceneId ||
      shotId !==
        input.shotId ||
      dialogueLineId !==
        input.dialogueLineId
    ) {
      throw new Error(
        "Cached dialogue lifecycle inspection identity does not match the production reconciliation input.",
      );
    }

    return lifecycle;
  };
}

export function createRunwayDialogueProductionReconciler(
  credentialSource:
    RunwayCredentialSource,

  dependencies:
    RunwayDialogueProductionReconcilerDependencies =
      defaultDependencies,
): RunwayDialogueProductionReconciler {
  return async (
    input,
  ) => {
    const lifecycle =
      await dependencies
        .inspectLifecycle(
          input.mediaRoot,
          input.episodeId,
          input.sceneId,
          input.shotId,
          input.dialogueLineId,
        );

    const cachedInspectLifecycle =
      createCachedLifecycleInspector(
        input,
        lifecycle,
      );

    if (
      lifecycle.state !==
      "SUBMITTED"
    ) {
      return dependencies
        .reconcileLifecycle(
          input,
          {
            inspectLifecycle:
              cachedInspectLifecycle,
          },
        );
    }

    const policy =
      await dependencies
        .loadPolicy();

    const lookupClient =
      dependencies
        .createLookupClient(
          credentialSource,
        );

    return dependencies
      .reconcileLifecycle(
        {
          ...input,

          runwayWaitTimeoutMs:
            policy.task
              .waitTimeoutMs,
        },
        {
          inspectLifecycle:
            cachedInspectLifecycle,

          resumeRunwayTask:
            (
              resumeInput,
            ) =>
              dependencies
                .resumeRunwayTask(
                  lookupClient,
                  resumeInput,
                ),
        },
      );
  };
}
