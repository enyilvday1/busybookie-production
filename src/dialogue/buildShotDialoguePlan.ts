import {
  createHash,
} from "node:crypto";

import type {
  CharacterBible,
  CharacterId,
} from "../schemas/character.schema.js";

import type {
  Shot,
} from "../schemas/episodeManifest.schema.js";

export type ShotDialoguePresetVoice =
  Readonly<{
    provider:
      "RUNWAY";

    voiceName:
      string;

    deliveryTraits:
      readonly string[];
  }>;

export type ShotDialogueReferenceAudio =
  Readonly<{
    assetId:
      string;

    mediaRootRelativePath:
      string;

    bytes:
      number;

    sha256:
      string;

    contentType:
      string;

    durationSeconds:
      number;

    codecName:
      string;

    sampleRateHz:
      number;

    channels:
      number;
  }>;

export type ShotDialogueReferenceVoice =
  Readonly<{
    selectionStatus:
      "LOCKED";

    provider:
      "RUNWAY";

    voiceName:
      string;

    deliveryTraits:
      readonly string[];

    executionMode:
      "RUNWAY_REFERENCE_AUDIO";

    referenceAudio:
      ShotDialogueReferenceAudio;
  }>;

export type ShotDialoguePlanVoice =
  | ShotDialoguePresetVoice
  | ShotDialogueReferenceVoice;

export type ShotDialoguePlanLine =
  Readonly<{
    lineNumber:
      number;

    dialogueLineId:
      string;

    characterId:
      CharacterId;

    characterName:
      string;

    text:
      string;

    deliveryNotes:
      string | null;

    voice:
      ShotDialoguePlanVoice;
  }>;

export type ShotDialoguePlan =
  Readonly<{
    schemaVersion:
      "1.0" | "2.0";

    episodeId:
      string;

    sceneId:
      string;

    shotId:
      string;

    shotDurationSeconds:
      number;

    videoGeneration:
      Readonly<{
        provider:
          Shot["generation"]["provider"];

        nativeAudio:
          boolean;
      }>;

    lines:
      readonly ShotDialoguePlanLine[];

    planKey:
      string;
  }>;

export type BuildShotDialoguePlanInput =
  Readonly<{
    episodeId:
      string;

    sceneId:
      string;

    shot:
      Shot;

    bible:
      CharacterBible;
  }>;

const EPISODE_ID_PATTERN =
  /^EP[0-9]{2,3}$/;

const SCENE_ID_PATTERN =
  /^SC[0-9]{2,3}$/;

function requireIdentity(
  value:
    string,

  pattern:
    RegExp,

  label:
    string,
): string {
  const normalized =
    value.trim();

  if (
    !pattern.test(
      normalized,
    )
  ) {
    throw new Error(
      `Dialogue generation planning requires a valid ${label}: ${value}`,
    );
  }

  return normalized;
}

export function createDialogueLineId(
  episodeId:
    string,

  sceneId:
    string,

  shotId:
    string,

  lineNumber:
    number,
): string {
  return [
    episodeId,
    sceneId,
    shotId,
    `L${String(
      lineNumber,
    ).padStart(
      2,
      "0",
    )}`,
  ].join(
    "_",
  );
}

function isReferenceAudioVoice(
  voice:
    ShotDialoguePlanVoice,
): voice is ShotDialogueReferenceVoice {
  return (
    "executionMode" in
      voice &&
    voice.executionMode ===
      "RUNWAY_REFERENCE_AUDIO"
  );
}

function buildCanonicalPlanIdentity(
  input:
    Readonly<{
      schemaVersion:
        "1.0" | "2.0";

      episodeId:
        string;

      sceneId:
        string;

      shotId:
        string;

      shotDurationSeconds:
        number;

      videoGeneration:
        Readonly<{
          provider:
            Shot["generation"]["provider"];

          nativeAudio:
            boolean;
        }>;

      lines:
        readonly ShotDialoguePlanLine[];
    }>,
): string {
  return JSON.stringify({
    schemaVersion:
      input.schemaVersion,

    episodeId:
      input.episodeId,

    sceneId:
      input.sceneId,

    shotId:
      input.shotId,

    shotDurationSeconds:
      input.shotDurationSeconds,

    videoGeneration: {
      provider:
        input.videoGeneration
          .provider,

      nativeAudio:
        input.videoGeneration
          .nativeAudio,
    },

    lines:
      input.lines.map(
        (line) => ({
          lineNumber:
            line.lineNumber,

          dialogueLineId:
            line.dialogueLineId,

          characterId:
            line.characterId,

          characterName:
            line.characterName,

          text:
            line.text,

          deliveryNotes:
            line.deliveryNotes,

          voice:
            isReferenceAudioVoice(
              line.voice,
            )
              ? {
                  selectionStatus:
                    line.voice
                      .selectionStatus,

                  provider:
                    line.voice
                      .provider,

                  voiceName:
                    line.voice
                      .voiceName,

                  deliveryTraits: [
                    ...line.voice
                      .deliveryTraits,
                  ],

                  executionMode:
                    line.voice
                      .executionMode,

                  referenceAudio: {
                    assetId:
                      line.voice
                        .referenceAudio
                        .assetId,

                    mediaRootRelativePath:
                      line.voice
                        .referenceAudio
                        .mediaRootRelativePath,

                    bytes:
                      line.voice
                        .referenceAudio
                        .bytes,

                    sha256:
                      line.voice
                        .referenceAudio
                        .sha256,

                    contentType:
                      line.voice
                        .referenceAudio
                        .contentType,

                    durationSeconds:
                      line.voice
                        .referenceAudio
                        .durationSeconds,

                    codecName:
                      line.voice
                        .referenceAudio
                        .codecName,

                    sampleRateHz:
                      line.voice
                        .referenceAudio
                        .sampleRateHz,

                    channels:
                      line.voice
                        .referenceAudio
                        .channels,
                  },
                }
              : {
                  provider:
                    line.voice
                      .provider,

                  voiceName:
                    line.voice
                      .voiceName,

                  deliveryTraits: [
                    ...line.voice
                      .deliveryTraits,
                  ],
                },
        }),
      ),
  });
}

