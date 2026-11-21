import {
  createHash,
} from "node:crypto";

import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
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
  createPortableReleaseVerificationSnapshot,
} from "../src/deployment/portableReleaseVerificationSnapshot.js";

const roots: string[] = [];

async function fixtureRoot(): Promise<string> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-release-snapshot-",
      ),
    );

  roots.push(
    root,
  );

  return root;
}

function sha256(
  bytes: Buffer,
): string {
  return createHash(
    "sha256",
  )
    .update(
      bytes,
    )
    .digest(
      "hex",
    );
}

afterEach(
  async () => {
    while (
      roots.length > 0
    ) {
      const root =
        roots.pop();

      if (root !== undefined) {
        await rm(
          root,
          {
            recursive: true,
            force: true,
          },
        );
      }
    }
  },
);

describe(
  "portable release verification snapshot",
  () => {
    it(
      "creates private regular-file snapshots whose bytes and hashes exactly match both authority inputs",
      async () => {
        const root =
          await fixtureRoot();

        const archiveBytes =
          Buffer.from(
            "archive-authority-bytes\n",
            "utf8",
          );

        const manifestBytes =
          Buffer.from(
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa *./package.json\n",
            "utf8",
          );

        const archivePath =
          resolve(
            root,
            "release.tar.gz",
          );

        const manifestPath =
          resolve(
            root,
            "release-tree.sha256",
          );

        await writeFile(
          archivePath,
          archiveBytes,
        );

        await writeFile(
          manifestPath,
          manifestBytes,
        );

        const snapshot =
          await createPortableReleaseVerificationSnapshot({
            archivePath,
            treeManifestPath:
              manifestPath,
          });

        expect(
          snapshot.archivePath,
        ).not.toBe(
          archivePath,
        );

        expect(
          snapshot.treeManifestPath,
        ).not.toBe(
          manifestPath,
        );

        expect(
          snapshot.archiveSha256,
        ).toBe(
          sha256(
            archiveBytes,
          ),
        );

        expect(
          snapshot.treeManifestSha256,
        ).toBe(
          sha256(
            manifestBytes,
          ),
        );

        expect(
          await readFile(
            snapshot.archivePath,
          ),
        ).toEqual(
          archiveBytes,
        );

        expect(
          await readFile(
            snapshot.treeManifestPath,
          ),
        ).toEqual(
          manifestBytes,
        );

        const archiveMetadata =
          await lstat(
            snapshot.archivePath,
          );

        const manifestMetadata =
          await lstat(
            snapshot.treeManifestPath,
          );

        expect(
          archiveMetadata.isFile(),
        ).toBe(true);

        expect(
          archiveMetadata.isSymbolicLink(),
        ).toBe(false);

        expect(
          archiveMetadata.nlink,
        ).toBe(1);

        expect(
          manifestMetadata.isFile(),
        ).toBe(true);

        expect(
          manifestMetadata.isSymbolicLink(),
        ).toBe(false);

        expect(
          manifestMetadata.nlink,
        ).toBe(1);

        expect(
          Object.isFrozen(
            snapshot,
          ),
        ).toBe(true);

        await snapshot.cleanup();

        await expect(
          lstat(
            snapshot.root,
          ),
        ).rejects.toMatchObject({
          code:
            "ENOENT",
        });
      },
    );

    it(
      "remains byte-authoritative after the original archive and manifest paths are replaced",
      async () => {
        const root =
          await fixtureRoot();

        const archiveOriginal =
          Buffer.from(
            "archive-original\n",
            "utf8",
          );

        const manifestOriginal =
          Buffer.from(
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb *./package.json\n",
            "utf8",
          );

        const archivePath =
          resolve(
            root,
            "release.tar.gz",
          );

        const manifestPath =
          resolve(
            root,
            "release-tree.sha256",
          );

        await writeFile(
          archivePath,
          archiveOriginal,
        );

        await writeFile(
          manifestPath,
          manifestOriginal,
        );

        const snapshot =
          await createPortableReleaseVerificationSnapshot({
            archivePath,
            treeManifestPath:
              manifestPath,
          });

        await writeFile(
          archivePath,
          "archive-replaced\n",
          "utf8",
        );

        await writeFile(
          manifestPath,
          "manifest-replaced\n",
          "utf8",
        );

        expect(
          await readFile(
            snapshot.archivePath,
          ),
        ).toEqual(
          archiveOriginal,
        );

        expect(
          await readFile(
            snapshot.treeManifestPath,
          ),
        ).toEqual(
          manifestOriginal,
        );

        expect(
          snapshot.archiveSha256,
        ).toBe(
          sha256(
            archiveOriginal,
          ),
        );

        expect(
          snapshot.treeManifestSha256,
        ).toBe(
          sha256(
            manifestOriginal,
          ),
        );

        await snapshot.cleanup();
      },
    );

    it(
      "rejects a multi-link archive authority input",
      async () => {
        const root =
          await fixtureRoot();

        const archivePath =
          resolve(
            root,
            "release.tar.gz",
          );

        const secondName =
          resolve(
            root,
            "release-second-name.tar.gz",
          );

        await writeFile(
          archivePath,
          "archive\n",
          "utf8",
        );

        const {
          link,
        } =
          await import(
            "node:fs/promises"
          );

        await link(
          archivePath,
          secondName,
        );

        const manifestPath =
          resolve(
            root,
            "tree.sha256",
          );

        await writeFile(
          manifestPath,
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa *./package.json\n",
          "utf8",
        );

        await expect(
          createPortableReleaseVerificationSnapshot({
            archivePath,
            treeManifestPath:
              manifestPath,
          }),
        ).rejects.toThrow();
      },
    );

    it.skipIf(
      process.platform === "win32",
    )(
      "rejects a symlink archive authority input",
      async () => {
        const root =
          await fixtureRoot();

        const realArchive =
          resolve(
            root,
            "real-release.tar.gz",
          );

        const aliasArchive =
          resolve(
            root,
            "alias-release.tar.gz",
          );

        await writeFile(
          realArchive,
          "archive\n",
          "utf8",
        );

        await symlink(
          realArchive,
          aliasArchive,
          "file",
        );

        expect(
          (
            await lstat(
              aliasArchive,
            )
          ).isSymbolicLink(),
        ).toBe(true);

        const manifestPath =
          resolve(
            root,
            "tree.sha256",
          );

        await writeFile(
          manifestPath,
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa *./package.json\n",
          "utf8",
        );

        await expect(
          createPortableReleaseVerificationSnapshot({
            archivePath:
              aliasArchive,
            treeManifestPath:
              manifestPath,
          }),
        ).rejects.toThrow();
      },
    );

    it.skipIf(
      process.platform === "win32",
    )(
      "rejects a symlink manifest authority input",
      async () => {
        const root =
          await fixtureRoot();

        const archivePath =
          resolve(
            root,
            "release.tar.gz",
          );

        await writeFile(
          archivePath,
          "archive\n",
          "utf8",
        );

        const realManifest =
          resolve(
            root,
            "real-tree.sha256",
          );

        const aliasManifest =
          resolve(
            root,
            "alias-tree.sha256",
          );

        await writeFile(
          realManifest,
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa *./package.json\n",
          "utf8",
        );

        await symlink(
          realManifest,
          aliasManifest,
          "file",
        );

        expect(
          (
            await lstat(
              aliasManifest,
            )
          ).isSymbolicLink(),
        ).toBe(true);

        await expect(
          createPortableReleaseVerificationSnapshot({
            archivePath,
            treeManifestPath:
              aliasManifest,
          }),
        ).rejects.toThrow();
      },
    );
  },
);
