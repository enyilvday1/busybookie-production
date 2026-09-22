import {
  GoogleGenAI,
} from "@google/genai";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createVeoClient,
} from "../src/veo/createVeoClient.js";

import {
  requireGeminiApiKey,
} from "../src/veo/veoCredentials.js";

describe(
  "Busybookie Veo client",
  () => {
    it(
      "returns a trimmed Gemini API key",
      () => {
        expect(
          requireGeminiApiKey({
            GEMINI_API_KEY:
              "  test-gemini-key  ",
          }),
        ).toBe(
          "test-gemini-key",
        );
      },
    );

    it(
      "rejects missing or blank credentials",
      () => {
        expect(() =>
          requireGeminiApiKey({}),
        ).toThrow(
          /GEMINI_API_KEY/,
        );

        expect(() =>
          requireGeminiApiKey({
            GEMINI_API_KEY:
              "   ",
          }),
        ).toThrow(
          /GEMINI_API_KEY/,
        );
      },
    );

    it(
      "constructs the SDK client without making a generation request",
      () => {
        const client =
          createVeoClient(
            "test-gemini-key",
          );

        expect(
          client,
        ).toBeInstanceOf(
          GoogleGenAI,
        );
      },
    );
  },
);
