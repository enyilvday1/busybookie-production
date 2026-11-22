import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";

import {
  constants,
} from "node:fs";

import {
  createHash,
} from "node:crypto";

import {
  dirname,
  join,
} from "node:path";

import {
  tmpdir,
} from "node:os";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Pass-through fault hooks: each fires only for one exact armed path, so every other filesystem call
// behaves exactly as the real module.
const filesystemFaults =
  vi.hoisted(
    () => ({
      failRemovePath:
        null as string | null,

      failLstatPath:
        null as string | null,
    }),
  );

vi.mock(
  "node:fs/promises",
  async importOriginal => {
    const actual =
      await importOriginal<typeof import("node:fs/promises")>();

    const rm =
      (
        async (
          ...args: Parameters<typeof actual.rm>
        ) => {
          if (
            filesystemFaults.failRemovePath !==
              null &&
            String(
              args[0],
            ) ===
              filesystemFaults.failRemovePath
          ) {
            throw Object.assign(
              new Error(
                "synthetic-release-remove-failure",
              ),
              {
                code:
                  "EBUSY",
              },
            );
          }

          return actual.rm(
            ...args,
          );
        }
      ) as typeof actual.rm;

    const lstat =
      (
        async (
          ...args: Parameters<typeof actual.lstat>
        ) => {
          if (
            filesystemFaults.failLstatPath !==
              null &&
            String(
              args[0],
            ) ===
              filesystemFaults.failLstatPath
          ) {
            throw Object.assign(
              new Error(
                "synthetic-receipt-lstat-failure",
              ),
              {
                code:
                  "EIO",
              },
            );
          }

          return actual.lstat(
            ...args,
          );
        }
      ) as typeof actual.lstat;

    return {
      ...actual,
      rm,
      lstat,
    };
  },
);

afterEach(
  () => {
    filesystemFaults.failRemovePath =
      null;

    filesystemFaults.failLstatPath =
      null;
  },
);

import {
  installPortableRelease,
} from "../src/deployment/installPortableRelease.js";

import {
  createPortableReleaseDependencyTreeManifest,
} from "../src/deployment/portableReleaseDependencyTreeManifest.js";

import {
  publishPortableReleaseAtomically,
} from "../src/deployment/portableReleaseFilesystem.js";

import {
  syncPortableReleaseDirectory,
  syncPortableReleaseTree,
} from "../src/deployment/portableReleaseFilesystemDurability.js";

import {
  writePortableReleaseInstallReceipt,
} from "../src/deployment/portableReleaseInstallReceiptStore.js";

const REVISION =
  "0ff4981807eb8db6a0aac73fefbd94292d7d12ef";

const ARCHIVE_SHA =
  "a".repeat(64);

const TREE_MANIFEST_SHA =
  "b".repeat(64);

const temporaryRoots: string[] =
  [];

afterEach(
  async () => {
    for (
      const root
      of temporaryRoots.splice(
        0,
      )
    ) {
      await rm(
        root,
        {
          recursive: true,
          force: true,
        },
      );
    }
  },
);

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

async function root(): Promise<string> {
  const value =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-install-contract-",
      ),
    );

  temporaryRoots.push(
    value,
  );

  return value;
}

async function exists(
  path: string,
): Promise<boolean> {
  try {
    await access(
      path,
      constants.F_OK,
    );

    return true;
  } catch {
    return false;
  }
}

async function write(
  rootPath: string,
  relativePath: string,
  bytes: Buffer,
): Promise<void> {
  const path =
    join(
      rootPath,
      ...relativePath.split(
        "/",
      ),
    );

  await mkdir(
    dirname(
      path,
    ),
    {
      recursive: true,
    },
  );

  await writeFile(
    path,
    bytes,
    {
      flag: "wx",
    },
  );
}

async function quarantineEntries(
  releasesRoot: string,
): Promise<string[]> {
  const quarantineRoot =
    join(
      releasesRoot,
      ".quarantine",
    );

  if (
    !(
      await exists(
        quarantineRoot,
      )
    )
  ) {
    return [];
  }

  return readdir(
    quarantineRoot,
  );
}

function installRequest(
  h: Harness,
) {
  return Object.freeze({
    archivePath:
      h.archivePath,

    treeManifestPath:
      h.treeManifestPath,

    expectedArchiveSha256:
      ARCHIVE_SHA,

    expectedTreeManifestSha256:
      TREE_MANIFEST_SHA,

    expectedReviewedRevision:
      REVISION,

    releasesRoot:
      h.releasesRoot,

    stagingRoot:
      h.stagingRoot,
  });
}

type FakeVerifiedRelease =
  Readonly<{
    reviewedRevision: string;
    root: string;
    manifest: Readonly<{
      rawSha256: string | null;
    }>;
    files: readonly unknown[];
  }>;

type Harness =
  Readonly<{
    deploymentRoot: string;
    releasesRoot: string;
    stagingRoot: string;
    archivePath: string;
    treeManifestPath: string;
    extractedFixtureRoot: string;
    events: string[];
  }>;

async function harness(): Promise<Harness> {
  const deploymentRoot =
    await root();

  const releasesRoot =
    join(
      deploymentRoot,
      "releases",
    );

  const stagingRoot =
    join(
      deploymentRoot,
      ".installing",
    );

  await mkdir(
    releasesRoot,
    {
      recursive: true,
    },
  );

  await mkdir(
    stagingRoot,
    {
      recursive: true,
    },
  );

  const archivePath =
    join(
      deploymentRoot,
      "release.tar.gz",
    );

  const treeManifestPath =
    join(
      deploymentRoot,
      "release-tree.sha256",
    );

  await writeFile(
    archivePath,
    Buffer.from(
      "archive-authority\n",
    ),
  );

  const manifestEntries =
    [
      [
        "apps/operator-console/dist/assets/index-Test.js",
        Buffer.from(
          "export {};\n",
        ),
      ],
      [
        "apps/operator-console/dist/index.html",
        Buffer.from(
          "<html></html>\n",
        ),
      ],
      [
        "dist/operatorServer/operatorServerProcess.js",
        Buffer.from(
          "export {};\n",
        ),
      ],
      [
        "package-lock.json",
        Buffer.from(
          "{}\n",
        ),
      ],
      [
        "package.json",
        Buffer.from(
          "{}\n",
        ),
      ],
    ] as const;

  await writeFile(
    treeManifestPath,
    Buffer.from(
      manifestEntries
        .map(
          (
            [
              relativePath,
              bytes,
            ],
          ) =>
            `${sha256(
              bytes,
            )} *./${relativePath}\n`,
        )
        .join(
          "",
        ),
      "utf8",
    ),
  );

  const extractedFixtureRoot =
    join(
      deploymentRoot,
      "fixture-release",
    );

  await mkdir(
    extractedFixtureRoot,
    {
      recursive: true,
    },
  );

  await write(
    extractedFixtureRoot,
    "package.json",
    Buffer.from(
      "{}\n",
    ),
  );

  await write(
    extractedFixtureRoot,
    "package-lock.json",
    Buffer.from(
      "{}\n",
    ),
  );

  await write(
    extractedFixtureRoot,
    "dist/operatorServer/operatorServerProcess.js",
    Buffer.from(
      "export {};\n",
    ),
  );

  await write(
    extractedFixtureRoot,
    "apps/operator-console/dist/index.html",
    Buffer.from(
      "<html></html>\n",
    ),
  );

  await write(
    extractedFixtureRoot,
    "apps/operator-console/dist/assets/index-Test.js",
    Buffer.from(
      "export {};\n",
    ),
  );

  const events: string[] =
    [];

  return Object.freeze({
    deploymentRoot,
    releasesRoot,
    stagingRoot,
    archivePath,
    treeManifestPath,
    extractedFixtureRoot,
    events,
  });
}

