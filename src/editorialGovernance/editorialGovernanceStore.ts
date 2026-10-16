import { randomBytes } from "node:crypto";
import { link, mkdir, open, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  assertGovernanceSha256, EDITORIAL_GOVERNANCE_RECORD_DIRECTORIES, governanceDirectoryPath, governanceFilePath, governanceSubjectPath,
  reservedGovernanceTempName, type EditorialGovernanceRecordDirectory,
} from "./editorialGovernancePaths.js";

// Bytes-only E6 persistence adapter. It never validates, canonicalizes or interprets editorial records: it lists
// entries, returns opaque bytes and publishes caller-derived bytes atomically without ever overwriting.

export type EditorialGovernanceListedEntry = Readonly<{
  directory: "" | EditorialGovernanceRecordDirectory;
  name: string;
  type: "file" | "directory" | "other";
  bytes: Uint8Array | null;
}>;
export type EditorialGovernancePartitionBytes = Readonly<{ subjectSha256: string; entries: readonly EditorialGovernanceListedEntry[] }>;

function errorCode(cause: unknown): string | undefined {
  return typeof cause === "object" && cause !== null ? (cause as { code?: string }).code : undefined;
}

async function readBytes(path: string): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(path));
  } catch {
    return null;
  }
}

// Lists subjects/<subjectSha256>/ and its three record directories (one level each). A missing partition is empty.
export async function readEditorialGovernancePartition(root: string, subjectSha256: string): Promise<EditorialGovernancePartitionBytes> {
  assertGovernanceSha256(subjectSha256, "subjectSha256");
  const subjectPath = governanceSubjectPath(root, subjectSha256);
  const entries: EditorialGovernanceListedEntry[] = [];
  let top;
  try {
    top = await readdir(subjectPath, { withFileTypes: true });
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return { subjectSha256, entries };
    throw cause;
  }
  for (const entry of top) {
    const type = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other";
    entries.push({ directory: "", name: entry.name, type, bytes: null });
    const directory = EDITORIAL_GOVERNANCE_RECORD_DIRECTORIES.find((candidate) => candidate === entry.name);
    if (type !== "directory" || directory === undefined) continue;
    for (const child of await readdir(join(subjectPath, entry.name), { withFileTypes: true })) {
      const childType = child.isDirectory() ? "directory" : child.isFile() ? "file" : "other";
      entries.push({
        directory, name: child.name, type: childType,
        bytes: childType === "file" ? await readBytes(join(subjectPath, entry.name, child.name)) : null,
      });
    }
  }
  return { subjectSha256, entries };
}

export type EditorialGovernancePublishResult =
  | Readonly<{ status: "PUBLISHED" }>
  | Readonly<{ status: "EXISTS"; existingBytes: Uint8Array | null }>
  | Readonly<{ status: "STORE_UNSUPPORTED"; detail: string }>;

// Hard-link failure codes that reliably mean the store cannot provide the mandatory no-clobber hard link. EMLINK
// qualifies because the temporary was just created with one link. Ambiguous codes (EPERM, EACCES, EINVAL, EROFS,
// ENOENT, EXDEV, unknown) are operational failures and propagate. There is no rename/copy fallback.
const UNSUPPORTED_LINK_CODES = new Set(["ENOTSUP", "EOPNOTSUPP", "ENOSYS", "EMLINK"]);

export type EditorialGovernanceLinkFailure = "EXISTS" | "STORE_UNSUPPORTED" | "OPERATIONAL";

// EEXIST = the canonical target already exists (no-clobber race/idempotency path), never STORE_UNSUPPORTED.
export function classifyGovernanceLinkFailure(cause: unknown): EditorialGovernanceLinkFailure {
  const code = errorCode(cause);
  if (code === "EEXIST") return "EXISTS";
  return code !== undefined && UNSUPPORTED_LINK_CODES.has(code) ? "STORE_UNSUPPORTED" : "OPERATIONAL";
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // A leftover reserved temporary is never authority.
  }
}

// Same-directory reserved temporary (exclusive create), complete write, flush, close, hard link temp -> final
// (fails with EEXIST if the final exists), unlink temp, then directory flush where supported. The publication
// primitive is always the real node:fs hard link; callers supply only validated names and opaque bytes.
export async function publishEditorialGovernanceRecord(input: Readonly<{
  root: string; subjectSha256: string; directory: EditorialGovernanceRecordDirectory; name: string; bytes: Uint8Array;
}>): Promise<EditorialGovernancePublishResult> {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.length === 0) throw new Error("Editorial governance publish requires record bytes.");
  const finalPath = governanceFilePath(input.root, input.subjectSha256, input.directory, input.name);
  const directoryPath = governanceDirectoryPath(input.root, input.subjectSha256, input.directory);
  await mkdir(directoryPath, { recursive: true });
  const tempPath = join(directoryPath, reservedGovernanceTempName(input.directory, input.name, randomBytes(16).toString("hex")));
  const handle = await open(tempPath, "wx");
  try {
    await handle.writeFile(input.bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(tempPath, finalPath);
  } catch (cause) {
    await removeQuietly(tempPath);
    const failure = classifyGovernanceLinkFailure(cause);
    if (failure === "EXISTS") return { status: "EXISTS", existingBytes: await readBytes(finalPath) };
    if (failure === "STORE_UNSUPPORTED") return { status: "STORE_UNSUPPORTED", detail: `hard link unavailable (${errorCode(cause)})` };
    throw cause;
  }
  await removeQuietly(tempPath);
  try {
    const directoryHandle = await open(directoryPath, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch {
    // Directory flush is not supported on every platform (e.g. Windows); publication is already complete.
  }
  return { status: "PUBLISHED" };
}
