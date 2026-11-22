import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
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

function expectedReceiptBytes(): Buffer {
  return Buffer.from(
    `${JSON.stringify(
      receipt(),
      null,
      2,
    )}\n`,
    "utf8",
  );
}

describe(
  "portable release install receipt store durability ordering",
  () => {
    it(
      "syncs a new .receipts entry, then writes and fsyncs the temp receipt, renames it, then fsyncs .receipts",
      async () => {
        const releasesRoot =
          await root();

        const receiptPath =
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          );

        const receiptsRoot =
          dirname(
            receiptPath,
          );

        const events:
          string[] =
            [];

        await writePortableReleaseInstallReceipt(
          receiptPath,
          receipt(),
          {
            syncFile:
              async handle => {
                const temporary =
                  (
                    await readdir(
                      receiptsRoot,
                    )
                  ).filter(
                    name =>
                      name.startsWith(
                        `.receipt-${REVISION}-`,
                      ),
                  );

                expect(
                  temporary,
                ).toHaveLength(
                  1,
                );

                expect(
                  await readFile(
                    join(
                      receiptsRoot,
                      temporary[0] ?? "",
                      "receipt.json",
                    ),
                  ),
                ).toEqual(
                  expectedReceiptBytes(),
                );

                events.push(
                  "write-then-fsync-file",
                );

                await handle.sync();
              },

            renameReceipt:
              async (
                source,
                destination,
              ) => {
                expect(
                  destination,
                ).toBe(
                  receiptPath,
                );

                events.push(
                  "rename-receipt",
                );

                await rename(
                  source,
                  destination,
                );
              },

            syncDirectory:
              async directory => {
                events.push(
                  directory ===
                    receiptsRoot
                    ? "fsync-receipts"
                    : directory ===
                        releasesRoot
                      ? "fsync-releases-root"
                      : `fsync-unexpected:${directory}`,
                );
              },
          },
        );

        expect(
          events,
        ).toEqual([
          "fsync-releases-root",
          "write-then-fsync-file",
          "rename-receipt",
          "fsync-receipts",
        ]);

        expect(
          await readFile(
            receiptPath,
          ),
        ).toEqual(
          expectedReceiptBytes(),
        );

        expect(
          await readdir(
            receiptsRoot,
          ),
        ).toEqual([
          `${REVISION}.json`,
        ]);
      },
    );

    it(
      "leaves no receipt and no temporary state when the temp-file fsync fails",
      async () => {
        const releasesRoot =
          await root();

        const receiptPath =
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          );

        await expect(
          writePortableReleaseInstallReceipt(
            receiptPath,
            receipt(),
            {
              syncFile:
                async () => {
                  throw new Error(
                    "synthetic-receipt-file-fsync-failure",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "synthetic-receipt-file-fsync-failure",
        );

        expect(
          await readdir(
            dirname(
              receiptPath,
            ),
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "leaves no receipt and no temporary state when the receipt rename fails",
      async () => {
        const releasesRoot =
          await root();

        const receiptPath =
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          );

        await expect(
          writePortableReleaseInstallReceipt(
            receiptPath,
            receipt(),
            {
              renameReceipt:
                async () => {
                  throw new Error(
                    "synthetic-receipt-rename-failure",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "synthetic-receipt-rename-failure",
        );

        expect(
          await readdir(
            dirname(
              receiptPath,
            ),
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "keeps the committed receipt when the .receipts fsync fails after the rename",
      async () => {
        const releasesRoot =
          await root();

        const receiptPath =
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          );

        const receiptsRoot =
          dirname(
            receiptPath,
          );

        await expect(
          writePortableReleaseInstallReceipt(
            receiptPath,
            receipt(),
            {
              syncDirectory:
                async directory => {
                  if (
                    directory ===
                      receiptsRoot
                  ) {
                    throw new Error(
                      "synthetic-receipts-directory-fsync-failure",
                    );
                  }
                },
            },
          ),
        ).rejects.toThrow(
          "synthetic-receipts-directory-fsync-failure",
        );

        expect(
          await readFile(
            receiptPath,
          ),
        ).toEqual(
          expectedReceiptBytes(),
        );

        expect(
          await readdir(
            receiptsRoot,
          ),
        ).toEqual([
          `${REVISION}.json`,
        ]);
      },
    );

    it(
      "keeps the committed receipt when temporary cleanup fails after the durable commit",
      async () => {
        const releasesRoot =
          await root();

        const receiptPath =
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          );

        await expect(
          writePortableReleaseInstallReceipt(
            receiptPath,
            receipt(),
            {
              removeTemporary:
                async () => {
                  throw new Error(
                    "synthetic-receipt-temporary-cleanup-failure",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "synthetic-receipt-temporary-cleanup-failure",
        );

        expect(
          await readFile(
            receiptPath,
          ),
        ).toEqual(
          expectedReceiptBytes(),
        );
      },
    );

    it(
      "does not re-sync releasesRoot when .receipts already exists",
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
        );

        const synced:
          string[] =
            [];

        await writePortableReleaseInstallReceipt(
          receiptPath,
          receipt(),
          {
            syncDirectory:
              async directory => {
                synced.push(
                  directory,
                );
              },
          },
        );

        expect(
          synced,
        ).toEqual([
          dirname(
            receiptPath,
          ),
        ]);
      },
    );

    it(
      "fails closed when .receipts is not a directory",
      async () => {
        const releasesRoot =
          await root();

        const receiptPath =
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          );

        await writeFile(
          dirname(
            receiptPath,
          ),
          "not-a-directory\n",
        );

        await expect(
          writePortableReleaseInstallReceipt(
            receiptPath,
            receipt(),
          ),
        ).rejects.toThrow();

        expect(
          await readFile(
            dirname(
              receiptPath,
            ),
            "utf8",
          ),
        ).toBe(
          "not-a-directory\n",
        );
      },
    );

    it.skipIf(
      process.platform === "win32",
    )(
      "fails closed when .receipts is a symbolic link",
      async () => {
        const releasesRoot =
          await root();

        const elsewhere =
          await root();

        const receiptPath =
          portableReleaseInstallReceiptPath(
            releasesRoot,
            REVISION,
          );

        await symlink(
          elsewhere,
          dirname(
            receiptPath,
          ),
        );

        await expect(
          writePortableReleaseInstallReceipt(
            receiptPath,
            receipt(),
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Install receipt directory must be a safe real directory.",
        );

        expect(
          await readdir(
            elsewhere,
          ),
        ).toEqual(
          [],
        );
      },
    );
  },
);
