import { createHash, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createHostFaultLatch } from "../src/hostFaultLatch.js";
import { handleInputMediaFailure, type InputMediaFailureOutcome } from "../src/inputMediaFailurePolicy.js";
import { InputMediaRetrievalError, retrieveVerifiedReferenceImage } from "../src/inputMediaRetrieval.js";
import type { ObjectStore } from "../src/objectStorageContract.js";
import type { DeadlineTimer } from "../src/preProviderOrchestration.js";
import type { InputFailureCode, LeaseProof, WorkerControlClient } from "../src/workerControlClient.js";
import { WorkerError } from "../src/workerError.js";
import { createInMemoryObjectStore } from "./support/inMemoryObjectStore.js";

// R44B10P2: the caller-side input-media failure policy. The retrieval
// library classifies; this policy alone reports PERMANENT_INPUT through the
// input-failed route, ignores TRANSIENT_STORAGE and trips the latch for
// HOST_FAULT. A fake client and the test-only in-memory store: no network,
// no control plane, no provider.

const ACCOUNT = randomUUID();
const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PROOF: LeaseProof = Object.freeze({ fencingCounter: 2, leaseToken: "A".repeat(43) });
const KEY = "images/reference.png";
const MAX = 4096;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const ref = (bytes: Uint8Array, contentType: string, overrides: Record<string, unknown> = {}) => ({ key: KEY, sha256: sha(bytes), byteCount: bytes.length, contentType, ...overrides });

const noDeadline: DeadlineTimer = () => () => {};

// A fake control client that answers reportInputFailed per script and fails
// the test on any other call (no permit, SUBMITTING or provider path exists).
function fakeClient(answers: ReadonlyArray<"ACK" | "UNAVAILABLE" | "REJECTED"> = ["ACK"]) {
  const reports: Array<{ executionAttemptId: string; proof: LeaseProof; failureCode: InputFailureCode; signal: AbortSignal | undefined }> = [];
  const forbidden: string[] = [];
  const reportInputFailed: WorkerControlClient["reportInputFailed"] = async (executionAttemptId, proof, failureCode, signal) => {
    reports.push({ executionAttemptId, proof, failureCode, signal });
    const answer = answers[Math.min(reports.length - 1, answers.length - 1)]!;
    if (answer === "UNAVAILABLE") throw new WorkerError("CONTROL_API_UNAVAILABLE");
    if (answer === "REJECTED") throw new WorkerError("INPUT_FAILED_REJECTED");
    return Object.freeze({ executionAttemptId, fencingCounter: proof.fencingCounter, state: "FAILED_BEFORE_SUBMISSION" as const, failureCode });
  };
  const client = new Proxy({ reportInputFailed } as unknown as WorkerControlClient, {
    get(target, property) {
      if (property === "reportInputFailed") return target.reportInputFailed;
      if (typeof property === "string") forbidden.push(property);
      return undefined;
    },
  });
  return { client, reports, forbidden };
}

async function retrieveAndHandle(store: ObjectStore, reference: unknown, client: WorkerControlClient, maxBytes = MAX) {
  const latch = createHostFaultLatch();
  let outcome: InputMediaFailureOutcome | "VERIFIED";
  try {
    await retrieveVerifiedReferenceImage({ accountId: ACCOUNT, reference, maxBytes }, { store, deadlineTimer: noDeadline });
    outcome = "VERIFIED";
  } catch (error) {
    outcome = await handleInputMediaFailure({ client, deadlineTimer: noDeadline, latch }, ATTEMPT, PROOF, error);
  }
  return { outcome, latch };
}

