import { describe, expect, it } from "vitest";
import { F6ProtocolError, validateF6Transition } from "../src/index.js";
const base = () => ({ schema: "busybookie.r44b11g.f6-transition/v1", runId: "11111111-1111-4111-8111-111111111111", execInstanceId: "77777777777777", from: "UNARMED", to: "HOST_DORMANT", evidenceSha256s: [] as string[] });
const rejected = (body: object, code: string) => { try { validateF6Transition(body); throw new Error("EXPECTED_REJECTION"); } catch (e) { expect(e).toBeInstanceOf(F6ProtocolError); expect((e as F6ProtocolError).code).toBe(code); } };

describe("F6 pure state transition P15/P17", () => {
  it("allows structural boot record but never operational authority", () => {
    const result = validateF6Transition(base());
    expect(result.structurallyPermitted).toBe(true);
    expect(result.operationallyAuthorized).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it("rejects direct leap into active and unknown state", () => {
    rejected({ ...base(), to: "SYNTHETIC_ACTIVE" }, "F6_TRANSITION_INVALID");
    rejected({ ...base(), from: "R1_APPROVED" }, "F6_TRANSITION_INVALID");
    rejected({ ...base(), r1Authorization: true }, "F6_TRANSITION_INVALID");
  });
  it("requires evidence to advance a guarded state", () => {
    rejected({ ...base(), from: "HOST_DORMANT", to: "IDENTITY_VERIFIED" }, "F6_EVIDENCE_INSUFFICIENT");
    const result = validateF6Transition({ ...base(), from: "HOST_DORMANT", to: "IDENTITY_VERIFIED", evidenceSha256s: ["a".repeat(64)] });
    expect(result.structurallyPermitted).toBe(true);
    expect(result.operationallyAuthorized).toBe(false);
  });
  it("requires external runtime evidence to claim active or contained", () => {
    for (const [from, to] of [["GUEST_LIMITS_VERIFIED", "SYNTHETIC_ACTIVE"], ["CONTAINMENT_PENDING", "CONTAINED"], ["CONTAINED", "CLOSED"]]) {
      const result = validateF6Transition({ ...base(), from, to, evidenceSha256s: ["a".repeat(64)] });
      expect(result.structurallyPermitted).toBe(false);
      expect(result.operationallyAuthorized).toBe(false);
      expect(result.classification).toBe("REQUIRES_EXTERNAL_AUTHORITY");
    }
  });
  it("allows safety escalation without upgrading authority", () => {
    const result = validateF6Transition({ ...base(), from: "CAPSULE_BOOTING", to: "ESCALATED" });
    expect(result.structurallyPermitted).toBe(true);
    expect(result.operationallyAuthorized).toBe(false);
  });
});
