import { WorkerError, type WorkerErrorCode } from "./workerError.js";

// Outbound-only HTTP client for the commercial-api worker-control routes
// (POST /worker-control/v1/...). It owns no listener and has no database,
// engine or provider access. The machine credential travels only in the
// Authorization header; it never appears in a URL, query string, cookie,
// custom header, log line or error.
//
// Responses are untrusted and parsed strictly against the protocol: exact
// member sets, canonical identifiers and bounded values. Anything else is
// MALFORMED_CONTROL_RESPONSE and is never retried.

export type WorkerLease = Readonly<{
  executionJobId: string;
  executionAttemptId: string;
  attemptNumber: number;
  provider: string;
  model: string;
  generationRequest: Readonly<Record<string, unknown>>;
  generationRequestSha256: string;
  expectedCostCap: Readonly<{ unit: "MICRO_USD" | "PROVIDER_CREDITS"; amount: number }>;
  // Held in memory only, for the lifetime of this lease.
  leaseToken: string;
  fencingCounter: number;
  leaseExpiresAt: Date;
}>;

export type LeaseProof = Readonly<{ fencingCounter: number; leaseToken: string }>;

// The grant as received: the envelope and context are still untrusted here
// and are validated against the credential contract before opening.
export type WorkerCredentialGrant = Readonly<{
  executionAttemptId: string;
  fencingCounter: number;
  credentialGrantedAt: Date;
  sealedEnvelope: unknown;
  openingContext: unknown;
}>;

export type WorkerControlClient = Readonly<{
  leaseNextAttempt: () => Promise<WorkerLease | null>;
  requestCredentialGrant: (executionAttemptId: string, proof: LeaseProof) => Promise<WorkerCredentialGrant>;
}>;

export type WorkerControlClientOptions = Readonly<{
  // Origin of the commercial-api worker-control listener, for example
  // https://control.internal.example; no path, query, fragment or userinfo.
  baseUrl: string;
  // Opaque machine credential (test-only mechanism in this slice).
  machineCredential: string;
  fetchImpl?: typeof fetch;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PROVIDER = /^[A-Z][A-Z0-9_]{0,31}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const LEASE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN68 = /^[A-Za-z0-9\-._~+/]+=*$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_TOKEN_LENGTH = 4096;

const malformed = () => new WorkerError("MALFORMED_CONTROL_RESPONSE");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(value)) throw malformed();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw malformed();
  return value;
}

const text = (value: unknown, pattern: RegExp): string => {
  if (typeof value !== "string" || !pattern.test(value)) throw malformed();
  return value;
};

const positiveSafeInteger = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw malformed();
  return value;
};

const instant = (value: unknown): Date => {
  const date = new Date(text(value, ISO_INSTANT));
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) throw malformed();
  return date;
};

export function parseLeaseResponse(body: unknown): WorkerLease | null {
  const envelope = exactKeys(body, ["lease"]);
  if (envelope.lease === null) return null;
  const lease = exactKeys(envelope.lease, [
    "executionJobId",
    "executionAttemptId",
    "attemptNumber",
    "provider",
    "model",
    "generationRequest",
    "generationRequestSha256",
    "expectedCostCap",
    "leaseToken",
    "fencingCounter",
    "leaseExpiresAt",
  ]);
  const cap = exactKeys(lease.expectedCostCap, ["unit", "amount"]);
  if (cap.unit !== "MICRO_USD" && cap.unit !== "PROVIDER_CREDITS") throw malformed();
  if (!isPlainObject(lease.generationRequest) || Object.keys(lease.generationRequest).length === 0) throw malformed();
  return Object.freeze({
    executionJobId: text(lease.executionJobId, UUID),
    executionAttemptId: text(lease.executionAttemptId, UUID),
    attemptNumber: positiveSafeInteger(lease.attemptNumber),
    provider: text(lease.provider, PROVIDER),
    model: text(lease.model, MODEL),
    generationRequest: Object.freeze({ ...lease.generationRequest }),
    generationRequestSha256: text(lease.generationRequestSha256, SHA256_HEX),
    expectedCostCap: Object.freeze({ unit: cap.unit, amount: positiveSafeInteger(cap.amount) }),
    leaseToken: text(lease.leaseToken, LEASE_TOKEN),
    fencingCounter: positiveSafeInteger(lease.fencingCounter),
    leaseExpiresAt: instant(lease.leaseExpiresAt),
  });
}

