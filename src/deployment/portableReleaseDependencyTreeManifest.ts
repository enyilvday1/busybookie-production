import {
  createHash,
} from "node:crypto";

import {
  lstat,
  open,
  opendir,
} from "node:fs/promises";

import {
  relative,
  resolve,
  sep,
} from "node:path";

import {
  portableReleaseInstallFailure as fail,
} from "./portableReleaseInstallContract.js";

export const PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_SCHEMA_VERSION =
  "1.0";

export const PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_KIND =
  "BUSYBOOKIE_PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST";

export type PortableReleaseDependencyTreeFile =
  Readonly<{
    relativePath: string;
    bytes: number;
    sha256: string;
  }>;

export type PortableReleaseDependencyTreeManifest =
  Readonly<{
    schemaVersion:
      typeof PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_SCHEMA_VERSION;

    kind:
      typeof PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_KIND;

    manifestSha256: string;
    fileCount: number;
    totalBytes: number;
    files:
      readonly PortableReleaseDependencyTreeFile[];
  }>;

type FilesystemMetadata =
  Awaited<
    ReturnType<typeof lstat>
  >;

type DiscoveredFile =
  Readonly<{
    absolutePath: string;
    relativePath: string;
    metadata: FilesystemMetadata;
  }>;

function sha256(
  bytes: Uint8Array,
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

function comparePortablePaths(
  left: string,
  right: string,
): number {
  return left <
    right
    ? -1
    : left >
        right
      ? 1
      : 0;
}

function portableRelativePath(
  root: string,
  candidate: string,
): string {
  const value =
    relative(
      root,
      candidate,
    )
      .split(
        sep,
      )
      .join(
        "/",
      );

  if (
    value.length ===
      0 ||
    value ===
      "." ||
    value ===
      ".." ||
    value.startsWith(
      "../",
    ) ||
    value.startsWith(
      "/",
    )
  ) {
    throw fail(
      "Dependency-tree path is not a contained relative path.",
    );
  }

  return value;
}

function isStableRegularFile(
  metadata: FilesystemMetadata,
): boolean {
  return (
    !metadata.isSymbolicLink() &&
    metadata.isFile() &&
    metadata.nlink ===
      1
  );
}

function sameFilesystemIdentity(
  left: FilesystemMetadata,
  right: FilesystemMetadata,
): boolean {
  return (
    left.dev ===
      right.dev &&
    left.ino ===
      right.ino &&
    left.size ===
      right.size &&
    left.mtimeMs ===
      right.mtimeMs &&
    left.ctimeMs ===
      right.ctimeMs
  );
}

async function discoverRegularFiles(
  root: string,
): Promise<
  readonly DiscoveredFile[]
> {
  const rootMetadata =
    await lstat(
      root,
    ).catch(
      cause => {
        throw fail(
          "Dependency-tree root is unavailable.",
          {
            cause,
          },
        );
      },
    );

  if (
    rootMetadata.isSymbolicLink() ||
    !rootMetadata.isDirectory()
  ) {
    throw fail(
      "Dependency-tree root must be a real directory.",
    );
  }

  const files:
    DiscoveredFile[] =
      [];

  const visit =
    async (
      directory: string,
    ): Promise<void> => {
      let handle:
        Awaited<
          ReturnType<typeof opendir>
        >;

      try {
        handle =
          await opendir(
            directory,
          );
      } catch (cause) {
        throw fail(
          "Dependency-tree directory could not be opened.",
          {
            cause,
          },
        );
      }

      try {
        for await (
          const entry
          of handle
        ) {
          const absolutePath =
            resolve(
              directory,
              entry.name,
            );

          let metadata:
            FilesystemMetadata;

          try {
            metadata =
              await lstat(
                absolutePath,
              );
          } catch (cause) {
            throw fail(
              "Dependency-tree entry could not be inspected.",
              {
                cause,
              },
            );
          }

          if (
            metadata.isSymbolicLink()
          ) {
            throw fail(
              "Dependency tree contains a symbolic link.",
            );
          }

          if (
            metadata.isDirectory()
          ) {
            await visit(
              absolutePath,
            );

            continue;
          }

          if (
            !metadata.isFile()
          ) {
            throw fail(
              "Dependency tree contains a non-regular filesystem object.",
            );
          }

          if (
            metadata.nlink !==
              1
          ) {
            throw fail(
              "Dependency tree contains a multiply-linked regular file.",
            );
          }

          files.push(
            Object.freeze({
              absolutePath,

              relativePath:
                portableRelativePath(
                  root,
                  absolutePath,
                ),

              metadata,
            }),
          );
        }
      } finally {
        await handle.close().catch(
          () =>
            undefined,
        );
      }
    };

  await visit(
    root,
  );

  files.sort(
    (
      left,
      right,
    ) =>
      comparePortablePaths(
        left.relativePath,
        right.relativePath,
      ),
  );

  return Object.freeze(
    files,
  );
}

function sameDiscoveredInventory(
  left:
    readonly DiscoveredFile[],
  right:
    readonly DiscoveredFile[],
): boolean {
  if (
    left.length !==
      right.length
  ) {
    return false;
  }

  for (
    let index =
      0;
    index <
      left.length;
    index +=
      1
  ) {
    const leftFile =
      left[index];

    const rightFile =
      right[index];

    if (
      leftFile ===
        undefined ||
      rightFile ===
        undefined ||
      leftFile.relativePath !==
        rightFile.relativePath ||
      leftFile.absolutePath !==
        rightFile.absolutePath ||
      !sameFilesystemIdentity(
        leftFile.metadata,
        rightFile.metadata,
      )
    ) {
      return false;
    }
  }

  return true;
}

async function hashStableRegularFile(
  file: DiscoveredFile,
): Promise<
  PortableReleaseDependencyTreeFile
> {
  let metadataBefore:
    FilesystemMetadata;

  try {
    metadataBefore =
      await lstat(
        file.absolutePath,
      );
  } catch {
    throw fail(
      "Dependency-tree regular file changed before hashing.",
    );
  }

  if (
    !isStableRegularFile(
      metadataBefore,
    )
  ) {
    throw fail(
      "Dependency-tree regular file changed before hashing.",
    );
  }

  if (
    !sameFilesystemIdentity(
      file.metadata,
      metadataBefore,
    )
  ) {
    throw fail(
      "Dependency-tree inventory changed while manifest was being created.",
    );
  }

  let handle:
    Awaited<
      ReturnType<typeof open>
    >;

  try {
    handle =
      await open(
        file.absolutePath,
        "r",
      );
  } catch {
    throw fail(
      "Dependency-tree regular file changed before hashing.",
    );
  }

  try {
    const openedBefore =
      await handle.stat();

    if (
      !isStableRegularFile(
        openedBefore,
      ) ||
      !sameFilesystemIdentity(
        metadataBefore,
        openedBefore,
      )
    ) {
      throw fail(
        "Dependency-tree regular file changed before hashing.",
      );
    }

    const bytes =
      await handle.readFile();

    const openedAfter =
      await handle.stat();

    let metadataAfter:
      FilesystemMetadata;

    try {
      metadataAfter =
        await lstat(
          file.absolutePath,
        );
    } catch {
      throw fail(
        "Dependency-tree regular file changed while being hashed.",
      );
    }

    if (
      !isStableRegularFile(
        openedAfter,
      ) ||
      !isStableRegularFile(
        metadataAfter,
      ) ||
      !sameFilesystemIdentity(
        openedBefore,
        openedAfter,
      ) ||
      !sameFilesystemIdentity(
        openedBefore,
        metadataAfter,
      )
    ) {
      throw fail(
        "Dependency-tree regular file changed while being hashed.",
      );
    }

    return Object.freeze({
      relativePath:
        file.relativePath,

      bytes:
        bytes.byteLength,

      sha256:
        sha256(
          bytes,
        ),
    });
  } finally {
    await handle.close();
  }
}

export function serializePortableReleaseDependencyTreeManifest(
  files:
    readonly PortableReleaseDependencyTreeFile[],
): Buffer {
  const header =
    JSON.stringify({
      kind:
        PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_KIND,

      schemaVersion:
        PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_SCHEMA_VERSION,
    });

  const records =
    files.map(
      file =>
        JSON.stringify({
          relativePath:
            file.relativePath,

          bytes:
            file.bytes,

          sha256:
            file.sha256,
        }),
    );

  return Buffer.from(
    [
      header,
      ...records,
      "",
    ].join(
      "\n",
    ),
    "utf8",
  );
}

export type PortableReleaseDependencyTreeManifestDependencies =
  Readonly<{
    afterInitialDiscovery?:
      () => Promise<void>;
  }>;

export async function createPortableReleaseDependencyTreeManifest(
  dependencyRoot: string,
  dependencies:
    PortableReleaseDependencyTreeManifestDependencies =
      {},
): Promise<
  PortableReleaseDependencyTreeManifest
> {
  const root =
    resolve(
      dependencyRoot,
    );

  const discovered =
    await discoverRegularFiles(
      root,
    );

  if (
    discovered.length ===
      0
  ) {
    throw fail(
      "Dependency tree must contain at least one regular file.",
    );
  }

  await dependencies.afterInitialDiscovery?.();

  const files:
    PortableReleaseDependencyTreeFile[] =
      [];

  let totalBytes =
    0;

  for (
    const file
    of discovered
  ) {
    const hashed =
      await hashStableRegularFile(
        file,
      );

    totalBytes +=
      hashed.bytes;

    if (
      !Number.isSafeInteger(
        totalBytes,
      )
    ) {
      throw fail(
        "Dependency-tree byte count exceeds the supported safe-integer range.",
      );
    }

    files.push(
      hashed,
    );
  }

  const finalDiscovered =
    await discoverRegularFiles(
      root,
    );

  if (
    !sameDiscoveredInventory(
      discovered,
      finalDiscovered,
    )
  ) {
    throw fail(
      "Dependency-tree inventory changed while manifest was being created.",
    );
  }

  const frozenFiles =
    Object.freeze(
      [...files],
    );

  const manifestBytes =
    serializePortableReleaseDependencyTreeManifest(
      frozenFiles,
    );

  return Object.freeze({
    schemaVersion:
      PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_SCHEMA_VERSION,

    kind:
      PORTABLE_RELEASE_DEPENDENCY_TREE_MANIFEST_KIND,

    manifestSha256:
      sha256(
        manifestBytes,
      ),

    fileCount:
      frozenFiles.length,

    totalBytes,

    files:
      frozenFiles,
  });
}
