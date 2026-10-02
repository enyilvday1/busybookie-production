import {
  createHash,
} from "node:crypto";

import type {
  DialoguePlacementPlanLine,
} from "../dialogue/buildDialoguePlacementPlan.js";

import type {
  DialogueCompositionAudioPlan,
  DialogueCompositionSourceAudioDisposition,
} from "../dialogue/buildDialogueCompositionAudioPlan.js";

import type {
  ProductionRules,
} from "../schemas/productionRules.schema.js";

import type {
  EpisodeCompositionPlanShot,
} from "./buildEpisodeCompositionPlan.js";

import {
  buildCompositionShotNormalizationPlan,
} from "./buildCompositionShotNormalizationPlan.js";

import type {
  CompositionSourceMediaMetadata,
} from "./probeCompositionSourceMedia.js";

const DIALOGUE_NORMALIZATION_PROFILE_ID =
  "busybookie-master-normalization-v2-dialogue" as const;

const SHA256_PATTERN =
  /^[a-f0-9]{64}$/;

export type DialogueCompositionShotNormalizationPlan =
  Readonly<{
    schemaVersion:
      "2.0";

    profileId:
      typeof DIALOGUE_NORMALIZATION_PROFILE_ID;

    episodeId:
      string;

    sceneId:
      string;

    shotId:
      string;

    sourceVideoPath:
      string;

    sourceSha256:
      string;

    sourceDurationSeconds:
      number;

    targetDurationSeconds:
      number;

    durationToleranceSeconds:
      number;

    durationMode:
      "MANIFEST_LOCKED";

    nativeAudio:
      boolean;

    container:
      "mp4";

    video:
      Readonly<{
        codecName:
          "h264";

        width:
          number;

        height:
          number;

        frameRate:
          number;

        pixelFormat:
          "yuv420p";

        scaleMode:
          "FIT_PAD";
      }>;

    audio:
      Readonly<{
        mode:
          "REPLACE_SOURCE_WITH_DIALOGUE";

        mixNativeAudio:
          false;

        sourceAudioDisposition:
          DialogueCompositionSourceAudioDisposition;

        dialoguePlanKey:
          string;

        audioKey:
          string;

        lines:
          readonly DialoguePlacementPlanLine[];

        codecName:
          "aac";

        sampleRateHz:
          number;

        channels:
          2;

        channelLayout:
          "stereo";
      }>;

    cacheKey:
      string;

    outputPath:
      string;
  }>;

export type BuildDialogueCompositionShotNormalizationPlanInput =
  Readonly<{
    mediaRoot:
      string;

    episodeId:
      string;

    shot:
      EpisodeCompositionPlanShot;

    sourceMedia:
      CompositionSourceMediaMetadata;

    postProduction:
      ProductionRules["postProduction"];

    dialogueAudio:
      DialogueCompositionAudioPlan;
  }>;

function requireSha256(
  value:
    string,

  label:
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
      `Dialogue composition normalization requires a lowercase 64-character ${label}.`,
    );
  }

  return normalized;
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
      `Dialogue composition normalization requires positive integer ${label}.`,
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
      `Dialogue composition normalization requires positive finite ${label}.`,
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
      `Dialogue composition normalization requires finite non-negative ${label}.`,
    );
  }

  return value;
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
      `Dialogue composition normalization requires ${label}.`,
    );
  }

  return normalized;
}

function createPortableOutputPath(
  mediaRoot:
    string,

  episodeId:
    string,

  shotId:
    string,

  cacheKey:
    string,
): string {
  const root =
    mediaRoot.trim()
      .replace(
        /[\\/]+$/u,
        "",
      );

  const separator =
    root.lastIndexOf(
      "\\",
    ) >
    root.lastIndexOf(
      "/",
    )
      ? "\\"
      : "/";

  return [
    root,
    "cache",
    "composition-normalized",
    episodeId,
    shotId,
    `${episodeId}_${shotId}_${cacheKey}.mp4`,
  ].join(
    separator,
  );
}

