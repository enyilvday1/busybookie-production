import { closedRecord, decimalString, exactString, fail, frozenArray, hex256, literal, SAFE_IDENTIFIER, utcTimestamp, uuid } from "./errors.js";

export const F6_CONTAINMENT_SCHEMA = "busybookie.r44b11g.f6-containment-evidence/v1";
export type F6ContainmentStage = "REQUESTED" | "PROVIDER_ACCEPTED" | "LOCAL_STOP_CLAIMED" | "PROVIDER_OPERATION_COMPLETED" | "INDEPENDENT_VERIFIED" | "UNRESOLVED";
export type F6ContainmentTrigger = "LEASE_EXPIRED" | "CTRL_STOP" | "RESOURCE_BREACH" | "VM_TERMINATION" | "POLICY_FAILURE" | "UNKNOWN";
export type F6ContainmentReceipt = Readonly<{
  schema: typeof F6_CONTAINMENT_SCHEMA;
  runId: string;
  execInstanceId: string;
  reporterId: string;
  trigger: F6ContainmentTrigger;
  claimedStage: F6ContainmentStage;
  occurredAt: string;
  evidenceSha256s: readonly string[];
  operationId: string | null;
  operationTargetInstanceId: string | null;
}>;
const FIELDS = ["schema", "runId", "execInstanceId", "reporterId", "trigger", "claimedStage", "occurredAt", "evidenceSha256s", "operationId", "operationTargetInstanceId"] as const;
const STAGES: readonly F6ContainmentStage[] = ["REQUESTED", "PROVIDER_ACCEPTED", "LOCAL_STOP_CLAIMED", "PROVIDER_OPERATION_COMPLETED", "INDEPENDENT_VERIFIED", "UNRESOLVED"];
const TRIGGERS: readonly F6ContainmentTrigger[] = ["LEASE_EXPIRED", "CTRL_STOP", "RESOURCE_BREACH", "VM_TERMINATION", "POLICY_FAILURE", "UNKNOWN"];
function stage(value: unknown): F6ContainmentStage {
  if (typeof value !== "string" || !STAGES.includes(value as F6ContainmentStage)) return fail("F6_STRUCTURE_INVALID");
  return value as F6ContainmentStage;
}
function trigger(value: unknown): F6ContainmentTrigger {
  if (typeof value !== "string" || !TRIGGERS.includes(value as F6ContainmentTrigger)) return fail("F6_STRUCTURE_INVALID");
  return value as F6ContainmentTrigger;
}
export function parseF6ContainmentReceipt(input: unknown): Readonly<{ receipt: F6ContainmentReceipt; status: "UNVERIFIED_CLAIM" }> {
  const r = closedRecord(input, FIELDS);
  const claimedStage = stage(r.get("claimedStage"));
  const evidenceSha256s = frozenArray(r.get("evidenceSha256s"), 32, (item) => hex256(item));
  if ((claimedStage === "INDEPENDENT_VERIFIED" || claimedStage === "PROVIDER_OPERATION_COMPLETED") && evidenceSha256s.length === 0) return fail("F6_EVIDENCE_INSUFFICIENT");
  if (new Set(evidenceSha256s).size !== evidenceSha256s.length) return fail("F6_STRUCTURE_INVALID");
  const operationIdInput = r.get("operationId");
  const targetInput = r.get("operationTargetInstanceId");
  const operationId = operationIdInput === null ? null : exactString(operationIdInput, SAFE_IDENTIFIER, 128);
  const operationTargetInstanceId = targetInput === null ? null : decimalString(targetInput);
  if (operationId === null && operationTargetInstanceId !== null) return fail("F6_STRUCTURE_INVALID");
  const execInstanceId = decimalString(r.get("execInstanceId"));
  if (operationTargetInstanceId !== null && execInstanceId !== operationTargetInstanceId) return fail("F6_IDENTITY_MISMATCH");
  const receipt: F6ContainmentReceipt = Object.freeze({
    schema: literal(r.get("schema"), F6_CONTAINMENT_SCHEMA, "F6_SCHEMA_UNSUPPORTED"),
    runId: uuid(r.get("runId")),
    execInstanceId,
    reporterId: exactString(r.get("reporterId"), SAFE_IDENTIFIER, 128),
    trigger: trigger(r.get("trigger")),
    claimedStage, occurredAt: utcTimestamp(r.get("occurredAt")),
    evidenceSha256s, operationId, operationTargetInstanceId,
  });
  return Object.freeze({ receipt, status: "UNVERIFIED_CLAIM" });
}
