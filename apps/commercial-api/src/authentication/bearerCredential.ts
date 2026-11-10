import { AuthenticationError } from "./authenticationError.js";

// Credential transport, kept separate from verified identity: this module
// only extracts an opaque credential from the request. It never interprets
// the token's contents and never yields an identity. The production session
// strategy (cookie or bearer) is not yet selected; bearer is the transport
// used to exercise the adapter contract.

export type AuthenticationCredential = Readonly<{
  scheme: "bearer";
  // Opaque. Must never be logged, persisted or echoed in an error.
  token: string;
}>;

// RFC 7235 token68.
const TOKEN68 = /^[A-Za-z0-9\-._~+/]+=*$/;
const SCHEME_AND_TOKEN = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+) +(\S+)$/;
const MAX_TOKEN_LENGTH = 4096;

// Every Authorization value in arrival order. Node keeps only the first
// duplicate in request.headers, so rawHeaders is authoritative.
export function authorizationHeaderValues(rawHeaders: readonly string[]): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index + 1 < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === "authorization") {
      values.push(rawHeaders[index + 1] ?? "");
    }
  }
  return values;
}

// Exactly one Authorization value with the Bearer scheme (case-insensitive)
// and one token68 credential. Absent is AUTHENTICATION_REQUIRED; anything
// else that is not exactly that shape is AUTHENTICATION_MALFORMED. Malformed
// input is never treated as anonymous.
export function parseBearerCredential(values: readonly string[]): AuthenticationCredential {
  if (values.length === 0) {
    throw new AuthenticationError("AUTHENTICATION_REQUIRED");
  }
  if (values.length > 1) {
    throw new AuthenticationError("AUTHENTICATION_MALFORMED");
  }

  const match = SCHEME_AND_TOKEN.exec(values[0] ?? "");
  const scheme = match?.[1];
  const token = match?.[2];
  if (
    scheme === undefined ||
    token === undefined ||
    scheme.toLowerCase() !== "bearer" ||
    token.length > MAX_TOKEN_LENGTH ||
    !TOKEN68.test(token)
  ) {
    throw new AuthenticationError("AUTHENTICATION_MALFORMED");
  }

  return Object.freeze({ scheme: "bearer", token });
}
