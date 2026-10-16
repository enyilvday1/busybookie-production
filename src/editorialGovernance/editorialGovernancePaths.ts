import { isAbsolute, join, resolve } from "node:path";

// Bytes-only path infrastructure for E6 editorial governance storage. It understands safe primitive names only
// (lowercase SHA-256 hex and 16-digit revision numbers); raw subject or actor text never becomes a path component.
export const EDITORIAL_GOVERNANCE_RECORD_DIRECTORIES = ["proposals", "reviews", "revisions"] as const;
export type EditorialGovernanceRecordDirectory = (typeof EDITORIAL_GOVERNANCE_RECORD_DIRECTORIES)[number];

const SHA = /^[a-f0-9]{64}$/;
const HASH_FILE = /^[a-f0-9]{64}\.json$/;
const REVISION_FILE = /^[0-9]{16}\.json$/;
const RANDOM_HEX = /^[0-9a-f]{32}$/;
const TEMP_SUFFIX = /\.tmp-[0-9a-f]{32}$/;

export function assertGovernanceSha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA.test(value)) throw new Error(`Editorial governance ${label} must be a lowercase SHA-256.`);
  return value;
}

export function assertGovernanceDirectory(value: unknown): EditorialGovernanceRecordDirectory {
  if (!(EDITORIAL_GOVERNANCE_RECORD_DIRECTORIES as readonly unknown[]).includes(value)) {
    throw new Error("Editorial governance directory must be proposals, reviews or revisions.");
  }
  return value as EditorialGovernanceRecordDirectory;
}

export function governanceRevisionFileName(revisionNumber: unknown): string {
  if (typeof revisionNumber !== "number" || !Number.isSafeInteger(revisionNumber) || revisionNumber < 1) {
    throw new Error("Editorial governance revision number must be a safe integer >= 1.");
  }
  return `${String(revisionNumber).padStart(16, "0")}.json`;
}

export function isCanonicalGovernanceFileName(directory: EditorialGovernanceRecordDirectory, name: string): boolean {
  if (directory !== "revisions") return HASH_FILE.test(name);
  if (!REVISION_FILE.test(name)) return false;
  const n = Number(name.slice(0, 16));
  return Number.isSafeInteger(n) && n >= 1;
}

export function reservedGovernanceTempName(directory: EditorialGovernanceRecordDirectory, finalName: string, randomHex: string): string {
  if (!isCanonicalGovernanceFileName(directory, finalName)) throw new Error("Editorial governance temp requires a canonical final name.");
  if (!RANDOM_HEX.test(randomHex)) throw new Error("Editorial governance temp suffix must be 32 lowercase hex.");
  return `.${finalName}.tmp-${randomHex}`;
}

export function isReservedGovernanceTempName(directory: EditorialGovernanceRecordDirectory, name: string): boolean {
  if (!name.startsWith(".") || !TEMP_SUFFIX.test(name)) return false;
  return isCanonicalGovernanceFileName(directory, name.slice(1, name.length - ".tmp-".length - 32));
}

function governanceRoot(root: unknown): string {
  if (typeof root !== "string" || root.length === 0 || !isAbsolute(root)) throw new Error("Editorial governance root must be an absolute path.");
  return resolve(root);
}

export function governanceSubjectPath(root: string, subjectSha256: string): string {
  return join(governanceRoot(root), "subjects", assertGovernanceSha256(subjectSha256, "subjectSha256"));
}

export function governanceDirectoryPath(root: string, subjectSha256: string, directory: EditorialGovernanceRecordDirectory): string {
  return join(governanceSubjectPath(root, subjectSha256), assertGovernanceDirectory(directory));
}

export function governanceFilePath(root: string, subjectSha256: string, directory: EditorialGovernanceRecordDirectory, name: string): string {
  if (!isCanonicalGovernanceFileName(assertGovernanceDirectory(directory), name)) {
    throw new Error("Editorial governance file name is not canonical for its directory.");
  }
  return join(governanceDirectoryPath(root, subjectSha256, directory), name);
}
