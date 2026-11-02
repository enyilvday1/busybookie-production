import {
  createHash,
} from "node:crypto";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  calculateVisualAttemptManifestRawSha256,
  calculateVisualAttemptPromptIdentitySha256,
  calculateVisualAttemptReferenceIdentitySha256,
} from "../src/execution/visualAttemptIdentity.js";

function sha256(
  value:
    string | Uint8Array,
): string {
  return createHash(
    "sha256",
  )
    .update(
      value,
    )
    .digest(
      "hex",
    );
}

describe(
  "visual attempt identity hash contract",
  () => {
    it(
      "hashes the exact UTF-8 effective provider prompt without hidden normalization",
      () => {
        const effectivePrompt =
          "  Camera: café in Littleleaf Valley 🌿  ";

        expect(
          calculateVisualAttemptPromptIdentitySha256(
            effectivePrompt,
          ),
        ).toBe(
          sha256(
            effectivePrompt,
          ),
        );

        expect(
          calculateVisualAttemptPromptIdentitySha256(
            effectivePrompt,
          ),
        ).not.toBe(
          calculateVisualAttemptPromptIdentitySha256(
            effectivePrompt.trim(),
          ),
        );
      },
    );

    it(
      "rejects only the zero-length effective prompt rather than silently normalizing it",
      () => {
        expect(
          () =>
            calculateVisualAttemptPromptIdentitySha256(
              "",
            ),
        ).toThrow(
          /effective visual attempt prompt text is required/i,
        );

        const whitespace =
          "   ";

        expect(
          calculateVisualAttemptPromptIdentitySha256(
            whitespace,
          ),
        ).toBe(
          sha256(
            whitespace,
          ),
        );
      },
    );

    it(
      "hashes exact approved-reference bytes",
      () => {
        const bytes =
          Uint8Array.from([
            0x89,
            0x50,
            0x4e,
            0x47,
            0x00,
            0x01,
            0x02,
          ]);

        expect(
          calculateVisualAttemptReferenceIdentitySha256(
            bytes,
          ),
        ).toBe(
          sha256(
            bytes,
          ),
        );

        const changed =
          Uint8Array.from([
            0x89,
            0x50,
            0x4e,
            0x47,
            0x00,
            0x01,
            0x03,
          ]);

        expect(
          calculateVisualAttemptReferenceIdentitySha256(
            changed,
          ),
        ).not.toBe(
          calculateVisualAttemptReferenceIdentitySha256(
            bytes,
          ),
        );
      },
    );

    it(
      "hashes exact raw manifest bytes",
      () => {
        const manifestBytes =
          Buffer.from(
            '{\n  "episodeId": "EP93"\n}\n',
            "utf8",
          );

        expect(
          calculateVisualAttemptManifestRawSha256(
            manifestBytes,
          ),
        ).toBe(
          sha256(
            manifestBytes,
          ),
        );

        const reformattedManifestBytes =
          Buffer.from(
            '{"episodeId":"EP93"}\n',
            "utf8",
          );

        expect(
          calculateVisualAttemptManifestRawSha256(
            reformattedManifestBytes,
          ),
        ).not.toBe(
          calculateVisualAttemptManifestRawSha256(
            manifestBytes,
          ),
        );
      },
    );
  },
);
