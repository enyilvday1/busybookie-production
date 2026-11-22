import {
  randomBytes,
} from "node:crypto";

import {
  chmod,
  lstat,
  mkdir,
  rename,
  stat,
} from "node:fs/promises";

import {
  resolve,
} from "node:path";

import {
  portableReleaseInstallFailure as fail,
} from "./portableReleaseInstallContract.js";

import {
  syncPortableReleaseDirectory,
  type PortableReleaseDirectorySync,
} from "./portableReleaseFilesystemDurability.js";

const QUARANTINE_DIRECTORY =
  ".quarantine";

const REVISION_PATTERN =
  /^[0-9a-f]{40}$/u;

const QUARANTINE_SUFFIX_PATTERN =
  /^[0-9a-z]+-[0-9a-f]{16}$/u;

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

function createPortableReleaseQuarantineSuffix(): string {
  return `${Date.now().toString(
    36,
  )}-${randomBytes(
    8,
  ).toString(
    "hex",
  )}`;
}

// Moves an uncommitted (receipt-less) release directory into releasesRoot/.quarantine as evidence only.
// The move is one same-filesystem rename that never replaces existing evidence, and is made durable by
// fsyncing both affected directories.
export async function quarantinePortableRelease(
  input: Readonly<{
    releasesRoot: string;
    reviewedRevision: string;
    releaseRoot: string;
  }>,
  dependencies: Readonly<{
    syncDirectory?:
      PortableReleaseDirectorySync;

    createQuarantineSuffix?:
      () => string;
  }> = {},
): Promise<string> {
  const releasesRoot =
    resolve(
      input.releasesRoot,
    );

  const quarantineRoot =
    resolve(
      releasesRoot,
      QUARANTINE_DIRECTORY,
    );

  const syncDirectory =
    dependencies.syncDirectory ??
    syncPortableReleaseDirectory;

  const createSuffix =
    dependencies.createQuarantineSuffix ??
    createPortableReleaseQuarantineSuffix;

  if (
    !REVISION_PATTERN.test(
      input.reviewedRevision,
    ) ||
    resolve(
      input.releaseRoot,
    ) !==
      resolve(
        releasesRoot,
        input.reviewedRevision,
      )
  ) {
    throw fail(
      "Portable release quarantine source must be the reviewed revision directory inside the releases root.",
    );
  }

  try {
    await mkdir(
      quarantineRoot,
    );
  } catch (cause) {
    if (
      !(
        cause instanceof Error &&
        "code" in cause &&
        cause.code ===
          "EEXIST"
      )
    ) {
      throw fail(
        "Portable release quarantine directory could not be created.",
        {
          cause,
        },
      );
    }
  }

  let metadata:
    Awaited<
      ReturnType<typeof lstat>
    >;

  try {
    metadata =
      await lstat(
        quarantineRoot,
      );
  } catch (cause) {
    throw fail(
      "Portable release quarantine directory could not be inspected.",
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
      "Portable release quarantine must be a safe real directory.",
    );
  }

  let releasesDevice:
    number;

  let quarantineDevice:
    number;

  try {
    [
      releasesDevice,
      quarantineDevice,
    ] =
      await Promise.all([
        stat(
          releasesRoot,
        ).then(
          value =>
            value.dev,
        ),
        stat(
          quarantineRoot,
        ).then(
          value =>
            value.dev,
        ),
      ]);
  } catch (cause) {
    throw fail(
      "Portable release quarantine filesystem identity could not be established.",
      {
        cause,
      },
    );
  }

  if (
    releasesDevice !==
      quarantineDevice
  ) {
    throw fail(
      "Portable release quarantine must be on the same filesystem as the releases root.",
    );
  }

  const suffix =
    createSuffix();

  if (
    !QUARANTINE_SUFFIX_PATTERN.test(
      suffix,
    )
  ) {
    throw fail(
      "Portable release quarantine destination name is invalid.",
    );
  }

  const destination =
    resolve(
      quarantineRoot,
      `${input.reviewedRevision}.${suffix}`,
    );

  if (
    await portableReleasePathExists(
      destination,
    )
  ) {
    throw fail(
      "Portable release quarantine destination already exists; existing evidence is never overwritten.",
    );
  }

  try {
    await rename(
      input.releaseRoot,
      destination,
    );
  } catch (cause) {
    throw fail(
      "Uncommitted portable release could not be moved into quarantine.",
      {
        cause,
      },
    );
  }

  await syncDirectory(
    releasesRoot,
  );

  await syncDirectory(
    quarantineRoot,
  );

  return destination;
}
