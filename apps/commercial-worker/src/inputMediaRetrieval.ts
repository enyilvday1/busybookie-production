import { createHash } from "node:crypto";

import type { ObjectStore, ObjectStoreGetResult } from "./objectStorageContract.js";
import { realDeadlineTimer, type DeadlineTimer } from "./preProviderOrchestration.js";
import type { InputFailureCode } from "./workerControlClient.js";
import { WorkerError, type WorkerErrorCode } from "./workerError.js";

// Commercial input-media retrieval
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 28,
// "Object-storage input contract", R44B10P1). An UNWIRED library: no
// execution path calls it yet, and it stops at verified bytes. It makes no
// control-plane request, no provider call and no lease transition.
//
//   parse the reference -> declared size within maxBytes
//   -> injected store read (at most two attempts, UNAVAILABLE only,
//      a fresh 10000 ms deadline each)
//   -> exact byte count -> SHA-256 -> PNG/JPEG/WebP signature -> bytes
//
// The key is an opaque object-store key resolved only by the injected
// store; nothing here interprets it as a path. Ownership is the
// authoritative relational account, passed separately from the reference.
//
// R44B10P2 (section 18, "input-failed route"): every failure is thrown as an
// InputMediaRetrievalError carrying one closed, typed classification, never
// derived from message text. This library decides the class only; it trips
// no latch and makes no report. The caller's policy
// (inputMediaFailurePolicy.ts) reports PERMANENT_INPUT through the
// input-failed route, does nothing more for TRANSIENT_STORAGE, and trips the
// host-fault latch for HOST_FAULT.

export const OBJECT_STORAGE_INPUT_MAX_READ_ATTEMPTS = 2;
export const OBJECT_STORAGE_INPUT_READ_DEADLINE_MS = 10000;

export const REFERENCE_IMAGE_CONTENT_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp"] as const);
export type ReferenceImageContentType = (typeof REFERENCE_IMAGE_CONTENT_TYPES)[number];

export type ReferenceImage = Readonly<{
  key: string;
  sha256: string;
  byteCount: number;
  contentType: ReferenceImageContentType;
}>;

export type VerifiedReferenceImage = Readonly<{
  bytes: Buffer;
  byteCount: number;
  sha256: string;
  contentType: ReferenceImageContentType;
}>;

export type ReferenceImageRetrievalInput = Readonly<{
  // Authoritative, from the validated credential-opening context.
  accountId: string;
  // The untrusted generationRequest.referenceImage member.
  reference: unknown;
  // The caller's ceiling; generic storage owns no provider limit.
  maxBytes: number;
}>;

export type ReferenceImageRetrievalDependencies = Readonly<{
  // Required: there is no default store.
  store: ObjectStore;
  deadlineTimer?: DeadlineTimer;
}>;

// The three closed failure classes. PERMANENT_INPUT carries exactly one
// input-failed wire code; the other two carry nothing.
export type InputMediaFailure =
  | Readonly<{ kind: "PERMANENT_INPUT"; reason: InputFailureCode }>
  | Readonly<{ kind: "TRANSIENT_STORAGE" }>
  | Readonly<{ kind: "HOST_FAULT" }>;

const permanentInput = (reason: InputFailureCode): InputMediaFailure => Object.freeze({ kind: "PERMANENT_INPUT", reason });
const TRANSIENT_STORAGE: InputMediaFailure = Object.freeze({ kind: "TRANSIENT_STORAGE" });
const HOST_FAULT: InputMediaFailure = Object.freeze({ kind: "HOST_FAULT" });

// A closed worker error plus its classification. Like every WorkerError it
// holds fixed text only: no key, account, digest, URL or store detail.
export class InputMediaRetrievalError extends WorkerError {
  constructor(
    code: WorkerErrorCode,
    readonly failure: InputMediaFailure,
  ) {
    super(code);
  }
}

