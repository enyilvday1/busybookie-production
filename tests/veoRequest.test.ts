import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildVeoGenerateRequest,
} from "../src/veo/generation/buildVeoGenerateRequest.js";

import {
  loadVeoPolicy,
} from "../src/validation/loadVeoPolicy.js";

describe(
  "Busybookie Veo request builder",
  () => {
    it(
      "builds a controlled 4-second image-to-video request",
      async () => {
        const policy =
          await loadVeoPolicy();

        const request =
          buildVeoGenerateRequest(
            {
              promptText:
                "Ollie looks toward the softly moving trees.",

              durationSeconds:
                4,

              image: {
                imageBytes:
                  "AQID",

                mimeType:
                  "image/png",
              },
            },
            policy,
          );

        expect(
          request.model,
        ).toBe(
          "veo-3.1-fast-generate-preview",
        );

        expect(
          request.config,
        ).toEqual({
          numberOfVideos:
            1,

          durationSeconds:
            4,

          aspectRatio:
            "16:9",

          resolution:
            "720p",

          generateAudio:
            true,
        });

        expect(
          request.image
            ?.mimeType,
        ).toBe(
          "image/png",
        );
      },
    );

    it(
      "supports a controlled text-only request",
      async () => {
        const policy =
          await loadVeoPolicy();

        const request =
          buildVeoGenerateRequest(
            {
              promptText:
                "A calm morning in Littleleaf Valley.",

              durationSeconds:
                8,
            },
            policy,
          );

        expect(
          request.image,
        ).toBeUndefined();
      },
    );

    it(
      "rejects unsupported duration values",
      async () => {
        const policy =
          await loadVeoPolicy();

        expect(() =>
          buildVeoGenerateRequest(
            {
              promptText:
                "Test.",

              durationSeconds:
                5,
            },
            policy,
          ),
        ).toThrow();
      },
    );
  },
);