export function buildShotDialoguePlan(
  input:
    BuildShotDialoguePlanInput,
): ShotDialoguePlan {
  const episodeId =
    requireIdentity(
      input.episodeId,
      EPISODE_ID_PATTERN,
      "episode id",
    );

  const sceneId =
    requireIdentity(
      input.sceneId,
      SCENE_ID_PATTERN,
      "scene id",
    );

  if (
    input.shot.dialogue.length ===
    0
  ) {
    throw new Error(
      `${input.shot.id}: dialogue generation planning requires at least one dialogue line.`,
    );
  }

  const registeredCharacters =
    new Map(
      input.bible.characters.map(
        (character) => [
          character.id,
          character,
        ] as const,
      ),
    );

  const lines:
    ShotDialoguePlanLine[] =
      input.shot.dialogue.map(
        (
          dialogue,
          index,
        ) => {
          const character =
            registeredCharacters.get(
              dialogue.characterId,
            );

          if (!character) {
            throw new Error(
              `${input.shot.id}: unknown dialogue character ${dialogue.characterId}.`,
            );
          }

          if (
            character.voice
              .selectionStatus !==
            "LOCKED"
          ) {
            throw new Error(
              `${input.shot.id}: dialogue generation blocked because ${character.name} requires an approved locked voice.`,
            );
          }

          const lineNumber =
            index + 1;

          const deliveryTraits =
            Object.freeze([
              ...character.voice
                .deliveryTraits,
            ]);

          const voice:
            ShotDialoguePlanVoice =
              "executionMode" in
                character.voice &&
              character.voice
                .executionMode ===
                "RUNWAY_REFERENCE_AUDIO"
                ? Object.freeze({
                    selectionStatus:
                      "LOCKED" as const,

                    provider:
                      character.voice
                        .provider,

                    voiceName:
                      character.voice
                        .voiceName,

                    deliveryTraits,

                    executionMode:
                      "RUNWAY_REFERENCE_AUDIO" as const,

                    referenceAudio:
                      Object.freeze({
                        assetId:
                          character.voice
                            .referenceAudio
                            .assetId,

                        mediaRootRelativePath:
                          character.voice
                            .referenceAudio
                            .mediaRootRelativePath,

                        bytes:
                          character.voice
                            .referenceAudio
                            .bytes,

                        sha256:
                          character.voice
                            .referenceAudio
                            .sha256,

                        contentType:
                          character.voice
                            .referenceAudio
                            .contentType,

                        durationSeconds:
                          character.voice
                            .referenceAudio
                            .durationSeconds,

                        codecName:
                          character.voice
                            .referenceAudio
                            .codecName,

                        sampleRateHz:
                          character.voice
                            .referenceAudio
                            .sampleRateHz,

                        channels:
                          character.voice
                            .referenceAudio
                            .channels,
                      }),
                  })
                : Object.freeze({
                    provider:
                      character.voice
                        .provider,

                    voiceName:
                      character.voice
                        .voiceName,

                    deliveryTraits,
                  });

          return Object.freeze({
            lineNumber,

            dialogueLineId:
              createDialogueLineId(
                episodeId,
                sceneId,
                input.shot.id,
                lineNumber,
              ),

            characterId:
              dialogue.characterId,

            characterName:
              character.name,

            text:
              dialogue.text,

            deliveryNotes:
              dialogue.deliveryNotes ??
              null,

            voice,
          });
        },
      );

  const hasReferenceAudioVoice =
    lines.some(
      (line) =>
        isReferenceAudioVoice(
          line.voice,
        ),
    );

  const schemaVersion =
    hasReferenceAudioVoice
      ? "2.0" as const
      : "1.0" as const;

  const planWithoutKey =
    Object.freeze({
      schemaVersion,

      episodeId,

      sceneId,

      shotId:
        input.shot.id,

      shotDurationSeconds:
        input.shot
          .durationSeconds,

      videoGeneration:
        Object.freeze({
          provider:
            input.shot
              .generation
              .provider,

          nativeAudio:
            input.shot
              .generation
              .nativeAudio,
        }),

      lines:
        Object.freeze([
          ...lines,
        ]),
    });

  const planKey =
    createHash(
      "sha256",
    )
      .update(
        buildCanonicalPlanIdentity(
          planWithoutKey,
        ),
        "utf8",
      )
      .digest(
        "hex",
      );

  return Object.freeze({
    ...planWithoutKey,

    planKey,
  });
}
