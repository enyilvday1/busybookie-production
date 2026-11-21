import {
  createHash,
} from "node:crypto";

import {
  constants,
} from "node:fs";

import {
  lstat,
  mkdtemp,
  open,
  rm,
} from "node:fs/promises";

import {
  tmpdir,
} from "node:os";

import {
  join,
  resolve,
} from "node:path";

export type PortableReleaseVerificationSnapshot =
  Readonly<{
    root: string;
    archivePath: string;
    treeManifestPath: string;
    archiveSha256: string;
    treeManifestSha256: string;
    cleanup: () => Promise<void>;
  }>;

type CapturedFile =
  Readonly<{
    path: string;
    sha256: string;
  }>;

function fail(
  message: string,
  options?: ErrorOptions,
): Error {
  return new Error(
    `Portable release verification snapshot failed: ${message}`,
    options,
  );
}

async function captureAuthorityFile(
  sourcePathInput: string,
  destinationPath: string,
  label: string,
): Promise<CapturedFile> {
  const sourcePath =
    resolve(
      sourcePathInput,
    );

  let sourceMetadata:
    Awaited<
      ReturnType<typeof lstat>
    >;

  try {
    sourceMetadata =
      await lstat(
        sourcePath,
      );
  } catch (cause) {
    throw fail(
      `${label} is unavailable.`,
      {
        cause,
      },
    );
  }

  if (
    sourceMetadata.isSymbolicLink() ||
    !sourceMetadata.isFile() ||
    sourceMetadata.nlink !== 1
  ) {
    throw fail(
      `${label} must be a regular single-link file.`,
    );
  }

  let sourceHandle:
    Awaited<
      ReturnType<typeof open>
    >;

  try {
    sourceHandle =
      await open(
        sourcePath,
        constants.O_RDONLY |
          (constants.O_NOFOLLOW ?? 0) |
          (constants.O_NONBLOCK ?? 0),
      );
  } catch (cause) {
    throw fail(
      `${label} could not be opened safely.`,
      {
        cause,
      },
    );
  }

  try {
    const openedMetadata =
      await sourceHandle.stat();

    const pathMetadata =
      await lstat(
        sourcePath,
      );

    if (
      !openedMetadata.isFile() ||
      openedMetadata.nlink !== 1 ||
      pathMetadata.isSymbolicLink() ||
      !pathMetadata.isFile() ||
      pathMetadata.nlink !== 1 ||
      openedMetadata.dev !==
        pathMetadata.dev ||
      openedMetadata.ino !==
        pathMetadata.ino
    ) {
      throw fail(
        `${label} changed while it was opened.`,
      );
    }

    const destinationHandle =
      await open(
        destinationPath,
        "wx",
        0o600,
      );

    const hash =
      createHash(
        "sha256",
      );

    let total =
      0;

    try {
      const buffer =
        Buffer.allocUnsafe(
          1024 * 1024,
        );

      while (true) {
        const result =
          await sourceHandle.read(
            buffer,
            0,
            buffer.length,
            total,
          );

        if (
          result.bytesRead === 0
        ) {
          break;
        }

        const chunk =
          buffer.subarray(
            0,
            result.bytesRead,
          );

        hash.update(
          chunk,
        );

        await destinationHandle.write(
          chunk,
          0,
          chunk.length,
          total,
        );

        total +=
          result.bytesRead;
      }

      await destinationHandle.sync();

      const destinationMetadata =
        await destinationHandle.stat();

      if (
        !destinationMetadata.isFile() ||
        destinationMetadata.nlink !== 1 ||
        destinationMetadata.size !==
          total
      ) {
        throw fail(
          `${label} snapshot write verification failed.`,
        );
      }
    } finally {
      await destinationHandle.close();
    }

    const sourceAfter =
      await sourceHandle.stat();

    const pathAfter =
      await lstat(
        sourcePath,
      );

    if (
      sourceAfter.dev !==
        openedMetadata.dev ||
      sourceAfter.ino !==
        openedMetadata.ino ||
      sourceAfter.size !==
        openedMetadata.size ||
      sourceAfter.mtimeMs !==
        openedMetadata.mtimeMs ||
      sourceAfter.ctimeMs !==
        openedMetadata.ctimeMs ||
      sourceAfter.nlink !== 1 ||
      pathAfter.isSymbolicLink() ||
      !pathAfter.isFile() ||
      pathAfter.nlink !== 1 ||
      pathAfter.dev !==
        openedMetadata.dev ||
      pathAfter.ino !==
        openedMetadata.ino ||
      pathAfter.size !==
        openedMetadata.size ||
      total !==
        openedMetadata.size
    ) {
      throw fail(
        `${label} changed while being snapshotted.`,
      );
    }

    const destinationAfter =
      await lstat(
        destinationPath,
      );

    if (
      destinationAfter.isSymbolicLink() ||
      !destinationAfter.isFile() ||
      destinationAfter.nlink !== 1 ||
      destinationAfter.size !==
        total
    ) {
      throw fail(
        `${label} snapshot is not a regular single-link file.`,
      );
    }

    return Object.freeze({
      path:
        destinationPath,
      sha256:
        hash.digest(
          "hex",
        ),
    });
  } finally {
    await sourceHandle.close();
  }
}

export async function createPortableReleaseVerificationSnapshot(
  input: Readonly<{
    archivePath: string;
    treeManifestPath: string;
  }>,
): Promise<PortableReleaseVerificationSnapshot> {
  const root =
    await mkdtemp(
      join(
        tmpdir(),
        "busybookie-release-verification-",
      ),
    );

  const archivePath =
    resolve(
      root,
      "release.tar.gz",
    );

  const treeManifestPath =
    resolve(
      root,
      "release-tree.sha256",
    );

  let complete =
    false;

  try {
    const archive =
      await captureAuthorityFile(
        input.archivePath,
        archivePath,
        "Release archive",
      );

    const treeManifest =
      await captureAuthorityFile(
        input.treeManifestPath,
        treeManifestPath,
        "Whole-tree manifest",
      );

    complete =
      true;

    let cleaned =
      false;

    const cleanup =
      async (): Promise<void> => {
        if (
          cleaned
        ) {
          return;
        }

        cleaned =
          true;

        await rm(
          root,
          {
            recursive: true,
            force: true,
          },
        );
      };

    return Object.freeze({
      root,
      archivePath:
        archive.path,
      treeManifestPath:
        treeManifest.path,
      archiveSha256:
        archive.sha256,
      treeManifestSha256:
        treeManifest.sha256,
      cleanup,
    });
  } finally {
    if (
      !complete
    ) {
      await rm(
        root,
        {
          recursive: true,
          force: true,
        },
      );
    }
  }
}
