import type {
  ShotDialoguePlan,
  ShotDialoguePlanLine,
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

// The single read-only dual-namespace line rule, shared by C3 state
// resolution and the C6a paid-generation admission gate. It reads only
// namespace lifecycle evidence, never the shared admission ledger, so an
// admitting process can never see its own admission as foreign work.

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

export type DialogueLineGenerationEvidenceDependencies =
  Readonly<{
    inspectLineLifecycle:
      typeof inspectDialogueLifecycle;

    inspectDirectSeedAudioPlanLifecycles:
      typeof inspectDialogueDirectSeedAudioPlanLifecycles;
  }>;

export type DialogueLineGenerationEvidence =
  Readonly<{
    dialogueLineId: string;
    namespace: DialogueDurableNamespace;
    lifecycleState: DialogueLifecycleClassification["state"];
    staleWork: readonly DialogueStalePlanWork[];
  }>;

const defaultDependencies:
  DialogueLineGenerationEvidenceDependencies =
    Object.freeze({
      inspectLineLifecycle:
        inspectDialogueLifecycle,

      inspectDirectSeedAudioPlanLifecycles:
        inspectDialogueDirectSeedAudioPlanLifecycles,
    });

type LineEvidence =
  Readonly<{
    lineScoped:
      DialogueLifecycleClassification;

    directSeedAudioPlans:
      readonly DialogueDirectSeedAudioPlanLifecycle[];
  }>;

// The namespace a canonical line's current plan executes in.
export function dialogueLineGenerationNamespace(
  line:
    ShotDialoguePlanLine,
): DialogueDurableNamespace {
  return "executionMode" in
      line.voice &&
    line.voice.executionMode ===
      "RUNWAY_REFERENCE_AUDIO"
    ? "DIRECT_SEED_AUDIO"
    : "LINE_SCOPED";
}

// Both durable namespaces of one canonical line; every error propagates.
async function inspectLineEvidence(
  dependencies:
    DialogueLineGenerationEvidenceDependencies,

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

// Without a current plan, every namespace of the line is treated as possible
// paid work: line-scoped first, then every Direct-SeedAudio plan in order.
export async function inspectDialogueLineActiveWork(
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

  dependencies:
    DialogueLineGenerationEvidenceDependencies =
      defaultDependencies,
): Promise<readonly DialogueActiveWork[]> {
  const evidence =
    await inspectLineEvidence(
      dependencies,
      mediaRoot,
      episodeId,
      sceneId,
      shotId,
      dialogueLineId,
    );

  const activeWork:
    DialogueActiveWork[] =
      [];

  const lineScopedWork =
    activeLineScopedWork(
      dialogueLineId,
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
        dialogueLineId,
        plan,
      );

    if (planWork) {
      activeWork.push(
        planWork,
      );
    }
  }

  return Object.freeze(
    activeWork,
  );
}

// Current-plan lifecycle plus every piece of active work outside the
// current plan context, for one canonical line of the current plan.
export async function classifyDialogueLineGenerationEvidence(
  input:
    Readonly<{
      mediaRoot: string;
      plan: ShotDialoguePlan;
      line: ShotDialoguePlanLine;
    }>,

  dependencies:
    DialogueLineGenerationEvidenceDependencies =
      defaultDependencies,
): Promise<DialogueLineGenerationEvidence> {
  const {
    plan,
    line,
  } = input;

  const {
    dialogueLineId,
  } = line;

  const namespace =
    dialogueLineGenerationNamespace(
      line,
    );

  const evidence =
    await inspectLineEvidence(
      dependencies,
      input.mediaRoot,
      plan.episodeId,
      plan.sceneId,
      plan.shotId,
      dialogueLineId,
    );

  const staleWork:
    DialogueStalePlanWork[] =
      [];

  let lifecycleState:
    DialogueLifecycleClassification["state"];

  if (
    namespace ===
    "DIRECT_SEED_AUDIO"
  ) {
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

  return Object.freeze({
    dialogueLineId,
    namespace,
    lifecycleState,
    staleWork:
      Object.freeze(
        staleWork,
      ),
  });
}

// Paid generation may only start from a current-plan NOTHING with no active
// work anywhere else for the line.
export function isDialogueLineGenerationEligible(
  evidence:
    DialogueLineGenerationEvidence,
): boolean {
  return (
    evidence.lifecycleState ===
      "NOTHING" &&
    evidence.staleWork.length ===
      0
  );
}