function dependencies(
  h: Harness,
  options: Readonly<{
    reviewedRevision?: string;
    failWholeTree?: boolean;
    failIdentity?: boolean;
    failPublish?: boolean;
  }> = {},
) {
  let testLockTail:
    Promise<void> =
      Promise.resolve();

  const acquireTestFlockRevisionLock =
    async () => {
      const previousTail =
        testLockTail;

      let releaseCurrent:
        () => void =
          () => {};

      const currentLease =
        new Promise<void>(
          resolveLease => {
            releaseCurrent =
              resolveLease;
          },
        );

      testLockTail =
        previousTail.then(
          () =>
            currentLease,
        );

      await previousTail;

      let released =
        false;

      return Object.freeze({
        release:
          async () => {
            if (released) {
              return;
            }

            released =
              true;

            releaseCurrent();
          },
      });
    };

  return Object.freeze({
    platform:
      "linux",

    acquireFlockRevisionLock:
      acquireTestFlockRevisionLock,

    verifyPortableReleaseArchive:
      async () => {
        h.events.push(
          "verify-authority",
        );

        return Object.freeze({
          memberCount: 5,
          members: Object.freeze([
            "apps/operator-console/dist/assets/index-Test.js",
            "apps/operator-console/dist/index.html",
            "dist/operatorServer/operatorServerProcess.js",
            "package-lock.json",
            "package.json",
          ]),
        });
      },

    extractVerifiedArchive:
      async (
        input: Readonly<{
          destinationRoot: string;
        }>,
      ) => {
        h.events.push(
          "extract",
        );

        const copy = async (
          relativePath: string,
        ) => {
          const source =
            join(
              h.extractedFixtureRoot,
              ...relativePath.split(
                "/",
              ),
            );

          await write(
            input.destinationRoot,
            relativePath,
            await readFile(
              source,
            ),
          );
        };

        await copy(
          "package.json",
        );

        await copy(
          "package-lock.json",
        );

        await copy(
          "dist/operatorServer/operatorServerProcess.js",
        );

        await copy(
          "apps/operator-console/dist/index.html",
        );

        await copy(
          "apps/operator-console/dist/assets/index-Test.js",
        );
      },

    verifyPortableReleaseExtractedTree:
      async () => {
        h.events.push(
          "verify-whole-tree",
        );

        if (options.failWholeTree) {
          throw new Error(
            "whole-tree-failure",
          );
        }

        return Object.freeze({
          fileCount: 5,
          files: Object.freeze([
            "apps/operator-console/dist/assets/index-Test.js",
            "apps/operator-console/dist/index.html",
            "dist/operatorServer/operatorServerProcess.js",
            "package-lock.json",
            "package.json",
          ]),
        });
      },

    requirePortableReleaseIdentity:
      async (
        releaseRoot: string,
      ): Promise<FakeVerifiedRelease> => {
        h.events.push(
          "verify-runtime-identity",
        );

        if (options.failIdentity) {
          throw new Error(
            "identity-failure",
          );
        }

        return Object.freeze({
          reviewedRevision:
            options.reviewedRevision ??
            REVISION,

          root:
            releaseRoot,

          manifest:
            Object.freeze({
              rawSha256:
                sha256(
                  Buffer.from(
                    "identity\n",
                  ),
                ),
            }),

          files:
            Object.freeze([]),
        });
      },

    prepareProductionDependencies:
      async (
        input: Readonly<{
          revisionRoot: string;
          artifactRoot: string;
        }>,
      ) => {
        await write(
          input.revisionRoot,
          "node_modules/busybookie-test-runtime/index.js",
          Buffer.from(
            "export const busybookieTestRuntime = true;\n",
          ),
        );

        return createPortableReleaseDependencyTreeManifest(
          join(
            input.revisionRoot,
            "node_modules",
          ),
        );
      },

    createDependencyManifest:
      createPortableReleaseDependencyTreeManifest,

    ...(
      options.failPublish
        ? {
            publishInstalledRelease:
              async () => {
                h.events.push(
                  "publish",
                );

                throw new Error(
                  "publish-failure",
                );
              },
          }
        : {}
    ),
  });
}

describe(
  "portable release installation",
  () => {
    it(
      "verifies authority, extracts privately, verifies whole tree, verifies runtime identity, then publishes exactly one immutable revision directory",
      async () => {
        const h =
          await harness();

        const result =
          await installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            dependencies(
              h,
            ),
          );

        expect(
          h.events,
        ).toEqual([
          "verify-authority",
          "extract",
          "verify-whole-tree",
          "verify-runtime-identity",
        ]);

        expect(
          result.reviewedRevision,
        ).toBe(
          REVISION,
        );

        expect(
          result.releaseRoot,
        ).toBe(
          join(
            h.releasesRoot,
            REVISION,
            "app",
          ),
        );

        expect(
          await exists(
            result.releaseRoot,
          ),
        ).toBe(
          true,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
              "node_modules",
            ),
          ),
        ).toBe(
          true,
        );

        expect(
          await exists(
            join(
              result.releaseRoot,
              "node_modules",
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "rejects private dependency bytes changed after preparation authority is returned and before revision publication",
      async () => {
        const h =
          await harness();

        const finalRoot =
          join(
            h.releasesRoot,
            REVISION,
          );

        let returnedManifestSha256:
          string |
          null =
            null;

        const baseDependencies =
          dependencies(
            h,
          );

        await expect(
          installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            {
              ...baseDependencies,

              prepareProductionDependencies:
                async input => {
                  const dependencyRoot =
                    join(
                      input.revisionRoot,
                      "node_modules",
                    );

                  const dependencyFile =
                    join(
                      dependencyRoot,
                      "busybookie-test-runtime",
                      "index.js",
                    );

                  await write(
                    input.revisionRoot,
                    "node_modules/busybookie-test-runtime/index.js",
                    Buffer.from(
                      "export const busybookieTestRuntime = true;\n",
                    ),
                  );

                  const manifest =
                    await createPortableReleaseDependencyTreeManifest(
                      dependencyRoot,
                    );

                  returnedManifestSha256 =
                    manifest.manifestSha256;

                  await writeFile(
                    dependencyFile,
                    Buffer.from(
                      "export const busybookieTestRuntime = false;\n",
                    ),
                  );

                  return manifest;
                },
            },
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Private production dependencies changed after dependency preparation.",
        );

        expect(
          returnedManifestSha256,
        ).not.toBeNull();

        expect(
          await exists(
            finalRoot,
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "never overwrites an existing receipt-less revision directory and preserves it in quarantine",
      async () => {
        const h =
          await harness();

        const finalRoot =
          join(
            h.releasesRoot,
            REVISION,
          );

        await mkdir(
          finalRoot,
        );

        await write(
          finalRoot,
          "existing-evidence.txt",
          Buffer.from(
            "existing\n",
          ),
        );

        await expect(
          installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            dependencies(
              h,
              {
                failWholeTree:
                  true,
              },
            ),
          ),
        ).rejects.toThrow(
          "whole-tree-failure",
        );

        expect(
          h.events,
        ).toEqual([
          "verify-authority",
          "extract",
          "verify-whole-tree",
        ]);

        expect(
          await exists(
            finalRoot,
          ),
        ).toBe(
          false,
        );

        const entries =
          await quarantineEntries(
            h.releasesRoot,
          );

        expect(
          entries,
        ).toHaveLength(
          1,
        );

        expect(
          await readFile(
            join(
              h.releasesRoot,
              ".quarantine",
              entries[0] ?? "",
              "existing-evidence.txt",
            ),
            "utf8",
          ),
        ).toBe(
          "existing\n",
        );
      },
    );

    it(
      "fails closed when runtime identity reports a different reviewed revision and publishes nothing",
      async () => {
        const h =
          await harness();

        await expect(
          installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            dependencies(
              h,
              {
                reviewedRevision:
                  "1".repeat(
                    40,
                  ),
              },
            ),
          ),
        ).rejects.toThrow();

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          h.events,
        ).toEqual([
          "verify-authority",
          "extract",
          "verify-whole-tree",
          "verify-runtime-identity",
        ]);
      },
    );

    it(
      "cleans its private staging directory when whole-tree verification fails",
      async () => {
        const h =
          await harness();

        await expect(
          installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            dependencies(
              h,
              {
                failWholeTree:
                  true,
              },
            ),
          ),
        ).rejects.toThrow();

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          h.events,
        ).toEqual([
          "verify-authority",
          "extract",
          "verify-whole-tree",
        ]);
      },
    );

    it(
      "cleans its private staging directory when runtime identity verification fails",
      async () => {
        const h =
          await harness();

        await expect(
          installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            dependencies(
              h,
              {
                failIdentity:
                  true,
              },
            ),
          ),
        ).rejects.toThrow();

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
            ),
          ),
        ).toBe(
          false,
        );
      },
    );

    it(
      "does not create current or previous pointers during installation",
      async () => {
        const h =
          await harness();

        await installPortableRelease(
          {
            archivePath:
              h.archivePath,

            treeManifestPath:
              h.treeManifestPath,

            expectedArchiveSha256:
              ARCHIVE_SHA,

            expectedTreeManifestSha256:
              TREE_MANIFEST_SHA,

            expectedReviewedRevision:
              REVISION,

            releasesRoot:
              h.releasesRoot,

            stagingRoot:
              h.stagingRoot,
          },
          dependencies(
            h,
          ),
        );

        expect(
          await exists(
            join(
              h.deploymentRoot,
              "current",
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          await exists(
            join(
              h.deploymentRoot,
              "previous",
            ),
          ),
        ).toBe(
          false,
        );
      },
    );
  },
);

