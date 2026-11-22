import {
  resolve,
} from "node:path";

import {
  isPortableReleaseRevision,
  isPortableReleaseSha256,
} from "../portableReleaseInstallContract.js";

// Exactly the installPortableRelease input shape; nothing is defaulted or inferred.
export type InstallPortableReleaseCliOptions =
  Readonly<{
    archivePath: string;
    treeManifestPath: string;
    expectedArchiveSha256: string;
    expectedTreeManifestSha256: string;
    expectedReviewedRevision: string;
    releasesRoot: string;
    stagingRoot: string;
  }>;

const PATH_FLAGS =
  Object.freeze([
    "--archive",
    "--tree-manifest",
    "--releases-root",
    "--staging-root",
  ] as const);

const SHA256_FLAGS =
  Object.freeze([
    "--expected-archive-sha256",
    "--expected-tree-manifest-sha256",
  ] as const);

const REVISION_FLAG =
  "--reviewed-revision";

const VALUE_FLAGS =
  Object.freeze([
    ...PATH_FLAGS,
    ...SHA256_FLAGS,
    REVISION_FLAG,
  ] as const);

type ValueFlag =
  typeof VALUE_FLAGS[number];

function isValueFlag(
  value: string,
): value is ValueFlag {
  return (
    VALUE_FLAGS as readonly string[]
  ).includes(
    value,
  );
}

// Exactly:
//   --archive <path> --tree-manifest <path>
//   --expected-archive-sha256 <digest> --expected-tree-manifest-sha256 <digest>
//   --reviewed-revision <40-hex> --releases-root <path> --staging-root <path>
// Each flag exactly once; no positional, =value, default, force, retry, npm or provider input.
// Pure: no filesystem access, so every argument error precedes the installer.
export function parseInstallPortableReleaseCliArgs(
  args: readonly string[],
  currentDirectory: string,
): InstallPortableReleaseCliOptions {
  const values =
    new Map<
      ValueFlag,
      string
    >();

  for (
    let index = 0;
    index < args.length;
    index += 1
  ) {
    const argument =
      args[index]!;

    if (
      isValueFlag(
        argument,
      )
    ) {
      if (
        values.has(
          argument,
        )
      ) {
        throw new Error(
          `Duplicate portable release install argument: ${argument}`,
        );
      }

      const value =
        args[
          index + 1
        ];

      if (
        value === undefined ||
        value.length === 0 ||
        value.startsWith(
          "-",
        )
      ) {
        throw new Error(
          `${argument} requires a value.`,
        );
      }

      values.set(
        argument,
        value,
      );

      index += 1;
      continue;
    }

    if (
      argument.startsWith(
        "-",
      )
    ) {
      // Never echo a value-bearing form.
      throw new Error(
        `Unknown portable release install argument: ${argument.split("=")[0]}`,
      );
    }

    throw new Error(
      "Unexpected positional portable release install argument.",
    );
  }

  const required =
    (
      flag: ValueFlag,
    ): string => {
      const value =
        values.get(
          flag,
        );

      if (
        value ===
          undefined
      ) {
        throw new Error(
          `${flag} is required.`,
        );
      }

      return value;
    };

  const path =
    (
      flag: typeof PATH_FLAGS[number],
    ): string =>
      resolve(
        currentDirectory,
        required(
          flag,
        ),
      );

  const sha256 =
    (
      flag: typeof SHA256_FLAGS[number],
    ): string => {
      const value =
        required(
          flag,
        );

      if (
        !isPortableReleaseSha256(
          value,
        )
      ) {
        throw new Error(
          `${flag} must be exactly 64 lowercase hexadecimal characters.`,
        );
      }

      return value;
    };

  const archivePath =
    path(
      "--archive",
    );

  const treeManifestPath =
    path(
      "--tree-manifest",
    );

  const expectedArchiveSha256 =
    sha256(
      "--expected-archive-sha256",
    );

  const expectedTreeManifestSha256 =
    sha256(
      "--expected-tree-manifest-sha256",
    );

  const expectedReviewedRevision =
    required(
      REVISION_FLAG,
    );

  if (
    !isPortableReleaseRevision(
      expectedReviewedRevision,
    )
  ) {
    throw new Error(
      `${REVISION_FLAG} must be exactly 40 lowercase hexadecimal characters.`,
    );
  }

  const releasesRoot =
    path(
      "--releases-root",
    );

  const stagingRoot =
    path(
      "--staging-root",
    );

  return Object.freeze({
    archivePath,
    treeManifestPath,
    expectedArchiveSha256,
    expectedTreeManifestSha256,
    expectedReviewedRevision,
    releasesRoot,
    stagingRoot,
  });
}
