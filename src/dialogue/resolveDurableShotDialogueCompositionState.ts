import type {
  CharacterBible,
} from "../schemas/character.schema.js";

import type {
  EpisodeManifest,
} from "../schemas/episodeManifest.schema.js";

import type {
  DialogueCompositionAudioPlan,
} from "./buildDialogueCompositionAudioPlan.js";

import {
  buildShotDialoguePlan,
} from "./buildShotDialoguePlan.js";

import type {
  DialogueLifecycleClassification,
} from "./classifyDialogueLifecycle.js";

import {
  inspectDialogueDirectSeedAudioPlanLifecycles,
  type DialogueDirectSeedAudioPlanLifecycle,
} from "./inspectDialogueDirectSeedAudioPlanHistory.js";

import {
  inspectDialogueLifecycle,
} from "./inspectDialogueLifecycle.js";

import {
  inspectShotDialoguePlanningBlockers,
  type DialoguePlanningBlocker,
} from "./inspectShotDialoguePlanningBlockers.js";

import {
  readLatestDialoguePlacementDecision,
} from "./readDialoguePlacementDecision.js";

import {
  resolveDurableDialogueCompositionAudioPlan,
} from "./resolveDurableDialogueCompositionAudioPlan.js";

export type ResolveDurableShotDialogueCompositionStateInput =
  Readonly<{
    episode: EpisodeManifest;
    shotId: string;
    bible: CharacterBible;
    mediaRoot: string;
    ffprobeExecutable: string;
  }>;

export type ResolveDurableShotDialogueCompositionStateDependencies =
  Readonly<{
    inspectLineLifecycle:
      typeof inspectDialogueLifecycle;

    inspectDirectSeedAudioPlanLifecycles:
      typeof inspectDialogueDirectSeedAudioPlanLifecycles;

    readLatestPlacementDecision:
      typeof readLatestDialoguePlacementDecision;

    resolveCompositionAudioPlan:
      typeof resolveDurableDialogueCompositionAudioPlan;
  }>;

export type DialogueDurableNamespace =
  | "LINE_SCOPED"
  | "DIRECT_SEED_AUDIO";

export type DialogueActiveWork =
  Readonly<{
    dialogueLineId: string;
    namespace: DialogueDurableNamespace;
    planKey: string;
    state: "RESERVED_ONLY" | "SUBMITTED";
  }>;

export type DialogueStalePlanWork =
  DialogueActiveWork;

export type DurableShotDialogueCompositionState =
  | Readonly<{
      state: "NO_DIALOGUE";
      episodeId: string;
      sceneId: string;
      shotId: string;
    }>
  | Readonly<{
      state: "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED";
      episodeId: string;
      sceneId: string;
      shotId: string;
      blockers: readonly DialoguePlanningBlocker[];
      activeWork: readonly DialogueActiveWork[];
    }>
  | Readonly<{
      state: "DIALOGUE_PLANNING_BLOCKED";
      episodeId: string;
      sceneId: string;
      shotId: string;
      blockers: readonly DialoguePlanningBlocker[];
    }>
  | Readonly<{
      state: "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED";
      episodeId: string;
      sceneId: string;
      shotId: string;
      dialoguePlanKey: string;
      staleWork: readonly DialogueStalePlanWork[];
      reservedLineIds: readonly string[];
      submittedLineIds: readonly string[];
      missingLineIds: readonly string[];
    }>
  | Readonly<{
      state: "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED";
      episodeId: string;
      sceneId: string;
      shotId: string;
      dialoguePlanKey: string;
      reservedLineIds: readonly string[];
      submittedLineIds: readonly string[];
      missingLineIds: readonly string[];
    }>
  | Readonly<{
      state: "DIALOGUE_RECONCILIATION_REQUIRED";
      episodeId: string;
      sceneId: string;
      shotId: string;
      dialoguePlanKey: string;
      submittedLineIds: readonly string[];
      missingLineIds: readonly string[];
    }>
  | Readonly<{
      state: "DIALOGUE_AUDIO_REQUIRED";
      episodeId: string;
      sceneId: string;
      shotId: string;
      dialoguePlanKey: string;
      missingLineIds: readonly string[];
    }>
  | Readonly<{
      state: "PLACEMENT_REQUIRED";
      episodeId: string;
      sceneId: string;
      shotId: string;
      dialoguePlanKey: string;
    }>
  | Readonly<{
      state: "COMPOSITION_AUDIO_RESOLVED";
      episodeId: string;
      sceneId: string;
      shotId: string;
      dialoguePlanKey: string;
      audioPlan: DialogueCompositionAudioPlan;
    }>;