// The migration 0004 storage-neutral key grammar, unchanged: 1 to 512
// characters, alphanumeric first, then letters, digits, ".", "_", "/" and
// "-"; no "//", no "." or ".." segment and no trailing "/".
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;
const DOT_SEGMENT = /(^|\/)\.\.?(\/|$)/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REFERENCE_MEMBERS = Object.freeze(["byteCount", "contentType", "key", "sha256"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

export function isObjectKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 512 &&
    KEY_PATTERN.test(value) &&
    !value.includes("//") &&
    !DOT_SEGMENT.test(value) &&
    !value.endsWith("/")
  );
}

const isPositiveSafeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

// Validates exactly the closed referenceImage member. No trimming, case
// folding or other normalisation; any other member (a URL, path or media
// root of any name) makes the whole reference invalid.
export function parseReferenceImage(value: unknown): ReferenceImage {
  if (!isPlainObject(value)) throw new WorkerError("OBJECT_REFERENCE_INVALID");
  const members = Object.keys(value).sort();
  if (members.length !== REFERENCE_MEMBERS.length || members.some((name, index) => name !== REFERENCE_MEMBERS[index])) {
    throw new WorkerError("OBJECT_REFERENCE_INVALID");
  }
  const { key, sha256, byteCount, contentType } = value;
  if (!isObjectKey(key)) throw new WorkerError("OBJECT_REFERENCE_INVALID");
  if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256)) throw new WorkerError("OBJECT_REFERENCE_INVALID");
  if (!isPositiveSafeInteger(byteCount)) throw new WorkerError("OBJECT_REFERENCE_INVALID");
  if (typeof contentType !== "string" || !(REFERENCE_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    throw new WorkerError("OBJECT_REFERENCE_INVALID");
  }
  return Object.freeze({ key, sha256, byteCount, contentType: contentType as ReferenceImageContentType });
}

// The optional generationRequest member; null when absent. Only this member
// is ever treated as an input-media source.
export function parseGenerationRequestReferenceImage(generationRequest: Readonly<Record<string, unknown>>): ReferenceImage | null {
  if (!Object.prototype.hasOwnProperty.call(generationRequest, "referenceImage")) return null;
  return parseReferenceImage(generationRequest.referenceImage);
}

const startsWith = (bytes: Uint8Array, offset: number, signature: readonly number[]) =>
  bytes.length >= offset + signature.length && signature.every((byte, index) => bytes[offset + index] === byte);

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

// The leading signature only: no extension, no decoding.
export function detectReferenceImageType(bytes: Uint8Array): ReferenceImageContentType | null {
  if (startsWith(bytes, 0, PNG)) return "image/png";
  if (startsWith(bytes, 0, JPEG)) return "image/jpeg";
  if (startsWith(bytes, 0, RIFF) && startsWith(bytes, 8, WEBP)) return "image/webp";
  return null;
}

type Attempt = ObjectStoreGetResult | Readonly<{ status: "STORE_CONTRACT_VIOLATION" }>;

const FAILURES: Readonly<Record<string, true>> = Object.freeze({ NOT_FOUND: true, UNAVAILABLE: true, ACCESS_DENIED: true, TOO_LARGE: true, INVALID_OBJECT: true });

