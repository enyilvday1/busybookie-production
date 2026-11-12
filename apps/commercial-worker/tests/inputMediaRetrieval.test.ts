import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createHostFaultLatch } from "../src/hostFaultLatch.js";
import {
  detectReferenceImageType,
  isObjectKey,
  OBJECT_STORAGE_INPUT_MAX_READ_ATTEMPTS,
  OBJECT_STORAGE_INPUT_READ_DEADLINE_MS,
  parseGenerationRequestReferenceImage,
  parseReferenceImage,
  retrieveVerifiedReferenceImage,
  type ReferenceImageRetrievalDependencies,
} from "../src/inputMediaRetrieval.js";
import type { ObjectStore } from "../src/objectStorageContract.js";
import type { DeadlineTimer } from "../src/preProviderOrchestration.js";
import { WorkerError } from "../src/workerError.js";
import { createInMemoryObjectStore } from "./support/inMemoryObjectStore.js";

// R44B10P1: the unwired input-media library with the test-only in-memory
// store. No network, filesystem or real time.

const ACCOUNT_A = randomUUID();
const ACCOUNT_B = randomUUID();
const KEY = "images/reference.webp";
const MAX = 4096;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from("WEBPVP8 "), Buffer.alloc(8, 1)]);

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const ref = (bytes: Uint8Array, contentType: string, overrides: Record<string, unknown> = {}) => ({
  key: KEY,
  sha256: sha(bytes),
  byteCount: bytes.length,
  contentType,
  ...overrides,
});

// Records each deadline and lets a test fire it; nothing waits in real time.
function manualTimer() {
  const deadlines: { ms: number; fire: () => void; cancelled: boolean }[] = [];
  const timer: DeadlineTimer = (ms, onExpiry) => {
    const entry = { ms, fire: onExpiry, cancelled: false };
    deadlines.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  return { timer, deadlines };
}

function setup() {
  const memory = createInMemoryObjectStore();
  const latch = createHostFaultLatch();
  const time = manualTimer();
  const dependencies: ReferenceImageRetrievalDependencies = { store: memory.store, latch, deadlineTimer: time.timer };
  return { memory, latch, time, dependencies };
}

async function failure(promise: Promise<unknown>): Promise<WorkerError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(WorkerError);
  return error as WorkerError;
}

