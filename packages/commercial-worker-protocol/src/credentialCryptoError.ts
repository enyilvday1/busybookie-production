export type CredentialCryptoErrorCode =
  // The credential is empty, too large or not a well-formed string.
  | "CREDENTIAL_INVALID"
  // The sealing context does not match the exact contract.
  | "CONTEXT_INVALID"
  // The envelope is malformed, oversized or uses an unsupported format,
  // algorithm or associated-data version.
  | "ENVELOPE_UNSUPPORTED"
  // The envelope did not authenticate under the given key and context.
  | "AUTHENTICATION_FAILED"
  // The sealing, opening or fingerprinting service is unavailable.
  | "CRYPTO_UNAVAILABLE";

// Fixed messages: never the credential, key, ciphertext, MAC or the text of
// an underlying crypto exception.
const MESSAGES: Readonly<Record<CredentialCryptoErrorCode, string>> = {
  CREDENTIAL_INVALID: "The provider credential is not acceptable.",
  CONTEXT_INVALID: "The credential sealing context is not valid.",
  ENVELOPE_UNSUPPORTED: "The sealed credential envelope is not supported.",
  AUTHENTICATION_FAILED: "The sealed credential could not be authenticated.",
  CRYPTO_UNAVAILABLE: "Credential cryptography is temporarily unavailable.",
};

// No cause is attached: crypto library errors can describe inputs, and a
// cause is easy to log by accident. The code is the whole diagnostic.
export class CredentialCryptoError extends Error {
  override readonly name = "CredentialCryptoError";

  constructor(readonly code: CredentialCryptoErrorCode) {
    super(MESSAGES[code]);
  }
}
