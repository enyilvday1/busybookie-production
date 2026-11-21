import {
  execFile,
} from "node:child_process";

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";

import {
  join,
  resolve,
} from "node:path";

import {
  promisify,
} from "node:util";

import {
  readBoundFile,
  requireLinkSafeContainedPath,
} from "../execution/episodeInputBinding.js";

import {
  requirePortableReleaseIdentity,
} from "../execution/portableReleaseRuntimeIdentity.js";

import {
  parsePortableReleaseTreeManifest,
} from "./portableReleaseTreeManifest.js";

import {
  createPortableReleaseVerificationSnapshot,
} from "./portableReleaseVerificationSnapshot.js";

import {
  verifyPortableReleaseArchive,
  type PortableReleaseArchiveVerificationResult,
} from "./verifyPortableReleaseArchive.js";

import {
  verifyPortableReleaseExtractedTree,
  type PortableReleaseExtractedTreeVerificationResult,
} from "./verifyPortableReleaseExtractedTree.js";

import {
  isPortableReleaseSha256,
  portableReleaseInstallFailure as fail,
  requirePortableReleaseRevision as requireRevision,
  requirePortableReleaseSha256 as requireSha256,
} from "./portableReleaseInstallContract.js";

import {
  createPortableReleaseInstallReceipt,
} from "./portableReleaseInstallReceipt.js";

import {
  portableReleaseInstallReceiptPath,
  readExactPortableReleaseInstallReceiptReplay,
  writePortableReleaseInstallReceipt,
} from "./portableReleaseInstallReceiptStore.js";

import {
  syncPortableReleaseDirectory,
} from "./portableReleaseFilesystemDurability.js";

import {
  enforcePortableReleasePrivateDirectoryMode,
  portableReleasePathExists,
  publishPortableReleaseAtomically,
  requirePortableReleaseSameFilesystem,
  type PortableReleasePrivateDirectoryGuard,
  type PortableReleaseSameFilesystemGuard,
} from "./portableReleaseFilesystem.js";

import {
  portableReleaseInstallationResultFromReceipt,
  type PortableReleaseInstallationResult,
} from "./portableReleaseInstallationResult.js";

import {
  preparePortableReleaseProductionDependencies,
  type PortableReleaseDependencyPreparer,
} from "./portableReleaseDependencyPreparation.js";

import {
  PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_KIND,
  PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_SCHEMA_VERSION,
  createPortableReleaseDependencyTreeManifest,
  type PortableReleaseDependencyTreeManifest,
} from "./portableReleaseDependencyTreeManifest.js";

export type {
  PortableReleaseInstallReceipt,
} from "./portableReleaseInstallReceipt.js";

export type {
  PortableReleaseInstallationResult,
} from "./portableReleaseInstallationResult.js";

import {
  acquirePortableReleaseFlockRevisionLock,
  spawnPortableReleaseFlockProcess,
  type PortableReleaseRevisionLockAcquirer,
  type PortableReleaseRevisionLockLease,
} from "./portableReleaseFlockRevisionLock.js";

const execFileAsync =
  promisify(
    execFile,
  );

const MAX_TAR_OUTPUT_BYTES =
  32 * 1024 * 1024;

type ArchiveVerifier = (
  input: Readonly<{
    archivePath: string;
    treeManifestPath: string;
    expectedArchiveSha256: string;
    expectedTreeManifestSha256: string;
  }>,
) => Promise<PortableReleaseArchiveVerificationResult>;

type ArchiveExtractor = (
  input: Readonly<{
    archivePath: string;
    destinationRoot: string;
  }>,
) => Promise<void>;

type ExtractedTreeVerifier = (
  input: Readonly<{
    root: string;
    manifest: ReturnType<typeof parsePortableReleaseTreeManifest>;
  }>,
) => Promise<PortableReleaseExtractedTreeVerificationResult>;

type InstallerVerifiedRuntimeIdentity =
  Readonly<{
    reviewedRevision: string;
    root: string;
    manifest: Readonly<{
      rawSha256: string | null;
    }>;
  }>;

