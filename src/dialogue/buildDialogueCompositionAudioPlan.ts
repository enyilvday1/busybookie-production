import {
  createHash,
} from "node:crypto";

import type {
  DialoguePlacementPlan,
  DialoguePlacementPlanLine,
} from "./buildDialoguePlacementPlan.js";

import type {
  ShotDialoguePlan,
} from "./buildShotDialoguePlan.js";

export type DialogueCompositionSourceAudioDisposition =
  | "DISCARD_NATIVE_AUDIO"
  | "NO_SOURCE_AUDIO";

export type DialogueCompositionAudioPlan =
  Readonly<{
    schemaVersion:
      "1.0";

    audioMode:
      "REPLACE_SOURCE_WITH_DIALOGUE";

    mixNativeAudio:
      false;

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

    sourceNativeAudio:
      boolean;

    sourceAudioDisposition:
      DialogueCompositionSourceAudioDisposition;

    lines:
      readonly DialoguePlacementPlanLine[];

    audioKey:
      string;
  }>;

export type BuildDialogueCompositionAudioPlanInput =
  Readonly<{
    dialoguePlan:
      ShotDialoguePlan;

    placementPlan:
      DialoguePlacementPlan;
  }>;

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/;

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
      `Dialogue composition audio planning requires positive finite ${label}.`,
    );
  }

  return value;
}

function requireNonNegativeFiniteNumber(
  value:
    number,

  label:
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
      `Dialogue composition audio planning requires finite non-negative ${label}.`,
    );
  }

  return value;
}

function requirePositiveSafeInteger(
  value:
    number,

  label:
    string,
): number {
  if (
    !Number.isSafeInteger(
      value,
    ) ||
    value <=
      0
  ) {
    throw new Error(
      `Dialogue composition audio planning requires positive integer ${label}.`,
    );
  }

  return value;
}

function requireSha256(
  value:
    string,

  dialogueLineId:
    string,
): string {
  const normalized =
    value.trim()
      .toLowerCase();

  if (
    !SHA256_PATTERN.test(
      normalized,
    )
  ) {
    throw new Error(
      `Dialogue composition audio planning requires a valid source SHA-256 for ${dialogueLineId}.`,
    );
  }

  return normalized;
}

function requireNonEmptyString(
  value:
    string,

  label:
    string,
): string {
  const normalized =
    value.trim();

  if (!normalized) {
    throw new Error(
      `Dialogue composition audio planning requires ${label}.`,
    );
  }

  return normalized;
}

function buildAudioIdentity(
  input:
    Readonly<{
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

      sourceNativeAudio:
        boolean;

      sourceAudioDisposition:
        DialogueCompositionSourceAudioDisposition;

      lines:
        readonly DialoguePlacementPlanLine[];
    }>,
): string {
  const canonicalLines =
    input.lines.map(
      (
        line,
      ) => ({
        lineNumber:
          line.lineNumber,

        dialogueLineId:
          line.dialogueLineId,

        sourceBytes:
          line.sourceBytes,

        sourceSha256:
          line.sourceSha256,

        startSeconds:
          line.startSeconds,

        durationSeconds:
          line.durationSeconds,

        endSeconds:
          line.endSeconds,
      }),
    );

  return JSON.stringify({
    schemaVersion:
      "1.0",

    audioMode:
      "REPLACE_SOURCE_WITH_DIALOGUE",

    mixNativeAudio:
      false,

    episodeId:
      input.episodeId,

    sceneId:
      input.sceneId,

    shotId:
      input.shotId,

    dialoguePlanKey:
      input.dialoguePlanKey,

    shotDurationSeconds:
      input.shotDurationSeconds,

    sourceNativeAudio:
      input.sourceNativeAudio,

    sourceAudioDisposition:
      input.sourceAudioDisposition,

    lines:
      canonicalLines,
  });
}

