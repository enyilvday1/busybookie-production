import { closedRecord, decimalString, fail, frozenArray, hex256, literal, uuid } from "./errors.js";

export const F6_TRANSITION_SCHEMA = "busybookie.r44b11g.f6-transition/v1";
export type F6State = "UNARMED" | "HOST_DORMANT" | "IDENTITY_VERIFIED" | "CONTAINMENT_VERIFIED" | "ADMISSION_ISSUED" | "ADMISSION_CONSUMED" | "CAPSULE_BOOTING" | "GUEST_LIMITS_VERIFIED" | "SYNTHETIC_ACTIVE" | "CONTAINMENT_REQUIRED" | "CONTAINMENT_PENDING" | "CONTAINED" | "ESCALATED" | "CLOSED";
export type F6TransitionDecision = Readonly<{
  from: F6State;
  to: F6State;
  structurallyPermitted: boolean;
  operationallyAuthorized: false;
  classification: "STRUCTURAL_ONLY" | "REQUIRES_EXTERNAL_AUTHORITY";
}>;
const STATES: readonly F6State[] = ["UNARMED", "HOST_DORMANT", "IDENTITY_VERIFIED", "CONTAINMENT_VERIFIED", "ADMISSION_ISSUED", "ADMISSION_CONSUMED", "CAPSULE_BOOTING", "GUEST_LIMITS_VERIFIED", "SYNTHETIC_ACTIVE", "CONTAINMENT_REQUIRED", "CONTAINMENT_PENDING", "CONTAINED", "ESCALATED", "CLOSED"];
const NEXT: Readonly<Record<F6State, readonly F6State[]>> = {
  UNARMED: ["HOST_DORMANT", "ESCALATED"],
  HOST_DORMANT: ["IDENTITY_VERIFIED", "CONTAINMENT_REQUIRED", "ESCALATED"],
  IDENTITY_VERIFIED: ["CONTAINMENT_VERIFIED", "CONTAINMENT_REQUIRED", "ESCALATED"],
  CONTAINMENT_VERIFIED: ["ADMISSION_ISSUED", "CONTAINMENT_REQUIRED", "ESCALATED"],
  ADMISSION_ISSUED: ["ADMISSION_CONSUMED", "CONTAINMENT_REQUIRED", "ESCALATED"],
  ADMISSION_CONSUMED: ["CAPSULE_BOOTING", "CONTAINMENT_REQUIRED", "ESCALATED"],
  CAPSULE_BOOTING: ["GUEST_LIMITS_VERIFIED", "CONTAINMENT_REQUIRED", "ESCALATED"],
  GUEST_LIMITS_VERIFIED: ["SYNTHETIC_ACTIVE", "CONTAINMENT_REQUIRED", "ESCALATED"],
  SYNTHETIC_ACTIVE: ["CONTAINMENT_REQUIRED", "ESCALATED"],
  CONTAINMENT_REQUIRED: ["CONTAINMENT_PENDING", "ESCALATED"],
  CONTAINMENT_PENDING: ["CONTAINED", "ESCALATED"],
  CONTAINED: ["CLOSED", "ESCALATED"],
  ESCALATED: [],
  CLOSED: [],
};
const ALWAYS_EXTERNAL = new Set<F6State>(["SYNTHETIC_ACTIVE", "CONTAINED", "CLOSED"]);
function asState(value: unknown): F6State {
  if (typeof value !== "string" || !STATES.includes(value as F6State)) return fail("F6_TRANSITION_INVALID");
  return value as F6State;
}

// This function NEVER performs a state transition or authorizes an action.
// Even a structurally permitted transition requires external durable authority.
export function validateF6Transition(input: unknown): F6TransitionDecision {
  const r = closedRecord(input, ["schema", "runId", "execInstanceId", "from", "to", "evidenceSha256s"], "F6_TRANSITION_INVALID");
  literal(r.get("schema"), F6_TRANSITION_SCHEMA, "F6_SCHEMA_UNSUPPORTED");
  uuid(r.get("runId"), "F6_TRANSITION_INVALID");
  decimalString(r.get("execInstanceId"), "F6_TRANSITION_INVALID");
  const from = asState(r.get("from"));
  const to = asState(r.get("to"));
  if (!NEXT[from].includes(to)) return fail("F6_TRANSITION_INVALID");
  const evidence = frozenArray(r.get("evidenceSha256s"), 16, item => hex256(item, "F6_TRANSITION_INVALID"));
  if (new Set(evidence).size !== evidence.length) return fail("F6_TRANSITION_INVALID");
  if (to !== "HOST_DORMANT" && to !== "CONTAINMENT_REQUIRED" && to !== "ESCALATED" && evidence.length === 0) return fail("F6_EVIDENCE_INSUFFICIENT");
  const structurallyPermitted = !ALWAYS_EXTERNAL.has(to);
  return Object.freeze({
    from, to, structurallyPermitted,
    operationallyAuthorized: false,
    classification: structurallyPermitted ? "STRUCTURAL_ONLY" : "REQUIRES_EXTERNAL_AUTHORITY",
  });
}
