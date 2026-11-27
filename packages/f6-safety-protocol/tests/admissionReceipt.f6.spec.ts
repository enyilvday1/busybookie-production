import { describe, expect, it } from "vitest";
import { F6ProtocolError, parseF6AdmissionReceipt } from "../src/index.js";
const UUID1 = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const H = "a".repeat(64);
const receipt = () => ({
  schema: "busybookie.r44b11g.f6-admission-receipt/v1", authorizationClass: "SYNTHETIC_ONLY", runId: UUID1, jti: UUID2,
  issuer: "independent-issuer", audience: "f6-exec-instance", nonce: "a".repeat(32),
  issuedAt: "2026-12-01T12:00:00.000Z", notBefore: "2026-12-01T12:00:00.000Z", expiresAt: "2026-12-01T12:00:20.000Z",
  projectId: "busybookie-f6-assess-261127", projectNumber: "477522420989", zone: "europe-west2-a", execInstanceId: "77777777777777", ctrlInstanceId: "88888888888888",
  manifestSha256: H, scenarioSha256: H, resourcePolicySha256: H, cleanupReceiptSha256: H, iamVerificationSha256: H,
  signatureAlgorithm: "Ed25519", keyId: "test-public-only-key", signatureBase64url: Buffer.alloc(64, 7).toString("base64url"),
});
const rejected = (body: object, code: string, expected?: object) => { try { parseF6AdmissionReceipt(body, expected as never); throw new Error("EXPECTED_REJECTION"); } catch (e) { expect(e).toBeInstanceOf(F6ProtocolError); expect((e as F6ProtocolError).code).toBe(code); } };

describe("F6 admission envelope P04/P11/P12/P13/P17", () => {
  it("returns only structural status even for syntactically valid signature bytes", () => {
    const out = parseF6AdmissionReceipt(receipt());
    expect(out.status).toBe("STRUCTURALLY_VALID_UNVERIFIED");
    expect(Object.keys(out).sort()).toEqual(["receipt", "status"]);
    expect(Object.isFrozen(out.receipt)).toBe(true);
    expect(out).not.toHaveProperty("authorized");
  });
  it("rejects unknown class, extra r1 field, unknown algorithm and malformed signature", () => {
    rejected({ ...receipt(), authorizationClass: "ACTUAL_F6" }, "F6_AUTHORITY_NOT_ESTABLISHED");
    rejected({ ...receipt(), r1Override: true }, "F6_STRUCTURE_INVALID");
    rejected({ ...receipt(), signatureAlgorithm: "none" }, "F6_SCHEMA_UNSUPPORTED");
    rejected({ ...receipt(), signatureBase64url: "AAAA" }, "F6_STRUCTURE_INVALID");
    rejected({ ...receipt(), signatureBase64url: "x".repeat(86) + "=" }, "F6_STRUCTURE_INVALID");
  });
  it("rejects invalid or excessive time ranges without consulting wall clock", () => {
    rejected({ ...receipt(), expiresAt: "2026-12-01T12:01:00.000Z" }, "F6_TIME_WINDOW_INVALID");
    rejected({ ...receipt(), notBefore: "2026-12-01T12:00:30.000Z" }, "F6_TIME_WINDOW_INVALID");
    rejected({ ...receipt(), issuedAt: "2026-12-01T12:00:01.000Z" }, "F6_TIME_WINDOW_INVALID");
    rejected({ ...receipt(), expiresAt: "2026-13-01T12:00:15.000Z" }, "F6_TIME_WINDOW_INVALID");
  });
  it("compares identity and digest against independently supplied expectations", () => {
    const base = receipt();
    const trusted = { runId: base.runId, projectId: base.projectId, projectNumber: base.projectNumber, zone: base.zone, execInstanceId: base.execInstanceId, ctrlInstanceId: base.ctrlInstanceId, manifestSha256: base.manifestSha256 };
    expect(parseF6AdmissionReceipt(base, trusted).status).toBe("STRUCTURALLY_VALID_UNVERIFIED");
    rejected(base, "F6_DIGEST_MISMATCH", { ...trusted, manifestSha256: "b".repeat(64) });
    rejected(base, "F6_IDENTITY_MISMATCH", { ...trusted, execInstanceId: "1" });
  });
});
