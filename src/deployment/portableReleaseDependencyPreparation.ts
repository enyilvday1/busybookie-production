import {
  constants,
} from "node:fs";

import {
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  rename,
  rm,
} from "node:fs/promises";

import {
  execFile,
} from "node:child_process";

import {
  join,
  resolve,
} from "node:path";

import {
  promisify,
} from "node:util";

import {
  portableReleaseInstallFailure as fail,
} from "./portableReleaseInstallContract.js";

import {
  portableReleasePathExists,
} from "./portableReleaseFilesystem.js";

import {
  createPortableReleaseDependencyTreeManifest,
  type PortableReleaseDependencyTreeManifest,
} from "./portableReleaseDependencyTreeManifest.js";

import {
  createPortableReleaseDependencyInstallProvenance,
  writePortableReleaseDependencyInstallProvenance,
} from "./portableReleaseDependencyInstallProvenance.js";

const execFileAsync =
  promisify(
    execFile,
  );

const PACKAGE_JSON =
  "package.json";

const PACKAGE_LOCK =
  "package-lock.json";

const NODE_MODULES =
  "node_modules";

const APP_DIRECTORY =
  "app";

const DEPENDENCY_WORK_PREFIX =
  ".dependency-install-";

const NPM_EXECUTABLE =
  "npm";

export const PORTABLE_RELEASE_PRODUCTION_NPM_CI_ARGS =
  Object.freeze([
    "ci",
    "--omit=dev",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-bin-links",
  ]);

export type PortableReleaseDependencyInstallRunner =
  (
    input: Readonly<{
      cwd: string;
      executable: string;
      args: readonly string[];
    }>,
  ) => Promise<void>;

export type PortableReleaseDependencyInstallProvenanceCollector =
  (
    input: Readonly<{
      cwd: string;
      npmExecutable: string;
    }>,
  ) => Promise<
    Readonly<{
      nodeVersion: string;
      npmVersion: string;
      platform: string;
      arch: string;
    }>
  >;

export type PortableReleaseDependencyPreparer =
  (
    input: Readonly<{
      revisionRoot: string;
      artifactRoot: string;
    }>,
  ) => Promise<
    PortableReleaseDependencyTreeManifest
  >;

async function requireRealDirectory(
  directory: string,
  failureMessage: string,
): Promise<void> {
  let metadata:
    Awaited<
      ReturnType<typeof lstat>
    >;

  try {
    metadata =
      await lstat(
        directory,
      );
  } catch (cause) {
    throw fail(
      failureMessage,
      {
        cause,
      },
    );
  }

  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory()
  ) {
    throw fail(
      failureMessage,
    );
  }
}

async function readArtifactAuthorityFile(
  path: string,
  unavailableMessage: string,
): Promise<Buffer> {
  let metadata:
    Awaited<
      ReturnType<typeof lstat>
    >;

  try {
    metadata =
      await lstat(
        path,
      );
  } catch (cause) {
    throw fail(
      unavailableMessage,
      {
        cause,
      },
    );
  }

  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.nlink !==
      1
  ) {
    throw fail(
      unavailableMessage,
    );
  }

  try {
    return await readFile(
      path,
    );
  } catch (cause) {
    throw fail(
      unavailableMessage,
      {
        cause,
      },
    );
  }
}

async function runPortableReleaseProductionNpmCi(
  input: Readonly<{
    cwd: string;
    executable: string;
    args: readonly string[];
  }>,
): Promise<void> {
  if (
    process.platform !==
      "linux"
  ) {
    throw fail(
      "Default production dependency installation is supported only on Linux.",
    );
  }

  try {
    await execFileAsync(
      input.executable,
      [...input.args],
      {
        cwd:
          input.cwd,

        windowsHide:
          true,

        timeout:
          10 * 60 * 1000,

        maxBuffer:
          1024 * 1024,
      },
    );
  } catch (cause) {
    throw fail(
      "Production dependency installation failed.",
      {
        cause,
      },
    );
  }
}

