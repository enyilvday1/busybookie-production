import type { CredentialSealingContext } from "./credentialContext.js";
import type { SealedCredentialEnvelope } from "./sealedEnvelope.js";

// Provider-neutral credential cryptography contracts. Each authority is a
// separate capability, so a component receives only what it needs:
//
// - the public commercial API receives a CredentialSealer and a
//   CredentialFingerprinter: it can seal and fingerprint new credentials but
//   cannot open stored ones;
// - the private execution side (worker or key service) receives a
//   CredentialOpener.
//
// No production implementation exists yet: the key-management vendor is open.
// Decrypt-capable implementations exist only in the test tree, and no
// production source composes one.

export type CredentialSealer = Readonly<{
  // Seals the exact credential, binding it to the context as authenticated
  // associated data. Rejects with CredentialCryptoError.
  seal: (credential: string, context: CredentialSealingContext) => Promise<SealedCredentialEnvelope>;
}>;

export type CredentialOpener = Readonly<{
  // Parses the untrusted envelope strictly, then opens it only if it
  // authenticates under the given context. Never returns plaintext for an
  // envelope that fails authentication.
  open: (envelope: unknown, context: CredentialSealingContext) => Promise<string>;
}>;

export const FINGERPRINT_ALGORITHM_HMAC_SHA_256 = "HMAC-SHA-256";

// A keyed, one-way fingerprint of the exact credential bytes. Suitable for
// equality comparison within an Account; never an authentication authority
// and never shown in full to a browser.
export type CredentialFingerprint = Readonly<{
  algorithm: typeof FINGERPRINT_ALGORITHM_HMAC_SHA_256;
  // Identifies the fingerprint key and version (never an encryption key).
  keyRef: string;
  // base64url HMAC output.
  value: string;
}>;

export type CredentialFingerprinter = Readonly<{
  fingerprint: (credential: string) => Promise<CredentialFingerprint>;
}>;
