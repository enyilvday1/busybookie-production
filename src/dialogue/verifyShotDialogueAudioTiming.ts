import type {
  ShotDialoguePlan,
} from "./buildShotDialoguePlan.js";

import {
  probeDialogueAudio,
  type DialogueAudioMetadata,
} from "./probeDialogueAudio.js";

import {
  verifyCompletedDialogueLineForTiming,
  type VerifiedCompletedDialogueLineForTiming,
} from "./verifyCompletedDialogueLineForTiming.js";

import {
  verifyShotDialogueTiming,
  type ShotDialogueTimingLineEvidence,
  type VerifiedShotDialogueTiming,
} from "./verifyShotDialogueTiming.js";

export type VerifyShotDialogueAudioTimingInput =
  Readonly<{
    mediaRoot:
      string;

    ffprobeExecutable:
      string;

    plan:
      ShotDialoguePlan;
  }>;

export type VerifyShotDialogueAudioTimingDependencies =
  Readonly<{
    verifyLine:
      typeof verifyCompletedDialogueLineForTiming;

    probeAudio:
      typeof probeDialogueAudio;

    verifyTiming:
      typeof verifyShotDialogueTiming;
  }>;

const defaultDependencies:
  VerifyShotDialogueAudioTimingDependencies =
    Object.freeze({
      verifyLine:
        verifyCompletedDialogueLineForTiming,

      probeAudio:
        probeDialogueAudio,

      verifyTiming:
        verifyShotDialogueTiming,
    });

export async function verifyShotDialogueAudioTiming(
  input:
    VerifyShotDialogueAudioTimingInput,

  dependencies:
    VerifyShotDialogueAudioTimingDependencies =
      defaultDependencies,
): Promise<
  VerifiedShotDialogueTiming
> {
  const evidence:
    ShotDialogueTimingLineEvidence[] =
      [];

  for (
    const line
    of input.plan.lines
  ) {
    const verified:
      VerifiedCompletedDialogueLineForTiming =
        await dependencies
          .verifyLine({
            mediaRoot:
              input.mediaRoot,

            episodeId:
              input.plan.episodeId,

            sceneId:
              input.plan.sceneId,

            shotId:
              input.plan.shotId,

            dialogueLineId:
              line.dialogueLineId,
          });

    const audio:
      DialogueAudioMetadata =
        await dependencies
          .probeAudio({
            ffprobeExecutable:
              input.ffprobeExecutable,

            sourceAudioPath:
              verified
                .output
                .destinationPath,
          });

    evidence.push(
      Object.freeze({
        verified,
        audio,
      }),
    );
  }

  return dependencies
    .verifyTiming({
      plan:
        input.plan,

      lines:
        Object.freeze([
          ...evidence,
        ]),
    });
}