export async function collectPortableReleaseDependencyInstallProvenance(
  input: Readonly<{
    cwd: string;
    npmExecutable: string;
  }>,
): Promise<
  Readonly<{
    nodeVersion: string;
    npmVersion: string;
    platform: string;
    arch: string;
  }>
> {
  let stdout:
    string;

  try {
    ({
      stdout,
    } =
      await execFileAsync(
        input.npmExecutable,
        [
          "--version",
        ],
        {
          cwd:
            input.cwd,

          windowsHide:
            true,

          timeout:
            60 * 1000,

          maxBuffer:
            64 * 1024,

          encoding:
            "utf8",
        },
      ));
  } catch (cause) {
    throw fail(
      "npm version could not be collected for dependency-install provenance.",
      {
        cause,
      },
    );
  }

  return Object.freeze({
    nodeVersion:
      process.version,

    npmVersion:
      stdout.trim(),

    platform:
      process.platform,

    arch:
      process.arch,
  });
}

export async function preparePortableReleaseProductionDependencies(
  input: Readonly<{
    revisionRoot: string;
    artifactRoot: string;
  }>,
  dependencies: Readonly<{
    runInstall?:
      PortableReleaseDependencyInstallRunner;

    createDependencyManifest?:
      typeof createPortableReleaseDependencyTreeManifest;

    collectInstallProvenance?:
      PortableReleaseDependencyInstallProvenanceCollector;
  }> = {},
): Promise<
  PortableReleaseDependencyTreeManifest
