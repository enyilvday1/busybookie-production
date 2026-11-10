import { CredentialCryptoError } from "./credentialCryptoError.js";

// Provider credentials are opaque secrets. They are sealed and fingerprinted
// exactly as accepted: never trimmed, case-folded, Unicode-normalised, or
// parsed for provider-specific prefixes.

// Generous for API keys and bounded tokens, and far below anything abusive.
export const MAX_CREDENTIAL_BYTES = 8192;

// A lone UTF-16 surrogate: TextEncoder would replace it with U+FFFD.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// Returns the exact UTF-8 bytes of the credential as a fresh copy. Rejects an
// empty value, one larger than MAX_CREDENTIAL_BYTES, a string that is not
// well-formed UTF-16 (encoding it would silently substitute U+FFFD), and NUL
// characters (a common sign of truncation or injection). No other content
// rule is applied.
export function credentialBytes(credential: unknown): Uint8Array {
  if (typeof credential !== "string" || credential.length === 0 || LONE_SURROGATE.test(credential) || credential.includes("\u0000")) {
    throw new CredentialCryptoError("CREDENTIAL_INVALID");
  }
  const bytes = new TextEncoder().encode(credential);
  if (bytes.length > MAX_CREDENTIAL_BYTES) {
    throw new CredentialCryptoError("CREDENTIAL_INVALID");
  }
  return bytes;
}
