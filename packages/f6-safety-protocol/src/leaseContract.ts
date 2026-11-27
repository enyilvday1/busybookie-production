import { closedRecord, decimalString, exactString, fail, integerBetween, literal, SAFE_IDENTIFIER, utcTimestamp, uuid } from "./errors.js";

export const F6_LEASE_SCHEMA = "busybookie.r44b11g.f6-synthetic-lease/v1";
const FIELDS = ["schema", "authorizationClass", "runId", "leaseId", "execInstanceId", "controllerId", "epoch", "fencingCounter", "sequence", "issuedAt", "expiresAt", "durationMs"] as const;
export type F6Lease = Readonly<{
  schema: typeof F6_LEASE_SCHEMA;
  authorizationClass: "SYNTHETIC_ONLY";
  runId: string;
  leaseId: string;
  execInstanceId: string;
  controllerId: string;
  epoch: string;
  fencingCounter: string;
  sequence: string;
  issuedAt: string;
  expiresAt: string;
  durationMs: number;
}>;
function parse(input: unknown): F6Lease {
  const r = closedRecord(input, FIELDS, "F6_LEASE_INVALID");
  const issuedAt = utcTimestamp(r.get("issuedAt"), "F6_LEASE_INVALID");
  const expiresAt = utcTimestamp(r.get("expiresAt"), "F6_LEASE_INVALID");
  const durationMs = integerBetween(r.get("durationMs"), 1, 15_000, "F6_LEASE_INVALID");
  if (Date.parse(expiresAt) <= Date.parse(issuedAt) || Date.parse(expiresAt) - Date.parse(issuedAt) > durationMs) return fail("F6_LEASE_INVALID");
  return Object.freeze({
    schema: literal(r.get("schema"), F6_LEASE_SCHEMA, "F6_SCHEMA_UNSUPPORTED"),
    authorizationClass: literal(r.get("authorizationClass"), "SYNTHETIC_ONLY", "F6_AUTHORITY_NOT_ESTABLISHED"),
    runId: uuid(r.get("runId"), "F6_LEASE_INVALID"),
    leaseId: uuid(r.get("leaseId"), "F6_LEASE_INVALID"),
    execInstanceId: decimalString(r.get("execInstanceId"), "F6_LEASE_INVALID"),
    controllerId: exactString(r.get("controllerId"), SAFE_IDENTIFIER, 128, "F6_LEASE_INVALID"),
    epoch: decimalString(r.get("epoch"), "F6_LEASE_INVALID"),
    fencingCounter: decimalString(r.get("fencingCounter"), "F6_LEASE_INVALID"),
    sequence: decimalString(r.get("sequence"), "F6_LEASE_INVALID"),
    issuedAt, expiresAt, durationMs,
  });
}

// Comparison is structural only. No external ledger, trusted time, signature
// or monotonic-clock authority is established by this pure function.
export function parseF6Lease(input: unknown, previous?: unknown): Readonly<{ lease: F6Lease; status: "STRUCTURALLY_VALID_UNVERIFIED" }> {
  const lease = parse(input);
  if (previous !== undefined) {
    const before = parse(previous);
    if (lease.runId !== before.runId || lease.execInstanceId !== before.execInstanceId || lease.controllerId !== before.controllerId || Date.parse(lease.issuedAt) < Date.parse(before.issuedAt)) return fail("F6_LEASE_INVALID");
    const nextEpoch = BigInt(lease.epoch);
    const oldEpoch = BigInt(before.epoch);
    if (nextEpoch < oldEpoch) return fail("F6_LEASE_INVALID");
    if (nextEpoch === oldEpoch) {
      if (lease.leaseId !== before.leaseId || lease.fencingCounter !== before.fencingCounter || BigInt(lease.sequence) <= BigInt(before.sequence)) return fail("F6_LEASE_INVALID");
    } else {
      if (lease.leaseId === before.leaseId || BigInt(lease.fencingCounter) <= BigInt(before.fencingCounter) || lease.sequence !== "1") return fail("F6_LEASE_INVALID");
    }
  }
  return Object.freeze({ lease, status: "STRUCTURALLY_VALID_UNVERIFIED" });
}