export function buildDialogueCompositionAudioPlan(
  input:
    BuildDialogueCompositionAudioPlanInput,
): DialogueCompositionAudioPlan {
  const {
    dialoguePlan,
    placementPlan,
  } = input;

  if (
    placementPlan.dialoguePlanKey !==
    dialoguePlan.planKey
  ) {
    throw new Error(
      "Dialogue composition audio placement planKey does not match the canonical dialogue plan key.",
    );
  }

  if (
    placementPlan.episodeId !==
      dialoguePlan.episodeId ||
    placementPlan.sceneId !==
      dialoguePlan.sceneId ||
    placementPlan.shotId !==
      dialoguePlan.shotId
  ) {
    throw new Error(
      "Dialogue composition audio placement identity does not match the canonical dialogue plan.",
    );
  }

  const shotDurationSeconds =
    requirePositiveFiniteNumber(
      dialoguePlan.shotDurationSeconds,
      "shot duration",
    );

  if (
    placementPlan.shotDurationSeconds !==
    shotDurationSeconds
  ) {
    throw new Error(
      "Dialogue composition audio placement shot duration does not match the canonical dialogue plan.",
    );
  }

  if (
    placementPlan.schemaVersion !==
      "1.0" ||
    placementPlan.placementMode !==
      "EXPLICIT"
  ) {
    throw new Error(
      "Dialogue composition audio planning requires an explicit placement plan using schema version 1.0.",
    );
  }

  if (
    placementPlan.lines.length !==
    dialoguePlan.lines.length
  ) {
    throw new Error(
      `Dialogue composition audio placement line count does not match the dialogue plan; expected ${dialoguePlan.lines.length}, received ${placementPlan.lines.length}.`,
    );
  }

  const lines:
    DialoguePlacementPlanLine[] =
      [];

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

    const placementLine =
      placementPlan.lines[
        index
      ];

    if (
      !plannedLine ||
      !placementLine
    ) {
      throw new Error(
        `Dialogue composition audio planning could not resolve canonical line index ${index}.`,
      );
    }

    if (
      placementLine.lineNumber !==
        plannedLine.lineNumber ||
      placementLine.dialogueLineId !==
        plannedLine.dialogueLineId
    ) {
      throw new Error(
        `Dialogue composition audio placement identity/order does not match planned line ${plannedLine.dialogueLineId}.`,
      );
    }

    const sourceAudioPath =
      requireNonEmptyString(
        placementLine.sourceAudioPath,
        `source audio path for ${plannedLine.dialogueLineId}`,
      );

    const sourceBytes =
      requirePositiveSafeInteger(
        placementLine.sourceBytes,
        `source byte count for ${plannedLine.dialogueLineId}`,
      );

    const sourceSha256 =
      requireSha256(
        placementLine.sourceSha256,
        plannedLine.dialogueLineId,
      );

    const startSeconds =
      requireNonNegativeFiniteNumber(
        placementLine.startSeconds,
        `start time for ${plannedLine.dialogueLineId}`,
      );

    const durationSeconds =
      requirePositiveFiniteNumber(
        placementLine.durationSeconds,
        `duration for ${plannedLine.dialogueLineId}`,
      );

    const endSeconds =
      requirePositiveFiniteNumber(
        placementLine.endSeconds,
        `end time for ${plannedLine.dialogueLineId}`,
      );

    const calculatedEndSeconds =
      startSeconds +
      durationSeconds;

    if (
      Math.abs(
        calculatedEndSeconds -
        endSeconds,
      ) >
      placementPlan.durationToleranceSeconds
    ) {
      throw new Error(
        `Dialogue composition audio placement end time does not match start plus duration for ${plannedLine.dialogueLineId}.`,
      );
    }

    if (
      endSeconds >
      shotDurationSeconds +
        placementPlan.durationToleranceSeconds
    ) {
      throw new Error(
        `Dialogue composition audio placement for ${plannedLine.dialogueLineId} ends beyond the shot duration.`,
      );
    }

    lines.push(
      Object.freeze({
        lineNumber:
          plannedLine.lineNumber,

        dialogueLineId:
          plannedLine.dialogueLineId,

        sourceAudioPath,

        sourceBytes,

        sourceSha256,

        startSeconds,

        durationSeconds,

        endSeconds:
          endSeconds >
          shotDurationSeconds
            ? shotDurationSeconds
            : endSeconds,
      }),
    );
  }

  const sourceNativeAudio =
    dialoguePlan
      .videoGeneration
      .nativeAudio;

  const sourceAudioDisposition:
    DialogueCompositionSourceAudioDisposition =
      sourceNativeAudio
        ? "DISCARD_NATIVE_AUDIO"
        : "NO_SOURCE_AUDIO";

  const frozenLines =
    Object.freeze([
      ...lines,
    ]);

  const audioIdentity =
    buildAudioIdentity({
      episodeId:
        dialoguePlan.episodeId,

      sceneId:
        dialoguePlan.sceneId,

      shotId:
        dialoguePlan.shotId,

      dialoguePlanKey:
        dialoguePlan.planKey,

      shotDurationSeconds,

      sourceNativeAudio,

      sourceAudioDisposition,

      lines:
        frozenLines,
    });

  const audioKey =
    createHash(
      "sha256",
    )
      .update(
        audioIdentity,
        "utf8",
      )
      .digest(
        "hex",
      );

  return Object.freeze({
    schemaVersion:
      "1.0",

    audioMode:
      "REPLACE_SOURCE_WITH_DIALOGUE",

    mixNativeAudio:
      false,

    episodeId:
      dialoguePlan.episodeId,

    sceneId:
      dialoguePlan.sceneId,

    shotId:
      dialoguePlan.shotId,

    dialoguePlanKey:
      dialoguePlan.planKey,

    shotDurationSeconds,

    sourceNativeAudio,

    sourceAudioDisposition,

    lines:
      frozenLines,

    audioKey,
  });
}
