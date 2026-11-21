import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createPortableReleaseInstallReceipt,
  parsePortableReleaseInstallReceipt,
} from "../src/deployment/portableReleaseInstallReceipt.js";

const REVISION =
  "0ff4981807eb8db6a0aac73fefbd94292d7d12ef";

const ARCHIVE_SHA =
  "a".repeat(
    64,
  );

const TREE_SHA =
  "b".repeat(
    64,
  );

const IDENTITY_SHA =
  "c".repeat(
    64,
  );

const DEPENDENCY_SHA =
  "d".repeat(
    64,
  );

const DEPENDENCY_FILE_COUNT =
  2316;

const DEPENDENCY_TOTAL_BYTES =
  37868792;

function receipt() {
  return createPortableReleaseInstallReceipt({
    reviewedRevision:
      REVISION,

    archiveSha256:
      ARCHIVE_SHA,

    treeManifestSha256:
      TREE_SHA,

    identityManifestSha256:
      IDENTITY_SHA,

    installedFileCount:
      5,

    dependencyManifestSha256:
      DEPENDENCY_SHA,

    dependencyFileCount:
      DEPENDENCY_FILE_COUNT,

    dependencyTotalBytes:
      DEPENDENCY_TOTAL_BYTES,
  });
}

describe(
  "portable release install receipt model",
  () => {
    it(
      "creates the exact deterministic schema-2 receipt shape",
      () => {
        const value =
          receipt();

        expect(
          value,
        ).toEqual({
          schemaVersion:
            "2.0",

          kind:
            "BUSYBOOKIE_PORTABLE_RELEASE_INSTALL_RECEIPT",

          reviewedRevision:
            REVISION,

          archiveSha256:
            ARCHIVE_SHA,

          treeManifestSha256:
            TREE_SHA,

          identityManifestSha256:
            IDENTITY_SHA,

          installedFileCount:
            5,

          dependencyManifestSha256:
            DEPENDENCY_SHA,

          dependencyFileCount:
            DEPENDENCY_FILE_COUNT,

          dependencyTotalBytes:
            DEPENDENCY_TOTAL_BYTES,
        });

        expect(
          Object.isFrozen(
            value,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "parses a valid deterministic schema-2 receipt exactly",
      () => {
        const value =
          receipt();

        const parsed =
          parsePortableReleaseInstallReceipt(
            Buffer.from(
              JSON.stringify(
                value,
              ),
              "utf8",
            ),
          );

        expect(
          parsed,
        ).toEqual(
          value,
        );

        expect(
          Object.isFrozen(
            parsed,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "rejects extra receipt fields",
      () => {
        expect(
          () =>
            parsePortableReleaseInstallReceipt(
              Buffer.from(
                JSON.stringify({
                  ...receipt(),

                  unexpected:
                    true,
                }),
                "utf8",
              ),
            ),
        ).toThrow(
          "Portable release installation failed: Install receipt has an invalid shape.",
        );
      },
    );

    it(
      "rejects legacy schema-1 receipts",
      () => {
        expect(
          () =>
            parsePortableReleaseInstallReceipt(
              Buffer.from(
                JSON.stringify({
                  ...receipt(),

                  schemaVersion:
                    "1.0",
                }),
                "utf8",
              ),
            ),
        ).toThrow(
          "Portable release installation failed: Install receipt contains invalid authority fields.",
        );
      },
    );

    it(
      "rejects malformed release authority fields",
      () => {
        expect(
          () =>
            parsePortableReleaseInstallReceipt(
              Buffer.from(
                JSON.stringify({
                  ...receipt(),

                  archiveSha256:
                    "A".repeat(
                      64,
                    ),
                }),
                "utf8",
              ),
            ),
        ).toThrow(
          "Portable release installation failed: Install receipt contains invalid authority fields.",
        );
      },
    );

    it(
      "rejects malformed dependency authority fields",
      () => {
        expect(
          () =>
            parsePortableReleaseInstallReceipt(
              Buffer.from(
                JSON.stringify({
                  ...receipt(),

                  dependencyFileCount:
                    0,
                }),
                "utf8",
              ),
            ),
        ).toThrow(
          "Portable release installation failed: Install receipt contains invalid authority fields.",
        );
      },
    );
  },
);
