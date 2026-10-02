import type {
  DialogueVoicePolicy,
} from "../schemas/dialogueVoicePolicy.schema.js";

import type {
  ShotDialoguePlanLine,
} from "./buildShotDialoguePlan.js";

import {
  assertDialogueWithinBudget,
} from "./dialogueVoiceBudget.js";

import {
  RUNWAY_ELEVEN_V3_MODEL,
  RUNWAY_ELEVEN_V3_PRESET_IDS,
  RunwayElevenV3RequestSchema,
  type RunwayElevenV3PresetId,
  type RunwayElevenV3Request,
} from "./runwayElevenV3Request.schema.js";

export type BuildRunwayElevenV3RequestInput =
  Readonly<{
    line:
      ShotDialoguePlanLine;

    policy:
      DialogueVoicePolicy;
  }>;

const supportedPresetIds:
  ReadonlySet<string> =
    new Set(
      RUNWAY_ELEVEN_V3_PRESET_IDS,
    );

function requireRunwayPresetId(
  voiceName:
    string,
): RunwayElevenV3PresetId {
  if (
    !supportedPresetIds.has(
      voiceName,
    )
  ) {
    throw new Error(
      `Runway Eleven v3 preset voice is not supported by the installed provider contract: ${voiceName}`,
    );
  }

  return voiceName as
    RunwayElevenV3PresetId;
}

export function buildRunwayElevenV3Request(
  input:
    BuildRunwayElevenV3RequestInput,
): RunwayElevenV3Request {
  if (
    input.line.voice.provider !==
    "RUNWAY"
  ) {
    throw new Error(
      `Runway Eleven v3 dialogue request requires RUNWAY voice provider; received ${String(
        input.line.voice.provider,
      )}.`,
    );
  }

  assertDialogueWithinBudget(
    input.line.text,
    input.policy,
  );

  const presetId =
    requireRunwayPresetId(
      input.line.voice
        .voiceName,
    );

  return RunwayElevenV3RequestSchema.parse({
    model:
      RUNWAY_ELEVEN_V3_MODEL,

    promptText:
      input.line.text,

    voice: {
      type:
        "runway-preset",

      presetId,
    },

    applyTextNormalization:
      input.policy.generation
        .applyTextNormalization,

    languageCode:
      input.policy.generation
        .languageCode,

    seed:
      input.policy.generation
        .seed,

    similarityBoost:
      input.policy.generation
        .similarityBoost,

    speed:
      input.policy.generation
        .speed,

    stability:
      input.policy.generation
        .stability,

    style:
      input.policy.generation
        .style,

    useSpeakerBoost:
      input.policy.generation
        .useSpeakerBoost,
  });
}
