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
      Readonly<{
        provider:
          "RUNWAY";

        voiceName:
          string;

        deliveryTraits:
          readonly string[];
      }>;
  }>;

export type ShotDialoguePlan =
  Readonly<{
    schemaVersion:
      "1.0";

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

function createDialogueLineId(
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

function buildCanonicalPlanIdentity(
  input:
    Readonly<{
      schemaVersion:
        "1.0";

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

          voice: {
            provider:
              line.voice.provider,

            voiceName:
              line.voice.voiceName,

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

            voice:
              Object.freeze({
                provider:
                  character.voice
                    .provider,

                voiceName:
                  character.voice
                    .voiceName,

                deliveryTraits:
                  Object.freeze([
                    ...character.voice
                      .deliveryTraits,
                  ]),
              }),
          });
        },
      );

  const planWithoutKey =
    Object.freeze({
      schemaVersion:
        "1.0" as const,

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
