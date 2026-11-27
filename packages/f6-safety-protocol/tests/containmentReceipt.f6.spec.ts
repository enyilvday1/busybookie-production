import { describe, expect, it } from "vitest";
import { F6ProtocolError, parseF6ContainmentReceipt } from "../src/index.js";
const base = () => ({ schema: "busybookie.r44b11g.f6-containment-evidence/v1", runId: "11111111-1111-4111-8111-111111111111", execInstanceId: "77777777777777", reporterId: "independent-reaper",
  trigger: "LEASE_EXPIRED", claimedStage: "LOCAL_STOP_CLAIMED", occurredAt: "2026-12-01T12:00:00.000Z", evidenceSha256s: [] as string[], operationId: null as string|null, operationTargetInstanceId: null as string|null });
const rejected = (body: object, code: string) => { try { parseF6ContainmentReceipt(body); throw new Error("EXPECTED_REJECTION"); } catch (e) { expect(e).toBeInstanceOf(F6ProtocolError); expect((e as F6ProtocolError).code).toBe(code); } };

describe("F6 evidence claims P16", () => {
  it("never converts local stop claim into verified containment", () => {
    const out = parseF6ContainmentReceipt(base());
    expect(out.status).toBe("UNVERIFIED_CLAIM");
    expect(out.receipt.claimedStage).toBe("LOCAL_STOP_CLAIMED");
    expect(out).not.toHaveProperty("verified");
  });
  it("even claimed independent verification is still only an unverified claim", () => {
    const out = parseF6ContainmentReceipt({ ...base(), claimedStage: "INDEPENDENT_VERIFIED", evidenceSha256s: ["a".repeat(64)] });
    expect(out.receipt.claimedStage).toBe("INDEPENDENT_VERIFIED");
    expect(out.status).toBe("UNVERIFIED_CLAIM");
  });
  it("rejects missing evidence and mismatched operation targets", () => {
    rejected({ ...base(), claimedStage: "INDEPENDENT_VERIFIED" }, "F6_EVIDENCE_INSUFFICIENT");
    rejected({ ...base(), operationId: "op123", operationTargetInstanceId: "22" }, "F6_IDENTITY_MISMATCH");
    rejected({ ...base(), operationTargetInstanceId: "77777777777777" }, "F6_STRUCTURE_INVALID");
    rejected({ ...base(), evidenceSha256s: ["a".repeat(64), "a".repeat(64)] }, "F6_STRUCTURE_INVALID");
  });
  it("rejects unknown fields and forged reporter stage", () => {
    rejected({ ...base(), ownerVerified: true }, "F6_STRUCTURE_INVALID");
    rejected({ ...base(), claimedStage: "CLOSED" }, "F6_STRUCTURE_INVALID");
  });
});
