import { describe, expect, it } from "vitest";
import { F6ProtocolError, compareF6ManifestToExpectedResourcePolicy, parseF6RunManifest, sha256F6Document } from "../src/index.js";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const digest = "a".repeat(64);
const manifest = () => ({
  schema: "busybookie.r44b11g.f6-synthetic-run-manifest/v1", authorizationClass: "SYNTHETIC_ONLY", runId: RUN_ID, manifestVersion: 1,
  projectId: "busybookie-f6-assess-261127", projectNumber: "477522420989", zone: "europe-west2-a",
  exec: { name: "f6-exec", instanceId: "77777777777777", imageSha256: digest },
  ctrl: { name: "f6-ctrl", instanceId: "88888888888888", imageSha256: digest },
  guest: { imageSha256: digest, scenarioId: "inert-synthetic", scenarioSha256: digest },
  resourcePolicy: { hostCpuMilli: 4000, hostMemoryBytes: "9663676416", guestCpuMilli: 2000, guestMemoryBytes: "6442450944", guestPidsMax: 128, volumeMaxBytes: "20000000000", walMaxBytes: "2000000000", swapEnabled: false, guestNetwork: "NONE" },
  disks: [
    { vm: "EXEC", name: "f6-exec-boot", numericId: "1234567890123", capacityBytes: "32212254720", preserveAfterVmDelete: false },
    { vm: "CTRL", name: "f6-ctrl-evidence", numericId: "1234567890124", capacityBytes: "10737418240", preserveAfterVmDelete: true },
  ],
  termination: { execAt: "2026-12-01T13:30:00.000Z", ctrlAt: "2026-12-01T14:00:00.000Z" },
  evidence: { archiveBucket: "f6-evidence-bucket", namespace: "runs/test-1" },
  provenance: { policyRevision: "R44B11G-F6-A14E", policySha256: digest },
});
const rejected = (body: object, code: string, expected?: unknown) => { try { parseF6RunManifest(body, expected as never); throw new Error("EXPECTED_REJECTION"); } catch (e) { expect(e).toBeInstanceOf(F6ProtocolError); expect((e as F6ProtocolError).code).toBe(code); } };

describe("F6 run manifest P01-P05", () => {
  it("parses and reconstructs a deeply frozen manifest; canonicalizes", () => {
    const value = parseF6RunManifest(manifest());
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.exec)).toBe(true);
    expect(Object.isFrozen(value.disks[0])).toBe(true);
    expect(sha256F6Document(value, "RUN_MANIFEST")).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects unsupported schema, wrong class, absent and extra fields", () => {
    rejected({ ...manifest(), schema: "v2" }, "F6_SCHEMA_UNSUPPORTED");
    rejected({ ...manifest(), authorizationClass: "ACTUAL_F6" }, "F6_AUTHORITY_NOT_ESTABLISHED");
    const { runId: _, ...missing } = manifest();
    rejected(missing, "F6_STRUCTURE_INVALID");
    rejected({ ...manifest(), r1Authorized: true }, "F6_STRUCTURE_INVALID");
  });
  it("rejects IDs as numbers and checks independent identity", () => {
    const base = manifest();
    rejected({ ...base, exec: { ...base.exec, instanceId: 77777777777777 } }, "F6_STRUCTURE_INVALID");
    rejected({ ...base, exec: { ...base.exec, instanceId: base.ctrl.instanceId } }, "F6_IDENTITY_MISMATCH");
    const expected = { projectId: base.projectId, projectNumber: base.projectNumber, zone: base.zone, execInstanceId: base.exec.instanceId, ctrlInstanceId: "900" };
    rejected(base, "F6_IDENTITY_MISMATCH", expected);
  });
  it("rejects disk duplicates, impossible limits and timestamp reversal", () => {
    const base = manifest();
    rejected({ ...base, disks: [base.disks[0], base.disks[0]] }, "F6_STRUCTURE_INVALID");
    rejected({ ...base, resourcePolicy: { ...base.resourcePolicy, guestCpuMilli: 5000 } }, "F6_STRUCTURE_INVALID");
    rejected({ ...base, termination: { execAt: base.termination.ctrlAt, ctrlAt: base.termination.execAt } }, "F6_TIME_WINDOW_INVALID");
  });
});


