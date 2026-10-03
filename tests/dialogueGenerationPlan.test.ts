import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

async function loadEp02DialogueFixture() {
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

  ollie.voice = {
    selectionStatus:
      "LOCKED",

    provider:
      "RUNWAY",

    voiceName:
      "Chad",

    deliveryTraits: [
      ...ollie.voice
        .deliveryTraits,
    ],
  };

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
      "Expected EP02 S02.",
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
  "Busybookie dialogue generation planning",
  () => {
    it(
      "builds a deterministic dialogue plan for EP02 S02 without coupling the voice provider to the video provider",
      async () => {
        const {
          episode,
          bible,
          scene,
          shot,
        } =
          await loadEp02DialogueFixture();

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
          plan,
        ).toMatchObject({
          schemaVersion:
            "1.0",

          episodeId:
            "EP02",

          sceneId:
            "SC01",

          shotId:
            "S02",

          shotDurationSeconds:
            6,

          videoGeneration: {
            provider:
              "VEO",

            nativeAudio:
              true,
          },

          lines: [
            {
              lineNumber:
                1,

              dialogueLineId:
                "EP02_SC01_S02_L01",

              characterId:
                "OLLIE",

              characterName:
                "Ollie",

              text:
                "Look what I found!",

              deliveryNotes:
                "Curious, excited and gentle.",

              voice: {
                provider:
                  "RUNWAY",

                voiceName:
                  "Chad",

                deliveryTraits: [
                  "young",
                  "curious",
                  "warm",
                  "friendly",
                  "natural",
                ],
              },
            },
          ],
        });

        expect(
          plan.planKey,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );
      },
    );

    it(
      "produces the same plan key for the same canonical dialogue input",
      async () => {
        const {
          episode,
          bible,
          scene,
          shot,
        } =
          await loadEp02DialogueFixture();

        const first =
          buildShotDialoguePlan({
            episodeId:
              episode.episodeId,

            sceneId:
              scene.id,

            shot,

            bible,
          });

        const second =
          buildShotDialoguePlan({
            episodeId:
              episode.episodeId,

            sceneId:
              scene.id,

            shot,

            bible,
          });

        expect(
          second.planKey,
        ).toBe(
          first.planKey,
        );
      },
    );

    it(
      "changes the plan key when the approved dialogue text changes",
      async () => {
        const {
          episode,
          bible,
          scene,
          shot,
        } =
          await loadEp02DialogueFixture();

        const original =
          buildShotDialoguePlan({
            episodeId:
              episode.episodeId,

            sceneId:
              scene.id,

            shot,

            bible,
          });

        const changedShot =
          structuredClone(
            shot,
          );

        const firstLine =
          changedShot.dialogue[0];

        if (!firstLine) {
          throw new Error(
            "Expected EP02 S02 dialogue line.",
          );
        }

        firstLine.text =
          "Look what we found!";

        const changed =
          buildShotDialoguePlan({
            episodeId:
              episode.episodeId,

            sceneId:
              scene.id,

            shot:
              changedShot,

            bible,
          });

        expect(
          changed.planKey,
        ).not.toBe(
          original.planKey,
        );
      },
    );

    it(
      "fails closed when a speaking character does not have a locked voice",
      async () => {
        const {
          episode,
          bible,
          scene,
          shot,
        } =
          await loadEp02DialogueFixture();

        const pendingBible =
          structuredClone(
            bible,
          );

        const ollie =
          pendingBible.characters.find(
            (character) =>
              character.id ===
              "OLLIE",
          );

        if (!ollie) {
          throw new Error(
            "Expected Ollie in Character Bible.",
          );
        }

        ollie.voice = {
          selectionStatus:
            "PENDING",

          provider:
            "RUNWAY",

          voiceName:
            null,

          deliveryTraits: [
            ...ollie.voice
              .deliveryTraits,
          ],
        };

        expect(
          () =>
            buildShotDialoguePlan({
              episodeId:
                episode.episodeId,

              sceneId:
                scene.id,

              shot,

              bible:
                pendingBible,
            }),
        ).toThrow(
          /approved voice is locked|locked voice/i,
        );
      },
    );

    it(
      "fails closed when asked to create a voice-generation plan for a shot with no dialogue lines",
      async () => {
        const {
          episode,
          bible,
          scene,
          shot,
        } =
          await loadEp02DialogueFixture();

        const silentShot =
          structuredClone(
            shot,
          );

        silentShot.dialogue =
          [];

        expect(
          () =>
            buildShotDialoguePlan({
              episodeId:
                episode.episodeId,

              sceneId:
                scene.id,

              shot:
                silentShot,

              bible,
            }),
        ).toThrow(
          /dialogue line/i,
        );
      },
    );
  },
);