type RuntimeIdentityVerifier = (
  releaseRoot: string,
) => Promise<InstallerVerifiedRuntimeIdentity>;

type ReleasePublisher = (
  input: Readonly<{
    stagingReleaseRoot: string;
    finalReleaseRoot: string;
  }>,
) => Promise<void>;

export type PortableReleaseInstallationDependencies =
  Readonly<{
    verifyPortableReleaseArchive?: ArchiveVerifier;
    extractVerifiedArchive?: ArchiveExtractor;
    verifyPortableReleaseExtractedTree?: ExtractedTreeVerifier;
    requirePortableReleaseIdentity?: RuntimeIdentityVerifier;
    publishInstalledRelease?: ReleasePublisher;
    requirePrivateInstallDirectory?: PortableReleasePrivateDirectoryGuard;
    requireSameFilesystem?: PortableReleaseSameFilesystemGuard;
    prepareProductionDependencies?: PortableReleaseDependencyPreparer;
    createDependencyManifest?: typeof createPortableReleaseDependencyTreeManifest;
    acquireRevisionLock?: PortableReleaseRevisionLockAcquirer;
    platform?: string;
    acquireFlockRevisionLock?: PortableReleaseRevisionLockAcquirer;
  }>;

async function extractArchive(
  input: Readonly<{
    archivePath: string;
    destinationRoot: string;
  }>,
): Promise<void> {
  try {
    await execFileAsync(
      "tar",
      [
        "--force-local",
        "--gzip",
        "--extract",
        "--file",
        input.archivePath,
        "--no-same-owner",
        "--no-same-permissions",
      ],
      {
        cwd:
          input.destinationRoot,

        windowsHide:
          true,

        encoding:
          "utf8",

        maxBuffer:
          MAX_TAR_OUTPUT_BYTES,
      },
    );
  } catch (cause) {
    throw fail(
      "GNU tar could not extract the verified archive into the private installation root.",
      {
        cause,
      },
    );
  }
}

async function verifyRuntimeIdentity(
  releaseRoot: string,
): Promise<InstallerVerifiedRuntimeIdentity> {
  return requirePortableReleaseIdentity(
    releaseRoot,
    {
      readBoundFile,
      requireLinkSafeContainedPath,
    },
  );
}

function requirePortableReleaseDependencyManifestAuthority(
  manifest: PortableReleaseDependencyTreeManifest,
): PortableReleaseDependencyTreeManifest {
  if (
    manifest.schemaVersion !==
      PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_SCHEMA_VERSION ||
    manifest.kind !==
      PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_KIND ||
    !isPortableReleaseSha256(
      manifest.manifestSha256,
    ) ||
    !Number.isSafeInteger(
      manifest.fileCount,
    ) ||
    manifest.fileCount <
      1 ||
    !Number.isSafeInteger(
      manifest.totalBytes,
    ) ||
    manifest.totalBytes <
      1 ||
    manifest.files.length !==
      manifest.fileCount
  ) {
    throw fail(
      "Portable production dependency manifest does not expose valid authority fields.",
    );
  }

  return manifest;
}

async function verifyPortableReleaseArtifactAuthority(
  input: Readonly<{
    artifactRoot: string;
    reviewedRevision: string;
    manifest: ReturnType<typeof parsePortableReleaseTreeManifest>;
    treeVerifier: ExtractedTreeVerifier;
    identityVerifier: RuntimeIdentityVerifier;
    identityRootFailureMessage: string;
  }>,
): Promise<
  Readonly<{
    treeVerification: PortableReleaseExtractedTreeVerificationResult;
    identityManifestSha256: string;
  }>
