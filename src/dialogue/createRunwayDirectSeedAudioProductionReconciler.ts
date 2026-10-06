import {
  createRunwayTaskLookupClient,
} from "../runway/execution/createRunwayTaskLookupClient.js";

import type {
  RunwayCredentialSource,
} from "../runway/runway.types.js";

import {
  loadDialogueSeedAudioPolicy,
} from "../validation/loadDialogueSeedAudioPolicy.js";

import {
  createDialogueDirectSeedAudioCompletionPath,
} from "./dialogueDirectSeedAudioLifecyclePaths.js";

import {
  inspectDialogueDirectSeedAudioLifecycle,
} from "./inspectDialogueDirectSeedAudioLifecycle.js";

import {
  reconcileDialogueLifecycle,
  type DialogueLifecycleReconciliationDependencies,
  type DialogueLifecycleReconciliationInput,
  type DialogueLifecycleReconciliationResult,
} from "./reconcileDialogueLifecycle.js";

import {
  recoverDialogueDirectSeedAudioCompletion,
} from "./recoverDialogueDirectSeedAudioCompletion.js";

import {
  resumeRunwayReferenceAudioTask,
} from "./resumeRunwayReferenceAudioTask.js";

export type RunwayDirectSeedAudioProductionReconciliationInput =
  Readonly<
    Omit<
      DialogueLifecycleReconciliationInput,
      "runwayWaitTimeoutMs"
    > & {
      planKey:
        string;
    }
  >;

export type RunwayDirectSeedAudioProductionReconciler =
  (
    input:
      RunwayDirectSeedAudioProductionReconciliationInput,
  ) =>
    Promise<
      DialogueLifecycleReconciliationResult
    >;

export type RunwayDirectSeedAudioProductionReconcilerDependencies =
  Readonly<{
    inspectLifecycle:
      typeof inspectDialogueDirectSeedAudioLifecycle;

    loadPolicy:
      typeof loadDialogueSeedAudioPolicy;

    createLookupClient:
      typeof createRunwayTaskLookupClient;

    resumeRunwayReferenceAudioTask:
      typeof resumeRunwayReferenceAudioTask;

    recoverCompletion:
      typeof recoverDialogueDirectSeedAudioCompletion;

    resolveCompletionPath:
      typeof createDialogueDirectSeedAudioCompletionPath;

    reconcileLifecycle:
      typeof reconcileDialogueLifecycle;
  }>;

const defaultDependencies:
  RunwayDirectSeedAudioProductionReconcilerDependencies =
    Object.freeze({
      inspectLifecycle:
        inspectDialogueDirectSeedAudioLifecycle,

      loadPolicy:
        loadDialogueSeedAudioPolicy,

      createLookupClient:
        createRunwayTaskLookupClient,

      resumeRunwayReferenceAudioTask:
        resumeRunwayReferenceAudioTask,

      recoverCompletion:
        recoverDialogueDirectSeedAudioCompletion,

      resolveCompletionPath:
        createDialogueDirectSeedAudioCompletionPath,

      reconcileLifecycle:
        reconcileDialogueLifecycle,
    });

function createCachedLifecycleInspector(
  input:
    RunwayDirectSeedAudioProductionReconciliationInput,

  lifecycle:
    Awaited<
      ReturnType<
        typeof inspectDialogueDirectSeedAudioLifecycle
      >
    >,
): DialogueLifecycleReconciliationDependencies[
  "inspectLifecycle"
] {
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
        "Cached direct SeedAudio dialogue lifecycle inspection identity does not match the production reconciliation input.",
      );
    }

    return lifecycle;
  };
}

function assertDirectSeedAudioV3Lifecycle(
  lifecycle:
    Awaited<
      ReturnType<
        typeof inspectDialogueDirectSeedAudioLifecycle
      >
    >,
): void {
  if (
    lifecycle.state !==
      "SUBMITTED" &&
    lifecycle.state !==
      "COMPLETED"
  ) {
    return;
  }

  if (
    lifecycle.submission
      .schemaVersion !==
    "3.0"
  ) {
    throw new Error(
      "Runway direct SeedAudio production reconciliation requires durable v3 direct SeedAudio lifecycle evidence.",
    );
  }
}

export function createRunwayDirectSeedAudioProductionReconciler(
  credentialSource:
    RunwayCredentialSource,

  dependencies:
    RunwayDirectSeedAudioProductionReconcilerDependencies =
      defaultDependencies,
): RunwayDirectSeedAudioProductionReconciler {
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
          input.planKey,
        );

    assertDirectSeedAudioV3Lifecycle(
      lifecycle,
    );

    const cachedInspectLifecycle =
      createCachedLifecycleInspector(
        input,
        lifecycle,
      );

    const reconciliationInput:
      Omit<
        DialogueLifecycleReconciliationInput,
        "runwayWaitTimeoutMs"
      > =
        Object.freeze({
          mediaRoot:
            input.mediaRoot,

          episodeId:
            input.episodeId,

          sceneId:
            input.sceneId,

          shotId:
            input.shotId,

          dialogueLineId:
            input.dialogueLineId,
        });

    if (
      lifecycle.state !==
      "SUBMITTED"
    ) {
      return dependencies
        .reconcileLifecycle(
          reconciliationInput,
          {
            inspectLifecycle:
              cachedInspectLifecycle,

            recoverCompletion:
              dependencies
                .recoverCompletion,

            resolveCompletionPath:
              dependencies
                .resolveCompletionPath,
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
          ...reconciliationInput,

          runwayWaitTimeoutMs:
            policy.task
              .waitTimeoutMs,
        },
        {
          inspectLifecycle:
            cachedInspectLifecycle,

          resumeRunwayReferenceAudioTask:
            (
              resumeInput,
            ) =>
              dependencies
                .resumeRunwayReferenceAudioTask(
                  lookupClient,
                  resumeInput,
                ),

          recoverCompletion:
            dependencies
              .recoverCompletion,

          resolveCompletionPath:
            dependencies
              .resolveCompletionPath,
        },
      );
  };
}