> {
  const revisionRoot =
    resolve(
      input.revisionRoot,
    );

  const artifactRoot =
    resolve(
      input.artifactRoot,
    );

  const expectedArtifactRoot =
    resolve(
      revisionRoot,
      APP_DIRECTORY,
    );

  if (
    artifactRoot !==
      expectedArtifactRoot
  ) {
    throw fail(
      "Portable release artifact root must be the app directory inside the revision container.",
    );
  }

  await requireRealDirectory(
    revisionRoot,
    "Portable release revision container must be a real directory before dependency preparation.",
  );

  await requireRealDirectory(
    artifactRoot,
    "Portable release artifact root must be a real directory before dependency preparation.",
  );

  const artifactNodeModules =
    resolve(
      artifactRoot,
      NODE_MODULES,
    );

  if (
    await portableReleasePathExists(
      artifactNodeModules,
    )
  ) {
    throw fail(
      "Verified portable release artifact must remain free of node_modules.",
    );
  }

  const finalNodeModules =
    resolve(
      revisionRoot,
      NODE_MODULES,
    );

  if (
    await portableReleasePathExists(
      finalNodeModules,
    )
  ) {
    throw fail(
      "Portable release revision container already contains dependency state.",
    );
  }

  const artifactPackagePath =
    resolve(
      artifactRoot,
      PACKAGE_JSON,
    );

  const artifactLockPath =
    resolve(
      artifactRoot,
      PACKAGE_LOCK,
    );

  const packageBytes =
    await readArtifactAuthorityFile(
      artifactPackagePath,
      "Portable release artifact package.json is unavailable or unsafe.",
    );

  const lockBytes =
    await readArtifactAuthorityFile(
      artifactLockPath,
      "Portable release artifact package-lock.json is unavailable or unsafe.",
    );

  let workRoot:
    string | null =
      null;

  let publishedDependencies =
    false;

  try {
    workRoot =
      await mkdtemp(
        join(
          revisionRoot,
          DEPENDENCY_WORK_PREFIX,
        ),
      );

    const workPackagePath =
      resolve(
        workRoot,
        PACKAGE_JSON,
      );

    const workLockPath =
      resolve(
        workRoot,
        PACKAGE_LOCK,
      );

    await copyFile(
      artifactPackagePath,
      workPackagePath,
      constants.COPYFILE_EXCL,
    );

    await copyFile(
      artifactLockPath,
      workLockPath,
      constants.COPYFILE_EXCL,
    );

    const copiedPackageBytes =
      await readFile(
        workPackagePath,
      );

    const copiedLockBytes =
      await readFile(
        workLockPath,
      );

    if (
      !copiedPackageBytes.equals(
        packageBytes,
      ) ||
      !copiedLockBytes.equals(
        lockBytes,
      )
    ) {
      throw fail(
        "Portable release dependency authority copies do not match the verified artifact.",
      );
    }

    const runner =
      dependencies.runInstall ??
      runPortableReleaseProductionNpmCi;

    await runner({
      cwd:
        workRoot,

      executable:
        NPM_EXECUTABLE,

      args:
        PORTABLE_RELEASE_PRODUCTION_NPM_CI_ARGS,
    });

    const packageBytesAfter =
      await readFile(
        workPackagePath,
      ).catch(
        cause => {
          throw fail(
            "Production dependency installation changed or removed package.json.",
            {
              cause,
            },
          );
        },
      );

    const lockBytesAfter =
      await readFile(
        workLockPath,
      ).catch(
        cause => {
          throw fail(
            "Production dependency installation changed or removed package-lock.json.",
            {
              cause,
            },
          );
        },
      );

    if (
      !packageBytesAfter.equals(
        packageBytes,
      )
    ) {
      throw fail(
        "Production dependency installation changed package.json.",
      );
    }

    if (
      !lockBytesAfter.equals(
        lockBytes,
      )
    ) {
      throw fail(
        "Production dependency installation changed package-lock.json.",
      );
    }

    const workNodeModules =
      resolve(
        workRoot,
        NODE_MODULES,
      );

    await requireRealDirectory(
      workNodeModules,
      "Production dependency installation did not create a safe node_modules directory.",
    );

    const collectProvenance =
      dependencies.collectInstallProvenance ??
      collectPortableReleaseDependencyInstallProvenance;

    const collectedProvenance =
      await collectProvenance({
        cwd:
          workRoot,

        npmExecutable:
          NPM_EXECUTABLE,
      });

    const provenance =
      createPortableReleaseDependencyInstallProvenance({
        nodeVersion:
          collectedProvenance.nodeVersion,

        npmVersion:
          collectedProvenance.npmVersion,

        platform:
          collectedProvenance.platform,

        arch:
          collectedProvenance.arch,
      });

    await writePortableReleaseDependencyInstallProvenance(
      workNodeModules,
      provenance,
    );

    const createManifest =
      dependencies.createDependencyManifest ??
      createPortableReleaseDependencyTreeManifest;

    const manifest =
      await createManifest(
        workNodeModules,
      );

    if (
      await portableReleasePathExists(
        finalNodeModules,
      )
    ) {
      throw fail(
        "Portable release dependency destination changed while preparation was in progress.",
      );
    }

    try {
      await rename(
        workNodeModules,
        finalNodeModules,
      );
    } catch (cause) {
      throw fail(
        "Prepared production dependencies could not be published inside the revision container.",
        {
          cause,
        },
      );
    }

    publishedDependencies =
      true;

    const publishedManifest =
      await createManifest(
        finalNodeModules,
      );

    if (
      publishedManifest.schemaVersion !==
        manifest.schemaVersion ||
      publishedManifest.kind !==
        manifest.kind ||
      publishedManifest.manifestSha256 !==
        manifest.manifestSha256 ||
      publishedManifest.fileCount !==
        manifest.fileCount ||
      publishedManifest.totalBytes !==
        manifest.totalBytes
    ) {
      throw fail(
        "Published production dependencies do not match the verified dependency manifest.",
      );
    }

    return publishedManifest;
  } catch (cause) {
    if (
      publishedDependencies &&
      await portableReleasePathExists(
        finalNodeModules,
      )
    ) {
      await rm(
        finalNodeModules,
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
      workRoot !==
        null
    ) {
      await rm(
        workRoot,
        {
          recursive:
            true,

          force:
            true,
        },
      );
    }
  }
}
