import { closedRecord, decimalString, exactString, fail, hex256, literal, PROJECT_ID, SAFE_IDENTIFIER, sameIdentity, utcTimestamp, uuid, ZONE } from "./errors.js";

export const F6_ADMISSION_SCHEMA = "busybookie.r44b11g.f6-admission-receipt/v1";
const FIELDS = ["schema", "authorizationClass", "runId", "jti", "issuer", "audience", "nonce", "issuedAt", "notBefore", "expiresAt", "projectId", "projectNumber", "zone", "execInstanceId", "ctrlInstanceId", "manifestSha256", "scenarioSha256", "resourcePolicySha256", "cleanupReceiptSha256", "iamVerificationSha256", "signatureAlgorithm", "keyId", "signatureBase64url"] as const;
export type F6AdmissionReceipt = Readonly<{
  schema: typeof F6_ADMISSION_SCHEMA;
  authorizationClass: "SYNTHETIC_ONLY";
  runId: string;
  jti: string;
  issuer: string;
  audience: string;
  nonce: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string;
  projectId: string;
  projectNumber: string;
  zone: string;
  execInstanceId: string;
  ctrlInstanceId: string;
  manifestSha256: string;
  scenarioSha256: string;
  resourcePolicySha256: string;
  cleanupReceiptSha256: string;
  iamVerificationSha256: string;
  signatureAlgorithm: "Ed25519";
  keyId: string;
  signatureBase64url: string;
}>;
export type F6TrustedAdmissionBinding = Readonly<{
  runId: string;
  projectId: string;
  projectNumber: string;
  zone: string;
  execInstanceId: string;
  ctrlInstanceId: string;
  manifestSha256: string;
}>;
function ed25519Signature(input: unknown): string {
  const text = exactString(input, /^[A-Za-z0-9_-]+$/, 90);
  const bytes = Buffer.from(text, "base64url");
  if (bytes.length !== 64 || bytes.toString("base64url") !== text) return fail("F6_STRUCTURE_INVALID");
  return text;
}

// Not signature verification, token authentication, replay consumption or a
// runtime decision. The returned status always remains UNVERIFIED.
export function parseF6AdmissionReceipt(input: unknown, expected?: F6TrustedAdmissionBinding): Readonly<{ receipt: F6AdmissionReceipt; status: "STRUCTURALLY_VALID_UNVERIFIED" }> {
  const r = closedRecord(input, FIELDS);
  const issuedAt = utcTimestamp(r.get("issuedAt"));
  const notBefore = utcTimestamp(r.get("notBefore"));
  const expiresAt = utcTimestamp(r.get("expiresAt"));
  const issued = Date.parse(issuedAt);
  const validFrom = Date.parse(notBefore);
  const expiration = Date.parse(expiresAt);
  if (issued > validFrom || validFrom >= expiration || expiration - validFrom > 30_000) return fail("F6_TIME_WINDOW_INVALID");
  const receipt: F6AdmissionReceipt = Object.freeze({
    schema: literal(r.get("schema"), F6_ADMISSION_SCHEMA, "F6_SCHEMA_UNSUPPORTED"),
    authorizationClass: literal(r.get("authorizationClass"), "SYNTHETIC_ONLY", "F6_AUTHORITY_NOT_ESTABLISHED"),
    runId: uuid(r.get("runId")),
    jti: uuid(r.get("jti")),
    issuer: exactString(r.get("issuer"), SAFE_IDENTIFIER, 128),
    audience: exactString(r.get("audience"), SAFE_IDENTIFIER, 128),
    nonce: exactString(r.get("nonce"), /^[A-Za-z0-9_-]{22,128}$/, 128),
    issuedAt, notBefore, expiresAt,
    projectId: exactString(r.get("projectId"), PROJECT_ID, 30),
    projectNumber: decimalString(r.get("projectNumber")),
    zone: exactString(r.get("zone"), ZONE, 64),
    execInstanceId: decimalString(r.get("execInstanceId")),
    ctrlInstanceId: decimalString(r.get("ctrlInstanceId")),
    manifestSha256: hex256(r.get("manifestSha256")),
    scenarioSha256: hex256(r.get("scenarioSha256")),
    resourcePolicySha256: hex256(r.get("resourcePolicySha256")),
    cleanupReceiptSha256: hex256(r.get("cleanupReceiptSha256")),
    iamVerificationSha256: hex256(r.get("iamVerificationSha256")),
    signatureAlgorithm: literal(r.get("signatureAlgorithm"), "Ed25519", "F6_SCHEMA_UNSUPPORTED"),
    keyId: exactString(r.get("keyId"), SAFE_IDENTIFIER, 128),
    signatureBase64url: ed25519Signature(r.get("signatureBase64url")),
  });
  if (receipt.execInstanceId === receipt.ctrlInstanceId) return fail("F6_IDENTITY_MISMATCH");
  if (expected) {
    sameIdentity(receipt.runId, expected.runId);
    sameIdentity(receipt.projectId, expected.projectId);
    sameIdentity(receipt.projectNumber, expected.projectNumber);
    sameIdentity(receipt.zone, expected.zone);
    sameIdentity(receipt.execInstanceId, expected.execInstanceId);
    sameIdentity(receipt.ctrlInstanceId, expected.ctrlInstanceId);
    if (receipt.manifestSha256 !== expected.manifestSha256) return fail("F6_DIGEST_MISMATCH");
  }
  return Object.freeze({ receipt, status: "STRUCTURALLY_VALID_UNVERIFIED" });
}
