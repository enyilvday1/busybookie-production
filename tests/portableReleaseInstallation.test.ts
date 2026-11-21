import {
  access,
  mkdir,
  mkdtemp,
  readFile,
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
} from "vitest";

import {
  installPortableRelease,
} from "../src/deployment/installPortableRelease.js";

import {
  createPortableReleaseDependencyTreeManifest,
} from "../src/deployment/portableReleaseDependencyTreeManifest.js";

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
      "refuses to overwrite an existing immutable revision directory",
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
          h.events,
        ).toEqual([
          "verify-authority",
          "verify-whole-tree",
        ]);
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
            dependencies(
              h,
            ),
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
      "refuses a receipt-less published release even when artifact and dependency trees verify",
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
            recursive: true,
          },
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
            "export const busybookieTestRuntime = true;\n",
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
            ),
          ),
        ).rejects.toThrow(
          "Portable release installation failed: Missing install receipt cannot independently authorize the published dependency tree.",
        );

        const receiptPath =
          join(
            h.releasesRoot,
            ".receipts",
            `${REVISION}.json`,
          );

        expect(
          await exists(
            receiptPath,
          ),
        ).toBe(
          false,
        );

        expect(
          await exists(
            appRoot,
          ),
        ).toBe(
          true,
        );

        expect(
          await exists(
            join(
              finalRoot,
              "node_modules",
            ),
          ),
        ).toBe(
          true,
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
      "refuses to bless a changed dependency tree when the durable receipt is missing",
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

        await rm(
          first.receiptPath,
          {
            force:
              true,
          },
        );

        expect(
          await exists(
            first.receiptPath,
          ),
        ).toBe(
          false,
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
          "Portable release installation failed: Missing install receipt cannot independently authorize the published dependency tree.",
        );

        expect(
          await exists(
            first.receiptPath,
          ),
        ).toBe(
          false,
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
      },
    );

    it(
      "refuses crash recovery when the existing published release fails whole-tree verification",
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
            recursive: true,
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
          h.events,
        ).toEqual([
          "verify-authority",
          "verify-whole-tree",
        ]);

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
      "refuses crash recovery when runtime identity reports a different reviewed revision",
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
            recursive: true,
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
          h.events,
        ).toEqual([
          "verify-authority",
          "verify-whole-tree",
          "verify-runtime-identity",
        ]);

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
