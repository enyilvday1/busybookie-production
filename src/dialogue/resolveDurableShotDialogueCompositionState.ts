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

import {
  inspectDialogueDirectSeedAudioPlanLifecycles,
} from "./inspectDialogueDirectSeedAudioPlanHistory.js";

import {
  inspectDialogueGenerationAdmissionLedger,
} from "./inspectDialogueGenerationAdmissionLedger.js";

import {
  inspectDialogueLifecycle,
} from "./inspectDialogueLifecycle.js";

import {
  classifyDialogueLineGenerationEvidence,
  inspectDialogueLineActiveWork,
  type DialogueActiveWork,
  type DialogueDurableNamespace,
  type DialogueStalePlanWork,
} from "./inspectDialogueLineGenerationEvidence.js";

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

    inspectAdmissionLedger:
      typeof inspectDialogueGenerationAdmissionLedger;
  }>;

// The line rule types live with the shared read-only eligibility helper.
export type {
  DialogueActiveWork,
  DialogueDurableNamespace,
  DialogueStalePlanWork,
};

// A C6a shared admission whose bound namespace lifecycle is still NOTHING.
// matchesCurrentCanonicalPlan is diagnostic only; it authorizes nothing.
export type DialogueOpenGenerationAdmission =
  Readonly<{
    dialogueLineId: string;
    attemptNumber: number;
    admissionId: string;
    planKey: string;
    generationNamespace: DialogueDurableNamespace;
    matchesCurrentCanonicalPlan: boolean;
  }>;

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
      state: "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED";
      episodeId: string;
      sceneId: string;
      shotId: string;
      openAdmissions: readonly DialogueOpenGenerationAdmission[];
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

      inspectAdmissionLedger:
        inspectDialogueGenerationAdmissionLedger,
    });

function openAdmissionFor(
  admission:
    Readonly<{
      dialogueLineId: string;
      attemptNumber: number;
      admissionId: string;
      planKey: string;
      generationNamespace: DialogueDurableNamespace;
    }>,

  matchesCurrentCanonicalPlan:
    boolean,
): DialogueOpenGenerationAdmission {
  return Object.freeze({
    dialogueLineId:
      admission.dialogueLineId,
    attemptNumber:
      admission.attemptNumber,
    admissionId:
      admission.admissionId,
    planKey:
      admission.planKey,
    generationNamespace:
      admission.generationNamespace,
    matchesCurrentCanonicalPlan,
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

    const openAdmissions:
      DialogueOpenGenerationAdmission[] =
        [];

    for (
      const line
      of planning.lines
    ) {
      activeWork.push(
        ...await inspectDialogueLineActiveWork(
          input.mediaRoot,
          episodeId,
          sceneId,
          shotId,
          line.dialogueLineId,
          dependencies,
        ),
      );

      const ledger =
        await dependencies
          .inspectAdmissionLedger(
            input.mediaRoot,
            episodeId,
            sceneId,
            shotId,
            line.dialogueLineId,
          );

      // No current plan exists, so no open admission can match it.
      if (
        ledger.latest?.attemptState ===
        "PRE_RESERVATION_OPEN"
      ) {
        openAdmissions.push(
          openAdmissionFor(
            ledger.latest.admission,
            false,
          ),
        );
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

    if (
      openAdmissions.length >
      0
    ) {
      return Object.freeze({
        state:
          "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED",
        episodeId,
        sceneId,
        shotId,
        openAdmissions:
          Object.freeze([
            ...openAdmissions,
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

  const openAdmissions:
    DialogueOpenGenerationAdmission[] =
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

    // The shared read-only dual-namespace line rule (also used by the C6a
    // admission gate), then this line's shared admission ledger.
    const evidence =
      await classifyDialogueLineGenerationEvidence(
        {
          mediaRoot:
            input.mediaRoot,
          plan,
          line,
        },
        dependencies,
      );

    staleWork.push(
      ...evidence.staleWork,
    );

    const ledger =
      await dependencies
        .inspectAdmissionLedger(
          input.mediaRoot,
          episodeId,
          sceneId,
          shotId,
          dialogueLineId,
        );

    if (
      ledger.latest?.attemptState ===
      "PRE_RESERVATION_OPEN"
    ) {
      openAdmissions.push(
        openAdmissionFor(
          ledger.latest.admission,
          ledger.latest.admission.planKey ===
            plan.planKey &&
          ledger.latest.admission.generationNamespace ===
            evidence.namespace,
        ),
      );
    }

    switch (
      evidence.lifecycleState
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

  // An open pre-reservation admission must never surface as reconcilable or
  // as needing audio: a new paid attempt is not permitted while it is open.
  if (
    openAdmissions.length >
    0
  ) {
    return Object.freeze({
      state:
        "DIALOGUE_GENERATION_ADMISSION_OPEN_INTERVENTION_REQUIRED",
      episodeId,
      sceneId,
      shotId,
      openAdmissions:
        Object.freeze([
          ...openAdmissions,
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
