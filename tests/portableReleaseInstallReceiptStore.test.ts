import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  dirname,
  join,
  resolve,
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
  readExactPortableReleaseInstallReceiptReplay,
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
        "busybookie-receipt-store-",
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

function replayInput(
  receiptPath: string,
) {
  return {
    receiptPath,

    expectedReviewedRevision:
      REVISION,

    expectedArchiveSha256:
      ARCHIVE_SHA,

    expectedTreeManifestSha256:
      TREE_SHA,

    expectedDependencyManifestSha256:
      DEPENDENCY_SHA,

    expectedDependencyFileCount:
      DEPENDENCY_FILE_COUNT,

    expectedDependencyTotalBytes:
      DEPENDENCY_TOTAL_BYTES,
  } as const;
}

describe(
  "portable release install receipt store read side",
  () => {
    it(
      "derives the deterministic receipt path outside an immutable revision directory",
      async () => {
        const releasesRoot =
          await root();

        expect(
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          ),
        ).toBe(
          resolve(
            releasesRoot,
            ".receipts",
            `${REVISION}.json`,
          ),
        );
      },
    );

    it(
      "reads an exact replay receipt when release and dependency authorities match",
      async () => {
        const releasesRoot =
          await root();

        const receiptPath =
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          );

        await mkdir(
          dirname(
            receiptPath,
          ),
          {
            recursive:
              true,
          },
        );

        const value =
          receipt();

        await writeFile(
          receiptPath,
          JSON.stringify(
            value,
          ),
          "utf8",
        );

        await expect(
          readExactPortableReleaseInstallReceiptReplay(
            replayInput(
              receiptPath,
            ),
          ),
        ).resolves.toEqual(
          value,
        );
      },
    );

    it(
      "rejects a readable receipt whose release authorities do not match",
      async () => {
        const releasesRoot =
          await root();

        const receiptPath =
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          );

        await mkdir(
          dirname(
            receiptPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          receiptPath,
          JSON.stringify(
            receipt(),
          ),
          "utf8",
        );

        await expect(
          readExactPortableReleaseInstallReceiptReplay({
            ...replayInput(
              receiptPath,
            ),

            expectedArchiveSha256:
              "e".repeat(
                64,
              ),
          }),
        ).rejects.toThrow(
          "Portable release installation failed: Existing immutable release receipt does not match the requested release authorities.",
        );
      },
    );

    it(
      "rejects a readable receipt whose dependency authorities do not match",
      async () => {
        const releasesRoot =
          await root();

        const receiptPath =
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          );

        await mkdir(
          dirname(
            receiptPath,
          ),
          {
            recursive:
              true,
          },
        );

        await writeFile(
          receiptPath,
          JSON.stringify(
            receipt(),
          ),
          "utf8",
        );

        await expect(
          readExactPortableReleaseInstallReceiptReplay({
            ...replayInput(
              receiptPath,
            ),

            expectedDependencyManifestSha256:
              "e".repeat(
                64,
              ),
          }),
        ).rejects.toThrow(
          "Portable release installation failed: Existing immutable release receipt does not match the requested release authorities.",
        );
      },
    );

    it(
      "preserves the unreadable-receipt failure contract",
      async () => {
        const releasesRoot =
          await root();

        const receiptPath =
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          );

        await expect(
          readExactPortableReleaseInstallReceiptReplay(
            replayInput(
              receiptPath,
            ),
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Existing immutable release directory is not backed by a readable install receipt.",
        );
      },
    );
  },
);
