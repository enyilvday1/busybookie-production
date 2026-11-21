import {
  createHash,
} from "node:crypto";

import {
  createReadStream,
} from "node:fs";

import {
  lstat,
  opendir,
} from "node:fs/promises";

import {
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

export type PortableReleaseExtractedTreeManifestEntry =
  Readonly<{
    relativePath: string;
    sha256: string;
  }>;

export type PortableReleaseExtractedTreeVerificationResult =
  Readonly<{
    fileCount: number;
    files: readonly string[];
  }>;

function fail(
  message: string,
  options?: ErrorOptions,
): Error {
  return new Error(
    `Portable release extracted-tree verification failed: ${message}`,
    options,
  );
}

function requirePortableRelativePath(
  value: string,
): string {
  if (
    value.length === 0 ||
    isAbsolute(value) ||
    value.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(
      value,
    )
  ) {
    throw fail(
      "Manifest contains an unsafe portable path.",
    );
  }

  const segments =
    value.split("/");

  if (
    segments.some(
      segment =>
        segment.length === 0 ||
        segment === "." ||
        segment === "..",
    )
  ) {
    throw fail(
      "Manifest contains an unsafe portable path.",
    );
  }

  return value;
}

function requireSha256(
  value: string,
): string {
  if (
    !/^[0-9a-f]{64}$/u.test(
      value,
    )
  ) {
    throw fail(
      "Manifest contains an invalid SHA-256 value.",
    );
  }

  return value;
}

function toPortableRelativePath(
  root: string,
  absolutePath: string,
): string {
  const nativeRelative =
    relative(
      root,
      absolutePath,
    );

  if (
    nativeRelative.length === 0 ||
    nativeRelative === ".." ||
    nativeRelative.startsWith(
      `..${sep}`,
    ) ||
    isAbsolute(
      nativeRelative,
    )
  ) {
    throw fail(
      "Extracted path escapes the verification root.",
    );
  }

  return nativeRelative
    .split(sep)
    .join("/");
}

async function hashRegularFile(
  absolutePath: string,
): Promise<string> {
  return await new Promise<string>(
    (
      resolvePromise,
      rejectPromise,
    ) => {
      const hash =
        createHash(
          "sha256",
        );

      const stream =
        createReadStream(
          absolutePath,
        );

      stream.on(
        "data",
        chunk => {
          hash.update(
            chunk,
          );
        },
      );

      stream.once(
        "error",
        cause => {
          rejectPromise(
            fail(
              "Extracted regular file could not be read.",
              {
                cause,
              },
            ),
          );
        },
      );

      stream.once(
        "end",
        () => {
          resolvePromise(
            hash.digest(
              "hex",
            ),
          );
        },
      );
    },
  );
}

async function listExtractedRegularFiles(
  root: string,
): Promise<
  readonly Readonly<{
    absolutePath: string;
    relativePath: string;
  }>[]
> {
  const files:
    Array<
      Readonly<{
        absolutePath: string;
        relativePath: string;
      }>
    > =
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
          "Extracted directory could not be opened.",
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

          const metadata =
            await lstat(
              absolutePath,
            );

          if (
            metadata.isSymbolicLink()
          ) {
            throw fail(
              "Extracted tree contains a symbolic link.",
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
              "Extracted tree contains a non-regular filesystem object.",
            );
          }

          if (
            metadata.nlink !== 1
          ) {
            throw fail(
              "Extracted tree contains a multi-link regular file.",
            );
          }

          const relativePath =
            toPortableRelativePath(
              root,
              absolutePath,
            );

          files.push(
            Object.freeze({
              absolutePath,
              relativePath,
            }),
          );
        }
      } finally {
        await handle.close().catch(
          () => undefined,
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
      left.relativePath.localeCompare(
        right.relativePath,
        "en",
      ),
  );

  return Object.freeze(
    files,
  );
}

