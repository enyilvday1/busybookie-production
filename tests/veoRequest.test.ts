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
      "builds a controlled image-to-video request using source",
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
          request.source.prompt,
        ).toBe(
          "Ollie looks toward the softly moving trees.",
        );

        expect(
          request.source.image
            ?.mimeType,
        ).toBe(
          "image/png",
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
        });
      },
    );

    it(
      "does not emit deprecated top-level prompt, image, or generateAudio fields",
      async () => {
        const policy =
          await loadVeoPolicy();

        const request =
          buildVeoGenerateRequest(
            {
              promptText:
                "A calm morning in Littleleaf Valley.",

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
          "prompt" in request,
        ).toBe(false);

        expect(
          "image" in request,
        ).toBe(false);

        expect(
          "generateAudio" in
            request.config,
        ).toBe(false);

        expect(
          request.source.image,
        ).toBeDefined();
      },
    );

    it(
      "supports a controlled text-only source",
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
          request.source.image,
        ).toBeUndefined();

        expect(
          request.source.prompt,
        ).toBe(
          "A calm morning in Littleleaf Valley.",
        );
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