export async function retrieveVerifiedReferenceImage(
  input: ReferenceImageRetrievalInput,
  dependencies: ReferenceImageRetrievalDependencies,
): Promise<VerifiedReferenceImage> {
  const fail = (code: WorkerErrorCode, failure: InputMediaFailure): never => {
    throw new InputMediaRetrievalError(code, failure);
  };

  // Configuration: a store must be injected; there is no fallback. A broken
  // composition is a host fault, never an input fault.
  const candidate: unknown = (dependencies as Readonly<Record<string, unknown>>).store;
  if (typeof candidate !== "object" || candidate === null || typeof (candidate as Readonly<Record<string, unknown>>).getObject !== "function") {
    return fail("WORKER_CONFIGURATION_INVALID", HOST_FAULT);
  }
  const store = candidate as ObjectStore;
  if (!isPositiveSafeInteger(input.maxBytes) || typeof input.accountId !== "string" || input.accountId.length === 0) {
    return fail("WORKER_CONFIGURATION_INVALID", HOST_FAULT);
  }
  const { accountId, maxBytes } = input;
  const timer = dependencies.deadlineTimer ?? realDeadlineTimer;

  // A malformed reference, including an unsupported declared type, makes no
  // store call.
  let reference: ReferenceImage;
  try {
    reference = parseReferenceImage(input.reference);
  } catch {
    return fail("OBJECT_REFERENCE_INVALID", permanentInput("INPUT_REFERENCE_INVALID"));
  }
  if (reference.byteCount > maxBytes) return fail("OBJECT_TOO_LARGE", permanentInput("INPUT_OBJECT_TOO_LARGE"));

  // One store read under a fresh controller and its own deadline. A deadline
  // expiry is UNAVAILABLE; any other throw or malformed result breaks the
  // store contract.
  const readOnce = async (): Promise<Attempt> => {
    const controller = new AbortController();
    const cancel = timer(OBJECT_STORAGE_INPUT_READ_DEADLINE_MS, () => controller.abort());
    try {
      const result: unknown = await store.getObject(Object.freeze({ accountId, key: reference.key, maxBytes, signal: controller.signal }));
      if (controller.signal.aborted) return Object.freeze({ status: "UNAVAILABLE" });
      const status = (result as { status?: unknown } | null)?.status;
      if (status === "FOUND" && (result as { bytes?: unknown }).bytes instanceof Uint8Array) return result as ObjectStoreGetResult;
      if (typeof status === "string" && FAILURES[status] === true) return Object.freeze({ status: status as Exclude<ObjectStoreGetResult["status"], "FOUND"> });
      return Object.freeze({ status: "STORE_CONTRACT_VIOLATION" });
    } catch {
      return Object.freeze({ status: controller.signal.aborted ? "UNAVAILABLE" : "STORE_CONTRACT_VIOLATION" });
    } finally {
      cancel();
    }
  };

  // At most two attempts, both immediate; only UNAVAILABLE earns the second.
  let attempt = await readOnce();
  if (attempt.status === "UNAVAILABLE") attempt = await readOnce();

  switch (attempt.status) {
    case "FOUND":
      break;
    case "UNAVAILABLE":
      // Two outages or expired deadlines: transient, not a host fault.
      return fail("OBJECT_STORAGE_UNAVAILABLE", TRANSIENT_STORAGE);
    case "NOT_FOUND":
      return fail("OBJECT_NOT_FOUND", permanentInput("INPUT_OBJECT_NOT_FOUND"));
    case "ACCESS_DENIED":
      return fail("OBJECT_STORAGE_ACCESS_DENIED", HOST_FAULT);
    case "TOO_LARGE":
      // The declared size is within maxBytes here, so by the store contract
      // the object disagrees with its authorized reference.
      return fail("OBJECT_TOO_LARGE", permanentInput("INPUT_OBJECT_INTEGRITY_MISMATCH"));
    default:
      // INVALID_OBJECT or a store contract violation: an invariant failure.
      return fail("OBJECT_INTEGRITY_MISMATCH", HOST_FAULT);
  }

  // Verify a private copy, so later changes to the store's buffer cannot
  // alter what was verified.
  const bytes = Buffer.from(attempt.bytes);
  // More than the bounded read allows breaks the store contract.
  if (bytes.length > maxBytes) return fail("OBJECT_TOO_LARGE", HOST_FAULT);
  if (bytes.length !== reference.byteCount) return fail("OBJECT_INTEGRITY_MISMATCH", permanentInput("INPUT_OBJECT_INTEGRITY_MISMATCH"));
  if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256) {
    return fail("OBJECT_INTEGRITY_MISMATCH", permanentInput("INPUT_OBJECT_INTEGRITY_MISMATCH"));
  }
  if (detectReferenceImageType(bytes) !== reference.contentType) return fail("OBJECT_MEDIA_TYPE_INVALID", permanentInput("INPUT_MEDIA_TYPE_INVALID"));

  return Object.freeze({ bytes, byteCount: reference.byteCount, sha256: reference.sha256, contentType: reference.contentType });
}
