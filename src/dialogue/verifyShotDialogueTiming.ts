import type {
  ShotDialoguePlan,
} from "./buildShotDialoguePlan.js";

import type {
  DialogueAudioMetadata,
} from "./probeDialogueAudio.js";

import type {
  VerifiedCompletedDialogueLineForTiming,
} from "./verifyCompletedDialogueLineForTiming.js";

const DURATION_TOLERANCE_SECONDS =
  0.000001;

export type ShotDialogueTimingLineEvidence =
  Readonly<{
    verified:
      VerifiedCompletedDialogueLineForTiming;

    audio:
      DialogueAudioMetadata;
  }>;

export type VerifyShotDialogueTimingInput =
  Readonly<{
    plan:
      ShotDialoguePlan;

    lines:
      readonly ShotDialogueTimingLineEvidence[];
  }>;

export type VerifiedShotDialogueTimingLine =
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

    durationSeconds:
      number;
  }>;

export type VerifiedShotDialogueTiming =
  Readonly<{
    schemaVersion:
      "1.0";

    timingMode:
      "AGGREGATE_ONLY";

    episodeId:
      string;

    sceneId:
      string;

    shotId:
      string;

    planKey:
      string;

    shotDurationSeconds:
      number;

    durationToleranceSeconds:
      typeof DURATION_TOLERANCE_SECONDS;

    totalSpeechDurationSeconds:
      number;

    remainingDurationSeconds:
      number;

    lines:
      readonly VerifiedShotDialogueTimingLine[];
  }>;

function requirePositiveFiniteDuration(
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
      `${label} must be a positive finite duration.`,
    );
  }

  return value;
}

export function verifyShotDialogueTiming(
  input:
    VerifyShotDialogueTimingInput,
): VerifiedShotDialogueTiming {
  const shotDurationSeconds =
    requirePositiveFiniteDuration(
      input.plan
        .shotDurationSeconds,
      "Dialogue shot duration",
    );

  if (
    input.lines.length !==
    input.plan.lines.length
  ) {
    throw new Error(
      `Dialogue timing requires evidence for every planned dialogue line; expected ${input.plan.lines.length}, received ${input.lines.length}.`,
    );
  }

  const seenDialogueLineIds =
    new Set<string>();

  const timingLines:
    VerifiedShotDialogueTimingLine[] =
      [];

  let totalSpeechDurationSeconds =
    0;

  input.plan.lines.forEach(
    (
      plannedLine,
      arrayIndex,
    ) => {
      const evidence =
        input.lines[
          arrayIndex
        ];

      if (!evidence) {
        throw new Error(
          `Dialogue timing evidence is missing for planned line ${plannedLine.dialogueLineId}.`,
        );
      }

      const generationPlan =
        evidence
          .verified
          .generationRecord
          .plan;

      if (
        seenDialogueLineIds.has(
          generationPlan
            .dialogueLineId,
        )
      ) {
        throw new Error(
          `Dialogue timing received duplicate line evidence for ${generationPlan.dialogueLineId}.`,
        );
      }

      seenDialogueLineIds.add(
        generationPlan
          .dialogueLineId,
      );

      if (
        generationPlan.planKey !==
        input.plan.planKey
      ) {
        throw new Error(
          `Dialogue timing evidence planKey does not match the canonical shot dialogue plan for ${plannedLine.dialogueLineId}.`,
        );
      }

      if (
        generationPlan.episodeId !==
          input.plan.episodeId ||
        generationPlan.sceneId !==
          input.plan.sceneId ||
        generationPlan.shotId !==
          input.plan.shotId ||
        generationPlan.lineNumber !==
          plannedLine.lineNumber ||
        generationPlan.dialogueLineId !==
          plannedLine.dialogueLineId
      ) {
        throw new Error(
          `Dialogue timing evidence identity/order does not match canonical planned line ${plannedLine.dialogueLineId}.`,
        );
      }

      const admittedOutput =
        evidence
          .verified
          .output;

      if (
        evidence.audio
          .sourceAudioPath !==
        admittedOutput
          .destinationPath
      ) {
        throw new Error(
          `Dialogue timing audio path does not match the admitted verified audio artifact for ${plannedLine.dialogueLineId}.`,
        );
      }

      const durationSeconds =
        requirePositiveFiniteDuration(
          evidence.audio
            .durationSeconds,
          `Dialogue line ${plannedLine.dialogueLineId} duration`,
        );

      totalSpeechDurationSeconds +=
        durationSeconds;

      timingLines.push(
        Object.freeze({
          lineNumber:
            plannedLine.lineNumber,

          dialogueLineId:
            plannedLine
              .dialogueLineId,

          sourceAudioPath:
            admittedOutput
              .destinationPath,

          sourceBytes:
            admittedOutput
              .bytes,

          sourceSha256:
            admittedOutput
              .sha256,

          durationSeconds,
        }),
      );
    },
  );

  if (
    totalSpeechDurationSeconds >
    shotDurationSeconds +
      DURATION_TOLERANCE_SECONDS
  ) {
    throw new Error(
      `Aggregate dialogue speech duration ${totalSpeechDurationSeconds} seconds exceeds shot duration ${shotDurationSeconds} seconds for ${input.plan.episodeId}/${input.plan.sceneId}/${input.plan.shotId}.`,
    );
  }

  const remainingDurationSeconds =
    Math.max(
      0,
      shotDurationSeconds -
        totalSpeechDurationSeconds,
    );

  return Object.freeze({
    schemaVersion:
      "1.0",

    timingMode:
      "AGGREGATE_ONLY",

    episodeId:
      input.plan.episodeId,

    sceneId:
      input.plan.sceneId,

    shotId:
      input.plan.shotId,

    planKey:
      input.plan.planKey,

    shotDurationSeconds,

    durationToleranceSeconds:
      DURATION_TOLERANCE_SECONDS,

    totalSpeechDurationSeconds,

    remainingDurationSeconds,

    lines:
      Object.freeze([
        ...timingLines,
      ]),
  });
}