describe("classification-aware failure policy", () => {
  it.each([
    ["not found", "NOT_FOUND" as const, ref(PNG, "image/png"), "INPUT_OBJECT_NOT_FOUND"],
    ["a store TOO_LARGE within the declared size", "TOO_LARGE" as const, ref(PNG, "image/png"), "INPUT_OBJECT_INTEGRITY_MISMATCH"],
    ["a malformed authorized reference", undefined, ref(PNG, "image/png", { key: "https://bucket.example/a.png" }), "INPUT_REFERENCE_INVALID"],
    ["an unsupported declared type", undefined, ref(PNG, "image/gif"), "INPUT_REFERENCE_INVALID"],
  ] as const)("reports %s as a permanent input failure and never trips the latch", async (_label, forced, reference, code) => {
    const memory = createInMemoryObjectStore();
    if (forced !== undefined) memory.forceNext(forced);
    const fake = fakeClient();
    const { outcome, latch } = await retrieveAndHandle(memory.store, reference, fake.client);
    expect(outcome).toEqual({ status: "PERMANENT_INPUT_REPORTED", failureCode: code });
    expect(latch.isTripped()).toBe(false);
    expect(fake.reports.map(({ executionAttemptId, proof, failureCode }) => ({ executionAttemptId, proof, failureCode }))).toEqual([
      { executionAttemptId: ATTEMPT, proof: PROOF, failureCode: code },
    ]);
    expect(fake.reports[0]!.signal).toBeInstanceOf(AbortSignal);
    expect(fake.forbidden).toEqual([]);
  });

  it.each([
    ["a declared oversize", PNG, "image/png", PNG.length - 1, "INPUT_OBJECT_TOO_LARGE"],
    ["a SHA-256 mismatch", PNG, "image/png", MAX, "INPUT_OBJECT_INTEGRITY_MISMATCH"],
    ["a media mismatch", JPEG, "image/png", MAX, "INPUT_MEDIA_TYPE_INVALID"],
  ] as const)("reports %s as a permanent input failure without the latch", async (label, bytes, contentType, maxBytes, code) => {
    const memory = createInMemoryObjectStore();
    memory.seed(ACCOUNT, KEY, bytes);
    const reference = label === "a SHA-256 mismatch" ? ref(bytes, contentType, { sha256: sha(JPEG) }) : ref(bytes, contentType);
    const fake = fakeClient();
    const { outcome, latch } = await retrieveAndHandle(memory.store, reference, fake.client, maxBytes);
    expect(outcome).toEqual({ status: "PERMANENT_INPUT_REPORTED", failureCode: code });
    expect(latch.isTripped()).toBe(false);
    expect(fake.reports.map(({ failureCode }) => failureCode)).toEqual([code]);
    if (label === "a declared oversize") expect(memory.calls).toHaveLength(0);
  });

  it("reports a valid FOUND length mismatch as an integrity mismatch", async () => {
    const memory = createInMemoryObjectStore();
    memory.forceNext({ found: PNG.subarray(0, PNG.length - 1) });
    const fake = fakeClient();
    const { outcome, latch } = await retrieveAndHandle(memory.store, ref(PNG, "image/png"), fake.client);
    expect(outcome).toEqual({ status: "PERMANENT_INPUT_REPORTED", failureCode: "INPUT_OBJECT_INTEGRITY_MISMATCH" });
    expect(latch.isTripped()).toBe(false);
  });

  it("returns PERMANENT_INPUT_UNREPORTED after two unavailable reports, with no latch and no third request", async () => {
    const memory = createInMemoryObjectStore();
    const fake = fakeClient(["UNAVAILABLE", "UNAVAILABLE", "ACK"]);
    const { outcome, latch } = await retrieveAndHandle(memory.store, ref(PNG, "image/png"), fake.client);
    expect(outcome).toEqual({ status: "PERMANENT_INPUT_UNREPORTED", failureCode: "INPUT_OBJECT_NOT_FOUND" });
    expect(fake.reports).toHaveLength(2);
    expect(fake.reports[0]!.signal).not.toBe(fake.reports[1]!.signal);
    // Control-plane unavailability alone never trips the latch.
    expect(latch.isTripped()).toBe(false);
    expect(fake.forbidden).toEqual([]);
  });

  it("returns PERMANENT_INPUT_UNREPORTED on a refusal, after one request", async () => {
    const memory = createInMemoryObjectStore();
    const fake = fakeClient(["REJECTED", "ACK"]);
    const { outcome, latch } = await retrieveAndHandle(memory.store, ref(PNG, "image/png"), fake.client);
    expect(outcome).toEqual({ status: "PERMANENT_INPUT_UNREPORTED", failureCode: "INPUT_OBJECT_NOT_FOUND" });
    expect(fake.reports).toHaveLength(1);
    expect(latch.isTripped()).toBe(false);
  });

  it("returns PERMANENT_INPUT_REPORTED when the first response is lost and the second is the exact replay", async () => {
    const memory = createInMemoryObjectStore();
    const fake = fakeClient(["UNAVAILABLE", "ACK"]);
    const { outcome } = await retrieveAndHandle(memory.store, ref(PNG, "image/png"), fake.client);
    expect(outcome).toEqual({ status: "PERMANENT_INPUT_REPORTED", failureCode: "INPUT_OBJECT_NOT_FOUND" });
    expect(fake.reports).toHaveLength(2);
  });

  it("treats two UNAVAILABLE reads as transient storage: no report, no latch", async () => {
    const memory = createInMemoryObjectStore();
    memory.forceNext("UNAVAILABLE", "UNAVAILABLE");
    const fake = fakeClient();
    const { outcome, latch } = await retrieveAndHandle(memory.store, ref(PNG, "image/png"), fake.client);
    expect(outcome).toEqual({ status: "TRANSIENT_STORAGE" });
    expect(memory.calls).toHaveLength(2);
    expect(fake.reports).toEqual([]);
    expect(latch.isTripped()).toBe(false);
    expect(fake.forbidden).toEqual([]);
  });

  it("treats two expired read deadlines as transient storage", async () => {
    const memory = createInMemoryObjectStore();
    memory.forceNext("HANG", "HANG");
    const fired: Array<() => void> = [];
    const timer: DeadlineTimer = (_ms, onExpiry) => {
      fired.push(onExpiry);
      return () => {};
    };
    const latch = createHostFaultLatch();
    const fake = fakeClient();
    const pending = retrieveVerifiedReferenceImage({ accountId: ACCOUNT, reference: ref(PNG, "image/png"), maxBytes: MAX }, { store: memory.store, deadlineTimer: timer });
    for (let index = 0; index < 2; index += 1) {
      while (fired.length <= index) await new Promise<void>((resolve) => setImmediate(resolve));
      fired[index]!();
    }
    const error = await pending.then(() => undefined, (caught: unknown) => caught);
    expect(await handleInputMediaFailure({ client: fake.client, deadlineTimer: noDeadline, latch }, ATTEMPT, PROOF, error)).toEqual({ status: "TRANSIENT_STORAGE" });
    expect(fake.reports).toEqual([]);
    expect(latch.isTripped()).toBe(false);
  });

  const hostFaultStores: ReadonlyArray<readonly [string, () => { store: ObjectStore; reference: unknown; maxBytes?: number }]> = [
    ["access denied", () => {
      const memory = createInMemoryObjectStore();
      memory.forceNext("ACCESS_DENIED");
      return { store: memory.store, reference: ref(PNG, "image/png") };
    }],
    ["INVALID_OBJECT", () => {
      const memory = createInMemoryObjectStore();
      memory.forceNext("INVALID_OBJECT");
      return { store: memory.store, reference: ref(PNG, "image/png") };
    }],
    ["a store throw", () => ({ store: { getObject: async () => Promise.reject(new Error("vendor detail")) } as unknown as ObjectStore, reference: ref(PNG, "image/png") })],
    ["a malformed store result", () => ({ store: { getObject: async () => ({ status: "FOUND", bytes: "nope" }) } as unknown as ObjectStore, reference: ref(PNG, "image/png") })],
    ["bytes beyond the bounded maximum", () => {
      const memory = createInMemoryObjectStore();
      memory.forceNext({ found: Buffer.concat([PNG, Buffer.alloc(8)]) });
      return { store: memory.store, reference: ref(PNG, "image/png"), maxBytes: PNG.length };
    }],
    ["a missing store", () => ({ store: undefined as unknown as ObjectStore, reference: ref(PNG, "image/png") })],
    ["an invalid maxBytes", () => ({ store: createInMemoryObjectStore().store, reference: ref(PNG, "image/png"), maxBytes: 0 })],
  ];

  it.each(hostFaultStores)("treats %s as a host fault: latch tripped, no report", async (_label, build) => {
    const { store, reference, maxBytes } = build();
    const fake = fakeClient();
    const { outcome, latch } = await retrieveAndHandle(store, reference, fake.client, maxBytes ?? MAX);
    expect(outcome).toEqual({ status: "HOST_FAULT" });
    expect(latch.isTripped()).toBe(true);
    expect(fake.reports).toEqual([]);
    expect(fake.forbidden).toEqual([]);
  });

  it("treats an invalid account as a host fault", async () => {
    const latch = createHostFaultLatch();
    const fake = fakeClient();
    const error = await retrieveVerifiedReferenceImage({ accountId: "", reference: ref(PNG, "image/png"), maxBytes: MAX }, { store: createInMemoryObjectStore().store }).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(await handleInputMediaFailure({ client: fake.client, deadlineTimer: noDeadline, latch }, ATTEMPT, PROOF, error)).toEqual({ status: "HOST_FAULT" });
    expect(latch.isTripped()).toBe(true);
  });

  it("treats anything but a classified retrieval failure as a host fault, never by message text", async () => {
    for (const error of [new Error("PERMANENT_INPUT INPUT_OBJECT_NOT_FOUND"), new WorkerError("OBJECT_NOT_FOUND"), "TRANSIENT_STORAGE", undefined]) {
      const latch = createHostFaultLatch();
      const fake = fakeClient();
      expect(await handleInputMediaFailure({ client: fake.client, deadlineTimer: noDeadline, latch }, ATTEMPT, PROOF, error)).toEqual({ status: "HOST_FAULT" });
      expect(latch.isTripped()).toBe(true);
      expect(fake.reports).toEqual([]);
    }
    // The class travels on the typed error, whatever its message says.
    const latch = createHostFaultLatch();
    const fake = fakeClient();
    const typed = new InputMediaRetrievalError("OBJECT_STORAGE_ACCESS_DENIED", Object.freeze({ kind: "PERMANENT_INPUT", reason: "INPUT_OBJECT_NOT_FOUND" }));
    expect(await handleInputMediaFailure({ client: fake.client, deadlineTimer: noDeadline, latch }, ATTEMPT, PROOF, typed)).toEqual({
      status: "PERMANENT_INPUT_REPORTED",
      failureCode: "INPUT_OBJECT_NOT_FOUND",
    });
    expect(latch.isTripped()).toBe(false);
  });

  it("returns frozen outcomes and never throws", async () => {
    const fake = fakeClient(["UNAVAILABLE"]);
    const latch = createHostFaultLatch();
    const outcome = await handleInputMediaFailure({ client: fake.client, deadlineTimer: noDeadline, latch }, ATTEMPT, PROOF, new InputMediaRetrievalError("OBJECT_NOT_FOUND", Object.freeze({ kind: "PERMANENT_INPUT", reason: "INPUT_OBJECT_NOT_FOUND" })));
    expect(Object.isFrozen(outcome)).toBe(true);
  });
});