// The grant must answer exactly the attempt and fencing generation asked for.
export function parseCredentialGrantResponse(body: unknown, expected: Readonly<{ executionAttemptId: string; fencingCounter: number }>): WorkerCredentialGrant {
  const grant = exactKeys(body, ["executionAttemptId", "fencingCounter", "credentialGrantedAt", "credential"]);
  const credential = exactKeys(grant.credential, ["sealedEnvelope", "openingContext"]);
  const executionAttemptId = text(grant.executionAttemptId, UUID);
  const fencingCounter = positiveSafeInteger(grant.fencingCounter);
  if (executionAttemptId !== expected.executionAttemptId || fencingCounter !== expected.fencingCounter) throw malformed();
  return Object.freeze({
    executionAttemptId,
    fencingCounter,
    credentialGrantedAt: instant(grant.credentialGrantedAt),
    sealedEnvelope: credential.sealedEnvelope,
    openingContext: credential.openingContext,
  });
}

function controlUrl(options: WorkerControlClientOptions): URL {
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    throw new WorkerError("WORKER_CONFIGURATION_INVALID");
  }
  if (
    (base.protocol !== "https:" && base.protocol !== "http:") ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== "" ||
    (base.pathname !== "/" && base.pathname !== "")
  ) {
    throw new WorkerError("WORKER_CONFIGURATION_INVALID");
  }
  return base;
}

export function createHttpWorkerControlClient(options: WorkerControlClientOptions): WorkerControlClient {
  const base = controlUrl(options);
  const credential = options.machineCredential;
  if (typeof credential !== "string" || credential.length === 0 || credential.length > MAX_TOKEN_LENGTH || !TOKEN68.test(credential)) {
    throw new WorkerError("WORKER_CONFIGURATION_INVALID");
  }
  const fetchImpl = options.fetchImpl ?? fetch;

  // Status mapping. 401 and 403 are never retried; 409 is the protocol's
  // uniform lease/grant refusal; 5xx and transport failures are UNAVAILABLE.
  async function post(path: string, body: unknown, rejected: WorkerErrorCode): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, base), {
        method: "POST",
        headers:
          body === undefined
            ? { Authorization: `Bearer ${credential}` }
            : { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
      });
    } catch {
      throw new WorkerError("CONTROL_API_UNAVAILABLE");
    }
    if (response.status === 200) {
      try {
        return await response.json();
      } catch {
        throw malformed();
      }
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 401 || response.status === 403) throw new WorkerError("WORKER_AUTHENTICATION_REJECTED");
    if (response.status === 409) throw new WorkerError(rejected);
    if (response.status >= 500) throw new WorkerError("CONTROL_API_UNAVAILABLE");
    throw malformed();
  }

  return Object.freeze({
    leaseNextAttempt: async () => parseLeaseResponse(await post("/worker-control/v1/leases", undefined, "LEASE_REJECTED")),
    requestCredentialGrant: async (executionAttemptId: string, proof: LeaseProof) => {
      if (!UUID.test(executionAttemptId)) throw new WorkerError("MALFORMED_CONTROL_RESPONSE");
      const body = await post(
        `/worker-control/v1/attempts/${executionAttemptId}/credential-grant`,
        { fencingCounter: proof.fencingCounter, leaseToken: proof.leaseToken },
        "CREDENTIAL_GRANT_REJECTED",
      );
      return parseCredentialGrantResponse(body, { executionAttemptId, fencingCounter: proof.fencingCounter });
    },
  });
}
