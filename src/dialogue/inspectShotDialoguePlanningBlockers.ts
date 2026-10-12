import type {
  CharacterBible,
  CharacterId,
  CharacterVoice,
} from "../schemas/character.schema.js";

import type {
  Shot,
} from "../schemas/episodeManifest.schema.js";

import {
  createDialogueLineId,
} from "./buildShotDialoguePlan.js";

export type ShotDialoguePlanningLine =
  Readonly<{
    lineNumber:
      number;

    dialogueLineId:
      string;

    characterId:
      CharacterId;
  }>;

export type DialoguePlanningBlocker =
  | Readonly<{
      reason:
        "UNKNOWN_DIALOGUE_CHARACTER";

      lineNumber:
        number;

      dialogueLineId:
        string;

      characterId:
        CharacterId;
    }>
  | Readonly<{
      reason:
        "VOICE_NOT_LOCKED";

      lineNumber:
        number;

      dialogueLineId:
        string;

      characterId:
        CharacterId;

      voiceSelectionStatus:
        Exclude<
          CharacterVoice["selectionStatus"],
          "LOCKED"
        >;
    }>;

export type ShotDialoguePlanningInspection =
  Readonly<{
    lines:
      readonly ShotDialoguePlanningLine[];

    blockers:
      readonly DialoguePlanningBlocker[];
  }>;

export type InspectShotDialoguePlanningBlockersInput =
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

// Typed counterpart of the canonical planner's character and locked-voice
// checks, so callers never classify planner errors by their text.
export function inspectShotDialoguePlanningBlockers(
  input:
    InspectShotDialoguePlanningBlockersInput,
): ShotDialoguePlanningInspection {
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
    ShotDialoguePlanningLine[] =
      [];

  const blockers:
    DialoguePlanningBlocker[] =
      [];

  input.shot.dialogue.forEach(
    (
      dialogue,
      index,
    ) => {
      const lineNumber =
        index + 1;

      const dialogueLineId =
        createDialogueLineId(
          input.episodeId,
          input.sceneId,
          input.shot.id,
          lineNumber,
        );

      const characterId =
        dialogue.characterId;

      lines.push(
        Object.freeze({
          lineNumber,
          dialogueLineId,
          characterId,
        }),
      );

      const character =
        registeredCharacters.get(
          characterId,
        );

      if (!character) {
        blockers.push(
          Object.freeze({
            reason:
              "UNKNOWN_DIALOGUE_CHARACTER",
            lineNumber,
            dialogueLineId,
            characterId,
          }),
        );

        return;
      }

      const voiceSelectionStatus =
        character.voice
          .selectionStatus;

      if (
        voiceSelectionStatus !==
        "LOCKED"
      ) {
        blockers.push(
          Object.freeze({
            reason:
              "VOICE_NOT_LOCKED",
            lineNumber,
            dialogueLineId,
            characterId,
            voiceSelectionStatus,
          }),
        );
      }
    },
  );

  return Object.freeze({
    lines:
      Object.freeze(
        lines,
      ),

    blockers:
      Object.freeze(
        blockers,
      ),
  });
}
