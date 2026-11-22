import {
  constants,
} from "node:fs";

import {
  lstat,
  open,
  type FileHandle,
} from "node:fs/promises";

import {
  isAbsolute,
  resolve,
  sep,
} from "node:path";

import {
  portableReleaseInstallFailure as fail,
} from "./portableReleaseInstallContract.js";

function isWindowsSyncPermissionDenial(
  cause: unknown,
): boolean {
  return (
    process.platform ===
      "win32" &&
    cause instanceof Error &&
    "code" in cause &&
    cause.code ===
      "EPERM"
  );
}

export async function syncPortableReleaseDirectory(
  directory: string,
): Promise<void> {
  const handle =
    await open(
      directory,
      constants.O_RDONLY,
    );

  try {
    try {
      await handle.sync();
    } catch (cause) {
      if (
        isWindowsSyncPermissionDenial(
          cause,
        )
      ) {
        return;
      }

      throw cause;
    }
  } finally {
    await handle.close();
  }
}

export type PortableReleaseDirectorySync =
  (
    directory: string,
  ) => Promise<void>;

export type PortableReleaseFileHandleSync =
  (
    handle: FileHandle,
    path: string,
  ) => Promise<void>;

async function syncPortableReleaseFileHandle(
  handle: FileHandle,
): Promise<void> {
  try {
    await handle.sync();
  } catch (cause) {
    if (
      isWindowsSyncPermissionDenial(
        cause,
      )
    ) {
      return;
    }

    throw cause;
  }
}

function requireAuthoritativeRelativePath(
  relativePath: string,
): readonly string[] {
  if (
    typeof relativePath !==
      "string" ||
    relativePath.length <
      1 ||
    isAbsolute(
      relativePath,
    ) ||
    relativePath.includes(
      "\\",
    ) ||
    relativePath.includes(
      "\0",
    )
  ) {
    throw fail(
      "Durable release tree sync received an unsafe authoritative path.",
    );
  }

  const segments =
    relativePath.split(
      "/",
    );

  if (
    segments.some(
      segment =>
        segment.length <
          1 ||
        segment ===
          "." ||
        segment ===
          "..",
    )
  ) {
    throw fail(
      "Durable release tree sync received an unsafe authoritative path.",
    );
  }

  return segments;
}

function directoryDepth(
  relativeDirectory: string,
): number {
  return relativeDirectory ===
    ""
    ? 0
    : relativeDirectory.split(
      "/",
    ).length;
}

async function syncAuthoritativeFile(
  path: string,
  relativePath: string,
  syncFileHandle: PortableReleaseFileHandleSync,
): Promise<void> {
  let before:
    Awaited<
      ReturnType<typeof lstat>
    >;

  try {
    before =
      await lstat(
        path,
      );
  } catch (cause) {
    throw fail(
      `Authoritative release file disappeared before durable sync: ${relativePath}`,
      {
        cause,
      },
    );
  }

  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.nlink !==
      1
  ) {
    throw fail(
      `Authoritative release file is not a single-link regular file during durable sync: ${relativePath}`,
    );
  }

  let handle:
    FileHandle;

  try {
    handle =
      await open(
        path,
        constants.O_RDONLY |
          (
            constants.O_NOFOLLOW ??
            0
          ),
      );
  } catch (cause) {
    throw fail(
      `Authoritative release file could not be opened for durable sync: ${relativePath}`,
      {
        cause,
      },
    );
  }

  try {
    const after =
      await handle.stat();

    if (
      !after.isFile() ||
      after.dev !==
        before.dev ||
      after.ino !==
        before.ino
    ) {
      throw fail(
        `Authoritative release file changed during durable sync: ${relativePath}`,
      );
    }

    try {
      await syncFileHandle(
        handle,
        path,
      );
    } catch (cause) {
      throw fail(
        `Authoritative release file could not be fsynced: ${relativePath}`,
        {
          cause,
        },
      );
    }
  } finally {
    await handle.close();
  }
}

async function syncAuthoritativeDirectory(
  path: string,
  relativeDirectory: string,
  syncDirectory: PortableReleaseDirectorySync,
): Promise<void> {
  const label =
    relativeDirectory ===
      ""
      ? "."
      : relativeDirectory;

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
      `Authoritative release directory disappeared before durable sync: ${label}`,
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
      `Authoritative release directory is not a real directory during durable sync: ${label}`,
    );
  }

  try {
    await syncDirectory(
      path,
    );
  } catch (cause) {
    throw fail(
      `Authoritative release directory could not be fsynced: ${label}`,
      {
        cause,
      },
    );
  }
}

// Fsyncs exactly the supplied authoritative regular files, then every directory that contains them,
// deepest first and the root last. It never traverses the filesystem on its own.
export async function syncPortableReleaseTree(
  input: Readonly<{
    root: string;
    files: readonly string[];
  }>,
  dependencies: Readonly<{
    syncFileHandle?:
      PortableReleaseFileHandleSync;

    syncDirectory?:
      PortableReleaseDirectorySync;
  }> = {},
): Promise<void> {
  const root =
    resolve(
      input.root,
    );

  const syncFileHandle =
    dependencies.syncFileHandle ??
    syncPortableReleaseFileHandle;

  const syncDirectory =
    dependencies.syncDirectory ??
    syncPortableReleaseDirectory;

  if (
    input.files.length <
      1
  ) {
    throw fail(
      "Durable release tree sync requires at least one authoritative file.",
    );
  }

  const seenFiles =
    new Set<string>();

  const directories =
    new Set<string>([
      "",
    ]);

  for (
    const relativePath
    of input.files
  ) {
    const segments =
      requireAuthoritativeRelativePath(
        relativePath,
      );

    if (
      seenFiles.has(
        relativePath,
      )
    ) {
      throw fail(
        "Durable release tree sync received a duplicate authoritative path.",
      );
    }

    seenFiles.add(
      relativePath,
    );

    for (
      let index =
        1;
      index <
        segments.length;
      index +=
        1
    ) {
      directories.add(
        segments.slice(
          0,
          index,
        ).join(
          "/",
        ),
      );
    }

    const path =
      resolve(
        root,
        ...segments,
      );

    if (
      !path.startsWith(
        `${root}${sep}`,
      )
    ) {
      throw fail(
        "Durable release tree sync received an unsafe authoritative path.",
      );
    }

    await syncAuthoritativeFile(
      path,
      relativePath,
      syncFileHandle,
    );
  }

  const orderedDirectories =
    [...directories].sort(
      (
        left,
        right,
      ) =>
        directoryDepth(
          right,
        ) -
          directoryDepth(
            left,
          ) ||
        (
          left <
            right
            ? -1
            : left >
                right
              ? 1
              : 0
        ),
    );

  for (
    const relativeDirectory
    of orderedDirectories
  ) {
    await syncAuthoritativeDirectory(
      relativeDirectory ===
        ""
        ? root
        : resolve(
          root,
          ...relativeDirectory.split(
            "/",
          ),
        ),
      relativeDirectory,
      syncDirectory,
    );
  }
}
