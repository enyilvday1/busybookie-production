import type {
  ShotDialoguePlan,
} from "./buildShotDialoguePlan.js";

import type {
  VerifiedShotDialogueTiming,
} from "./verifyShotDialogueTiming.js";

export type DialoguePlacementInputLine =
  Readonly<{
    dialogueLineId:
      string;

    startSeconds:
      number;
  }>;

export type BuildDialoguePlacementPlanInput =
  Readonly<{
    dialoguePlan:
      ShotDialoguePlan;

    timing:
      VerifiedShotDialogueTiming;

    placements:
      readonly DialoguePlacementInputLine[];
  }>;

export type DialoguePlacementPlanLine =
  Readonly<{
    lineNumber:
      number;

    dialogueLineId:
      string;

    sourceAudioPath:
      string;

    sourceBytes:
      number;

    sourceSha256:
      string;

    startSeconds:
      number;

    durationSeconds:
      number;

    endSeconds:
      number;
  }>;

export type DialoguePlacementPlan =
  Readonly<{
    schemaVersion:
      "1.0";

    placementMode:
      "EXPLICIT";

    episodeId:
      string;

    sceneId:
      string;

    shotId:
      string;

    dialoguePlanKey:
      string;

    shotDurationSeconds:
      number;

    durationToleranceSeconds:
      number;

    lines:
      readonly DialoguePlacementPlanLine[];
  }>;

function requireFiniteNonNegativeStart(
  value:
    number,

  dialogueLineId:
    string,
): number {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <
      0
  ) {
    throw new Error(
      `Dialogue placement start time for ${dialogueLineId} must be finite and non-negative.`,
    );
  }

  return value;
}

function requirePositiveFiniteNumber(
  value:
    number,

  label:
    string,
): number {
  if (
    !Number.isFinite(
      value,
    ) ||
    value <=
      0
  ) {
    throw new Error(
      `Dialogue placement requires positive finite ${label}.`,
    );
  }

  return value;
}

export function buildDialoguePlacementPlan(
  input:
    BuildDialoguePlacementPlanInput,
): DialoguePlacementPlan {
  const {
    dialoguePlan,
    timing,
    placements,
  } = input;

  if (
    timing.planKey !==
    dialoguePlan.planKey
  ) {
    throw new Error(
      "Dialogue placement timing planKey does not match the canonical dialogue plan key.",
    );
  }

  if (
    timing.episodeId !==
      dialoguePlan.episodeId ||
    timing.sceneId !==
      dialoguePlan.sceneId ||
    timing.shotId !==
      dialoguePlan.shotId
  ) {
    throw new Error(
      "Dialogue placement timing identity does not match the canonical dialogue plan.",
    );
  }

  const shotDurationSeconds =
    requirePositiveFiniteNumber(
      dialoguePlan.shotDurationSeconds,
      "shot duration",
    );

  if (
    timing.shotDurationSeconds !==
    shotDurationSeconds
  ) {
    throw new Error(
      "Dialogue placement timing shot duration does not match the canonical dialogue plan.",
    );
  }

  const durationToleranceSeconds =
    timing.durationToleranceSeconds;

  if (
    !Number.isFinite(
      durationToleranceSeconds,
    ) ||
    durationToleranceSeconds <
      0
  ) {
    throw new Error(
      "Dialogue placement requires a finite non-negative timing duration tolerance.",
    );
  }

  if (
    timing.lines.length !==
    dialoguePlan.lines.length
  ) {
    throw new Error(
      `Dialogue placement timing evidence must cover every planned dialogue line; expected ${dialoguePlan.lines.length}, received ${timing.lines.length}.`,
    );
  }

  if (
    placements.length !==
    dialoguePlan.lines.length
  ) {
    throw new Error(
      `Dialogue placement requires an explicit placement for every planned dialogue line; expected ${dialoguePlan.lines.length}, received ${placements.length}.`,
    );
  }

  const seenDialogueLineIds =
    new Set<string>();

  const lines:
    DialoguePlacementPlanLine[] =
      [];

  let previousEndSeconds:
    number | null =
      null;

  for (
    let index =
      0;
    index <
      dialoguePlan.lines.length;
    index +=
      1
  ) {
    const plannedLine =
      dialoguePlan.lines[
        index
      ];

    const timingLine =
      timing.lines[
        index
      ];

    const placement =
      placements[
        index
      ];

    if (
      !plannedLine ||
      !timingLine ||
      !placement
    ) {
      throw new Error(
        `Dialogue placement could not resolve canonical line index ${index}.`,
      );
    }

    if (
      timingLine.lineNumber !==
        plannedLine.lineNumber ||
      timingLine.dialogueLineId !==
        plannedLine.dialogueLineId
    ) {
      throw new Error(
        `Dialogue placement timing identity/order does not match planned line ${plannedLine.dialogueLineId}.`,
      );
    }

    if (
      seenDialogueLineIds.has(
        placement.dialogueLineId,
      )
    ) {
      throw new Error(
        `Dialogue placement received duplicate line placement for ${placement.dialogueLineId}.`,
      );
    }

    seenDialogueLineIds.add(
      placement.dialogueLineId,
    );

    if (
      placement.dialogueLineId !==
      plannedLine.dialogueLineId
    ) {
      throw new Error(
        `Dialogue placement identity/order does not match planned line ${plannedLine.dialogueLineId}.`,
      );
    }

    const startSeconds =
      requireFiniteNonNegativeStart(
        placement.startSeconds,
        plannedLine.dialogueLineId,
      );

    const durationSeconds =
      requirePositiveFiniteNumber(
        timingLine.durationSeconds,
        `duration for ${plannedLine.dialogueLineId}`,
      );

    if (
      previousEndSeconds !==
        null &&
      startSeconds <
        previousEndSeconds
    ) {
      throw new Error(
        `Dialogue placement overlap detected for ${plannedLine.dialogueLineId}; start ${startSeconds} is before prior line end ${previousEndSeconds}.`,
      );
    }

    const rawEndSeconds =
      startSeconds +
      durationSeconds;

    if (
      !Number.isFinite(
        rawEndSeconds,
      )
    ) {
      throw new Error(
        `Dialogue placement end time is not finite for ${plannedLine.dialogueLineId}.`,
      );
    }

    if (
      rawEndSeconds >
      shotDurationSeconds +
        durationToleranceSeconds
    ) {
      throw new Error(
        `Dialogue placement for ${plannedLine.dialogueLineId} ends beyond shot duration ${shotDurationSeconds} seconds.`,
      );
    }

    const endSeconds =
      rawEndSeconds >
      shotDurationSeconds
        ? shotDurationSeconds
        : rawEndSeconds;

    const line =
      Object.freeze({
        lineNumber:
          plannedLine.lineNumber,

        dialogueLineId:
          plannedLine.dialogueLineId,

        sourceAudioPath:
          timingLine.sourceAudioPath,

        sourceBytes:
          timingLine.sourceBytes,

        sourceSha256:
          timingLine.sourceSha256,

        startSeconds,

        durationSeconds,

        endSeconds,
      });

    lines.push(
      line,
    );

    previousEndSeconds =
      endSeconds;
  }

  return Object.freeze({
    schemaVersion:
      "1.0",

    placementMode:
      "EXPLICIT",

    episodeId:
      dialoguePlan.episodeId,

    sceneId:
      dialoguePlan.sceneId,

    shotId:
      dialoguePlan.shotId,

    dialoguePlanKey:
      dialoguePlan.planKey,

    shotDurationSeconds,

    durationToleranceSeconds,

    lines:
      Object.freeze([
        ...lines,
      ]),
  });
}