> {
  const treeVerification =
    await input.treeVerifier({
      root:
        input.artifactRoot,

      manifest:
        input.manifest,
    });

  const identity =
    await input.identityVerifier(
      input.artifactRoot,
    );

  if (
    identity.reviewedRevision !==
      input.reviewedRevision
  ) {
    throw fail(
      "Portable runtime identity reviewed revision does not match the requested revision.",
    );
  }

  if (
    resolve(
      identity.root,
    ) !==
      resolve(
        input.artifactRoot,
      )
  ) {
    throw fail(
      input.identityRootFailureMessage,
    );
  }

  const identityManifestSha256 =
    identity.manifest.rawSha256;

  if (
    typeof identityManifestSha256 !==
      "string" ||
    !isPortableReleaseSha256(
      identityManifestSha256,
    )
  ) {
    throw fail(
      "Portable runtime identity manifest does not expose a valid SHA-256 binding.",
    );
  }

  return Object.freeze({
    treeVerification,
    identityManifestSha256,
  });
}

export async function installPortableRelease(
  input: Readonly<{
    archivePath: string;
    treeManifestPath: string;
    expectedArchiveSha256: string;
    expectedTreeManifestSha256: string;
    expectedReviewedRevision: string;
    releasesRoot: string;
    stagingRoot: string;
  }>,
  dependencies: PortableReleaseInstallationDependencies = {},
): Promise<PortableReleaseInstallationResult> {
  const reviewedRevision =
    requireRevision(
      input.expectedReviewedRevision,
    );

  const expectedArchiveSha256 =
    requireSha256(
      input.expectedArchiveSha256,
      "Expected release archive SHA-256",
    );

  const expectedTreeManifestSha256 =
    requireSha256(
      input.expectedTreeManifestSha256,
      "Expected tree manifest SHA-256",
    );

  const releasesRoot =
    resolve(
      input.releasesRoot,
    );

  const stagingRoot =
    resolve(
      input.stagingRoot,
    );

  const finalReleaseRoot =
    resolve(
      releasesRoot,
      reviewedRevision,
    );

  const finalArtifactRoot =
    resolve(
      finalReleaseRoot,
      "app",
    );

  const finalDependencyRoot =
    resolve(
      finalReleaseRoot,
      "node_modules",
    );

  const receiptPath =
    portableReleaseInstallReceiptPath(
      releasesRoot,
      reviewedRevision,
    );

  await mkdir(
    releasesRoot,
    {
      recursive:
        true,
    },
  );

  await mkdir(
    stagingRoot,
    {
      recursive:
        true,
    },
  );

  const platform =
    dependencies.platform ??
    process.platform;

  const flockRevisionLockAcquirer =
    dependencies.acquireFlockRevisionLock ??
    (
      async (
        lockInput: Readonly<{
          releasesRoot: string;
          reviewedRevision: string;
        }>,
      ): Promise<PortableReleaseRevisionLockLease> =>
        acquirePortableReleaseFlockRevisionLock(
          lockInput,
          {
            platform,
            ensureLockDirectory:
              async path => {
                await mkdir(
                  path,
                  {
                    recursive:
                      true,
                  },
                );
              },
            spawnLockProcess:
              spawnPortableReleaseFlockProcess,
          },
        )
    );

  const revisionLockAcquirer =
    dependencies.acquireRevisionLock ??
    (
      platform ===
        "linux"
        ? flockRevisionLockAcquirer
        : (
            async (): Promise<PortableReleaseRevisionLockLease> => {
              throw fail(
                "Linux is required for the portable release installation lock.",
              );
            }
          )
    );

  const installLock =
    await revisionLockAcquirer({
      releasesRoot,
      reviewedRevision,
    });

  try {
    const finalReleaseExists =
      await portableReleasePathExists(
        finalReleaseRoot,
      );

    const receiptExists =
      await portableReleasePathExists(
        receiptPath,
      );

    if (
      !finalReleaseExists &&
      receiptExists
    ) {
      throw fail(
        "Install receipt exists without its immutable release directory.",
      );
    }

    const snapshot =
      await createPortableReleaseVerificationSnapshot({
        archivePath:
          input.archivePath,

        treeManifestPath:
          input.treeManifestPath,
      });

    let privateInstallRoot:
      string |
      null =
        null;

    let published =
      false;

    try {
      const archiveVerifier =
        dependencies.verifyPortableReleaseArchive ??
        verifyPortableReleaseArchive;

      await archiveVerifier({
        archivePath:
          snapshot.archivePath,

        treeManifestPath:
          snapshot.treeManifestPath,

        expectedArchiveSha256,
        expectedTreeManifestSha256,
      });

      const manifest =
        parsePortableReleaseTreeManifest(
          await readFile(
            snapshot.treeManifestPath,
          ),
        );

      const treeVerifier =
        dependencies.verifyPortableReleaseExtractedTree ??
        verifyPortableReleaseExtractedTree;

      const identityVerifier =
        dependencies.requirePortableReleaseIdentity ??
        verifyRuntimeIdentity;

      const dependencyManifestCreator =
        dependencies.createDependencyManifest ??
        createPortableReleaseDependencyTreeManifest;

      if (
        finalReleaseExists &&
        receiptExists
      ) {
        const artifactAuthority =
          await verifyPortableReleaseArtifactAuthority({
            artifactRoot:
              finalArtifactRoot,

            reviewedRevision,

            manifest,
            treeVerifier,
            identityVerifier,

            identityRootFailureMessage:
              "Portable runtime identity root does not match the published release root.",
          });

        const dependencyManifest =
          requirePortableReleaseDependencyManifestAuthority(
            await dependencyManifestCreator(
              finalDependencyRoot,
            ),
          );

        const receipt =
          await readExactPortableReleaseInstallReceiptReplay({
            receiptPath,

            expectedReviewedRevision:
              reviewedRevision,

            expectedArchiveSha256,
            expectedTreeManifestSha256,

            expectedDependencyManifestSha256:
              dependencyManifest.manifestSha256,

            expectedDependencyFileCount:
              dependencyManifest.fileCount,

            expectedDependencyTotalBytes:
              dependencyManifest.totalBytes,
          });

        if (
          receipt.identityManifestSha256 !==
            artifactAuthority.identityManifestSha256 ||
          receipt.installedFileCount !==
            artifactAuthority.treeVerification.fileCount
        ) {
          throw fail(
            "Existing immutable release receipt does not match the verified release contents.",
          );
        }

        return portableReleaseInstallationResultFromReceipt(
          finalArtifactRoot,
          receiptPath,
          receipt,
        );
      }

      if (
        finalReleaseExists
      ) {
        const artifactAuthority =
          await verifyPortableReleaseArtifactAuthority({
            artifactRoot:
              finalArtifactRoot,

            reviewedRevision,

            manifest,
            treeVerifier,
            identityVerifier,

            identityRootFailureMessage:
              "Portable runtime identity root does not match the published release root.",
          });

        const dependencyManifest =
          requirePortableReleaseDependencyManifestAuthority(
            await dependencyManifestCreator(
              finalDependencyRoot,
            ),
          );

        if (
          await portableReleasePathExists(
            receiptPath,
          )
        ) {
          throw fail(
            "Install receipt appeared while crash recovery was in progress.",
          );
        }

        throw fail(
          "Missing install receipt cannot independently authorize the published dependency tree.",
        );
      }

      privateInstallRoot =
        await mkdtemp(
          join(
            stagingRoot,
            `.${reviewedRevision}.installing-`,
          ),
        );

      const privateDirectoryGuard =
        dependencies.requirePrivateInstallDirectory ??
        (
          process.platform ===
            "linux"
            ? enforcePortableReleasePrivateDirectoryMode
            : async (): Promise<void> => {}
        );

      await privateDirectoryGuard(
        privateInstallRoot,
      );

      const sameFilesystemGuard =
        dependencies.requireSameFilesystem ??
        requirePortableReleaseSameFilesystem;

      await sameFilesystemGuard({
        releasesRoot,

        stagingReleaseRoot:
          privateInstallRoot,
      });

      const privateArtifactRoot =
        resolve(
          privateInstallRoot,
          "app",
        );

      await mkdir(
        privateArtifactRoot,
      );

      const extractor =
        dependencies.extractVerifiedArchive ??
        extractArchive;

      await extractor({
        archivePath:
          snapshot.archivePath,

        destinationRoot:
          privateArtifactRoot,
      });

      const artifactAuthority =
        await verifyPortableReleaseArtifactAuthority({
          artifactRoot:
            privateArtifactRoot,

          reviewedRevision,

          manifest,
          treeVerifier,
          identityVerifier,

          identityRootFailureMessage:
            "Portable runtime identity root does not match the private installation root.",
        });

      const dependencyPreparer =
        dependencies.prepareProductionDependencies ??
        preparePortableReleaseProductionDependencies;

      const preparedDependencyManifest =
        requirePortableReleaseDependencyManifestAuthority(
          await dependencyPreparer({
            revisionRoot:
              privateInstallRoot,

            artifactRoot:
              privateArtifactRoot,
          }),
        );

      const dependencyManifest =
        requirePortableReleaseDependencyManifestAuthority(
          await dependencyManifestCreator(
            resolve(
              privateInstallRoot,
              "node_modules",
            ),
          ),
        );

      if (
        dependencyManifest.schemaVersion !==
          preparedDependencyManifest.schemaVersion ||
        dependencyManifest.kind !==
          preparedDependencyManifest.kind ||
        dependencyManifest.manifestSha256 !==
          preparedDependencyManifest.manifestSha256 ||
        dependencyManifest.fileCount !==
          preparedDependencyManifest.fileCount ||
        dependencyManifest.totalBytes !==
          preparedDependencyManifest.totalBytes
      ) {
        throw fail(
          "Private production dependencies changed after dependency preparation.",
        );
      }

      if (
        await portableReleasePathExists(
          finalReleaseRoot,
        ) ||
        await portableReleasePathExists(
          receiptPath,
        )
      ) {
        throw fail(
          "Release installation destination changed while verification was in progress.",
        );
      }

      const publisher =
        dependencies.publishInstalledRelease ??
        publishPortableReleaseAtomically;

      await publisher({
        stagingReleaseRoot:
          privateInstallRoot,

        finalReleaseRoot,
      });

      published =
        true;

      privateInstallRoot =
        null;

      const receipt =
        createPortableReleaseInstallReceipt({
          reviewedRevision,

          archiveSha256:
            expectedArchiveSha256,

          treeManifestSha256:
            expectedTreeManifestSha256,

          identityManifestSha256:
            artifactAuthority.identityManifestSha256,

          installedFileCount:
            artifactAuthority.treeVerification.fileCount,

          dependencyManifestSha256:
            dependencyManifest.manifestSha256,

          dependencyFileCount:
            dependencyManifest.fileCount,

          dependencyTotalBytes:
            dependencyManifest.totalBytes,
        });

      try {
        await writePortableReleaseInstallReceipt(
          receiptPath,
          receipt,
        );

        await syncPortableReleaseDirectory(
          releasesRoot,
        );
      } catch (cause) {
        if (
          published &&
          await portableReleasePathExists(
            finalReleaseRoot,
          )
        ) {
          await rm(
            finalReleaseRoot,
            {
              recursive:
                true,

              force:
                true,
            },
          );

          published =
            false;
        }

        throw cause;
      }

      return portableReleaseInstallationResultFromReceipt(
        finalArtifactRoot,
        receiptPath,
        receipt,
      );
    } catch (cause) {
      if (
        published &&
        await portableReleasePathExists(
          finalReleaseRoot,
        )
      ) {
        await rm(
          finalReleaseRoot,
          {
            recursive:
              true,

            force:
              true,
          },
        );
      }

      throw cause;
    } finally {
      if (
        privateInstallRoot !==
          null
      ) {
        await rm(
          privateInstallRoot,
          {
            recursive:
              true,

            force:
              true,
          },
        );
      }

      await snapshot.cleanup();
    }
  } finally {
    await installLock.release();
  }
}
