// The injected, read-only object-store primitive for commercial input media
// (docs/commercial/COMMERCIAL_WORKER_BRIDGE_ARCHITECTURE.md section 28,
// "Object-storage input contract", R44B10P1). Vendor-neutral: it names no
// bucket, URL, signed capability, path, provider or credential, and it has
// no write, delete, copy or upload operation.
//
// One call is one read attempt. Retry policy, deadlines and verification
// belong to the caller (inputMediaRetrieval.ts). There is no default
// implementation: production code receives a store explicitly, and the
// in-memory store under tests/support is test-only.

// The key is an opaque object-store key, never a filesystem path. The
// account is the authoritative relational account from the validated
// credential-opening context, never a member of the generation request.
export type ObjectStoreGetRequest = Readonly<{
  accountId: string;
  key: string;
  // The store refuses (TOO_LARGE) rather than return more than this.
  maxBytes: number;
  // Aborted when the caller's per-attempt deadline expires.
  signal: AbortSignal;
}>;

// Closed failures. A lookup under the wrong account is NOT_FOUND, so no
// existence oracle crosses accounts. UNAVAILABLE is the only transient one.
export type ObjectStoreFailure = "NOT_FOUND" | "UNAVAILABLE" | "ACCESS_DENIED" | "TOO_LARGE" | "INVALID_OBJECT";

export type ObjectStoreGetResult = Readonly<{ status: "FOUND"; bytes: Uint8Array }> | Readonly<{ status: ObjectStoreFailure }>;

export type ObjectStore = Readonly<{
  getObject: (request: ObjectStoreGetRequest) => Promise<ObjectStoreGetResult>;
}>;