describe("reference-image parser", () => {
  it.each([
    ["PNG", PNG, "image/png"],
    ["JPEG", JPEG, "image/jpeg"],
    ["WebP", WEBP, "image/webp"],
  ] as const)("accepts a valid %s reference exactly", (_name, bytes, contentType) => {
    const parsed = parseReferenceImage(ref(bytes, contentType));
    expect(parsed).toEqual({ key: KEY, sha256: sha(bytes), byteCount: bytes.length, contentType });
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("accepts a relative-looking key as an opaque object key", () => {
    expect(isObjectKey("images/reference.webp")).toBe(true);
    expect(isObjectKey("a")).toBe(true);
    expect(isObjectKey("a".repeat(512))).toBe(true);
    expect(isObjectKey("x/y.z_w-1")).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["overlong", "a".repeat(513)],
    ["illegal character", "images/ref erence.webp"],
    ["non-alphanumeric start", "_images/a.png"],
    ["double slash", "images//a.png"],
    ["dot segment", "images/./a.png"],
    ["dot-dot segment", "images/../a.png"],
    ["leading dot segment", "a/.."],
    ["trailing slash", "images/"],
    ["absolute Unix path", "/var/lib/busybookie/media/a.png"],
    ["Windows drive path", "C:\\media\\a.png"],
    ["Windows forward-slash drive path", "C:/media/a.png"],
    ["UNC path", "\\\\server\\share\\a.png"],
    ["https URL", "https://bucket.example/a.png"],
    ["file URL", "file:///etc/passwd"],
    ["scheme form", "s3://bucket/a.png"],
    ["query", "images/a.png?X-Signature=abc"],
    ["not a string", 42],
  ])("rejects a key: %s", (_name, key) => {
    expect(isObjectKey(key)).toBe(false);
    expect(() => parseReferenceImage(ref(PNG, "image/png", { key }))).toThrow(expect.objectContaining({ code: "OBJECT_REFERENCE_INVALID" }));
  });

  it.each([
    ["malformed SHA-256", { sha256: "abc" }],
    ["uppercase SHA-256", { sha256: sha(PNG).toUpperCase() }],
    ["padded SHA-256", { sha256: ` ${sha(PNG)}` }],
    ["byteCount 0", { byteCount: 0 }],
    ["negative byteCount", { byteCount: -1 }],
    ["fractional byteCount", { byteCount: 1.5 }],
    ["NaN byteCount", { byteCount: Number.NaN }],
    ["infinite byteCount", { byteCount: Number.POSITIVE_INFINITY }],
    ["unsafe byteCount", { byteCount: Number.MAX_SAFE_INTEGER + 1 }],
    ["string byteCount", { byteCount: "16" }],
    ["unsupported type", { contentType: "image/gif" }],
    ["video type", { contentType: "video/mp4" }],
    ["octet stream", { contentType: "application/octet-stream" }],
    ["uppercase type", { contentType: "IMAGE/PNG" }],
    ["type with parameters", { contentType: "image/png; charset=binary" }],
  ])("rejects %s", (_name, overrides) => {
    expect(() => parseReferenceImage(ref(PNG, "image/png", overrides))).toThrow(expect.objectContaining({ code: "OBJECT_REFERENCE_INVALID" }));
  });

  it.each(["url", "signedUrl", "localPath", "path", "sourceImagePath", "mediaRoot", "file", "uri", "accountId", "bucket"])(
    "rejects the alternate member %s inside referenceImage",
    (member) => {
      expect(() => parseReferenceImage({ ...ref(PNG, "image/png"), [member]: "x" })).toThrow(expect.objectContaining({ code: "OBJECT_REFERENCE_INVALID" }));
    },
  );

  it("rejects a non-object, an array, a missing member and a non-plain object", () => {
    for (const value of [null, "images/a.png", [ref(PNG, "image/png")], Object.create(null), new Map()]) {
      expect(() => parseReferenceImage(value)).toThrow(expect.objectContaining({ code: "OBJECT_REFERENCE_INVALID" }));
    }
    const { sha256: _omitted, ...missing } = ref(PNG, "image/png");
    expect(() => parseReferenceImage(missing)).toThrow(expect.objectContaining({ code: "OBJECT_REFERENCE_INVALID" }));
  });

  it("reads only the optional referenceImage member of a generation request", () => {
    expect(parseGenerationRequestReferenceImage({ prompt: "x", sourceImagePath: "C:/media/a.png", url: "https://x" })).toBeNull();
    expect(parseGenerationRequestReferenceImage({ prompt: "x", referenceImage: ref(PNG, "image/png") })).toEqual(parseReferenceImage(ref(PNG, "image/png")));
    expect(() => parseGenerationRequestReferenceImage({ referenceImage: "images/a.png" })).toThrow(expect.objectContaining({ code: "OBJECT_REFERENCE_INVALID" }));
  });
});

describe("media signatures", () => {
  it("detects PNG, JPEG and WebP by leading bytes only", () => {
    expect(detectReferenceImageType(PNG)).toBe("image/png");
    expect(detectReferenceImageType(JPEG)).toBe("image/jpeg");
    expect(detectReferenceImageType(WEBP)).toBe("image/webp");
    expect(detectReferenceImageType(Buffer.from("GIF89a"))).toBeNull();
    expect(detectReferenceImageType(PNG.subarray(0, 7))).toBeNull();
    expect(detectReferenceImageType(Buffer.from("RIFF\0\0\0\0WAVE"))).toBeNull();
    expect(detectReferenceImageType(Buffer.from("RIFF\0\0\0\0WEB"))).toBeNull();
  });
});

describe("verified reference-image retrieval", () => {
  it.each([
    ["PNG", PNG, "image/png"],
    ["JPEG", JPEG, "image/jpeg"],
    ["WebP", WEBP, "image/webp"],
  ] as const)("returns exactly the verified %s bytes in one store call", async (_name, bytes, contentType) => {
    const run = setup();
    run.memory.seed(ACCOUNT_A, KEY, bytes);
    const result = await retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(bytes, contentType), maxBytes: MAX }, run.dependencies);
    expect(Buffer.isBuffer(result.bytes)).toBe(true);
    expect(result.bytes.equals(bytes)).toBe(true);
    expect(result).toMatchObject({ byteCount: bytes.length, sha256: sha(bytes), contentType });
    expect(run.memory.calls).toHaveLength(1);
    const [call] = run.memory.calls;
    expect(call).toMatchObject({ accountId: ACCOUNT_A, key: KEY, maxBytes: MAX });
    expect(call!.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(call!).sort()).toEqual(["accountId", "key", "maxBytes", "signal"]);
    expect(run.latch.isTripped()).toBe(false);
    // The deadline was armed at 10000 ms and cancelled once the read settled.
    expect(run.time.deadlines.map(({ ms, cancelled }) => ({ ms, cancelled }))).toEqual([{ ms: 10000, cancelled: true }]);
  });

  it("returns a private copy that later store mutation cannot change", async () => {
    const run = setup();
    run.memory.seed(ACCOUNT_A, KEY, PNG);
    const result = await retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png"), maxBytes: MAX }, run.dependencies);
    run.memory.mutateForTest(ACCOUNT_A, KEY, JPEG);
    expect(result.bytes.equals(PNG)).toBe(true);
  });

  it("isolates accounts: another account gets NOT_FOUND for the same key", async () => {
    const run = setup();
    run.memory.seed(ACCOUNT_A, KEY, WEBP);
    await expect(retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(WEBP, "image/webp"), maxBytes: MAX }, run.dependencies)).resolves.toBeDefined();
    const other = setup();
    other.memory.seed(ACCOUNT_A, KEY, WEBP);
    const error = await failure(retrieveVerifiedReferenceImage({ accountId: ACCOUNT_B, reference: ref(WEBP, "image/webp"), maxBytes: MAX }, other.dependencies));
    expect(error.code).toBe("OBJECT_NOT_FOUND");
    expect(other.memory.calls.map(({ accountId }) => accountId)).toEqual([ACCOUNT_B]);
  });
});

