import type {
  PortableReleaseInstallReceipt,
} from "./portableReleaseInstallReceipt.js";

export type PortableReleaseInstallationResult =
  Readonly<{
    reviewedRevision: string;
    releaseRoot: string;
    receiptPath: string;
    archiveSha256: string;
    treeManifestSha256: string;
    identityManifestSha256: string;
    installedFileCount: number;
    dependencyManifestSha256: string;
    dependencyFileCount: number;
    dependencyTotalBytes: number;
  }>;

export function portableReleaseInstallationResultFromReceipt(
  releaseRoot: string,
  receiptPath: string,
  receipt: PortableReleaseInstallReceipt,
): PortableReleaseInstallationResult {
  return Object.freeze({
    reviewedRevision:
      receipt.reviewedRevision,

    releaseRoot,

    receiptPath,

    archiveSha256:
      receipt.archiveSha256,

    treeManifestSha256:
      receipt.treeManifestSha256,

    identityManifestSha256:
      receipt.identityManifestSha256,

    installedFileCount:
      receipt.installedFileCount,

    dependencyManifestSha256:
      receipt.dependencyManifestSha256,

    dependencyFileCount:
      receipt.dependencyFileCount,

    dependencyTotalBytes:
      receipt.dependencyTotalBytes,
  });
}