function validateDialogueLines(
  input:
    Readonly<{
      lines:
        readonly DialoguePlacementPlanLine[];

      shotDurationSeconds:
        number;
    }>,
): readonly DialoguePlacementPlanLine[] {
  if (
    input.lines.length ===
    0
  ) {
    throw new Error(
      "Dialogue composition normalization requires at least one verified dialogue line.",
    );
  }

  const seenIds =
    new Set<string>();

  const lines:
    DialoguePlacementPlanLine[] =
      [];

  for (
    let index =
      0;
    index <
      input.lines.length;
    index +=
      1
  ) {
    const line =
      input.lines[
        index
      ];

    if (!line) {
      throw new Error(
        `Dialogue composition normalization could not resolve dialogue line index ${index}.`,
      );
    }

    const expectedLineNumber =
      index +
      1;

    if (
      !Number.isSafeInteger(
        line.lineNumber,
      ) ||
      line.lineNumber !==
        expectedLineNumber
    ) {
      throw new Error(
        `Dialogue composition normalization requires continuous dialogue line order; expected ${expectedLineNumber}, received ${line.lineNumber}.`,
      );
    }

    const dialogueLineId =
      requireNonEmptyString(
        line.dialogueLineId,
        `dialogue line identity at index ${index}`,
      );

    if (
      seenIds.has(
        dialogueLineId,
      )
    ) {
      throw new Error(
        `Dialogue composition normalization received duplicate dialogue line ${dialogueLineId}.`,
      );
    }

    seenIds.add(
      dialogueLineId,
    );

    const sourceAudioPath =
      requireNonEmptyString(
        line.sourceAudioPath,
        `source audio path for ${dialogueLineId}`,
      );

    const sourceBytes =
      requirePositiveSafeInteger(
        line.sourceBytes,
        `source byte count for ${dialogueLineId}`,
      );

    const sourceSha256 =
      requireSha256(
        line.sourceSha256,
        `source SHA-256 for ${dialogueLineId}`,
      );

    const startSeconds =
      requireNonNegativeFiniteNumber(
        line.startSeconds,
        `start time for ${dialogueLineId}`,
      );

    const durationSeconds =
      requirePositiveFiniteNumber(
        line.durationSeconds,
        `duration for ${dialogueLineId}`,
      );

    const endSeconds =
      requirePositiveFiniteNumber(
        line.endSeconds,
        `end time for ${dialogueLineId}`,
      );

    if (
      endSeconds >
      input.shotDurationSeconds +
        0.000001
    ) {
      throw new Error(
        `Dialogue composition normalization line ${dialogueLineId} ends beyond the shot duration.`,
      );
    }

    lines.push(
      Object.freeze({
        lineNumber:
          line.lineNumber,

        dialogueLineId,

        sourceAudioPath,

        sourceBytes,

        sourceSha256,

        startSeconds,

        durationSeconds,

        endSeconds:
          endSeconds >
          input.shotDurationSeconds
            ? input.shotDurationSeconds
            : endSeconds,
      }),
    );
  }

  return Object.freeze([
    ...lines,
  ]);
}

