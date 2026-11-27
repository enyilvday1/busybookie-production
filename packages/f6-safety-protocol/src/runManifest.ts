import { sha256F6Document } from "./canonicalEncoding.js";
import { boolean, closedRecord, decimalString, exactString, fail, frozenArray, GCP_NAME, hex256, integerBetween, literal, PROJECT_ID, SAFE_IDENTIFIER, sameIdentity, utcTimestamp, uuid, ZONE } from "./errors.js";

export const F6_MANIFEST_SCHEMA = "busybookie.r44b11g.f6-synthetic-run-manifest/v1";
const NAME_FIELDS = ["name", "instanceId", "imageSha256"] as const;
const GUEST_FIELDS = ["imageSha256", "scenarioId", "scenarioSha256"] as const;
const RESOURCE_FIELDS = ["hostCpuMilli", "hostMemoryBytes", "guestCpuMilli", "guestMemoryBytes", "guestPidsMax", "volumeMaxBytes", "walMaxBytes", "swapEnabled", "guestNetwork"] as const;
const DISK_FIELDS = ["vm", "name", "numericId", "capacityBytes", "preserveAfterVmDelete"] as const;
const MANIFEST_FIELDS = ["schema", "authorizationClass", "runId", "manifestVersion", "projectId", "projectNumber", "zone", "exec", "ctrl", "guest", "resourcePolicy", "disks", "termination", "evidence", "provenance"] as const;

export type F6VmIdentity = Readonly<{ name: string; instanceId: string; imageSha256: string }>;
export type F6ResourcePolicy = Readonly<{ hostCpuMilli: number; hostMemoryBytes: string; guestCpuMilli: number; guestMemoryBytes: string; guestPidsMax: number; volumeMaxBytes: string; walMaxBytes: string; swapEnabled: false; guestNetwork: "NONE" }>;
export type F6Disk = Readonly<{ vm: "EXEC" | "CTRL"; name: string; numericId: string; capacityBytes: string; preserveAfterVmDelete: boolean }>;
export type F6RunManifest = Readonly<{
  schema: typeof F6_MANIFEST_SCHEMA;
  authorizationClass: "SYNTHETIC_ONLY";
  runId: string;
  manifestVersion: 1;
  projectId: string;
  projectNumber: string;
  zone: string;
  exec: F6VmIdentity;
  ctrl: F6VmIdentity;
  guest: Readonly<{ imageSha256: string; scenarioId: string; scenarioSha256: string }>;
  resourcePolicy: F6ResourcePolicy;
  disks: readonly F6Disk[];
  termination: Readonly<{ execAt: string; ctrlAt: string }>;
  evidence: Readonly<{ archiveBucket: string; namespace: string }>;
  provenance: Readonly<{ policyRevision: string; policySha256: string }>;
}>;

export type F6TrustedManifestIdentity = Readonly<{ projectId: string; projectNumber: string; zone: string; execInstanceId: string; ctrlInstanceId: string }>;

function vm(input: unknown): F6VmIdentity {
  const r = closedRecord(input, NAME_FIELDS);
  return Object.freeze({
    name: exactString(r.get("name"), GCP_NAME, 63),
    instanceId: decimalString(r.get("instanceId")),
    imageSha256: hex256(r.get("imageSha256")),
  });
}
function disk(input: unknown): F6Disk {
  const r = closedRecord(input, DISK_FIELDS);
  const vm = r.get("vm");
  if (vm !== "EXEC" && vm !== "CTRL") return fail("F6_STRUCTURE_INVALID");
  return Object.freeze({
    vm,
    name: exactString(r.get("name"), GCP_NAME, 63),
    numericId: decimalString(r.get("numericId")),
    capacityBytes: decimalString(r.get("capacityBytes")),
    preserveAfterVmDelete: boolean(r.get("preserveAfterVmDelete")),
  });
}
function resources(input: unknown): F6ResourcePolicy {
  const r = closedRecord(input, RESOURCE_FIELDS);
  const result: F6ResourcePolicy = Object.freeze({
    hostCpuMilli: integerBetween(r.get("hostCpuMilli"), 1, 16_000),
    hostMemoryBytes: decimalString(r.get("hostMemoryBytes")),
    guestCpuMilli: integerBetween(r.get("guestCpuMilli"), 1, 16_000),
    guestMemoryBytes: decimalString(r.get("guestMemoryBytes")),
    guestPidsMax: integerBetween(r.get("guestPidsMax"), 1, 4096),
    volumeMaxBytes: decimalString(r.get("volumeMaxBytes")),
    walMaxBytes: decimalString(r.get("walMaxBytes")),
    swapEnabled: literal(r.get("swapEnabled"), false),
    guestNetwork: literal(r.get("guestNetwork"), "NONE"),
  });
  if (result.guestCpuMilli > result.hostCpuMilli || BigInt(result.guestMemoryBytes) >= BigInt(result.hostMemoryBytes)) return fail("F6_STRUCTURE_INVALID");
  return result;
}

