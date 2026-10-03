import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildRunwayElevenV3Request,
} from "../src/dialogue/buildRunwayElevenV3Request.js";

import {
  buildShotDialoguePlan,
} from "../src/dialogue/buildShotDialoguePlan.js";

import {
  loadCharacterBible,
} from "../src/validation/loadCharacterBible.js";

import {
  loadDialogueVoicePolicy,
} from "../src/validation/loadDialogueVoicePolicy.js";

import {
  loadEpisodeManifest,
} from "../src/validation/loadEpisodeManifest.js";

const HISTORICAL_CHAD_PLAN_KEY =
  "8aa33cb459ff7e2d33c8ba7e100e2c303df168d6849ff228b120394a79414948";

const OLLIE_REFERENCE_SHA256 =
  "ad7bc6a50675bddc74a4885f290667fad1076c5cd3d9844eb7ff2d84b0f94a2f";

async function loadEp02Fixture() {
  const [
    episode,
    loadedBible,
  ] = await Promise.all([
    loadEpisodeManifest(
      "EP02",
    ),

    loadCharacterBible(),
  ]);

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
    loadedBible,
    scene,
    shot,
  };
}

describe(
  "Busybookie dialogue preset/reference execution boundary",
  () => {
    it(
      "preserves the exact historical v1 Chad dialogue plan identity",
      async () => {
        const {
          episode,
          loadedBible,
          scene,
          shot,
        } =
          await loadEp02Fixture();

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
          {
            selectionStatus:
              "LOCKED",

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
        );

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
          "1.0",
        );

        expect(
          plan.planKey,
        ).toBe(
          HISTORICAL_CHAD_PLAN_KEY,
        );
      },
    );

    it(
      "rejects a reference-audio voice from the Eleven v3 preset request path even when its display name matches a valid preset",
      async () => {
        const {
          episode,
          loadedBible,
          scene,
          shot,
        } =
          await loadEp02Fixture();

        const [
          policy,
        ] =
          await Promise.all([
            loadDialogueVoicePolicy(),
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
          {
            selectionStatus:
              "LOCKED",

            provider:
              "RUNWAY",

            voiceName:
              "Maya",

            deliveryTraits: [
              "young",
              "curious",
              "warm",
              "friendly",
              "natural",
            ],

            executionMode:
              "RUNWAY_REFERENCE_AUDIO",

            referenceAudio: {
              assetId:
                "OLLIE_VOICE_REFERENCE_V1",

              mediaRootRelativePath:
                "voice-references/OLLIE/ollie-reference-v1.mp3",

              bytes:
                231_593,

              sha256:
                OLLIE_REFERENCE_SHA256,

              contentType:
                "audio/mpeg",

              durationSeconds:
                14.4,

              codecName:
                "mp3",

              sampleRateHz:
                44_100,

              channels:
                1,
            },
          },
        );

        const plan =
          buildShotDialoguePlan({
            episodeId:
              episode.episodeId,

            sceneId:
              scene.id,

            shot,

            bible,
          });

        const line =
          plan.lines[0];

        if (!line) {
          throw new Error(
            "Expected EP02 SC01 S02 dialogue line.",
          );
        }

        expect(
          plan.schemaVersion,
        ).toBe(
          "2.0",
        );

        expect(
          () =>
            buildRunwayElevenV3Request({
              line,
              policy,
            }),
        ).toThrow(
          /reference-audio.*Eleven v3|Eleven v3.*reference-audio/i,
        );
      },
    );
  },
);
