import { CredentialCryptoError } from "./credentialCryptoError.js";

// The context a sealed credential is bound to through authenticated
// associated data. Opening with any other account, connection, provider,
// credential version or purpose fails authentication.

export const PROVIDER_CREDENTIAL_PURPOSE = "provider-credential";

// Version of the canonical associated-data encoding below. A new encoding gets
// a new identifier; envelopes record the one they were sealed under.
export const ASSOCIATED_DATA_FORMAT_V1 = "provider-credential-context-v1";

export const MAX_CREDENTIAL_VERSION = 1_000_000;

// Provider identifiers are controlled server-side vocabulary. This layer only
// enforces their shape; the provider capability registry decides which
// identifiers are commercially supported.
export const MAX_PROVIDER_ID_LENGTH = 32;
const PROVIDER_ID_PATTERN = /^[A-Z][A-Z0-9_]{0,31}$/;

// Canonical lowercase UUIDs only, so every logical context has exactly one
// encoding.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CONTEXT_KEYS = new Set(["accountId", "providerConnectionId", "provider", "credentialVersion", "purpose"]);

export type CredentialSealingContext = Readonly<{
  accountId: string;
  providerConnectionId: string;
  provider: string;
  credentialVersion: number;
  purpose: typeof PROVIDER_CREDENTIAL_PURPOSE;
}>;

// Validates an exact context and returns a frozen copy, so later mutation of
// the caller's object cannot change what a sealed result is bound to.
export function validateSealingContext(input: unknown): CredentialSealingContext {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new CredentialCryptoError("CONTEXT_INVALID");
  }
  const keys = Object.keys(input);
  if (keys.length !== CONTEXT_KEYS.size || keys.some((key) => !CONTEXT_KEYS.has(key))) {
    throw new CredentialCryptoError("CONTEXT_INVALID");
  }
  const candidate = input as Record<string, unknown>;

  const { accountId, providerConnectionId, provider, credentialVersion, purpose } = candidate;
  if (
    typeof accountId !== "string" ||
    !UUID_PATTERN.test(accountId) ||
    typeof providerConnectionId !== "string" ||
    !UUID_PATTERN.test(providerConnectionId) ||
    typeof provider !== "string" ||
    !PROVIDER_ID_PATTERN.test(provider) ||
    typeof credentialVersion !== "number" ||
    !Number.isSafeInteger(credentialVersion) ||
    credentialVersion < 1 ||
    credentialVersion > MAX_CREDENTIAL_VERSION ||
    purpose !== PROVIDER_CREDENTIAL_PURPOSE
  ) {
    throw new CredentialCryptoError("CONTEXT_INVALID");
  }

  return Object.freeze({ accountId, providerConnectionId, provider, credentialVersion, purpose });
}

// Canonical associated data, format provider-credential-context-v1:
//
//   provider-credential-context-v1\n
//   purpose=provider-credential\n
//   account=<lowercase uuid>\n
//   connection=<lowercase uuid>\n
//   provider=<A-Z0-9_ identifier>\n
//   credential-version=<decimal integer, no leading zeros>\n
//
// Field order is fixed. Every value comes from a validated character set that
// excludes "=" and "\n", so the encoding is unambiguous. It contains no
// secret material.
export function encodeAssociatedData(context: CredentialSealingContext): Uint8Array {
  const validated = validateSealingContext(context);
  const text =
    `${ASSOCIATED_DATA_FORMAT_V1}\n` +
    `purpose=${validated.purpose}\n` +
    `account=${validated.accountId}\n` +
    `connection=${validated.providerConnectionId}\n` +
    `provider=${validated.provider}\n` +
    `credential-version=${String(validated.credentialVersion)}\n`;
  return new TextEncoder().encode(text);
}