// An optional comparison must come from independent caller-held expected
// identity, never copied from the untrusted manifest as a substitute for trust.
export function parseF6RunManifest(input: unknown, expected?: F6TrustedManifestIdentity): F6RunManifest {
  const r = closedRecord(input, MANIFEST_FIELDS);
  const exec = vm(r.get("exec"));
  const ctrl = vm(r.get("ctrl"));
  if (exec.instanceId === ctrl.instanceId || exec.name === ctrl.name) return fail("F6_IDENTITY_MISMATCH");
  const guestR = closedRecord(r.get("guest"), GUEST_FIELDS);
  const resourcePolicy = resources(r.get("resourcePolicy"));
  const disks = frozenArray(r.get("disks"), 8, disk, 2);
  if (!disks.some(d => d.vm === "EXEC") || !disks.some(d => d.vm === "CTRL") || new Set(disks.map(d => d.numericId)).size !== disks.length || new Set(disks.map(d => d.name)).size !== disks.length) return fail("F6_STRUCTURE_INVALID");
  const t = closedRecord(r.get("termination"), ["execAt", "ctrlAt"]);
  const execAt = utcTimestamp(t.get("execAt"));
  const ctrlAt = utcTimestamp(t.get("ctrlAt"));
  if (Date.parse(execAt) >= Date.parse(ctrlAt)) return fail("F6_TIME_WINDOW_INVALID");
  const e = closedRecord(r.get("evidence"), ["archiveBucket", "namespace"]);
  const p = closedRecord(r.get("provenance"), ["policyRevision", "policySha256"]);
  const result: F6RunManifest = Object.freeze({
    schema: literal(r.get("schema"), F6_MANIFEST_SCHEMA, "F6_SCHEMA_UNSUPPORTED"),
    authorizationClass: literal(r.get("authorizationClass"), "SYNTHETIC_ONLY", "F6_AUTHORITY_NOT_ESTABLISHED"),
    runId: uuid(r.get("runId")),
    manifestVersion: literal(r.get("manifestVersion"), 1, "F6_SCHEMA_UNSUPPORTED"),
    projectId: exactString(r.get("projectId"), PROJECT_ID, 30),
    projectNumber: decimalString(r.get("projectNumber")),
    zone: exactString(r.get("zone"), ZONE, 64),
    exec, ctrl,
    guest: Object.freeze({
      imageSha256: hex256(guestR.get("imageSha256")),
      scenarioId: exactString(guestR.get("scenarioId"), SAFE_IDENTIFIER, 128),
      scenarioSha256: hex256(guestR.get("scenarioSha256")),
    }),
    resourcePolicy,
    disks,
    termination: Object.freeze({ execAt, ctrlAt }),
    evidence: Object.freeze({
      archiveBucket: exactString(e.get("archiveBucket"), /^[a-z0-9][a-z0-9._-]{2,62}$/, 63),
      namespace: exactString(e.get("namespace"), SAFE_IDENTIFIER, 128),
    }),
    provenance: Object.freeze({
      policyRevision: exactString(p.get("policyRevision"), SAFE_IDENTIFIER, 128),
      policySha256: hex256(p.get("policySha256")),
    }),
  });
  if (expected) {
    sameIdentity(result.projectId, expected.projectId);
    sameIdentity(result.projectNumber, expected.projectNumber);
    sameIdentity(result.zone, expected.zone);
    sameIdentity(result.exec.instanceId, expected.execInstanceId);
    sameIdentity(result.ctrl.instanceId, expected.ctrlInstanceId);
  }
  return result;
}

// F6-SEC-03: This deliberately separate comparison is NOT a trust-root,
// environment check, signature verifier, or authorization to execute.
// A caller must obtain this exact policy independently of the untrusted
// manifest and authenticate/pin it outside the pure library.
const TRUSTED_POLICY_SCHEMA = "busybookie.r44b11g.f6-expected-resource-policy/v1";
const DISK_PURPOSES = ["EXEC_BOOT", "EXEC_BACKING", "CTRL_BOOT", "CTRL_EVIDENCE"] as const;
export type F6DiskPurpose = typeof DISK_PURPOSES[number];
export type F6ExpectedDisk = Readonly<F6Disk & { purpose: F6DiskPurpose }>;
export type F6ExpectedResourcePolicy = Readonly<{
  schema: typeof TRUSTED_POLICY_SCHEMA;
  policyRevision: string;
  resourcePolicy: F6ResourcePolicy;
  diskRoles: readonly F6ExpectedDisk[];
}>;

