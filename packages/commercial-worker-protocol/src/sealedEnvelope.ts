import { ASSOCIATED_DATA_FORMAT_V1 } from "./credentialContext.js";
import { CredentialCryptoError } from "./credentialCryptoError.js";
import { MAX_CREDENTIAL_BYTES } from "./credentialInput.js";

// The persisted form of a sealed credential: non-secret cryptographic
// metadata plus ciphertext, all as immutable base64url strings. It never holds
// plaintext or a fingerprint. Another sealing mechanism (for example key
// management envelope encryption or asymmetric sealing) gets a new `format`.

export const SEALED_ENVELOPE_FORMAT_V1 = "sealed-credential-v1";

// The only algorithm format v1 admits: AES-256-GCM, 96-bit nonce, 128-bit tag.
export const SEALING_ALGORITHM_AES_256_GCM = "AES-256-GCM";
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

export const MAX_KEY_REF_LENGTH = 128;
const KEY_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type SealedCredentialEnvelope = Readonly<{
  format: typeof SEALED_ENVELOPE_FORMAT_V1;
  algorithm: typeof SEALING_ALGORITHM_AES_256_GCM;
  // Identifies the key and key version used, never the key itself.
  keyRef: string;
  associatedDataFormat: typeof ASSOCIATED_DATA_FORMAT_V1;
  nonce: string;
  ciphertext: string;
  tag: string;
}>;

const ENVELOPE_KEYS = new Set(["format", "algorithm", "keyRef", "associatedDataFormat", "nonce", "ciphertext", "tag"]);

function unsupported(): CredentialCryptoError {
  return new CredentialCryptoError("ENVELOPE_UNSUPPORTED");
}

// Strict canonical base64url (no padding) decoding with an exact or bounded length.
function decodeBase64Url(value: unknown, minBytes: number, maxBytes: number): Uint8Array {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil((maxBytes * 4) / 3) || !BASE64URL_PATTERN.test(value)) {
    throw unsupported();
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < minBytes || bytes.length > maxBytes || bytes.toString("base64url") !== value) {
    throw unsupported();
  }
  return new Uint8Array(bytes);
}

export type ParsedSealedEnvelope = Readonly<{
  envelope: SealedCredentialEnvelope;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}>;

// Persisted envelopes are untrusted input. Every field is required, no extra
// field is accepted, versions and algorithm must be the supported ones, and
// every encoded value must be canonical and within its bound. Failures never
// echo the input.
export function parseSealedEnvelope(input: unknown): ParsedSealedEnvelope {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw unsupported();
  }
  const keys = Object.keys(input);
  if (keys.length !== ENVELOPE_KEYS.size || keys.some((key) => !ENVELOPE_KEYS.has(key))) {
    throw unsupported();
  }
  const candidate = input as Record<string, unknown>;

  if (
    candidate.format !== SEALED_ENVELOPE_FORMAT_V1 ||
    candidate.algorithm !== SEALING_ALGORITHM_AES_256_GCM ||
    candidate.associatedDataFormat !== ASSOCIATED_DATA_FORMAT_V1 ||
    typeof candidate.keyRef !== "string" ||
    !KEY_REF_PATTERN.test(candidate.keyRef)
  ) {
    throw unsupported();
  }

  // GCM ciphertext has exactly the plaintext's length.
  const nonce = decodeBase64Url(candidate.nonce, NONCE_BYTES, NONCE_BYTES);
  const ciphertext = decodeBase64Url(candidate.ciphertext, 1, MAX_CREDENTIAL_BYTES);
  const tag = decodeBase64Url(candidate.tag, TAG_BYTES, TAG_BYTES);

  const envelope: SealedCredentialEnvelope = Object.freeze({
    format: SEALED_ENVELOPE_FORMAT_V1,
    algorithm: SEALING_ALGORITHM_AES_256_GCM,
    keyRef: candidate.keyRef,
    associatedDataFormat: ASSOCIATED_DATA_FORMAT_V1,
    nonce: candidate.nonce as string,
    ciphertext: candidate.ciphertext as string,
    tag: candidate.tag as string,
  });

  return Object.freeze({ envelope, nonce, ciphertext, tag });
}
