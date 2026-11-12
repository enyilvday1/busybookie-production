import type { ObjectStore, ObjectStoreFailure, ObjectStoreGetRequest, ObjectStoreGetResult } from "../../src/objectStorageContract.js";

// TEST-ONLY in-memory object store (architecture section 28, "Object-storage
// input contract", R44B10P1). It implements the production ObjectStore
// contract with explicit per-account ownership and is never imported by
// src: there is no production default store. No network, filesystem,
// temporary files or timers.
//
// Objects are write-once; mutateForTest replaces bytes explicitly for
// integrity tests. Forced behaviours are consumed one per read, in order,
// before the normal lookup. A lookup under another account is NOT_FOUND.

export type ForcedRead =
  | ObjectStoreFailure
  // Never settles until the read's signal aborts, then rejects.
  | "HANG"
  // A store that ignores its own contract, for the caller's guards.
  | Readonly<{ found: Uint8Array }>;

export function createInMemoryObjectStore() {
  const objects = new Map<string, Map<string, Uint8Array>>();
  const forced: ForcedRead[] = [];
  const calls: ObjectStoreGetRequest[] = [];

  const lookup = (request: ObjectStoreGetRequest): ObjectStoreGetResult => {
    const bytes = objects.get(request.accountId)?.get(request.key);
    if (bytes === undefined) return Object.freeze({ status: "NOT_FOUND" });
    if (bytes.length > request.maxBytes) return Object.freeze({ status: "TOO_LARGE" });
    return Object.freeze({ status: "FOUND", bytes: Uint8Array.from(bytes) });
  };

  const store: ObjectStore = Object.freeze({
    getObject: async (request: ObjectStoreGetRequest): Promise<ObjectStoreGetResult> => {
      calls.push(request);
      const next = forced.shift();
      if (next === undefined) return lookup(request);
      if (next === "HANG") {
        return new Promise<ObjectStoreGetResult>((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      }
      if (typeof next === "string") return Object.freeze({ status: next });
      return Object.freeze({ status: "FOUND", bytes: Uint8Array.from(next.found) });
    },
  });

  return Object.freeze({
    store,
    calls,
    seed: (accountId: string, key: string, bytes: Uint8Array) => {
      const owned = objects.get(accountId) ?? new Map<string, Uint8Array>();
      if (owned.has(key)) throw new Error("in-memory object store is write-once");
      owned.set(key, Uint8Array.from(bytes));
      objects.set(accountId, owned);
    },
    mutateForTest: (accountId: string, key: string, bytes: Uint8Array) => {
      const owned = objects.get(accountId);
      if (owned?.has(key) !== true) throw new Error("no such object to mutate");
      owned.set(key, Uint8Array.from(bytes));
    },
    forceNext: (...reads: ForcedRead[]) => {
      forced.push(...reads);
    },
  });
}
