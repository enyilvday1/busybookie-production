import {
  createHash,
} from "node:crypto";

import {
  readFile,
} from "node:fs/promises";

import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  GOOGLE_GENAI_VIDEO_OUTPUT_INDEX,
  createGoogleGenAiVideoOutputPath,
  deriveGoogleGenAiProviderExecutionIdDigest,
} from "../src/googleGenai/output/googleGenAiVideoOutputPath.js";

const MEDIA_ROOT =
  resolve(
    "/busybookie-media-root",
  );

const INTERACTION_ID =
  "v1_ChdnZW1pbmktb21uaS1pbnRlcmFjdGlvbi0xMjM";

function sha256Hex(
  value:
    string,
): string {
  return createHash(
    "sha256",
  )
    .update(
      value,
      "utf8",
    )
    .digest(
      "hex",
    );
}

describe(
  "Busybookie Google GenAI video output path",
  () => {
    it(
      "builds a deterministic GOOGLE_GENAI path under generated-video with index 1 and .mp4",
      () => {
        const first =
          createGoogleGenAiVideoOutputPath(
            MEDIA_ROOT,
            "EP92",
            "S01",
            INTERACTION_ID,
          );

        const second =
          createGoogleGenAiVideoOutputPath(
            MEDIA_ROOT,
            "EP92",
            "S01",
            INTERACTION_ID,
          );

        expect(
          first,
        ).toBe(
          second,
        );

        expect(
          first,
        ).toBe(
          join(
            MEDIA_ROOT,
            "generated-video",
            "EP92",
            "S01",
            `EP92_S01_GOOGLE_GENAI_${sha256Hex(INTERACTION_ID)}_01.mp4`,
          ),
        );

        expect(
          GOOGLE_GENAI_VIDEO_OUTPUT_INDEX,
        ).toBe(
          1,
        );

        expect(
          basename(
            first,
          ),
        ).toMatch(
          /^EP92_S01_GOOGLE_GENAI_[0-9a-f]{64}_01\.mp4$/,
        );

        const relativePath =
          relative(
            join(
              MEDIA_ROOT,
              "generated-video",
            ),
            first,
          );

        expect(
          relativePath.startsWith(
            "..",
          ),
        ).toBe(
          false,
        );

        expect(
          relativePath.split(
            sep,
          ),
        ).toEqual([
          "EP92",
          "S01",
          basename(
            first,
          ),
        ]);
      },
    );

    it(
      "derives the full lowercase SHA-256 hex of the exact providerExecutionId",
      () => {
        expect(
          deriveGoogleGenAiProviderExecutionIdDigest(
            INTERACTION_ID,
          ),
        ).toBe(
          sha256Hex(
            INTERACTION_ID,
          ),
        );

        expect(
          deriveGoogleGenAiProviderExecutionIdDigest(
            INTERACTION_ID,
          ),
        ).toMatch(
          /^[0-9a-f]{64}$/,
        );

        expect(
          deriveGoogleGenAiProviderExecutionIdDigest(
            ` ${INTERACTION_ID}`,
          ),
        ).not.toBe(
          deriveGoogleGenAiProviderExecutionIdDigest(
            INTERACTION_ID,
          ),
        );
      },
    );

    it(
      "never places the raw providerExecutionId in the path",
      () => {
        const outputPath =
          createGoogleGenAiVideoOutputPath(
            MEDIA_ROOT,
            "EP92",
            "S01",
            INTERACTION_ID,
          );

        expect(
          outputPath,
        ).not.toContain(
          INTERACTION_ID,
        );
      },
    );

    it(
      "produces different paths for different providerExecutionIds",
      () => {
        expect(
          createGoogleGenAiVideoOutputPath(
            MEDIA_ROOT,
            "EP92",
            "S01",
            "interaction-a",
          ),
        ).not.toBe(
          createGoogleGenAiVideoOutputPath(
            MEDIA_ROOT,
            "EP92",
            "S01",
            "interaction-b",
          ),
        );
      },
    );

    it.each([
      "../../../../etc/passwd",
      "..\\..\\windows\\system32",
      "/absolute/escape",
      "C:\\escape",
      "a/../../b",
      "\u0000nul",
    ])(
      "keeps traversal-like providerExecutionId %j inside the shot directory",
      (providerExecutionId) => {
        const outputPath =
          createGoogleGenAiVideoOutputPath(
            MEDIA_ROOT,
            "EP92",
            "S01",
            providerExecutionId,
          );

        expect(
          dirname(
            outputPath,
          ),
        ).toBe(
          join(
            MEDIA_ROOT,
            "generated-video",
            "EP92",
            "S01",
          ),
        );

        expect(
          basename(
            outputPath,
          ),
        ).toBe(
          `EP92_S01_GOOGLE_GENAI_${sha256Hex(providerExecutionId)}_01.mp4`,
        );
      },
    );

    it.each([
      "../EP92",
      "EP92/..",
      "EP9",
      "EP1000",
      "ep92",
      "",
    ])(
      "rejects invalid episode id %j",
      (episodeId) => {
        expect(
          () =>
            createGoogleGenAiVideoOutputPath(
              MEDIA_ROOT,
              episodeId,
              "S01",
              INTERACTION_ID,
            ),
        ).toThrow(
          /Invalid Google GenAI episode id/,
        );
      },
    );

    it.each([
      "../S01",
      "S01/..",
      "S1",
      "S01AB",
      "s01",
      "",
    ])(
      "rejects invalid shot id %j",
      (shotId) => {
        expect(
          () =>
            createGoogleGenAiVideoOutputPath(
              MEDIA_ROOT,
              "EP92",
              shotId,
              INTERACTION_ID,
            ),
        ).toThrow(
          /Invalid Google GenAI shot id/,
        );
      },
    );

    it.each([
      "",
      "   ",
    ])(
      "rejects blank providerExecutionId %j",
      (providerExecutionId) => {
        expect(
          () =>
            createGoogleGenAiVideoOutputPath(
              MEDIA_ROOT,
              "EP92",
              "S01",
              providerExecutionId,
            ),
        ).toThrow(
          /providerExecutionId is required/,
        );
      },
    );

    it.each([
      "",
      "   ",
      "relative/media-root",
    ])(
      "rejects non-absolute media root %j",
      (mediaRoot) => {
        expect(
          () =>
            createGoogleGenAiVideoOutputPath(
              mediaRoot,
              "EP92",
              "S01",
              INTERACTION_ID,
            ),
        ).toThrow(
          /media root must be an absolute path/,
        );
      },
    );

    it(
      "does not import Runway or Veo output helpers",
      async () => {
        const source =
          await readFile(
            join(
              process.cwd(),
              "src",
              "googleGenai",
              "output",
              "googleGenAiVideoOutputPath.ts",
            ),
            "utf8",
          );

        expect(
          source,
        ).not.toMatch(
          /runway|veo|process\.env/i,
        );
      },
    );
  },
);