export async function verifyPortableReleaseExtractedTree(
  input: Readonly<{
    root: string;
    manifest:
      readonly PortableReleaseExtractedTreeManifestEntry[];
  }>,
): Promise<PortableReleaseExtractedTreeVerificationResult> {
  const root =
    resolve(
      input.root,
    );

  let rootMetadata:
    Awaited<
      ReturnType<typeof lstat>
    >;

  try {
    rootMetadata =
      await lstat(
        root,
      );
  } catch (cause) {
    throw fail(
      "Extracted verification root is unavailable.",
      {
        cause,
      },
    );
  }

  if (
    rootMetadata.isSymbolicLink() ||
    !rootMetadata.isDirectory()
  ) {
    throw fail(
      "Extracted verification root must be a real directory.",
    );
  }

  const expectedByPath =
    new Map<
      string,
      PortableReleaseExtractedTreeManifestEntry
    >();

  let previousPath:
    string | null =
    null;

  for (
    const entry
    of input.manifest
  ) {
    const relativePath =
      requirePortableRelativePath(
        entry.relativePath,
      );

    const sha256 =
      requireSha256(
        entry.sha256,
      );

    if (
      previousPath !== null &&
      relativePath <=
        previousPath
    ) {
      throw fail(
        "Manifest paths must be strictly increasing and unique.",
      );
    }

    previousPath =
      relativePath;

    expectedByPath.set(
      relativePath,
      Object.freeze({
        relativePath,
        sha256,
      }),
    );
  }

  const extractedFiles =
    await listExtractedRegularFiles(
      root,
    );

  if (
    extractedFiles.length !==
    expectedByPath.size
  ) {
    throw fail(
      "Extracted regular-file inventory does not match the manifest.",
    );
  }

  const observedFiles:
    string[] =
    [];

  for (
    const extractedFile
    of extractedFiles
  ) {
    const expected =
      expectedByPath.get(
        extractedFile.relativePath,
      );

    if (
      expected === undefined
    ) {
      throw fail(
        "Extracted tree contains a regular file absent from the manifest.",
      );
    }

    const metadataBefore =
      await lstat(
        extractedFile.absolutePath,
      );

    if (
      metadataBefore.isSymbolicLink() ||
      !metadataBefore.isFile() ||
      metadataBefore.nlink !== 1
    ) {
      throw fail(
        "Extracted regular file changed before hashing.",
      );
    }

    const observedSha256 =
      await hashRegularFile(
        extractedFile.absolutePath,
      );

    const metadataAfter =
      await lstat(
        extractedFile.absolutePath,
      );

    if (
      metadataAfter.isSymbolicLink() ||
      !metadataAfter.isFile() ||
      metadataAfter.nlink !== 1 ||
      metadataAfter.dev !==
        metadataBefore.dev ||
      metadataAfter.ino !==
        metadataBefore.ino ||
      metadataAfter.size !==
        metadataBefore.size ||
      metadataAfter.mtimeMs !==
        metadataBefore.mtimeMs ||
      metadataAfter.ctimeMs !==
        metadataBefore.ctimeMs
    ) {
      throw fail(
        "Extracted regular file changed while being hashed.",
      );
    }

    if (
      observedSha256 !==
      expected.sha256
    ) {
      throw fail(
        "Extracted regular-file bytes do not match the manifest.",
      );
    }

    observedFiles.push(
      extractedFile.relativePath,
    );
  }

  const expectedPaths =
    [...expectedByPath.keys()];

  if (
    observedFiles.length !==
      expectedPaths.length ||
    observedFiles.some(
      (
        relativePath,
        index,
      ) =>
        relativePath !==
        expectedPaths[index],
    )
  ) {
    throw fail(
      "Extracted regular-file inventory does not exactly match the manifest.",
    );
  }

  return Object.freeze({
    fileCount:
      observedFiles.length,
    files:
      Object.freeze(
        [...observedFiles],
      ),
  });
}
