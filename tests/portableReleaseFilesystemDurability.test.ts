import {
  mkdtemp,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
} from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  link,
  mkdir,
  symlink,
  writeFile,
} from "node:fs/promises";

import {
  syncPortableReleaseDirectory,
  syncPortableReleaseTree,
} from "../src/deployment/portableReleaseFilesystemDurability.js";

const roots:
  string[] =
  [];

async function root(): Promise<string> {
  const value =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-directory-durability-",
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

describe(
  "portable release filesystem durability",
  () => {
    it(
      "syncs an existing directory without changing its contents",
      async () => {
        const directory =
          await root();

        await expect(
          syncPortableReleaseDirectory(
            directory,
          ),
        ).resolves.toBeUndefined();
      },
    );

    it(
      "fails closed when the directory does not exist",
      async () => {
        const directory =
          await root();

        const missing =
          join(
            directory,
            "missing",
          );

        await expect(
          syncPortableReleaseDirectory(
            missing,
          ),
        ).rejects.toThrow();
      },
    );
  },
);

async function treeFixture(): Promise<string> {
  const tree =
    await root();

  await mkdir(
    join(
      tree,
      "a",
      "b",
    ),
    {
      recursive:
        true,
    },
  );

  await writeFile(
    join(
      tree,
      "a",
      "b",
      "c.txt",
    ),
    "c\n",
  );

  await writeFile(
    join(
      tree,
      "a",
      "d.txt",
    ),
    "d\n",
  );

  await writeFile(
    join(
      tree,
      "e.txt",
    ),
    "e\n",
  );

  return tree;
}

describe(
  "portable release durable tree sync",
  () => {
    it(
      "fsyncs every authoritative file, then every containing directory deepest first and the root last",
      async () => {
        const tree =
          await treeFixture();

        const syncedFiles:
          string[] =
            [];

        const syncedDirectories:
          string[] =
            [];

        await syncPortableReleaseTree(
          {
            root:
              tree,

            files: [
              "a/b/c.txt",
              "a/d.txt",
              "e.txt",
            ],
          },
          {
            syncFileHandle:
              async (
                _handle,
                path,
              ) => {
                syncedFiles.push(
                  path,
                );
              },

            syncDirectory:
              async directory => {
                syncedDirectories.push(
                  directory,
                );
              },
          },
        );

        expect(
          syncedFiles,
        ).toEqual([
          join(
            tree,
            "a",
            "b",
            "c.txt",
          ),
          join(
            tree,
            "a",
            "d.txt",
          ),
          join(
            tree,
            "e.txt",
          ),
        ]);

        expect(
          syncedDirectories,
        ).toEqual([
          join(
            tree,
            "a",
            "b",
          ),
          join(
            tree,
            "a",
          ),
          tree,
        ]);

        await expect(
          syncPortableReleaseTree({
            root:
              tree,

            files: [
              "a/b/c.txt",
              "a/d.txt",
              "e.txt",
            ],
          }),
        ).resolves.toBeUndefined();
      },
    );

    it(
      "syncs only the authoritative list and never traverses unlisted files",
      async () => {
        const tree =
          await treeFixture();

        const syncedFiles:
          string[] =
            [];

        await syncPortableReleaseTree(
          {
            root:
              tree,

            files: [
              "e.txt",
            ],
          },
          {
            syncFileHandle:
              async (
                _handle,
                path,
              ) => {
                syncedFiles.push(
                  path,
                );
              },

            syncDirectory:
              async () => {},
          },
        );

        expect(
          syncedFiles,
        ).toEqual([
          join(
            tree,
            "e.txt",
          ),
        ]);
      },
    );

    it(
      "fails closed when an authoritative file has disappeared",
      async () => {
        const tree =
          await treeFixture();

        await expect(
          syncPortableReleaseTree({
            root:
              tree,

            files: [
              "e.txt",
              "missing.txt",
            ],
          }),
        ).rejects.toThrow(
          "Portable release installation failed: Authoritative release file disappeared before durable sync: missing.txt",
        );
      },
    );

    it(
      "fails closed when an authoritative path is a directory or a multiply-linked file",
      async () => {
        const tree =
          await treeFixture();

        await expect(
          syncPortableReleaseTree({
            root:
              tree,

            files: [
              "a",
            ],
          }),
        ).rejects.toThrow(
          "Portable release installation failed: Authoritative release file is not a single-link regular file during durable sync: a",
        );

        await link(
          join(
            tree,
            "e.txt",
          ),
          join(
            tree,
            "e-second-link.txt",
          ),
        );

        await expect(
          syncPortableReleaseTree({
            root:
              tree,

            files: [
              "e.txt",
            ],
          }),
        ).rejects.toThrow(
          "Portable release installation failed: Authoritative release file is not a single-link regular file during durable sync: e.txt",
        );
      },
    );

    it.skipIf(
      process.platform === "win32",
    )(
      "fails closed when an authoritative file is a symbolic link",
      async () => {
        const tree =
          await treeFixture();

        await symlink(
          join(
            tree,
            "e.txt",
          ),
          join(
            tree,
            "linked.txt",
          ),
        );

        await expect(
          syncPortableReleaseTree({
            root:
              tree,

            files: [
              "linked.txt",
            ],
          }),
        ).rejects.toThrow(
          "Portable release installation failed: Authoritative release file is not a single-link regular file during durable sync: linked.txt",
        );
      },
    );

    it.each([
      "../escape.txt",
      "/absolute.txt",
      "a//d.txt",
      "a/./d.txt",
      "a\\d.txt",
      "",
    ])(
      "rejects the unsafe authoritative path %j before any sync",
      async unsafePath => {
        const tree =
          await treeFixture();

        let syncs =
          0;

        await expect(
          syncPortableReleaseTree(
            {
              root:
                tree,

              files: [
                unsafePath,
              ],
            },
            {
              syncFileHandle:
                async () => {
                  syncs +=
                    1;
                },

              syncDirectory:
                async () => {
                  syncs +=
                    1;
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Durable release tree sync received an unsafe authoritative path.",
        );

        expect(
          syncs,
        ).toBe(
          0,
        );
      },
    );

    it(
      "rejects duplicate and empty authoritative file lists",
      async () => {
        const tree =
          await treeFixture();

        await expect(
          syncPortableReleaseTree({
            root:
              tree,

            files: [
              "e.txt",
              "e.txt",
            ],
          }),
        ).rejects.toThrow(
          "Portable release installation failed: Durable release tree sync received a duplicate authoritative path.",
        );

        await expect(
          syncPortableReleaseTree({
            root:
              tree,

            files: [],
          }),
        ).rejects.toThrow(
          "Portable release installation failed: Durable release tree sync requires at least one authoritative file.",
        );
      },
    );

    it(
      "fails closed when a file or directory fsync fails",
      async () => {
        const tree =
          await treeFixture();

        await expect(
          syncPortableReleaseTree(
            {
              root:
                tree,

              files: [
                "e.txt",
              ],
            },
            {
              syncFileHandle:
                async () => {
                  throw new Error(
                    "synthetic-file-fsync-failure",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Authoritative release file could not be fsynced: e.txt",
        );

        await expect(
          syncPortableReleaseTree(
            {
              root:
                tree,

              files: [
                "e.txt",
              ],
            },
            {
              syncFileHandle:
                async () => {},

              syncDirectory:
                async () => {
                  throw new Error(
                    "synthetic-directory-fsync-failure",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Authoritative release directory could not be fsynced: .",
        );
      },
    );
  },
);