function expectedDisk(input: unknown): F6ExpectedDisk {
  const r = closedRecord(input, ["purpose", ...DISK_FIELDS]);
  const purpose = r.get("purpose");
  if (!DISK_PURPOSES.includes(purpose as F6DiskPurpose)) return fail("F6_STRUCTURE_INVALID");
  const parsedDisk = disk({
    vm: r.get("vm"), name: r.get("name"), numericId: r.get("numericId"),
    capacityBytes: r.get("capacityBytes"), preserveAfterVmDelete: r.get("preserveAfterVmDelete"),
  });
  return Object.freeze({ purpose: purpose as F6DiskPurpose, ...parsedDisk });
}

// The policy describes all four disk functions. Roles are expected in fixed
// order to give the independently supplied policy one unambiguous hash.
function parseExpectedResourcePolicy(input: unknown): F6ExpectedResourcePolicy {
  const p = closedRecord(input, ["schema", "policyRevision", "resourcePolicy", "diskRoles"]);
  const diskRoles = frozenArray(p.get("diskRoles"), 4, expectedDisk, 4);
  for (let i = 0; i < DISK_PURPOSES.length; i += 1) {
    const role = DISK_PURPOSES[i]!;
    const d = diskRoles[i]!;
    if (d.purpose !== role) return fail("F6_STRUCTURE_INVALID");
    const isExec = role.startsWith("EXEC_");
    const preserved = role.endsWith("BACKING") || role.endsWith("EVIDENCE");
    if (d.vm !== (isExec ? "EXEC" : "CTRL") || d.preserveAfterVmDelete !== preserved) return fail("F6_STRUCTURE_INVALID");
  }
  if (new Set(diskRoles.map(d => d.name)).size !== 4 || new Set(diskRoles.map(d => d.numericId)).size !== 4) return fail("F6_STRUCTURE_INVALID");
  const resourcePolicy = resources(p.get("resourcePolicy"));
  if (BigInt(resourcePolicy.walMaxBytes) > BigInt(resourcePolicy.volumeMaxBytes)
    || BigInt(resourcePolicy.volumeMaxBytes) > BigInt(diskRoles[1]!.capacityBytes)) return fail("F6_STRUCTURE_INVALID");
  return Object.freeze({
    schema: literal(p.get("schema"), TRUSTED_POLICY_SCHEMA, "F6_SCHEMA_UNSUPPORTED"),
    policyRevision: exactString(p.get("policyRevision"), SAFE_IDENTIFIER, 128),
    resourcePolicy, diskRoles,
  });
}

export type F6PolicyComparison = Readonly<{
  status: "MATCHES_CALLER_SUPPLIED_POLICY_UNVERIFIED";
  operationallyAuthorized: false;
}>;

// Structural exact comparison against a caller-held policy, including its
// computed domain-separated hash. The library CANNOT prove the policy was
// actually pinned, approved or supplied from an independent trust root.
export function compareF6ManifestToExpectedResourcePolicy(manifest: unknown, independentPolicy: unknown): F6PolicyComparison {
  const parsedManifest = parseF6RunManifest(manifest);
  const expected = parseExpectedResourcePolicy(independentPolicy);
  if (parsedManifest.provenance.policyRevision !== expected.policyRevision) return fail("F6_DIGEST_MISMATCH");
  if (parsedManifest.provenance.policySha256 !== sha256F6Document(expected, "RESOURCE_POLICY")) return fail("F6_DIGEST_MISMATCH");

  for (const key of RESOURCE_FIELDS) {
    if (parsedManifest.resourcePolicy[key] !== expected.resourcePolicy[key]) return fail("F6_STRUCTURE_INVALID");
  }
  if (parsedManifest.disks.length !== expected.diskRoles.length) return fail("F6_STRUCTURE_INVALID");
  for (const expectedDisk of expected.diskRoles) {
    const actual = parsedManifest.disks.find(d => d.numericId === expectedDisk.numericId);
    if (!actual) return fail("F6_IDENTITY_MISMATCH");
    for (const key of DISK_FIELDS) {
      if (actual[key] !== expectedDisk[key]) return fail("F6_STRUCTURE_INVALID");
    }
  }
  return Object.freeze({ status: "MATCHES_CALLER_SUPPLIED_POLICY_UNVERIFIED", operationallyAuthorized: false });
}
