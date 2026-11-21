import {
  chmod,
  lstat,
  rename,
  stat,
} from "node:fs/promises";

import {
  portableReleaseInstallFailure as fail,
} from "./portableReleaseInstallContract.js";

export async function portableReleasePathExists(
  path: string,
): Promise<boolean> {
  try {
    await lstat(
      path,
    );

    return true;
  } catch (cause) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      cause.code === "ENOENT"
    ) {
      return false;
    }

    throw cause;
  }
}
export type PortableReleasePrivateDirectoryGuard =
  (
    directory: string,
  ) => Promise<void>;

type PortableReleasePrivateDirectoryMetadata =
  Readonly<{
    mode: number;
    isDirectory: () => boolean;
    isSymbolicLink: () => boolean;
  }>;

type PortableReleasePrivateDirectoryMetadataReader =
  (
    path: string,
  ) => Promise<PortableReleasePrivateDirectoryMetadata>;

type PortableReleasePrivateDirectoryModeWriter =
  (
    path: string,
    mode: number,
  ) => Promise<void>;

async function readPortableReleasePrivateDirectoryMetadata(
  path: string,
): Promise<PortableReleasePrivateDirectoryMetadata> {
  return lstat(
    path,
  );
}

export async function enforcePortableReleasePrivateDirectoryMode(
  directory: string,
  dependencies: Readonly<{
    readMetadata?: PortableReleasePrivateDirectoryMetadataReader;
    writeMode?: PortableReleasePrivateDirectoryModeWriter;
  }> = {},
): Promise<void> {
  const readMetadata =
    dependencies.readMetadata ??
    readPortableReleasePrivateDirectoryMetadata;

  const writeMode =
    dependencies.writeMode ??
    chmod;

  let before:
    PortableReleasePrivateDirectoryMetadata;

  try {
    before =
      await readMetadata(
        directory,
      );
  } catch (cause) {
    throw fail(
      "Portable release private staging directory could not be inspected before permission enforcement.",
      {
        cause,
      },
    );
  }

  if (
    before.isSymbolicLink() ||
    !before.isDirectory()
  ) {
    throw fail(
      "Portable release private staging path must be a real directory before permission enforcement.",
    );
  }

  try {
    await writeMode(
      directory,
      0o700,
    );
  } catch (cause) {
    throw fail(
      "Portable release private staging directory permissions could not be enforced.",
      {
        cause,
      },
    );
  }

  let after:
    PortableReleasePrivateDirectoryMetadata;

  try {
    after =
      await readMetadata(
        directory,
      );
  } catch (cause) {
    throw fail(
      "Portable release private staging directory permissions could not be verified.",
      {
        cause,
      },
    );
  }

  if (
    after.isSymbolicLink() ||
    !after.isDirectory() ||
    (
      after.mode &
      0o777
    ) !==
      0o700
  ) {
    throw fail(
      "Portable release private staging directory must be a real directory with mode 0700 before extraction.",
    );
  }
}

export type PortableReleaseSameFilesystemGuard =
  (
    input: Readonly<{
      releasesRoot: string;
      stagingReleaseRoot: string;
    }>,
  ) => Promise<void>;

type PortableReleaseFilesystemDeviceReader =
  (
    path: string,
  ) => Promise<number>;

async function readPortableReleaseFilesystemDevice(
  path: string,
): Promise<number> {
  const metadata =
    await stat(
      path,
    );

  return metadata.dev;
}

export async function requirePortableReleaseSameFilesystem(
  input: Readonly<{
    releasesRoot: string;
    stagingReleaseRoot: string;
  }>,
  dependencies: Readonly<{
    readDevice?: PortableReleaseFilesystemDeviceReader;
  }> = {},
): Promise<void> {
  const readDevice =
    dependencies.readDevice ??
    readPortableReleaseFilesystemDevice;

  let releasesDevice:
    number;

  let stagingDevice:
    number;

  try {
    [
      releasesDevice,
      stagingDevice,
    ] =
      await Promise.all([
        readDevice(
          input.releasesRoot,
        ),
        readDevice(
          input.stagingReleaseRoot,
        ),
      ]);
  } catch (cause) {
    throw fail(
      "Portable release publication filesystem identity could not be established.",
      {
        cause,
      },
    );
  }

  if (
    releasesDevice !==
      stagingDevice
  ) {
    throw fail(
      "Portable release staging and releases roots must be on the same filesystem for atomic publication.",
    );
  }
}

type PortableReleaseRename =
  (
    source: string,
    destination: string,
  ) => Promise<void>;

export async function publishPortableReleaseAtomically(
  input: Readonly<{
    stagingReleaseRoot: string;
    finalReleaseRoot: string;
  }>,
  dependencies: Readonly<{
    renameRelease?: PortableReleaseRename;
  }> = {},
): Promise<void> {
  const renameRelease =
    dependencies.renameRelease ??
    rename;

  try {
    await renameRelease(
      input.stagingReleaseRoot,
      input.finalReleaseRoot,
    );
  } catch (cause) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      cause.code ===
        "EXDEV"
    ) {
      throw fail(
        "Portable release publication crossed filesystem devices; atomic rename is required.",
        {
          cause,
        },
      );
    }

    throw cause;
  }
}
