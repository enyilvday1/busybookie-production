import { describe, expect, it } from "vitest";
import { F6ProtocolError, parseF6Lease } from "../src/index.js";
const runId = "11111111-1111-4111-8111-111111111111";
const leaseId = "22222222-2222-4222-8222-222222222222";
const otherLeaseId = "33333333-3333-4333-8333-333333333333";
const base = () => ({ schema: "busybookie.r44b11g.f6-synthetic-lease/v1", authorizationClass: "SYNTHETIC_ONLY", runId, leaseId,
  execInstanceId: "77777777777777", controllerId: "ctrl-sa", epoch: "1", fencingCounter: "12345678901234567890", sequence: "1",
  issuedAt: "2026-12-01T12:00:00.000Z", expiresAt: "2026-12-01T12:00:05.000Z", durationMs: 15_000 });
const rejected = (value: object, code: string, prior?: object) => { try { parseF6Lease(value, prior); throw new Error("EXPECTED_REJECTION"); } catch (e) { expect(e).toBeInstanceOf(F6ProtocolError); expect((e as F6ProtocolError).code).toBe(code); } };

describe("F6 synthetic lease P14", () => {
  it("returns structurally valid, never authenticated or live", () => {
    const out = parseF6Lease(base());
    expect(out.status).toBe("STRUCTURALLY_VALID_UNVERIFIED");
    expect(out).not.toHaveProperty("authorized");
    expect(out.lease.fencingCounter).toBe("12345678901234567890");
  });
  it("accepts valid same-epoch sequence and bumped epoch fenced sequence", () => {
    const b = base();
    expect(parseF6Lease({ ...b, sequence: "2" }, b).status).toBe("STRUCTURALLY_VALID_UNVERIFIED");
    expect(parseF6Lease({ ...b, epoch: "2", fencingCounter: "12345678901234567891", sequence: "1", leaseId: otherLeaseId }, b).status).toBe("STRUCTURALLY_VALID_UNVERIFIED");
  });
  it("rejects stale renewal, reused fencing after epoch bump and incorrect identity", () => {
    const b = base();
    rejected({ ...b, sequence: "1" }, "F6_LEASE_INVALID", b);
    rejected({ ...b, epoch: "2", fencingCounter: b.fencingCounter, leaseId: otherLeaseId }, "F6_LEASE_INVALID", b);
    rejected({ ...b, sequence: "2", execInstanceId: "10" }, "F6_LEASE_INVALID", b);
    rejected({ ...b, sequence: 2 }, "F6_LEASE_INVALID", b);
  });
  it("rejects bad duration, invalid dates and live-F6 class", () => {
    rejected({ ...base(), expiresAt: "2026-12-01T12:00:17.000Z" }, "F6_LEASE_INVALID");
    rejected({ ...base(), durationMs: 25_000 }, "F6_LEASE_INVALID");
    rejected({ ...base(), authorizationClass: "R1" }, "F6_AUTHORITY_NOT_ESTABLISHED");
  });
});
