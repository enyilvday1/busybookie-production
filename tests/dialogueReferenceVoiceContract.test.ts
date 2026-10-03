import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CharacterVoiceSchema,
} from "../src/schemas/character.schema.js";

import {
  buildShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

const OLLIE_REFERENCE_SHA256 =
  "ad7bc6a50675bddc74a4885f290667fad1076c5cd3d9844eb7ff2d84b0f94a2f";

function createOllieReferenceVoice(
  sha256:
    string = OLLIE_REFERENCE_SHA256,
) {
  return {
    selectionStatus:
      "LOCKED" as const,

    provider:
      "RUNWAY" as const,

    voiceName:
      "Ollie",

    deliveryTraits: [
      "young",
      "curious",
      "warm",
      "friendly",
      "natural",
    ],

    executionMode:
      "RUNWAY_REFERENCE_AUDIO" as const,

    referenceAudio: {
      assetId:
        "OLLIE_VOICE_REFERENCE_V1",

      mediaRootRelativePath:
        "voice-references/OLLIE/ollie-reference-v1.mp3",

      bytes:
        231_593,

      sha256,

      contentType:
        "audio/mpeg" as const,

      durationSeconds:
        14.4,

      codecName:
        "mp3" as const,

      sampleRateHz:
        44_100,

      channels:
        1,
    },
  };
}

async function loadReferenceDialogueFixture(
  sha256:
    string = OLLIE_REFERENCE_SHA256,
) {
  const [
    episode,
    loadedBible,
  ] = await Promise.all([
    loadEpisodeManifest(
      "EP02",
    ),

    loadCharacterBible(),
  ]);

  const bible =
    structuredClone(
      loadedBible,
    );

  const ollie =
    bible.characters.find(
      (character) =>
        character.id ===
        "OLLIE",
    );

  if (!ollie) {
    throw new Error(
      "Expected Ollie in Character Bible.",
    );
  }

  Reflect.set(
    ollie,
    "voice",
    createOllieReferenceVoice(
      sha256,
    ),
  );

  const scene =
    episode.scenes.find(
      (candidate) =>
        candidate.id ===
        "SC01",
    );

  if (!scene) {
    throw new Error(
      "Expected EP02 SC01.",
    );
  }

  const shot =
    scene.shots.find(
      (candidate) =>
        candidate.id ===
        "S02",
    );

  if (!shot) {
    throw new Error(
      "Expected EP02 SC01 S02.",
    );
  }

  return {
    episode,
    bible,
    scene,
    shot,
  };
}

describe(
  "Busybookie Runway reference-audio voice contract",
  () => {
    it(
      "admits a locked reference-audio voice only with immutable asset identity",
      () => {
        const candidate =
          createOllieReferenceVoice();

        expect(
          CharacterVoiceSchema.parse(
            candidate,
          ),
        ).toEqual(
          candidate,
        );
      },
    );

    it(
      "builds a v2 dialogue plan carrying the approved reference-audio identity",
      async () => {
        const {
          episode,
          bible,
          scene,
          shot,
        } =
          await loadReferenceDialogueFixture();

        const plan =
          buildShotDialoguePlan({
            episodeId:
              episode.episodeId,

            sceneId:
              scene.id,

            shot,

            bible,
          });

        expect(
          plan.schemaVersion,
        ).toBe(
          "2.0",
        );

        expect(
          plan.lines[0]?.voice,
        ).toEqual(
          createOllieReferenceVoice(),
        );

        expect(
          plan.planKey,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );
      },
    );

    it(
      "changes the dialogue plan key when only the approved reference-audio SHA-256 changes",
      async () => {
        const original =
          await loadReferenceDialogueFixture(
            OLLIE_REFERENCE_SHA256,
          );

        const replacement =
          await loadReferenceDialogueFixture(
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          );

        const originalPlan =
          buildShotDialoguePlan({
            episodeId:
              original.episode
                .episodeId,

            sceneId:
              original.scene.id,

            shot:
              original.shot,

            bible:
              original.bible,
          });

        const replacementPlan =
          buildShotDialoguePlan({
            episodeId:
              replacement.episode
                .episodeId,

            sceneId:
              replacement.scene.id,

            shot:
              replacement.shot,

            bible:
              replacement.bible,
          });

        expect(
          replacementPlan.planKey,
        ).not.toBe(
          originalPlan.planKey,
        );
      },
    );
  },
);
