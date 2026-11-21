import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createPortableReleaseInstallReceipt,
} from "../src/deployment/portableReleaseInstallReceipt.js";

import {
  portableReleaseInstallationResultFromReceipt,
} from "../src/deployment/portableReleaseInstallationResult.js";

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

describe(
  "portable release installation result",
  () => {
    it(
      "maps the durable schema-2 receipt into the exact frozen installer result",
      () => {
        const receipt =
          createPortableReleaseInstallReceipt({
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

        const releaseRoot =
          "/opt/busybookie/releases/" +
          REVISION +
          "/app";

        const result =
          portableReleaseInstallationResultFromReceipt(
            releaseRoot,
            "/opt/busybookie/releases/.receipts/" +
              REVISION +
              ".json",
            receipt,
          );

        expect(
          result,
        ).toEqual({
          reviewedRevision:
            REVISION,

          releaseRoot,

          receiptPath:
            "/opt/busybookie/releases/.receipts/" +
            REVISION +
            ".json",

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
            result,
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);
