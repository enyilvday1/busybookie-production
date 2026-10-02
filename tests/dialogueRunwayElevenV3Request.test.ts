import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  ShotDialoguePlanLine,
} from "../src/dialogue/buildShotDialoguePlan.js";

import {
  buildRunwayElevenV3Request,
} from "../src/dialogue/buildRunwayElevenV3Request.js";

import {
  loadDialogueVoicePolicy,
} from "../src/validation/loadDialogueVoicePolicy.js";

function createLine(
  voiceName:
    string =
      "Chad",
): ShotDialoguePlanLine {
  return {
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

      voiceName,

      deliveryTraits: [
        "young",
        "curious",
        "warm",
        "friendly",
        "natural",
      ],
    },
  };
}

describe(
  "Busybookie Runway Eleven v3 dialogue request",
  () => {
    it(
      "builds the exact explicit Eleven v3 request from a canonical dialogue plan line and policy",
      async () => {
        const policy =
          await loadDialogueVoicePolicy();

        const request =
          buildRunwayElevenV3Request({
            line:
              createLine(),

            policy,
          });

        expect(
          request,
        ).toEqual({
          model:
            "eleven_v3",

          promptText:
            "Look what I found!",

          voice: {
            type:
              "runway-preset",

            presetId:
              "Chad",
          },

          applyTextNormalization:
            "auto",

          languageCode:
            "en",

          seed:
            0,

          similarityBoost:
            0.75,

          speed:
            1,

          stability:
            0.5,

          style:
            0,

          useSpeakerBoost:
            true,
        });
      },
    );

    it(
      "does not append delivery notes or delivery traits to the spoken text",
      async () => {
        const policy =
          await loadDialogueVoicePolicy();

        const request =
          buildRunwayElevenV3Request({
            line:
              createLine(),

            policy,
          });

        expect(
          request.promptText,
        ).toBe(
          "Look what I found!",
        );

        expect(
          request.promptText,
        ).not.toContain(
          "Curious",
        );

        expect(
          request.promptText,
        ).not.toContain(
          "young",
        );
      },
    );

    it(
      "accepts every currently locked Busybookie Runway voice preset",
      async () => {
        const policy =
          await loadDialogueVoicePolicy();

        for (
          const voiceName
          of [
            "Chad",
            "Maya",
            "Noah",
          ]
        ) {
          const request =
            buildRunwayElevenV3Request({
              line:
                createLine(
                  voiceName,
                ),

              policy,
            });

          expect(
            request.voice.presetId,
          ).toBe(
            voiceName,
          );
        }
      },
    );

    it(
      "rejects a voice name that is not supported by the installed Runway TTS contract",
      async () => {
        const policy =
          await loadDialogueVoicePolicy();

        expect(
          () =>
            buildRunwayElevenV3Request({
              line:
                createLine(
                  "NotARealRunwayVoice",
                ),

              policy,
            }),
        ).toThrow(
          /approved.*voice|voice.*approved|preset/i,
        );
      },
    );

    it(
      "rejects a forged non-Runway dialogue voice at the provider boundary",
      async () => {
        const policy =
          await loadDialogueVoicePolicy();

        const forgedLine = {
          ...createLine(),

          voice: {
            ...createLine()
              .voice,

            provider:
              "VEO",
          },
        } as unknown as ShotDialoguePlanLine;

        expect(
          () =>
            buildRunwayElevenV3Request({
              line:
                forgedLine,

              policy,
            }),
        ).toThrow(
          /RUNWAY|provider/i,
        );
      },
    );
  },
);

describe(
  "Busybookie Runway Eleven v3 dialogue request local policy enforcement",
  () => {
    it(
      "rejects a prompt that is provider-valid but exceeds Busybookie local prompt policy",
      async () => {
        const policy =
          await loadDialogueVoicePolicy();

        const overLimitLine:
          ShotDialoguePlanLine = {
            ...createLine(),

            text:
              "x".repeat(
                501,
              ),
          };

        expect(
          () =>
            buildRunwayElevenV3Request({
              line:
                overLimitLine,

              policy,
            }),
        ).toThrow(
          /500-character limit|exceed/i,
        );
      },
    );
  },
);