describe(
  "portable release installation durable receipt and replay",
  () => {
    it(
      "writes a durable deterministic install receipt outside the immutable release root",
      async () => {
        const h =
          await harness();

        const result =
          await installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            dependencies(
              h,
            ),
          );

        expect(
          result.receiptPath,
        ).toBe(
          join(
            h.releasesRoot,
            ".receipts",
            `${REVISION}.json`,
          ),
        );

        expect(
          await exists(
            result.receiptPath,
          ),
        ).toBe(
          true,
        );

        expect(
          result.receiptPath.startsWith(
            `${result.releaseRoot}/`,
          ),
        ).toBe(
          false,
        );

        const receipt =
          JSON.parse(
            await readFile(
              result.receiptPath,
              "utf8",
            ),
          ) as Record<string, unknown>;

        expect(
          receipt,
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
            TREE_MANIFEST_SHA,

          identityManifestSha256:
            result.identityManifestSha256,

          installedFileCount:
            5,

          dependencyManifestSha256:
            "e2cb3de0cb09fb4056761cd40182aca44031cdb854b7aca29f24a859e411697e",

          dependencyFileCount:
            1,

          dependencyTotalBytes:
            43,
        });
      },
    );

    it(
      "replays an already-installed identical release exactly without extracting or republishing it",
      async () => {
        const h =
          await harness();

        const first =
          await installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            dependencies(
              h,
            ),
          );

        h.events.length =
          0;

        const forbidden:
          string[] =
            [];

        const second =
          await installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            {
              ...dependencies(
                h,
              ),

              prepareProductionDependencies:
                async () => {
                  forbidden.push(
                    "prepare-dependencies",
                  );

                  throw new Error(
                    "exact replay must not prepare dependencies",
                  );
                },

              publishInstalledRelease:
                async () => {
                  forbidden.push(
                    "publish",
                  );

                  throw new Error(
                    "exact replay must not publish",
                  );
                },

              syncReleaseTree:
                async () => {
                  forbidden.push(
                    "sync-release-tree",
                  );
                },

              writeInstallReceipt:
                async () => {
                  forbidden.push(
                    "write-receipt",
                  );
                },
            },
          );

        expect(
          second,
        ).toEqual(
          first,
        );

        expect(
          second.releaseRoot,
        ).toBe(
          first.releaseRoot,
        );

        expect(
          second.receiptPath,
        ).toBe(
          first.receiptPath,
        );

        expect(
          h.events,
        ).not.toContain(
          "extract",
        );

        expect(
          h.events,
        ).not.toContain(
          "publish",
        );

        expect(
          forbidden,
        ).toEqual(
          [],
        );
      },
    );

    it(
      "rejects exact replay after the sibling dependency tree is tampered",
      async () => {
        const h =
          await harness();

        const first =
          await installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            dependencies(
              h,
            ),
          );

        const receiptBefore =
          await readFile(
            first.receiptPath,
          );

        await writeFile(
          join(
            h.releasesRoot,
            REVISION,
            "node_modules",
            "busybookie-test-runtime",
            "index.js",
          ),
          Buffer.from(
            "export const busybookieTestRuntime = \"tampered\";\n",
          ),
        );

        const tamperedManifest =
          await createPortableReleaseDependencyTreeManifest(
            join(
              h.releasesRoot,
              REVISION,
              "node_modules",
            ),
          );

        expect(
          tamperedManifest.manifestSha256,
        ).not.toBe(
          first.dependencyManifestSha256,
        );

        h.events.length =
          0;

        await expect(
          installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            dependencies(
              h,
            ),
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Existing immutable release receipt does not match the requested release authorities.",
        );

        expect(
          await readFile(
            first.receiptPath,
          ),
        ).toEqual(
          receiptBefore,
        );

        expect(
          h.events,
        ).toEqual([
          "verify-authority",
          "verify-whole-tree",
          "verify-runtime-identity",
        ]);

        expect(
          h.events,
        ).not.toContain(
          "extract",
        );

        expect(
          h.events,
        ).not.toContain(
          "publish",
        );
      },
    );

    it(
      "refuses an existing revision directory that is not backed by the exact matching durable receipt",
      async () => {
        const h =
          await harness();

        const finalRoot =
          join(
            h.releasesRoot,
            REVISION,
          );

        await mkdir(
          finalRoot,
        );

        const receiptsRoot =
          join(
            h.releasesRoot,
            ".receipts",
          );

        await mkdir(
          receiptsRoot,
          {
            recursive: true,
          },
        );

        await writeFile(
          join(
            receiptsRoot,
            `${REVISION}.json`,
          ),
          JSON.stringify(
            {
              schemaVersion:
                "1.0",

              kind:
                "BUSYBOOKIE_PORTABLE_RELEASE_INSTALL_RECEIPT",

              reviewedRevision:
                REVISION,

              archiveSha256:
                "c".repeat(
                  64,
                ),

              treeManifestSha256:
                TREE_MANIFEST_SHA,

              identityManifestSha256:
                "d".repeat(
                  64,
                ),

              installedFileCount:
                5,
            },
            null,
            2,
          ) + "\n",
          {
            flag: "wx",
          },
        );

        await expect(
          installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            dependencies(
              h,
            ),
          ),
        ).rejects.toThrow();

        expect(
          h.events,
        ).not.toContain(
          "extract",
        );

        expect(
          h.events,
        ).not.toContain(
          "publish",
        );
      },
    );

    it(
      "does not place the install receipt inside the packaged release tree",
      async () => {
        const h =
          await harness();

        const result =
          await installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            dependencies(
              h,
            ),
          );

        expect(
          await exists(
            join(
              result.releaseRoot,
              "busybookie-install-receipt.json",
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          await exists(
            result.receiptPath,
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);

describe(
  "portable release installation crash recovery",
  () => {
    it(
      "quarantines a receipt-less published release even when its trees would verify, then installs fresh",
      async () => {
        const h =
          await harness();

        const finalRoot =
          join(
            h.releasesRoot,
            REVISION,
          );

        const appRoot =
          join(
            finalRoot,
            "app",
          );

        await mkdir(
          appRoot,
          {
            recursive:
              true,
          },
        );

        const copy =
          async (
            relativePath: string,
          ) => {
            const source =
              join(
                h.extractedFixtureRoot,
                ...relativePath.split(
                  "/",
                ),
              );

            await write(
              appRoot,
              relativePath,
              await readFile(
                source,
              ),
            );
          };

        await copy(
          "package.json",
        );

        await copy(
          "package-lock.json",
        );

        await copy(
          "dist/operatorServer/operatorServerProcess.js",
        );

        await copy(
          "apps/operator-console/dist/index.html",
        );

        await copy(
          "apps/operator-console/dist/assets/index-Test.js",
        );

        await write(
          finalRoot,
          "node_modules/busybookie-test-runtime/index.js",
          Buffer.from(
            "export const busybookieTestRuntime = \"uncommitted-residue\";\n",
          ),
        );

        const synced:
          string[] =
            [];

        let preparations =
          0;

        const base =
          dependencies(
            h,
          );

        const result =
          await installPortableRelease(
            installRequest(
              h,
            ),
            {
              ...base,

              syncDirectory:
                async directory => {
                  synced.push(
                    directory,
                  );

                  await syncPortableReleaseDirectory(
                    directory,
                  );
                },

              prepareProductionDependencies:
                async input => {
                  preparations +=
                    1;

                  return base.prepareProductionDependencies(
                    input,
                  );
                },
            },
          );

        const quarantineRoot =
          join(
            h.releasesRoot,
            ".quarantine",
          );

        const entries =
          await quarantineEntries(
            h.releasesRoot,
          );

        expect(
          entries,
        ).toHaveLength(
          1,
        );

        expect(
          entries[0],
        ).toMatch(
          new RegExp(
            `^${REVISION}\\.[0-9a-z]+-[0-9a-f]{16}$`,
            "u",
          ),
        );

        const quarantined =
          join(
            quarantineRoot,
            entries[0] ?? "",
          );

        expect(
          await readFile(
            join(
              quarantined,
              "node_modules",
              "busybookie-test-runtime",
              "index.js",
            ),
            "utf8",
          ),
        ).toBe(
          "export const busybookieTestRuntime = \"uncommitted-residue\";\n",
        );

        expect(
          await readFile(
            join(
              quarantined,
              "app",
              "package.json",
            ),
          ),
        ).toEqual(
          await readFile(
            join(
              h.extractedFixtureRoot,
              "package.json",
            ),
          ),
        );

        expect(
          synced.slice(
            0,
            2,
          ),
        ).toEqual([
          h.releasesRoot,
          quarantineRoot,
        ]);

        expect(
          preparations,
        ).toBe(
          1,
        );

        expect(
          h.events,
        ).toEqual([
          "verify-authority",
          "extract",
          "verify-whole-tree",
          "verify-runtime-identity",
        ]);

        expect(
          await readFile(
            join(
              finalRoot,
              "node_modules",
              "busybookie-test-runtime",
              "index.js",
            ),
            "utf8",
          ),
        ).toBe(
          "export const busybookieTestRuntime = true;\n",
        );

        expect(
          result.dependencyManifestSha256,
        ).toBe(
          (
            await createPortableReleaseDependencyTreeManifest(
              join(
                finalRoot,
                "node_modules",
              ),
            )
          ).manifestSha256,
        );

        expect(
          await exists(
            result.receiptPath,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "quarantines a changed receipt-less dependency tree instead of blessing it, then reinstalls fresh dependencies",
      async () => {
        const h =
          await harness();

        const first =
          await installPortableRelease(
            installRequest(
              h,
            ),
            dependencies(
              h,
            ),
          );

        await rm(
          first.receiptPath,
          {
            force:
              true,
          },
        );

        await writeFile(
          join(
            h.releasesRoot,
            REVISION,
            "node_modules",
            "busybookie-test-runtime",
            "index.js",
          ),
          Buffer.from(
            "export const busybookieTestRuntime = \"tampered-after-publication\";\n",
          ),
        );

        const tamperedManifest =
          await createPortableReleaseDependencyTreeManifest(
            join(
              h.releasesRoot,
              REVISION,
              "node_modules",
            ),
          );

        expect(
          tamperedManifest.manifestSha256,
        ).not.toBe(
          first.dependencyManifestSha256,
        );

        h.events.length =
          0;

        const second =
          await installPortableRelease(
            installRequest(
              h,
            ),
            dependencies(
              h,
            ),
          );

        expect(
          second.dependencyManifestSha256,
        ).toBe(
          first.dependencyManifestSha256,
        );

        expect(
          second.dependencyManifestSha256,
        ).not.toBe(
          tamperedManifest.manifestSha256,
        );

        expect(
          h.events,
        ).toContain(
          "extract",
        );

        expect(
          await readFile(
            join(
              h.releasesRoot,
              REVISION,
              "node_modules",
              "busybookie-test-runtime",
              "index.js",
            ),
            "utf8",
          ),
        ).toBe(
          "export const busybookieTestRuntime = true;\n",
        );

        const entries =
          await quarantineEntries(
            h.releasesRoot,
          );

        expect(
          entries,
        ).toHaveLength(
          1,
        );

        expect(
          await readFile(
            join(
              h.releasesRoot,
              ".quarantine",
              entries[0] ?? "",
              "node_modules",
              "busybookie-test-runtime",
              "index.js",
            ),
            "utf8",
          ),
        ).toBe(
          "export const busybookieTestRuntime = \"tampered-after-publication\";\n",
        );

        expect(
          await exists(
            second.receiptPath,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "quarantines a receipt-less release without trusting it and still fails closed when the fresh tree fails whole-tree verification",
      async () => {
        const h =
          await harness();

        const finalRoot =
          join(
            h.releasesRoot,
            REVISION,
          );

        await mkdir(
          finalRoot,
          {
            recursive:
              true,
          },
        );

        await write(
          finalRoot,
          "package.json",
          Buffer.from(
            "tampered\n",
          ),
        );

        await expect(
          installPortableRelease(
            installRequest(
              h,
            ),
            dependencies(
              h,
              {
                failWholeTree:
                  true,
              },
            ),
          ),
        ).rejects.toThrow(
          "whole-tree-failure",
        );

        expect(
          h.events,
        ).toEqual([
          "verify-authority",
          "extract",
          "verify-whole-tree",
        ]);

        expect(
          await exists(
            finalRoot,
          ),
        ).toBe(
          false,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              ".receipts",
              `${REVISION}.json`,
            ),
          ),
        ).toBe(
          false,
        );

        const entries =
          await quarantineEntries(
            h.releasesRoot,
          );

        expect(
          entries,
        ).toHaveLength(
          1,
        );

        expect(
          await readFile(
            join(
              h.releasesRoot,
              ".quarantine",
              entries[0] ?? "",
              "package.json",
            ),
            "utf8",
          ),
        ).toBe(
          "tampered\n",
        );

        expect(
          h.events,
        ).not.toContain(
          "publish",
        );
      },
    );

    it(
      "quarantines a receipt-less release and still fails closed when the fresh tree reports a different reviewed revision",
      async () => {
        const h =
          await harness();

        const finalRoot =
          join(
            h.releasesRoot,
            REVISION,
          );

        await mkdir(
          finalRoot,
          {
            recursive:
              true,
          },
        );

        await expect(
          installPortableRelease(
            installRequest(
              h,
            ),
            dependencies(
              h,
              {
                reviewedRevision:
                  "1".repeat(
                    40,
                  ),
              },
            ),
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Portable runtime identity reviewed revision does not match the requested revision.",
        );

        expect(
          h.events,
        ).toEqual([
          "verify-authority",
          "extract",
          "verify-whole-tree",
          "verify-runtime-identity",
        ]);

        expect(
          await exists(
            finalRoot,
          ),
        ).toBe(
          false,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              ".receipts",
              `${REVISION}.json`,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          await quarantineEntries(
            h.releasesRoot,
          ),
        ).toHaveLength(
          1,
        );

        expect(
          h.events,
        ).not.toContain(
          "publish",
        );
      },
    );

    it(
      "keeps RECEIPT_ONLY fail closed without deleting the receipt or reconstructing the release",
      async () => {
        const h =
          await harness();

        const first =
          await installPortableRelease(
            installRequest(
              h,
            ),
            dependencies(
              h,
            ),
          );

        const receiptBytes =
          await readFile(
            first.receiptPath,
          );

        await rm(
          join(
            h.releasesRoot,
            REVISION,
          ),
          {
            recursive:
              true,

            force:
              true,
          },
        );

        h.events.length =
          0;

        await expect(
          installPortableRelease(
            installRequest(
              h,
            ),
            dependencies(
              h,
            ),
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Committed install receipt exists but its immutable release directory is missing; automatic recovery is unsafe and operator intervention is required.",
        );

        expect(
          await readFile(
            first.receiptPath,
          ),
        ).toEqual(
          receiptBytes,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          await quarantineEntries(
            h.releasesRoot,
          ),
        ).toEqual(
          [],
        );

        expect(
          h.events,
        ).toEqual(
          [],
        );
      },
    );
  },
);

describe(
  "portable release installation concurrency",
  () => {
    it(
      "serializes concurrent installers for the same reviewed revision",
      async () => {
        const h =
          await harness();

        let releaseFirstExtract:
          () => void =
            () => {};

        const firstExtractReached =
          new Promise<void>(
            resolve => {
              releaseFirstExtract =
                resolve;
            },
          );

        let allowFirstExtract:
          () => void =
            () => {};

        const firstExtractMayContinue =
          new Promise<void>(
            resolve => {
              allowFirstExtract =
                resolve;
            },
          );

        let extractCalls =
          0;

        const concurrentDependencies =
          Object.freeze({
            ...dependencies(
              h,
            ),

            extractVerifiedArchive:
              async (
                input: Readonly<{
                  destinationRoot: string;
                }>,
              ) => {
                extractCalls +=
                  1;

                h.events.push(
                  `extract-${extractCalls}`,
                );

                if (
                  extractCalls ===
                    1
                ) {
                  releaseFirstExtract();

                  await firstExtractMayContinue;
                }

                const copy = async (
                  relativePath: string,
                ) => {
                  const source =
                    join(
                      h.extractedFixtureRoot,
                      ...relativePath.split(
                        "/",
                      ),
                    );

                  await write(
                    input.destinationRoot,
                    relativePath,
                    await readFile(
                      source,
                    ),
                  );
                };

                await copy(
                  "package.json",
                );

                await copy(
                  "package-lock.json",
                );

                await copy(
                  "dist/operatorServer/operatorServerProcess.js",
                );

                await copy(
                  "apps/operator-console/dist/index.html",
                );

                await copy(
                  "apps/operator-console/dist/assets/index-Test.js",
                );
              },
          });

        const input =
          Object.freeze({
            archivePath:
              h.archivePath,

            treeManifestPath:
              h.treeManifestPath,

            expectedArchiveSha256:
              ARCHIVE_SHA,

            expectedTreeManifestSha256:
              TREE_MANIFEST_SHA,

            expectedReviewedRevision:
              REVISION,

            releasesRoot:
              h.releasesRoot,

            stagingRoot:
              h.stagingRoot,
          });

        const first =
          installPortableRelease(
            input,
            concurrentDependencies,
          );

        await firstExtractReached;

        const second =
          installPortableRelease(
            input,
            concurrentDependencies,
          );

        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              25,
            ),
        );

        const extractCallsBeforeRelease =
          extractCalls;

        allowFirstExtract();

        const settled =
          await Promise.allSettled([
            first,
            second,
          ]);

        expect(
          extractCallsBeforeRelease,
        ).toBe(
          1,
        );

        expect(
          settled.every(
            result =>
              result.status ===
                "fulfilled",
          ),
        ).toBe(
          true,
        );

        const firstResult =
          settled[0];

        const secondResult =
          settled[1];

        if (
          firstResult?.status !==
            "fulfilled" ||
          secondResult?.status !==
            "fulfilled"
        ) {
          throw new Error(
            "Concurrent installers did not both complete successfully.",
          );
        }

        expect(
          firstResult.value,
        ).toEqual(
          secondResult.value,
        );

        expect(
          extractCalls,
        ).toBe(
          1,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
            ),
          ),
        ).toBe(
          true,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              ".receipts",
              `${REVISION}.json`,
            ),
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "releases the same-revision installation lock after a failed install",
      async () => {
        const h =
          await harness();

        const input =
          Object.freeze({
            archivePath:
              h.archivePath,

            treeManifestPath:
              h.treeManifestPath,

            expectedArchiveSha256:
              ARCHIVE_SHA,

            expectedTreeManifestSha256:
              TREE_MANIFEST_SHA,

            expectedReviewedRevision:
              REVISION,

            releasesRoot:
              h.releasesRoot,

            stagingRoot:
              h.stagingRoot,
          });

        await expect(
          installPortableRelease(
            input,
            dependencies(
              h,
              {
                failWholeTree:
                  true,
              },
            ),
          ),
        ).rejects.toThrow();

        h.events.length =
          0;

        const result =
          await installPortableRelease(
            input,
            dependencies(
              h,
            ),
          );

        expect(
          result.reviewedRevision,
        ).toBe(
          REVISION,
        );

        expect(
          await exists(
            result.releaseRoot,
          ),
        ).toBe(
          true,
        );

        expect(
          await exists(
            result.receiptPath,
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);

describe(
  "portable release installation revision lock lease",
  () => {
    it(
      "uses the injected reviewed-revision lock lease across the whole installation transaction",
      async () => {
        const h =
          await harness();

        const leaseEvents:
          string[] =
            [];

        let leaseHeld =
          false;

        const base =
          dependencies(
            h,
          );

        const result =
          await installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            {
              ...base,

              acquireRevisionLock:
                async input => {
                  leaseEvents.push(
                    `acquire:${input.reviewedRevision}`,
                  );

                  expect(
                    input.reviewedRevision,
                  ).toBe(
                    REVISION,
                  );

                  expect(
                    input.releasesRoot,
                  ).toBe(
                    h.releasesRoot,
                  );

                  expect(
                    leaseHeld,
                  ).toBe(
                    false,
                  );

                  leaseHeld =
                    true;

                  return Object.freeze({
                    release:
                      async () => {
                        expect(
                          leaseHeld,
                        ).toBe(
                          true,
                        );

                        leaseEvents.push(
                          "release",
                        );

                        leaseHeld =
                          false;
                      },
                  });
                },
            },
          );

        expect(
          result.reviewedRevision,
        ).toBe(
          REVISION,
        );

        expect(
          leaseEvents,
        ).toEqual([
          `acquire:${REVISION}`,
          "release",
        ]);

        expect(
          leaseHeld,
        ).toBe(
          false,
        );
      },
    );

    it(
      "releases the injected revision lock lease when installation fails",
      async () => {
        const h =
          await harness();

        const leaseEvents:
          string[] =
            [];

        let leaseHeld =
          false;

        const base =
          dependencies(
            h,
            {
              failWholeTree:
                true,
            },
          );

        await expect(
          installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            {
              ...base,

              acquireRevisionLock:
                async () => {
                  leaseEvents.push(
                    "acquire",
                  );

                  leaseHeld =
                    true;

                  return Object.freeze({
                    release:
                      async () => {
                        leaseEvents.push(
                          "release",
                        );

                        leaseHeld =
                          false;
                      },
                  });
                },
            },
          ),
        ).rejects.toThrow();

        expect(
          leaseEvents,
        ).toEqual([
          "acquire",
          "release",
        ]);

        expect(
          leaseHeld,
        ).toBe(
          false,
        );
      },
    );

    it(
      "acquires the injected revision lock before exact replay state is observed",
      async () => {
        const h =
          await harness();

        const base =
          dependencies(
            h,
          );

        const first =
          await installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            base,
          );

        const events:
          string[] =
            [];

        const replay =
          await installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            {
              ...base,

              acquireRevisionLock:
                async () => {
                  events.push(
                    "acquire",
                  );

                  return Object.freeze({
                    release:
                      async () => {
                        events.push(
                          "release",
                        );
                      },
                  });
                },
            },
          );

        expect(
          replay,
        ).toEqual(
          first,
        );

        expect(
          events,
        ).toEqual([
          "acquire",
          "release",
        ]);

      },
    );
    it(
      "fails closed outside linux when no explicit revision-lock override is supplied",
      async () => {
        const h =
          await harness();

        const base =
          dependencies(
            h,
          );

        await expect(
          installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            {
              ...base,

              platform:
                "win32",
            },
          ),
        ).rejects.toThrow(
          /Linux/u,
        );
      },
    );

    it(
      "uses the flock revision lock by default on linux when no explicit lock override is supplied",
      async () => {
        const h =
          await harness();

        const base =
          dependencies(
            h,
          );

        const events:
          string[] =
            [];

        let releaseCount =
          0;

        const result =
          await installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            {
              ...base,

              platform:
                "linux",

              acquireFlockRevisionLock:
                async input => {
                  events.push(
                    "flock",
                  );

                  expect(
                    input.reviewedRevision,
                  ).toBe(
                    REVISION,
                  );

                  expect(
                    input.releasesRoot,
                  ).toBe(
                    h.releasesRoot,
                  );

                  return Object.freeze({
                    release:
                      async () => {
                        releaseCount +=
                          1;

                        events.push(
                          "release",
                        );
                      },
                  });
                },
            },
          );

        expect(
          result.reviewedRevision,
        ).toBe(
          REVISION,
        );

        expect(
          events,
        ).toEqual([
          "flock",
          "release",
        ]);

        expect(
          releaseCount,
        ).toBe(
          1,
        );
      },
    );

    it(
      "prefers an explicit revision-lock override over linux default flock wiring",
      async () => {
        const h =
          await harness();

        const base =
          dependencies(
            h,
          );

        const events:
          string[] =
            [];

        const result =
          await installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            {
              ...base,

              platform:
                "linux",

              acquireFlockRevisionLock:
                async () => {
                  throw new Error(
                    "default-flock-should-not-run",
                  );
                },

              acquireRevisionLock:
                async () => {
                  events.push(
                    "explicit-acquire",
                  );

                  return Object.freeze({
                    release:
                      async () => {
                        events.push(
                          "explicit-release",
                        );
                      },
                  });
                },
            },
          );

        expect(
          result.reviewedRevision,
        ).toBe(
          REVISION,
        );

        expect(
          events,
        ).toEqual([
          "explicit-acquire",
          "explicit-release",
        ]);
      },
    );
  },
);

describe(
  "portable release installation same-filesystem publication guard",
  () => {
    it(
      "checks the actual private staging directory before extraction and cleans it when the guard fails",
      async () => {
        const h =
          await harness();

        const observed:
          Array<
            Readonly<{
              releasesRoot: string;
              stagingReleaseRoot: string;
            }>
          > =
          [];

        await expect(
          installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            {
              ...dependencies(
                h,
              ),

              requireSameFilesystem:
                async input => {
                  observed.push(
                    input,
                  );

                  throw new Error(
                    "synthetic-same-filesystem-failure",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "synthetic-same-filesystem-failure",
        );

        expect(
          observed,
        ).toHaveLength(
          1,
        );

        const captured =
          observed[0];

        if (
          captured ===
            undefined
        ) {
          throw new Error(
            "Expected same-filesystem guard to run.",
          );
        }

        expect(
          captured.releasesRoot,
        ).toBe(
          h.releasesRoot,
        );

        expect(
          captured.stagingReleaseRoot.startsWith(
            h.stagingRoot,
          ),
        ).toBe(
          true,
        );

        expect(
          h.events,
        ).not.toContain(
          "extract",
        );

        expect(
          h.events,
        ).not.toContain(
          "publish",
        );

        expect(
          await exists(
            captured.stagingReleaseRoot,
          ),
        ).toBe(
          false,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
            ),
          ),
        ).toBe(
          false,
        );
      },
    );
  },
);

describe(
  "portable release installation private staging privacy guard",
  () => {
    it(
      "establishes private staging permissions before filesystem validation or extraction and cleans the directory on failure",
      async () => {
        const h =
          await harness();

        const observed:
          string[] =
          [];

        let sameFilesystemCalls =
          0;

        await expect(
          installPortableRelease(
            {
              archivePath:
                h.archivePath,

              treeManifestPath:
                h.treeManifestPath,

              expectedArchiveSha256:
                ARCHIVE_SHA,

              expectedTreeManifestSha256:
                TREE_MANIFEST_SHA,

              expectedReviewedRevision:
                REVISION,

              releasesRoot:
                h.releasesRoot,

              stagingRoot:
                h.stagingRoot,
            },
            {
              ...dependencies(
                h,
              ),

              requirePrivateInstallDirectory:
                async path => {
                  observed.push(
                    path,
                  );

                  throw new Error(
                    "synthetic-private-staging-mode-failure",
                  );
                },

              requireSameFilesystem:
                async () => {
                  sameFilesystemCalls +=
                    1;
                },
            },
          ),
        ).rejects.toThrow(
          "synthetic-private-staging-mode-failure",
        );

        expect(
          observed,
        ).toHaveLength(
          1,
        );

        const captured =
          observed[0];

        if (
          captured ===
            undefined
        ) {
          throw new Error(
            "Expected private-directory guard to run.",
          );
        }

        expect(
          captured.startsWith(
            h.stagingRoot,
          ),
        ).toBe(
          true,
        );

        expect(
          sameFilesystemCalls,
        ).toBe(
          0,
        );

        expect(
          h.events,
        ).not.toContain(
          "extract",
        );

        expect(
          h.events,
        ).not.toContain(
          "publish",
        );

        expect(
          await exists(
            captured,
          ),
        ).toBe(
          false,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
            ),
          ),
        ).toBe(
          false,
        );
      },
    );
  },
);

async function privateInstallEntries(
  h: Harness,
): Promise<string[]> {
  return (
    await readdir(
      h.stagingRoot,
    )
  ).filter(
    name =>
      name.startsWith(
        `.${REVISION}.installing-`,
      ),
  );
}

describe(
  "portable release installation durable commit ordering",
  () => {
    it(
      "syncs the authoritative private tree, renames, syncs the source parent and releasesRoot, then writes the receipt",
      async () => {
        const h =
          await harness();

        const order:
          string[] =
            [];

        let syncedTree:
          Readonly<{
            root: string;
            files: readonly string[];
          }> | null =
            null;

        const result =
          await installPortableRelease(
            installRequest(
              h,
            ),
            {
              ...dependencies(
                h,
              ),

              syncReleaseTree:
                async input => {
                  order.push(
                    "sync-release-tree",
                  );

                  syncedTree =
                    input;

                  await syncPortableReleaseTree(
                    input,
                  );
                },

              publishInstalledRelease:
                async input => {
                  order.push(
                    "publish",
                  );

                  await publishPortableReleaseAtomically(
                    input,
                  );
                },

              syncDirectory:
                async directory => {
                  order.push(
                    directory ===
                      h.stagingRoot
                      ? "sync-source-parent"
                      : directory ===
                          h.releasesRoot
                        ? "sync-releases-root"
                        : `sync-unexpected:${directory}`,
                  );

                  await syncPortableReleaseDirectory(
                    directory,
                  );
                },

              writeInstallReceipt:
                async (
                  receiptPath,
                  receipt,
                ) => {
                  order.push(
                    "write-receipt",
                  );

                  await writePortableReleaseInstallReceipt(
                    receiptPath,
                    receipt,
                  );
                },
            },
          );

        expect(
          order,
        ).toEqual([
          "sync-release-tree",
          "publish",
          "sync-source-parent",
          "sync-releases-root",
          "write-receipt",
        ]);

        const tree =
          syncedTree as
            Readonly<{
              root: string;
              files: readonly string[];
            }> | null;

        expect(
          tree?.root.startsWith(
            join(
              h.stagingRoot,
              `.${REVISION}.installing-`,
            ),
          ),
        ).toBe(
          true,
        );

        expect(
          [
            ...(
              tree?.files ??
              []
            ),
          ].sort(),
        ).toEqual([
          "app/apps/operator-console/dist/assets/index-Test.js",
          "app/apps/operator-console/dist/index.html",
          "app/dist/operatorServer/operatorServerProcess.js",
          "app/package-lock.json",
          "app/package.json",
          "node_modules/busybookie-test-runtime/index.js",
        ]);

        expect(
          await exists(
            result.receiptPath,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "publishes nothing and cleans private state when the durable tree sync fails before publication",
      async () => {
        const h =
          await harness();

        await expect(
          installPortableRelease(
            installRequest(
              h,
            ),
            {
              ...dependencies(
                h,
              ),

              syncReleaseTree:
                async () => {
                  throw new Error(
                    "synthetic-tree-sync-failure",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "synthetic-tree-sync-failure",
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          await privateInstallEntries(
            h,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "publishes nothing and cleans private state when the publisher fails",
      async () => {
        const h =
          await harness();

        await expect(
          installPortableRelease(
            installRequest(
              h,
            ),
            dependencies(
              h,
              {
                failPublish:
                  true,
              },
            ),
          ),
        ).rejects.toThrow(
          "publish-failure",
        );

        expect(
          h.events,
        ).toContain(
          "publish",
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              ".receipts",
              `${REVISION}.json`,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          await privateInstallEntries(
            h,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "rolls back the uncommitted release and syncs releasesRoot when the post-rename releasesRoot sync fails, then a retry installs",
      async () => {
        const h =
          await harness();

        const releasesRootSyncs:
          string[] =
            [];

        await expect(
          installPortableRelease(
            installRequest(
              h,
            ),
            {
              ...dependencies(
                h,
              ),

              syncDirectory:
                async directory => {
                  if (
                    directory ===
                      h.releasesRoot
                  ) {
                    releasesRootSyncs.push(
                      directory,
                    );

                    if (
                      releasesRootSyncs.length ===
                        1
                    ) {
                      throw new Error(
                        "synthetic-releases-root-fsync-failure",
                      );
                    }
                  }

                  await syncPortableReleaseDirectory(
                    directory,
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "synthetic-releases-root-fsync-failure",
        );

        expect(
          releasesRootSyncs,
        ).toHaveLength(
          2,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              ".receipts",
              `${REVISION}.json`,
            ),
          ),
        ).toBe(
          false,
        );

        const retried =
          await installPortableRelease(
            installRequest(
              h,
            ),
            dependencies(
              h,
            ),
          );

        expect(
          await exists(
            retried.receiptPath,
          ),
        ).toBe(
          true,
        );

        expect(
          await quarantineEntries(
            h.releasesRoot,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "rolls back the uncommitted release and syncs releasesRoot when the receipt fails before its rename, then a retry installs",
      async () => {
        const h =
          await harness();

        const synced:
          string[] =
            [];

        await expect(
          installPortableRelease(
            installRequest(
              h,
            ),
            {
              ...dependencies(
                h,
              ),

              syncDirectory:
                async directory => {
                  synced.push(
                    directory,
                  );

                  await syncPortableReleaseDirectory(
                    directory,
                  );
                },

              writeInstallReceipt:
                async (
                  receiptPath,
                  receipt,
                ) =>
                  writePortableReleaseInstallReceipt(
                    receiptPath,
                    receipt,
                    {
                      renameReceipt:
                        async () => {
                          throw new Error(
                            "synthetic-receipt-rename-failure",
                          );
                        },
                    },
                  ),
            },
          ),
        ).rejects.toThrow(
          "synthetic-receipt-rename-failure",
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              ".receipts",
              `${REVISION}.json`,
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          synced,
        ).toEqual([
          h.stagingRoot,
          h.releasesRoot,
          h.releasesRoot,
        ]);

        const retried =
          await installPortableRelease(
            installRequest(
              h,
            ),
            dependencies(
              h,
            ),
          );

        expect(
          await exists(
            retried.receiptPath,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "never removes the release after the receipt rename when the .receipts fsync fails, and the next invocation exact-replays",
      async () => {
        const h =
          await harness();

        const receiptPath =
          join(
            h.releasesRoot,
            ".receipts",
            `${REVISION}.json`,
          );

        await expect(
          installPortableRelease(
            installRequest(
              h,
            ),
            {
              ...dependencies(
                h,
              ),

              writeInstallReceipt:
                async (
                  path,
                  receipt,
                ) =>
                  writePortableReleaseInstallReceipt(
                    path,
                    receipt,
                    {
                      syncDirectory:
                        async directory => {
                          if (
                            directory ===
                              dirname(
                                path,
                              )
                          ) {
                            throw new Error(
                              "synthetic-receipts-directory-fsync-failure",
                            );
                          }

                          await syncPortableReleaseDirectory(
                            directory,
                          );
                        },
                    },
                  ),
            },
          ),
        ).rejects.toThrow(
          "synthetic-receipts-directory-fsync-failure",
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
              "app",
              "package.json",
            ),
          ),
        ).toBe(
          true,
        );

        expect(
          await exists(
            receiptPath,
          ),
        ).toBe(
          true,
        );

        h.events.length =
          0;

        let preparations =
          0;

        const replayed =
          await installPortableRelease(
            installRequest(
              h,
            ),
            {
              ...dependencies(
                h,
              ),

              prepareProductionDependencies:
                async () => {
                  preparations +=
                    1;

                  throw new Error(
                    "exact replay must not prepare dependencies",
                  );
                },
            },
          );

        expect(
          replayed.receiptPath,
        ).toBe(
          receiptPath,
        );

        expect(
          preparations,
        ).toBe(
          0,
        );

        expect(
          h.events,
        ).not.toContain(
          "extract",
        );

        expect(
          await quarantineEntries(
            h.releasesRoot,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it(
      "never removes the release when temporary receipt cleanup fails after the durable commit, and the next invocation exact-replays",
      async () => {
        const h =
          await harness();

        await expect(
          installPortableRelease(
            installRequest(
              h,
            ),
            {
              ...dependencies(
                h,
              ),

              writeInstallReceipt:
                async (
                  path,
                  receipt,
                ) =>
                  writePortableReleaseInstallReceipt(
                    path,
                    receipt,
                    {
                      removeTemporary:
                        async () => {
                          throw new Error(
                            "synthetic-receipt-temporary-cleanup-failure",
                          );
                        },
                    },
                  ),
            },
          ),
        ).rejects.toThrow(
          "synthetic-receipt-temporary-cleanup-failure",
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              REVISION,
              "app",
              "package.json",
            ),
          ),
        ).toBe(
          true,
        );

        h.events.length =
          0;

        const replayed =
          await installPortableRelease(
            installRequest(
              h,
            ),
            dependencies(
              h,
            ),
          );

        expect(
          await exists(
            replayed.receiptPath,
          ),
        ).toBe(
          true,
        );

        expect(
          h.events,
        ).not.toContain(
          "extract",
        );
      },
    );
  },
);

describe(
  "portable release installation explicit failure paths",
  () => {
    it(
      "reports both failures and leaves release-only residue when rollback removal fails, then the next invocation quarantines it and installs fresh",
      async () => {
        const h =
          await harness();

        const finalRoot =
          join(
            h.releasesRoot,
            REVISION,
          );

        let observed:
          unknown =
            null;

        try {
          await installPortableRelease(
            installRequest(
              h,
            ),
            {
              ...dependencies(
                h,
              ),

              writeInstallReceipt:
                async () => {
                  filesystemFaults.failRemovePath =
                    finalRoot;

                  throw new Error(
                    "synthetic-precommit-receipt-failure",
                  );
                },
            },
          );
        } catch (cause) {
          observed =
            cause;
        }

        filesystemFaults.failRemovePath =
          null;

        expect(
          observed,
        ).toBeInstanceOf(
          Error,
        );

        expect(
          (
            observed as Error
          ).message,
        ).toBe(
          "Portable release installation failed: Uncommitted release rollback failed; the release-only residue will be quarantined by the next installation.",
        );

        const aggregate =
          (
            observed as Error
          ).cause;

        expect(
          aggregate,
        ).toBeInstanceOf(
          AggregateError,
        );

        expect(
          (
            aggregate as AggregateError
          ).errors.map(
            error =>
              (
                error as Error
              ).message,
          ),
        ).toEqual([
          "synthetic-precommit-receipt-failure",
          "synthetic-release-remove-failure",
        ]);

        expect(
          await exists(
            join(
              finalRoot,
              "app",
              "package.json",
            ),
          ),
        ).toBe(
          true,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              ".receipts",
              `${REVISION}.json`,
            ),
          ),
        ).toBe(
          false,
        );

        h.events.length =
          0;

        const recovered =
          await installPortableRelease(
            installRequest(
              h,
            ),
            dependencies(
              h,
            ),
          );

        expect(
          h.events,
        ).toContain(
          "extract",
        );

        const entries =
          await quarantineEntries(
            h.releasesRoot,
          );

        expect(
          entries,
        ).toHaveLength(
          1,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              ".quarantine",
              entries[0] ?? "",
              "app",
              "package.json",
            ),
          ),
        ).toBe(
          true,
        );

        expect(
          await exists(
            recovered.receiptPath,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "never deletes the published release when the receipt state is ambiguous during the rollback decision",
      async () => {
        const h =
          await harness();

        const finalRoot =
          join(
            h.releasesRoot,
            REVISION,
          );

        const receiptPath =
          join(
            h.releasesRoot,
            ".receipts",
            `${REVISION}.json`,
          );

        let removals =
          0;

        await expect(
          installPortableRelease(
            installRequest(
              h,
            ),
            {
              ...dependencies(
                h,
              ),

              syncDirectory:
                async directory => {
                  if (
                    filesystemFaults.failLstatPath !==
                      null &&
                    directory ===
                      h.releasesRoot
                  ) {
                    removals +=
                      1;
                  }

                  await syncPortableReleaseDirectory(
                    directory,
                  );
                },

              writeInstallReceipt:
                async () => {
                  filesystemFaults.failLstatPath =
                    receiptPath;

                  throw new Error(
                    "synthetic-precommit-failure-with-ambiguous-receipt",
                  );
                },
            },
          ),
        ).rejects.toThrow(
          "synthetic-precommit-failure-with-ambiguous-receipt",
        );

        filesystemFaults.failLstatPath =
          null;

        expect(
          removals,
        ).toBe(
          0,
        );

        for (
          const relativePath
          of [
            "package.json",
            "package-lock.json",
            "dist/operatorServer/operatorServerProcess.js",
            "apps/operator-console/dist/index.html",
            "apps/operator-console/dist/assets/index-Test.js",
          ]
        ) {
          expect(
            await readFile(
              join(
                finalRoot,
                "app",
                ...relativePath.split(
                  "/",
                ),
              ),
            ),
          ).toEqual(
            await readFile(
              join(
                h.extractedFixtureRoot,
                ...relativePath.split(
                  "/",
                ),
              ),
            ),
          );
        }

        expect(
          await readFile(
            join(
              finalRoot,
              "node_modules",
              "busybookie-test-runtime",
              "index.js",
            ),
            "utf8",
          ),
        ).toBe(
          "export const busybookieTestRuntime = true;\n",
        );

        expect(
          await exists(
            receiptPath,
          ),
        ).toBe(
          false,
        );

        expect(
          await quarantineEntries(
            h.releasesRoot,
          ),
        ).toEqual(
          [],
        );
      },
    );

    it.each([
      "releases-root",
      "quarantine",
    ] as const)(
      "keeps quarantined evidence and never reuses it when the post-rename %s fsync fails, then the next invocation installs fresh",
      async failingSync => {
        const h =
          await harness();

        const finalRoot =
          join(
            h.releasesRoot,
            REVISION,
          );

        const quarantineRoot =
          join(
            h.releasesRoot,
            ".quarantine",
          );

        await mkdir(
          finalRoot,
        );

        await write(
          finalRoot,
          "existing-evidence.txt",
          Buffer.from(
            "existing\n",
          ),
        );

        let failed =
          false;

        await expect(
          installPortableRelease(
            installRequest(
              h,
            ),
            {
              ...dependencies(
                h,
              ),

              syncDirectory:
                async directory => {
                  const target =
                    failingSync ===
                      "releases-root"
                      ? h.releasesRoot
                      : quarantineRoot;

                  if (
                    !failed &&
                    directory ===
                      target
                  ) {
                    failed =
                      true;

                    throw new Error(
                      `synthetic-quarantine-${failingSync}-fsync-failure`,
                    );
                  }

                  await syncPortableReleaseDirectory(
                    directory,
                  );
                },
            },
          ),
        ).rejects.toThrow(
          `synthetic-quarantine-${failingSync}-fsync-failure`,
        );

        expect(
          h.events,
        ).toEqual([
          "verify-authority",
        ]);

        expect(
          await exists(
            finalRoot,
          ),
        ).toBe(
          false,
        );

        expect(
          await exists(
            join(
              h.releasesRoot,
              ".receipts",
              `${REVISION}.json`,
            ),
          ),
        ).toBe(
          false,
        );

        const entries =
          await quarantineEntries(
            h.releasesRoot,
          );

        expect(
          entries,
        ).toHaveLength(
          1,
        );

        const evidencePath =
          join(
            quarantineRoot,
            entries[0] ?? "",
            "existing-evidence.txt",
          );

        expect(
          await readFile(
            evidencePath,
            "utf8",
          ),
        ).toBe(
          "existing\n",
        );

        h.events.length =
          0;

        const recovered =
          await installPortableRelease(
            installRequest(
              h,
            ),
            dependencies(
              h,
            ),
          );

        expect(
          h.events,
        ).toContain(
          "extract",
        );

        expect(
          await exists(
            join(
              finalRoot,
              "existing-evidence.txt",
            ),
          ),
        ).toBe(
          false,
        );

        expect(
          await quarantineEntries(
            h.releasesRoot,
          ),
        ).toEqual(
          entries,
        );

        expect(
          await readFile(
            evidencePath,
            "utf8",
          ),
        ).toBe(
          "existing\n",
        );

        expect(
          await exists(
            recovered.receiptPath,
          ),
        ).toBe(
          true,
        );
      },
    );
  },
);

describe(
  "portable release installation releases-root provisioning durability",
  () => {
    it(
      "fsyncs a releases root it creates, every created ancestor and the pre-existing parent before installing",
      async () => {
        const h =
          await harness();

        const createdParent =
          join(
            h.deploymentRoot,
            "fresh-parent",
          );

        const releasesRoot =
          join(
            createdParent,
            "releases",
          );

        const synced:
          string[] =
            [];

        const result =
          await installPortableRelease(
            {
              ...installRequest(
                h,
              ),

              releasesRoot,
            },
            {
              ...dependencies(
                h,
              ),

              syncDirectory:
                async directory => {
                  synced.push(
                    directory,
                  );

                  await syncPortableReleaseDirectory(
                    directory,
                  );
                },
            },
          );

        expect(
          synced.slice(
            0,
            3,
          ),
        ).toEqual([
          releasesRoot,
          createdParent,
          h.deploymentRoot,
        ]);

        expect(
          await exists(
            result.receiptPath,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "does not sync the parent of a pre-existing releases root",
      async () => {
        const h =
          await harness();

        const synced:
          string[] =
            [];

        await installPortableRelease(
          installRequest(
            h,
          ),
          {
            ...dependencies(
              h,
            ),

            syncDirectory:
              async directory => {
                synced.push(
                  directory,
                );

                await syncPortableReleaseDirectory(
                  directory,
                );
              },
          },
        );

        expect(
          synced,
        ).not.toContain(
          h.deploymentRoot,
        );

        expect(
          synced,
        ).toEqual([
          h.stagingRoot,
          h.releasesRoot,
        ]);
      },
    );
  },
);
