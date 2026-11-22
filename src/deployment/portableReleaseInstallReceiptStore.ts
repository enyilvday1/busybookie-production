import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  type FileHandle,
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

export type PortableReleaseInstallReceiptWriteDependencies =
  Readonly<{
    syncFile?:
      (
        handle: FileHandle,
      ) => Promise<void>;

    renameReceipt?:
      (
        source: string,
        destination: string,
      ) => Promise<void>;

    syncDirectory?:
      (
        directory: string,
      ) => Promise<void>;

    removeTemporary?:
      (
        path: string,
      ) => Promise<void>;
  }>;

async function removePortableReleaseReceiptTemporary(
  path: string,
): Promise<void> {
  await rm(
    path,
    {
      recursive:
        true,

      force:
        true,
    },
  );
}

// Durable order: temp write -> temp fsync -> rename into .receipts (the commit point) -> fsync .receipts.
export async function writePortableReleaseInstallReceipt(
  receiptPath: string,
  receipt: PortableReleaseInstallReceipt,
  dependencies: PortableReleaseInstallReceiptWriteDependencies = {},
): Promise<void> {
  const receiptsRoot =
    dirname(
      receiptPath,
    );

  const syncFile =
    dependencies.syncFile ??
    (
      async (
        handle: FileHandle,
      ): Promise<void> => {
        await handle.sync();
      }
    );

  const renameReceipt =
    dependencies.renameReceipt ??
    rename;

  const syncDirectory =
    dependencies.syncDirectory ??
    syncPortableReleaseDirectory;

  const removeTemporary =
    dependencies.removeTemporary ??
    removePortableReleaseReceiptTemporary;

  const createdReceiptsRoot =
    await mkdir(
      receiptsRoot,
      {
        recursive:
          true,
      },
    );

  const receiptsMetadata =
    await lstat(
      receiptsRoot,
    );

  if (
    receiptsMetadata.isSymbolicLink() ||
    !receiptsMetadata.isDirectory()
  ) {
    throw fail(
      "Install receipt directory must be a safe real directory.",
    );
  }

  if (
    createdReceiptsRoot !==
      undefined
  ) {
    // A newly created .receipts entry must itself be durable before any receipt inside it can be.
    await syncDirectory(
      dirname(
        receiptsRoot,
      ),
    );
  }

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

      await syncFile(
        handle,
      );
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

    await renameReceipt(
      temporaryPath,
      receiptPath,
    );

    await syncDirectory(
      receiptsRoot,
    );
  } finally {
    await removeTemporary(
      temporaryRoot,
    );
  }
}
