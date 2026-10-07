import type {
  ShotDialoguePlan,
} from "./buildShotDialoguePlan.js";

import {
  probeDialogueAudio,
  type DialogueAudioMetadata,
} from "./probeDialogueAudio.js";

import {
  verifyCompletedDialogueDirectSeedAudioLineForTiming,
} from "./verifyCompletedDialogueDirectSeedAudioLineForTiming.js";

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

    verifyDirectSeedAudioLine?:
      typeof verifyCompletedDialogueDirectSeedAudioLineForTiming;

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

      verifyDirectSeedAudioLine:
        verifyCompletedDialogueDirectSeedAudioLineForTiming,

      probeAudio:
        probeDialogueAudio,

      verifyTiming:
        verifyShotDialogueTiming,
    });

function usesRunwayReferenceAudio(
  voice:
    ShotDialoguePlan["lines"][number]["voice"],
): boolean {
  return (
    "executionMode" in
      voice &&
    voice.executionMode ===
      "RUNWAY_REFERENCE_AUDIO"
  );
}

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
    let verified:
      VerifiedCompletedDialogueLineForTiming;

    if (
      usesRunwayReferenceAudio(
        line.voice,
      )
    ) {
      const verifyDirectSeedAudioLine =
        dependencies
          .verifyDirectSeedAudioLine;

      if (
        !verifyDirectSeedAudioLine
      ) {
        throw new Error(
          `Dialogue shot timing requires plan-scoped direct SeedAudio timing admission for reference-audio line ${line.dialogueLineId}.`,
        );
      }

      verified =
        await verifyDirectSeedAudioLine({
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

          planKey:
            input.plan.planKey,
        });
    } else {
      verified =
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
    }

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
