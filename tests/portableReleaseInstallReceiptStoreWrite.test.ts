import {
  mkdtemp,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createPortableReleaseInstallReceipt,
} from "../src/deployment/portableReleaseInstallReceipt.js";

import {
  portableReleaseInstallReceiptPath,
  writePortableReleaseInstallReceipt,
} from "../src/deployment/portableReleaseInstallReceiptStore.js";

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

const roots:
  string[] =
  [];

async function root(): Promise<string> {
  const value =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-receipt-writer-",
      ),
    );

  roots.push(
    value,
  );

  return value;
}

afterEach(
  async () => {
    await Promise.all(
      roots.splice(
        0,
      ).map(
        value =>
          rm(
            value,
            {
              recursive:
                true,

              force:
                true,
            },
          ),
      ),
    );
  },
);

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
  "portable release install receipt store durable writer",
  () => {
    it(
      "writes the exact deterministic schema-2 receipt bytes and removes temporary state",
      async () => {
        const releasesRoot =
          await root();

        const receiptPath =
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          );

        const value =
          receipt();

        await writePortableReleaseInstallReceipt(
          receiptPath,
          value,
        );

        expect(
          await readFile(
            receiptPath,
            "utf8",
          ),
        ).toBe(
          `${JSON.stringify(
            value,
            null,
            2,
          )}\n`,
        );

        expect(
          await readdir(
            dirname(
              receiptPath,
            ),
          ),
        ).toEqual([
          `${REVISION}.json`,
        ]);
      },
    );

    it(
      "refuses to overwrite an existing durable receipt and preserves its bytes",
      async () => {
        const releasesRoot =
          await root();

        const receiptPath =
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          );

        const value =
          receipt();

        await writePortableReleaseInstallReceipt(
          receiptPath,
          value,
        );

        const before =
          await readFile(
            receiptPath,
          );

        await expect(
          writePortableReleaseInstallReceipt(
            receiptPath,
            value,
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Install receipt already exists.",
        );

        expect(
          await readFile(
            receiptPath,
          ),
        ).toEqual(
          before,
        );

        expect(
          await readdir(
            dirname(
              receiptPath,
            ),
          ),
        ).toEqual([
          `${REVISION}.json`,
        ]);
      },
    );
  },
);
