import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

import { encodeAssociatedData, ASSOCIATED_DATA_FORMAT_V1, validateSealingContext } from "commercial-worker-protocol";
import {
  FINGERPRINT_ALGORITHM_HMAC_SHA_256,
  type CredentialFingerprinter,
  type CredentialOpener,
  type CredentialSealer,
} from "commercial-worker-protocol";
import { CredentialCryptoError } from "commercial-worker-protocol";
import { credentialBytes } from "commercial-worker-protocol";
import {
  NONCE_BYTES,
  parseSealedEnvelope,
  SEALED_ENVELOPE_FORMAT_V1,
  SEALING_ALGORITHM_AES_256_GCM,
  TAG_BYTES,
  type SealedCredentialEnvelope,
} from "commercial-worker-protocol";

// TEST FIXTURE ONLY. Real authenticated encryption (AES-256-GCM) and a real
// keyed MAC (HMAC-SHA-256) with keys generated in memory per test. Lives in
// the test tree, which production source cannot import; nothing selects it
// from the environment. Never use with a real provider credential.

const AES_256_GCM = "aes-256-gcm";
const KEY_BYTES = 32;

// An in-memory key and the reference that names it in envelopes.
export type TestKey = Readonly<{ keyRef: string; key: Buffer }>;

export function generateTestKey(keyRef: string): TestKey {
  return Object.freeze({ keyRef, key: randomBytes(KEY_BYTES) });
}

export type TestSealerOptions = Readonly<{
  // Deterministic tests may inject nonces; production-strength randomness by default.
  nonce?: () => Uint8Array;
}>;

// Seal-only authority: the returned object has no way to open anything.
export function createTestCredentialSealer(encryptionKey: TestKey, options: TestSealerOptions = {}): CredentialSealer {
  const nextNonce = options.nonce ?? (() => randomBytes(NONCE_BYTES));

  return Object.freeze({
    seal: async (credential: string, context) => {
      const plaintext = credentialBytes(credential);
      const validated = validateSealingContext(context);
      const nonce = Buffer.from(nextNonce());
      if (nonce.length !== NONCE_BYTES) {
        throw new CredentialCryptoError("CRYPTO_UNAVAILABLE");
      }

      const cipher = createCipheriv(AES_256_GCM, encryptionKey.key, nonce, { authTagLength: TAG_BYTES });
      cipher.setAAD(encodeAssociatedData(validated));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();

      const envelope: SealedCredentialEnvelope = Object.freeze({
        format: SEALED_ENVELOPE_FORMAT_V1,
        algorithm: SEALING_ALGORITHM_AES_256_GCM,
        keyRef: encryptionKey.keyRef,
        associatedDataFormat: ASSOCIATED_DATA_FORMAT_V1,
        nonce: nonce.toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
        tag: tag.toString("base64url"),
      });
      return envelope;
    },
  });
}

// Open-only authority. Any failure after parsing is AUTHENTICATION_FAILED,
// with no plaintext and no underlying crypto message.
export function createTestCredentialOpener(encryptionKey: TestKey): CredentialOpener {
  return Object.freeze({
    open: async (input: unknown, context) => {
      const { envelope, nonce, ciphertext, tag } = parseSealedEnvelope(input);
      const validated = validateSealingContext(context);
      if (envelope.keyRef !== encryptionKey.keyRef) {
        throw new CredentialCryptoError("AUTHENTICATION_FAILED");
      }

      let plaintext: Buffer;
      try {
        const decipher = createDecipheriv(AES_256_GCM, encryptionKey.key, nonce, { authTagLength: TAG_BYTES });
        decipher.setAAD(encodeAssociatedData(validated));
        decipher.setAuthTag(tag);
        plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      } catch {
        throw new CredentialCryptoError("AUTHENTICATION_FAILED");
      }

      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
      } catch {
        throw new CredentialCryptoError("AUTHENTICATION_FAILED");
      } finally {
        plaintext.fill(0);
      }
    },
  });
}

// Fingerprint-only authority, with a key that must differ from every
// encryption key.
export function createTestCredentialFingerprinter(fingerprintKey: TestKey, ...encryptionKeys: readonly TestKey[]): CredentialFingerprinter {
  if (encryptionKeys.some((key) => key.key.equals(fingerprintKey.key) || key.keyRef === fingerprintKey.keyRef)) {
    throw new Error("The fingerprint key must be separate from every encryption key.");
  }

  return Object.freeze({
    fingerprint: async (credential: string) => {
      const bytes = credentialBytes(credential);
      const value = createHmac("sha256", fingerprintKey.key).update(bytes).digest("base64url");
      return Object.freeze({ algorithm: FINGERPRINT_ALGORITHM_HMAC_SHA_256, keyRef: fingerprintKey.keyRef, value });
    },
  });
}