export function buildDialogueCompositionShotNormalizationPlan(
  input:
    BuildDialogueCompositionShotNormalizationPlanInput,
): DialogueCompositionShotNormalizationPlan {
  /*
   * Reuse the established v1 admission checks for:
   * - portable absolute media root
   * - episode / shot identity
   * - admitted video path and SHA
   * - source duration tolerance
   * - native-audio/source-media consistency
   * - Busybookie 1920x1080 / 25 fps / 48 kHz master contract.
   *
   * The returned v1 cache identity is intentionally discarded.
   */
  const admittedBasePlan =
    buildCompositionShotNormalizationPlan({
      mediaRoot:
        input.mediaRoot,

      episodeId:
        input.episodeId,

      shot:
        input.shot,

      sourceMedia:
        input.sourceMedia,

      postProduction:
        input.postProduction,
    });

  const dialogueAudio =
    input.dialogueAudio;

  if (
    dialogueAudio.schemaVersion !==
      "1.0" ||
    dialogueAudio.audioMode !==
      "REPLACE_SOURCE_WITH_DIALOGUE" ||
    dialogueAudio.mixNativeAudio !==
      false
  ) {
    throw new Error(
      "Dialogue composition normalization requires the v1 REPLACE_SOURCE_WITH_DIALOGUE audio contract with native mixing disabled.",
    );
  }

  if (
    dialogueAudio.episodeId !==
      input.episodeId ||
    dialogueAudio.sceneId !==
      input.shot.sceneId ||
    dialogueAudio.shotId !==
      input.shot.shotId
  ) {
    throw new Error(
      "Dialogue composition normalization dialogue-audio identity does not match the composition shot.",
    );
  }

  if (
    dialogueAudio.shotDurationSeconds !==
    input.shot.durationSeconds
  ) {
    throw new Error(
      "Dialogue composition normalization dialogue-audio shot duration does not match the composition shot.",
    );
  }

  if (
    dialogueAudio.sourceNativeAudio !==
    input.shot.nativeAudio
  ) {
    throw new Error(
      "Dialogue composition normalization source native-audio state does not match the composition shot.",
    );
  }

  const expectedSourceAudioDisposition:
    DialogueCompositionSourceAudioDisposition =
      input.shot.nativeAudio
        ? "DISCARD_NATIVE_AUDIO"
        : "NO_SOURCE_AUDIO";

  if (
    dialogueAudio.sourceAudioDisposition !==
    expectedSourceAudioDisposition
  ) {
    throw new Error(
      "Dialogue composition normalization source-audio disposition does not match the composition shot native-audio state.",
    );
  }

  const dialoguePlanKey =
    requireSha256(
      dialogueAudio.dialoguePlanKey,
      "dialogue plan key",
    );

  const audioKey =
    requireSha256(
      dialogueAudio.audioKey,
      "dialogue audio key",
    );

  const lines =
    validateDialogueLines({
      lines:
        dialogueAudio.lines,

      shotDurationSeconds:
        admittedBasePlan
          .targetDurationSeconds,
    });

  const cacheIdentity =
    [
      DIALOGUE_NORMALIZATION_PROFILE_ID,
      admittedBasePlan.episodeId,
      input.shot.sceneId,
      admittedBasePlan.shotId,
      admittedBasePlan.sourceSha256,
      String(
        admittedBasePlan
          .targetDurationSeconds,
      ),
      audioKey,
      `${admittedBasePlan.video.width}x${admittedBasePlan.video.height}@${admittedBasePlan.video.frameRate}`,
      String(
        admittedBasePlan.audio
          .sampleRateHz,
      ),
    ].join(
      "\n",
    );

  const cacheKey =
    createHash(
      "sha256",
    )
      .update(
        cacheIdentity,
        "utf8",
      )
      .digest(
        "hex",
      );

  const audio =
    Object.freeze({
      mode:
        "REPLACE_SOURCE_WITH_DIALOGUE" as const,

      mixNativeAudio:
        false as const,

      sourceAudioDisposition:
        expectedSourceAudioDisposition,

      dialoguePlanKey,

      audioKey,

      lines,

      codecName:
        "aac" as const,

      sampleRateHz:
        admittedBasePlan.audio
          .sampleRateHz,

      channels:
        2 as const,

      channelLayout:
        "stereo" as const,
    });

  const outputPath =
    createPortableOutputPath(
      input.mediaRoot,
      admittedBasePlan.episodeId,
      admittedBasePlan.shotId,
      cacheKey,
    );

  return Object.freeze({
    schemaVersion:
      "2.0" as const,

    profileId:
      DIALOGUE_NORMALIZATION_PROFILE_ID,

    episodeId:
      admittedBasePlan.episodeId,

    sceneId:
      input.shot.sceneId,

    shotId:
      admittedBasePlan.shotId,

    sourceVideoPath:
      admittedBasePlan
        .sourceVideoPath,

    sourceSha256:
      admittedBasePlan
        .sourceSha256,

    sourceDurationSeconds:
      admittedBasePlan
        .sourceDurationSeconds,

    targetDurationSeconds:
      admittedBasePlan
        .targetDurationSeconds,

    durationToleranceSeconds:
      admittedBasePlan
        .durationToleranceSeconds,

    durationMode:
      "MANIFEST_LOCKED" as const,

    nativeAudio:
      admittedBasePlan
        .nativeAudio,

    container:
      "mp4" as const,

    video:
      admittedBasePlan.video,

    audio,

    cacheKey,

    outputPath,
  });
}
