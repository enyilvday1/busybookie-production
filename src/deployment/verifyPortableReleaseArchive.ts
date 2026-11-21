import {
  execFile,
} from "node:child_process";

import {
  lstat,
  mkdir,
  readFile,
} from "node:fs/promises";

import {
  isAbsolute,
  resolve,
} from "node:path";

import {
  promisify,
} from "node:util";

import {
  parsePortableReleaseTreeManifest,
} from "./portableReleaseTreeManifest.js";

import {
  createPortableReleaseVerificationSnapshot,
} from "./portableReleaseVerificationSnapshot.js";

import {
  verifyPortableReleaseExtractedTree,
} from "./verifyPortableReleaseExtractedTree.js";

const execFileAsync =
  promisify(
    execFile,
  );

const MAX_TAR_LISTING_BYTES =
  32 * 1024 * 1024;

export type PortableReleaseArchiveVerificationResult =
  Readonly<{
    memberCount: number;
    members: readonly string[];
  }>;

function fail(
  message: string,
  options?: ErrorOptions,
): Error {
  return new Error(
    `Portable release archive verification failed: ${message}`,
    options,
  );
}

async function requireRegularInputFile(
  path: string,
  label: string,
): Promise<void> {
  let metadata:
    Awaited<ReturnType<typeof lstat>>;

  try {
    metadata =
      await lstat(
        path,
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
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.nlink !== 1
  ) {
    throw fail(
      `${label} must be a regular single-link file.`,
    );
  }
}

function parseArchiveRelativePath(
  archiveName: string,
  directory: boolean,
): string | null {
  if (
    archiveName === "./" &&
    directory
  ) {
    return null;
  }

  if (
    !archiveName.startsWith("./") ||
    archiveName.startsWith(".//") ||
    archiveName.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(
      archiveName,
    )
  ) {
    throw fail(
      "Archive contains an unsafe member path.",
    );
  }

  let relativePath =
    archiveName.slice(
      2,
    );

  if (directory) {
    if (
      !relativePath.endsWith("/")
    ) {
      throw fail(
        "Archive directory member is malformed.",
      );
    }

    relativePath =
      relativePath.slice(
        0,
        -1,
      );
  } else if (
    relativePath.endsWith("/")
  ) {
    throw fail(
      "Archive regular-file member is malformed.",
    );
  }

  if (
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    isAbsolute(
      relativePath,
    )
  ) {
    throw fail(
      "Archive contains an unsafe member path.",
    );
  }

  const segments =
    relativePath.split("/");

  if (
    segments.some(
      segment =>
        segment.length === 0 ||
        segment === "." ||
        segment === "..",
    )
  ) {
    throw fail(
      "Archive contains an unsafe member path.",
    );
  }

  return relativePath;
}

async function tarText(
  args: readonly string[],
): Promise<string> {
  try {
    const result =
      await execFileAsync(
        "tar",
        [
          "--force-local",
          ...args,
        ],
        {
          windowsHide:
            true,
          encoding:
            "utf8",
          maxBuffer:
            MAX_TAR_LISTING_BYTES,
        },
      );

    return result.stdout;
  } catch (cause) {
    throw fail(
      "GNU tar could not inspect the archive.",
      {
        cause,
      },
    );
  }
}

function splitTarLines(
  output: string,
): readonly string[] {
  if (
    output.length === 0
  ) {
    return Object.freeze(
      [],
    );
  }

  const normalized =
    output.endsWith("\n")
      ? output.slice(
          0,
          -1,
        )
      : output;

  if (
    normalized.length === 0
  ) {
    return Object.freeze(
      [],
    );
  }

  return Object.freeze(
    normalized.split(
      /\r?\n/u,
    ),
  );
}

async function listArchiveEntries(
  archivePath: string,
): Promise<
  readonly Readonly<{
    archiveName: string;
    relativePath: string | null;
    type: "DIRECTORY" | "REGULAR";
  }>[]
> {
  const [
    namesOutput,
    verboseOutput,
  ] =
    await Promise.all([
      tarText([
        "--gzip",
        "--list",
        "--file",
        archivePath,
      ]),
      tarText([
        "--gzip",
        "--list",
        "--verbose",
        "--numeric-owner",
        "--file",
        archivePath,
      ]),
    ]);

  const names =
    splitTarLines(
      namesOutput,
    );

  const verboseLines =
    splitTarLines(
      verboseOutput,
    );

  if (
    names.length === 0 ||
    names.length !==
      verboseLines.length
  ) {
    throw fail(
      "Archive listing is inconsistent.",
    );
  }

  const seenArchiveNames =
    new Set<string>();

  const seenRelativePaths =
    new Set<string>();

  const entries:
    Array<
      Readonly<{
        archiveName: string;
        relativePath: string | null;
        type: "DIRECTORY" | "REGULAR";
      }>
    > =
    [];

  for (
    let index = 0;
    index < names.length;
    index += 1
  ) {
    const archiveName =
      names[index];

    const verboseLine =
      verboseLines[index];

    if (
      archiveName === undefined ||
      verboseLine === undefined ||
      verboseLine.length === 0
    ) {
      throw fail(
        "Archive listing is malformed.",
      );
    }

    if (
      seenArchiveNames.has(
        archiveName,
      )
    ) {
      throw fail(
        "Archive contains a duplicate member.",
      );
    }

    seenArchiveNames.add(
      archiveName,
    );

    const typeCharacter =
      verboseLine[0];

    let type:
      "DIRECTORY" | "REGULAR";

    if (
      typeCharacter ===
      "d"
    ) {
      type =
        "DIRECTORY";
    } else if (
      typeCharacter ===
      "-"
    ) {
      type =
        "REGULAR";
    } else {
      throw fail(
        "Archive contains a non-regular member.",
      );
    }

    const relativePath =
      parseArchiveRelativePath(
        archiveName,
        type ===
          "DIRECTORY",
      );

    if (
      relativePath !== null
    ) {
      if (
        seenRelativePaths.has(
          relativePath,
        )
      ) {
        throw fail(
          "Archive contains a duplicate portable path.",
        );
      }

      seenRelativePaths.add(
        relativePath,
      );
    }

    entries.push(
      Object.freeze({
        archiveName,
        relativePath,
        type,
      }),
    );
  }

  return Object.freeze(
    entries,
  );
}

async function extractArchiveToPrivateRoot(
  archivePath: string,
  destinationRoot: string,
): Promise<void> {
  try {
    await execFileAsync(
      "tar",
      [
        "--force-local",
        "--gzip",
        "--extract",
        "--file",
        archivePath,
        "--no-same-owner",
        "--no-same-permissions",
      ],
      {
        cwd:
          destinationRoot,
        windowsHide:
          true,
        encoding:
          "utf8",
        maxBuffer:
          MAX_TAR_LISTING_BYTES,
      },
    );
  } catch (cause) {
    throw fail(
      "GNU tar could not extract the validated archive into the private verification root.",
      {
        cause,
      },
    );
  }
}

export async function verifyPortableReleaseArchive(
  input: Readonly<{
    archivePath: string;
    treeManifestPath: string;
    expectedArchiveSha256: string;
    expectedTreeManifestSha256: string;
  }>,
): Promise<PortableReleaseArchiveVerificationResult> {
  const snapshot =
    await createPortableReleaseVerificationSnapshot({
      archivePath:
        input.archivePath,
      treeManifestPath:
        input.treeManifestPath,
    });

  try {
    const sha256Pattern =
      /^[0-9a-f]{64}$/;

    if (
      !sha256Pattern.test(
        input.expectedArchiveSha256,
      )
    ) {
      throw fail(
        "Expected release archive SHA-256 must be exactly 64 lowercase hexadecimal characters.",
      );
    }

    if (
      !sha256Pattern.test(
        input.expectedTreeManifestSha256,
      )
    ) {
      throw fail(
        "Expected whole-tree manifest SHA-256 must be exactly 64 lowercase hexadecimal characters.",
      );
    }

    if (
      snapshot.archiveSha256 !==
      input.expectedArchiveSha256
    ) {
      throw fail(
        "Release archive SHA-256 does not match the external authority.",
      );
    }

    if (
      snapshot.treeManifestSha256 !==
      input.expectedTreeManifestSha256
    ) {
      throw fail(
        "Whole-tree manifest SHA-256 does not match the external authority.",
      );
    }
    let manifestBytes:
      Buffer;

    try {
      manifestBytes =
        await readFile(
          snapshot.treeManifestPath,
        );
    } catch (cause) {
      throw fail(
        "Whole-tree manifest snapshot could not be read.",
        {
          cause,
        },
      );
    }

    const manifest =
      parsePortableReleaseTreeManifest(
        manifestBytes,
      );

    const archiveEntries =
      await listArchiveEntries(
        snapshot.archivePath,
      );

    const regularEntries =
      archiveEntries.filter(
        entry =>
          entry.type ===
          "REGULAR",
      );

    if (
      regularEntries.length !==
      manifest.length
    ) {
      throw fail(
        "Archive regular-file inventory does not match the whole-tree manifest.",
      );
    }

    const archivePaths =
      regularEntries.map(
        archiveEntry => {
          if (
            archiveEntry.relativePath ===
            null
          ) {
            throw fail(
              "Archive regular-file path is missing.",
            );
          }

          return archiveEntry.relativePath;
        },
      );

    const expectedPaths =
      manifest.map(
        entry =>
          entry.relativePath,
      );

    const sortedArchivePaths =
      [...archivePaths].sort();

    if (
      sortedArchivePaths.length !==
        expectedPaths.length ||
      sortedArchivePaths.some(
        (
          memberPath,
          index,
        ) =>
          memberPath !==
          expectedPaths[index],
      )
    ) {
      throw fail(
        "Archive regular-file inventory does not exactly match the whole-tree manifest.",
      );
    }

    const extractedRoot =
      resolve(
        snapshot.root,
        "extracted",
      );

    await mkdir(
      extractedRoot,
      {
        recursive: false,
      },
    );

    await extractArchiveToPrivateRoot(
      snapshot.archivePath,
      extractedRoot,
    );

    const extractedVerification =
      await verifyPortableReleaseExtractedTree({
        root:
          extractedRoot,
        manifest,
      });

    if (
      extractedVerification.fileCount !==
        expectedPaths.length ||
      extractedVerification.files.some(
        (
          memberPath,
          index,
        ) =>
          memberPath !==
          expectedPaths[index],
      )
    ) {
      throw fail(
        "Extracted regular-file inventory does not exactly match the whole-tree manifest.",
      );
    }

    return Object.freeze({
      memberCount:
        extractedVerification.fileCount,
      members:
        extractedVerification.files,
    });
  } finally {
    await snapshot.cleanup();
  }
}