describe("size and integrity", () => {
  it("never calls the store when the declared byte count exceeds maxBytes", async () => {
    const run = setup();
    run.memory.seed(ACCOUNT_A, KEY, PNG);
    const error = await failure(retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png"), maxBytes: PNG.length - 1 }, run.dependencies));
    expect(error.code).toBe("OBJECT_TOO_LARGE");
    expect(run.memory.calls).toHaveLength(0);
    expect(run.latch.isTripped()).toBe(true);
  });

  it("fails closed when the store reports TOO_LARGE or returns more than maxBytes", async () => {
    const run = setup();
    run.memory.forceNext("TOO_LARGE");
    expect((await failure(retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png"), maxBytes: MAX }, run.dependencies))).code).toBe("OBJECT_TOO_LARGE");
    expect(run.memory.calls).toHaveLength(1);
    const oversized = setup();
    oversized.memory.forceNext({ found: Buffer.concat([PNG, Buffer.alloc(32)]) });
    const error = await failure(retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png"), maxBytes: PNG.length }, oversized.dependencies));
    expect(error.code).toBe("OBJECT_TOO_LARGE");
    expect(oversized.memory.calls).toHaveLength(1);
    expect(oversized.latch.isTripped()).toBe(true);
  });

  it.each([
    ["shorter than declared", PNG.subarray(0, PNG.length - 1)],
    ["longer than declared", Buffer.concat([PNG, Buffer.from([0])])],
  ])("rejects a byte count %s as an integrity mismatch with no retry", async (_name, returned) => {
    const run = setup();
    run.memory.forceNext({ found: returned });
    const error = await failure(retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png"), maxBytes: MAX }, run.dependencies));
    expect(error.code).toBe("OBJECT_INTEGRITY_MISMATCH");
    expect(run.memory.calls).toHaveLength(1);
    expect(run.latch.isTripped()).toBe(true);
  });

  it("rejects a wrong digest and mutated bytes with no retry", async () => {
    const wrong = setup();
    wrong.memory.seed(ACCOUNT_A, KEY, PNG);
    const bad = await failure(
      retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png", { sha256: sha(JPEG) }), maxBytes: MAX }, wrong.dependencies),
    );
    expect(bad.code).toBe("OBJECT_INTEGRITY_MISMATCH");
    expect(wrong.memory.calls).toHaveLength(1);

    const mutated = setup();
    mutated.memory.seed(ACCOUNT_A, KEY, PNG);
    const reference = ref(PNG, "image/png");
    const altered = Buffer.from(PNG);
    altered[PNG.length - 1] = 0x00;
    mutated.memory.mutateForTest(ACCOUNT_A, KEY, altered);
    const error = await failure(retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference, maxBytes: MAX }, mutated.dependencies));
    expect(error.code).toBe("OBJECT_INTEGRITY_MISMATCH");
    expect(mutated.memory.calls).toHaveLength(1);
    expect(mutated.latch.isTripped()).toBe(true);
    // The expected digest is never updated.
    expect(reference.sha256).toBe(sha(PNG));
  });

  it.each([
    ["PNG claim with JPEG bytes", JPEG, "image/png"],
    ["JPEG claim with WebP bytes", WEBP, "image/jpeg"],
    ["WebP claim with PNG bytes", PNG, "image/webp"],
    ["unknown bytes", Buffer.from("GIF89a-not-allowed"), "image/png"],
    ["a truncated signature", PNG.subarray(0, 4), "image/png"],
  ] as const)("rejects %s as a media-type mismatch with no retry", async (_name, bytes, contentType) => {
    const run = setup();
    run.memory.seed(ACCOUNT_A, KEY, bytes);
    const error = await failure(retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(bytes, contentType), maxBytes: MAX }, run.dependencies));
    expect(error.code).toBe("OBJECT_MEDIA_TYPE_INVALID");
    expect(run.memory.calls).toHaveLength(1);
    expect(run.latch.isTripped()).toBe(true);
  });
});

describe("read retry and deadlines", () => {
  it("locks two attempts and a 10000 ms deadline", () => {
    expect(OBJECT_STORAGE_INPUT_MAX_READ_ATTEMPTS).toBe(2);
    expect(OBJECT_STORAGE_INPUT_READ_DEADLINE_MS).toBe(10000);
  });

  it("retries one UNAVAILABLE and succeeds on the second call with a fresh signal", async () => {
    const run = setup();
    run.memory.seed(ACCOUNT_A, KEY, JPEG);
    run.memory.forceNext("UNAVAILABLE");
    await expect(retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(JPEG, "image/jpeg"), maxBytes: MAX }, run.dependencies)).resolves.toBeDefined();
    expect(run.memory.calls).toHaveLength(2);
    expect(run.memory.calls[0]!.signal).not.toBe(run.memory.calls[1]!.signal);
    expect(run.time.deadlines.map(({ ms }) => ms)).toEqual([10000, 10000]);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("stops after two UNAVAILABLE reads without tripping the latch", async () => {
    const run = setup();
    run.memory.forceNext("UNAVAILABLE", "UNAVAILABLE", "UNAVAILABLE");
    const error = await failure(retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png"), maxBytes: MAX }, run.dependencies));
    expect(error.code).toBe("OBJECT_STORAGE_UNAVAILABLE");
    expect(run.memory.calls).toHaveLength(2);
    expect(run.latch.isTripped()).toBe(false);
  });

  it.each([
    ["NOT_FOUND", "OBJECT_NOT_FOUND"],
    ["ACCESS_DENIED", "OBJECT_STORAGE_ACCESS_DENIED"],
    ["TOO_LARGE", "OBJECT_TOO_LARGE"],
    ["INVALID_OBJECT", "OBJECT_INTEGRITY_MISMATCH"],
  ] as const)("never retries %s and trips the latch", async (status, code) => {
    const run = setup();
    run.memory.forceNext(status, "UNAVAILABLE");
    const error = await failure(retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png"), maxBytes: MAX }, run.dependencies));
    expect(error.code).toBe(code);
    expect(run.memory.calls).toHaveLength(1);
    expect(run.latch.isTripped()).toBe(true);
  });

  it("makes zero store calls for a malformed reference", async () => {
    const run = setup();
    const error = await failure(
      retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png", { key: "https://bucket.example/a.png" }), maxBytes: MAX }, run.dependencies),
    );
    expect(error.code).toBe("OBJECT_REFERENCE_INVALID");
    expect(run.memory.calls).toHaveLength(0);
    expect(run.time.deadlines).toHaveLength(0);
    expect(run.latch.isTripped()).toBe(true);
  });

  it("treats an expired per-attempt deadline as UNAVAILABLE and retries once under a new deadline", async () => {
    const run = setup();
    run.memory.seed(ACCOUNT_A, KEY, PNG);
    run.memory.forceNext("HANG");
    const pending = retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png"), maxBytes: MAX }, run.dependencies);
    while (run.time.deadlines.length === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    expect(run.time.deadlines[0]!.ms).toBe(10000);
    run.time.deadlines[0]!.fire();
    const result = await pending;
    expect(result.bytes.equals(PNG)).toBe(true);
    expect(run.memory.calls).toHaveLength(2);
    expect(run.memory.calls[0]!.signal.aborted).toBe(true);
    expect(run.memory.calls[1]!.signal.aborted).toBe(false);
    expect(run.time.deadlines).toHaveLength(2);
  });

  it("gives up after two expired deadlines without tripping the latch", async () => {
    const run = setup();
    run.memory.forceNext("HANG", "HANG");
    const pending = retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png"), maxBytes: MAX }, run.dependencies);
    for (let fired = 0; fired < 2; fired += 1) {
      while (run.time.deadlines.length <= fired) await new Promise<void>((resolve) => setImmediate(resolve));
      run.time.deadlines[fired]!.fire();
    }
    expect((await failure(pending)).code).toBe("OBJECT_STORAGE_UNAVAILABLE");
    expect(run.memory.calls).toHaveLength(2);
    expect(run.latch.isTripped()).toBe(false);
  });

  it("treats a throwing or malformed store as an invariant failure, not an outage", async () => {
    for (const store of [
      { getObject: async () => Promise.reject(new Error("vendor detail https://bucket.example/secret")) },
      { getObject: async () => ({ status: "WEIRD" }) },
      { getObject: async () => ({ status: "FOUND", bytes: "not bytes" }) },
    ] as unknown as ObjectStore[]) {
      const latch = createHostFaultLatch();
      const error = await failure(
        retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png"), maxBytes: MAX }, { store, latch, deadlineTimer: manualTimer().timer }),
      );
      expect(error.code).toBe("OBJECT_INTEGRITY_MISMATCH");
      expect(error.message).not.toMatch(/bucket|https|secret/);
      expect(latch.isTripped()).toBe(true);
    }
  });
});

describe("configuration and no fallback", () => {
  it.each([
    ["no store", undefined],
    ["a store without getObject", {}],
    ["a null store", null],
  ])("fails closed with %s, trips the latch and reads nothing", async (_name, store) => {
    const latch = createHostFaultLatch();
    const error = await failure(
      retrieveVerifiedReferenceImage(
        { accountId: ACCOUNT_A, reference: ref(PNG, "image/png"), maxBytes: MAX },
        { store, latch } as unknown as ReferenceImageRetrievalDependencies,
      ),
    );
    expect(error.code).toBe("WORKER_CONFIGURATION_INVALID");
    expect(latch.isTripped()).toBe(true);
  });

  it.each([
    ["zero maxBytes", { maxBytes: 0 }],
    ["fractional maxBytes", { maxBytes: 1.5 }],
    ["empty account", { accountId: "" }],
  ])("fails closed on %s before any read", async (_name, overrides) => {
    const run = setup();
    const error = await failure(retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png"), maxBytes: MAX, ...overrides }, run.dependencies));
    expect(error.code).toBe("WORKER_CONFIGURATION_INVALID");
    expect(run.memory.calls).toHaveLength(0);
    expect(run.latch.isTripped()).toBe(true);
  });

  it("never resolves a relative-looking key anywhere but the injected store", async () => {
    // A key that names a real file relative to this test's working directory
    // is still only an object-store key: absent from the store, NOT_FOUND.
    const run = setup();
    const reference = ref(PNG, "image/png", { key: "package.json" });
    const error = await failure(retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference, maxBytes: MAX }, run.dependencies));
    expect(error.code).toBe("OBJECT_NOT_FOUND");
    expect(run.memory.calls.map(({ key }) => key)).toEqual(["package.json"]);
  });

  it("keeps the key, account, digest and URLs out of every error message", async () => {
    const cases: Array<[string, () => Promise<unknown>]> = [];
    for (const status of ["NOT_FOUND", "UNAVAILABLE", "ACCESS_DENIED", "TOO_LARGE", "INVALID_OBJECT"] as const) {
      const run = setup();
      run.memory.forceNext(status, status);
      cases.push([status, () => retrieveVerifiedReferenceImage({ accountId: ACCOUNT_A, reference: ref(PNG, "image/png"), maxBytes: MAX }, run.dependencies)]);
    }
    for (const [, attempt] of cases) {
      const error = await failure(attempt());
      const visible = `${error.message} ${JSON.stringify(error)} ${String(error.stack)}`;
      for (const secret of [KEY, ACCOUNT_A, sha(PNG), "https://"]) expect(visible.includes(secret)).toBe(false);
    }
  });
});
