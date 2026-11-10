import { AuthenticationError } from "./authenticationError.js";

// The normalized external identity an authentication adapter produces after
// verifying a credential server-side. It proves who the caller is at an
// identity provider, and nothing more:
//
// - issuer and subject are opaque and immutable; they are the identity key and
//   are never trimmed, case-folded or derived from email;
// - email is an optional attribute, never an identity key, carried with the
//   provider's verified flag;
// - it carries no BusyBookie user, account, grant, role, plan, tier,
//   entitlement or ownership. Those, and whether the BusyBookie User and
//   Account are active, are decided by the application and database after
//   authentication, on every protected request.
export type VerifiedIdentity = Readonly<{
  issuer: string;
  subject: string;
  email?: Readonly<{ address: string; verified: boolean }>;
}>;

const IDENTITY_KEYS = new Set(["issuer", "subject", "email"]);
const EMAIL_KEYS = new Set(["address", "verified"]);

// Bounds mirror the users table (code points, as char_length counts).
function boundedText(value: unknown, maxLength: number): string {
  if (typeof value !== "string" || value.trim() === "" || [...value].length > maxLength) {
    throw new AuthenticationError("AUTHENTICATION_INVALID");
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Builds a frozen VerifiedIdentity from claims an adapter has already
// verified. Anything outside the contract (including any internal ID, role,
// plan or entitlement claim) is rejected rather than ignored, so it can never
// travel onward as if it were trusted.
export function createVerifiedIdentity(claims: unknown): VerifiedIdentity {
  if (!isPlainObject(claims) || Object.keys(claims).some((key) => !IDENTITY_KEYS.has(key))) {
    throw new AuthenticationError("AUTHENTICATION_INVALID");
  }

  const issuer = boundedText(claims.issuer, 512);
  const subject = boundedText(claims.subject, 255);

  if (claims.email === undefined) {
    return Object.freeze({ issuer, subject });
  }
  if (!isPlainObject(claims.email) || Object.keys(claims.email).some((key) => !EMAIL_KEYS.has(key))) {
    throw new AuthenticationError("AUTHENTICATION_INVALID");
  }
  if (typeof claims.email.verified !== "boolean") {
    throw new AuthenticationError("AUTHENTICATION_INVALID");
  }

  return Object.freeze({
    issuer,
    subject,
    email: Object.freeze({ address: boundedText(claims.email.address, 320), verified: claims.email.verified }),
  });
}
