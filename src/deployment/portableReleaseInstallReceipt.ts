import {
  isPortableReleaseRevision,
  isPortableReleaseSha256,
  portableReleaseInstallFailure as fail,
} from "./portableReleaseInstallContract.js";

const RECEIPT_SCHEMA_VERSION =
  "2.0";

const RECEIPT_KIND =
  "BUSYBOOKIE_PORTABLE_RELEASE_INSTALL_RECEIPT";

export type PortableReleaseInstallReceipt =
  Readonly<{
    schemaVersion:
      typeof RECEIPT_SCHEMA_VERSION;

    kind:
      typeof RECEIPT_KIND;

    reviewedRevision:
      string;

    archiveSha256:
      string;

    treeManifestSha256:
      string;

    identityManifestSha256:
      string;

    installedFileCount:
      number;

    dependencyManifestSha256:
      string;

    dependencyFileCount:
      number;

    dependencyTotalBytes:
      number;
  }>;

export function createPortableReleaseInstallReceipt(
  input: Readonly<{
    reviewedRevision:
      string;

    archiveSha256:
      string;

    treeManifestSha256:
      string;

    identityManifestSha256:
      string;

    installedFileCount:
      number;

    dependencyManifestSha256:
      string;

    dependencyFileCount:
      number;

    dependencyTotalBytes:
      number;
  }>,
): PortableReleaseInstallReceipt {
  return Object.freeze({
    schemaVersion:
      RECEIPT_SCHEMA_VERSION,

    kind:
      RECEIPT_KIND,

    reviewedRevision:
      input.reviewedRevision,

    archiveSha256:
      input.archiveSha256,

    treeManifestSha256:
      input.treeManifestSha256,

    identityManifestSha256:
      input.identityManifestSha256,

    installedFileCount:
      input.installedFileCount,

    dependencyManifestSha256:
      input.dependencyManifestSha256,

    dependencyFileCount:
      input.dependencyFileCount,

    dependencyTotalBytes:
      input.dependencyTotalBytes,
  });
}

function requireExactKeys(
  value:
    Record<string, unknown>,

  keys:
    readonly string[],
): void {
  const actual =
    Object.keys(
      value,
    ).sort();

  const expected =
    [...keys].sort();

  if (
    actual.length !==
      expected.length ||
    actual.some(
      (
        key,
        index,
      ) =>
        key !==
        expected[index],
    )
  ) {
    throw fail(
      "Install receipt has an invalid shape.",
    );
  }
}

export function parsePortableReleaseInstallReceipt(
  bytes: Buffer,
): PortableReleaseInstallReceipt {
  let raw:
    unknown;

  try {
    raw =
      JSON.parse(
        new TextDecoder(
          "utf-8",
          {
            fatal:
              true,
          },
        ).decode(
          bytes,
        ),
      );
  } catch (cause) {
    throw fail(
      "Install receipt is not valid UTF-8 JSON.",
      {
        cause,
      },
    );
  }

  if (
    raw ===
      null ||
    typeof raw !==
      "object" ||
    Array.isArray(
      raw,
    )
  ) {
    throw fail(
      "Install receipt has an invalid shape.",
    );
  }

  const value =
    raw as
      Record<string, unknown>;

  requireExactKeys(
    value,
    [
      "schemaVersion",
      "kind",
      "reviewedRevision",
      "archiveSha256",
      "treeManifestSha256",
      "identityManifestSha256",
      "installedFileCount",
      "dependencyManifestSha256",
      "dependencyFileCount",
      "dependencyTotalBytes",
    ],
  );

  if (
    value.schemaVersion !==
      RECEIPT_SCHEMA_VERSION ||
    value.kind !==
      RECEIPT_KIND ||
    typeof value.reviewedRevision !==
      "string" ||
    !isPortableReleaseRevision(
      value.reviewedRevision,
    ) ||
    typeof value.archiveSha256 !==
      "string" ||
    !isPortableReleaseSha256(
      value.archiveSha256,
    ) ||
    typeof value.treeManifestSha256 !==
      "string" ||
    !isPortableReleaseSha256(
      value.treeManifestSha256,
    ) ||
    typeof value.identityManifestSha256 !==
      "string" ||
    !isPortableReleaseSha256(
      value.identityManifestSha256,
    ) ||
    typeof value.installedFileCount !==
      "number" ||
    !Number.isSafeInteger(
      value.installedFileCount,
    ) ||
    value.installedFileCount <
      1 ||
    typeof value.dependencyManifestSha256 !==
      "string" ||
    !isPortableReleaseSha256(
      value.dependencyManifestSha256,
    ) ||
    typeof value.dependencyFileCount !==
      "number" ||
    !Number.isSafeInteger(
      value.dependencyFileCount,
    ) ||
    value.dependencyFileCount <
      1 ||
    typeof value.dependencyTotalBytes !==
      "number" ||
    !Number.isSafeInteger(
      value.dependencyTotalBytes,
    ) ||
    value.dependencyTotalBytes <
      1
  ) {
    throw fail(
      "Install receipt contains invalid authority fields.",
    );
  }

  return Object.freeze({
    schemaVersion:
      RECEIPT_SCHEMA_VERSION,

    kind:
      RECEIPT_KIND,

    reviewedRevision:
      value.reviewedRevision,

    archiveSha256:
      value.archiveSha256,

    treeManifestSha256:
      value.treeManifestSha256,

    identityManifestSha256:
      value.identityManifestSha256,

    installedFileCount:
      value.installedFileCount,

    dependencyManifestSha256:
      value.dependencyManifestSha256,

    dependencyFileCount:
      value.dependencyFileCount,

    dependencyTotalBytes:
      value.dependencyTotalBytes,
  });
}
