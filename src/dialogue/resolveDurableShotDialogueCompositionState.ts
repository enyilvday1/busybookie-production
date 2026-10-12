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
  inspectDialogueDirectSeedAudioLifecycle,
} from "./inspectDialogueDirectSeedAudioLifecycle.js";

import {
  inspectDialogueDirectSeedAudioPlanHistory,
} from "./inspectDialogueDirectSeedAudioPlanHistory.js";

import {
  inspectDialogueLifecycle,
} from "./inspectDialogueLifecycle.js";

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

    inspectDirectSeedAudioLineLifecycle:
      typeof inspectDialogueDirectSeedAudioLifecycle;

    inspectDirectSeedAudioPlanHistory:
      typeof inspectDialogueDirectSeedAudioPlanHistory;

    readLatestPlacementDecision:
      typeof readLatestDialoguePlacementDecision;

    resolveCompositionAudioPlan:
      typeof resolveDurableDialogueCompositionAudioPlan;
  }>;

export type DialogueStalePlanWork =
  Readonly<{
    dialogueLineId: string;
    planKey: string;
    state: "RESERVED_ONLY" | "SUBMITTED";
  }>;

export type DurableShotDialogueCompositionState =
  | Readonly<{
      state: "NO_DIALOGUE";
      episodeId: string;
      sceneId: string;
      shotId: string;
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

      inspectDirectSeedAudioLineLifecycle:
        inspectDialogueDirectSeedAudioLifecycle,

      inspectDirectSeedAudioPlanHistory:
        inspectDialogueDirectSeedAudioPlanHistory,

      readLatestPlacementDecision:
        readLatestDialoguePlacementDecision,

      resolveCompositionAudioPlan:
        resolveDurableDialogueCompositionAudioPlan,
    });

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

  // Every canonical line and every Direct-SeedAudio history is inspected
  // before any state is chosen, so corruption anywhere always throws.
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

    let lifecycleState:
      "NOTHING" | "RESERVED_ONLY" | "SUBMITTED" | "COMPLETED";

    if (reference) {
      const current =
        await dependencies
          .inspectDirectSeedAudioLineLifecycle(
            input.mediaRoot,
            episodeId,
            sceneId,
            shotId,
            dialogueLineId,
            plan.planKey,
          );

      // Old-plan active work is outside the current plan directory and
      // outside dialogue:reconcile; it must never read as missing audio.
      const history =
        await dependencies
          .inspectDirectSeedAudioPlanHistory(
            input.mediaRoot,
            episodeId,
            sceneId,
            shotId,
            dialogueLineId,
            plan.planKey,
          );

      for (
        const historical
        of history
      ) {
        if (
          historical.lifecycle.state ===
            "RESERVED_ONLY" ||
          historical.lifecycle.state ===
            "SUBMITTED"
        ) {
          staleWork.push(
            Object.freeze({
              dialogueLineId,
              planKey:
                historical.planKey,
              state:
                historical.lifecycle.state,
            }),
          );
        }
      }

      lifecycleState =
        current.state;
    } else {
      const current =
        await dependencies
          .inspectLineLifecycle(
            input.mediaRoot,
            episodeId,
            sceneId,
            shotId,
            dialogueLineId,
          );

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
