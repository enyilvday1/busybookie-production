import {
  createHash,
} from "node:crypto";

import {
  lstat,
  mkdir,
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
  execFile,
} from "node:child_process";

import {
  promisify,
} from "node:util";

import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  verifyPortableReleaseArchive,
} from "../src/deployment/verifyPortableReleaseArchive.js";

async function verifyPortableReleaseArchiveWithMatchingAuthority(
  input: Readonly<{
    archivePath: string;
    treeManifestPath: string;
  }>,
) {
  const {
    createHash,
  } =
    await import(
      "node:crypto"
    );

  const archiveSha256 =
    createHash(
      "sha256",
    )
      .update(
        await readFile(
          input.archivePath,
        ),
      )
      .digest(
        "hex",
      );

  const treeManifestSha256 =
    createHash(
      "sha256",
    )
      .update(
        await readFile(
          input.treeManifestPath,
        ),
      )
      .digest(
        "hex",
      );

  return verifyPortableReleaseArchive({
    archivePath:
      input.archivePath,
    treeManifestPath:
      input.treeManifestPath,
    expectedArchiveSha256:
      archiveSha256,
    expectedTreeManifestSha256:
      treeManifestSha256,
  });
}

const execFileAsync =
  promisify(execFile);

const roots: string[] = [];

async function fixtureRoot(): Promise<string> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-release-archive-verify-",
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

function manifestLine(
  bytes: Buffer,
  relativePath: string,
): string {
  return `${sha256(bytes)} *./${relativePath}\n`;
}

