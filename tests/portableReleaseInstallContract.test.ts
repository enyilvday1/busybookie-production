import {
  describe,
  expect,
  it,
} from "vitest";

import {
  isPortableReleaseRevision,
  isPortableReleaseSha256,
  requirePortableReleaseRevision,
  requirePortableReleaseSha256,
} from "../src/deployment/portableReleaseInstallContract.js";

describe(
  "portable release install contract",
  () => {
    it(
      "accepts exact lowercase reviewed revisions and SHA-256 values",
      () => {
        const revision =
          "0ff4981807eb8db6a0aac73fefbd94292d7d12ef";

        const sha256 =
          "a".repeat(
            64,
          );

        expect(
          isPortableReleaseRevision(
            revision,
          ),
        ).toBe(
          true,
        );

        expect(
          isPortableReleaseSha256(
            sha256,
          ),
        ).toBe(
          true,
        );

        expect(
          requirePortableReleaseRevision(
            revision,
          ),
        ).toBe(
          revision,
        );

        expect(
          requirePortableReleaseSha256(
            sha256,
            "Expected archive SHA-256",
          ),
        ).toBe(
          sha256,
        );
      },
    );

    it(
      "keeps boolean validation non-throwing for malformed authority values",
      () => {
        expect(
          isPortableReleaseRevision(
            "A".repeat(
              40,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          isPortableReleaseSha256(
            "A".repeat(
              64,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          isPortableReleaseSha256(
            "a".repeat(
              63,
            ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "preserves the exact throwing SHA-256 validation message",
      () => {
        expect(
          () =>
            requirePortableReleaseSha256(
              "invalid",
              "Expected release archive SHA-256",
            ),
        ).toThrow(
          "Portable release installation failed: Expected release archive SHA-256 must be exactly 64 lowercase hexadecimal characters.",
        );
      },
    );

    it(
      "preserves the exact throwing revision validation message",
      () => {
        expect(
          () =>
            requirePortableReleaseRevision(
              "invalid",
            ),
        ).toThrow(
          "Portable release installation failed: Expected reviewed revision must be exactly 40 lowercase hexadecimal characters.",
        );
      },
    );
  },
);
