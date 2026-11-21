import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";

import {
  dirname,
  join,
  resolve,
} from "node:path";

import {
  portableReleaseInstallFailure as fail,
} from "./portableReleaseInstallContract.js";

import {
  parsePortableReleaseInstallReceipt,
  type PortableReleaseInstallReceipt,
} from "./portableReleaseInstallReceipt.js";

import {
  portableReleasePathExists,
} from "./portableReleaseFilesystem.js";

import {
  syncPortableReleaseDirectory,
} from "./portableReleaseFilesystemDurability.js";

const RECEIPT_DIRECTORY =
  ".receipts";

export function portableReleaseInstallReceiptPath(
  releasesRoot: string,
  reviewedRevision: string,
): string {
  return resolve(
    releasesRoot,
    RECEIPT_DIRECTORY,
    `${reviewedRevision}.json`,
  );
}

export async function readExactPortableReleaseInstallReceiptReplay(
  input: Readonly<{
    receiptPath: string;
    expectedReviewedRevision: string;
    expectedArchiveSha256: string;
    expectedTreeManifestSha256: string;
    expectedDependencyManifestSha256: string;
    expectedDependencyFileCount: number;
    expectedDependencyTotalBytes: number;
  }>,
): Promise<PortableReleaseInstallReceipt> {
  let bytes:
    Buffer;

  try {
    bytes =
      await readFile(
        input.receiptPath,
      );
  } catch (cause) {
    throw fail(
      "Existing immutable release directory is not backed by a readable install receipt.",
      {
        cause,
      },
    );
  }

  const receipt =
    parsePortableReleaseInstallReceipt(
      bytes,
    );

  if (
    receipt.reviewedRevision !==
      input.expectedReviewedRevision ||
    receipt.archiveSha256 !==
      input.expectedArchiveSha256 ||
    receipt.treeManifestSha256 !==
      input.expectedTreeManifestSha256 ||
    receipt.dependencyManifestSha256 !==
      input.expectedDependencyManifestSha256 ||
    receipt.dependencyFileCount !==
      input.expectedDependencyFileCount ||
    receipt.dependencyTotalBytes !==
      input.expectedDependencyTotalBytes
  ) {
    throw fail(
      "Existing immutable release receipt does not match the requested release authorities.",
    );
  }

  return receipt;
}

export async function writePortableReleaseInstallReceipt(
  receiptPath: string,
  receipt: PortableReleaseInstallReceipt,
): Promise<void> {
  const receiptsRoot =
    dirname(
      receiptPath,
    );

  await mkdir(
    receiptsRoot,
    {
      recursive:
        true,
    },
  );

  const temporaryRoot =
    await mkdtemp(
      join(
        receiptsRoot,
        `.receipt-${receipt.reviewedRevision}-`,
      ),
    );

  const temporaryPath =
    join(
      temporaryRoot,
      "receipt.json",
    );

  try {
    const handle =
      await open(
        temporaryPath,
        "wx",
        0o600,
      );

    try {
      const bytes =
        Buffer.from(
          `${JSON.stringify(
            receipt,
            null,
            2,
          )}\n`,
          "utf8",
        );

      await handle.writeFile(
        bytes,
      );

      await handle.sync();
    } finally {
      await handle.close();
    }

    if (
      await portableReleasePathExists(
        receiptPath,
      )
    ) {
      throw fail(
        "Install receipt already exists.",
      );
    }

    await rename(
      temporaryPath,
      receiptPath,
    );

    await syncPortableReleaseDirectory(
      receiptsRoot,
    );
  } finally {
    await rm(
      temporaryRoot,
      {
        recursive:
          true,

        force:
          true,
      },
    );
  }
}