// Every default only reads durable evidence; B2d additionally performs a
// local read-only ffprobe measurement.
const defaultDependencies:
  ResolveDurableShotDialogueCompositionStateDependencies =
    Object.freeze({
      inspectLineLifecycle:
        inspectDialogueLifecycle,

      inspectDirectSeedAudioPlanLifecycles:
        inspectDialogueDirectSeedAudioPlanLifecycles,

      readLatestPlacementDecision:
        readLatestDialoguePlacementDecision,

      resolveCompositionAudioPlan:
        resolveDurableDialogueCompositionAudioPlan,
    });

type LineEvidence =
  Readonly<{
    lineScoped:
      DialogueLifecycleClassification;

    directSeedAudioPlans:
      readonly DialogueDirectSeedAudioPlanLifecycle[];
  }>;

// Both durable namespaces of one canonical line; every error propagates.
async function inspectLineEvidence(
  dependencies:
    ResolveDurableShotDialogueCompositionStateDependencies,

  mediaRoot:
    string,

  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,

  dialogueLineId:
    string,
): Promise<LineEvidence> {
  const lineScoped =
    await dependencies
      .inspectLineLifecycle(
        mediaRoot,
        episodeId,
        sceneId,
        shotId,
        dialogueLineId,
      );

  const directSeedAudioPlans =
    await dependencies
      .inspectDirectSeedAudioPlanLifecycles(
        mediaRoot,
        episodeId,
        sceneId,
        shotId,
        dialogueLineId,
      );

  return {
    lineScoped,
    directSeedAudioPlans,
  };
}

function activeLineScopedWork(
  dialogueLineId:
    string,

  lifecycle:
    DialogueLifecycleClassification,
): DialogueActiveWork | null {
  if (
    lifecycle.state !==
      "RESERVED_ONLY" &&
    lifecycle.state !==
      "SUBMITTED"
  ) {
    return null;
  }

  return Object.freeze({
    dialogueLineId,
    namespace:
      "LINE_SCOPED",
    planKey:
      lifecycle.reservation.planKey,
    state:
      lifecycle.state,
  });
}

function activeDirectSeedAudioWork(
  dialogueLineId:
    string,

  plan:
    DialogueDirectSeedAudioPlanLifecycle,
): DialogueActiveWork | null {
  if (
    plan.lifecycle.state !==
      "RESERVED_ONLY" &&
    plan.lifecycle.state !==
      "SUBMITTED"
  ) {
    return null;
  }

  return Object.freeze({
    dialogueLineId,
    namespace:
      "DIRECT_SEED_AUDIO",
    planKey:
      plan.planKey,
    state:
      plan.lifecycle.state,
  });
}