describe("F6-SEC-03 caller-held resource policy comparison (never authorization)", () => {
  const bound = () => {
    const base = manifest();
    const disks = [
      base.disks[0]!,
      { vm: "EXEC" as const, name: "f6-exec-backing", numericId: "1234567890125", capacityBytes: "51539607552", preserveAfterVmDelete: true },
      { vm: "CTRL" as const, name: "f6-ctrl-boot", numericId: "1234567890126", capacityBytes: "10737418240", preserveAfterVmDelete: false },
      base.disks[1]!,
    ];
    const policy = {
      schema: "busybookie.r44b11g.f6-expected-resource-policy/v1",
      policyRevision: base.provenance.policyRevision,
      resourcePolicy: base.resourcePolicy,
      diskRoles: disks.map((disk, i) => ({
        ...disk, purpose: (["EXEC_BOOT", "EXEC_BACKING", "CTRL_BOOT", "CTRL_EVIDENCE"] as const)[i]!,
      })),
    };
    const complete = {
      ...base, disks,
      provenance: { ...base.provenance, policySha256: sha256F6Document(policy, "RESOURCE_POLICY") },
    };
    return { complete, policy };
  };
  const rejectedComparison = (manifestValue: unknown, policyValue: unknown, code: string): void => {
    try { compareF6ManifestToExpectedResourcePolicy(manifestValue, policyValue); throw new Error("EXPECTED_REJECTION"); }
    catch (e) { expect(e).toBeInstanceOf(F6ProtocolError); expect((e as F6ProtocolError).code).toBe(code); }
  };
  it("compares every resource and all four disk roles with an external policy without authorizing", () => {
    const { complete, policy } = bound();
    const out = compareF6ManifestToExpectedResourcePolicy(complete, policy);
    expect(out).toEqual({ status: "MATCHES_CALLER_SUPPLIED_POLICY_UNVERIFIED", operationallyAuthorized: false });
  });
  it("rejects tiny host/guest memory even though raw structural parsing accepts them", () => {
    const { complete, policy } = bound();
    const untrusted = { ...complete, resourcePolicy: { ...complete.resourcePolicy, hostMemoryBytes: "3", guestMemoryBytes: "1" } };
    expect(parseF6RunManifest(untrusted).resourcePolicy.hostMemoryBytes).toBe("3");
    rejectedComparison(untrusted, policy, "F6_STRUCTURE_INVALID");
  });
  it("rejects unapproved disk attachments, retention and inventory", () => {
    const { complete, policy } = bound();
    rejectedComparison({ ...complete, disks: complete.disks.slice(0, 2) }, policy, "F6_STRUCTURE_INVALID");
    rejectedComparison({ ...complete, disks: complete.disks.map((d, i) => i === 1 ? { ...d, vm: "CTRL" } : d) }, policy, "F6_STRUCTURE_INVALID");
    rejectedComparison({ ...complete, disks: complete.disks.map((d, i) => i === 1 ? { ...d, preserveAfterVmDelete: false } : d) }, policy, "F6_STRUCTURE_INVALID");
    rejectedComparison({ ...complete, disks: complete.disks.map((d, i) => i === 1 ? { ...d, capacityBytes: "1" } : d) }, policy, "F6_STRUCTURE_INVALID");
    rejectedComparison({ ...complete, disks: complete.disks.map((d, i) => i === 1 ? { ...d, numericId: "999999" } : d) }, policy, "F6_IDENTITY_MISMATCH");
  });
  it("rejects forged policy digest, changed revision and invalid expected disk-role mapping", () => {
    const { complete, policy } = bound();
    rejectedComparison({ ...complete, provenance: { ...complete.provenance, policySha256: digest } }, policy, "F6_DIGEST_MISMATCH");
    rejectedComparison({ ...complete, provenance: { ...complete.provenance, policyRevision: "another-revision" } }, policy, "F6_DIGEST_MISMATCH");
    rejectedComparison(complete, { ...policy, diskRoles: [...policy.diskRoles].reverse() }, "F6_STRUCTURE_INVALID");
    rejectedComparison(complete, { ...policy, resourcePolicy: { ...policy.resourcePolicy, walMaxBytes: "50000000000" } }, "F6_STRUCTURE_INVALID");
    rejectedComparison(complete, { ...policy, resourcePolicy: { ...policy.resourcePolicy, volumeMaxBytes: "70000000000" } }, "F6_STRUCTURE_INVALID");
  });
});