async function createTarGz(
  root: string,
  entries: Readonly<
    Record<string, Buffer>
  >,
): Promise<string> {
  const source =
    resolve(
      root,
      "source",
    );

  await mkdir(
    source,
    {
      recursive: true,
    },
  );

  for (
    const [
      relativePath,
      bytes,
    ]
    of Object.entries(
      entries,
    )
  ) {
    const absolutePath =
      resolve(
        source,
        ...relativePath.split("/"),
      );

    await mkdir(
      resolve(
        absolutePath,
        "..",
      ),
      {
        recursive: true,
      },
    );

    await writeFile(
      absolutePath,
      bytes,
    );
  }

  const archive =
    resolve(
      root,
      "release.tar.gz",
    );

  await execFileAsync(
    "tar",
    [
      "--force-local",
      "--format=posix",
      "-czf",
      archive,
      "-C",
      source,
      ".",
    ],
  );

  return archive;
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
  "portable release archive verification",
  () => {
    it(
      "accepts an archive whose exact member inventory and member bytes match the whole-tree manifest",
      async () => {
        const root =
          await fixtureRoot();

        const packageJson =
          Buffer.from(
            "{\"name\":\"busybookie-production\"}\n",
            "utf8",
          );

        const identity =
          Buffer.from(
            "{\"schemaVersion\":\"2.0\"}\n",
            "utf8",
          );

        const archive =
          await createTarGz(
            root,
            {
              "busybookie-release-identity.json":
                identity,
              "package.json":
                packageJson,
            },
          );

        const manifest =
          resolve(
            root,
            "tree.sha256",
          );

        await writeFile(
          manifest,
          manifestLine(
            identity,
            "busybookie-release-identity.json",
          ) +
            manifestLine(
              packageJson,
              "package.json",
            ),
          "utf8",
        );

        const result =
          await verifyPortableReleaseArchiveWithMatchingAuthority({
            archivePath:
              archive,
            treeManifestPath:
              manifest,
          });

        expect(
          result.memberCount,
        ).toBe(
          2,
        );

        expect(
          result.members,
        ).toEqual([
          "busybookie-release-identity.json",
          "package.json",
        ]);

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.members,
          ),
        ).toBe(true);
      },
    );

    it(
      "rejects an archive containing an extra member absent from the manifest",
      async () => {
        const root =
          await fixtureRoot();

        const packageJson =
          Buffer.from(
            "{}\n",
            "utf8",
          );

        const extra =
          Buffer.from(
            "extra\n",
            "utf8",
          );

        const archive =
          await createTarGz(
            root,
            {
              "extra.txt":
                extra,
              "package.json":
                packageJson,
            },
          );

        const manifest =
          resolve(
            root,
            "tree.sha256",
          );

        await writeFile(
          manifest,
          manifestLine(
            packageJson,
            "package.json",
          ),
          "utf8",
        );

        await expect(
          verifyPortableReleaseArchiveWithMatchingAuthority({
            archivePath:
              archive,
            treeManifestPath:
              manifest,
          }),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects a manifest member missing from the archive",
      async () => {
        const root =
          await fixtureRoot();

        const packageJson =
          Buffer.from(
            "{}\n",
            "utf8",
          );

        const missing =
          Buffer.from(
            "missing\n",
            "utf8",
          );

        const archive =
          await createTarGz(
            root,
            {
              "package.json":
                packageJson,
            },
          );

        const manifest =
          resolve(
            root,
            "tree.sha256",
          );

        await writeFile(
          manifest,
          manifestLine(
            missing,
            "missing.txt",
          ) +
            manifestLine(
              packageJson,
              "package.json",
            ),
          "utf8",
        );

        await expect(
          verifyPortableReleaseArchiveWithMatchingAuthority({
            archivePath:
              archive,
            treeManifestPath:
              manifest,
          }),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects member bytes that do not match the manifest hash",
      async () => {
        const root =
          await fixtureRoot();

        const archived =
          Buffer.from(
            "actual\n",
            "utf8",
          );

        const expected =
          Buffer.from(
            "expected\n",
            "utf8",
          );

        const archive =
          await createTarGz(
            root,
            {
              "package.json":
                archived,
            },
          );

        const manifest =
          resolve(
            root,
            "tree.sha256",
          );

        await writeFile(
          manifest,
          manifestLine(
            expected,
            "package.json",
          ),
          "utf8",
        );

        await expect(
          verifyPortableReleaseArchiveWithMatchingAuthority({
            archivePath:
              archive,
            treeManifestPath:
              manifest,
          }),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects a non-regular archive member before extraction",
      async () => {
        const root =
          await fixtureRoot();

        const source =
          resolve(
            root,
            "source",
          );

        await mkdir(
          source,
          {
            recursive: true,
          },
        );

        await writeFile(
          resolve(
            source,
            "package.json",
          ),
          "{}\n",
          "utf8",
        );

        await execFileAsync(
          "ln",
          [
            "-s",
            "package.json",
            resolve(
              source,
              "alias.json",
            ),
          ],
        );

        const archive =
          resolve(
            root,
            "release.tar.gz",
          );

        await execFileAsync(
          "tar",
          [
            "--force-local",
      "--format=posix",
            "-czf",
            archive,
            "-C",
            source,
            ".",
          ],
        );

        const manifest =
          resolve(
            root,
            "tree.sha256",
          );

        const packageJson =
          await readFile(
            resolve(
              source,
              "package.json",
            ),
          );

        await writeFile(
          manifest,
          manifestLine(
            packageJson,
            "package.json",
          ),
          "utf8",
        );

        await expect(
          verifyPortableReleaseArchiveWithMatchingAuthority({
            archivePath:
              archive,
            treeManifestPath:
              manifest,
          }),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects an unsafe archive member path before extraction",
      async () => {
        const root =
          await fixtureRoot();

        const source =
          resolve(
            root,
            "source",
          );

        await mkdir(
          source,
          {
            recursive: true,
          },
        );

        await writeFile(
          resolve(
            source,
            "payload.txt",
          ),
          "payload\n",
          "utf8",
        );

        const archive =
          resolve(
            root,
            "release.tar.gz",
          );

        await execFileAsync(
          "tar",
          [
            "--force-local",
      "--format=posix",
            "-czf",
            archive,
            "--transform=s#^payload.txt$#../escape.txt#",
            "-C",
            source,
            "payload.txt",
          ],
        );

        const manifest =
          resolve(
            root,
            "tree.sha256",
          );

        await writeFile(
          manifest,
          manifestLine(
            Buffer.from(
              "payload\n",
              "utf8",
            ),
            "package.json",
          ),
          "utf8",
        );

        await expect(
          verifyPortableReleaseArchiveWithMatchingAuthority({
            archivePath:
              archive,
            treeManifestPath:
              manifest,
          }),
        ).rejects.toThrow();
      },
    );
  },
);


// D262_ADVERSARIAL_ARCHIVE_VERIFICATION
describe(
  "portable release archive adversarial verification",
  () => {
    it(
      "rejects duplicate regular-file archive members even when their bytes match",
      async () => {
        const root =
          await fixtureRoot();

        const source =
          resolve(
            root,
            "duplicate-source",
          );

        await mkdir(
          source,
          {
            recursive: true,
          },
        );

        const packageJson =
          Buffer.from(
            "{}\n",
            "utf8",
          );

        await writeFile(
          resolve(
            source,
            "package.json",
          ),
          packageJson,
        );

        const tarPath =
          resolve(
            root,
            "duplicate.tar",
          );

        await execFileAsync(
          "tar",
          [
            "--force-local",
            "--format=posix",
            "-cf",
            tarPath,
            "-C",
            source,
            "./package.json",
          ],
        );

        await execFileAsync(
          "tar",
          [
            "--force-local",
            "-rf",
            tarPath,
            "./package.json",
          ],
          {
            cwd:
              source,
          },
        );

        await execFileAsync(
          "gzip",
          [
            "--force",
            tarPath,
          ],
        );

        const archive =
          `${tarPath}.gz`;

        const manifest =
          resolve(
            root,
            "duplicate-tree.sha256",
          );

        await writeFile(
          manifest,
          manifestLine(
            packageJson,
            "package.json",
          ),
          "utf8",
        );

        await expect(
          verifyPortableReleaseArchiveWithMatchingAuthority({
            archivePath:
              archive,
            treeManifestPath:
              manifest,
          }),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects a hardlink member even when every pathname appears in the manifest",
      async () => {
        const root =
          await fixtureRoot();

        const source =
          resolve(
            root,
            "hardlink-source",
          );

        await mkdir(
          source,
          {
            recursive: true,
          },
        );

        const bytes =
          Buffer.from(
            "{}\n",
            "utf8",
          );

        const packageJson =
          resolve(
            source,
            "package.json",
          );

        const alias =
          resolve(
            source,
            "package-copy.json",
          );

        await writeFile(
          packageJson,
          bytes,
        );

        await execFileAsync(
          "ln",
          [
            packageJson,
            alias,
          ],
        );

        const archive =
          resolve(
            root,
            "hardlink.tar.gz",
          );

        await execFileAsync(
          "tar",
          [
            "--force-local",
            "--format=posix",
            "-czf",
            archive,
            "-C",
            source,
            ".",
          ],
        );

        const manifest =
          resolve(
            root,
            "hardlink-tree.sha256",
          );

        await writeFile(
          manifest,
          manifestLine(
            bytes,
            "package-copy.json",
          ) +
            manifestLine(
              bytes,
              "package.json",
            ),
          "utf8",
        );

        await expect(
          verifyPortableReleaseArchiveWithMatchingAuthority({
            archivePath:
              archive,
            treeManifestPath:
              manifest,
          }),
        ).rejects.toThrow();
      },
    );

    it.skipIf(
      process.platform === "win32",
    )(
      "rejects a symlink used as the release archive authority input",
      async () => {
        const root =
          await fixtureRoot();

        const bytes =
          Buffer.from(
            "{}\n",
            "utf8",
          );

        const archive =
          await createTarGz(
            root,
            {
              "package.json":
                bytes,
            },
          );

        const archiveAlias =
          resolve(
            root,
            "release-alias.tar.gz",
          );

        await symlink(
          archive,
          archiveAlias,
          "file",
        );

        expect(
          (
            await lstat(
              archiveAlias,
            )
          ).isSymbolicLink(),
        ).toBe(true);

        const manifest =
          resolve(
            root,
            "archive-symlink-tree.sha256",
          );

        await writeFile(
          manifest,
          manifestLine(
            bytes,
            "package.json",
          ),
          "utf8",
        );

        await expect(
          verifyPortableReleaseArchiveWithMatchingAuthority({
            archivePath:
              archiveAlias,
            treeManifestPath:
              manifest,
          }),
        ).rejects.toThrow();
      },
    );

    it.skipIf(
      process.platform === "win32",
    )(
      "rejects a symlink used as the whole-tree manifest authority input",
      async () => {
        const root =
          await fixtureRoot();

        const bytes =
          Buffer.from(
            "{}\n",
            "utf8",
          );

        const archive =
          await createTarGz(
            root,
            {
              "package.json":
                bytes,
            },
          );

        const manifest =
          resolve(
            root,
            "real-tree.sha256",
          );

        await writeFile(
          manifest,
          manifestLine(
            bytes,
            "package.json",
          ),
          "utf8",
        );

        const manifestAlias =
          resolve(
            root,
            "tree-alias.sha256",
          );

        await symlink(
          manifest,
          manifestAlias,
          "file",
        );

        expect(
          (
            await lstat(
              manifestAlias,
            )
          ).isSymbolicLink(),
        ).toBe(true);

        await expect(
          verifyPortableReleaseArchiveWithMatchingAuthority({
            archivePath:
              archive,
            treeManifestPath:
              manifestAlias,
          }),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects corrupted gzip archive bytes",
      async () => {
        const root =
          await fixtureRoot();

        const archive =
          resolve(
            root,
            "corrupt.tar.gz",
          );

        await writeFile(
          archive,
          Buffer.from(
            "not-a-gzip-archive\n",
            "utf8",
          ),
        );

        const manifest =
          resolve(
            root,
            "corrupt-tree.sha256",
          );

        await writeFile(
          manifest,
          manifestLine(
            Buffer.from(
              "{}\n",
              "utf8",
            ),
            "package.json",
          ),
          "utf8",
        );

        await expect(
          verifyPortableReleaseArchiveWithMatchingAuthority({
            archivePath:
              archive,
            treeManifestPath:
              manifest,
          }),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects a malformed whole-tree manifest before accepting archive bytes",
      async () => {
        const root =
          await fixtureRoot();

        const bytes =
          Buffer.from(
            "{}\n",
            "utf8",
          );

        const archive =
          await createTarGz(
            root,
            {
              "package.json":
                bytes,
            },
          );

        const manifest =
          resolve(
            root,
            "malformed-tree.sha256",
          );

        await writeFile(
          manifest,
          "not-a-valid-manifest\n",
          "utf8",
        );

        await expect(
          verifyPortableReleaseArchiveWithMatchingAuthority({
            archivePath:
              archive,
            treeManifestPath:
              manifest,
          }),
        ).rejects.toThrow();
      },
    );
  },
);


// D276_EXPECTED_SHA_AUTHORITY
describe(
  "portable release archive external SHA authority",
  () => {
    it(
      "accepts an archive only when both caller-supplied SHA authorities match the snapshotted inputs",
      async () => {
        const root =
          await fixtureRoot();

        const bytes =
          Buffer.from(
            "{}\n",
            "utf8",
          );

        const archive =
          await createTarGz(
            root,
            {
              "package.json":
                bytes,
            },
          );

        const manifest =
          resolve(
            root,
            "authority-tree.sha256",
          );

        await writeFile(
          manifest,
          manifestLine(
            bytes,
            "package.json",
          ),
          "utf8",
        );

        const {
          createHash,
        } =
          await import(
            "node:crypto"
          );

        const archiveSha256 =
          createHash(
            "sha256",
          )
            .update(
              await readFile(
                archive,
              ),
            )
            .digest(
              "hex",
            );

        const treeManifestSha256 =
          createHash(
            "sha256",
          )
            .update(
              await readFile(
                manifest,
              ),
            )
            .digest(
              "hex",
            );

        const result =
          await verifyPortableReleaseArchive(
            {
              archivePath:
                archive,
              treeManifestPath:
                manifest,
              expectedArchiveSha256:
                archiveSha256,
              expectedTreeManifestSha256:
                treeManifestSha256,
            },
          );

        expect(
          result.memberCount,
        ).toBe(1);
      },
    );

    it(
      "rejects an otherwise valid archive when the expected archive SHA-256 is wrong",
      async () => {
        const root =
          await fixtureRoot();

        const bytes =
          Buffer.from(
            "{}\n",
            "utf8",
          );

        const archive =
          await createTarGz(
            root,
            {
              "package.json":
                bytes,
            },
          );

        const manifest =
          resolve(
            root,
            "wrong-archive-authority-tree.sha256",
          );

        await writeFile(
          manifest,
          manifestLine(
            bytes,
            "package.json",
          ),
          "utf8",
        );

        const {
          createHash,
        } =
          await import(
            "node:crypto"
          );

        const treeManifestSha256 =
          createHash(
            "sha256",
          )
            .update(
              await readFile(
                manifest,
              ),
            )
            .digest(
              "hex",
            );

        await expect(
          verifyPortableReleaseArchive(
            {
              archivePath:
                archive,
              treeManifestPath:
                manifest,
              expectedArchiveSha256:
                "0".repeat(64),
              expectedTreeManifestSha256:
                treeManifestSha256,
            },
          ),
        ).rejects.toThrow();
      },
    );

    it(
      "rejects an otherwise valid archive when the expected whole-tree manifest SHA-256 is wrong",
      async () => {
        const root =
          await fixtureRoot();

        const bytes =
          Buffer.from(
            "{}\n",
            "utf8",
          );

        const archive =
          await createTarGz(
            root,
            {
              "package.json":
                bytes,
            },
          );

        const manifest =
          resolve(
            root,
            "wrong-manifest-authority-tree.sha256",
          );

        await writeFile(
          manifest,
          manifestLine(
            bytes,
            "package.json",
          ),
          "utf8",
        );

        const {
          createHash,
        } =
          await import(
            "node:crypto"
          );

        const archiveSha256 =
          createHash(
            "sha256",
          )
            .update(
              await readFile(
                archive,
              ),
            )
            .digest(
              "hex",
            );

        await expect(
          verifyPortableReleaseArchive(
            {
              archivePath:
                archive,
              treeManifestPath:
                manifest,
              expectedArchiveSha256:
                archiveSha256,
              expectedTreeManifestSha256:
                "0".repeat(64),
            },
          ),
        ).rejects.toThrow();
      },
    );
  },
);