export async function resolveDurableShotDialogueCompositionState(
  input:
    ResolveDurableShotDialogueCompositionStateInput,

  dependencies:
    ResolveDurableShotDialogueCompositionStateDependencies =
      defaultDependencies,
): Promise<DurableShotDialogueCompositionState> {
  const episodeId =
    input.episode.episodeId;

  const shotId =
    input.shotId;

  // The episode is the only shot authority: callers name a shot, they never
  // supply its content.
  const matches =
    input.episode.scenes.flatMap(
      (scene) =>
        scene.shots
          .filter(
            (shot) =>
              shot.id ===
              shotId,
          )
          .map(
            (shot) => ({
              scene,
              shot,
            }),
          ),
    );

  const [
    match,
  ] = matches;

  if (
    match ===
    undefined
  ) {
    throw new Error(
      `Shot ${shotId} was not found in episode ${episodeId}.`,
    );
  }

  if (
    matches.length >
    1
  ) {
    throw new Error(
      `Shot ${shotId} appears in more than one scene of episode ${episodeId}.`,
    );
  }

  const canonicalScene =
    match.scene;

  const canonicalShot =
    match.shot;

  const sceneId =
    canonicalScene.id;

  if (
    canonicalShot.dialogue.length ===
    0
  ) {
    return Object.freeze({
      state:
        "NO_DIALOGUE",
      episodeId,
      sceneId,
      shotId,
    });
  }

  // Typed planning blockers; the planner's own errors are never classified.
  const planning =
    inspectShotDialoguePlanningBlockers({
      episodeId,
      sceneId,
      shot:
        canonicalShot,
      bible:
        input.bible,
    });

  if (
    planning.blockers.length >
    0
  ) {
    // No current plan exists, so every namespace of every canonical line is
    // treated as possible paid work before the blocker may be reported.
    const activeWork:
      DialogueActiveWork[] =
        [];

    for (
      const line
      of planning.lines
    ) {
      const evidence =
        await inspectLineEvidence(
          dependencies,
          input.mediaRoot,
          episodeId,
          sceneId,
          shotId,
          line.dialogueLineId,
        );

      const lineScopedWork =
        activeLineScopedWork(
          line.dialogueLineId,
          evidence.lineScoped,
        );

      if (lineScopedWork) {
        activeWork.push(
          lineScopedWork,
        );
      }

      for (
        const plan
        of evidence.directSeedAudioPlans
      ) {
        const planWork =
          activeDirectSeedAudioWork(
            line.dialogueLineId,
            plan,
          );

        if (planWork) {
          activeWork.push(
            planWork,
          );
        }
      }
    }

    if (
      activeWork.length >
      0
    ) {
      return Object.freeze({
        state:
          "DIALOGUE_PLANNING_BLOCKED_ACTIVE_WORK_INTERVENTION_REQUIRED",
        episodeId,
        sceneId,
        shotId,
        blockers:
          planning.blockers,
        activeWork:
          Object.freeze([
            ...activeWork,
          ]),
      });
    }

    return Object.freeze({
      state:
        "DIALOGUE_PLANNING_BLOCKED",
      episodeId,
      sceneId,
      shotId,
      blockers:
        planning.blockers,
    });
  }

  const plan =
    buildShotDialoguePlan({
      episodeId,
      sceneId,
      shot:
        canonicalShot,
      bible:
        input.bible,
    });

  const staleWork:
    DialogueStalePlanWork[] =
      [];

  const reservedLineIds:
    string[] =
      [];

  const submittedLineIds:
    string[] =
      [];

  const missingLineIds:
    string[] =
      [];

  // Every canonical line and both durable namespaces are inspected before
  // any state is chosen, so corruption anywhere always throws.
  for (
    const line
    of plan.lines
  ) {
    const {
      dialogueLineId,
    } = line;

    const reference =
      "executionMode" in
        line.voice &&
      line.voice.executionMode ===
        "RUNWAY_REFERENCE_AUDIO";

    const evidence =
      await inspectLineEvidence(
        dependencies,
        input.mediaRoot,
        episodeId,
        sceneId,
        shotId,
        dialogueLineId,
      );

    let lifecycleState:
      DialogueLifecycleClassification["state"];

    if (reference) {
      // The current Direct-SeedAudio plan is the current lifecycle; line-scoped
      // evidence and every other plan are outside the current plan context.
      const lineScopedWork =
        activeLineScopedWork(
          dialogueLineId,
          evidence.lineScoped,
        );

      if (lineScopedWork) {
        staleWork.push(
          lineScopedWork,
        );
      }

      lifecycleState =
        "NOTHING";

      for (
        const directSeedAudioPlan
        of evidence.directSeedAudioPlans
      ) {
        if (
          directSeedAudioPlan.planKey ===
          plan.planKey
        ) {
          lifecycleState =
            directSeedAudioPlan.lifecycle.state;

          continue;
        }

        const planWork =
          activeDirectSeedAudioWork(
            dialogueLineId,
            directSeedAudioPlan,
          );

        if (planWork) {
          staleWork.push(
            planWork,
          );
        }
      }
    } else {
      const current =
        evidence.lineScoped;

      if (
        current.state !==
          "NOTHING" &&
        current.reservation.planKey !==
          plan.planKey
      ) {
        throw new Error(
          `Dialogue lifecycle evidence for ${dialogueLineId} belongs to dialogue plan ${current.reservation.planKey}, not current canonical plan ${plan.planKey}.`,
        );
      }

      lifecycleState =
        current.state;

      // Direct-SeedAudio work cannot belong to a line-scoped current plan.
      for (
        const directSeedAudioPlan
        of evidence.directSeedAudioPlans
      ) {
        const planWork =
          activeDirectSeedAudioWork(
            dialogueLineId,
            directSeedAudioPlan,
          );

        if (planWork) {
          staleWork.push(
            planWork,
          );
        }
      }
    }

    switch (
      lifecycleState
    ) {
      case "NOTHING":
        missingLineIds.push(
          dialogueLineId,
        );
        break;

      case "RESERVED_ONLY":
        reservedLineIds.push(
          dialogueLineId,
        );
        break;

      case "SUBMITTED":
        submittedLineIds.push(
          dialogueLineId,
        );
        break;

      case "COMPLETED":
        break;
    }
  }

  const dialoguePlanKey =
    plan.planKey;

  if (
    staleWork.length >
    0
  ) {
    return Object.freeze({
      state:
        "DIALOGUE_STALE_PLAN_INTERVENTION_REQUIRED",
      episodeId,
      sceneId,
      shotId,
      dialoguePlanKey,
      staleWork:
        Object.freeze([
          ...staleWork,
        ]),
      reservedLineIds:
        Object.freeze([
          ...reservedLineIds,
        ]),
      submittedLineIds:
        Object.freeze([
          ...submittedLineIds,
        ]),
      missingLineIds:
        Object.freeze([
          ...missingLineIds,
        ]),
    });
  }

  if (
    reservedLineIds.length >
    0
  ) {
    return Object.freeze({
      state:
        "DIALOGUE_RESERVED_ONLY_INTERVENTION_REQUIRED",
      episodeId,
      sceneId,
      shotId,
      dialoguePlanKey,
      reservedLineIds:
        Object.freeze([
          ...reservedLineIds,
        ]),
      submittedLineIds:
        Object.freeze([
          ...submittedLineIds,
        ]),
      missingLineIds:
        Object.freeze([
          ...missingLineIds,
        ]),
    });
  }

  if (
    submittedLineIds.length >
    0
  ) {
    return Object.freeze({
      state:
        "DIALOGUE_RECONCILIATION_REQUIRED",
      episodeId,
      sceneId,
      shotId,
      dialoguePlanKey,
      submittedLineIds:
        Object.freeze([
          ...submittedLineIds,
        ]),
      missingLineIds:
        Object.freeze([
          ...missingLineIds,
        ]),
    });
  }

  // The only state that admits later consideration of paid generation.
  if (
    missingLineIds.length >
    0
  ) {
    return Object.freeze({
      state:
        "DIALOGUE_AUDIO_REQUIRED",
      episodeId,
      sceneId,
      shotId,
      dialoguePlanKey,
      missingLineIds:
        Object.freeze([
          ...missingLineIds,
        ]),
    });
  }

  const decision =
    await dependencies
      .readLatestPlacementDecision(
        input.mediaRoot,
        episodeId,
        sceneId,
        shotId,
      );

  // dialogue:place verifies current audio for both voice modes before any
  // decision can exist, so absence needs no re-hash here.
  if (
    decision ===
    null
  ) {
    return Object.freeze({
      state:
        "PLACEMENT_REQUIRED",
      episodeId,
      sceneId,
      shotId,
      dialoguePlanKey,
    });
  }

  // B2d re-reads the decision and remains the final current-plan
  // composition-audio authority; every failure propagates unchanged.
  const audioPlan =
    await dependencies
      .resolveCompositionAudioPlan({
        mediaRoot:
          input.mediaRoot,
        ffprobeExecutable:
          input.ffprobeExecutable,
        dialoguePlan:
          plan,
      });

  return Object.freeze({
    state:
      "COMPOSITION_AUDIO_RESOLVED",
    episodeId,
    sceneId,
    shotId,
    dialoguePlanKey,
    audioPlan,
  });
}
